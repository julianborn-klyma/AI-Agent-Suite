import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.ts";

export function WorkspaceWikiRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <p style={{ padding: "1.25rem", color: "var(--muted)" }}>Laden…</p>;
  }

  if (user?.tenant_ui_show_tenant_wiki) {
    return <Navigate to="/knowledge?tab=wiki" replace />;
  }

  return <Navigate to="/chat" replace />;
}
