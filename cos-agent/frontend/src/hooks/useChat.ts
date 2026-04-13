import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
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

export function useChat(): {
  sessions: Session[];
  sessionsLoading: boolean;
  currentSessionId: string | null;
  messages: Message[];
  isLoading: boolean;
  isSendError: boolean;
  /** Kurztext zu letztem Sendefehler (ApiError / Netzwerk), leer wenn keiner. */
  sendErrorDetail: string;
  sendMessage: (text: string) => Promise<void>;
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
  const [isSendError, setIsSendError] = useState(false);
  const [sendErrorDetail, setSendErrorDetail] = useState("");
  const sendLockRef = useRef(false);

  const startNewSession = useCallback(() => {
    setCurrentSessionId(null);
    setMessages([]);
    setIsSendError(false);
    setSendErrorDetail("");
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
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
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendLockRef.current) return;
      sendLockRef.current = true;

      setIsSendError(false);
      setSendErrorDetail("");
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

        setCurrentSessionId(data.session_id);
        setMessages((prev) => {
          const cleared = prev.map((m) =>
            m.isOptimistic ? { ...m, isOptimistic: false } : m,
          );
          return [
            ...cleared,
            {
              role: "assistant",
              content: data.response,
              tool_calls_made:
                data.tool_calls_made?.length ? data.tool_calls_made : undefined,
              created_at: new Date().toISOString(),
            },
          ];
        });

        await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      } catch (err) {
        const detail = formatSendFailureDetail(err);
        console.error("[useChat] POST /api/chat fehlgeschlagen:", err, detail);
        setMessages((prev) => prev.filter((m) => !m.isOptimistic));
        setSendErrorDetail(detail);
        setIsSendError(true);
      } finally {
        sendLockRef.current = false;
        setIsLoading(false);
      }
    },
    [currentSessionId, queryClient],
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
    isSendError,
    sendErrorDetail,
    sendMessage,
    startNewSession,
    selectSession,
    deleteSession,
  };
}
