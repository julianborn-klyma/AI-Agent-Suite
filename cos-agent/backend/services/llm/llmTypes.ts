import type { LlmToolCall, LlmToolDefinition } from "../tools/types.ts";

export type { LlmToolCall, LlmToolDefinition };

export type LlmMessage =
  | { role: "user"; content: string }
  | {
    role: "assistant";
    content: string;
    tool_calls?: LlmToolCall[];
  }
  | { role: "tool"; content: string; tool_call_id: string };

/** Anthropic Server-Tool `web_search` (wird im Client zu `web_search_20250305` gemappt). */
export type LlmToolsInput = Array<LlmToolDefinition | "web_search">;

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolsInput;
  metadata: { user_id: string; source: string };
}

export interface LlmResponse {
  content: string;
  tool_calls?: LlmToolCall[];
  input_tokens: number;
  output_tokens: number;
  stop_reason: string;
}

export interface LlmClient {
  chat(req: LlmRequest): Promise<LlmResponse>;
}

export class LlmClientError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(status: number, message: string, bodySnippet = "") {
    super(message);
    this.name = "LlmClientError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      status: this.status,
      message: this.message,
      bodySnippet: this.bodySnippet,
    };
  }
}
