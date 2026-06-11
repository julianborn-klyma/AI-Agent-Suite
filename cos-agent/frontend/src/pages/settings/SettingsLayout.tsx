import type { CSSProperties } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth.ts";

const tabStyle = ({
  isActive,
}: {
  isActive: boolean;
}): CSSProperties => ({
  padding: "0.45rem 0.85rem",
  borderRadius: "var(--radius-sm)",
  textDecoration: "none",
  color: isActive ? "var(--ink)" : "var(--muted)",
  fontWeight: isActive ? 600 : 500,
  background: isActive ? "var(--accent-soft)" : "transparent",
  fontSize: "0.88rem",
  whiteSpace: "nowrap",
});

export function SettingsLayout() {
  const { isAdmin } = useAuth();
  const location = useLocation();

  if (location.pathname === "/settings/connections") {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="co-scroll-pane" style={{ padding: "var(--layout-main-padding)" }}>
      <h2 className="co-font-display" style={{ marginTop: 0 }}>
        Einstellungen
      </h2>
      <nav
        aria-label="Einstellungen"
        data-testid="settings-tabs"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
          marginBottom: "1.25rem",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "0.65rem",
        }}
      >
        <NavLink to="/settings" end style={tabStyle}>
          Verbindungen
        </NavLink>
        {isAdmin && (
          <NavLink to="/settings/display" style={tabStyle}>
            Anzeige
          </NavLink>
        )}
        <NavLink to="/settings/password" style={tabStyle}>
          Passwort
        </NavLink>
        <NavLink to="/settings/schedules" style={tabStyle}>
          Jobs &amp; Automation
        </NavLink>
        <NavLink to="/settings/learnings" style={tabStyle}>
          Learnings
        </NavLink>
        <NavLink to="/settings/email-style" style={tabStyle}>
          Schreibstil
        </NavLink>
        <NavLink to="/settings/overview" style={tabStyle}>
          Übersicht
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
