import type { DatabaseClient } from "../../db/databaseClient.ts";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface Tool {
  definition: LlmToolDefinition;
  execute(
    params: unknown,
    userId: string,
    db: DatabaseClient,
  ): Promise<ToolResult>;
}
