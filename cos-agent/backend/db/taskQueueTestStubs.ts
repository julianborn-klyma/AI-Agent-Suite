import type { DatabaseClient, TaskQueueRow } from "./databaseClient.ts";

/** Noops für `DatabaseClient`-Fakes ohne Task-Queue. */
export const taskQueueTestStubs: Pick<
  DatabaseClient,
  | "insertTask"
  | "getTasks"
  | "getTask"
  | "getNextPendingTask"
  | "updateTaskStatus"
  | "cancelTask"
> = {
  async insertTask(): Promise<TaskQueueRow> {
    throw new Error("insertTask: Test-Fake nicht konfiguriert");
  },
  async getTasks(): Promise<TaskQueueRow[]> {
    return [];
  },
  async getTask(): Promise<TaskQueueRow | null> {
    return null;
  },
  async getNextPendingTask(): Promise<TaskQueueRow | null> {
    return null;
  },
  async updateTaskStatus(): Promise<void> {},
  async cancelTask(): Promise<
    { ok: true } | { ok: false; reason: "not_found" | "not_pending" }
  > {
    return { ok: false, reason: "not_found" };
  },
};
