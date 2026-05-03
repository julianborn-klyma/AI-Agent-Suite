import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { ToolExecutor } from "../services/tools/toolExecutor.ts";
import {
  baseTestEnv,
  createAgentAndDocument,
  startTestServer,
  TEST_JWT_SECRET,
} from "../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import postgres from "postgres";

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

async function mintJwt(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

Deno.test("E2E workspace — Projekt + Task anlegen und listen", async () => {
  const url = resolveTestDatabaseUrl();
  await runMigrations(url);
  const sql = postgres(url, { max: 2 });
  const userId = crypto.randomUUID();
  try {
    const tidRows = await sql`
      SELECT id::text AS id FROM public.cos_tenants WHERE slug = 'klyma' LIMIT 1
    ` as { id: string }[];
    const tenantId = tidRows[0]!.id;
    await sql`
      INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
      VALUES (
        ${userId}::uuid,
        'workspace-e2e@test.local',
        'WS E2E',
        'member',
        true,
        ${tenantId}::uuid
      )
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
      const token = await mintJwt(userId);
      const auth = { Authorization: `Bearer ${token}` };

      const projRes = await fetch(`${baseUrl}/api/workspace/projects`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "WS Projekt E2E", description: "d" }),
      });
      assertEquals(projRes.status, 201);
      const proj = await projRes.json() as { id: string; name: string };

      const taskRes = await fetch(`${baseUrl}/api/workspace/work-tasks`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: proj.id,
          title: "E2E Workspace Task",
          status: "open",
        }),
      });
      assertEquals(taskRes.status, 201);
      const task = await taskRes.json() as { id: string; title: string };
      assertEquals(task.title, "E2E Workspace Task");

      const listRes = await fetch(
        `${baseUrl}/api/workspace/work-tasks?project_id=${proj.id}`,
        { headers: auth },
      );
      assertEquals(listRes.status, 200);
      const list = await listRes.json() as { id: string; title: string }[];
      assertEquals(list.some((t) => t.id === task.id), true);

      const getRes = await fetch(`${baseUrl}/api/workspace/work-tasks/${task.id}`, {
        headers: auth,
      });
      assertEquals(getRes.status, 200);
      const detail = await getRes.json() as { id: string; title: string; status: string };
      assertEquals(detail.id, task.id);
      assertEquals(detail.title, "E2E Workspace Task");
      assertEquals(detail.status, "open");

      const patchRes = await fetch(`${baseUrl}/api/workspace/work-tasks/${task.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "E2E Workspace Task (gepatcht)",
          status: "in_progress",
        }),
      });
      assertEquals(patchRes.status, 200);
      const patched = await patchRes.json() as { title: string; status: string };
      assertEquals(patched.title, "E2E Workspace Task (gepatcht)");
      assertEquals(patched.status, "in_progress");

      const delRes = await fetch(`${baseUrl}/api/workspace/work-tasks/${task.id}`, {
        method: "DELETE",
        headers: auth,
      });
      assertEquals(delRes.status, 200);
      await delRes.text();

      const goneRes = await fetch(`${baseUrl}/api/workspace/work-tasks/${task.id}`, {
        headers: auth,
      });
      assertEquals(goneRes.status, 404);
      await goneRes.text();
    } finally {
      shutdown();
    }
  } finally {
    await sql`
      DELETE FROM app.tasks
      WHERE tenant_id = (SELECT tenant_id FROM cos_users WHERE id = ${userId}::uuid)
    `;
    await sql`
      DELETE FROM app.team_members
      WHERE tenant_id = (SELECT tenant_id FROM cos_users WHERE id = ${userId}::uuid)
    `;
    await sql`
      DELETE FROM app.teams
      WHERE tenant_id = (SELECT tenant_id FROM cos_users WHERE id = ${userId}::uuid)
    `;
    await sql`
      DELETE FROM app.projects
      WHERE tenant_id = (SELECT tenant_id FROM cos_users WHERE id = ${userId}::uuid)
    `;
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});
