import { assertEquals } from "@std/assert";
import * as jose from "jose";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { PasswordService } from "../services/passwordService.ts";
import { ToolExecutor } from "../services/tools/toolExecutor.ts";
import {
  baseTestEnv,
  createAgentAndDocument,
  startTestServer,
  TEST_JWT_SECRET,
} from "../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { hashPassword } from "../services/passwordCrypto.ts";
import postgres from "postgres";

/** Eindeutige Test-Client-IP — parallele Deno-Tests teilen sonst `unknown` und die DB-Login-Rate-Limits. */
function uniqueTestClientIp(seed: string): string {
  const h = seed.replace(/-/g, "");
  const a = ((parseInt(h.slice(0, 4), 16) || 1) % 254) || 1;
  const b = ((parseInt(h.slice(4, 8), 16) || 1) % 254) || 1;
  const c = ((parseInt(h.slice(8, 12), 16) || 1) % 254) || 1;
  return `10.${a}.${b}.${c}`;
}

function loginJsonHeaders(clientIpSeed: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Forwarded-For": uniqueTestClientIp(clientIpSeed),
  };
}

async function mintUserToken(
  sub: string,
  email: string,
  name: string,
  role: string,
): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new jose.SignJWT({ role, email, name })
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

Deno.test({
  name: "E2E POST /api/auth/login — gültige Email → 200 + token",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-ok-${userId.slice(0, 8)}@test.local`;
    const ph = await hashPassword("correct-horse-battery-staple");
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, password_hash)
        VALUES (${userId}::uuid, ${email}, 'Login OK', 'member', true, ${ph})
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: loginJsonHeaders(userId),
          body: JSON.stringify({
            email,
            password: "correct-horse-battery-staple",
          }),
        });
        assertEquals(res.status, 200);
        const j = await res.json() as {
          token: string;
          user: { id: string; email: string; role: string };
        };
        assertEquals(typeof j.token, "string");
        assertEquals(j.user.id, userId);
        assertEquals(j.user.email, email);
        const secret = new TextEncoder().encode(TEST_JWT_SECRET);
        const { payload } = await jose.jwtVerify(j.token, secret);
        assertEquals(payload.sub, userId);
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
  name: "E2E POST /api/auth/login — unbekannte Email → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const clientSeed = crypto.randomUUID();
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: loginJsonHeaders(clientSeed),
          body: JSON.stringify({
            email: "niemand@existiert.nicht",
            password: "irgendwas",
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
  name: "E2E POST /api/auth/login — falsches Passwort → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-bad-${userId.slice(0, 8)}@test.local`;
    const ph = await hashPassword("secret-one");
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, password_hash)
        VALUES (${userId}::uuid, ${email}, 'X', 'member', true, ${ph})
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: loginJsonHeaders(userId),
          body: JSON.stringify({ email, password: "wrong-password" }),
        });
        assertEquals(res.status, 401);
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
  name: "E2E POST /api/auth/login — inaktiver User → 401",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-inact-${userId.slice(0, 8)}@test.local`;
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active)
        VALUES (${userId}::uuid, ${email}, 'Inaktiv', 'member', false)
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: loginJsonHeaders(userId),
          body: JSON.stringify({ email, password: "versuch" }),
        });
        assertEquals(res.status, 401);
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
  name: "E2E POST /api/auth/login — ohne password → 400",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const clientSeed = crypto.randomUUID();
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: loginJsonHeaders(clientSeed),
          body: JSON.stringify({ email: "a@b.de" }),
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
  name: "E2E POST /api/auth/login — gleiche Fehlermeldung (unbekannt vs. falsch)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-same-${userId.slice(0, 8)}@test.local`;
    const ps = new PasswordService();
    const ph = await ps.hashPassword("Gleich1!x");
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, password_hash)
        VALUES (${userId}::uuid, ${email}, 'U', 'member', true, ${ph})
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
        const hdr = loginJsonHeaders(userId);
        const r1 = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({
            email: "nix@nix.nix",
            password: "egal",
          }),
        });
        const r2 = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ email, password: "falsch" }),
        });
        const j1 = await r1.json() as { error: string };
        const j2 = await r2.json() as { error: string };
        assertEquals(j1.error, j2.error);
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
  name: "E2E POST /api/auth/login — 5 Fehlversuche sperrt",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-lock-${userId.slice(0, 8)}@test.local`;
    const ps = new PasswordService();
    const ph = await ps.hashPassword("Start9!ok");
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, password_hash)
        VALUES (${userId}::uuid, ${email}, 'L', 'member', true, ${ph})
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
      const loginHeaders = loginJsonHeaders(userId);
      try {
        for (let i = 0; i < 4; i++) {
          const r = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: loginHeaders,
            body: JSON.stringify({ email, password: "wrong" }),
          });
          assertEquals(r.status, 401);
          const j = await r.json() as { error: string };
          assertEquals(j.error.includes("Email oder Passwort"), true);
        }
        const r5 = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: loginHeaders,
          body: JSON.stringify({ email, password: "wrong" }),
        });
        assertEquals(r5.status, 401);
        const j5 = await r5.json() as { error: string };
        assertEquals(j5.error.includes("30 Minuten"), true);
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
  name: "E2E POST /api/auth/login — IP-Rate-Limit 10/15min → 429",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-rl-${userId.slice(0, 8)}@test.local`;
    const ps = new PasswordService();
    const ph = await ps.hashPassword("Rate9!lim");
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, password_hash)
        VALUES (${userId}::uuid, ${email}, 'R', 'member', true, ${ph})
      `;
      const rateLimitIp = uniqueTestClientIp(userId);
      for (let i = 0; i < 10; i++) {
        await sql`
          INSERT INTO cos_login_attempts (email, ip_address, success)
          VALUES (${email}, ${rateLimitIp}, false)
        `;
      }
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
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": rateLimitIp,
          },
          body: JSON.stringify({ email, password: "Rate9!lim" }),
        });
        assertEquals(res.status, 429);
        const j = await res.json() as { retry_after?: number };
        assertEquals(typeof j.retry_after, "number");
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_login_attempts WHERE email = ${email}`;
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

Deno.test({
  name: "E2E POST /api/auth/change-password — schwach / falsch / ok",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const userId = crypto.randomUUID();
    const email = `auth-chg-${userId.slice(0, 8)}@test.local`;
    const ps = new PasswordService();
    const ph = await ps.hashPassword("Alt9!pass");
    try {
      await sql`
        INSERT INTO cos_users (id, email, name, role, is_active, password_hash)
        VALUES (${userId}::uuid, ${email}, 'C', 'member', true, ${ph})
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
        const tok = await mintUserToken(userId, email, "C", "member");
        const apiHdr = {
          ...loginJsonHeaders(userId),
          Authorization: `Bearer ${tok}`,
        };
        const bad = await fetch(`${baseUrl}/api/auth/change-password`, {
          method: "POST",
          headers: apiHdr,
          body: JSON.stringify({
            current_password: "Alt9!pass",
            new_password: "schwach",
          }),
        });
        assertEquals(bad.status, 400);
        const wrong = await fetch(`${baseUrl}/api/auth/change-password`, {
          method: "POST",
          headers: apiHdr,
          body: JSON.stringify({
            current_password: "falsch",
            new_password: "Neu9!pass",
          }),
        });
        assertEquals(wrong.status, 401);
        const ok = await fetch(`${baseUrl}/api/auth/change-password`, {
          method: "POST",
          headers: apiHdr,
          body: JSON.stringify({
            current_password: "Alt9!pass",
            new_password: "Neu9!pass",
          }),
        });
        assertEquals(ok.status, 200);
        const j = await ok.json() as { changed: boolean };
        assertEquals(j.changed, true);
      } finally {
        shutdown();
      }
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${userId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});
