import { Navigate, Outlet } from "react-router-dom";
import { isLoggedIn } from "../lib/auth.ts";

/** Nur Login; rendert Kinder via `<Outlet />`. */
export function ProtectedRoute() {
  if (!isLoggedIn()) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
