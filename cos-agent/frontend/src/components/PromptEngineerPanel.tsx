import { useCallback, useEffect, useState } from "react";
import type { OptimizedPrompt } from "../hooks/usePromptEngineer.ts";
import { usePromptEngineer } from "../hooks/usePromptEngineer.ts";

export type PromptTaskType = "research" | "analysis" | "draft" | "decision";

const MAX_QUERIES = 5;

export interface PromptEngineerPanelProps {
  initialText: string;
  taskType: PromptTaskType;
  /** Chat: schlankes Layout ohne Task-Typ-Dropdown */
  compact?: boolean;
  onApply: (optimizedPrompt: string, searchQueries: string[]) => void;
  onCancel: () => void;
}

function modelLine(model: OptimizedPrompt["recommended_model"]): string {
  if (model === "haiku") return "🟢 Haiku (schnell, günstig)";
  if (model === "opus") return "🔴 Opus (komplex, teurer)";
  return "🟡 Sonnet (ausgewogen)";
}

function complexityLabel(c: OptimizedPrompt["estimated_complexity"]): string {
  if (c === "low") return "Niedrig";
  if (c === "high") return "Hoch";
  return "Mittel";
}

export function PromptEngineerPanel({
  initialText,
  taskType: initialTaskType,
  compact = false,
  onApply,
  onCancel,
}: PromptEngineerPanelProps) {
  const { optimize, isLoading, error } = usePromptEngineer();
  const [raw, setRaw] = useState(initialText);
  const [taskType, setTaskType] = useState<PromptTaskType>(initialTaskType);
  const [phase, setPhase] = useState<"idle" | "loading" | "optimized" | "error">("idle");
  const [opt, setOpt] = useState<OptimizedPrompt | null>(null);
  const [editedUserPrompt, setEditedUserPrompt] = useState("");
  const [queries, setQueries] = useState<{ text: string; on: boolean }[]>([]);
  const [newQuery, setNewQuery] = useState("");

  useEffect(() => {
    setRaw(initialText);
  }, [initialText]);

  useEffect(() => {
    setTaskType(initialTaskType);
  }, [initialTaskType]);

  const runOptimize = useCallback(async () => {
    const t = raw.trim();
    if (t.length < 10) {
      setPhase("error");
      return;
    }
    setPhase("loading");
    try {
      const out = await optimize(t, taskType);
      setOpt(out);
      setEditedUserPrompt(out.user_prompt);
      const qs = out.search_queries.slice(0, MAX_QUERIES).map((text) => ({
        text,
        on: true,
      }));
      setQueries(qs);
      setPhase("optimized");
    } catch {
      setPhase("error");
    }
  }, [optimize, raw, taskType]);

  function toggleQuery(i: number) {
    setQueries((prev) =>
      prev.map((q, j) => (j === i ? { ...q, on: !q.on } : q)),
    );
  }

  function addQuery() {
    const t = newQuery.trim();
    if (!t) return;
    if (queries.length >= MAX_QUERIES) return;
    setQueries((prev) => [...prev, { text: t, on: true }]);
    setNewQuery("");
  }

  function apply() {
    const active = queries.filter((q) => q.on).map((q) => q.text);
    onApply(editedUserPrompt.trim(), active);
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "1rem",
        background: "var(--surface)",
        marginTop: compact ? 0 : "0.5rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <strong>✨ Prompt optimieren</strong>
        {compact && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: "1.1rem",
              color: "var(--muted)",
            }}
            aria-label="Schließen"
          >
            ×
          </button>
        )}
      </div>

      {!compact && (
        <>
          <div style={{ fontSize: "0.82rem", marginBottom: "0.25rem" }}>
            Original-Anfrage
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              marginBottom: "0.65rem",
              padding: "0.45rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              resize: "vertical",
            }}
          />
          <label style={{ display: "block", fontSize: "0.82rem", marginBottom: "0.35rem" }}>
            Task-Typ
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as PromptTaskType)}
              style={{
                display: "block",
                width: "100%",
                marginTop: "0.2rem",
                padding: "0.4rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
              }}
            >
              <option value="research">Research</option>
              <option value="analysis">Analyse</option>
              <option value="draft">Entwurf</option>
              <option value="decision">Entscheidung</option>
            </select>
          </label>
        </>
      )}

      {compact && phase === "idle" && (
        <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: "0 0 0.5rem" }}>
          Optimiert deine aktuelle Eingabe (min. 10 Zeichen im Chatfeld).
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.75rem" }}>
        <button
          type="button"
          disabled={isLoading || raw.trim().length < 10}
          onClick={() => void runOptimize()}
          style={{
            padding: "0.45rem 0.85rem",
            borderRadius: 6,
            border: "none",
            background: "var(--co-btn-primary-bg)",
            color: "var(--co-btn-primary-fg)",
            fontWeight: 600,
            cursor: isLoading ? "wait" : "pointer",
          }}
        >
          {compact ? "Optimieren →" : "Optimieren →"}
        </button>
      </div>

      {phase === "loading" && (
        <p style={{ fontSize: "0.9rem", color: "var(--muted)" }}>Optimiere Prompt…</p>
      )}

      {phase === "error" && (
        <div style={{ marginBottom: "0.5rem" }}>
          <p style={{ color: "var(--danger)", fontSize: "0.88rem", margin: "0 0 0.35rem" }}>
            {raw.trim().length < 10
              ? "Bitte mindestens 10 Zeichen eingeben."
              : error ?? "Optimierung fehlgeschlagen."}
          </p>
          <button
            type="button"
            onClick={() => void runOptimize()}
            style={{ fontSize: "0.85rem" }}
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {phase === "optimized" && opt && (
        <>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: "0.75rem",
              marginTop: "0.25rem",
            }}
          >
            {!compact && (
              <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                Nach Optimierung
              </div>
            )}
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.88rem" }}>
              {compact
                ? `${modelLine(opt.recommended_model)} · ${complexityLabel(opt.estimated_complexity)}`
                : (
                  <>
                    Empfohlenes Modell: {modelLine(opt.recommended_model)}
                    <br />
                    Komplexität: {complexityLabel(opt.estimated_complexity)}
                  </>
                )}
            </p>
            <div style={{ fontSize: "0.82rem", marginBottom: "0.25rem" }}>
              Optimierter Prompt
            </div>
            <textarea
              value={editedUserPrompt}
              onChange={(e) => setEditedUserPrompt(e.target.value)}
              rows={compact ? 5 : 8}
              style={{
                width: "100%",
                marginBottom: "0.65rem",
                padding: "0.45rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                resize: "vertical",
              }}
            />

            <div style={{ fontSize: "0.82rem", marginBottom: "0.25rem" }}>
              Suchanfragen (für Web Search, max. {MAX_QUERIES})
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 0.5rem" }}>
              {queries.map((q, i) => (
                <li
                  key={`${q.text}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.35rem",
                    marginBottom: "0.25rem",
                    fontSize: "0.88rem",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={q.on}
                    onChange={() => toggleQuery(i)}
                    style={{ marginTop: 3 }}
                  />
                  <span>{q.text}</span>
                </li>
              ))}
            </ul>
            {queries.length < MAX_QUERIES && (
              <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.75rem" }}>
                <input
                  value={newQuery}
                  onChange={(e) => setNewQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addQuery();
                    }
                  }}
                  placeholder="Eigene Suchanfrage"
                  style={{
                    flex: 1,
                    padding: "0.35rem",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                  }}
                />
                <button type="button" onClick={addQuery}>
                  +
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "0.5rem",
          marginTop: "0.5rem",
        }}
      >
        <button type="button" onClick={onCancel}>
          Abbrechen
        </button>
        {phase === "optimized" && (
          <button
            type="button"
            onClick={apply}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: 6,
              border: "none",
              background: "var(--co-btn-primary-bg)",
              color: "var(--co-btn-primary-fg)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {compact ? "In Chat übernehmen" : "Optimierten Prompt nutzen"}
          </button>
        )}
      </div>
    </div>
  );
}
