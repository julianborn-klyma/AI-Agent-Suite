import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { isLoggedIn } from "../lib/auth.ts";

export type MeUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export function useAuth(): {
  user: MeUser | null;
  isLoading: boolean;
  isAdmin: boolean;
} {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeUser>("/api/me"),
    enabled: isLoggedIn(),
    staleTime: 60_000,
  });

  return {
    user: q.data ?? null,
    isLoading: q.isPending,
    isAdmin: q.data?.role === "admin",
  };
}
