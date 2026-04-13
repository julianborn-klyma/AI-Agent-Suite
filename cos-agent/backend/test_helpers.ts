import { createRequestHandler } from "./app.ts";
import type { AppCoreDependencies, AppDependencies } from "./app_deps.ts";
import { loadEnv, resetEnvCacheForTests } from "./config/env.ts";
import { OAuthService } from "./services/oauthService.ts";
import { resolveTestDatabaseUrl } from "./test_database_url.ts";

const TEST_SERVICE_TOKEN = "test-service-token-32-chars-minimum!!";
const TEST_JWT_SECRET = "test-jwt-secret-32-chars-minimum!!!!";

const TEST_ENCRYPTION_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

export { resolveTestDatabaseUrl } from "./test_database_url.ts";

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

export async function startTestServer(
  vars: Record<string, string>,
  deps?: AppDependencies | AppCoreDependencies,
  options?: StartTestServerOptions,
): Promise<{ baseUrl: string; shutdown: () => void }> {
  return await withTestEnv(vars, async () => {
    const env = await loadEnv();
    let resolvedDeps: AppDependencies | undefined = deps as
      | AppDependencies
      | undefined;
    if (deps && (!("oauthService" in deps) || !deps.oauthService)) {
      const core = deps as AppCoreDependencies;
      resolvedDeps = {
        ...core,
        oauthService: new OAuthService(core.db, env),
      };
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
        const hook = options?.onShutdown;
        if (hook) {
          void Promise.resolve(hook());
        }
      },
    };
  });
}

export { TEST_JWT_SECRET, TEST_SERVICE_TOKEN };
