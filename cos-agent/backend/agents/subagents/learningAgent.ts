import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { LearningService } from "../../services/learningService.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

export class LearningAgent extends BaseSubAgent {
  readonly agentType = "learning";
  readonly description = "Extrahiert Kontext aus Konversationen";

  constructor(
    llm: LlmClient,
    db: DatabaseClient,
    toolExecutor: ToolExecutor,
    private readonly learningService: LearningService,
  ) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    try {
      if (task.type !== "extract_from_conversation") {
        return {
          agentType: this.agentType,
          success: false,
          error: "Unbekannter Task-Typ",
          durationMs: elapsed(),
        };
      }
      const sessionId = String(task.sessionId ?? "");
      const messages = Array.isArray(task.messages)
        ? task.messages as Array<{ role: string; content: string }>
        : [];
      const agentResults = Array.isArray(task.agentResults)
        ? task.agentResults as SubAgentResult[]
        : [];

      const candidates = await this.learningService.extractFromConversation({
        userId: context.userId,
        sessionId,
        messages,
        agentResults,
      });

      const before = await this.db.getLearnings(context.userId, {
        activeOnly: true,
        limit: 500,
      });
      const beforeIds = new Set(before.map((l) => l.id));

      const saved = await this.db.upsertLearnings(context.userId, candidates);

      const neu = saved.filter((l) => !beforeIds.has(l.id)).length;
      const merged = saved.length - neu;

      return {
        agentType: this.agentType,
        success: true,
        data: {
          extracted: candidates.length,
          persisted: saved.length,
          neu,
          merged,
        },
        durationMs: elapsed(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log("extract_failed", { error: msg });
      return {
        agentType: this.agentType,
        success: false,
        error: msg,
        durationMs: elapsed(),
      };
    }
  }
}
