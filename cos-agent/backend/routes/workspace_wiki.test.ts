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

Deno.test("E2E workspace wiki — Seite anlegen, patchen, löschen", async () => {
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
        'wiki-e2e@test.local',
        'Wiki E2E',
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
      const slug = `wiki-page-${crypto.randomUUID().slice(0, 8)}`;

      const postRes = await fetch(`${baseUrl}/api/workspace/wiki-pages`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          title: "Hallo Wiki",
          body_md: `Text mit [[${slug}]]`,
          status: "draft",
        }),
      });
      assertEquals(postRes.status, 201);
      const page = await postRes.json() as { id: string; slug: string; status: string };
      assertEquals(page.slug, slug);
      assertEquals(page.status, "draft");

      const patchRes = await fetch(`${baseUrl}/api/workspace/wiki-pages/${page.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", title: "Hallo Wiki v2" }),
      });
      assertEquals(patchRes.status, 200);
      const updated = await patchRes.json() as { status: string; title: string; version: number };
      assertEquals(updated.status, "approved");
      assertEquals(updated.title, "Hallo Wiki v2");
      assertEquals(updated.version >= 2, true);

      const delRes = await fetch(`${baseUrl}/api/workspace/wiki-pages/${page.id}`, {
        method: "DELETE",
        headers: auth,
      });
      assertEquals(delRes.status, 200);
      await delRes.text();
    } finally {
      shutdown();
    }
  } finally {
    await sql`
      DELETE FROM app.wiki_pages
      WHERE tenant_id = (SELECT tenant_id FROM cos_users WHERE id = ${userId}::uuid)
    `;
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});

Deno.test("E2E workspace wiki — by-slug, outgoing-links, backlinks", async () => {
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
        'wiki-links-e2e@test.local',
        'Wiki Links E2E',
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
      const slugB = `wb-${crypto.randomUUID().slice(0, 8)}`;
      const slugA = `wa-${crypto.randomUUID().slice(0, 8)}`;

      const postB = await fetch(`${baseUrl}/api/workspace/wiki-pages`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slugB,
          title: "B-Seite",
          body_md: "Inhalt B",
          status: "approved",
        }),
      });
      assertEquals(postB.status, 201);
      const pageB = await postB.json() as { id: string; slug: string };

      const postA = await fetch(`${baseUrl}/api/workspace/wiki-pages`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slugA,
          title: "A-Seite",
          body_md: `Siehe [[${slugB}]] und [[fehlt-${slugA}]]`,
          status: "approved",
        }),
      });
      assertEquals(postA.status, 201);
      const pageA = await postA.json() as { id: string; slug: string };

      const bySlugRes = await fetch(
        `${baseUrl}/api/workspace/wiki-pages/by-slug/${encodeURIComponent(slugA)}`,
        { headers: auth },
      );
      assertEquals(bySlugRes.status, 200);
      const bySlug = await bySlugRes.json() as { slug: string; id: string };
      assertEquals(bySlug.slug, slugA);
      assertEquals(bySlug.id, pageA.id);

      const outRes = await fetch(
        `${baseUrl}/api/workspace/wiki-pages/${pageA.id}/outgoing-links`,
        { headers: auth },
      );
      assertEquals(outRes.status, 200);
      const outgoing = await outRes.json() as {
        to_slug: string;
        resolved: boolean;
      }[];
      assertEquals(outgoing.length, 2);
      const toB = outgoing.find((o) => o.to_slug === slugB);
      assertEquals(toB?.resolved, true);
      const toMissing = outgoing.find((o) => o.to_slug === `fehlt-${slugA}`);
      assertEquals(toMissing?.resolved, false);

      const backRes = await fetch(
        `${baseUrl}/api/workspace/wiki-pages/${pageB.id}/backlinks`,
        { headers: auth },
      );
      assertEquals(backRes.status, 200);
      const backlinks = await backRes.json() as { from_slug: string }[];
      assertEquals(backlinks.length, 1);
      assertEquals(backlinks[0]!.from_slug, slugA);

      const missRes = await fetch(
        `${baseUrl}/api/workspace/wiki-pages/by-slug/${encodeURIComponent("gibts-nicht-xyz")}`,
        { headers: auth },
      );
      assertEquals(missRes.status, 404);
      await missRes.text();
    } finally {
      shutdown();
    }
  } finally {
    await sql`
      DELETE FROM app.wiki_pages
      WHERE tenant_id = (SELECT tenant_id FROM cos_users WHERE id = ${userId}::uuid)
    `;
    await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
    await sql.end({ timeout: 5 });
  }
});
