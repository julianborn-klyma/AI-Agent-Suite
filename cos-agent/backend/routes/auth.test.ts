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

Deno.test({
  name: "E2E POST /api/auth/login — gültige Email → 200 + token",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-ok-${userId.slice(0, 8)}@test.local`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${email}, 'Login OK', 'member', true)
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "" }),
        });
        assertEquals(res.status, 200);
        const j = await res.json() as {
          token: string;
          user: { id: string; email: string; role: string };
        };
        assertEquals(typeof j.token, "string");
        assertEquals(j.user.id, userId);
        assertEquals(j.user.email, email);
        const secret = new TextEncoder().encode(TEST_JWT_SECRET);
        const { payload } = await jose.jwtVerify(j.token, secret);
        assertEquals(payload.sub, userId);
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
  name: "E2E POST /api/auth/login — unbekannte Email → 401",
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "niemand@existiert.nicht" }),
        });
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
  name: "E2E POST /api/auth/login — inaktiver User → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-inact-${userId.slice(0, 8)}@test.local`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${email}, 'Inaktiv', 'member', false)
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        assertEquals(res.status, 401);
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
