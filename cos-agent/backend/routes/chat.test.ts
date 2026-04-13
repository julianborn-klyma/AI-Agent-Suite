import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import { AgentService } from "../services/agentService.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { ToolExecutor } from "../services/tools/toolExecutor.ts";
import {
  baseTestEnv,
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

/** Mockt LLM — kein Netzwerk. */
class FakeLlmClient implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "e2e-mock-antwort",
      input_tokens: 3,
      output_tokens: 5,
      stop_reason: "end_turn",
    };
  }
}

async function ensureChatTemplate(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    INSERT INTO agent_configs (agent_key, system_prompt, is_template)
    VALUES (
      'e2e-chat-template',
      'Du bist ein Assistent. {{USER_CONTEXT}}{{NOW}}',
      true
    )
    ON CONFLICT (agent_key) DO UPDATE SET
      system_prompt = EXCLUDED.system_prompt,
      is_template = EXCLUDED.is_template
  `;
}

Deno.test({
  name: "E2E POST /api/chat — ohne Auth → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hallo" }),
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
  name: "E2E POST /api/chat — leeres message → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      await ensureChatTemplate(sql);
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(crypto.randomUUID());
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "   " }),
        });
        assertEquals(res.status, 400);
        const j = await res.json() as { error: string };
        assertEquals(j.error, "message darf nicht leer sein");
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/chat — message > 4000 Zeichen → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      await ensureChatTemplate(sql);
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(crypto.randomUUID());
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "x".repeat(4001) }),
        });
        assertEquals(res.status, 400);
        const j = await res.json() as { error: string };
        assertEquals(j.error, "message zu lang (max 4000 Zeichen)");
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/chat/history — ohne session_id → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(crypto.randomUUID());
        const res = await fetch(`${baseUrl}/api/chat/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 400);
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
  name: "E2E GET /api/chat/history — fremde session_id → 403",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const user1 = crypto.randomUUID();
    const user2 = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    try {
      await ensureChatTemplate(sql);
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES
          (${user1}::uuid, 'chat-e2e-1@test.local', 'U1'),
          (${user2}::uuid, 'chat-e2e-2@test.local', 'U2')
      `;
      await sql`
        INSERT INTO cos_conversations (user_id, session_id, role, content)
        VALUES (${user1}::uuid, ${sessionId}::uuid, 'user', 'nur user1')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token2 = await mintJwt(user2);
        const res = await fetch(
          `${baseUrl}/api/chat/history?session_id=${sessionId}`,
          { headers: { Authorization: `Bearer ${token2}` } },
        );
        assertEquals(res.status, 403);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`
        DELETE FROM cos_conversations WHERE session_id = ${sessionId}::uuid
      `;
      await sql`DELETE FROM cos_users WHERE id = ${user1}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${user2}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/chat/sessions — neuer User → 200 und leeres Array",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    try {
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token = await mintJwt(crypto.randomUUID());
        const res = await fetch(`${baseUrl}/api/chat/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 200);
        const body = await res.json() as unknown;
        assertEquals(Array.isArray(body), true);
        assertEquals((body as unknown[]).length, 0);
      } finally {
        shutdown();
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/chat/sessions/:id — fremde Session → 403",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const user1 = crypto.randomUUID();
    const user2 = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    try {
      await ensureChatTemplate(sql);
      await sql`
        INSERT INTO cos_users (id, email, name) VALUES
          (${user1}::uuid, 'chat-del-1@test.local', 'U1'),
          (${user2}::uuid, 'chat-del-2@test.local', 'U2')
      `;
      await sql`
        INSERT INTO cos_conversations (user_id, session_id, role, content)
        VALUES (${user1}::uuid, ${sessionId}::uuid, 'user', 'halt')
      `;
      const db = createPostgresDatabaseClient(sql);
      const llm = new FakeLlmClient();
      const toolExecutor = new ToolExecutor();
      const agentService = new AgentService(db, llm, toolExecutor);
      const { baseUrl, shutdown } = await startTestServer(
        baseTestEnv({ DATABASE_URL: url }),
        { db, agentService, sql, llm, toolExecutor },
      );
      try {
        const token2 = await mintJwt(user2);
        const res = await fetch(
          `${baseUrl}/api/chat/sessions/${sessionId}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token2}` },
          },
        );
        assertEquals(res.status, 403);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`
        DELETE FROM cos_conversations WHERE session_id = ${sessionId}::uuid
      `;
      await sql`DELETE FROM cos_users WHERE id = ${user1}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${user2}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
