import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { runMigrations } from "./migrate.ts";

const EXPECTED_TABLES = [
  "agent_configs",
  "cos_conversations",
  "cos_llm_calls",
  "cos_oauth_states",
  "cos_schedules",
  "cos_user_contexts",
  "cos_users",
  "schema_migrations",
] as const;

const EXPECTED_MIGRATION_FILES = [
  "001_initial.sql",
  "002_complete_schema.sql",
  "003_agent_tools_enabled.sql",
  "004_default_agent_template.sql",
  "005_oauth_states.sql",
] as const;

Deno.test({
  name: "Migration-Runner — 001–005, schema_migrations, Idempotenz",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    const sql = postgres(url, { max: 1 });
    try {
      await runMigrations(url);

      for (const table of EXPECTED_TABLES) {
        const rows = await sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${table}
        `;
        assertEquals(rows.length, 1, `Tabelle fehlt: ${table}`);
      }

      const applied = await sql`
        SELECT name FROM schema_migrations ORDER BY name
      ` as { name: string }[];
      assertEquals(
        applied.map((r) => r.name),
        [...EXPECTED_MIGRATION_FILES],
      );

      // Zweiter Lauf: keine Doppel-Ausführung, keine Fehler
      await runMigrations(url);

      const appliedAfter = await sql`
        SELECT name FROM schema_migrations ORDER BY name
      ` as { name: string }[];
      assertEquals(
        appliedAfter.map((r) => r.name),
        [...EXPECTED_MIGRATION_FILES],
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});
