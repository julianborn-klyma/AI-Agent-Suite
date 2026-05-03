import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

export class WorkspaceAgent extends BaseSubAgent {
  readonly agentType = "workspace";
  readonly description =
    "Tenant-internes Wiki (nur freigegeben) und interne Work-Tasks lesen";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("workspace")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "workspace nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const realm = typeof task.realm === "string" ? task.realm : "";
    if (realm === "wiki") {
      const action = String(task.action ?? "list_approved");
      const params: Record<string, unknown> = { action };
      if (typeof task.limit === "number") params.limit = task.limit;
      if (typeof task.slug === "string") params.slug = task.slug;
      const result = await this.toolExecutor.execute(
        "workspace_wiki",
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

    if (realm === "tasks") {
      const action = String(task.action ?? "list_not_done");
      const params: Record<string, unknown> = { action };
      if (typeof task.limit === "number") params.limit = task.limit;
      const result = await this.toolExecutor.execute(
        "workspace_tasks",
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

    return {
      agentType: this.agentType,
      success: false,
      error: 'realm fehlt oder ungültig — nutze "wiki" oder "tasks"',
      durationMs: elapsed(),
    };
  }
}
