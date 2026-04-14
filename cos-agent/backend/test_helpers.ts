import { createRequestHandler } from "./app.ts";
import type { AppCoreDependencies, AppDependencies } from "./app_deps.ts";
import type { DatabaseClient } from "./db/databaseClient.ts";
import { loadEnv, resetEnvCacheForTests } from "./config/env.ts";
import { AgentService } from "./services/agentService.ts";
import { DocumentService } from "./services/documentService.ts";
import { DriveSyncService } from "./services/driveSyncService.ts";
import { EmailCategorizationService } from "./services/emailCategorizationService.ts";
import { EmailStyleService } from "./services/emailStyleService.ts";
import { LearningService } from "./services/learningService.ts";
import type { LlmClient } from "./services/llm/llmTypes.ts";
import { OAuthService } from "./services/oauthService.ts";
import type { ToolExecutor } from "./services/tools/toolExecutor.ts";
import { WeeklyConsolidatorService } from "./services/weeklyConsolidatorService.ts";
import { BriefingDelivery } from "./services/briefingDelivery.ts";
import { TaskQueueService } from "./services/taskQueueService.ts";
import { PasswordService } from "./services/passwordService.ts";
import { AuditService } from "./services/auditService.ts";
import { TenantService } from "./services/tenantService.ts";
import { resolveTestDatabaseUrl } from "./test_database_url.ts";

const TEST_SERVICE_TOKEN = "test-service-token-32-chars-minimum!!";
const TEST_JWT_SECRET = "test-jwt-secret-32-chars-minimum!!!!";

const TEST_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

export { resolveTestDatabaseUrl } from "./test_database_url.ts";

/** Einheitlicher AgentService + DocumentService für E2E-Tests. */
export function createAgentAndDocument(
  db: DatabaseClient,
  llm: LlmClient,
  toolExecutor: ToolExecutor,
): { agentService: AgentService; documentService: DocumentService } {
  const documentService = new DocumentService(db, llm);
  const agentService = new AgentService(db, llm, toolExecutor, {
    documentService,
  });
  return { agentService, documentService };
}

/** Ergänzt Test-Deps um Cron-/Schedule-Services (optional in Einzeltests). */
export function createJobServices(d: {
  db: DatabaseClient;
  llm: LlmClient;
  toolExecutor: ToolExecutor;
  documentService: DocumentService;
}): Pick<
  AppDependencies,
  | "emailStyleService"
  | "emailCategorizationService"
  | "weeklyConsolidatorService"
  | "driveSyncService"
> {
  const learningService = new LearningService(d.db, d.llm);
  const emailStyleService = new EmailStyleService(d.db, d.llm, d.toolExecutor);
  return {
    emailStyleService,
    emailCategorizationService: new EmailCategorizationService(
      d.db,
      d.llm,
      d.toolExecutor,
      emailStyleService,
    ),
    weeklyConsolidatorService: new WeeklyConsolidatorService(
      d.db,
      d.llm,
      learningService,
    ),
    driveSyncService: new DriveSyncService(
      d.db,
      d.llm,
      d.documentService,
      d.toolExecutor,
    ),
  };
}

export function baseTestEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: resolveTestDatabaseUrl(),
    SERVICE_TOKEN: TEST_SERVICE_TOKEN,
    JWT_SECRET: TEST_JWT_SECRET,
    CORS_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
    ANTHROPIC_API_KEY: "sk-ant-test-dummy-key-20chars",
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    PORT: "8787",
    ...overrides,
  };
}

export async function withTestEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  resetEnvCacheForTests();
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    previous.set(key, Deno.env.get(key));
  }
  for (const [k, v] of Object.entries(vars)) {
    Deno.env.set(k, v);
  }
  try {
    return await fn();
  } finally {
    for (const [k, old] of previous) {
      if (old === undefined) Deno.env.delete(k);
      else Deno.env.set(k, old);
    }
    resetEnvCacheForTests();
  }
}

export type StartTestServerOptions = {
  /** Z. B. Postgres-Client nach Server-Stopp beenden. */
  onShutdown?: () => void | Promise<void>;
};

/** Was `startTestServer` akzeptiert: Kern-Deps plus optional OAuth / Job-Services. */
export type TestServerInputDeps = AppCoreDependencies &
  Partial<
    Pick<
      AppDependencies,
      | "oauthService"
      | "emailStyleService"
      | "emailCategorizationService"
      | "weeklyConsolidatorService"
      | "driveSyncService"
      | "taskQueueService"
      | "passwordService"
      | "auditService"
      | "tenantService"
    >
  >;

export async function startTestServer(
  vars: Record<string, string>,
  deps?: TestServerInputDeps,
  options?: StartTestServerOptions,
): Promise<{ baseUrl: string; shutdown: () => void }> {
  /** Env muss bis zum Server-Stopp gelten (z. B. ENCRYPTION_KEY für Credential-Encrypt). */
  resetEnvCacheForTests();
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    previous.set(key, Deno.env.get(key));
  }
  for (const [k, v] of Object.entries(vars)) {
    Deno.env.set(k, v);
  }
  let envRestored = false;
  const restoreEnv = (): void => {
    if (envRestored) return;
    envRestored = true;
    for (const [k, old] of previous) {
      if (old === undefined) Deno.env.delete(k);
      else Deno.env.set(k, old);
    }
    resetEnvCacheForTests();
  };

  try {
    const env = await loadEnv();
    let resolvedDeps: AppDependencies | undefined;
    if (deps) {
      const core = deps;
      const auditService = core.auditService ?? new AuditService(core.db);
      const tenantService = core.tenantService ??
        new TenantService(core.db, auditService);
      const oauthService = core.oauthService ??
        new OAuthService(core.db, env, tenantService);
      const withOauth = { ...core, oauthService, tenantService } as AppDependencies;
      const jobs = createJobServices(withOauth);
      const learningForTasks = new LearningService(core.db, core.llm);
      const taskQueueService =
        core.taskQueueService ??
        new TaskQueueService(
          core.db,
          core.llm,
          core.toolExecutor,
          core.documentService,
          learningForTasks,
          new BriefingDelivery(env),
        );
      const passwordService = core.passwordService ?? new PasswordService();
      resolvedDeps = {
        ...withOauth,
        ...jobs,
        taskQueueService,
        passwordService,
        auditService,
        ...(core.emailCategorizationService
          ? { emailCategorizationService: core.emailCategorizationService }
          : {}),
        ...(core.emailStyleService
          ? { emailStyleService: core.emailStyleService }
          : {}),
      } as AppDependencies;
    }
    const handler = createRequestHandler(env, resolvedDeps);
    const ac = new AbortController();
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port: 0,
      signal: ac.signal,
    }, handler);
    const addr = server.addr;
    if (!("port" in addr)) {
      throw new Error("Erwarte TCP-Adresse für Test-Server");
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    return {
      baseUrl,
      shutdown: () => {
        ac.abort();
        restoreEnv();
        const hook = options?.onShutdown;
        if (hook) {
          void Promise.resolve(hook());
        }
      },
    };
  } catch (e) {
    restoreEnv();
    throw e;
  }
}

export { TEST_JWT_SECRET, TEST_SERVICE_TOKEN };
