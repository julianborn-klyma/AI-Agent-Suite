import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";
import { fetchTasksList, TASKS_QUERY_KEY } from "../hooks/useTaskQueue.ts";
import { isLoggedIn, logout } from "../lib/auth.ts";

type RailItem = {
  to: string;
  label: string;
  icon: string;
  testId: string;
  end?: boolean;
  badge?: number;
  adminOnly?: boolean;
};

const railLinkStyle = ({
  isActive,
}: {
  isActive: boolean;
}): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: 10,
  textDecoration: "none",
  color: isActive ? "var(--ink)" : "var(--muted)",
  background: isActive ? "var(--accent-soft)" : "transparent",
  border: isActive
    ? "1px solid hsl(var(--ds-color-yellow-accent) / 0.35)"
    : "1px solid transparent",
  fontSize: "1.15rem",
  position: "relative",
});

export function IconRail() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const showWiki = user?.tenant_ui_show_tenant_wiki === true;

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

  const items: RailItem[] = [
    { to: "/chat", label: "Chat", icon: "💬", testId: "rail-chat", end: true },
    {
      to: showWiki ? "/knowledge" : "/knowledge",
      label: "Projekte",
      icon: "🧠",
      testId: "rail-knowledge",
    },
    { to: "/documents", label: "Dokumente", icon: "📄", testId: "rail-documents" },
    {
      to: "/tasks",
      label: "Task-Queue",
      icon: "⏳",
      testId: "rail-tasks",
      badge: pendingBadge,
    },
  ];

  if (isAdmin) {
    items.push({
      to: "/admin",
      label: "Admin",
      icon: "⚙️",
      testId: "rail-admin",
      adminOnly: true,
    });
  }

  const initials = (user?.name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside
      className="co-icon-rail"
      data-testid="icon-rail"
      style={{
        width: 56,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        background: "var(--sidebar)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0.65rem 0",
        gap: "0.35rem",
      }}
    >
      <div
        className="co-font-display"
        title="cos-agent"
        style={{
          fontSize: "0.72rem",
          fontWeight: 700,
          letterSpacing: "0.02em",
          marginBottom: "0.35rem",
          color: "var(--muted)",
        }}
      >
        cos
      </div>

      <nav
        aria-label="Hauptnavigation"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.35rem",
          flex: 1,
        }}
      >
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.label}
            data-testid={item.testId}
            style={railLinkStyle}
          >
            <span aria-hidden>{item.icon}</span>
            {item.badge && item.badge > 0 ? (
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                  borderRadius: 999,
                  background: "var(--danger)",
                  color: "#fff",
                  fontSize: "0.62rem",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.45rem",
          marginTop: "auto",
          paddingTop: "0.5rem",
        }}
      >
        <NavLink
          to="/settings"
          title="Einstellungen"
          data-testid="rail-settings"
          style={railLinkStyle}
        >
          <span aria-hidden>⚙</span>
        </NavLink>
        <details style={{ position: "relative" }}>
          <summary
            title={user?.email ?? ""}
            style={{
              listStyle: "none",
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            {initials}
          </summary>
          <button
            type="button"
            data-testid="rail-logout"
            onClick={() => logout()}
            style={{
              position: "absolute",
              left: "100%",
              bottom: 0,
              marginLeft: 6,
              padding: "0.35rem 0.55rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--surface)",
              fontSize: "0.75rem",
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          >
            Abmelden
          </button>
        </details>
        {isSuperAdmin && (
          <NavLink
            to="/superadmin/tenants"
            title="Super Admin"
            style={{
              ...railLinkStyle({ isActive: false }),
              fontSize: "0.85rem",
            }}
          >
            ⚡
          </NavLink>
        )}
      </div>
    </aside>
  );
}
