import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { fetchTasksList, TASKS_QUERY_KEY } from "../hooks/useTaskQueue.ts";
import { isLoggedIn } from "../lib/auth.ts";
import { AgentStructureInfoModal } from "./AgentStructureInfoModal.tsx";
import { useAuth } from "../hooks/useAuth.ts";
import { logout } from "../lib/auth.ts";

const navLinkStyle = ({
  isActive,
}: {
  isActive: boolean;
}): CSSProperties => ({
  display: "block",
  padding: "0.5rem 0.75rem",
  borderRadius: "var(--radius-sm)",
  color: isActive ? "var(--ink)" : "var(--text)",
  fontWeight: isActive ? 600 : 500,
  textDecoration: "none",
  background: isActive ? "var(--accent-soft)" : "transparent",
});

export function Layout() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [agentInfoOpen, setAgentInfoOpen] = useState(false);
  const tasksQ = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: fetchTasksList,
    enabled: isLoggedIn(),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d?.length) return false;
      return d.some((t) => t.status === "pending" || t.status === "running")
        ? 10_000
        : false;
    },
  });
  const pendingBadge = (tasksQ.data ?? []).filter((t) => t.status === "pending").length;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--bg)",
      }}
    >
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          background: "var(--sidebar)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "1rem 0.75rem",
        }}
      >
        <div
          className="co-font-display"
          style={{
            fontSize: "1.05rem",
            padding: "0 0.75rem 1rem",
            borderBottom: "1px solid var(--border)",
            marginBottom: "0.75rem",
          }}
        >
          cos-agent
        </div>
        <nav
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              margin: "0 0 0.35rem",
              padding: "0 0.75rem",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--muted)",
            }}
          >
            Konto & Dienste
          </div>
          <NavLink to="/settings" style={navLinkStyle} end>
            Einstellungen
          </NavLink>
          <NavLink to="/settings/connections" style={navLinkStyle}>
            Verbindungen
          </NavLink>
          <NavLink to="/settings/password" style={navLinkStyle}>
            Passwort
          </NavLink>
          <NavLink to="/settings/schedules" style={navLinkStyle}>
            Jobs &amp; Automation
          </NavLink>
          <NavLink to="/settings/learnings" style={navLinkStyle}>
            Was weiß der Agent?
          </NavLink>
          <NavLink to="/settings/email-style" style={navLinkStyle}>
            Mein Schreibstil
          </NavLink>
          <div
            style={{
              margin: "0.75rem 0 0.35rem",
              padding: "0 0.75rem",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--muted)",
            }}
          >
            Chat
          </div>
          <NavLink to="/chat" style={navLinkStyle} end>
            Chat
          </NavLink>
          <NavLink to="/tasks" style={navLinkStyle}>
            Task-Queue
            {pendingBadge > 0 ? ` (${pendingBadge})` : ""}
          </NavLink>
          <NavLink to="/workspace" style={navLinkStyle}>
            Arbeit (Tasks)
          </NavLink>
          <NavLink to="/workspace/wiki" style={navLinkStyle}>
            Wiki
          </NavLink>
          <div
            style={{
              margin: "0.75rem 0 0.35rem",
              padding: "0 0.75rem",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--muted)",
            }}
          >
            Dokumente
          </div>
          <NavLink to="/documents" style={navLinkStyle}>
            Übersicht
          </NavLink>
          {isAdmin && (
            <>
              <div
                style={{
                  margin: "0.75rem 0 0.35rem",
                  padding: "0 0.75rem",
                  fontSize: "0.7rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--muted)",
                }}
              >
                Admin
              </div>
              <NavLink to="/admin/users" style={navLinkStyle}>
                Users
              </NavLink>
              <NavLink to="/admin/configs" style={navLinkStyle}>
                Configs
              </NavLink>
              <NavLink to="/admin/schedules" style={navLinkStyle}>
                Schedules
              </NavLink>
              <NavLink to="/admin/costs" style={navLinkStyle}>
                Costs
              </NavLink>
            </>
          )}
        </nav>
        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: "0.75rem",
            fontSize: "0.85rem",
          }}
        >
          <div style={{ fontWeight: 600 }}>{user?.name ?? "…"}</div>
          <div style={{ color: "var(--muted)", wordBreak: "break-all" }}>
            {user?.email ?? ""}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            style={{
              marginTop: "0.5rem",
              width: "100%",
              padding: "0.4rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
            }}
          >
            Abmelden
          </button>
          {isSuperAdmin && (
            <div
              style={{
                marginTop: "0.85rem",
                borderTop: "1px solid var(--border)",
                paddingTop: "0.55rem",
              }}
            >
              <NavLink
                to="/superadmin/tenants"
                style={{
                  display: "block",
                  fontSize: "0.72rem",
                  letterSpacing: "0.04em",
                  color: "var(--muted)",
                  textDecoration: "none",
                  padding: "0.15rem 0",
                }}
              >
                ⚡ Super Admin
              </NavLink>
            </div>
          )}
        </div>
      </aside>
      <main
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--layout-main-padding)",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          position: "relative",
        }}
      >
        <button
          type="button"
          data-testid="agent-structure-info-button"
          aria-label="Info: Agenten-Struktur"
          title="Agenten-Struktur"
          onClick={() => setAgentInfoOpen(true)}
          style={{
            position: "absolute",
            top: "0.85rem",
            right: "0.85rem",
            zIndex: 2,
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "0.95rem",
            lineHeight: 1,
          }}
        >
          i
        </button>
        <AgentStructureInfoModal open={agentInfoOpen} onClose={() => setAgentInfoOpen(false)} />
        <div style={{ flex: 1, minHeight: 0, paddingRight: "2.75rem" }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
