import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api.ts";
import type { TaskDto } from "../../hooks/useTaskQueue.ts";

function durationLabel(t: TaskDto): string | null {
  if (!t.started_at || !t.completed_at) return null;
  const a = new Date(t.started_at).getTime();
  const b = new Date(t.completed_at).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const s = Math.max(0, Math.round((b - a) / 1000));
  return `${s}s`;
}

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = id ?? "";

  const q = useQuery({
    queryKey: ["cos-task", taskId],
    queryFn: () => api.get<TaskDto>(`/api/tasks/${encodeURIComponent(taskId)}`),
    enabled: Boolean(taskId),
  });

  const chatDraft = useMemo(() => {
    const t = q.data;
    if (!t?.title) return "";
    const r = (t.result ?? "").replace(/\s+/g, " ").trim();
    const snippet = r.length > 500 ? `${r.slice(0, 500)}…` : r;
    return `Ich möchte mehr über den Task '${t.title}' sprechen. Ergebnis: ${snippet}`;
  }, [q.data]);

  if (!taskId) {
    return <p>Ungültige Task-ID.</p>;
  }

  if (q.isLoading) return <p>Laden…</p>;
  if (q.isError || !q.data) {
    return (
      <div>
        <p>Task nicht gefunden oder keine Berechtigung.</p>
        <Link to="/tasks">Zurück zur Queue</Link>
      </div>
    );
  }

  const t = q.data;
  const dur = durationLabel(t);

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ marginTop: 0 }}>
        <Link to="/tasks">← Zurück zur Queue</Link>
      </p>
      <h1 className="co-font-display" style={{ fontSize: "1.35rem", marginBottom: "0.35rem" }}>
        {t.title}
      </h1>
      <div style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "1rem" }}>
        {t.priority.toUpperCase()} · {t.status}
        {dur ? ` · ${dur}` : ""}
      </div>

      <section style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Beschreibung</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>
      </section>

      <hr style={{ border: "none", borderTop: "1px solid var(--border)" }} />

      <section style={{ marginTop: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem" }}>Ergebnis</h2>
        {t.result ? (
          <div className="markdown-body">
            <ReactMarkdown>{t.result}</ReactMarkdown>
          </div>
        ) : (
          <p style={{ color: "var(--muted)" }}>Noch kein Ergebnis.</p>
        )}
      </section>

      <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "1.25rem 0" }} />

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem", fontSize: "0.9rem" }}>
        {t.result_notion_page_id && (
          <li>📋 In Notion gespeichert ({t.result_notion_page_id})</li>
        )}
        <li>📧 Per Email gesendet (wenn E-Mail-Service konfiguriert)</li>
      </ul>

      <button
        type="button"
        onClick={() =>
          navigate("/chat", {
            state: { taskQueueDraft: chatDraft },
          })}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--co-btn-primary-bg)",
          color: "var(--co-btn-primary-fg)",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Als Chat öffnen →
      </button>
    </div>
  );
}
