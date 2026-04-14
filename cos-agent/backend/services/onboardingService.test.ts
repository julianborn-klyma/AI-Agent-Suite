import { assertEquals } from "@std/assert";
import postgres from "postgres";
import { createPostgresDatabaseClient } from "../db/databaseClient.ts";
import { runMigrations } from "../db/migrate.ts";
import { baseTestEnv, withTestEnv } from "../test_helpers.ts";
import { resolveTestDatabaseUrl } from "../test_database_url.ts";
import { AuditService } from "./auditService.ts";
import { TenantService } from "./tenantService.ts";
import { OnboardingService } from "./onboardingService.ts";

function svc(db: ReturnType<typeof createPostgresDatabaseClient>): OnboardingService {
  const audit = new AuditService(db);
  return new OnboardingService(db, new TenantService(db, audit), audit);
}

Deno.test({
  name: "OnboardingService — getStatus leer → next_step profile",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        await sql`
          INSERT INTO cos_users (id, email, name, role)
          VALUES (${uid}::uuid, 'onb-empty@test.local', 'Nu', 'member')
        `;
        const st = await svc(db).getStatus(uid);
        assertEquals(st.completed, false);
        assertEquals(st.steps.profile, false);
        assertEquals(st.next_step, "profile");
      } finally {
        await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "OnboardingService — Profil gesetzt → next_step connections",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        await sql`
          INSERT INTO cos_users (id, email, name, role)
          VALUES (${uid}::uuid, 'onb-prof@test.local', 'AB', 'member')
        `;
        await db.upsertUserContext({ userId: uid, key: "role", value: "CEO" });
        const st = await svc(db).getStatus(uid);
        assertEquals(st.steps.profile, true);
        assertEquals(st.next_step, "connections");
      } finally {
        await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "OnboardingService — Profil + Google → next_step chat",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        await sql`
          INSERT INTO cos_users (id, email, name, role)
          VALUES (${uid}::uuid, 'onb-goog@test.local', 'AB', 'member')
        `;
        await db.upsertUserContext({ userId: uid, key: "role", value: "Dev" });
        await db.upsertUserContext({
          userId: uid,
          key: "google_connected",
          value: "true",
        });
        const st = await svc(db).getStatus(uid);
        assertEquals(st.steps.connections.google, true);
        assertEquals(st.next_step, "chat");
      } finally {
        await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "OnboardingService — Chat vorhanden → next_step done (ohne DB-Flag)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      const sid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        await sql`
          INSERT INTO cos_users (id, email, name, role)
          VALUES (${uid}::uuid, 'onb-chat@test.local', 'AB', 'member')
        `;
        await db.upsertUserContext({ userId: uid, key: "role", value: "Dev" });
        await db.upsertUserContext({
          userId: uid,
          key: "google_connected",
          value: "true",
        });
        await sql`
          INSERT INTO cos_conversations (user_id, session_id, role, content)
          VALUES (${uid}::uuid, ${sid}::uuid, 'user', 'hi')
        `;
        const st = await svc(db).getStatus(uid);
        assertEquals(st.steps.first_chat, true);
        assertEquals(st.completed, false);
        assertEquals(st.next_step, "done");
      } finally {
        await sql`DELETE FROM cos_conversations WHERE user_id = ${uid}::uuid`;
        await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql.end({ timeout: 5 });
      }
    });
  },
});

Deno.test({
  name: "OnboardingService — completeOnboarding setzt Flag",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await withTestEnv(baseTestEnv({ DATABASE_URL: url }), async () => {
      await runMigrations(url);
      const sql = postgres(url, { max: 1 });
      const uid = crypto.randomUUID();
      try {
        const db = createPostgresDatabaseClient(sql);
        await sql`
          INSERT INTO cos_users (id, email, name, role)
          VALUES (${uid}::uuid, 'onb-done@test.local', 'AB', 'member')
        `;
        await svc(db).completeOnboarding(uid);
        const rows = await sql`
          SELECT onboarding_completed FROM cos_users WHERE id = ${uid}::uuid
        ` as { onboarding_completed: boolean }[];
        assertEquals(rows[0]?.onboarding_completed, true);
        const st = await svc(db).getStatus(uid);
        assertEquals(st.completed, true);
        assertEquals(st.next_step, "done");
      } finally {
        await sql`DELETE FROM cos_user_contexts WHERE user_id = ${uid}::uuid`;
        await sql`DELETE FROM cos_users WHERE id = ${uid}::uuid`;
        await sql.end({ timeout: 5 });
      }
    });
  },
});
