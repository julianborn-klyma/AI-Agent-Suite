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

async function mintJwt(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);
}

async function ensurePeTemplate(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    INSERT INTO agent_configs (agent_key, system_prompt, is_template)
    VALUES (
      'e2e-pe-template',
      'Du bist ein Assistent. {{USER_CONTEXT}}{{NOW}}',
      true
    )
    ON CONFLICT (agent_key) DO UPDATE SET
      system_prompt = EXCLUDED.system_prompt,
      is_template = EXCLUDED.is_template
  `;
}

class PeFakeLlm implements LlmClient {
  async chat(req: LlmRequest): Promise<LlmResponse> {
    const sys = req.system ?? "";
    if (sys.includes("Search Query Optimizer")) {
      return {
        content: '["KfW Förderung 2026", "BAFA Wärmepumpe", "BEG Heizung"]',
        input_tokens: 2,
        output_tokens: 4,
        stop_reason: "end_turn",
      };
    }
    return {
      content: "[]",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    };
  }
}

Deno.test({
  name: "E2E POST /api/prompt-engineer/optimize — ohne Auth → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new PeFakeLlm();
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
        const res = await fetch(`${baseUrl}/api/prompt-engineer/optimize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            raw_request: "1234567890",
            task_type: "research",
          }),
        });
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
  name: "E2E POST /api/prompt-engineer/optimize — zu kurz → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await ensurePeTemplate(sql);
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES (${uid}::uuid, 'pe-short@test.local', 'P')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new PeFakeLlm();
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
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/prompt-engineer/optimize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            raw_request: "kurz",
            task_type: "research",
          }),
        });
        assertEquals(res.status, 400);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/prompt-engineer/optimize — valid → OptimizedPrompt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await ensurePeTemplate(sql);
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES (${uid}::uuid, 'pe-ok@test.local', 'P')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new PeFakeLlm();
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
        const token = await mintJwt(uid);
        const raw =
          "Recherchiere aktuelle KfW Förderungen für Wärmepumpen im Jahr 2026 ausführlich bitte.";
        const res = await fetch(`${baseUrl}/api/prompt-engineer/optimize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            raw_request: raw,
            task_type: "research",
          }),
        });
        assertEquals(res.status, 200);
        const j = (await res.json()) as {
          system_prompt: string;
          user_prompt: string;
          search_queries: string[];
          recommended_model: string;
          estimated_complexity: string;
        };
        assertEquals(typeof j.system_prompt, "string");
        assertEquals(j.user_prompt.includes("research"), true);
        assertEquals(Array.isArray(j.search_queries), true);
        assertEquals(j.search_queries.length >= 1, true);
        assertEquals(["haiku", "sonnet", "opus"].includes(j.recommended_model), true);
        assertEquals(["low", "medium", "high"].includes(j.estimated_complexity), true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/prompt-engineer/search-queries → queries Array",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await ensurePeTemplate(sql);
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES (${uid}::uuid, 'pe-sq@test.local', 'P')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new PeFakeLlm();
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
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/prompt-engineer/search-queries`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ raw_request: "KfW Wärmepumpe Förderung" }),
        });
        assertEquals(res.status, 200);
        const j = (await res.json()) as { queries: string[] };
        assertEquals(Array.isArray(j.queries), true);
        assertEquals(j.queries.length >= 1, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/prompt-engineer/classify — Businessplan → high",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES (${uid}::uuid, 'pe-cl@test.local', 'P')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new PeFakeLlm();
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
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/prompt-engineer/classify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "analysiere businessplan für Q4" }),
        });
        assertEquals(res.status, 200);
        const j = (await res.json()) as { complexity: string };
        assertEquals(j.complexity, "high");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/prompt-engineer/classify — zeig tasks → low",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const uid = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES (${uid}::uuid, 'pe-cl2@test.local', 'P')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new PeFakeLlm();
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
        const token = await mintJwt(uid);
        const res = await fetch(`${baseUrl}/api/prompt-engineer/classify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "zeig tasks" }),
        });
        assertEquals(res.status, 200);
        const j = (await res.json()) as { complexity: string };
        assertEquals(j.complexity, "low");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
