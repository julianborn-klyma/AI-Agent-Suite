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

Deno.test({
  name: "E2E GET /api/admin/users — ohne Admin → 403",
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
        VALUES (${memberId}::uuid, 'admin-e2e-member@test.local', 'M', 'member')
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
        const res = await fetch(`${baseUrl}/api/admin/users`, {
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
  name: "E2E POST /api/admin/users — fehlender name → 400",
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
        VALUES (${adminId}::uuid, 'admin-e2e-a1@test.local', 'A', 'admin')
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
        const res = await fetch(`${baseUrl}/api/admin/users`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ email: "x@y.z" }),
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
  name: "E2E POST /api/admin/users — doppelte Email → 409",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const dupEmail = `dup-${crypto.randomUUID()}@test.local`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role) VALUES
          (${adminId}::uuid, 'admin-e2e-a2@test.local', 'A', 'admin'),
          (gen_random_uuid(), ${dupEmail}, 'First', 'member')
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
        const res = await fetch(`${baseUrl}/api/admin/users`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ email: dupEmail, name: "Zweiter" }),
        });
        assertEquals(res.status, 409);
        const j = await res.json() as { error: string };
        assertEquals(j.error, "Email bereits vergeben");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE email = ${dupEmail}`;
      await sql`DELETE FROM cos_users WHERE id = ${adminId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PUT /api/admin/users/:id/context — drei Einträge upsert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role) VALUES
          (${adminId}::uuid, 'admin-e2e-a3@test.local', 'A', 'admin'),
          (${targetId}::uuid, 'admin-e2e-t3@test.local', 'T', 'member')
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
        const body = [
          { key: "a", value: "1" },
          { key: "b", value: "2" },
          { key: "c", value: "3" },
        ];
        const put = await fetch(
          `${baseUrl}/api/admin/users/${targetId}/context`,
          {
            method: "PUT",
            headers: { ...authHeader(token), "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        assertEquals(put.status, 200);
        const putJ = await put.json() as { updated: number };
        assertEquals(putJ.updated, 3);

        const put2 = await fetch(
          `${baseUrl}/api/admin/users/${targetId}/context`,
          {
            method: "PUT",
            headers: { ...authHeader(token), "Content-Type": "application/json" },
            body: JSON.stringify([
              { key: "a", value: "neu" },
              { key: "d", value: "4" },
            ]),
          },
        );
        assertEquals(put2.status, 200);
        const put2J = await put2.json() as { updated: number };
        assertEquals(put2J.updated, 2);

        const get = await fetch(
          `${baseUrl}/api/admin/users/${targetId}/context`,
          { headers: authHeader(token) },
        );
        assertEquals(get.status, 200);
        const rows = await get.json() as { key: string; value: string }[];
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        assertEquals(map["a"], "neu");
        assertEquals(map["b"], "2");
        assertEquals(map["c"], "3");
        assertEquals(map["d"], "4");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_user_contexts WHERE user_id = ${targetId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id IN (${adminId}::uuid, ${targetId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/admin/users/:id — Soft-Delete, Zeile bleibt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active) VALUES
          (${adminId}::uuid, 'admin-e2e-a5@test.local', 'A', 'admin', true),
          (${targetId}::uuid, 'admin-e2e-t5@test.local', 'T', 'member', true)
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
        const del = await fetch(`${baseUrl}/api/admin/users/${targetId}`, {
          method: "DELETE",
          headers: authHeader(token),
        });
        assertEquals(del.status, 200);
        const delJ = await del.json() as { deactivated: boolean };
        assertEquals(delJ.deactivated, true);

        const rows = await sql`
          SELECT is_active FROM cos_users WHERE id = ${targetId}::uuid
        ` as { is_active: boolean }[];
        assertEquals(rows.length, 1);
        assertEquals(rows[0].is_active, false);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${adminId}::uuid, ${targetId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E PATCH /api/admin/users/:id — nur übergebene Felder",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active) VALUES
          (${adminId}::uuid, 'admin-e2e-a6@test.local', 'A', 'admin', true),
          (${targetId}::uuid, 'admin-e2e-t6@test.local', 'Original', 'member', true)
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
        const patch = await fetch(`${baseUrl}/api/admin/users/${targetId}`, {
          method: "PATCH",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "NurName" }),
        });
        assertEquals(patch.status, 200);
        const u = await patch.json() as {
          name: string;
          role: string;
          is_active: boolean;
          email: string;
        };
        assertEquals(u.name, "NurName");
        assertEquals(u.role, "member");
        assertEquals(u.is_active, true);
        assertEquals(u.email.includes("admin-e2e-t6"), true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${adminId}::uuid, ${targetId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});
