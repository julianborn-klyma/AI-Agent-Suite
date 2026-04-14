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
  name: "E2E POST /api/tasks — ohne Auth → 401",
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
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "x", description: "y" }),
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
  name: "E2E POST /api/tasks — ohne title → 400",
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
        VALUES (${userId}::uuid, ${`tasks-a-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
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
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: "  ", description: "ok" }),
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
  name: "E2E POST /api/tasks — title > 200 Zeichen → 400",
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
        VALUES (${userId}::uuid, ${`tasks-b-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
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
        const longTitle = "x".repeat(201);
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: longTitle, description: "ok" }),
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
  name: "E2E POST /api/tasks — fremde document_id → 403",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES
          (${userA}::uuid, ${`tasks-c-a-${userA.slice(0, 8)}@test.local`}, 'A', 'member', true),
          (${userB}::uuid, ${`tasks-c-b-${userB.slice(0, 8)}@test.local`}, 'B', 'member', true)
      `;
      const docRows = await sql`
        INSERT INTO cos_documents (
          user_id, name, document_type, source, processed
        )
        VALUES (${userB}::uuid, 'Secret', 'other', 'upload', true)
        RETURNING id::text AS id
      ` as { id: string }[];
      const docId = docRows[0]!.id;

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
        const token = await mintJwt(userA);
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "T",
            description: "D",
            document_ids: [docId],
          }),
        });
        assertEquals(res.status, 403);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_documents WHERE user_id = ${userB}::uuid`;
      await sql`DELETE FROM cos_users WHERE id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/tasks — valid → 201 + GET Liste",
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
        VALUES (${userId}::uuid, ${`tasks-d-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
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
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "Mein Task",
            description: "Beschreibung",
            priority: "high",
          }),
        });
        assertEquals(res.status, 201);
        const task = await res.json() as { id: string; title: string; status: string };
        assertEquals(task.title, "Mein Task");
        assertEquals(task.status, "pending");

        const list = await fetch(`${baseUrl}/api/tasks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(list.status, 200);
        const arr = await list.json() as { id: string }[];
        assertEquals(arr.some((x) => x.id === task.id), true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_task_queue WHERE user_id = ${userId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E GET /api/tasks — leeres Array neuer User",
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
        VALUES (${userId}::uuid, ${`tasks-e-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
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
        const list = await fetch(`${baseUrl}/api/tasks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(list.status, 200);
        const arr = await list.json() as unknown[];
        assertEquals(arr.length, 0);
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
  name: "E2E GET /api/tasks/:id — fremder Task → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES
          (${userA}::uuid, ${`tasks-f-a-${userA.slice(0, 8)}@test.local`}, 'A', 'member', true),
          (${userB}::uuid, ${`tasks-f-b-${userB.slice(0, 8)}@test.local`}, 'B', 'member', true)
      `;
      const trows = await sql`
        INSERT INTO cos_task_queue (user_id, title, description, priority, status)
        VALUES (${userA}::uuid, 'X', 'Y', 'medium', 'pending')
        RETURNING id::text AS id
      ` as { id: string }[];
      const taskId = trows[0]!.id;

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
        const tokenB = await mintJwt(userB);
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${tokenB}` },
        });
        assertEquals(res.status, 404);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_task_queue WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql`DELETE FROM cos_users WHERE id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/tasks/:id — pending → cancelled",
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
        VALUES (${userId}::uuid, ${`tasks-g-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
      `;
      const trows = await sql`
        INSERT INTO cos_task_queue (user_id, title, description, priority, status)
        VALUES (${userId}::uuid, 'X', 'Y', 'medium', 'pending')
        RETURNING id::text AS id
      ` as { id: string }[];
      const taskId = trows[0]!.id;

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
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 200);
        const body = await res.json() as { cancelled: boolean };
        assertEquals(body.cancelled, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_task_queue WHERE user_id = ${userId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/tasks/:id — running → 409",
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
        VALUES (${userId}::uuid, ${`tasks-h-${userId.slice(0, 8)}@test.local`}, 'T', 'member', true)
      `;
      const trows = await sql`
        INSERT INTO cos_task_queue (user_id, title, description, priority, status, started_at)
        VALUES (${userId}::uuid, 'X', 'Y', 'medium', 'running', NOW())
        RETURNING id::text AS id
      ` as { id: string }[];
      const taskId = trows[0]!.id;

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
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 409);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_task_queue WHERE user_id = ${userId}::uuid`;
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E DELETE /api/tasks/:id — fremder Task → 404",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES
          (${userA}::uuid, ${`tasks-i-a-${userA.slice(0, 8)}@test.local`}, 'A', 'member', true),
          (${userB}::uuid, ${`tasks-i-b-${userB.slice(0, 8)}@test.local`}, 'B', 'member', true)
      `;
      const trows = await sql`
        INSERT INTO cos_task_queue (user_id, title, description, priority, status)
        VALUES (${userA}::uuid, 'X', 'Y', 'medium', 'pending')
        RETURNING id::text AS id
      ` as { id: string }[];
      const taskId = trows[0]!.id;

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
        const tokenB = await mintJwt(userB);
        const res = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tokenB}` },
        });
        assertEquals(res.status, 404);
        await res.body?.cancel();
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_task_queue WHERE user_id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql`DELETE FROM cos_users WHERE id IN (${userA}::uuid, ${userB}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});
