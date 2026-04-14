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

Deno.test({
  name: "E2E GET /api/learnings — JWT, nur eigene Einträge",
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
        VALUES (${userId}::uuid, 'learn-e2e@test.local', 'L', 'member', true)
      `;
      await sql`
        INSERT INTO cos_learnings (user_id, category, content, source, confidence)
        VALUES (${userId}::uuid, 'preference', 'Trinkt gern Matcha', 'chat', 0.9)
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
        const res = await fetch(`${baseUrl}/api/learnings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 200);
        const rows = await res.json() as { content: string }[];
        assertEquals(rows.length >= 1, true);
        assertEquals(rows.some((r) => r.content.includes("Matcha")), true);
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
  name: "E2E PATCH /api/learnings/:id/confirm",
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
        VALUES (${userId}::uuid, 'learn-confirm@test.local', 'L', 'member', true)
      `;
      const ins = await sql`
        INSERT INTO cos_learnings (user_id, category, content, source, confidence)
        VALUES (${userId}::uuid, 'project', 'Roadmap Q3', 'chat', 0.85)
        RETURNING id::text AS id
      ` as { id: string }[];
      const learningId = ins[0]!.id;
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
          `${baseUrl}/api/learnings/${learningId}/confirm`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        assertEquals(res.status, 200);
        const j = await res.json() as { confirmed: boolean };
        assertEquals(j.confirmed, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
