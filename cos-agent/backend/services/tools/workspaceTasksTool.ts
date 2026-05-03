import type { DatabaseClient } from "../../db/databaseClient.ts";
import { listWorkTasks, withWorkspaceTx } from "../workspaceService.ts";
import type { Tool, ToolExecuteContext, ToolResult } from "./types.ts";

type TasksParams = { action: "list_not_done"; limit?: number };

function parseParams(raw: unknown): TasksParams | { error: string } {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { error: "Ungültiges JSON" };
    }
  }
  if (v === null || typeof v !== "object") return { error: "Ungültige Parameter" };
  const o = v as Record<string, unknown>;
  if (o.action !== "list_not_done") {
    return { error: "action muss list_not_done sein" };
  }
  const limit = typeof o.limit === "number" && Number.isFinite(o.limit)
    ? o.limit
    : undefined;
  return { action: "list_not_done", limit };
}

export const workspaceTasksTool: Tool = {
  definition: {
    name: "workspace_tasks",
    description:
      "Liest interne Work-Tasks (Schema app.tasks) im Tenant: nur **open** und **in_progress**, keine Queue-Tasks.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_not_done"] },
        limit: {
          type: "number",
          description: "Max. 40 (Standard 25)",
        },
      },
      required: ["action"],
    },
  },

  async execute(
    raw: unknown,
    userId: string,
    _db: DatabaseClient,
    ctx?: ToolExecuteContext,
  ): Promise<ToolResult> {
    const sql = ctx?.sql;
    if (!sql) {
      return {
        success: false,
        error: "workspace_tasks: Postgres nicht verfügbar (Server-Konfiguration).",
      };
    }
    const p = parseParams(raw);
    if ("error" in p) return { success: false, error: p.error };

    const r = await withWorkspaceTx(sql, userId, async (tx) => {
      const limit = Math.min(40, Math.max(1, Math.floor(p.limit ?? 25)));
      const rows = await listWorkTasks(tx, { project_id: null, status: null });
      const pick = rows
        .filter((t) => t.status === "open" || t.status === "in_progress")
        .slice(0, limit);
      return {
        tasks: pick.map((t) => ({
          id: t.id,
          title: t.title,
          project_name: t.project_name,
          status: t.status,
          priority: t.priority,
        })),
      };
    });
    if (!r.ok) return { success: false, error: r.message };
    return { success: true, data: r.value };
  },
};
