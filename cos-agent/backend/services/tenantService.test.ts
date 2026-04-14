import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import { baseTestEnv, withTestEnv } from "../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { encrypt } from "./tools/credentialHelper.ts";
import { AUDIT_ACTIONS, AuditService } from "./auditService.ts";
import { TenantService } from "./tenantService.ts";

Deno.test({
  name: "TenantService — getOAuthCredentials Slack entschlüsselt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      try {
        const db = createPostgresDatabaseClient(sql);
        const tid = crypto.randomUUID();
        const enc = await encrypt("my-slack-secret");
        await sql`
        INSERT INTO cos_tenants (id, name, slug, slack_client_id, slack_client_secret_enc)
        VALUES (${tid}::uuid, 'S', ${`slack-${tid.slice(0, 8)}`}, 'cid-s', ${enc})
      `;
        const audit = new AuditService(db);
        const svc = new TenantService(db, audit);
        const c = await svc.getOAuthCredentials(tid);
        assertEquals(c.slack?.clientId, "cid-s");
        assertEquals(c.slack?.clientSecret, "my-slack-secret");
        await sql`DELETE FROM cos_tenants WHERE id = ${tid}::uuid`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "TenantService — getOAuthCredentials ohne Secret → kein Provider",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      try {
        const db = createPostgresDatabaseClient(sql);
        const tid = crypto.randomUUID();
        await sql`
        INSERT INTO cos_tenants (id, name, slug, google_client_id)
        VALUES (${tid}::uuid, 'G', ${`g-${tid.slice(0, 8)}`}, 'only-id')
      `;
        const svc = new TenantService(db, new AuditService(db));
        const c = await svc.getOAuthCredentials(tid);
        assertEquals(c.google, undefined);
        await sql`DELETE FROM cos_tenants WHERE id = ${tid}::uuid`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "TenantService — saveCredentials + Audit ohne clientSecret in metadata",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        const tid = crypto.randomUUID();
        await sql`
        INSERT INTO cos_tenants (id, name, slug)
        VALUES (${tid}::uuid, 'A', ${`aud-${tid.slice(0, 8)}`})
      `;
        await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
        VALUES (${uid}::uuid, ${`u-${uid.slice(0, 8)}@t.local`}, 'U', 'member', true, ${tid}::uuid)
      `;
        const audit = new AuditService(db);
        const svc = new TenantService(db, audit);
        await svc.saveCredentials(
          tid,
          "google",
          { clientId: "g-id", clientSecret: "Gsecret9!x" },
          { userId: uid },
        );
        const t = await db.getTenant(tid);
        assertEquals(t?.google_client_id, "g-id");
        assertEquals(Boolean(t?.google_client_secret_enc?.length), true);
        const logs = await sql`
        SELECT metadata::text FROM cos_audit_log
        WHERE tenant_id = ${tid}::uuid AND action = ${AUDIT_ACTIONS.CREDENTIALS_UPDATED}
        ORDER BY created_at DESC LIMIT 1
      ` as { metadata: string }[];
        const meta = logs[0]?.metadata ?? "";
        assertEquals(meta.includes("Gsecret9"), false);
        assertEquals(meta.includes("clientSecret"), false);
        assertEquals(meta.includes("google"), true);
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql`DELETE FROM cos_tenants WHERE id = ${tid}::uuid`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "TenantService — removeCredentials + Audit",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        const tid = crypto.randomUUID();
        const enc = await encrypt("x");
        await sql`
        INSERT INTO cos_tenants (id, name, slug, notion_client_id, notion_client_secret_enc)
        VALUES (${tid}::uuid, 'N', ${`rm-${tid.slice(0, 8)}`}, 'n-id', ${enc})
      `;
        await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
        VALUES (${uid}::uuid, ${`u2-${uid.slice(0, 8)}@t.local`}, 'U', 'member', true, ${tid}::uuid)
      `;
        const audit = new AuditService(db);
        const svc = new TenantService(db, audit);
        await svc.removeCredentials(tid, "notion", { userId: uid });
        const t = await db.getTenant(tid);
        assertEquals(t?.notion_client_id, null);
        assertEquals(t?.notion_client_secret_enc, null);
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql`DELETE FROM cos_tenants WHERE id = ${tid}::uuid`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "TenantService — isProviderConfigured + requireTenantForUser",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${uid}::uuid, ${`nt-${uid.slice(0, 8)}@t.local`}, 'U', 'member', true)
      `;
        const svc = new TenantService(db, new AuditService(db));
        const t = await svc.requireTenantForUser(uid);
        assertEquals(t.slug, "klyma");
        assertEquals(svc.isProviderConfigured(t, "google"), false);
        await sql`UPDATE cos_users SET tenant_id = NULL WHERE id = ${uid}::uuid`;
        let caught: unknown;
        try {
          await svc.requireTenantForUser(uid);
        } catch (e) {
          caught = e;
        }
        assertEquals(
          caught instanceof Error && caught.message,
          "Kein Tenant für User",
        );
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
});
