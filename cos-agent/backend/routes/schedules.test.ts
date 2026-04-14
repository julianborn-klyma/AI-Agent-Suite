import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { ToolExecutor } from "../services/tools/toolExecutor.ts";
import { SCHEDULE_JOB_TYPES } from "../schedules/constants.ts";
import {
  baseTestEnv,
  createAgentAndDocument,
  startTestServer,
  TEST_JWT_SECRET,
} from "../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import postgres from "postgres";

class FakeLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "[]",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  }
}

async function mintJwt(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

/** cos_llm_calls referenziert cos_users ohne CASCADE — vor User-Löschen aufräumen. */
async function deleteTestUser(sql: postgres.Sql, userId: string) {
  await sql`DELETE FROM cos_llm_calls WHERE user_id = ${userId}::uuid`;
  await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
}

/** run-now queued den Job per queueMicrotask — ohne Warten wäre Cleanup vor insertLlmCall. */
async function waitForUserLlmCalls(sql: postgres.Sql, userId: string, maxMs = 4000) {
  const step = 40;
  for (let waited = 0; waited < maxMs; waited += step) {
    const hit = await sql`
      SELECT 1 FROM cos_llm_calls WHERE user_id = ${userId}::uuid LIMIT 1
    `;
    if (hit.length > 0) return;
    await new Promise((r) => setTimeout(r, step));
  }
}

Deno.test({
  name: "E2E GET /api/schedules — initDefaultSchedules, 5 Job-Typen",
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
        VALUES (${userId}::uuid, 'sched-init@test.local', 'S', 'member', true)
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
        const token = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/schedules`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 200);
        const rows = await res.json() as { job_type: string }[];
        assertEquals(rows.length, SCHEDULE_JOB_TYPES.length);
        const types = new Set(rows.map((r) => r.job_type));
        for (const jt of SCHEDULE_JOB_TYPES) {
          assertEquals(types.has(jt), true);
        }
      } finally {
        shutdown();
      }
    } finally {
      await deleteTestUser(sql, userId);
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/schedules — ohne Auth → 401",
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
        const res = await fetch(`${baseUrl}/api/schedules`);
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
  name: "E2E PATCH /api/schedules/daily_briefing/toggle — is_active",
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
        VALUES (${userId}::uuid, 'sched-toggle@test.local', 'S', 'member', true)
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
        const token = await mintJwt(userId);
        const res = await fetch(
          `${baseUrl}/api/schedules/daily_briefing/toggle`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ is_active: true }),
          },
        );
        assertEquals(res.status, 200);
        const j = await res.json() as {
          job_type: string;
          is_active: boolean;
          updated: boolean;
        };
        assertEquals(j.job_type, "daily_briefing");
        assertEquals(j.is_active, true);
        assertEquals(j.updated, true);
      } finally {
        shutdown();
      }
    } finally {
      await deleteTestUser(sql, userId);
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PATCH /api/schedules/invalid_type/toggle → 400",
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
        VALUES (${userId}::uuid, 'sched-bad@test.local', 'S', 'member', true)
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
        const token = await mintJwt(userId);
        const res = await fetch(
          `${baseUrl}/api/schedules/invalid_type/toggle`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ is_active: true }),
          },
        );
        assertEquals(res.status, 400);
      } finally {
        shutdown();
      }
    } finally {
      await deleteTestUser(sql, userId);
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/schedules/daily_briefing/run-now → started",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      const email = `sched-run-${userId.slice(0, 8)}@test.local`;
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${email}, 'S', 'member', true)
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
        const token = await mintJwt(userId);
        await fetch(`${baseUrl}/api/schedules`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const res = await fetch(
          `${baseUrl}/api/schedules/daily_briefing/run-now`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        assertEquals(res.status, 200);
        const j = await res.json() as { started: boolean; job_type: string };
        assertEquals(j.started, true);
        assertEquals(j.job_type, "daily_briefing");
      } finally {
        shutdown();
      }
    } finally {
      await waitForUserLlmCalls(sql, userId);
      await deleteTestUser(sql, userId);
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/schedules/weekly_consolidator/run-now → 400",
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
        VALUES (${userId}::uuid, 'sched-wnow@test.local', 'S', 'member', true)
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
        const token = await mintJwt(userId);
        await fetch(`${baseUrl}/api/schedules`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const res = await fetch(
          `${baseUrl}/api/schedules/weekly_consolidator/run-now`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        assertEquals(res.status, 400);
      } finally {
        shutdown();
      }
    } finally {
      await deleteTestUser(sql, userId);
      await sql.end({ timeout: 5 });
    }
  },
});
