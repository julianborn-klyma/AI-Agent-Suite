import { assertEquals } from "@std/assert";
import postgres from "postgres";
import {
  createPostgresDatabaseClient,
} from "../../db/databaseClient.ts";
import { runMigrations } from "../../db/migrate.ts";
import { resolveTestDatabaseUrl } from "../../test_database_url.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../llm/llmTypes.ts";
import { FirmBrainService } from "./FirmBrainService.ts";

function uniqEmail(tag: string) {
  return `firmbrain.${tag}.${crypto.randomUUID()}@test.local`;
}

class FakeLlm implements LlmClient {
  constructor(private readonly content: string) {}
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: this.content,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    };
  }
}

async function createUser(sql: ReturnType<typeof postgres>, tag: string) {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO cos_users (id, email, name, role)
    VALUES (${id}::uuid, ${uniqEmail(tag)}, ${tag}, 'member')
  `;
  return id;
}

async function getTenantId(sql: ReturnType<typeof postgres>): Promise<string> {
  const rows =
    await sql`SELECT id::text FROM cos_tenants WHERE slug = 'klyma' LIMIT 1`;
  return rows[0]!.id as string;
}

// ── extractFromChat: leere Konversation → kein LLM ───────────────────────

Deno.test({
  name: "FirmBrainService — leere Messages → kein Insight gespeichert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = await createUser(sql, "fb-empty");
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new FirmBrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      await svc.extractFromChat({
        tenantId,
        userId,
        messages: [],
      });

      const insights = await svc.listInsights({ tenantId });
      assertEquals(
        insights.filter((i) => i.source_user_id === userId).length,
        0,
      );
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── extractFromChat: LLM liefert valide Insights ─────────────────────────

Deno.test({
  name: "FirmBrainService — extractFromChat speichert valide Insights",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = await createUser(sql, "fb-extract");
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm(
        JSON.stringify([
          {
            category: "person",
            content: "Hans Meier ist Betriebsleiter seit 2019.",
            confidence: 0.9,
          },
          {
            category: "company",
            content: "KLYMA produziert Aluminium-Extrusionsprofile.",
            confidence: 0.85,
          },
        ]),
      );
      const svc = new FirmBrainService(db, llm);
      const tenantId = await getTenantId(sql);

      await svc.extractFromChat({
        tenantId,
        userId,
        messages: [
          { role: "user", content: "Wer ist Betriebsleiter?" },
          {
            role: "assistant",
            content: "Hans Meier ist Betriebsleiter seit 2019.",
          },
        ],
      });

      const insights = await svc.listInsights({ tenantId });
      const mine = insights.filter((i) => i.source_user_id === userId);
      assertEquals(mine.length, 2);

      const categories = mine.map((i) => i.category).sort();
      assertEquals(categories, ["company", "person"]);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── extractFromChat: ungültige Kategorie wird ignoriert ──────────────────

Deno.test({
  name: "FirmBrainService — ungültige Kategorie wird übersprungen",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = await createUser(sql, "fb-invalid-cat");
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm(
        JSON.stringify([
          { category: "unknown_category", content: "Irgendwas.", confidence: 0.7 },
          { category: "person", content: "Peter ist PM.", confidence: 0.9 },
        ]),
      );
      const svc = new FirmBrainService(db, llm);
      const tenantId = await getTenantId(sql);

      await svc.extractFromChat({
        tenantId,
        userId,
        messages: [{ role: "user", content: "Test" }],
      });

      const insights = await svc.listInsights({ tenantId });
      const mine = insights.filter((i) => i.source_user_id === userId);
      assertEquals(mine.length, 1);
      assertEquals(mine[0]!.category, "person");
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── suppressInsight / unsuppressInsight ───────────────────────────────────

Deno.test({
  name: "FirmBrainService — Admin kann Insight supprimieren und reaktivieren",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = await createUser(sql, "fb-suppress");
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm(
        JSON.stringify([
          { category: "decision", content: "Budget Q1 ist 50k.", confidence: 0.8 },
        ]),
      );
      const svc = new FirmBrainService(db, llm);
      const tenantId = await getTenantId(sql);

      await svc.extractFromChat({
        tenantId,
        userId,
        messages: [{ role: "user", content: "Budget?" }],
      });

      const before = await svc.listInsights({ tenantId });
      const mine = before.filter((i) => i.source_user_id === userId);
      assertEquals(mine.length, 1);
      assertEquals(mine[0]!.admin_suppressed, false);

      await svc.suppressInsight(mine[0]!.id);
      const afterSuppress = await svc.listInsights({
        tenantId,
        adminSuppressed: true,
      });
      const suppressed = afterSuppress.filter((i) => i.source_user_id === userId);
      assertEquals(suppressed.length, 1);
      assertEquals(suppressed[0]!.admin_suppressed, true);

      await svc.unsuppressInsight(mine[0]!.id);
      const afterUnsuppress = await svc.listInsights({ tenantId });
      const unsuppressed = afterUnsuppress.filter(
        (i) => i.source_user_id === userId,
      );
      assertEquals(unsuppressed[0]!.admin_suppressed, false);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── deleteInsight ─────────────────────────────────────────────────────────

Deno.test({
  name: "FirmBrainService — deleteInsight deaktiviert den Eintrag",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = await createUser(sql, "fb-delete");
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm(
        JSON.stringify([
          { category: "relationship", content: "Hans kennt Klaus.", confidence: 0.7 },
        ]),
      );
      const svc = new FirmBrainService(db, llm);
      const tenantId = await getTenantId(sql);

      await svc.extractFromChat({
        tenantId,
        userId,
        messages: [{ role: "user", content: "Wer kennt wen?" }],
      });

      const before = await svc.listInsights({ tenantId });
      const mine = before.filter((i) => i.source_user_id === userId);
      assertEquals(mine.length, 1);

      await svc.deleteInsight(mine[0]!.id);

      const after = await svc.listInsights({ tenantId });
      assertEquals(after.filter((i) => i.source_user_id === userId).length, 0);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
