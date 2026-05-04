import type { CSSProperties } from "react";
import { NavLink, Outlet } from "react-router-dom";

const sidebarBg = "hsl(34 16% 9%)";
/** BERT: Gelb → Tinte (Design-Tokens über CSS-Variablen). */
const superAdminBadgeGradient =
  "linear-gradient(135deg, hsl(var(--ds-color-yellow-accent)), hsl(var(--ds-color-brand)))";

const linkStyle = ({
  isActive,
}: {
  isActive: boolean;
}): CSSProperties => ({
  display: "block",
  padding: "0.55rem 0.85rem",
  borderRadius: 8,
  color: isActive ? "#fff" : "rgba(255,255,255,0.82)",
  fontWeight: isActive ? 600 : 400,
  textDecoration: "none",
  background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
});

export function SuperAdminLayout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0f0f18" }}>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          background: sidebarBg,
          color: "#eee",
          display: "flex",
          flexDirection: "column",
          padding: "1rem 0.75rem",
          borderRight: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            padding: "0 0.75rem 1rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            marginBottom: "1rem",
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "0.35rem 0.55rem",
              borderRadius: 6,
              background: superAdminBadgeGradient,
              color: "#fff",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
            }}
          >
            ⚡ Super Admin
          </span>
          <div
            style={{
              marginTop: "0.65rem",
              fontSize: "0.8rem",
              opacity: 0.75,
            }}
          >
            Mandanten &amp; System
          </div>
        </div>
        <nav style={{ flex: 1 }}>
          <NavLink to="/superadmin/tenants" style={linkStyle} end>
            Tenants
          </NavLink>
          <NavLink to="/superadmin/audit-log" style={linkStyle}>
            Audit Log
          </NavLink>
          <NavLink to="/superadmin/status" style={linkStyle}>
            System Status
          </NavLink>
        </nav>
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: "0.85rem",
            marginTop: "0.5rem",
          }}
        >
          <NavLink
            to="/chat"
            style={{
              display: "block",
              padding: "0.5rem 0.85rem",
              color: "rgba(255,255,255,0.65)",
              fontSize: "0.88rem",
              textDecoration: "none",
            }}
          >
            ← Zurück zur App
          </NavLink>
        </div>
      </aside>
      <main
        style={{
          flex: 1,
          minWidth: 0,
          padding: "1.5rem 2rem",
          color: "#e8e8ef",
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
