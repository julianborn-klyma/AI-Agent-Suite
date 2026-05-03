import { createRequestHandler } from "./app.ts";
import { loadEnv } from "./config/env.ts";
import { createPostgresDatabaseClient } from "./db/databaseClient.ts";
import { registerCronJobs, startAllCrons } from "./cron/index.ts";
import { AgentService } from "./services/agentService.ts";
import { DocumentService } from "./services/documentService.ts";
import { DriveSyncService } from "./services/driveSyncService.ts";
import { EmailCategorizationService } from "./services/emailCategorizationService.ts";
import { EmailStyleService } from "./services/emailStyleService.ts";
import { LearningService } from "./services/learningService.ts";
import { AnthropicClient } from "./services/llm/anthropicClient.ts";
import { OAuthService } from "./services/oauthService.ts";
import { ToolExecutor } from "./services/tools/toolExecutor.ts";
import { WeeklyConsolidatorService } from "./services/weeklyConsolidatorService.ts";
import { BriefingDelivery } from "./services/briefingDelivery.ts";
import { TaskQueueService } from "./services/taskQueueService.ts";
import { PasswordService } from "./services/passwordService.ts";
import { AuditService } from "./services/auditService.ts";
import { TenantService } from "./services/tenantService.ts";
import postgres from "postgres";

const env = await loadEnv();
registerCronJobs(env);

const sql = postgres(env.databaseUrl, { max: 10 });
const db = createPostgresDatabaseClient(sql);
const llm = new AnthropicClient(env.anthropicApiKey);
const toolExecutor = new ToolExecutor(sql);
const documentService = new DocumentService(db, llm);
const agentService = new AgentService(db, llm, toolExecutor, {
  documentService,
});
const auditService = new AuditService(db);
const tenantService = new TenantService(db, auditService);
const oauthService = new OAuthService(db, env, tenantService);
const learningService = new LearningService(db, llm);
const emailStyleService = new EmailStyleService(db, llm, toolExecutor);
const emailCategorizationService = new EmailCategorizationService(
  db,
  llm,
  toolExecutor,
  emailStyleService,
);
const weeklyConsolidatorService = new WeeklyConsolidatorService(
  db,
  llm,
  learningService,
);
const driveSyncService = new DriveSyncService(
  db,
  llm,
  documentService,
  toolExecutor,
);

const briefingDelivery = new BriefingDelivery(env);
const taskQueueService = new TaskQueueService(
  db,
  llm,
  toolExecutor,
  documentService,
  learningService,
  briefingDelivery,
);

const passwordService = new PasswordService();

const deps = {
  db,
  agentService,
  documentService,
  sql,
  llm,
  toolExecutor,
  tenantService,
  oauthService,
  emailStyleService,
  emailCategorizationService,
  weeklyConsolidatorService,
  driveSyncService,
  taskQueueService,
  passwordService,
  auditService,
};

console.log(`cos-agent backend listening on :${env.port}`);
Deno.serve({ hostname: "0.0.0.0", port: env.port }, createRequestHandler(env, deps));
startAllCrons(deps, env);
