import { assertEquals } from "@std/assert";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import { ToolExecutor } from "./tools/toolExecutor.ts";
import { PersonalWikiEnrichmentService } from "./personalWikiEnrichmentService.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import postgres from "postgres";

class PatchLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: JSON.stringify({
        patches: [{
          slug: "me-index",
          append_markdown: "- **E2E:** Signal aus Test-Slack-Zusammenfassung erkannt.",
        }],
      }),
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    };
  }
}

Deno.test("PersonalWikiEnrichmentService — patcht nur me-* nach Signalen", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 2 });
  const userId = crypto.randomUUID();
  const tidRows = await sql`
    SELECT id::text AS id FROM public.cos_tenants WHERE slug = 'klyma' LIMIT 1
  ` as { id: string }[];
  const tid = tidRows[0]!.id;
  const dayKey = new Date().toISOString().slice(0, 10);
  try {
    await sql`
      INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
      VALUES (
        ${userId}::uuid,
        'pwiki-enrich@test.local',
        'P',
        'member',
        true,
        ${tid}::uuid
      )
    `;
    const db = createPostgresDatabaseClient(sql);
    await db.upsertUserContext({
      userId,
      key: `slack_summary_${dayKey}`,
      value: "Heute: Team hat Release besprochen.",
    });
    const svc = new PersonalWikiEnrichmentService(
      db,
      sql,
      new PatchLlm(),
      new ToolExecutor(),
    );
    const out = await svc.runForUser(userId);
    assertEquals(out.skipped, false);
    assertEquals((out.patches_applied ?? 0) >= 1, true);
    const body = await sql`
      SELECT body_md FROM app.wiki_pages
      WHERE tenant_id = ${tid}::uuid AND owner_user_id = ${userId}::uuid AND slug = 'me-index'
    ` as { body_md: string }[];
    assertEquals(body.length, 1);
    assertEquals(body[0]!.body_md.includes("E2E"), true);
  } finally {
    await sql`DELETE FROM cos_user_contexts WHERE user_id = ${userId}::uuid`;
    await sql`DELETE FROM app.wiki_pages WHERE owner_user_id = ${userId}::uuid`;
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});
