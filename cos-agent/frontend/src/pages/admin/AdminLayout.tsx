import { NavLink, Outlet } from "react-router-dom";
import type { CSSProperties } from "react";

const subNav: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginBottom: "1rem",
  paddingBottom: "0.75rem",
  borderBottom: "1px solid var(--border)",
};

const subLink: CSSProperties = {
  fontSize: "0.9rem",
  padding: "0.25rem 0.5rem",
};

export function AdminLayout() {
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Administration</h2>
      <nav style={subNav}>
        <NavLink to="/admin/users" style={subLink}>
          Users
        </NavLink>
        <NavLink to="/admin/configs" style={subLink}>
          Configs
        </NavLink>
        <NavLink to="/admin/schedules" style={subLink}>
          Schedules
        </NavLink>
        <NavLink to="/admin/costs" style={subLink}>
          Costs
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
