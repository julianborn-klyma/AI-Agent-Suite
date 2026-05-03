import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.ts";

export const WORKSPACE_PROJECTS_KEY = ["workspace", "projects"] as const;
export const WORKSPACE_TEAMS_KEY = ["workspace", "teams"] as const;
export const WORKSPACE_USERS_KEY = ["workspace", "users"] as const;

export type WorkspaceProject = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type WorkspaceTeam = {
  id: string;
  name: string;
  created_at: string;
};

export type WorkspaceUser = {
  id: string;
  name: string;
  email: string;
};

export type WorkspaceWorkTask = {
  id: string;
  project_id: string;
  project_name: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  assignee_user_ids: string[];
  team_ids: string[];
  created_at: string;
  updated_at: string;
};

export function useWorkspaceProjects(enabled: boolean) {
  return useQuery({
    queryKey: WORKSPACE_PROJECTS_KEY,
    queryFn: () => api.get<WorkspaceProject[]>("/api/workspace/projects"),
    enabled,
  });
}

export function useWorkspaceTeams(enabled: boolean) {
  return useQuery({
    queryKey: WORKSPACE_TEAMS_KEY,
    queryFn: () => api.get<WorkspaceTeam[]>("/api/workspace/teams"),
    enabled,
  });
}

export function useWorkspaceUsers(enabled: boolean) {
  return useQuery({
    queryKey: WORKSPACE_USERS_KEY,
    queryFn: () => api.get<WorkspaceUser[]>("/api/workspace/users"),
    enabled,
  });
}

export function useWorkspaceWorkTasks(
  enabled: boolean,
  projectId: string | null,
  status: string | null,
) {
  const qs = new URLSearchParams();
  if (projectId) qs.set("project_id", projectId);
  if (status) qs.set("status", status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery({
    queryKey: ["workspace", "work-tasks", projectId ?? "", status ?? ""] as const,
    queryFn: () =>
      api.get<WorkspaceWorkTask[]>(`/api/workspace/work-tasks${suffix}`),
    enabled,
  });
}

export function useCreateWorkspaceProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null }) =>
      api.post<WorkspaceProject>("/api/workspace/projects", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WORKSPACE_PROJECTS_KEY });
    },
  });
}

export function useCreateWorkspaceTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api.post<WorkspaceTeam>("/api/workspace/teams", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: WORKSPACE_TEAMS_KEY });
    },
  });
}

export function useWorkspaceWorkTask(enabled: boolean, taskId: string) {
  return useQuery({
    queryKey: ["workspace", "work-task", taskId] as const,
    queryFn: () =>
      api.get<WorkspaceWorkTask>(
        `/api/workspace/work-tasks/${encodeURIComponent(taskId)}`,
      ),
    enabled: enabled && taskId.length > 0,
  });
}

export function useCreateWorkspaceWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      project_id: string;
      title: string;
      description?: string | null;
      status?: string;
      priority?: string;
      due_at?: string | null;
      assignee_user_ids?: string[];
      team_ids?: string[];
    }) => api.post<WorkspaceWorkTask>("/api/workspace/work-tasks", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspace", "work-tasks"] });
    },
  });
}

export function usePatchWorkspaceWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      patch: {
        title?: string;
        description?: string | null;
        status?: string;
        priority?: string;
        due_at?: string | null;
        project_id?: string;
        assignee_user_ids?: string[];
        team_ids?: string[];
      };
    }) =>
      api.patch<WorkspaceWorkTask>(
        `/api/workspace/work-tasks/${encodeURIComponent(args.id)}`,
        args.patch,
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["workspace", "work-tasks"] });
      void qc.invalidateQueries({ queryKey: ["workspace", "work-task", vars.id] });
    },
  });
}

export function useDeleteWorkspaceWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: boolean }>(
        `/api/workspace/work-tasks/${encodeURIComponent(id)}`,
      ),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["workspace", "work-tasks"] });
      void qc.removeQueries({ queryKey: ["workspace", "work-task", id] });
    },
  });
}
