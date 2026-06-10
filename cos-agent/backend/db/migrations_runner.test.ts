import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { runMigrations } from "./migrate.ts";

const EXPECTED_TABLES = [
  "agent_configs",
  "brain_conflicts",
  "brain_entries",
  "brain_project_members",
  "brain_projects",
  "cos_audit_log",
  "cos_conversations",
  "cos_document_chunks",
  "cos_documents",
  "cos_learnings",
  "cos_llm_calls",
  "cos_login_attempts",
  "cos_oauth_states",
  "cos_schedules",
  "cos_tenants",
  "cos_user_contexts",
  "cos_users",
  "cos_task_queue",
  "firm_insights",
  "schema_migrations",
] as const;

const EXPECTED_MIGRATION_FILES = [
  "001_initial.sql",
  "002_complete_schema.sql",
  "003_agent_tools_enabled.sql",
  "004_default_agent_template.sql",
  "005_oauth_states.sql",
  "006_learnings.sql",
  "007_documents.sql",
  "008_schedules_extended.sql",
  "009_password_and_oauth_login.sql",
  "010_task_queue.sql",
  "011_password_security.sql",
  "012_tenants.sql",
  "013_onboarding.sql",
  "014_app_schema_tasks_wiki.sql",
  "015_personal_wiki_schedule_backfill.sql",
  "016_brain.sql",
] as const;

/** Kern-Tabellen unter Schema app (SaaS-Domäne, tenant_id + RLS). */
const EXPECTED_APP_TABLES = [
  "projects",
  "task_assignees",
  "task_teams",
  "tasks",
  "team_members",
  "teams",
  "wiki_links",
  "wiki_pages",
] as const;

Deno.test({
  name: "Migration-Runner — 001–016, schema_migrations, Idempotenz",
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

      const tenantCol = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cos_users'
          AND column_name = 'tenant_id'
      `;
      assertEquals(tenantCol.length, 1);

      const onboardCol = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cos_users'
          AND column_name = 'onboarding_completed'
      `;
      assertEquals(onboardCol.length, 1);

      const projectIdCol = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cos_conversations'
          AND column_name = 'project_id'
      `;
      assertEquals(projectIdCol.length, 1, "cos_conversations.project_id fehlt");

      const appSchema = await sql`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name = 'app'
      `;
      assertEquals(appSchema.length, 1, "Schema app fehlt");

      for (const table of EXPECTED_APP_TABLES) {
        const rows = await sql`
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'app' AND table_name = ${table}
        `;
        assertEquals(rows.length, 1, `app.${table} fehlt`);
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
