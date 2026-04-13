import type { DatabaseClient } from "./db/databaseClient.ts";
import type { AgentService } from "./services/agentService.ts";
import type { LlmClient } from "./services/llm/llmTypes.ts";
import type { OAuthService } from "./services/oauthService.ts";
import type { ToolExecutor } from "./services/tools/toolExecutor.ts";
import type postgres from "postgres";

export type AppDependencies = {
  db: DatabaseClient;
  agentService: AgentService;
  /** Roh-Postgres für Admin-Service (Queries außerhalb DatabaseClient). */
  sql: ReturnType<typeof postgres>;
  llm: LlmClient;
  toolExecutor: ToolExecutor;
  oauthService: OAuthService;
};

/** Für Tests: gleiche Deps ohne OAuth (wird in startTestServer ergänzt). */
export type AppCoreDependencies = Omit<AppDependencies, "oauthService">;
