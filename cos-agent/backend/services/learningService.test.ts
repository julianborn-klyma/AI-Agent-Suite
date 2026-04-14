import { assertEquals, assertStringIncludes } from "@std/assert";
import postgres from "postgres";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import { LearningService } from "./learningService.ts";

function uniqEmail(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}@test.local`;
}

class CaptureLlm implements LlmClient {
  calls = 0;
  constructor(private readonly response: LlmResponse) {}
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    this.calls++;
    return this.response;
  }
}

Deno.test({
  name: "LearningService — extractFromConversation liefert Kandidaten",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${userId}::uuid, ${uniqEmail("ls-extract")}, 'E', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new CaptureLlm({
        content: JSON.stringify([
          {
            category: "preference",
            content: "Bevorzugt morgens Meetings.",
            confidence: 0.82,
            source: "chat",
          },
        ]),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      });
      const svc = new LearningService(db, llm);
      const out = await svc.extractFromConversation({
        userId,
        sessionId: crypto.randomUUID(),
        messages: [
          { role: "user", content: "Wann treffen wir uns?" },
          { role: "assistant", content: "Am liebsten vormittags." },
        ],
      });
      assertEquals(out.length, 1);
      assertEquals(out[0]?.category, "preference");
      assertEquals(llm.calls, 1);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test("LearningService — leere Konversation → kein LLM, leeres Array", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 1 });
  const userId = crypto.randomUUID();
  try {
    await sql`
      INSERT INTO cos_users (id, email, name, role)
      VALUES (${userId}::uuid, ${uniqEmail("ls-empty")}, 'E', 'member')
    `;
    const db = createPostgresDatabaseClient(sql);
    const llm = new CaptureLlm({
      content: "should-not-run",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    });
    const svc = new LearningService(db, llm);
    const out = await svc.extractFromConversation({
      userId,
      sessionId: crypto.randomUUID(),
      messages: [],
    });
    assertEquals(out, []);
    assertEquals(llm.calls, 0);
  } finally {
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});

Deno.test({
  name: "LearningService — consolidateWeekly schreibt learning_summary_*",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${userId}::uuid, ${uniqEmail("ls-week")}, 'W', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      await db.upsertLearning(userId, {
        category: "priority",
        content: "Erst Infra, dann Features.",
        confidence: 0.9,
        source: "chat",
      });
      await db.upsertLearning(userId, {
        category: "priority",
        content: "Security hat Vorrang.",
        confidence: 0.88,
        source: "chat",
      });

      const llm = new CaptureLlm({
        content: "Priorität: Sicherheit und stabile Infrastruktur.",
        input_tokens: 2,
        output_tokens: 4,
        stop_reason: "end_turn",
      });
      const svc = new LearningService(db, llm);
      await svc.consolidateWeekly(userId);

      const rows = await sql`
        SELECT value FROM cos_user_contexts
        WHERE user_id = ${userId}::uuid AND key = ${"learning_summary_priority"}
      ` as { value: string }[];
      assertEquals(rows.length, 1);
      assertStringIncludes(rows[0]!.value, "Priorität");
      assertEquals(llm.calls >= 1, true);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "LearningService — buildLearningContext mit Kategorien",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${userId}::uuid, ${uniqEmail("ls-ctx")}, 'C', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      await db.upsertLearning(userId, {
        category: "commitment",
        content: "Release Ende Q2.",
        confidence: 0.95,
        source: "chat",
      });
      const svc = new LearningService(db, new CaptureLlm({
        content: "x",
        input_tokens: 0,
        output_tokens: 0,
        stop_reason: "end_turn",
      }));
      const block = await svc.buildLearningContext(userId);
      assertStringIncludes(block, "Was ich über dich weiß");
      assertStringIncludes(block, "Commitments");
      assertStringIncludes(block, "Release");
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
