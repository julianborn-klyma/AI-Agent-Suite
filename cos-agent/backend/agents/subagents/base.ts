import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient, LlmToolsInput } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentModel } from "../modelSelector.ts";
import { MODEL_IDS, selectModel } from "../modelSelector.ts";
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
    model?: AgentModel;
    complexity?: "low" | "medium" | "high";
    useWebSearch?: boolean;
  }): Promise<string> {
    const named = params.tools ?? [];
    const enabledForDefs = params.context.connectedTools.filter((t) =>
      t !== "web_search" &&
      (named.length === 0 || named.includes(t))
    );
    const defs = this.toolExecutor.getToolDefinitions(enabledForDefs);
    const llmTools: LlmToolsInput = [];
    if (
      params.useWebSearch &&
      params.context.connectedTools.includes("web_search")
    ) {
      llmTools.push("web_search");
    }
    llmTools.push(...defs);

    const selectedModel = params.model
      ? MODEL_IDS[params.model]
      : selectModel({
        taskType: params.context.currentTask ?? "chat",
        complexity: params.complexity ?? "medium",
        requiresWebSearch: params.useWebSearch ?? false,
        isRetry: false,
        agentType: this.agentType,
      });

    const res = await this.llm.chat({
      model: selectedModel,
      system: params.systemPrompt,
      messages: [{ role: "user", content: params.userMessage }],
      tools: llmTools.length > 0 ? llmTools : undefined,
      metadata: { user_id: params.context.userId, source: "cos-agent" },
    });
    return res.content ?? "";
  }

  protected startTimer(): () => number {
    const t0 = performance.now();
    return () => Math.round(performance.now() - t0);
  }
}
