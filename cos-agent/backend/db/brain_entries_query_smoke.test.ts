import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { createPostgresDatabaseClient } from "./databaseClient.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";

Deno.test({
  name: "getBrainEntriesForProject — ohne type-Filter (kein 42P18)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const sql = postgres(resolveTestDatabaseUrl(), { max: 1 });
    const db = createPostgresDatabaseClient(sql);
    try {
      const rows = await sql`
        SELECT id::text AS id FROM brain_projects WHERE is_active = true LIMIT 1
      ` as { id: string }[];
      if (!rows[0]) return;
      const entries = await db.getBrainEntriesForProject(rows[0].id, {
        activeOnly: true,
      });
      assertEquals(Array.isArray(entries), true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});
