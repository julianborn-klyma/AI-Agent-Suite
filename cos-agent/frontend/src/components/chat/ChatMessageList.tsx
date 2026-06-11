import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Message } from "../../hooks/useChat.ts";

function toolPillLabel(raw: string): string {
  const cleaned = raw.replace(/_/g, " ").trim();
  if (!cleaned) return raw;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

type ChatMessageListProps = {
  messages: Message[];
  isLoading: boolean;
  phaseLabel: string;
  showEmptyWelcome: boolean;
  userName: string;
  isBusy: boolean;
  suggestions: string[];
  onSuggestion: (text: string) => void;
};

export function ChatMessageList({
  messages,
  isLoading,
  phaseLabel,
  showEmptyWelcome,
  userName,
  isBusy,
  suggestions,
  onSuggestion,
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  return (
    <>
      <div className="co-scroll-pane" style={{ flex: 1, padding: "1rem" }}>
        {showEmptyWelcome ? (
          <div
            style={{
              height: "100%",
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
              Guten Morgen, {userName} 👋
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
                  onClick={() => onSuggestion(s)}
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
            flexShrink: 0,
          }}
          className="chat-phase-label"
          data-testid="chat-phase-label"
        >
          {phaseLabel || "Am Nachdenken …"}
        </div>
      )}
    </>
  );
}
