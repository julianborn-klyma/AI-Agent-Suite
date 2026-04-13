import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../../db/databaseClient.ts";
import { runMigrations } from "../../db/migrate.ts";
import { AgentService } from "../../services/agentService.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../services/llm/llmTypes.ts";
import { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import {
  baseTestEnv,
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
  name: "E2E POST /api/admin/configs — Config angelegt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const key = `cfg-post-${crypto.randomUUID().slice(0, 8)}`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${adminId}::uuid, 'cfg-e2e-admin@test.local', 'A', 'admin')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(adminId);
        const res = await fetch(`${baseUrl}/api/admin/configs`, {
          method: "POST",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            name: key,
            system_prompt: "Hallo {{NOW}}",
            tools_enabled: ["notion"],
            is_template: true,
          }),
        });
        assertEquals(res.status, 201);
        const row = await res.json() as {
          id: number;
          name: string;
          system_prompt: string;
          is_template: boolean;
        };
        assertEquals(row.name, key);
        assertEquals(row.system_prompt, "Hallo {{NOW}}");
        assertEquals(row.is_template, true);
        assertEquals(typeof row.id, "number");
        await sql`DELETE FROM agent_configs WHERE id = ${row.id}`;
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
  name: "E2E POST assign — user-spezifische Config aus Template",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const key = `tpl-assign-${crypto.randomUUID().slice(0, 8)}`;
    let templateId: number | null = null;
    let copyId: number | null = null;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role) VALUES
          (${adminId}::uuid, 'cfg-e2e-ad2@test.local', 'A', 'admin'),
          (${userId}::uuid, 'cfg-e2e-u2@test.local', 'U', 'member')
      `;
      const ins = await sql`
        INSERT INTO agent_configs (agent_key, system_prompt, tools_enabled, is_template, user_id)
        VALUES (${key}, 'Prompt', ARRAY['notion']::text[], true, NULL)
        RETURNING id
      ` as { id: number }[];
      templateId = ins[0]!.id;

      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(adminId);
        const res = await fetch(
          `${baseUrl}/api/admin/configs/${templateId}/assign/${userId}`,
          { method: "POST", headers: authHeader(token) },
        );
        assertEquals(res.status, 201);
        const j = await res.json() as { config_id: string };
        copyId = Number(j.config_id);
        assertEquals(Number.isFinite(copyId), true);

        const rows = await sql`
          SELECT is_template, user_id::text AS uid, system_prompt
          FROM agent_configs WHERE id = ${copyId}
        ` as { is_template: boolean; uid: string; system_prompt: string }[];
        assertEquals(rows.length, 1);
        assertEquals(rows[0].is_template, false);
        assertEquals(rows[0].uid, userId);
        assertEquals(rows[0].system_prompt, "Prompt");
      } finally {
        shutdown();
      }
    } finally {
      if (copyId != null) {
        await sql`DELETE FROM agent_configs WHERE id = ${copyId}`;
      }
      if (templateId != null) {
        await sql`DELETE FROM agent_configs WHERE id = ${templateId}`;
      }
      await sql`DELETE FROM cos_users WHERE id IN (${adminId}::uuid, ${userId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/admin/configs/:id — Config entfernt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const key = `cfg-del-${crypto.randomUUID().slice(0, 8)}`;
    let id: number | null = null;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${adminId}::uuid, 'cfg-e2e-ad3@test.local', 'A', 'admin')
      `;
      const ins = await sql`
        INSERT INTO agent_configs (agent_key, system_prompt, tools_enabled, is_template)
        VALUES (${key}, 'X', ARRAY['notion']::text[], false)
        RETURNING id
      ` as { id: number }[];
      id = ins[0]!.id;

      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(adminId);
        const res = await fetch(`${baseUrl}/api/admin/configs/${id}`, {
          method: "DELETE",
          headers: authHeader(token),
        });
        assertEquals(res.status, 200);
        const j = await res.json() as { deleted: boolean };
        assertEquals(j.deleted, true);

        const left = await sql`
          SELECT 1 FROM agent_configs WHERE id = ${id}
        `;
        assertEquals(left.length, 0);
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
  name: "E2E PATCH /api/admin/configs/:id — system_prompt aktualisiert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const adminId = crypto.randomUUID();
    const key = `cfg-patch-${crypto.randomUUID().slice(0, 8)}`;
    let id: number | null = null;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role)
        VALUES (${adminId}::uuid, 'cfg-e2e-ad4@test.local', 'A', 'admin')
      `;
      const ins = await sql`
        INSERT INTO agent_configs (agent_key, system_prompt, tools_enabled, is_template)
        VALUES (${key}, 'Alt', ARRAY['notion']::text[], true)
        RETURNING id
      ` as { id: number }[];
      id = ins[0]!.id;

      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(adminId);
        const res = await fetch(`${baseUrl}/api/admin/configs/${id}`, {
          method: "PATCH",
          headers: { ...authHeader(token), "Content-Type": "application/json" },
          body: JSON.stringify({ system_prompt: "Neu {{NOW}}" }),
        });
        assertEquals(res.status, 200);
        const row = await res.json() as { system_prompt: string; name: string };
        assertEquals(row.system_prompt, "Neu {{NOW}}");
        assertEquals(row.name, key);
      } finally {
        shutdown();
      }
    } finally {
      if (id != null) await sql`DELETE FROM agent_configs WHERE id = ${id}`;
      await sql`DELETE FROM cos_users WHERE id = ${adminId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
