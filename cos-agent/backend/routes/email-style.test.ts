import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import type { EmailStyleService } from "../services/emailStyleService.ts";
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

const mockEmailStyleService = {
  learnEmailStyle: async () => ({
    learned: true,
    emails_analyzed: 7,
    style: undefined,
  }),
  createStyledDraft: async () => ({
    success: true,
    draft_id: "draft-api-1",
    preview: "Hallo …",
    style_used: true,
    recipient_type: "customer",
  }),
} as unknown as EmailStyleService;

Deno.test({
  name: "E2E POST /api/email-style/learn ohne Auth → 401",
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
        VALUES (${userId}::uuid, 'es-learn401@test.local', 'E', 'member', true)
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
        {
          db,
          agentService,
          documentService,
          sql,
          llm,
          toolExecutor,
          emailStyleService: mockEmailStyleService,
        },
      );
      try {
        const res = await fetch(`${baseUrl}/api/email-style/learn`, {
          method: "POST",
        });
        assertEquals(res.status, 401);
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
  name: "E2E POST /api/email-style/learn → 200 + EmailStyleLearning",
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
        VALUES (${userId}::uuid, 'es-learn200@test.local', 'E', 'member', true)
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
        {
          db,
          agentService,
          documentService,
          sql,
          llm,
          toolExecutor,
          emailStyleService: mockEmailStyleService,
        },
      );
      try {
        const token = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/email-style/learn`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 200);
        const j = await res.json() as {
          learned: boolean;
          emails_analyzed: number;
        };
        assertEquals(j.learned, true);
        assertEquals(j.emails_analyzed, 7);
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
  name: "E2E GET /api/email-style ohne Eintrag → style null",
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
        VALUES (${userId}::uuid, 'es-get-null@test.local', 'E', 'member', true)
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
        {
          db,
          agentService,
          documentService,
          sql,
          llm,
          toolExecutor,
          emailStyleService: mockEmailStyleService,
        },
      );
      try {
        const token = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/email-style`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        assertEquals(res.status, 200);
        const j = await res.json() as { style: unknown; last_updated: unknown };
        assertEquals(j.style, null);
        assertEquals(j.last_updated, null);
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
  name: "E2E POST /api/email-style/draft fehlende Felder → 400",
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
        VALUES (${userId}::uuid, 'es-draft400@test.local', 'E', 'member', true)
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
        {
          db,
          agentService,
          documentService,
          sql,
          llm,
          toolExecutor,
          emailStyleService: mockEmailStyleService,
        },
      );
      try {
        const token = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/email-style/draft`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message_id: "", from: "a@b.de" }),
        });
        assertEquals(res.status, 400);
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
  name: "E2E POST /api/email-style/draft → StyledDraftResult",
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
        VALUES (${userId}::uuid, 'es-draft200@test.local', 'E', 'member', true)
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
        {
          db,
          agentService,
          documentService,
          sql,
          llm,
          toolExecutor,
          emailStyleService: mockEmailStyleService,
        },
      );
      try {
        const token = await mintJwt(userId);
        const res = await fetch(`${baseUrl}/api/email-style/draft`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message_id: "abc",
            from: "Max <m@x.de>",
            subject: "Re: Q",
            body: "Hallo",
          }),
        });
        assertEquals(res.status, 200);
        const j = await res.json() as {
          success: boolean;
          draft_id?: string;
          recipient_type: string;
        };
        assertEquals(j.success, true);
        assertEquals(j.draft_id, "draft-api-1");
        assertEquals(j.recipient_type, "customer");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
