import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useDocumentQA } from "../../hooks/useDocumentQA.ts";
import { api } from "../../lib/api.ts";

type ChunkMeta = {
  chunk_index: number;
  page_number: number | null;
  section_title: string | null;
  token_count: number | null;
};

type DocumentDetail = {
  id: string;
  name: string;
  document_type: string;
  summary: string | null;
  processed: boolean;
  created_at: string;
  chunks: ChunkMeta[];
};

const TYPE_LABEL: Record<string, string> = {
  business_plan: "Businessplan",
  meeting_summary: "Meeting-Protokoll",
  financial_report: "Finanzbericht",
  other: "Sonstiges",
};

export function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const documentId = id ?? "";
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);

  const q = useQuery({
    queryKey: ["document", documentId],
    queryFn: () =>
      api.get<DocumentDetail>(`/api/documents/${encodeURIComponent(documentId)}`),
    enabled: documentId.length > 0,
  });

  const {
    messages,
    isLoading,
    askQuestion,
    verification,
    runVerification,
    clearVerification,
  } = useDocumentQA(documentId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (verification) setVerifyOpen(true);
  }, [verification]);

  const sectionTitles = Array.from(
    new Set(
      (q.data?.chunks ?? [])
        .map((c) => c.section_title)
        .filter((t): t is string => Boolean(t && t.trim())),
    ),
  );

  async function handleVerify() {
    await runVerification();
  }

  async function handleSend() {
    const t = input.trim();
    if (!t || isLoading) return;
    setInput("");
    await askQuestion(t);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!documentId) {
    return <p>Kein Dokument ausgewählt.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 5.5rem)" }}>
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to="/documents" style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          ← Zur Liste
        </Link>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "1rem" }}>
        <aside
          style={{
            width: 300,
            flexShrink: 0,
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "1rem",
            background: "var(--surface)",
            overflow: "auto",
          }}
        >
          {q.isLoading && <p style={{ color: "var(--muted)" }}>Lade…</p>}
          {q.isError && <p>Fehler beim Laden.</p>}
          {q.data && (
            <>
              <h1
                className="co-font-display"
                style={{ fontSize: "1.05rem", margin: "0 0 0.5rem" }}
              >
                {q.data.name}
              </h1>
              <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
                <div>{TYPE_LABEL[q.data.document_type] ?? q.data.document_type}</div>
                <div>
                  {new Date(q.data.created_at).toLocaleString("de-DE", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </div>
                <div style={{ marginTop: "0.35rem" }}>
                  {q.data.processed ? "Verarbeitet" : "Ausstehend"}
                </div>
              </div>
              {sectionTitles.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--muted)",
                      marginBottom: "0.35rem",
                    }}
                  >
                    Abschnitte
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem" }}>
                    {sectionTitles.map((t) => (
                      <li key={t} style={{ marginBottom: "0.25rem" }}>
                        {t}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void handleVerify()}
                style={{
                  marginTop: "1rem",
                  width: "100%",
                  padding: "0.45rem",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--accent-soft)",
                  cursor: isLoading ? "wait" : "pointer",
                  fontWeight: 600,
                }}
              >
                Dokument prüfen
              </button>
            </>
          )}
        </aside>

        <section
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid var(--border)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            background: "var(--surface)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "0.65rem 1rem",
              borderBottom: "1px solid var(--border)",
              fontWeight: 600,
            }}
          >
            Dokument befragen
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            {messages.length === 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {[
                  "Fasse die wichtigsten Finanzzahlen zusammen",
                  "Welche Annahmen sind kritisch?",
                  "Gibt es Widersprüche im Dokument?",
                  "Was sind die größten Risiken?",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isLoading}
                    onClick={() => void askQuestion(s)}
                    style={{
                      fontSize: "0.8rem",
                      padding: "0.35rem 0.6rem",
                      borderRadius: 999,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      cursor: isLoading ? "wait" : "pointer",
                      textAlign: "left",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  padding: "0.55rem 0.75rem",
                  borderRadius: 10,
                  background: m.role === "user" ? "var(--accent-soft)" : "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              >
                {m.role === "assistant" ? (
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                ) : (
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                )}
                {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.75rem",
                      color: "var(--muted)",
                      borderTop: "1px solid var(--border)",
                      paddingTop: "0.45rem",
                    }}
                  >
                    {m.sources.map((s) => (
                      <div key={`${s.chunk_index}-${s.excerpt.slice(0, 8)}`} style={{ marginBottom: "0.35rem" }}>
                        <div>
                          📎 Chunk {s.chunk_index}
                          {s.page_number != null ? ` · Seite ${s.page_number}` : ""}
                          {s.section_title ? ` · „${s.section_title}“` : ""}
                        </div>
                        <div style={{ fontStyle: "italic", marginTop: "0.15rem" }}>
                          {(s.excerpt ?? "").slice(0, 100)}
                          {(s.excerpt ?? "").length > 100 ? "…" : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isLoading && messages.length > 0 && (
              <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Antwort wird geladen…</div>
            )}
            <div ref={bottomRef} />
          </div>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              padding: "0.65rem",
              borderTop: "1px solid var(--border)",
              alignItems: "flex-end",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Frage zum Dokument…"
              disabled={isLoading}
              rows={2}
              style={{
                flex: 1,
                resize: "none",
                borderRadius: 8,
                border: "1px solid var(--border)",
                padding: "0.45rem 0.6rem",
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              disabled={isLoading || !input.trim()}
              onClick={() => void handleSend()}
              style={{
                padding: "0.5rem 0.85rem",
                borderRadius: 8,
                border: "none",
                background: "var(--co-btn-primary-bg)",
                color: "var(--co-btn-primary-fg)",
                fontWeight: 600,
                cursor: isLoading ? "wait" : "pointer",
              }}
            >
              Senden
            </button>
          </div>
        </section>
      </div>

      {verifyOpen && verification && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: "1rem",
          }}
          onClick={() => {
            setVerifyOpen(false);
            clearVerification();
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: 10,
              padding: "1.25rem",
              maxWidth: 520,
              width: "100%",
              maxHeight: "85vh",
              overflow: "auto",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="co-font-display" style={{ marginTop: 0, fontSize: "1.1rem" }}>
              Prüfergebnis
            </h2>
            <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>✅ Gefundene Abschnitte</p>
            <ul style={{ marginTop: 0 }}>
              {verification.sections_found.map((s) => (
                <li key={s}>{s}</li>
              ))}
              {verification.sections_found.length === 0 && <li>—</li>}
            </ul>
            <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>⚠️ Fehlende Abschnitte</p>
            <ul style={{ marginTop: 0 }}>
              {verification.missing_sections.map((s) => (
                <li key={s}>{s}</li>
              ))}
              {verification.missing_sections.length === 0 && <li>—</li>}
            </ul>
            <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>🔴 Widersprüche</p>
            <ul style={{ marginTop: 0 }}>
              {verification.contradictions.map((c, i) => (
                <li key={i}>{c.description}</li>
              ))}
              {verification.contradictions.length === 0 && <li>—</li>}
            </ul>
            <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>💡 Kritische Annahmen</p>
            <ul style={{ marginTop: 0 }}>
              {verification.critical_assumptions.map((s) => (
                <li key={s}>{s}</li>
              ))}
              {verification.critical_assumptions.length === 0 && <li>—</li>}
            </ul>
            <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>📋 Gesamteinschätzung</p>
            <p style={{ marginTop: 0 }}>{verification.overall_assessment || "—"}</p>
            <button
              type="button"
              onClick={() => {
                setVerifyOpen(false);
                clearVerification();
              }}
              style={{
                marginTop: "0.75rem",
                padding: "0.4rem 0.85rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
