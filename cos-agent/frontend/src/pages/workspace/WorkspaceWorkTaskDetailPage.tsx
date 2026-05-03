import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isLoggedIn } from "../../lib/auth.ts";
import {
  useDeleteWorkspaceWorkTask,
  usePatchWorkspaceWorkTask,
  useWorkspaceProjects,
  useWorkspaceTeams,
  useWorkspaceUsers,
  useWorkspaceWorkTask,
} from "../../hooks/useWorkspace.ts";

const STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function WorkspaceWorkTaskDetailPage() {
  const { id: taskId = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const logged = isLoggedIn();
  const taskQ = useWorkspaceWorkTask(logged, taskId);
  const projectsQ = useWorkspaceProjects(logged);
  const teamsQ = useWorkspaceTeams(logged);
  const usersQ = useWorkspaceUsers(logged);
  const patchTask = usePatchWorkspaceWorkTask();
  const deleteTask = useDeleteWorkspaceWorkTask();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<string>("open");
  const [priority, setPriority] = useState<string>("medium");
  const [dueLocal, setDueLocal] = useState("");
  const [assignees, setAssignees] = useState<Set<string>>(new Set());
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = taskQ.data;
    if (!t) return;
    setTitle(t.title);
    setDescription(t.description ?? "");
    setProjectId(t.project_id);
    setStatus(t.status);
    setPriority(t.priority);
    setDueLocal(isoToDatetimeLocal(t.due_at));
    setAssignees(new Set(t.assignee_user_ids));
    setTeamIds(new Set(t.team_ids));
  }, [taskQ.data]);

  const projects = projectsQ.data ?? [];

  async function handleSave() {
    const due_at = dueLocal.trim() === ""
      ? null
      : new Date(dueLocal).toISOString();
    await patchTask.mutateAsync({
      id: taskId,
      patch: {
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        project_id: projectId,
        status,
        priority,
        due_at,
        assignee_user_ids: [...assignees],
        team_ids: [...teamIds],
      },
    });
  }

  if (!taskId) {
    return <p>Keine Task-ID.</p>;
  }

  if (taskQ.isPending) {
    return (
      <div data-testid="workspace-task-detail-root" style={{ padding: "1.25rem" }}>
        <p style={{ color: "var(--muted)" }}>Laden…</p>
      </div>
    );
  }

  if (taskQ.isError) {
    return (
      <div data-testid="workspace-task-detail-root" style={{ padding: "1.25rem" }}>
        <p style={{ color: "crimson" }}>{taskQ.error.message}</p>
        <Link to="/workspace" data-testid="workspace-task-detail-back" style={{ color: "var(--link)" }}>
          Zurück zur Übersicht
        </Link>
      </div>
    );
  }

  return (
    <div
      data-testid="workspace-task-detail-root"
      style={{ padding: "1.25rem", maxWidth: 640, margin: "0 auto" }}
    >
      <div style={{ marginBottom: "1rem" }}>
        <Link
          to="/workspace"
          data-testid="workspace-task-detail-back"
          style={{ color: "var(--link)", fontSize: "0.9rem" }}
        >
          ← Arbeit (Übersicht)
        </Link>
      </div>
      <h1 className="co-font-display" style={{ fontSize: "1.25rem", marginBottom: "0.25rem" }}>
        Interner Task
      </h1>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
        Projekt: <strong>{taskQ.data?.project_name}</strong>
      </p>

      <label style={labelStyle}>
        Titel
        <input
          data-testid="workspace-task-detail-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Projekt
        <select
          data-testid="workspace-task-detail-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          style={inputStyle}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Status
        <select
          data-testid="workspace-task-detail-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={inputStyle}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Priorität
        <select
          data-testid="workspace-task-detail-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          style={inputStyle}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Fällig (optional)
        <input
          type="datetime-local"
          data-testid="workspace-task-detail-due"
          value={dueLocal}
          onChange={(e) => setDueLocal(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Beschreibung
        <textarea
          data-testid="workspace-task-detail-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </label>
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem" }}>
        <legend style={{ fontSize: "0.8rem" }}>Assignees</legend>
        <div style={{ maxHeight: 140, overflowY: "auto" }}>
          {(usersQ.data ?? []).map((u) => (
            <label key={u.id} style={{ display: "block", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={assignees.has(u.id)}
                onChange={() => {
                  setAssignees((prev) => {
                    const n = new Set(prev);
                    if (n.has(u.id)) n.delete(u.id);
                    else n.add(u.id);
                    return n;
                  });
                }}
              />{" "}
              {u.name}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.5rem",
          marginTop: "0.5rem",
        }}
      >
        <legend style={{ fontSize: "0.8rem" }}>Teams</legend>
        <div style={{ maxHeight: 140, overflowY: "auto" }}>
          {(teamsQ.data ?? []).map((tm) => (
            <label key={tm.id} style={{ display: "block", fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                checked={teamIds.has(tm.id)}
                onChange={() => {
                  setTeamIds((prev) => {
                    const n = new Set(prev);
                    if (n.has(tm.id)) n.delete(tm.id);
                    else n.add(tm.id);
                    return n;
                  });
                }}
              />{" "}
              {tm.name}
            </label>
          ))}
        </div>
      </fieldset>

      {patchTask.isError && (
        <p style={{ color: "crimson", marginTop: "0.75rem", fontSize: "0.9rem" }}>
          {patchTask.error.message}
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "1rem" }}>
        <button
          type="button"
          data-testid="workspace-task-detail-save"
          disabled={patchTask.isPending || deleteTask.isPending || !title.trim() || !projectId}
          onClick={() => void handleSave()}
          style={btnStyle}
        >
          Speichern
        </button>
        <button
          type="button"
          data-testid="workspace-task-detail-delete"
          disabled={patchTask.isPending || deleteTask.isPending}
          onClick={() => {
            if (!confirm("Task wirklich löschen?")) return;
            void deleteTask.mutateAsync(taskId).then(() => {
              navigate("/workspace");
            });
          }}
          style={{ ...btnStyle, borderColor: "crimson", color: "crimson" }}
        >
          Löschen
        </button>
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  padding: "0.45rem 0.75rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: "0.25rem",
  padding: "0.45rem 0.55rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: "0.65rem",
  fontSize: "0.85rem",
};
