import { assert, assertEquals } from "@std/assert";
import * as jose from "jose";
import type { AppCoreDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { OAuthService } from "../services/oauthService.ts";
import { ToolExecutor } from "../services/tools/toolExecutor.ts";
import {
  baseTestEnv,
  createAgentAndDocument,
  startTestServer,
  TEST_JWT_SECRET,
} from "../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import postgres from "postgres";

async function mintJwt(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

class FakeLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "x",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    };
  }
}

function oauthStubEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    port: 8787,
    databaseUrl: "postgres://localhost/x",
    serviceToken: "test-service-token-32-chars-minimum!!",
    jwtSecret: TEST_JWT_SECRET,
    corsOrigins: ["http://localhost:5173"],
    anthropicApiKey: "sk-ant-test-dummy-key-20chars",
    googleClientId: "test-google-client",
    googleClientSecret: "test-google-secret",
    googleRedirectUri: "http://localhost:8090/api/auth/google/callback",
    frontendUrl: "http://localhost:5174",
    emailServiceUrl: null,
    emailServiceToken: null,
    slackClientId: "",
    slackClientSecret: "",
    slackRedirectUri: "http://localhost:8090/api/auth/slack/callback",
    ...overrides,
  };
}

function coreDeps(sql: ReturnType<typeof postgres>): AppCoreDependencies {
  const db = createPostgresDatabaseClient(sql);
  const llm = new FakeLlm();
  const toolExecutor = new ToolExecutor();
  const { agentService, documentService } = createAgentAndDocument(
    db,
    llm,
    toolExecutor,
  );
  return { db, agentService, documentService, sql, llm, toolExecutor };
}

Deno.test({
  name: "E2E GET /api/connections — ohne Auth → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const res = await fetch(`${baseUrl}/api/connections`);
        assertEquals(res.status, 401);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/connections — frischer User → google/notion false",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`conn-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/connections`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        assertEquals(res.status, 200);
        const j = await res.json() as {
          google: boolean;
          notion: boolean;
          slack: boolean;
        };
        assertEquals(j.google, false);
        assertEquals(j.notion, false);
        assertEquals(j.slack, false);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/connections/google → 200 disconnected",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`dcg-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/connections/google`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        assertEquals(res.status, 200);
        const j = await res.json() as { disconnected: boolean };
        assertEquals(j.disconnected, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/connections/invalidprovider → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`inv-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/connections/invalidprovider`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        assertEquals(res.status, 400);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/auth/google — ohne Token → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({
          DATABASE_URL: url,
          GOOGLE_CLIENT_ID: "cid",
          GOOGLE_CLIENT_SECRET: "sec",
        }),
        d,
      );
      try {
        const res = await fetch(`${baseUrl}/api/auth/google`);
        assertEquals(res.status, 401);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/auth/google/callback — ungültiger state → redirect error",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({
          DATABASE_URL: url,
          GOOGLE_CLIENT_ID: "cid",
          GOOGLE_CLIENT_SECRET: "sec",
          FRONTEND_URL: "http://localhost:5999",
        }),
        d,
      );
      try {
        const res = await fetch(
          `${baseUrl}/api/auth/google/callback?code=abc&state=nicht-existierend`,
          { redirect: "manual" },
        );
        assertEquals(res.status, 302);
        const loc = res.headers.get("Location") ?? "";
        assert(loc.includes("error=google_failed"), loc);
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/auth/google/callback — abgelaufener state → redirect error",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const state = "st-expired-" + crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`exp-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      await sql`
        INSERT INTO cos_oauth_states (state, user_id, provider, expires_at)
        VALUES (${state}, ${userId}::uuid, 'google', NOW() - INTERVAL '1 hour')
      `;
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({
          DATABASE_URL: url,
          GOOGLE_CLIENT_ID: "cid",
          GOOGLE_CLIENT_SECRET: "sec",
          FRONTEND_URL: "http://localhost:5999",
        }),
        d,
      );
      try {
        const res = await fetch(
          `${baseUrl}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
          { redirect: "manual" },
        );
        assertEquals(res.status, 302);
        const loc = res.headers.get("Location") ?? "";
        assert(loc.includes("error=google_failed"), loc);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_oauth_states WHERE state = ${state}`;
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT /api/connections/notion — ohne secret_ Prefix → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`nt-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/connections/notion`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: "public_xyz" }),
        });
        assertEquals(res.status, 400);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT /api/connections/notion — leerer token → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`nte-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      const d = coreDeps(sql);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/connections/notion`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: "   " }),
        });
        assertEquals(res.status, 400);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

class OAuthNotionInvalid extends OAuthService {
  override async saveNotionToken(_userId: string, _token: string): Promise<void> {
    throw new Error("Ungültiger Notion Token");
  }
}

Deno.test({
  name: "E2E PUT /api/connections/notion — Notion 401 (mock) → 422",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`n422-${userId.slice(0, 8)}@t.local`}, 'C', 'member', true)
      `;
      const base = coreDeps(sql);
      const oauthService = new OAuthNotionInvalid(
        base.db,
        oauthStubEnv({
          googleClientId: "",
          googleClientSecret: "",
          googleRedirectUri: "http://localhost/x",
        }),
      );
      const d = { ...base, oauthService };
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        d,
      );
      try {
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/connections/notion`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: "secret_test_token_xxxxxxxx" }),
        });
        assertEquals(res.status, 422);
        const j = await res.json() as { error: string };
        assert(j.error.includes("Ungültiger Notion Token"));
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
