import type { DatabaseClient } from "./db/databaseClient.ts";
import type { AgentService } from "./services/agentService.ts";
import type { DocumentService } from "./services/documentService.ts";
import type { DriveSyncService } from "./services/driveSyncService.ts";
import type { EmailStyleService } from "./services/emailStyleService.ts";
import type { EmailCategorizationService } from "./services/emailCategorizationService.ts";
import type { LlmClient } from "./services/llm/llmTypes.ts";
import type { OAuthService } from "./services/oauthService.ts";
import type { ToolExecutor } from "./services/tools/toolExecutor.ts";
import type { WeeklyConsolidatorService } from "./services/weeklyConsolidatorService.ts";
import type postgres from "postgres";

export type AppDependencies = {
  db: DatabaseClient;
  agentService: AgentService;
  documentService: DocumentService;
  /** Roh-Postgres für Admin-Service (Queries außerhalb DatabaseClient). */
  sql: ReturnType<typeof postgres>;
  llm: LlmClient;
  toolExecutor: ToolExecutor;
  oauthService: OAuthService;
  emailStyleService: EmailStyleService;
  emailCategorizationService: EmailCategorizationService;
  weeklyConsolidatorService: WeeklyConsolidatorService;
  driveSyncService: DriveSyncService;
};

/**
 * Minimale Server-Deps für Tests (ohne OAuth, ohne Cron-/Job-Services).
 * `startTestServer` ergänzt OAuth und Job-Services automatisch.
 */
export type AppCoreDependencies = Pick<
  AppDependencies,
  "db" | "agentService" | "documentService" | "sql" | "llm" | "toolExecutor"
>;
