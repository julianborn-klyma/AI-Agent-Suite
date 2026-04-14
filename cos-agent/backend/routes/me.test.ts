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

async function mintTestJwt(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

Deno.test("E2E GET /api/me — JWT, Profil aus DB", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 2 });
  const userId = crypto.randomUUID();
  try {
    await sql`
      INSERT INTO cos_users (id, email, name, role, is_active)
      VALUES (${userId}::uuid, 'me-e2e@test.local', 'E2E User', 'member', true)
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
      const token = await mintTestJwt(userId);
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assertEquals(res.status, 200);
      const json = await res.json() as {
        id: string;
        name: string;
        email: string;
        role: string;
      };
      assertEquals(json.id, userId);
      assertEquals(json.email, "me-e2e@test.local");
      assertEquals(json.role, "member");
    } finally {
      shutdown();
    }
  } finally {
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});

Deno.test("E2E GET /api/me — ohne JWT → 401", async () => {
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
      const res = await fetch(`${baseUrl}/api/me`);
      assertEquals(res.status, 401);
      await res.body?.cancel();
    } finally {
      shutdown();
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});
