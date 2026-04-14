import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api.ts";
import { isLoggedIn } from "../lib/auth.ts";
import type { OnboardingStatus } from "../hooks/useOnboarding.ts";

const MS_24H = 24 * 60 * 60 * 1000;

export function OnboardingGuard() {
  const location = useLocation();
  const q = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: () => api.get<OnboardingStatus>("/api/onboarding/status"),
    enabled: isLoggedIn(),
    staleTime: 30_000,
  });

  if (!isLoggedIn()) {
    return <Outlet />;
  }
  if (q.isPending) {
    return (
      <div style={{ padding: "1.5rem", color: "var(--muted)" }}>Laden…</div>
    );
  }
  if (q.isError) {
    return <Outlet />;
  }

  const status = q.data;
  if (!status) {
    return <Outlet />;
  }

  const created = new Date(status.user_created_at).getTime();
  const isNewUser = Number.isFinite(created) && Date.now() - created < MS_24H;

  if (
    !status.completed &&
    isNewUser &&
    location.pathname !== "/onboarding"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
