import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../../db/databaseClient.ts";
import { runMigrations } from "../../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../services/llm/llmTypes.ts";
import { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import {
  baseTestEnv,
  createAgentAndDocument,
  startTestServer,
  TEST_JWT_SECRET,
} from "../../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../../test_database_url.ts";
import postgres from "postgres";

async function mintJwt(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

class FakeLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "x",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    };
  }
}

Deno.test({
  name: "E2E GET /api/superadmin/tenants — ohne superadmin → 403",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const memberId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${memberId}::uuid, 'sa-e2e-member@test.local', 'M', 'member')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(memberId);
        const res = await fetch(`${baseUrl}/api/superadmin/tenants`, {
          headers: authHeader(token),
        });
        assertEquals(res.status, 403);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${memberId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/superadmin/tenants — als superadmin → 200 + Array",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-sa@test.local', 'S', 'superadmin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        const res = await fetch(`${baseUrl}/api/superadmin/tenants`, {
          headers: authHeader(token),
        });
        assertEquals(res.status, 200);
        const body = (await res.json()) as unknown[];
        assertEquals(Array.isArray(body), true);
        if (body.length > 0) {
          const row = body[0] as Record<string, unknown>;
          assertEquals("google_client_secret_enc" in row, false);
          assertEquals("credentials_configured" in row, true);
        }
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/superadmin/tenants — valid → 201 + Tenant ohne Secrets",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    const slug = `sa-e2e-${crypto.randomUUID().slice(0, 8)}`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-create@test.local', 'S', 'superadmin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        const res = await fetch(`${baseUrl}/api/superadmin/tenants`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "SA E2E Tenant",
            slug,
            plan: "starter",
          }),
        });
        assertEquals(res.status, 201);
        const t = (await res.json()) as Record<string, unknown>;
        assertEquals(typeof t.id, "string");
        assertEquals(t.slug, slug);
        assertEquals(t.google_client_secret_enc, undefined);
        assertEquals(t.slack_client_secret_enc, undefined);
        await sql`DELETE FROM cos_tenants WHERE slug = ${slug}`;
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/superadmin/tenants — ungültiger slug → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-badslug@test.local', 'S', 'superadmin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        const res = await fetch(`${baseUrl}/api/superadmin/tenants`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "X", slug: "Bad_Slug" }),
        });
        assertEquals(res.status, 400);
        const j = (await res.json()) as { example?: string };
        assertEquals(j.example, "mustermann-gmbh");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/superadmin/tenants — doppelter slug → 409",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    const slug = `sa-dup-${crypto.randomUUID().slice(0, 8)}`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-dup@test.local', 'S', 'superadmin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        const body = { name: "A", slug };
        const r1 = await fetch(`${baseUrl}/api/superadmin/tenants`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        assertEquals(r1.status, 201);
        await r1.body?.cancel();
        const r2 = await fetch(`${baseUrl}/api/superadmin/tenants`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "B", slug }),
        });
        assertEquals(r2.status, 409);
        await sql`DELETE FROM cos_tenants WHERE slug = ${slug}`;
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

async function setupSaWithTenant(): Promise<{
  sql: ReturnType<typeof postgres>;
  baseUrl: string;
  shutdown: () => void;
  saId: string;
  tenantId: string;
  token: string;
}> {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 2 });
  const saId = crypto.randomUUID();
  const tenantId = crypto.randomUUID();
  const saEmail = `sa-e2e-cred-${crypto.randomUUID().slice(0, 10)}@test.local`;
  await sql`
    INSERT INTO cos_users (id, email, name, role)
    VALUES (${saId}::uuid, ${saEmail}, 'Cred SA', 'superadmin')
  `;
  const slug = `sa-cred-${crypto.randomUUID().slice(0, 8)}`;
  await sql`
    INSERT INTO cos_tenants (id, name, slug, plan)
    VALUES (${tenantId}::uuid, 'Cred Tenant', ${slug}, 'starter')
  `;
  const db = createPostgresDatabaseClient(sql);
  const llm = new FakeLlm();
  const toolExecutor = new ToolExecutor();
  const { agentService, documentService } = createAgentAndDocument(db, llm, toolExecutor);
  const { baseUrl, shutdown } = await startTestServer(
    baseTestEnv({ DATABASE_URL: url }),
    { db, agentService, documentService, sql, llm, toolExecutor },
  );
  const token = await mintJwt(saId);
  return { sql, baseUrl, shutdown, saId, tenantId, token };
}

Deno.test({
  name: "E2E PUT credentials/google — ungültige Client ID → 400 + hint",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/google`,
        {
          method: "PUT",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "bad-id",
            client_secret: "GOCSPX-12345678901234567890",
          }),
        },
      );
      assertEquals(res.status, 400);
      const j = (await res.json()) as { hint?: string };
      assertEquals(typeof j.hint, "string");
      assertEquals(j.hint!.includes("googleusercontent.com"), true);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT credentials/google — ungültiges Secret → 400 + hint",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/google`,
        {
          method: "PUT",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "123.apps.googleusercontent.com",
            client_secret: "nope",
          }),
        },
      );
      assertEquals(res.status, 400);
      const j = (await res.json()) as { hint?: string };
      assertEquals(j.hint!.includes("GOCSPX-"), true);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT credentials/google — valid → { configured: true }",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/google`,
        {
          method: "PUT",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "123456789-abc.apps.googleusercontent.com",
            client_secret: "GOCSPX-123456789012345678901234",
          }),
        },
      );
      assertEquals(res.status, 200);
      const j = (await res.json()) as { configured?: boolean };
      assertEquals(j.configured, true);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT credentials/slack — ungültige Client ID → 400 + hint",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/slack`,
        {
          method: "PUT",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "bad",
            client_secret: "x".repeat(32),
          }),
        },
      );
      assertEquals(res.status, 400);
      const j = (await res.json()) as { hint?: string };
      assertEquals(j.hint!.includes("slack.com"), true);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT credentials/slack — Secret zu kurz → 400 + hint",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/slack`,
        {
          method: "PUT",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "T09ABCDEF.1234567890",
            client_secret: "short",
          }),
        },
      );
      assertEquals(res.status, 400);
      const j = (await res.json()) as { hint?: string };
      assertEquals(j.hint!.includes("slack.com"), true);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE credentials/google → { removed: true }",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/google`,
        {
          method: "PUT",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: "123456789-abc.apps.googleusercontent.com",
            client_secret: "GOCSPX-123456789012345678901234",
          }),
        },
      );
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/google`,
        { method: "DELETE", headers: authHeader(token) },
      );
      assertEquals(res.status, 200);
      const j = (await res.json()) as { removed?: boolean };
      assertEquals(j.removed, true);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE credentials/invalid-provider → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { sql, baseUrl, shutdown, tenantId, token, saId } =
      await setupSaWithTenant();
    try {
      const res = await fetch(
        `${baseUrl}/api/superadmin/tenants/${tenantId}/credentials/x`,
        { method: "DELETE", headers: authHeader(token) },
      );
      assertEquals(res.status, 400);
    } finally {
      shutdown();
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/superadmin/status — Zahlen konsistent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-status@test.local', 'S', 'superadmin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        const res = await fetch(`${baseUrl}/api/superadmin/status`, {
          headers: authHeader(token),
        });
        assertEquals(res.status, 200);
        const s = (await res.json()) as {
          total_tenants: number;
          active_tenants: number;
          total_users: number;
          llm_costs_30d: { total_usd: number; by_model: unknown[] };
        };
        assertEquals(typeof s.total_tenants, "number");
        assertEquals(typeof s.active_tenants, "number");
        assertEquals(typeof s.total_users, "number");
        assertEquals(typeof s.llm_costs_30d.total_usd, "number");
        assertEquals(Array.isArray(s.llm_costs_30d.by_model), true);
        assertEquals(s.active_tenants <= s.total_tenants, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/superadmin/audit-log — Filter action",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-audit@test.local', 'S', 'superadmin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        await sql`
          INSERT INTO cos_audit_log (action, user_id, success)
          VALUES ('sa.test.marker', ${saId}::uuid, true)
        `;
        const res = await fetch(
          `${baseUrl}/api/superadmin/audit-log?action=${encodeURIComponent("sa.test.marker")}&limit=20`,
          { headers: authHeader(token) },
        );
        assertEquals(res.status, 200);
        const rows = (await res.json()) as { action: string }[];
        assertEquals(rows.every((r) => r.action === "sa.test.marker"), true);
        await sql`DELETE FROM cos_audit_log WHERE action = 'sa.test.marker'`;
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/superadmin/tenants/:id/users → 201 + temporary_password",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const saId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const slug = `sa-user-${crypto.randomUUID().slice(0, 8)}`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${saId}::uuid, 'sa-e2e-userop@test.local', 'S', 'superadmin')
      `;
      await sql`
        INSERT INTO cos_tenants (id, name, slug, plan)
        VALUES (${tenantId}::uuid, 'U Tenant', ${slug}, 'starter')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(
        db,
        llm,
        toolExecutor,
      );
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(saId);
        const email = `sa-newuser-${crypto.randomUUID().slice(0, 8)}@test.local`;
        const res = await fetch(
          `${baseUrl}/api/superadmin/tenants/${tenantId}/users`,
          {
            method: "POST",
            headers: { ...authHeader(token), "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              name: "Neu",
              role: "member",
            }),
          },
        );
        assertEquals(res.status, 201);
        const j = (await res.json()) as {
          temporary_password?: string;
          user?: { id: string };
        };
        assertEquals(typeof j.temporary_password, "string");
        assertEquals((j.temporary_password!.length ?? 0) > 0, true);
        assertEquals(typeof j.user?.id, "string");
        await sql`DELETE FROM cos_users WHERE email = ${email}`;
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_tenants WHERE id = ${tenantId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${saId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
