import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";

export function RequireSuperAdmin() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{ padding: "1.5rem", color: "var(--muted)" }}>Laden…</div>
    );
  }

  if (user?.role !== "superadmin") {
    return <Navigate to="/chat" replace />;
  }

  return <Outlet />;
}
