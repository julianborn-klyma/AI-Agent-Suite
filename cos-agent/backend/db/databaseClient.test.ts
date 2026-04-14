import { assertEquals, assertRejects } from "@std/assert";
import postgres from "postgres";
import {
  createPostgresDatabaseClient,
  LearningOwnershipError,
} from "./databaseClient.ts";
import { runMigrations } from "./migrate.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";

function uniqEmail(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}@test.local`;
}

Deno.test({
  name: "DatabaseClient — upsertLearning legt neues Learning an",
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
        VALUES (${userId}::uuid, ${uniqEmail("learn-db-1")}, 'L', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const row = await db.upsertLearning(userId, {
        category: "preference",
        content: "Mag kurze Sätze.",
        source: "chat",
        confidence: 0.9,
      });
      assertEquals(row.user_id, userId);
      assertEquals(row.category, "preference");
      assertEquals(row.times_confirmed, 1);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "DatabaseClient — ähnlicher Content merged (times_confirmed++)",
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
        VALUES (${userId}::uuid, ${uniqEmail("learn-db-2")}, 'L', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const base =
        "Dies ist ein längerer Basistext für die ersten fünfzig Zeichen Merge";
      const a = await db.upsertLearning(userId, {
        category: "project",
        content: base + " version one",
        source: "chat",
      });
      const b = await db.upsertLearning(userId, {
        category: "project",
        content: base + " version two",
        source: "chat",
      });
      assertEquals(a.id, b.id);
      assertEquals(b.times_confirmed >= 2, true);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "DatabaseClient — getLearnings minConfidence",
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
        VALUES (${userId}::uuid, ${uniqEmail("learn-db-3")}, 'L', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      await db.upsertLearning(userId, {
        category: "financial",
        content: "Low conf",
        confidence: 0.5,
        source: "chat",
      });
      await db.upsertLearning(userId, {
        category: "financial",
        content: "High conf distinct text xyz",
        confidence: 0.85,
        source: "chat",
      });
      const rows = await db.getLearnings(userId, {
        activeOnly: true,
        minConfidence: 0.6,
        limit: 20,
      });
      assertEquals(rows.every((r) => r.confidence >= 0.6), true);
      assertEquals(rows.some((r) => r.content.includes("xyz")), true);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "DatabaseClient — confirmLearning falsche userId → Ownership-Error",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES
          (${owner}::uuid, ${uniqEmail("learn-own")}, 'O', 'member'),
          (${other}::uuid, ${uniqEmail("learn-oth")}, 'P', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const l = await db.upsertLearning(owner, {
        category: "commitment",
        content: "Einzigartiger Commitment-Text",
        source: "chat",
      });
      await assertRejects(
        async () => {
          await db.confirmLearning(l.id, other);
        },
        LearningOwnershipError,
      );
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${owner}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${other}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
