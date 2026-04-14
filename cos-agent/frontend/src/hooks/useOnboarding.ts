import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";
import { isLoggedIn } from "../lib/auth.ts";

export type OnboardingStatus = {
  completed: boolean;
  user_created_at: string;
  steps: {
    profile: boolean;
    connections: { google: boolean; notion: boolean; slack: boolean };
    first_task: boolean;
    first_chat: boolean;
  };
  next_step: "profile" | "connections" | "chat" | "done";
};

export type ProfilePayload = {
  role: string;
  team?: string;
  priorities?: string;
  communication_style?: string;
  work_style?: string;
};

export function useOnboarding(): {
  status: OnboardingStatus | null;
  isLoading: boolean;
  saveProfile: (profile: ProfilePayload) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  skipStep: (step: "connections" | "chat") => Promise<void>;
  refetchStatus: () => void;
} {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: () => api.get<OnboardingStatus>("/api/onboarding/status"),
    enabled: isLoggedIn(),
    staleTime: 30_000,
  });

  const saveM = useMutation({
    mutationFn: (profile: ProfilePayload) =>
      api.post<{ saved: boolean }>("/api/onboarding/profile", profile),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding", "status"] });
    },
  });

  const completeM = useMutation({
    mutationFn: () => api.post<{ completed: boolean }>("/api/onboarding/complete", {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding", "status"] });
    },
  });

  const skipM = useMutation({
    mutationFn: (step: "connections" | "chat") =>
      api.post<{ skipped: boolean }>("/api/onboarding/skip", { step }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding", "status"] });
    },
  });

  return {
    status: q.data ?? null,
    isLoading: q.isPending,
    saveProfile: async (profile) => {
      await saveM.mutateAsync(profile);
    },
    completeOnboarding: async () => {
      await completeM.mutateAsync();
    },
    skipStep: async (step) => {
      await skipM.mutateAsync(step);
    },
    refetchStatus: () => void q.refetch(),
  };
}
