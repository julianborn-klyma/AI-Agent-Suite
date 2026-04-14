import { AggregatorAgent } from "../agents/aggregator.ts";
import { CHAT_MODEL } from "../agents/constants.ts";
import { buildSystemPromptForUser } from "../agents/contextLoader.ts";
import { OrchestratorAgent } from "../agents/orchestrator.ts";
import { ValidatorAgent } from "../agents/validator.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import { DocumentService } from "./documentService.ts";
import { LearningService } from "./learningService.ts";
import type {
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmResponse,
} from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";

/** Grobe Kostenannahme (USD) gemäß Sonnet — Feld für Logs/Analysen. */
const USD_PER_INPUT_TOKEN = 0.000003;
const USD_PER_OUTPUT_TOKEN = 0.000015;

export type ChatResponse = {
  content: string;
  tool_calls?: LlmResponse["tool_calls"];
  /** Alle Tool-Namen über alle LLM-Runden (Reihenfolge der Ausführung). */
  tool_calls_made: string[];
  input_tokens: number;
  output_tokens: number;
  stop_reason: string;
};

export type AgentServiceOptions = {
  /** Für Tests: fester Zeitpunkt für {{NOW}}. */
  now?: () => Date;
  /** Geteilter DocumentService (z. B. mit AppDependencies). */
  documentService?: DocumentService;
};

function wrapLlmWithCallLog(
  inner: LlmClient,
  sink: Array<{ response: LlmResponse; latencyMs: number }>,
): LlmClient {
  return {
    async chat(req: LlmRequest): Promise<LlmResponse> {
      const t0 = performance.now();
      const response = await inner.chat(req);
      sink.push({
        response,
        latencyMs: Math.round(performance.now() - t0),
      });
      return response;
    },
  };
}

export class AgentService {
  private readonly nowFn: () => Date;
  private readonly learningService: LearningService;
  private readonly documentService: DocumentService;

  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly toolExecutor: ToolExecutor,
    opts?: AgentServiceOptions,
  ) {
    this.nowFn = opts?.now ?? (() => new Date());
    this.learningService = new LearningService(this.db, this.llm);
    this.documentService = opts?.documentService ??
      new DocumentService(this.db, this.llm);
  }

  /** Aufgelöster System-Prompt (Tests & Admin). */
  async buildSystemPrompt(userId: string): Promise<string> {
    return await buildSystemPromptForUser(
      this.db,
      userId,
      this.nowFn,
      this.learningService,
      this.documentService,
    );
  }

  async chat(params: {
    userId: string;
    sessionId: string;
    message: string;
  }): Promise<ChatResponse> {
    const llmCalls: Array<{ response: LlmResponse; latencyMs: number }> = [];
    const trackedLlm = wrapLlmWithCallLog(this.llm, llmCalls);

    const validator = new ValidatorAgent(trackedLlm);
    const aggregator = new AggregatorAgent(trackedLlm);
    const orchestrator = new OrchestratorAgent(
      trackedLlm,
      this.db,
      this.toolExecutor,
      validator,
      aggregator,
      this.nowFn,
      this.learningService,
      this.llm,
      this.documentService,
    );

    const history = await this.loadHistory(params.userId, params.sessionId);
    const orch = await orchestrator.run({
      userId: params.userId,
      sessionId: params.sessionId,
      message: params.message,
      historyMessages: history,
      now: this.nowFn,
    });

    for (const c of llmCalls) {
      await this.logLlmCall(
        params.userId,
        params.sessionId,
        c.response,
        c.latencyMs,
      );
    }

    await this.saveMessages(
      params.userId,
      params.sessionId,
      params.message,
      orch.content,
    );

    const totalIn = llmCalls.reduce(
      (a, c) => a + c.response.input_tokens,
      0,
    );
    const totalOut = llmCalls.reduce(
      (a, c) => a + c.response.output_tokens,
      0,
    );
    const last = llmCalls[llmCalls.length - 1]?.response;

    return {
      content: orch.content,
      tool_calls: last?.tool_calls,
      tool_calls_made: orch.tool_calls_made,
      input_tokens: totalIn,
      output_tokens: totalOut,
      stop_reason: last?.stop_reason ?? orch.stop_reason,
    };
  }

  private async loadHistory(
    userId: string,
    sessionId: string,
  ): Promise<LlmMessage[]> {
    const rows = await this.db.listRecentConversationMessages(
      userId,
      sessionId,
      10,
    );
    const out: LlmMessage[] = [];
    for (const row of rows) {
      if (row.role === "user" || row.role === "assistant") {
        out.push({ role: row.role, content: row.content });
      }
    }
    return out;
  }

  private async saveMessages(
    userId: string,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    await this.db.insertConversationMessage({
      userId,
      sessionId,
      role: "user",
      content: userMessage,
    });
    await this.db.insertConversationMessage({
      userId,
      sessionId,
      role: "assistant",
      content: assistantResponse,
    });
  }

  private async logLlmCall(
    userId: string,
    sessionId: string,
    response: LlmResponse,
    latencyMs: number,
  ): Promise<void> {
    const costUsd =
      response.input_tokens * USD_PER_INPUT_TOKEN +
      response.output_tokens * USD_PER_OUTPUT_TOKEN;

    await this.db.insertLlmCall({
      userId,
      sessionId,
      model: CHAT_MODEL,
      inputTokens: response.input_tokens,
      outputTokens: response.output_tokens,
      costUsd,
      latencyMs,
    });
  }
}
