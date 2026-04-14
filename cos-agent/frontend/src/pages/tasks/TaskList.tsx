import { useQuery } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  PromptEngineerPanel,
  type PromptTaskType,
} from "../../components/PromptEngineerPanel.tsx";
import { api } from "../../lib/api.ts";
import {
  type SubmitTaskParams,
  type TaskDto,
  useTaskQueue,
} from "../../hooks/useTaskQueue.ts";
import { relativeTime } from "../../lib/time.ts";

type Tab = "pending" | "running" | "completed" | "failed";

type DocumentRow = {
  id: string;
  name: string;
  document_type: string;
  summary: string | null;
};

function priorityRank(p: string): number {
  const o: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return o[p] ?? 9;
}

function priorityLabel(p: string): string {
  const m: Record<string, string> = {
    urgent: "URGENT",
    high: "HIGH",
    medium: "MEDIUM",
    low: "LOW",
  };
  return m[p] ?? p.toUpperCase();
}

function queuePositionFor(task: TaskDto, all: TaskDto[]): number {
  const pending = all.filter((t) => t.status === "pending");
  const sorted = [...pending].sort((a, b) => {
    const ra = priorityRank(a.priority);
    const rb = priorityRank(b.priority);
    if (ra !== rb) return ra - rb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  const i = sorted.findIndex((t) => t.id === task.id);
  return i < 0 ? 0 : i + 1;
}

function durationMs(t: TaskDto): number | null {
  if (!t.started_at || !t.completed_at) return null;
  const a = new Date(t.started_at).getTime();
  const b = new Date(t.completed_at).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

export function TaskListPage() {
  const {
    tasks,
    isLoading,
    submitTask,
    cancelTask,
  } = useTaskQueue();
  const [tab, setTab] = useState<Tab>("pending");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<SubmitTaskParams["priority"]>("medium");
  const [context, setContext] = useState("");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [docModal, setDocModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptEngineerOpen, setPromptEngineerOpen] = useState(false);
  const [taskPromptType, setTaskPromptType] = useState<PromptTaskType>("research");

  const docsQ = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.get<DocumentRow[]>("/api/documents"),
    enabled: docModal,
  });

  const filtered = useMemo(() => {
    return tasks.filter((t) => t.status === tab);
  }, [tasks, tab]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const ti = title.trim();
    const de = description.trim();
    if (!ti || !de) {
      setError("Titel und Beschreibung sind Pflicht.");
      return;
    }
    setSubmitting(true);
    try {
      const ctxTrim = context.trim();
      await submitTask({
        title: ti,
        description: de,
        priority,
        context: ctxTrim || undefined,
        document_ids: documentIds.length ? documentIds : undefined,
      });
      setTitle("");
      setDescription("");
      setContext("");
      setDocumentIds([]);
      showToast("Task eingereicht — du wirst per Email benachrichtigt");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleDoc(id: string) {
    setDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const docNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docsQ.data ?? []) m.set(d.id, d.name);
    return m;
  }, [docsQ.data]);

  return (
    <div style={{ display: "flex", gap: "1.5rem", alignItems: "flex-start" }}>
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "1.25rem",
            right: "1.25rem",
            zIndex: 50,
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-soft)",
            border: "1px solid var(--border)",
            maxWidth: 360,
            fontSize: "0.9rem",
          }}
        >
          {toast}
        </div>
      )}

      <section
        style={{
          width: 400,
          flexShrink: 0,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "1rem",
          background: "var(--surface)",
        }}
      >
        <h2 className="co-font-display" style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
          + Neuer Task
        </h2>
        <form onSubmit={onSubmit}>
          <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
            Titel
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            style={{
              width: "100%",
              marginBottom: "0.75rem",
              padding: "0.45rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.25rem",
            }}
          >
            <label style={{ fontSize: "0.85rem", margin: 0 }}>Beschreibung</label>
            <button
              type="button"
              onClick={() => setPromptEngineerOpen((o) => !o)}
              style={{
                fontSize: "0.78rem",
                padding: "0.2rem 0.45rem",
                borderRadius: 6,
                border: promptEngineerOpen ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: promptEngineerOpen ? "var(--accent-soft)" : "transparent",
                cursor: "pointer",
                color: "var(--text)",
              }}
            >
              ✨ Prompt optimieren
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            rows={5}
            style={{
              width: "100%",
              marginBottom: "0.35rem",
              padding: "0.45rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              resize: "vertical",
            }}
          />
          <label
            style={{
              display: "block",
              fontSize: "0.78rem",
              color: "var(--muted)",
              marginBottom: "0.5rem",
            }}
          >
            Aufgabe-Typ (optional, Prompt-Engineer)
            <select
              value={taskPromptType}
              onChange={(e) => setTaskPromptType(e.target.value as PromptTaskType)}
              style={{
                display: "block",
                width: "100%",
                marginTop: "0.2rem",
                padding: "0.3rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
              }}
            >
              <option value="research">Recherche</option>
              <option value="analysis">Analyse</option>
              <option value="draft">Entwurf</option>
              <option value="decision">Entscheidung</option>
            </select>
          </label>
          {promptEngineerOpen && (
            <div style={{ marginBottom: "0.75rem" }}>
              <PromptEngineerPanel
                initialText={description}
                taskType={taskPromptType}
                onApply={(optimizedPrompt, searchQueries) => {
                  setDescription(optimizedPrompt);
                  const peBlock = [
                    `[prompt_engineer task_type:${taskPromptType}]`,
                    searchQueries.length
                      ? `[Suchanfragen]\n${searchQueries.join("\n")}`
                      : "[Suchanfragen] (keine aktiv)",
                  ].join("\n\n");
                  setContext((c) => {
                    const t = c.trim();
                    return t ? `${t}\n\n${peBlock}` : peBlock;
                  });
                  setPromptEngineerOpen(false);
                }}
                onCancel={() => setPromptEngineerOpen(false)}
              />
            </div>
          )}
          <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
            Priorität
          </label>
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as SubmitTaskParams["priority"])}
            style={{
              width: "100%",
              marginBottom: "0.75rem",
              padding: "0.45rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            <option value="urgent">🔴 Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.85rem", marginBottom: "0.35rem" }}>
              Dokumente anhängen (optional)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {documentIds.map((id) => (
                <span
                  key={id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    padding: "0.2rem 0.45rem",
                    borderRadius: 6,
                    background: "var(--accent-soft)",
                    fontSize: "0.8rem",
                  }}
                >
                  {docNameById.get(id) ?? id.slice(0, 8)}
                  <button
                    type="button"
                    aria-label="Entfernen"
                    onClick={() => setDocumentIds((p) => p.filter((x) => x !== id))}
                    style={{
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => setDocModal(true)}
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: 6,
                  border: "1px dashed var(--border)",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                }}
              >
                + Dokument
              </button>
            </div>
          </div>

          <label style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
            Kontext (optional)
          </label>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              marginBottom: "0.75rem",
              padding: "0.45rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              resize: "vertical",
            }}
          />

          {error && (
            <div style={{ color: "crimson", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: "100%",
              padding: "0.55rem",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-foreground)",
              fontWeight: 600,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            Task einreichen →
          </button>
        </form>
      </section>

      <section style={{ flex: 1, minWidth: 0 }}>
        <h1 className="co-font-display" style={{ margin: "0 0 1rem", fontSize: "1.35rem" }}>
          Task-Queue
        </h1>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {(
            [
              ["pending", "Ausstehend"],
              ["running", "Läuft"],
              ["completed", "Abgeschlossen"],
              ["failed", "Fehlgeschlagen"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                padding: "0.35rem 0.65rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: tab === k ? "var(--accent-soft)" : "var(--surface)",
                cursor: "pointer",
                fontWeight: tab === k ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading && <p style={{ color: "var(--muted)" }}>Laden…</p>}

        {!isLoading && filtered.length === 0 && (
          <p style={{ color: "var(--muted)" }}>Keine Tasks in dieser Ansicht.</p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {filtered.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              tab={tab}
              allTasks={tasks}
              onCancel={() => void cancelTask(t.id)}
              onRetry={async () => {
                try {
                  await submitTask({
                    title: t.title,
                    description: t.description,
                    priority: t.priority as SubmitTaskParams["priority"],
                    context: t.context ?? undefined,
                  });
                  showToast("Task erneut eingereicht");
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          ))}
        </div>
      </section>

      {docModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
          onClick={() => setDocModal(false)}
          onKeyDown={(e) => e.key === "Escape" && setDocModal(false)}
          role="presentation"
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-md)",
              maxWidth: 480,
              width: "100%",
              maxHeight: "70vh",
              overflow: "auto",
              padding: "1rem",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="doc-modal-title"
          >
            <h3 id="doc-modal-title" style={{ marginTop: 0 }}>
              Dokument wählen
            </h3>
            {docsQ.isLoading && <p>Laden…</p>}
            {(docsQ.data ?? []).map((d) => (
              <label
                key={d.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.35rem 0",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={documentIds.includes(d.id)}
                  onChange={() => toggleDoc(d.id)}
                />
                <span>{d.name}</span>
              </label>
            ))}
            <button
              type="button"
              onClick={() => setDocModal(false)}
              style={{ marginTop: "0.75rem" }}
            >
              Fertig
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard(props: {
  task: TaskDto;
  tab: Tab;
  allTasks: TaskDto[];
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { task, tab, allTasks, onCancel, onRetry } = props;
  const pos = queuePositionFor(task, allTasks);
  const dur = durationMs(task);

  const pulseKeyframes = `
    @keyframes co-task-pulse {
      0% { opacity: 0.35; }
      50% { opacity: 1; }
      100% { opacity: 0.35; }
    }
  `;

  return (
    <article
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "0.85rem 1rem",
        background: "var(--surface)",
      }}
    >
      {tab === "pending" && (
        <>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            {priorityLabel(task.priority)}
          </div>
          <div style={{ fontWeight: 600, margin: "0.25rem 0" }}>{task.title}</div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Eingereicht {relativeTime(new Date(task.created_at))}
          </div>
          {pos > 0 && (
            <div style={{ fontSize: "0.85rem", marginTop: "0.25rem" }}>
              Position in Queue: #{pos}
            </div>
          )}
          <div style={{ textAlign: "right", marginTop: "0.5rem" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: "0.35rem 0.65rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              Abbrechen
            </button>
          </div>
        </>
      )}

      {tab === "running" && (
        <>
          <style>{pulseKeyframes}</style>
          <div style={{ fontSize: "0.75rem", color: "var(--accent)" }}>⚡ LÄUFT GERADE</div>
          <div style={{ fontWeight: 600, margin: "0.25rem 0" }}>{task.title}</div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Gestartet{" "}
            {task.started_at ? relativeTime(new Date(task.started_at)) : "—"}
          </div>
          <div
            style={{
              marginTop: "0.5rem",
              height: 6,
              borderRadius: 4,
              background:
                "linear-gradient(90deg, var(--accent-soft), var(--accent))",
              animation: "co-task-pulse 1.4s ease-in-out infinite",
            }}
          />
        </>
      )}

      {tab === "completed" && (
        <>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            ✓ ABGESCHLOSSEN
            {task.completed_at ? ` · ${relativeTime(new Date(task.completed_at))}` : ""}
          </div>
          <div style={{ fontWeight: 600, margin: "0.25rem 0" }}>{task.title}</div>
          {dur !== null && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Dauer: {Math.round(dur / 1000)} Sekunden
            </div>
          )}
          <div style={{ textAlign: "right", marginTop: "0.5rem" }}>
            <Link
              to={`/tasks/${encodeURIComponent(task.id)}`}
              style={{ fontWeight: 600 }}
            >
              Ergebnis ansehen
            </Link>
          </div>
        </>
      )}

      {tab === "failed" && (
        <>
          <div style={{ fontSize: "0.75rem", color: "crimson" }}>✗ FEHLGESCHLAGEN</div>
          <div style={{ fontWeight: 600, margin: "0.25rem 0" }}>{task.title}</div>
          <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Fehler: {task.error_message ?? "Unbekannt"}
          </div>
          <div style={{ textAlign: "right", marginTop: "0.5rem" }}>
            <button
              type="button"
              onClick={onRetry}
              style={{
                padding: "0.35rem 0.65rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              Erneut versuchen
            </button>
          </div>
        </>
      )}
    </article>
  );
}
