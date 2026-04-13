import type { DatabaseClient } from "../db/databaseClient.ts";
import type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmToolCall,
} from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";

const CHAT_MODEL = "claude-sonnet-4-20250514";
const MAX_TOOL_LLM_ROUNDS = 3;

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
};

function formatGermanDateTime(date: Date): string {
  const timeZone = "Europe/Berlin";
  const weekday = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    timeZone,
  }).format(date);
  const day = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    timeZone,
  }).format(date);
  const month = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    timeZone,
  }).format(date);
  const year = new Intl.DateTimeFormat("de-DE", {
    year: "numeric",
    timeZone,
  }).format(date);
  const hm = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return `${weekday}, ${day}. ${month} ${year}, ${hm} Uhr`;
}

function buildUserContextBlock(rows: { key: string; value: string }[]): string {
  return rows.map((r) => `${r.key}: ${r.value}`).join("\n");
}

function injectPromptPlaceholders(
  template: string,
  userContextBlock: string,
  nowFormatted: string,
): string {
  return template
    .replaceAll("{{USER_CONTEXT}}", userContextBlock)
    .replaceAll("{{NOW}}", nowFormatted);
}

function parseToolInput(tc: LlmToolCall): unknown {
  const raw = tc.input;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

export class AgentService {
  private readonly nowFn: () => Date;

  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly toolExecutor: ToolExecutor,
    opts?: AgentServiceOptions,
  ) {
    this.nowFn = opts?.now ?? (() => new Date());
  }

  async chat(params: {
    userId: string;
    sessionId: string;
    message: string;
  }): Promise<ChatResponse> {
    const { system, tools_enabled } = await this.resolveSystemAndTools(
      params.userId,
    );
    const history = await this.loadHistory(params.userId, params.sessionId);
    const messages: LlmMessage[] = [
      ...history,
      { role: "user", content: params.message },
    ];

    const toolDefs = this.toolExecutor.getToolDefinitions(tools_enabled);
    let totalIn = 0;
    let totalOut = 0;
    const tool_calls_made: string[] = [];
    let lastResponse: LlmResponse = {
      content: "",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "unknown",
    };

    for (let round = 0; round < MAX_TOOL_LLM_ROUNDS; round++) {
      const t0 = performance.now();
      const response = await this.llm.chat({
        model: CHAT_MODEL,
        system,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        metadata: { user_id: params.userId, source: "cos-agent" },
      });
      const latencyMs = Math.round(performance.now() - t0);
      totalIn += response.input_tokens;
      totalOut += response.output_tokens;
      lastResponse = response;

      await this.logLlmCall(
        params.userId,
        params.sessionId,
        response,
        latencyMs,
      );

      const calls = response.tool_calls;
      if (!calls?.length) {
        break;
      }

      messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: calls,
      });

      for (const tc of calls) {
        tool_calls_made.push(tc.name);
        const toolInput = parseToolInput(tc);
        const result = await this.toolExecutor.execute(
          tc.name,
          toolInput,
          params.userId,
          this.db,
        );
        const payload = result.success
          ? result.data
          : { error: result.error };
        messages.push({
          role: "user",
          content:
            `Tool-Result für ${tc.name}: ${JSON.stringify(payload)}`,
        });
      }

      if (round === MAX_TOOL_LLM_ROUNDS - 1) {
        break;
      }
    }

    await this.saveMessages(
      params.userId,
      params.sessionId,
      params.message,
      lastResponse.content,
    );

    return {
      content: lastResponse.content,
      tool_calls: lastResponse.tool_calls,
      tool_calls_made,
      input_tokens: totalIn,
      output_tokens: totalOut,
      stop_reason: lastResponse.stop_reason,
    };
  }

  private async resolveSystemAndTools(
    userId: string,
  ): Promise<{ system: string; tools_enabled: string[] }> {
    const config = await this.db.findAgentConfigForUser(userId);
    if (config === null || config.system_prompt.trim() === "") {
      throw new Error(
        `Kein agent_config (User oder Template) für user_id=${userId}`,
      );
    }
    const contexts = await this.db.listUserContexts(userId);
    const block = buildUserContextBlock(contexts);
    const nowFormatted = formatGermanDateTime(this.nowFn());
    const system = injectPromptPlaceholders(
      config.system_prompt,
      block,
      nowFormatted,
    );
    const tools_enabled = config.tools_enabled?.length
      ? config.tools_enabled
      : ["notion"];
    return { system, tools_enabled };
  }

  private async buildSystemPrompt(userId: string): Promise<string> {
    const { system } = await this.resolveSystemAndTools(userId);
    return system;
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
