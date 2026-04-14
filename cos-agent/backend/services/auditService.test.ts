import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { AUDIT_ACTIONS, AuditService } from "./auditService.ts";

Deno.test({
  name: "AuditService — log schreibt Zeile",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 1 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const audit = new AuditService(db);
      await audit.log({
        action: AUDIT_ACTIONS.USER_LOGIN,
        userId: undefined,
        success: true,
      });
      const rows = await sql`
        SELECT action FROM cos_audit_log ORDER BY created_at DESC LIMIT 1
      ` as { action: string }[];
      assertEquals(rows[0]?.action, AUDIT_ACTIONS.USER_LOGIN);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "AuditService — X-Forwarded-For in IP",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 1 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const audit = new AuditService(db);
      const req = new Request("http://x/", {
        headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
      });
      await audit.log({
        action: "test.ip",
        req,
        success: true,
      });
      const rows = await sql`
        SELECT ip_address FROM cos_audit_log ORDER BY created_at DESC LIMIT 1
      ` as { ip_address: string | null }[];
      assertEquals(rows[0]?.ip_address, "203.0.113.9");
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test("AuditService — getAuditLog filter tenantId", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 1 });
  try {
    const db = createPostgresDatabaseClient(sql);
    const klyma = await sql`
      SELECT id::text FROM cos_tenants WHERE slug = 'klyma' LIMIT 1
    ` as { id: string }[];
    const tid = klyma[0]!.id;
    await db.insertAuditLog({
      action: "t1",
      tenantId: tid,
      success: true,
    });
    await db.insertAuditLog({
      action: "t2",
      tenantId: null,
      success: true,
    });
    const audit = new AuditService(db);
    const list = await audit.getAuditLog({ tenantId: tid, limit: 50 });
    assertEquals(list.some((e) => e.action === "t1"), true);
    assertEquals(list.some((e) => e.action === "t2"), false);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
