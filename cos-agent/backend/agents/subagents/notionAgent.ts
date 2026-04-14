import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

function ctxValue(rows: { key: string; value: string }[], key: string): string {
  return rows.find((r) => r.key === key)?.value ?? "";
}

export class NotionAgent extends BaseSubAgent {
  readonly agentType = "notion";
  readonly description = "Liest und verwaltet Notion Tasks";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("notion")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "notion nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const action = String(task.action ?? "list_tasks");
    const databaseId =
      typeof task.database_id === "string" && task.database_id
        ? task.database_id
        : ctxValue(context.userContexts, "notion_database_id");

    let params: Record<string, unknown>;
    switch (action) {
      case "list_tasks":
        params = { action: "list_tasks", database_id: databaseId };
        break;
      case "add_task":
        params = {
          action: "add_task",
          database_id: databaseId,
          title: String(task.title ?? ""),
          priority: task.priority ?? "medium",
          project: typeof task.project === "string" ? task.project : undefined,
          deadline: typeof task.deadline === "string"
            ? task.deadline
            : undefined,
        };
        break;
      case "update_task":
        params = {
          action: "update_task",
          page_id: String(task.page_id ?? ""),
          status: String(task.status ?? ""),
        };
        break;
      case "get_today_tasks":
        params = { action: "get_today_tasks", database_id: databaseId };
        break;
      default:
        return {
          agentType: this.agentType,
          success: false,
          error: `Unbekannte Task: ${action}`,
          durationMs: elapsed(),
        };
    }

    const result = await this.toolExecutor.execute(
      "notion",
      params,
      context.userId,
      this.db,
    );
    return {
      agentType: this.agentType,
      success: result.success,
      data: result.data,
      error: result.error,
      durationMs: elapsed(),
    };
  }
}
