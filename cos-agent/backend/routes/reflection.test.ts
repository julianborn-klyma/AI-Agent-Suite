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

class ReflectLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: JSON.stringify([
        {
          category: "preference",
          content: "Mag kurze Meetings.",
          confidence: 0.75,
          source: "reflection",
        },
      ]),
      input_tokens: 1,
      output_tokens: 1,
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

Deno.test("POST /api/reflection/daily — speichert Kontext + Learnings", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 2 });
  const userId = crypto.randomUUID();
  const tidRows = await sql`
    SELECT id::text AS id FROM public.cos_tenants WHERE slug = 'klyma' LIMIT 1
  ` as { id: string }[];
  const tid = tidRows[0]!.id;
  try {
    await sql`
      INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
      VALUES (
        ${userId}::uuid,
        'refl-daily@test.local',
        'R',
        'member',
        true,
        ${tid}::uuid
      )
    `;
    const db = createPostgresDatabaseClient(sql);
    const llm = new ReflectLlm();
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
      const res = await fetch(`${baseUrl}/api/reflection/daily`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          note: "Heute Fokus auf Wiki-Automatisierung.",
          mood: "motiviert",
        }),
      });
      assertEquals(res.status, 200);
      const j = await res.json() as { ok: boolean; learnings_saved: number };
      assertEquals(j.ok, true);
      assertEquals(j.learnings_saved >= 1, true);
      const day = new Date().toISOString().slice(0, 10);
      const ctx = await sql`
        SELECT value FROM cos_user_contexts
        WHERE user_id = ${userId}::uuid AND key = ${`daily_reflection_${day}`}
      ` as { value: string }[];
      assertEquals(ctx.length, 1);
      assertEquals(ctx[0]!.value.includes("Wiki"), true);
    } finally {
      shutdown();
    }
  } finally {
    await sql`DELETE FROM cos_learnings WHERE user_id = ${userId}::uuid`;
    await sql`DELETE FROM cos_user_contexts WHERE user_id = ${userId}::uuid`;
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});
