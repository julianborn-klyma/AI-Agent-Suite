import { NavLink, Outlet } from "react-router-dom";

export function AdminLayout() {
  return (
    <div className="co-admin-page">
      <h2 className="co-admin-h2">Administration</h2>
      <p className="co-admin-lead">
        Google- und Notion-Anbindung für dich selbst:{" "}
        <NavLink
          to="/settings/connections"
          style={{ fontWeight: 600, color: "var(--accent)" }}
        >
          Einstellungen → Verbindungen
        </NavLink>
      </p>
      <nav className="co-nav-pills">
        <NavLink
          to="/admin/users"
          className={({ isActive }) => `co-nav-pill${isActive ? " active" : ""}`}
        >
          Users
        </NavLink>
        <NavLink
          to="/admin/configs"
          className={({ isActive }) => `co-nav-pill${isActive ? " active" : ""}`}
        >
          Configs
        </NavLink>
        <NavLink
          to="/admin/schedules"
          className={({ isActive }) => `co-nav-pill${isActive ? " active" : ""}`}
        >
          Schedules
        </NavLink>
        <NavLink
          to="/admin/costs"
          className={({ isActive }) => `co-nav-pill${isActive ? " active" : ""}`}
        >
          Costs
        </NavLink>
      </nav>
      <Outlet />
    </div>
  );
}
