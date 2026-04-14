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

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

const DAY = "2026-04-07T12:00:00.000Z";
const FROM_Q = encodeURIComponent("2026-04-07T00:00:00.000Z");
const TO_Q = encodeURIComponent("2026-04-07T23:59:59.999Z");

Deno.test({
  name: "E2E GET /api/admin/costs — ohne Auth → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
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
        const res = await fetch(
          `${baseUrl}/api/admin/costs?from=${FROM_Q}&to=${TO_Q}`,
        );
        assertEquals(res.status, 401);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/admin/costs — ohne from/to → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${adminId}::uuid, 'costs-e2e-admin400@test.local', 'A', 'admin')
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
        const token = await mintJwt(adminId);
        const res = await fetch(`${baseUrl}/api/admin/costs`, {
          headers: authHeader(token),
        });
        assertEquals(res.status, 400);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${adminId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/admin/costs — gültig → by_model + Token-Spalten",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const slug = `costs-t-${crypto.randomUUID().slice(0, 8)}`;
    const adminId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    try {
      const [trow] = await sql`
        INSERT INTO cos_tenants (name, slug) VALUES ('CostT', ${slug})
        RETURNING id::text AS id
      ` as { id: string }[];
      const tid = trow!.id;
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${adminId}::uuid, 'costs-e2e-admin@test.local', 'Admin', 'admin', ${tid}::uuid)
      `;
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${memberId}::uuid, 'costs-e2e-mem@test.local', 'Mem', 'member', ${tid}::uuid)
      `;
      await sql`
        INSERT INTO cos_llm_calls (user_id, model, input_tokens, output_tokens, cost_usd, created_at)
        VALUES
          (${memberId}::uuid, 'claude-haiku-4-5-20251001', 10, 5, 0.02, ${DAY}::timestamptz),
          (${memberId}::uuid, 'claude-sonnet-4-20250514', 100, 50, 1.5, ${DAY}::timestamptz)
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
        const token = await mintJwt(adminId);
        const res = await fetch(
          `${baseUrl}/api/admin/costs?from=${FROM_Q}&to=${TO_Q}`,
          { headers: authHeader(token) },
        );
        assertEquals(res.status, 200);
        const body = await res.json() as {
          by_model: Array<
            {
              model: string;
              calls: number;
              input_tokens: number;
              output_tokens: number;
              cost_usd: number;
            }
          >;
          by_user: unknown[];
          totals: { cost_usd: number; total_calls: number };
        };
        assertEquals(Array.isArray(body.by_model), true);
        assertEquals(body.by_model.length >= 2, true);
        const sonnet = body.by_model.find((r) => r.model.includes("sonnet"));
        assertEquals(sonnet != null, true);
        assertEquals(sonnet!.calls, 1);
        assertEquals(sonnet!.input_tokens, 100);
        assertEquals(sonnet!.output_tokens, 50);
        assertEquals(body.totals.total_calls, 2);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_llm_calls WHERE user_id = ${memberId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id IN (${adminId}::uuid, ${memberId}::uuid)`;
      await sql`DELETE FROM cos_tenants WHERE slug = ${slug}`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/admin/costs — by_model gruppiert pro Modell (Tenant-Isolation)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const su = crypto.randomUUID().slice(0, 8);
    const slugA = `costs-a-${su}`;
    const slugB = `costs-b-${su}`;
    const adminId = crypto.randomUUID();
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    try {
      const [ta] = await sql`
        INSERT INTO cos_tenants (name, slug) VALUES ('CA', ${slugA}) RETURNING id::text AS id
      ` as { id: string }[];
      const [tb] = await sql`
        INSERT INTO cos_tenants (name, slug) VALUES ('CB', ${slugB}) RETURNING id::text AS id
      ` as { id: string }[];
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${adminId}::uuid, 'costs-e2e-admiso@test.local', 'Adm', 'admin', ${ta!.id}::uuid)
      `;
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${userA}::uuid, 'costs-e2e-ua@test.local', 'UA', 'member', ${ta!.id}::uuid)
      `;
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${userB}::uuid, 'costs-e2e-ub@test.local', 'UB', 'member', ${tb!.id}::uuid)
      `;
      await sql`
        INSERT INTO cos_llm_calls (user_id, model, input_tokens, output_tokens, cost_usd, created_at)
        VALUES
          (${userA}::uuid, 'same-model-x', 1, 1, 0.05, ${DAY}::timestamptz),
          (${userA}::uuid, 'same-model-x', 2, 2, 0.05, ${DAY}::timestamptz),
          (${userB}::uuid, 'same-model-x', 1, 1, 99, ${DAY}::timestamptz)
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
        const token = await mintJwt(adminId);
        const res = await fetch(
          `${baseUrl}/api/admin/costs?from=${FROM_Q}&to=${TO_Q}`,
          { headers: authHeader(token) },
        );
        assertEquals(res.status, 200);
        const body = await res.json() as {
          by_model: Array<{ model: string; calls: number; cost_usd: number }>;
          totals: { cost_usd: number; total_calls: number };
        };
        assertEquals(body.by_model.length, 1);
        assertEquals(body.by_model[0]!.model, "same-model-x");
        assertEquals(body.by_model[0]!.calls, 2);
        assertEquals(body.totals.total_calls, 2);
        assertEquals(body.totals.cost_usd < 1, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_llm_calls WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql`DELETE FROM cos_users WHERE id IN (${adminId}::uuid, ${userA}::uuid, ${userB}::uuid)`;
      await sql`DELETE FROM cos_tenants WHERE slug IN (${slugA}, ${slugB})`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/superadmin/costs — alle Tenants aggregiert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const su = crypto.randomUUID().slice(0, 8);
    const slugA = `sa-cost-a-${su}`;
    const slugB = `sa-cost-b-${su}`;
    const saId = crypto.randomUUID();
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    try {
      const [ta] = await sql`
        INSERT INTO cos_tenants (name, slug) VALUES ('SAA', ${slugA}) RETURNING id::text AS id
      ` as { id: string }[];
      const [tb] = await sql`
        INSERT INTO cos_tenants (name, slug) VALUES ('SAB', ${slugB}) RETURNING id::text AS id
      ` as { id: string }[];
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${saId}::uuid, 'sa-costs-e2e@test.local', 'SA', 'superadmin', ${ta!.id}::uuid)
      `;
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${userA}::uuid, 'sa-cost-ua@test.local', 'UA', 'member', ${ta!.id}::uuid)
      `;
      await sql`
        INSERT INTO cos_users (id, email, name, role, tenant_id)
        VALUES (${userB}::uuid, 'sa-cost-ub@test.local', 'UB', 'member', ${tb!.id}::uuid)
      `;
      await sql`
        INSERT INTO cos_llm_calls (user_id, model, input_tokens, output_tokens, cost_usd, created_at)
        VALUES
          (${userA}::uuid, 'm-global', 1, 1, 0.25, ${DAY}::timestamptz),
          (${userB}::uuid, 'm-global', 1, 1, 0.75, ${DAY}::timestamptz)
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
        const res = await fetch(
          `${baseUrl}/api/superadmin/costs?from=${FROM_Q}&to=${TO_Q}`,
          { headers: authHeader(token) },
        );
        assertEquals(res.status, 200);
        const body = await res.json() as {
          by_tenant: Array<{ tenant_id: string; cost_usd: number; calls: number }>;
          by_model: Array<{ model: string; calls: number; cost_usd: number }>;
          totals: { calls: number; cost_usd: number };
        };
        assertEquals(body.totals.calls, 2);
        assertEquals(Math.abs(body.totals.cost_usd - 1) < 0.001, true);
        assertEquals(body.by_tenant.length >= 2, true);
        const ids = new Set(body.by_tenant.map((t) => t.tenant_id));
        assertEquals(ids.has(ta!.id), true);
        assertEquals(ids.has(tb!.id), true);
        const mg = body.by_model.find((m) => m.model === "m-global");
        assertEquals(mg != null, true);
        assertEquals(mg!.calls, 2);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_llm_calls WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql`DELETE FROM cos_users WHERE id IN (${saId}::uuid, ${userA}::uuid, ${userB}::uuid)`;
      await sql`DELETE FROM cos_tenants WHERE slug IN (${slugA}, ${slugB})`;
      await sql.end({ timeout: 5 });
    }
  },
});
