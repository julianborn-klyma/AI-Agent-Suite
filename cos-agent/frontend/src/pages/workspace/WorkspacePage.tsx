import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isLoggedIn } from "../../lib/auth.ts";
import {
  useCreateWorkspaceProject,
  useCreateWorkspaceTeam,
  useCreateWorkspaceWorkTask,
  usePatchWorkspaceWorkTask,
  useWorkspaceProjects,
  useWorkspaceTeams,
  useWorkspaceUsers,
  useWorkspaceWorkTasks,
} from "../../hooks/useWorkspace.ts";

const STATUSES = ["open", "in_progress", "done", "cancelled"] as const;

export function WorkspacePage() {
  const logged = isLoggedIn();
  const projectsQ = useWorkspaceProjects(logged);
  const teamsQ = useWorkspaceTeams(logged);
  const usersQ = useWorkspaceUsers(logged);
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  /** Alle Status vom Server laden; Filter in der Liste clientseitig, Board gruppiert. */
  const tasksQ = useWorkspaceWorkTasks(logged, projectFilter || null, null);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");

  const createProj = useCreateWorkspaceProject();
  const createTeam = useCreateWorkspaceTeam();
  const createTask = useCreateWorkspaceWorkTask();
  const patchTask = usePatchWorkspaceWorkTask();

  const [projModal, setProjModal] = useState(false);
  const [projName, setProjName] = useState("");
  const [teamModal, setTeamModal] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [taskModal, setTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskStatus, setTaskStatus] = useState<string>("open");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskAssignees, setTaskAssignees] = useState<Set<string>>(new Set());
  const [taskTeams, setTaskTeams] = useState<Set<string>>(new Set());

  const projects = projectsQ.data ?? [];
  const allTasks = tasksQ.data ?? [];
  const listRows = useMemo(() => {
    if (!statusFilter) return allTasks;
    return allTasks.filter((t) => t.status === statusFilter);
  }, [allTasks, statusFilter]);

  const defaultProjectId = useMemo(
    () => projects[0]?.id ?? "",
    [projects],
  );

  function openTaskModal() {
    setTaskTitle("");
    setTaskDesc("");
    setTaskStatus("open");
    setTaskAssignees(new Set());
    setTaskTeams(new Set());
    setTaskProjectId(projectFilter || defaultProjectId);
    setTaskModal(true);
  }

  return (
    <div
      data-testid="workspace-root"
      style={{ padding: "1.25rem", maxWidth: 1100, margin: "0 auto" }}
    >
      <h1 className="co-font-display" style={{ fontSize: "1.35rem", marginBottom: "0.35rem" }}>
        Arbeit — Projekte &amp; Tasks
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: "1.25rem", fontSize: "0.9rem" }}>
        Interne Aufgaben im Tenant (Schema <code>app</code>). Unabhängig von der Task-Queue
        (Hintergrundjobs).
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          data-testid="workspace-open-project-modal"
          onClick={() => {
            setProjName("");
            setProjModal(true);
          }}
          style={btnStyle}
        >
          Neues Projekt
        </button>
        <button
          type="button"
          data-testid="workspace-open-team-modal"
          onClick={() => {
            setTeamName("");
            setTeamModal(true);
          }}
          style={btnStyle}
        >
          Neues Team
        </button>
        <button
          type="button"
          data-testid="workspace-open-task-modal"
          onClick={openTaskModal}
          disabled={!projects.length}
          style={{ ...btnStyle, opacity: projects.length ? 1 : 0.5 }}
        >
          Neuer Task
        </button>
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: 6,
            overflow: "hidden",
          }}
          role="group"
          aria-label="Ansicht"
        >
          <button
            type="button"
            data-testid="workspace-view-list"
            onClick={() => setViewMode("list")}
            style={{
              ...btnStyle,
              border: "none",
              borderRadius: 0,
              background: viewMode === "list" ? "var(--accent-soft)" : "var(--surface)",
              fontWeight: viewMode === "list" ? 600 : 500,
            }}
          >
            Liste
          </button>
          <button
            type="button"
            data-testid="workspace-view-board"
            onClick={() => setViewMode("board")}
            style={{
              ...btnStyle,
              border: "none",
              borderRadius: 0,
              borderLeft: "1px solid var(--border)",
              background: viewMode === "board" ? "var(--accent-soft)" : "var(--surface)",
              fontWeight: viewMode === "board" ? 600 : 500,
            }}
          >
            Board
          </button>
        </div>
        <label style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--muted)" }}>
          Projektfilter{" "}
          <select
            data-testid="workspace-project-filter"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">Alle</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {viewMode === "list" && (
          <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Status{" "}
            <select
              data-testid="workspace-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="">Alle</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {(projectsQ.isError || tasksQ.isError) && (
        <div style={{ color: "crimson", marginBottom: "1rem" }}>
          {projectsQ.error?.message ?? tasksQ.error?.message ?? "Fehler beim Laden"}
        </div>
      )}

      {tasksQ.isPending && <div style={{ color: "var(--muted)" }}>Laden…</div>}

      {viewMode === "list" && (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table
            data-testid="workspace-task-table"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}
          >
            <thead>
              <tr style={{ background: "var(--sidebar)", textAlign: "left" }}>
                <th style={thStyle}>Titel</th>
                <th style={thStyle}>Projekt</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Prio</th>
                <th style={thStyle}>Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((t) => (
                <tr key={t.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={tdStyle}>
                    <Link
                      to={`/workspace/work-tasks/${t.id}`}
                      data-testid={`workspace-task-title-link-${t.id}`}
                      style={{ color: "var(--link)", fontWeight: 500, textDecoration: "none" }}
                    >
                      {t.title}
                    </Link>
                  </td>
                  <td style={tdStyle}>{t.project_name}</td>
                  <td style={tdStyle}>{t.status}</td>
                  <td style={tdStyle}>{t.priority}</td>
                  <td style={tdStyle}>
                    {new Date(t.updated_at).toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))}
              {!tasksQ.isPending && allTasks.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, color: "var(--muted)" }}>
                    Noch keine Tasks — lege ein Projekt und einen Task an.
                  </td>
                </tr>
              )}
              {!tasksQ.isPending && allTasks.length > 0 && listRows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...tdStyle, color: "var(--muted)" }}>
                    Keine Tasks für den gewählten Statusfilter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === "board" && !tasksQ.isPending && (
        <div
          data-testid="workspace-task-board"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "0.75rem",
            alignItems: "start",
          }}
        >
          {STATUSES.map((col) => (
            <div
              key={col}
              data-testid={`workspace-board-col-${col}`}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.65rem",
                background: "var(--sidebar)",
                minHeight: 120,
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "0.78rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                  color: "var(--muted)",
                  marginBottom: "0.5rem",
                }}
              >
                {col.replace("_", " ")}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {allTasks.filter((t) => t.status === col).map((t) => (
                  <div
                    key={t.id}
                    data-testid={`workspace-board-card-${t.id}`}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "0.5rem 0.55rem",
                      background: "var(--surface)",
                      fontSize: "0.88rem",
                    }}
                  >
                    <Link
                      to={`/workspace/work-tasks/${t.id}`}
                      data-testid={`workspace-board-title-link-${t.id}`}
                      style={{
                        color: "var(--link)",
                        fontWeight: 600,
                        textDecoration: "none",
                        display: "block",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {t.title}
                    </Link>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
                      {t.project_name} · {t.priority}
                    </div>
                    <label style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                      Status{" "}
                      <select
                        data-testid={`workspace-board-status-${t.id}`}
                        value={t.status}
                        disabled={patchTask.isPending}
                        onChange={(e) => {
                          void patchTask.mutateAsync({
                            id: t.id,
                            patch: { status: e.target.value },
                          });
                        }}
                        style={{
                          ...selectStyle,
                          marginLeft: 0,
                          fontSize: "0.8rem",
                          maxWidth: "100%",
                        }}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {projModal && (
        <Modal title="Neues Projekt" onClose={() => setProjModal(false)}>
          <label style={labelStyle}>
            Name
            <input
              data-testid="workspace-new-project-name"
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button
            type="button"
            data-testid="workspace-new-project-submit"
            disabled={createProj.isPending || !projName.trim()}
            onClick={async () => {
              await createProj.mutateAsync({ name: projName.trim(), description: null });
              setProjModal(false);
            }}
            style={{ ...btnStyle, marginTop: "0.75rem" }}
          >
            Anlegen
          </button>
        </Modal>
      )}

      {teamModal && (
        <Modal title="Neues Team" onClose={() => setTeamModal(false)}>
          <label style={labelStyle}>
            Name
            <input
              data-testid="workspace-new-team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button
            type="button"
            data-testid="workspace-new-team-submit"
            disabled={createTeam.isPending || !teamName.trim()}
            onClick={async () => {
              await createTeam.mutateAsync({ name: teamName.trim() });
              setTeamModal(false);
            }}
            style={{ ...btnStyle, marginTop: "0.75rem" }}
          >
            Anlegen
          </button>
        </Modal>
      )}

      {taskModal && (
        <Modal title="Neuer Task" onClose={() => setTaskModal(false)}>
          <label style={labelStyle}>
            Titel
            <input
              data-testid="workspace-new-task-title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Projekt
            <select
              data-testid="workspace-new-task-project"
              value={taskProjectId}
              onChange={(e) => setTaskProjectId(e.target.value)}
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
              value={taskStatus}
              onChange={(e) => setTaskStatus(e.target.value)}
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
            Beschreibung (optional)
            <textarea
              value={taskDesc}
              onChange={(e) => setTaskDesc(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem" }}>
            <legend style={{ fontSize: "0.8rem" }}>Assignees</legend>
            <div style={{ maxHeight: 120, overflowY: "auto" }}>
              {(usersQ.data ?? []).map((u) => (
                <label key={u.id} style={{ display: "block", fontSize: "0.85rem" }}>
                  <input
                    type="checkbox"
                    checked={taskAssignees.has(u.id)}
                    onChange={() => {
                      setTaskAssignees((prev) => {
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
            <div style={{ maxHeight: 120, overflowY: "auto" }}>
              {(teamsQ.data ?? []).map((tm) => (
                <label key={tm.id} style={{ display: "block", fontSize: "0.85rem" }}>
                  <input
                    type="checkbox"
                    checked={taskTeams.has(tm.id)}
                    onChange={() => {
                      setTaskTeams((prev) => {
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
          <button
            type="button"
            data-testid="workspace-new-task-submit"
            disabled={createTask.isPending || !taskTitle.trim() || !taskProjectId}
            onClick={async () => {
              await createTask.mutateAsync({
                project_id: taskProjectId,
                title: taskTitle.trim(),
                description: taskDesc.trim() || null,
                status: taskStatus,
                assignee_user_ids: [...taskAssignees],
                team_ids: [...taskTeams],
              });
              setTaskModal(false);
            }}
            style={{ ...btnStyle, marginTop: "0.75rem" }}
          >
            Task anlegen
          </button>
        </Modal>
      )}
    </div>
  );
}

function Modal(props: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      role="presentation"
      onClick={props.onClose}
    >
      <div
        role="dialog"
        style={{
          background: "var(--surface)",
          borderRadius: 10,
          padding: "1.25rem",
          minWidth: 320,
          maxWidth: "min(520px, 92vw)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>{props.title}</h2>
        {props.children}
        <button type="button" onClick={props.onClose} style={{ ...btnStyle, marginTop: "0.5rem" }}>
          Schließen
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

const selectStyle: CSSProperties = {
  marginLeft: "0.35rem",
  padding: "0.35rem 0.5rem",
  borderRadius: 6,
  border: "1px solid var(--border)",
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

const thStyle: CSSProperties = {
  padding: "0.5rem 0.65rem",
  fontWeight: 600,
  fontSize: "0.78rem",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "var(--muted)",
};

const tdStyle: CSSProperties = {
  padding: "0.55rem 0.65rem",
  verticalAlign: "top",
};
