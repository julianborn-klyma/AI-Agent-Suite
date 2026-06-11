import { assertEquals } from "@std/assert";
import * as jose from "jose";
import postgres from "postgres";
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

class FakeLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return { content: "[]", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" };
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

function uniqEmail(tag: string) {
  return `brain.${tag}.${crypto.randomUUID().slice(0, 8)}@test.local`;
}

async function insertUser(
  sql: ReturnType<typeof postgres>,
  tenantId: string,
  tag: string,
  role: "member" | "admin" = "member",
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO cos_users (id, email, name, role, is_active, tenant_id)
    VALUES (${id}::uuid, ${uniqEmail(tag)}, ${tag}, ${role}, true, ${tenantId}::uuid)
  `;
  return id;
}

// ── Full project CRUD + member management + entry CRUD ───────────────────────

Deno.test({
  name: "E2E brain — full flow: project, members, entries, conflicts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 3 });

    const tidRows = await sql`SELECT id::text AS id FROM cos_tenants WHERE slug = 'klyma' LIMIT 1` as {
      id: string;
    }[];
    const tenantId = tidRows[0]!.id;

    const ownerUid = await insertUser(sql, tenantId, "br-owner");
    const memberUid = await insertUser(sql, tenantId, "br-member");
    const nonMemberUid = await insertUser(sql, tenantId, "br-nonmember");

    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );

      try {
        const ownerToken = await mintJwt(ownerUid);
        const memberToken = await mintJwt(memberUid);
        const nonMemberToken = await mintJwt(nonMemberUid);
        const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

        // 1. Create project
        const createRes = await fetch(`${baseUrl}/api/brain/projects`, {
          method: "POST",
          headers: { ...auth(ownerToken), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "E2E Projekt", description: "Test" }),
        });
        assertEquals(createRes.status, 201);
        const project = await createRes.json() as {
          id: string;
          name: string;
          tenant_id: string;
        };
        assertEquals(project.name, "E2E Projekt");
        assertEquals(project.tenant_id, tenantId);
        const projectId = project.id;

        // 2. List projects — owner sees it
        const listRes = await fetch(`${baseUrl}/api/brain/projects`, {
          headers: auth(ownerToken),
        });
        assertEquals(listRes.status, 200);
        const projects = await listRes.json() as { id: string }[];
        assertEquals(projects.some((p) => p.id === projectId), true);

        // 3. Non-member gets 403 on GET /projects/:id
        const nonMemberGet = await fetch(`${baseUrl}/api/brain/projects/${projectId}`, {
          headers: auth(nonMemberToken),
        });
        assertEquals(nonMemberGet.status, 403);

        // 4. Owner gets project details
        const getRes = await fetch(`${baseUrl}/api/brain/projects/${projectId}`, {
          headers: auth(ownerToken),
        });
        assertEquals(getRes.status, 200);

        // 5. Update project name
        const patchRes = await fetch(`${baseUrl}/api/brain/projects/${projectId}`, {
          method: "PATCH",
          headers: { ...auth(ownerToken), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "E2E Projekt Updated" }),
        });
        assertEquals(patchRes.status, 200);
        const patched = await patchRes.json() as { name: string };
        assertEquals(patched.name, "E2E Projekt Updated");

        // 6. Invite member (as member role)
        const inviteRes = await fetch(`${baseUrl}/api/brain/projects/${projectId}/members`, {
          method: "POST",
          headers: { ...auth(ownerToken), "Content-Type": "application/json" },
          body: JSON.stringify({ userId: memberUid, role: "member" }),
        });
        assertEquals(inviteRes.status, 201);

        // 7. List members
        const membersRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/members`,
          { headers: auth(ownerToken) },
        );
        assertEquals(membersRes.status, 200);
        const members = await membersRes.json() as { user_id: string; role: string }[];
        assertEquals(members.some((m) => m.user_id === memberUid), true);

        // 8. Member can read entries (empty)
        const emptyEntriesRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/entries`,
          { headers: auth(memberToken) },
        );
        assertEquals(emptyEntriesRes.status, 200);
        assertEquals(await emptyEntriesRes.json(), []);

        // 9. Member cannot add entry → 403
        const memberAddRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/entries`,
          {
            method: "POST",
            headers: { ...auth(memberToken), "Content-Type": "application/json" },
            body: JSON.stringify({ type: "fact", content: "Verboten." }),
          },
        );
        assertEquals(memberAddRes.status, 403);

        // 10. Owner adds entry
        const addRes = await fetch(`${baseUrl}/api/brain/projects/${projectId}/entries`, {
          method: "POST",
          headers: { ...auth(ownerToken), "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "fact",
            content: "Hans ist PM seit 2020.",
            tags: ["person"],
          }),
        });
        assertEquals(addRes.status, 201);
        const addResult = await addRes.json() as {
          entry: { id: string; type: string; content: string };
          conflicts: unknown[];
        };
        assertEquals(addResult.entry.type, "fact");
        assertEquals(addResult.entry.content, "Hans ist PM seit 2020.");
        const entryId = addResult.entry.id;

        // 11. Member reads entries → sees 1 entry
        const entriesRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/entries`,
          { headers: auth(memberToken) },
        );
        assertEquals(entriesRes.status, 200);
        const entries = await entriesRes.json() as { id: string }[];
        assertEquals(entries.some((e) => e.id === entryId), true);

        // 12. Promote member to knowledge_owner
        const promoteRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/members/${memberUid}`,
          {
            method: "PATCH",
            headers: { ...auth(ownerToken), "Content-Type": "application/json" },
            body: JSON.stringify({ role: "knowledge_owner" }),
          },
        );
        assertEquals(promoteRes.status, 200);

        // 13. knowledge_owner adds entry
        const koAddRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/entries`,
          {
            method: "POST",
            headers: { ...auth(memberToken), "Content-Type": "application/json" },
            body: JSON.stringify({ type: "decision", content: "Deadline Q2 ist 30.06." }),
          },
        );
        assertEquals(koAddRes.status, 201);

        // 14. Update entry (owner)
        const updateRes = await fetch(`${baseUrl}/api/brain/entries/${entryId}`, {
          method: "PATCH",
          headers: { ...auth(ownerToken), "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Hans ist PM seit 2019." }),
        });
        assertEquals(updateRes.status, 200);
        const updated = await updateRes.json() as { content: string };
        assertEquals(updated.content, "Hans ist PM seit 2019.");

        // 15. Delete entry (owner)
        const deleteEntryRes = await fetch(`${baseUrl}/api/brain/entries/${entryId}`, {
          method: "DELETE",
          headers: auth(ownerToken),
        });
        assertEquals(deleteEntryRes.status, 200);

        // 16. Get conflicts (empty, no embeddings in test)
        const conflictsRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/conflicts`,
          { headers: auth(ownerToken) },
        );
        assertEquals(conflictsRes.status, 200);

        // 17. Remove member
        const removeRes = await fetch(
          `${baseUrl}/api/brain/projects/${projectId}/members/${memberUid}`,
          { method: "DELETE", headers: auth(ownerToken) },
        );
        assertEquals(removeRes.status, 200);

        // 18. Delete project
        const deleteRes = await fetch(`${baseUrl}/api/brain/projects/${projectId}`, {
          method: "DELETE",
          headers: auth(ownerToken),
        });
        assertEquals(deleteRes.status, 200);

        // Deleted project no longer in list
        const afterDeleteList = await fetch(`${baseUrl}/api/brain/projects`, {
          headers: auth(ownerToken),
        });
        const afterDeleteProjects = await afterDeleteList.json() as { id: string }[];
        assertEquals(afterDeleteProjects.some((p) => p.id === projectId), false);
      } finally {
        shutdown();
      }
    } finally {
      for (const id of [ownerUid, memberUid, nonMemberUid]) {
        await sql`DELETE FROM cos_users WHERE id = ${id}::uuid`;
      }
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Admin Firm Brain ──────────────────────────────────────────────────────────

Deno.test({
  name: "E2E brain — admin firm brain: list, suppress, delete",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 3 });

    const tidRows = await sql`SELECT id::text AS id FROM cos_tenants WHERE slug = 'klyma' LIMIT 1` as {
      id: string;
    }[];
    const tenantId = tidRows[0]!.id;

    const adminUid = await insertUser(sql, tenantId, "br-admin", "admin");
    const memberUid = await insertUser(sql, tenantId, "br-firmmbr");

    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlm();
      const toolExecutor = new ToolExecutor();
      const { agentService, documentService } = createAgentAndDocument(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );

      try {
        const adminToken = await mintJwt(adminUid);
        const memberToken = await mintJwt(memberUid);
        const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

        // Non-admin cannot access firm brain admin endpoint
        const forbiddenRes = await fetch(`${baseUrl}/api/admin/firm-brain`, {
          headers: auth(memberToken),
        });
        assertEquals(forbiddenRes.status, 403);

        // Insert a firm insight directly
        const insightId = crypto.randomUUID();
        await sql`
          INSERT INTO firm_insights (id, tenant_id, source_user_id, category, content, confidence)
          VALUES (
            ${insightId}::uuid,
            ${tenantId}::uuid,
            ${memberUid}::uuid,
            'person',
            'Klaus ist Abteilungsleiter.',
            0.85
          )
        `;

        // Admin lists insights
        const listRes = await fetch(`${baseUrl}/api/admin/firm-brain`, {
          headers: auth(adminToken),
        });
        assertEquals(listRes.status, 200);
        const insights = await listRes.json() as { id: string; admin_suppressed: boolean }[];
        const insight = insights.find((i) => i.id === insightId);
        assertEquals(insight !== undefined, true);
        assertEquals(insight!.admin_suppressed, false);

        // Suppress insight
        const suppressRes = await fetch(`${baseUrl}/api/admin/firm-brain/${insightId}`, {
          method: "PATCH",
          headers: { ...auth(adminToken), "Content-Type": "application/json" },
          body: JSON.stringify({ admin_suppressed: true }),
        });
        assertEquals(suppressRes.status, 200);

        // Default list no longer shows suppressed insight
        const listAfterSuppress = await fetch(`${baseUrl}/api/admin/firm-brain`, {
          headers: auth(adminToken),
        });
        const insightsAfter = await listAfterSuppress.json() as { id: string }[];
        assertEquals(insightsAfter.some((i) => i.id === insightId), false);

        // With filter adminSuppressed=true → suppressed insight appears
        const suppressedList = await fetch(
          `${baseUrl}/api/admin/firm-brain?adminSuppressed=true`,
          { headers: auth(adminToken) },
        );
        const suppressed = await suppressedList.json() as {
          id: string;
          admin_suppressed: boolean;
        }[];
        assertEquals(suppressed.some((i) => i.id === insightId), true);

        // Delete insight
        const deleteRes = await fetch(`${baseUrl}/api/admin/firm-brain/${insightId}`, {
          method: "DELETE",
          headers: auth(adminToken),
        });
        assertEquals(deleteRes.status, 200);

        // No longer visible even with adminSuppressed=true filter
        const afterDelete = await fetch(
          `${baseUrl}/api/admin/firm-brain?adminSuppressed=true`,
          { headers: auth(adminToken) },
        );
        const afterDeleteInsights = await afterDelete.json() as { id: string }[];
        assertEquals(afterDeleteInsights.some((i) => i.id === insightId), false);
      } finally {
        shutdown();
      }
    } finally {
      for (const id of [adminUid, memberUid]) {
        await sql`DELETE FROM cos_users WHERE id = ${id}::uuid`;
      }
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Unauthenticated requests ──────────────────────────────────────────────────

Deno.test({
  name: "E2E brain — unauthenticated requests return 401",
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
      const { agentService, documentService } = createAgentAndDocument(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, documentService, sql, llm, toolExecutor },
      );

      try {
        for (const path of ["/api/brain/projects", "/api/brain/projects/some-id"]) {
          const res = await fetch(`${baseUrl}${path}`);
          assertEquals(res.status, 401, `Expected 401 for ${path}`);
          await res.body?.cancel();
        }
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});
