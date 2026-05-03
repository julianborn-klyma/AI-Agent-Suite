import { assertEquals } from "@std/assert";
import { createPostgresDatabaseClient } from "../../db/databaseClient.ts";
import { runMigrations } from "../../db/migrate.ts";
import { ToolExecutor } from "./toolExecutor.ts";
import { resolveTestDatabaseUrl } from "../../test_database_url.ts";
import postgres from "postgres";

Deno.test("workspace_wiki + workspace_tasks — Tenant-Lesezugriff via ToolExecutor(sql)", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 2 });
  const tidRows = await sql`
    SELECT id::text AS id FROM public.cos_tenants WHERE slug = 'klyma' LIMIT 1
  ` as { id: string }[];
  const tenantId = tidRows[0]!.id;
  const userId = crypto.randomUUID();
  try {
    await sql`
      INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
      VALUES (
        ${userId}::uuid,
        'tool-ws@test.local',
        'Tool WS',
        'member',
        true,
        ${tenantId}::uuid
      )
    `;

    const db = createPostgresDatabaseClient(sql);
    const exec = new ToolExecutor(sql);

    await sql`
      INSERT INTO app.projects (tenant_id, name, description)
      VALUES (${tenantId}::uuid, 'T-Proj', NULL)
    `;
    const proj = await sql`
      SELECT id::text FROM app.projects
      WHERE tenant_id = ${tenantId}::uuid AND name = 'T-Proj' LIMIT 1
    ` as { id: string }[];

    await sql`
      INSERT INTO app.tasks (
        tenant_id, project_id, title, description, status, priority, created_by
      )
      VALUES (
        ${tenantId}::uuid,
        ${proj[0]!.id}::uuid,
        'Offen für Tool',
        NULL,
        'open',
        'medium',
        ${userId}::uuid
      )
    `;

    const slug = `tw-${crypto.randomUUID().slice(0, 8)}`;
    await sql`
      INSERT INTO app.wiki_pages (
        tenant_id, slug, title, body_md, frontmatter_json,
        scope_tenant, scope_audience, owner_user_id, status
      )
      VALUES (
        ${tenantId}::uuid,
        ${slug},
        'Tool Wiki',
        'Hallo',
        '{}'::jsonb,
        'tenant',
        'company',
        NULL,
        'approved'
      )
    `;

    const listWiki = await exec.execute(
      "workspace_wiki",
      { action: "list_approved", limit: 10 },
      userId,
      db,
    );
    assertEquals(listWiki.success, true);
    const pages = (listWiki.data as { pages: { slug: string }[] }).pages;
    assertEquals(pages.some((p) => p.slug === slug), true);

    const getWiki = await exec.execute(
      "workspace_wiki",
      { action: "get_approved_by_slug", slug },
      userId,
      db,
    );
    assertEquals(getWiki.success, true);
    assertEquals((getWiki.data as { found: boolean }).found, true);

    const listTasks = await exec.execute(
      "workspace_tasks",
      { action: "list_not_done", limit: 10 },
      userId,
      db,
    );
    assertEquals(listTasks.success, true);
    const tasks = (listTasks.data as { tasks: { title: string }[] }).tasks;
    assertEquals(tasks.some((t) => t.title === "Offen für Tool"), true);

    const noSql = new ToolExecutor();
    const fail = await noSql.execute(
      "workspace_wiki",
      { action: "list_approved" },
      userId,
      db,
    );
    assertEquals(fail.success, false);
  } finally {
    await sql`
      DELETE FROM app.wiki_pages
      WHERE tenant_id = ${tenantId}::uuid
    `;
    await sql`
      DELETE FROM app.tasks
      WHERE tenant_id = ${tenantId}::uuid
    `;
    await sql`
      DELETE FROM app.projects
      WHERE tenant_id = ${tenantId}::uuid AND name = 'T-Proj'
    `;
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});
