import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
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

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

Deno.test({
  name: "E2E GET /api/onboarding/status — ohne Auth → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const res = await fetch(`${baseUrl}/api/onboarding/status`);
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
  name: "E2E GET /api/onboarding/status → OnboardingStatus",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${uid}::uuid, 'onb-api-st@test.local', 'AB', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/onboarding/status`, {
          headers: authHeader(token),
        });
        assertEquals(res.status, 200);
        const body = await res.json() as {
          completed: boolean;
          next_step: string;
          steps: { profile: boolean };
          user_created_at: string;
        };
        assertEquals(typeof body.user_created_at, "string");
        assertEquals(body.completed, false);
        assertEquals(typeof body.steps.profile, "boolean");
        assertEquals(["profile", "connections", "chat", "done"].includes(body.next_step), true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/onboarding/profile — ohne role → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${uid}::uuid, 'onb-api-pr@test.local', 'AB', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/onboarding/profile`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ team: "x" }),
        });
        assertEquals(res.status, 400);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/onboarding/profile — valid → Kontexte gesetzt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${uid}::uuid, 'onb-api-pok@test.local', 'AB', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/onboarding/profile`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            role: "Projektleiter",
            team: "A+B",
            priorities: "Ship",
            communication_style: "kurz",
            work_style: "morgens",
          }),
        });
        assertEquals(res.status, 200);
        const body = await res.json() as { saved: boolean };
        assertEquals(body.saved, true);
        const ctx = await db.listUserContexts(uid);
        const keys = new Set(ctx.map((c) => c.key));
        assertEquals(keys.has("role"), true);
        assertEquals(keys.has("team"), true);
        assertEquals(keys.has("current_focus"), true);
        assertEquals(keys.has("communication_preference"), true);
        assertEquals(keys.has("work_style"), true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/onboarding/complete → { completed: true }",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${uid}::uuid, 'onb-api-cmp@test.local', 'AB', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/onboarding/complete`, {
          method: "POST",
          headers: authHeader(token),
        });
        assertEquals(res.status, 200);
        const body = await res.json() as { completed: boolean };
        assertEquals(body.completed, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
