import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { PromptEngineerPanel } from "../components/PromptEngineerPanel.tsx";
import { useAuth } from "../hooks/useAuth.ts";
import { useChat } from "../hooks/useChat.ts";
import { api } from "../lib/api.ts";
import { relativeTime } from "../lib/time.ts";

function previewShort(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

const DAILY_CHECKIN_PROMPT = `## Tages-Check-in

Kurz in eigenen Worten:
- Was steht heute an, was du mir mitteilen willst?
- Welche Entscheidung oder Priorität ist neu?
- Gibt es etwas, das ich mir für dein persönliches Wiki merken soll?

(Dann **Senden** — Learnings werden wie im normalen Chat extrahiert.)`;

function toolPillLabel(raw: string): string {
  const cleaned = raw.replace(/_/g, " ").trim();
  if (!cleaned) return raw;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function ChatPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const {
    sessions,
    sessionsLoading,
    currentSessionId,
    messages,
    isLoading,
    isBusy,
    phaseLabel,
    isSendError,
    sendErrorDetail,
    sendMessage,
    startNewSession,
    selectSession,
    deleteSession,
  } = useChat();

  const [input, setInput] = useState("");
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [pePanelKey, setPePanelKey] = useState(0);
  const [complexityHigh, setComplexityHigh] = useState(false);
  const [hoverSessionId, setHoverSessionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const st = location.state as
      | { taskQueueDraft?: string; chatDraft?: string }
      | null;
    const draft = (typeof st?.chatDraft === "string" && st.chatDraft.trim()
      ? st.chatDraft
      : st?.taskQueueDraft) ?? "";
    if (typeof draft === "string" && draft.trim()) {
      setInput(draft);
    }
  }, [location.state]);

  useEffect(() => {
    if (searchParams.get("daily_checkin") !== "1") return;
    setInput((prev) => (prev.trim() ? prev : DAILY_CHECKIN_PROMPT));
  }, [searchParams]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineH = 22;
    const maxH = lineH * 5;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [input]);

  useEffect(() => {
    const t = input.trim();
    if (!t) {
      setComplexityHigh(false);
      return;
    }
    const id = window.setTimeout(async () => {
      try {
        const r = await api.post<{ complexity: string }>(
          "/api/prompt-engineer/classify",
          { message: t },
        );
        setComplexityHigh(r.complexity === "high");
      } catch {
        setComplexityHigh(false);
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [input]);

  const showEmptyWelcome =
    currentSessionId === null && messages.length === 0;

  async function handleSend() {
    const t = input.trim();
    if (!t || isBusy) return;
    setInput("");
    await sendMessage(t, { complexityHigh });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const timeLabel = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const suggestions = [
    "Was sind meine Aufgaben für heute?",
    "Zeig mir meine wichtigsten Emails",
    "Briefing für heute",
  ];

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 5.5rem)",
        minHeight: 360,
        margin: "-0.25rem -0.25rem 0",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      {/* Linke Spalte */}
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--sidebar)",
          minHeight: 0,
        }}
      >
        <div style={{ padding: "0.65rem", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => startNewSession()}
            style={{
              width: "100%",
              padding: "0.5rem 0.65rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              fontWeight: 600,
            }}
          >
            Neue Konversation
          </button>
          <Link
            to="/chat?daily_checkin=1"
            data-testid="chat-daily-checkin-link"
            style={{
              display: "block",
              marginTop: "0.45rem",
              padding: "0.45rem 0.5rem",
              fontSize: "0.82rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              color: "var(--text)",
              textDecoration: "none",
              textAlign: "center",
            }}
          >
            Daily Check-in
          </Link>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 0.5rem 0.65rem",
          }}
        >
          {sessionsLoading && sessions.length === 0 ? (
            <p
              style={{
                margin: "0.5rem 0.35rem",
                color: "var(--muted)",
                fontSize: "0.88rem",
              }}
            >
              Laden…
            </p>
          ) : sessions.length === 0 ? (
            <p
              style={{
                margin: "0.5rem 0.35rem",
                color: "var(--muted)",
                fontSize: "0.88rem",
              }}
            >
              Noch keine Konversationen
            </p>
          ) : (
            sessions.map((s) => {
              const active = s.session_id === currentSessionId;
              return (
                <div
                  key={s.session_id}
                  onMouseEnter={() => setHoverSessionId(s.session_id)}
                  onMouseLeave={() => setHoverSessionId(null)}
                  style={{
                    position: "relative",
                    marginBottom: 4,
                    borderRadius: 6,
                    borderLeft: active
                      ? "3px solid hsl(var(--ds-color-yellow-accent))"
                      : "3px solid transparent",
                    background: active ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void selectSession(s.session_id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "0.45rem 1.75rem 0.45rem 0.5rem",
                      border: "none",
                      borderRadius: 6,
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      color: "var(--text)",
                    }}
                  >
                    <div style={{ fontWeight: active ? 600 : 400 }}>
                      {previewShort(s.preview || "(leer)")}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                      {relativeTime(s.last_activity)} · {s.message_count} Msg
                    </div>
                  </button>
                  <button
                    type="button"
                    title="Konversation löschen"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteSession(s.session_id);
                    }}
                    style={{
                      position: "absolute",
                      right: 4,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 26,
                      height: 26,
                      padding: 0,
                      border: "none",
                      borderRadius: 4,
                      background:
                        hoverSessionId === s.session_id
                          ? "rgba(0,0,0,0.06)"
                          : "transparent",
                      color: "var(--muted)",
                      cursor: "pointer",
                      opacity: hoverSessionId === s.session_id ? 1 : 0,
                      transition: "opacity 0.12s",
                      fontSize: "1rem",
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div
          style={{
            flexShrink: 0,
            marginTop: "auto",
            padding: "0.65rem",
            borderTop: "1px solid var(--border)",
            fontSize: "0.78rem",
            color: "var(--muted)",
            lineHeight: 1.4,
          }}
        >
          <Link to="/settings" style={{ color: "var(--link)", fontWeight: 600 }}>
            Einstellungen
          </Link>
          <span>
            {" "}
            → Google &amp; Notion unter{" "}
            <Link to="/settings#verbindungen" style={{ color: "var(--link)", fontWeight: 600 }}>
              Verbindungen
            </Link>
          </span>
        </div>
      </aside>

      {/* Rechte Spalte */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <header
          style={{
            flexShrink: 0,
            padding: "0.65rem 1rem",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "1rem",
          }}
        >
          <span
            className="co-font-display"
            style={{ fontWeight: 700, fontSize: "1.05rem" }}
          >
            Chief of Staff
          </span>
          <time
            dateTime={now.toISOString()}
            style={{ color: "var(--muted)", fontSize: "0.9rem", fontVariantNumeric: "tabular-nums" }}
          >
            {timeLabel}
          </time>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {showEmptyWelcome ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "1rem",
              }}
            >
              <p
                className="co-font-display"
                style={{ margin: "0 0 0.35rem", fontSize: "1.15rem" }}
              >
                Guten Morgen, {user?.name ?? "…"} 👋
              </p>
              <p style={{ margin: "0 0 1.25rem", color: "var(--muted)" }}>
                Womit kann ich dir heute helfen?
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  width: "100%",
                  maxWidth: 420,
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isBusy}
                    onClick={() => void sendMessage(s)}
                    style={{
                      padding: "0.55rem 0.75rem",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--bg)",
                      textAlign: "left",
                      fontSize: "0.9rem",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.85rem",
                flex: 1,
              }}
            >
              {messages.map((m, i) => (
                <div
                  key={`${m.role}-${i}-${m.created_at ?? ""}-${m.content.slice(0, 12)}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: m.role === "user" ? "flex-end" : "flex-start",
                    opacity: m.isOptimistic ? 0.6 : 1,
                  }}
                >
                  {m.role === "user" ? (
                    <div
                      style={{
                        maxWidth: "85%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: 12,
                        background: "var(--accent-soft)",
                        color: "var(--ink)",
                        border: "1px solid hsl(var(--ds-color-yellow-accent) / 0.28)",
                        fontSize: "0.92rem",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {m.content}
                    </div>
                  ) : (
                    <div
                      style={{
                        maxWidth: "92%",
                        fontSize: "0.92rem",
                        color: "var(--text)",
                      }}
                    >
                      {m.isStreaming ? (
                        <div
                          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                          data-testid="chat-assistant-streaming"
                        >
                          {m.content}
                          <span className="chat-stream-caret" aria-hidden>
                            |
                          </span>
                        </div>
                      ) : (
                        <div className="chat-md">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      )}
                      {m.tool_calls_made && m.tool_calls_made.length > 0 && (
                        <div
                          data-testid="chat-tool-pills"
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.35rem",
                            marginTop: "0.45rem",
                          }}
                        >
                          {m.tool_calls_made.map((t) => (
                            <span
                              key={t}
                              data-testid={`chat-tool-pill-${t}`}
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.15rem 0.45rem",
                                borderRadius: 999,
                                background: "var(--bg)",
                                border: "1px solid var(--border)",
                                color: "var(--muted)",
                              }}
                            >
                              ✓ {toolPillLabel(t)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} style={{ height: 1 }} />
            </div>
          )}
        </div>

        {isLoading && (
          <div
            style={{
              padding: "0 1rem 0.35rem",
              display: "flex",
              alignItems: "center",
              minHeight: 20,
            }}
            className="chat-phase-label"
            data-testid="chat-phase-label"
          >
            {phaseLabel || "Am Nachdenken …"}
          </div>
        )}

        <div
          style={{
            flexShrink: 0,
            padding: "0.65rem 1rem",
            borderTop: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          {complexityHigh && (
            <button
              type="button"
              onClick={() => {
                setPePanelKey((k) => k + 1);
                setPromptModalOpen(true);
              }}
              style={{
                display: "block",
                marginBottom: "0.35rem",
                padding: "0.25rem 0.5rem",
                fontSize: "0.72rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--muted)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              ✨ Komplex — Prompt optimieren empfohlen
            </button>
          )}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
            <textarea
              ref={textareaRef}
              data-testid="chat-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Nachricht… (Enter senden, Shift+Enter Zeilenumbruch)"
              disabled={isBusy}
              style={{
                flex: 1,
                minHeight: 40,
                maxHeight: 110,
                resize: "none",
                padding: "0.5rem 0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
                lineHeight: 1.4,
              }}
            />
            <button
              type="button"
              title="Prompt optimieren"
              onClick={() => {
                setPePanelKey((k) => k + 1);
                setPromptModalOpen(true);
              }}
              disabled={isBusy}
              style={{
                padding: "0.55rem 0.65rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--surface)",
                alignSelf: "flex-end",
                cursor: isBusy ? "not-allowed" : "pointer",
                fontSize: "1rem",
              }}
            >
              ✨
            </button>
            <button
              data-testid="chat-send"
              type="button"
              disabled={isBusy || !input.trim()}
              onClick={() => void handleSend()}
              style={{
                padding: "0.55rem 1rem",
                border: "none",
                borderRadius: 8,
                background:
                  isBusy || !input.trim() ? "var(--muted)" : "var(--co-btn-primary-bg)",
                color:
                  isBusy || !input.trim()
                    ? "var(--surface)"
                    : "var(--co-btn-primary-fg)",
                fontWeight: 600,
                alignSelf: "flex-end",
              }}
            >
              Senden
            </button>
          </div>
          {isSendError && (
            <div style={{ margin: "0.45rem 0 0" }}>
              <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.85rem" }}>
                Senden fehlgeschlagen. Bitte erneut versuchen.
              </p>
              {sendErrorDetail ? (
                <pre
                  style={{
                    margin: "0.35rem 0 0",
                    padding: "0.45rem 0.5rem",
                    fontSize: "0.75rem",
                    color: "var(--text)",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 120,
                    overflow: "auto",
                  }}
                >
                  {sendErrorDetail}
                </pre>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {promptModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPromptModalOpen(false);
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--surface)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              padding: "1rem",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <PromptEngineerPanel
              key={pePanelKey}
              compact
              initialText={input}
              taskType="research"
              onApply={(optimized) => {
                setInput(optimized);
                setPromptModalOpen(false);
              }}
              onCancel={() => setPromptModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
