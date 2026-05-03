import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { runMigrations } from "./migrate.ts";
import { setAppTenantSession } from "./appTenantSession.ts";

Deno.test("appTenantSession — set_config in Transaction ohne Fehler", async () => {
  const url = resolveTestDatabaseUrl();
  const sql = postgres(url, { max: 1 });
  try {
    await runMigrations(url);
    const rows = await sql`
      SELECT id::text AS id FROM public.cos_tenants WHERE slug = 'klyma' LIMIT 1
    ` as { id: string }[];
    assertEquals(rows.length, 1);
    const tenantId = rows[0]!.id;

    await sql.begin(async (tx) => {
      await setAppTenantSession(tx, tenantId, true);
      const n = await tx`
        SELECT count(*)::int AS c FROM app.tasks
      ` as { c: number }[];
      assertEquals(n[0]!.c, 0);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});
