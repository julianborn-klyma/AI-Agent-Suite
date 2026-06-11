import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";

export type BrainMemberRole = "owner" | "knowledge_owner" | "member";
export type BrainEntryType = "fact" | "decision" | "preference" | "context" | "process";
export type FirmInsightCategory =
  | "person"
  | "company"
  | "project"
  | "decision"
  | "pattern"
  | "relationship";

export type BrainProject = {
  id: string;
  tenant_id: string;
  owner_id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  member_role?: BrainMemberRole;
  member_count?: number;
  entry_count?: number;
};

export type BrainProjectMember = {
  id: string;
  project_id: string;
  user_id: string;
  role: BrainMemberRole;
  invited_by: string | null;
  created_at: string;
  user_name?: string;
  user_email?: string;
};

export type BrainEntry = {
  id: string;
  project_id: string;
  tenant_id: string;
  created_by: string;
  type: BrainEntryType;
  content: string;
  source: string | null;
  confidence: number;
  tags: string[];
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  creator_name?: string;
};

export type BrainConflict = {
  id: string;
  project_id: string;
  entry_a_id: string;
  entry_b_id: string;
  conflict_description: string | null;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

export type FirmInsight = {
  id: string;
  tenant_id: string;
  source_project_id: string | null;
  source_project_name?: string | null;
  source_user_id: string | null;
  source_session_id: string | null;
  category: FirmInsightCategory;
  content: string;
  confidence: number;
  tags: string[];
  admin_suppressed: boolean;
  created_at: string;
  updated_at: string;
};

export const BRAIN_PROJECTS_KEY = ["brain", "projects"] as const;
export const brainProjectKey = (id: string) => ["brain", "projects", id] as const;
export const brainMembersKey = (id: string) => ["brain", "projects", id, "members"] as const;
export const brainEntriesKey = (id: string) => ["brain", "projects", id, "entries"] as const;
export const brainConflictsKey = (id: string) =>
  ["brain", "projects", id, "conflicts"] as const;
export const FIRM_INSIGHTS_KEY = ["admin", "firm-brain"] as const;

export function useBrainProjects() {
  return useQuery({
    queryKey: BRAIN_PROJECTS_KEY,
    queryFn: () => api.get<BrainProject[]>("/api/brain/projects"),
  });
}

export function useBrainProject(id: string) {
  return useQuery({
    queryKey: brainProjectKey(id),
    queryFn: () => api.get<BrainProject>(`/api/brain/projects/${id}`),
  });
}

export function useBrainMembers(projectId: string) {
  return useQuery({
    queryKey: brainMembersKey(projectId),
    queryFn: () => api.get<BrainProjectMember[]>(`/api/brain/projects/${projectId}/members`),
  });
}

export function useBrainEntries(projectId: string) {
  return useQuery({
    queryKey: brainEntriesKey(projectId),
    queryFn: () => api.get<BrainEntry[]>(`/api/brain/projects/${projectId}/entries`),
  });
}

export function useBrainConflicts(projectId: string) {
  return useQuery({
    queryKey: brainConflictsKey(projectId),
    queryFn: () => api.get<BrainConflict[]>(`/api/brain/projects/${projectId}/conflicts`),
  });
}

export function useFirmInsights() {
  return useQuery({
    queryKey: FIRM_INSIGHTS_KEY,
    queryFn: () => api.get<FirmInsight[]>("/api/admin/firm-brain"),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; color?: string }) =>
      api.post<BrainProject>("/api/brain/projects", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: BRAIN_PROJECTS_KEY }),
  });
}

export function useUpdateProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name?: string; description?: string; color?: string }) =>
      api.patch<BrainProject>(`/api/brain/projects/${projectId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BRAIN_PROJECTS_KEY });
      qc.invalidateQueries({ queryKey: brainProjectKey(projectId) });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.delete(`/api/brain/projects/${projectId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: BRAIN_PROJECTS_KEY }),
  });
}

export function useInviteMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { userId: string; role: BrainMemberRole }) =>
      api.post(`/api/brain/projects/${projectId}/members`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: brainMembersKey(projectId) }),
  });
}

export function useUpdateMemberRole(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: BrainMemberRole }) =>
      api.patch(`/api/brain/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: brainMembersKey(projectId) }),
  });
}

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/api/brain/projects/${projectId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: brainMembersKey(projectId) }),
  });
}

export function useAddEntry(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      type: BrainEntryType;
      content: string;
      source?: string;
      tags?: string[];
      expires_at?: string;
    }) => api.post<BrainEntry>(`/api/brain/projects/${projectId}/entries`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brainEntriesKey(projectId) });
      qc.invalidateQueries({ queryKey: BRAIN_PROJECTS_KEY });
    },
  });
}

export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      entryId,
      data,
    }: {
      entryId: string;
      projectId: string;
      data: { content?: string; type?: BrainEntryType; tags?: string[] };
    }) => api.patch<BrainEntry>(`/api/brain/entries/${entryId}`, data),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: brainEntriesKey(v.projectId) });
    },
  });
}

export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId }: { entryId: string; projectId: string }) =>
      api.delete(`/api/brain/entries/${entryId}`),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: brainEntriesKey(v.projectId) });
      qc.invalidateQueries({ queryKey: BRAIN_PROJECTS_KEY });
    },
  });
}

export function useResolveConflict(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conflictId, keepEntryId }: { conflictId: string; keepEntryId: string }) =>
      api.post(`/api/brain/conflicts/${conflictId}/resolve`, { keepEntryId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brainConflictsKey(projectId) });
      qc.invalidateQueries({ queryKey: brainEntriesKey(projectId) });
    },
  });
}

export function useSuppressInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, suppress }: { id: string; suppress: boolean }) =>
      api.patch(`/api/admin/firm-brain/${id}`, { admin_suppressed: suppress }),
    onSuccess: () => qc.invalidateQueries({ queryKey: FIRM_INSIGHTS_KEY }),
  });
}

export function useDeleteInsight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin/firm-brain/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: FIRM_INSIGHTS_KEY }),
  });
}
