import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.ts";
import { isLoggedIn } from "../lib/auth.ts";

export interface Session {
  session_id: string;
  preview: string;
  last_activity: string;
  message_count: number;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  tool_calls_made?: string[];
  isOptimistic?: boolean;
  isStreaming?: boolean;
}

type ChatPostResponse = {
  response: string;
  session_id: string;
  tool_calls_made: string[];
};

type HistoryRow = {
  role: string;
  content: string;
  created_at: string;
};

type SendMessageOptions = {
  complexityHigh?: boolean;
};

const PHASES_NORMAL = [
  "Am Nachdenken …",
  "Plane nächste Schritte …",
  "Bereite Antwort vor …",
] as const;

const PHASES_COMPLEX = [
  "Am Nachdenken über deine Anfrage …",
  "Plane nächste Schritte für eine komplexe Antwort …",
  "Prüfe Zusammenhänge und priorisiere Punkte …",
  "Bereite Antwort vor …",
] as const;

const PHASE_TICK_MS = 1600;
const STREAM_TOKEN_DELAY_MS = 40;
const STREAM_FAST_FORWARD_AFTER = 450;

function formatSendFailureDetail(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const j = JSON.parse(err.message) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) {
        return `HTTP ${err.status}: ${j.error}`;
      }
    } catch {
      /* Text-Body */
    }
    const snippet = err.message.trim().slice(0, 280);
    return snippet ? `HTTP ${err.status}: ${snippet}` : `HTTP ${err.status}`;
  }
  if (err instanceof TypeError) {
    return `${err.message} — Backend erreichbar? VITE_API_URL / CORS prüfen (DevTools → Network).`;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Unbekannter Fehler.";
}

function mapHistoryRow(r: HistoryRow): Message | null {
  if (r.role === "user" || r.role === "assistant") {
    return {
      role: r.role,
      content: r.content,
      created_at: r.created_at,
    };
  }
  return null;
}

function tokenizeForStream(text: string): string[] {
  return text.match(/\S+|\s+/gu) ?? [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useChat(): {
  sessions: Session[];
  sessionsLoading: boolean;
  currentSessionId: string | null;
  messages: Message[];
  isLoading: boolean;
  isBusy: boolean;
  phaseLabel: string;
  isSendError: boolean;
  /** Kurztext zu letztem Sendefehler (ApiError / Netzwerk), leer wenn keiner. */
  sendErrorDetail: string;
  sendMessage: (text: string, options?: SendMessageOptions) => Promise<void>;
  startNewSession: () => void;
  selectSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
} {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/api/chat/sessions"),
    enabled: isLoggedIn(),
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isReplyStreaming, setIsReplyStreaming] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState("");
  const [phaseMode, setPhaseMode] = useState<"normal" | "complex">("normal");
  const [isSendError, setIsSendError] = useState(false);
  const [sendErrorDetail, setSendErrorDetail] = useState("");
  const sendLockRef = useRef(false);
  const runIdRef = useRef(0);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPhaseTimer = useCallback(() => {
    if (phaseTimerRef.current !== null) {
      clearInterval(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isLoading) {
      stopPhaseTimer();
      setPhaseLabel("");
      return;
    }
    const phases = phaseMode === "complex" ? PHASES_COMPLEX : PHASES_NORMAL;
    let index = 0;
    setPhaseLabel(phases[0] ?? "Am Nachdenken …");
    phaseTimerRef.current = setInterval(() => {
      index = (index + 1) % phases.length;
      setPhaseLabel(phases[index] ?? "Am Nachdenken …");
    }, PHASE_TICK_MS);
    return stopPhaseTimer;
  }, [isLoading, phaseMode, stopPhaseTimer]);

  const startNewSession = useCallback(() => {
    runIdRef.current += 1;
    setCurrentSessionId(null);
    setMessages([]);
    setIsSendError(false);
    setSendErrorDetail("");
    setIsReplyStreaming(false);
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    runIdRef.current += 1;
    setIsReplyStreaming(false);
    setIsSendError(false);
    setSendErrorDetail("");
    setCurrentSessionId(sessionId);
    try {
      const data = await api.get<HistoryRow[]>(
        `/api/chat/history?session_id=${encodeURIComponent(sessionId)}&limit=50`,
      );
      const mapped = data
        .map(mapHistoryRow)
        .filter((m): m is Message => m !== null);
      setMessages(mapped);
    } catch {
      setMessages([]);
    }
  }, []);

  const sendMessage = useCallback(
    async (text: string, options?: SendMessageOptions) => {
      const trimmed = text.trim();
      if (!trimmed || sendLockRef.current) return;
      const runId = ++runIdRef.current;
      sendLockRef.current = true;

      setIsSendError(false);
      setSendErrorDetail("");
      setPhaseMode(options?.complexityHigh ? "complex" : "normal");
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed, isOptimistic: true },
      ]);
      setIsLoading(true);

      try {
        const body: { message: string; session_id?: string } = {
          message: trimmed,
        };
        if (currentSessionId) {
          body.session_id = currentSessionId;
        }

        const data = await api.post<ChatPostResponse>("/api/chat", body);
        if (runIdRef.current !== runId) return;

        setCurrentSessionId(data.session_id);
        setMessages((prev) => {
          const cleared = prev.map((m) =>
            m.isOptimistic ? { ...m, isOptimistic: false } : m,
          );
          return [
            ...cleared,
            {
              role: "assistant",
              content: "",
              tool_calls_made:
                data.tool_calls_made?.length ? data.tool_calls_made : undefined,
              created_at: new Date().toISOString(),
              isStreaming: true,
            },
          ];
        });

        setIsLoading(false);
        setIsReplyStreaming(true);

        const fullText = data.response ?? "";
        const tokens = tokenizeForStream(fullText);
        let rendered = "";
        for (let i = 0; i < tokens.length; i++) {
          if (runIdRef.current !== runId) return;
          if (i >= STREAM_FAST_FORWARD_AFTER) {
            rendered = fullText;
            setMessages((prev) => {
              if (!prev.length) return prev;
              const next = [...prev];
              const last = next[next.length - 1];
              if (last.role === "assistant" && last.isStreaming) {
                next[next.length - 1] = { ...last, content: rendered };
              }
              return next;
            });
            break;
          }
          rendered += tokens[i] ?? "";
          setMessages((prev) => {
            if (!prev.length) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === "assistant" && last.isStreaming) {
              next[next.length - 1] = { ...last, content: rendered };
            }
            return next;
          });
          await sleep(STREAM_TOKEN_DELAY_MS);
        }

        if (runIdRef.current === runId) {
          setMessages((prev) => {
            if (!prev.length) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            if (last.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                content: fullText,
                isStreaming: false,
              };
            }
            return next;
          });
        }

        await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      } catch (err) {
        const detail = formatSendFailureDetail(err);
        console.error("[useChat] POST /api/chat fehlgeschlagen:", err, detail);
        setMessages((prev) => prev.filter((m) => !m.isOptimistic));
        setSendErrorDetail(detail);
        setIsSendError(true);
      } finally {
        sendLockRef.current = false;
        stopPhaseTimer();
        setIsLoading(false);
        setIsReplyStreaming(false);
      }
    },
    [currentSessionId, queryClient, stopPhaseTimer],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await api.delete<{ deleted: boolean }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (sessionId === currentSessionId) {
        startNewSession();
      }
    },
    [currentSessionId, queryClient, startNewSession],
  );

  return {
    sessions: sessionsQuery.data ?? [],
    sessionsLoading: sessionsQuery.isPending,
    currentSessionId,
    messages,
    isLoading,
    isBusy: isLoading || isReplyStreaming,
    phaseLabel,
    isSendError,
    sendErrorDetail,
    sendMessage,
    startNewSession,
    selectSession,
    deleteSession,
  };
}
