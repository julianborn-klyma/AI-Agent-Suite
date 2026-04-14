import { assertEquals, assertRejects } from "@std/assert";
import postgres from "postgres";
import {
  createPostgresDatabaseClient,
  SlugTakenError,
} from "./databaseClient.ts";
import { runMigrations } from "./migrate.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";

Deno.test({
  name: "DatabaseClient tenants — insertTenant + SlugTakenError",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 1 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const slug = `acme-${crypto.randomUUID().slice(0, 8)}`;
      const t = await db.insertTenant({
        name: "Acme",
        slug,
        plan: "starter",
      });
      assertEquals(t.slug, slug);
      await assertRejects(
        async () => {
          await db.insertTenant({ name: "Dup", slug });
        },
        SlugTakenError,
      );
      await sql`DELETE FROM cos_tenants WHERE id = ${t.id}::uuid`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "DatabaseClient tenants — listTenants user_count + getTenantForUser",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 1 });
    const uid = crypto.randomUUID();
    try {
      const db = createPostgresDatabaseClient(sql);
      const rows = await sql`
        SELECT id::text FROM cos_tenants WHERE slug = 'klyma' LIMIT 1
      ` as { id: string }[];
      const klymaId = rows[0]!.id;
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
        VALUES (${uid}::uuid, ${`tc-${uid.slice(0, 8)}@t.local`}, 'T', 'member', true, ${klymaId}::uuid)
      `;
      const list = await db.listTenants();
      const k = list.find((x) => x.slug === "klyma");
      assertEquals(k !== undefined, true);
      assertEquals((k!.user_count ?? 0) >= 1, true);
      const tu = await db.getTenantForUser(uid);
      assertEquals(tu?.slug, "klyma");
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
