import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Session } from "../../hooks/useChat.ts";
import type { BrainProject } from "../../hooks/useBrain.ts";
import { relativeTime } from "../../lib/time.ts";
import { ChatTasksTab } from "./ChatTasksTab.tsx";

function previewShort(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type SidebarTab = "chat" | "projects" | "tasks";

type ChatSidebarProps = {
  sessions: Session[];
  sessionsLoading: boolean;
  currentSessionId: string | null;
  projects: BrainProject[];
  selectedProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onStartNewSession: (projectId?: string | null) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

export function ChatSidebar({
  sessions,
  sessionsLoading,
  currentSessionId,
  projects,
  selectedProjectId,
  onSelectProject,
  onStartNewSession,
  onSelectSession,
  onDeleteSession,
}: ChatSidebarProps) {
  const [tab, setTab] = useState<SidebarTab>("chat");
  const [hoverSessionId, setHoverSessionId] = useState<string | null>(null);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  const visibleSessions = useMemo(() => {
    if (tab !== "projects" || !filterProjectId) return sessions;
    return sessions.filter((s) => s.project_id === filterProjectId);
  }, [sessions, tab, filterProjectId]);

  const tabBtn = (id: SidebarTab, label: string, testId: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-testid={testId}
      onClick={() => setTab(id)}
      style={{
        flex: 1,
        padding: "0.4rem 0.35rem",
        border: "none",
        borderBottom: tab === id ? "2px solid hsl(var(--ds-color-yellow-accent))" : "2px solid transparent",
        background: "transparent",
        fontWeight: tab === id ? 600 : 500,
        fontSize: "0.78rem",
        color: tab === id ? "var(--ink)" : "var(--muted)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <aside
      data-testid="chat-sidebar"
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
      <div
        role="tablist"
        aria-label="Chat-Sidebar"
        style={{
          display: "flex",
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {tabBtn("chat", "Chat", "chat-sidebar-tab-chat")}
        {tabBtn("projects", "Projekte", "chat-sidebar-tab-projects")}
        {tabBtn("tasks", "Tasks", "chat-sidebar-tab-tasks")}
      </div>

      {tab !== "tasks" && (
        <div style={{ padding: "0.65rem", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => onStartNewSession(tab === "projects" ? filterProjectId : selectedProjectId)}
            style={{
              width: "100%",
              padding: "0.5rem 0.65rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              fontWeight: 600,
            }}
          >
            {tab === "projects" && filterProjectId
              ? "Neuer Projekt-Chat"
              : "Neue Konversation"}
          </button>
          {tab === "chat" && (
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
          )}
        </div>
      )}

      {tab === "projects" && (
        <div className="co-scroll-pane" style={{ padding: "0 0.5rem 0.5rem", maxHeight: 180 }}>
          {projects.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: "0.35rem" }}>
              Noch keine Projekte.{" "}
              <Link to="/knowledge" style={{ color: "var(--link)" }}>
                Anlegen
              </Link>
            </p>
          ) : (
            projects.map((p) => {
              const active = filterProjectId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`chat-sidebar-project-${p.id}`}
                  onClick={() => {
                    setFilterProjectId(p.id);
                    onSelectProject(p.id);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "0.4rem 0.5rem",
                    marginBottom: 4,
                    borderRadius: 6,
                    border: active ? "1px solid var(--border)" : "1px solid transparent",
                    background: active ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                    fontSize: "0.82rem",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: p.color,
                      marginRight: 6,
                    }}
                  />
                  {p.name}
                </button>
              );
            })
          )}
          {filterProjectId && (
            <Link
              to={`/brain/${filterProjectId}`}
              style={{
                display: "block",
                fontSize: "0.78rem",
                color: "var(--link)",
                padding: "0.25rem 0.5rem",
              }}
            >
              Projekt verwalten →
            </Link>
          )}
        </div>
      )}

      {tab === "tasks" ? (
        <div className="co-scroll-pane" style={{ flex: 1 }}>
          <ChatTasksTab />
        </div>
      ) : (
        <div className="co-scroll-pane" style={{ flex: 1, padding: "0 0.5rem 0.65rem" }}>
          {sessionsLoading && visibleSessions.length === 0 ? (
            <p style={{ margin: "0.5rem 0.35rem", color: "var(--muted)", fontSize: "0.88rem" }}>
              Laden…
            </p>
          ) : visibleSessions.length === 0 ? (
            <p style={{ margin: "0.5rem 0.35rem", color: "var(--muted)", fontSize: "0.88rem" }}>
              Noch keine Konversationen
            </p>
          ) : (
            visibleSessions.map((s) => {
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
                    onClick={() => onSelectSession(s.session_id)}
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
                      {s.project_name ? (
                        <span
                          data-testid={`session-project-badge-${s.session_id}`}
                          style={{
                            marginLeft: 6,
                            padding: "0.05rem 0.35rem",
                            borderRadius: 999,
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {s.project_name}
                        </span>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    title="Konversation löschen"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.session_id);
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
      )}
    </aside>
  );
}
