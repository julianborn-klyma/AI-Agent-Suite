import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api } from "../lib/api.ts";

export const TASKS_QUERY_KEY = ["cos-tasks"] as const;

export type TaskDto = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  document_ids: string[] | null;
  context: string | null;
  result: string | null;
  result_notion_page_id: string | null;
  result_draft_id: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchTasksList(): Promise<TaskDto[]> {
  return api.get<TaskDto[]>("/api/tasks");
}

export type SubmitTaskParams = {
  title: string;
  description: string;
  priority?: "urgent" | "high" | "medium" | "low";
  document_ids?: string[];
  context?: string;
};

export function useTaskQueue() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: fetchTasksList,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d?.length) return false;
      const active = d.some(
        (t) => t.status === "pending" || t.status === "running",
      );
      return active ? 10_000 : false;
    },
  });

  const tasks = q.data ?? [];

  const pendingCount = useMemo(
    () => tasks.filter((t) => t.status === "pending").length,
    [tasks],
  );

  const runningCount = useMemo(
    () => tasks.filter((t) => t.status === "running").length,
    [tasks],
  );

  const refetchInterval = useMemo(() => {
    const active = tasks.some(
      (t) => t.status === "pending" || t.status === "running",
    );
    return active ? 10_000 : false;
  }, [tasks]);

  const submitTask = useCallback(
    async (params: SubmitTaskParams) => {
      const t = await api.post<TaskDto>("/api/tasks", params);
      await qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
      return t;
    },
    [qc],
  );

  const cancelTask = useCallback(
    async (id: string) => {
      await api.delete<{ cancelled: boolean }>(
        `/api/tasks/${encodeURIComponent(id)}`,
      );
      await qc.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
    [qc],
  );

  return {
    tasks,
    pendingCount,
    runningCount,
    isLoading: q.isLoading,
    submitTask,
    cancelTask,
    refetchInterval,
  };
}
