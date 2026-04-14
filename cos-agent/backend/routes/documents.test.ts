import { assertEquals, assertStringIncludes } from "@std/assert";
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

class RouteDocLlm implements LlmClient {
  async chat(req: LlmRequest): Promise<LlmResponse> {
    const src = (req.metadata as { source?: string } | undefined)?.source;
    if (src === "cos-document-summarize") {
      return {
        content: "Zusammenfassung für Test.",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      };
    }
    if (src === "cos-document-qa") {
      return {
        content: JSON.stringify({
          answer: "Test-Antwort",
          sources: [{ chunk_index: 0, excerpt: "Auszug" }],
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      };
    }
    if (src === "cos-document-verify") {
      return {
        content: JSON.stringify({
          sections_found: ["A"],
          missing_sections: [],
          contradictions: [],
          critical_assumptions: [],
          overall_assessment: "Ok",
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      };
    }
    return {
      content: "[]",
      input_tokens: 0,
      output_tokens: 0,
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

Deno.test({
  name: "E2E POST /api/documents — ohne Auth → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const fd = new FormData();
        fd.set("document_type", "other");
        fd.set("file", new File([new Uint8Array([1])], "x.txt", { type: "text/plain" }));
        const res = await fetch(`${baseUrl}/api/documents`, { method: "POST", body: fd });
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
  name: "E2E POST /api/documents — ohne file → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`doc-${userId.slice(0, 8)}@t.local`}, 'D', 'member', true)
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(userId);
        const fd = new FormData();
        fd.set("document_type", "other");
        const res = await fetch(`${baseUrl}/api/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
          body: fd,
        });
        assertEquals(res.status, 400);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/documents — Datei > 10MB → 413",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`big-${userId.slice(0, 8)}@t.local`}, 'D', 'member', true)
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(userId);
        const big = new Uint8Array(10 * 1024 * 1024 + 1);
        big[0] = 37;
        const fd = new FormData();
        fd.set("document_type", "other");
        fd.set("file", new File([big], "huge.pdf", { type: "application/pdf" }));
        const res = await fetch(`${baseUrl}/api/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
          body: fd,
        });
        assertEquals(res.status, 413);
        const j = await res.json() as { error?: string };
        assertStringIncludes(j.error ?? "", "10 MB");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/documents — MIME nicht erlaubt → 415",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`mime-${userId.slice(0, 8)}@t.local`}, 'D', 'member', true)
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(userId);
        const fd = new FormData();
        fd.set("document_type", "other");
        fd.set("file", new File([new Uint8Array([1, 2, 3])], "x.gif", { type: "image/gif" }));
        const res = await fetch(`${baseUrl}/api/documents`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}` },
          body: fd,
        });
        assertEquals(res.status, 415);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/documents — neuer User → leeres Array",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`empty-${userId.slice(0, 8)}@t.local`}, 'D', 'member', true)
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/documents`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        assertEquals(res.status, 200);
        const rows = await res.json() as unknown[];
        assertEquals(Array.isArray(rows), true);
        assertEquals(rows.length, 0);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/documents/:id — fremdes Dokument → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES
          (${owner}::uuid, ${`own-${owner.slice(0, 8)}@t.local`}, 'O', 'member', true),
          (${other}::uuid, ${`oth-${other.slice(0, 8)}@t.local`}, 'P', 'member', true)
      `;
      const ins = await sql`
        INSERT INTO cos_documents (user_id, name, document_type, source, processed)
        VALUES (${owner}::uuid, 'Secret', 'other', 'upload', true)
        RETURNING id
      ` as { id: string }[];
      const docId = ins[0]!.id;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(other);
        const res = await fetch(`${baseUrl}/api/documents/${docId}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        assertEquals(res.status, 404);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${owner}::uuid, ${other}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/documents/:id — fremdes Dokument → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES
          (${owner}::uuid, ${`own2-${owner.slice(0, 8)}@t.local`}, 'O', 'member', true),
          (${other}::uuid, ${`oth2-${other.slice(0, 8)}@t.local`}, 'P', 'member', true)
      `;
      const ins = await sql`
        INSERT INTO cos_documents (user_id, name, document_type, source, processed)
        VALUES (${owner}::uuid, 'Secret', 'other', 'upload', true)
        RETURNING id
      ` as { id: string }[];
      const docId = ins[0]!.id;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(other);
        const res = await fetch(`${baseUrl}/api/documents/${docId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${jwt}` },
        });
        assertEquals(res.status, 404);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${owner}::uuid, ${other}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/documents/:id/ask — leere Frage → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${`ask-${userId.slice(0, 8)}@t.local`}, 'D', 'member', true)
      `;
      const ins = await sql`
        INSERT INTO cos_documents (user_id, name, document_type, source, processed)
        VALUES (${userId}::uuid, 'D1', 'other', 'upload', true)
        RETURNING id
      ` as { id: string }[];
      const docId = ins[0]!.id;
      await sql`
        INSERT INTO cos_document_chunks (document_id, user_id, chunk_index, content)
        VALUES (${docId}::uuid, ${userId}::uuid, 0, 'Hallo Welt')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/documents/${docId}/ask`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question: "   " }),
        });
        assertEquals(res.status, 400);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/documents/:id/ask — fremdes Dokument → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const owner = crypto.randomUUID();
    const other = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES
          (${owner}::uuid, ${`own3-${owner.slice(0, 8)}@t.local`}, 'O', 'member', true),
          (${other}::uuid, ${`oth3-${other.slice(0, 8)}@t.local`}, 'P', 'member', true)
      `;
      const ins = await sql`
        INSERT INTO cos_documents (user_id, name, document_type, source, processed)
        VALUES (${owner}::uuid, 'X', 'other', 'upload', true)
        RETURNING id
      ` as { id: string }[];
      const docId = ins[0]!.id;
      const db = createPostgresDatabaseClient(sql);
      const llm = new RouteDocLlm();
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
        const jwt = await mintJwt(other);
        const res = await fetch(`${baseUrl}/api/documents/${docId}/ask`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ question: "Was steht drin?" }),
        });
        assertEquals(res.status, 404);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${owner}::uuid, ${other}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});
