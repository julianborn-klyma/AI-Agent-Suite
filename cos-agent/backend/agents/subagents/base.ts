import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import { CHAT_MODEL } from "../constants.ts";
import type { AgentContext, SubAgentResult } from "../types.ts";

export abstract class BaseSubAgent {
  abstract readonly agentType: string;
  abstract readonly description: string;

  constructor(
    protected llm: LlmClient,
    protected db: DatabaseClient,
    protected toolExecutor: ToolExecutor,
  ) {}

  abstract execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult>;

  protected log(event: string, data?: Record<string, unknown>): void {
    console.log(
      JSON.stringify({
        level: "info",
        agent: this.agentType,
        event,
        ...data,
      }),
    );
  }

  protected async callLlm(params: {
    systemPrompt: string;
    userMessage: string;
    context: AgentContext;
    tools?: string[];
  }): Promise<string> {
    const allowed = params.tools?.length
      ? params.context.connectedTools.filter((t) => params.tools!.includes(t))
      : params.context.connectedTools;
    const defs = this.toolExecutor.getToolDefinitions(allowed);
    const res = await this.llm.chat({
      model: CHAT_MODEL,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userMessage }],
      tools: defs.length > 0 ? defs : undefined,
      metadata: { user_id: params.context.userId, source: "cos-agent" },
    });
    return res.content ?? "";
  }

  protected startTimer(): () => number {
    const t0 = performance.now();
    return () => Math.round(performance.now() - t0);
  }
}
