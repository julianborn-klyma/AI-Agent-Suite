import type { CSSProperties } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";
import { logout } from "../lib/auth.ts";

const navLinkStyle = ({
  isActive,
}: {
  isActive: boolean;
}): CSSProperties => ({
  display: "block",
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  color: isActive ? "var(--accent)" : "var(--text)",
  fontWeight: isActive ? 600 : 400,
  textDecoration: "none",
  background: isActive ? "rgba(37, 99, 235, 0.08)" : "transparent",
});

const quickLinkStyle: CSSProperties = {
  fontSize: "0.88rem",
  fontWeight: 600,
  padding: "0.35rem 0.65rem",
  borderRadius: 6,
  textDecoration: "none",
};

export function Layout() {
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  const onSettings = location.pathname.startsWith("/settings");

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
          style={{
            fontWeight: 700,
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
            Verbindungen (Google, Notion)
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
        </div>
      </aside>
      <main
        style={{
          flex: 1,
          overflow: "auto",
          padding: "1.25rem",
          maxWidth: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.5rem 1rem",
            marginBottom: "1rem",
            padding: "0.65rem 0.85rem",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
            Externe Dienste (Gmail, Drive, Notion):
          </span>
          <NavLink
            to="/settings"
            end
            style={({ isActive }) => ({
              ...quickLinkStyle,
              color: "var(--accent)",
              background: isActive ? "rgba(37, 99, 235, 0.12)" : "transparent",
            })}
          >
            Einstellungen
          </NavLink>
          <NavLink
            to="/settings/connections"
            style={({ isActive }) => ({
              ...quickLinkStyle,
              color: "var(--accent)",
              background: isActive ? "rgba(37, 99, 235, 0.12)" : "transparent",
            })}
          >
            Verbindungen
          </NavLink>
          {onSettings && (
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
              Du bist hier.
            </span>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
