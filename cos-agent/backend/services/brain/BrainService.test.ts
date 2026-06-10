import { assertEquals, assertRejects } from "@std/assert";
import postgres from "postgres";
import {
  BrainForbiddenError,
  BrainNotFoundError,
  createPostgresDatabaseClient,
} from "../../db/databaseClient.ts";
import { runMigrations } from "../../db/migrate.ts";
import { resolveTestDatabaseUrl } from "../../test_database_url.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../llm/llmTypes.ts";
import { BrainService } from "./BrainService.ts";

function uniqEmail(tag: string) {
  return `brain.${tag}.${crypto.randomUUID()}@test.local`;
}

class FakeLlm implements LlmClient {
  constructor(private readonly content: string) {}
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: this.content,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    };
  }
}

async function createUser(sql: ReturnType<typeof postgres>, tag: string) {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO cos_users (id, email, name, role)
    VALUES (${id}::uuid, ${uniqEmail(tag)}, ${tag}, 'member')
  `;
  return id;
}

async function getTenantId(sql: ReturnType<typeof postgres>): Promise<string> {
  const rows = await sql`SELECT id::text FROM cos_tenants WHERE slug = 'klyma' LIMIT 1`;
  return rows[0]!.id as string;
}

// ── Permission: assertCanRead ──────────────────────────────────────────────

Deno.test({
  name: "BrainService — nicht-Member bekommt ForbiddenError beim Lesen",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const [ownerId, strangerId] = await Promise.all([
      createUser(sql, "owner-read"),
      createUser(sql, "stranger-read"),
    ]);
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Lese-Test Projekt",
      });

      await assertRejects(
        () => svc.getEntries(project.id, strangerId),
        BrainForbiddenError,
      );
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${ownerId}::uuid, ${strangerId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Permission: member darf nicht schreiben ───────────────────────────────

Deno.test({
  name: "BrainService — member bekommt ForbiddenError beim Schreiben",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const [ownerId, memberId] = await Promise.all([
      createUser(sql, "owner-w"),
      createUser(sql, "member-w"),
    ]);
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Write-Test Projekt",
      });
      await svc.inviteMember(project.id, memberId, "member", ownerId);

      await assertRejects(
        () =>
          svc.addEntry(project.id, memberId, {
            type: "fact",
            content: "Ich darf das nicht.",
          }),
        BrainForbiddenError,
      );
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Permission: knowledge_owner darf schreiben ────────────────────────────

Deno.test({
  name: "BrainService — knowledge_owner darf Entries hinzufügen",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const [ownerId, koId] = await Promise.all([
      createUser(sql, "owner-ko"),
      createUser(sql, "ko"),
    ]);
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "KO-Test Projekt",
      });
      await svc.inviteMember(project.id, koId, "knowledge_owner", ownerId);

      const { entry } = await svc.addEntry(project.id, koId, {
        type: "decision",
        content: "Wir setzen auf Aluminium-Profile.",
      });

      assertEquals(entry.created_by, koId);
      assertEquals(entry.type, "decision");
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${ownerId}::uuid, ${koId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Permission: owner darf schreiben ─────────────────────────────────────

Deno.test({
  name: "BrainService — owner darf Entries hinzufügen und lesen",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const ownerId = await createUser(sql, "owner-full");
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Owner-Test",
        color: "#ff0000",
      });
      const { entry } = await svc.addEntry(project.id, ownerId, {
        type: "fact",
        content: "CEO ist Julian Born.",
        source: "manuell",
      });

      const entries = await svc.getEntries(project.id, ownerId);
      assertEquals(entries.length, 1);
      assertEquals(entries[0]!.id, entry.id);
      assertEquals(entries[0]!.content, "CEO ist Julian Born.");
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${ownerId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Abgelaufene Entries werden ausgeblendet ───────────────────────────────

Deno.test({
  name: "BrainService — abgelaufene Entries erscheinen nicht in getEntries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const ownerId = await createUser(sql, "owner-expire");
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Expire-Test",
      });

      await svc.addEntry(project.id, ownerId, {
        type: "context",
        content: "Gültiger Eintrag.",
      });
      await svc.addEntry(project.id, ownerId, {
        type: "context",
        content: "Abgelaufener Eintrag.",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });

      const entries = await svc.getEntries(project.id, ownerId);
      assertEquals(entries.length, 1);
      assertEquals(entries[0]!.content, "Gültiger Eintrag.");
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${ownerId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Projekt-Owner kann nicht entfernt werden ──────────────────────────────

Deno.test({
  name: "BrainService — Owner kann nicht removeMember entfernen",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const ownerId = await createUser(sql, "owner-rm");
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Remove-Test",
      });

      await assertRejects(
        () => svc.removeMember(project.id, ownerId, ownerId),
        BrainForbiddenError,
      );
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${ownerId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── getContextForAgent: Nicht-Member 403 ──────────────────────────────────

Deno.test({
  name: "BrainService — getContextForAgent: Nicht-Member bekommt ForbiddenError",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const [ownerId, strangerId] = await Promise.all([
      createUser(sql, "owner-ctx"),
      createUser(sql, "stranger-ctx"),
    ]);
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Context-Agent-Test",
      });

      await assertRejects(
        () =>
          svc.getContextForAgent([project.id], strangerId, "Was ist die Strategie?"),
        BrainForbiddenError,
      );
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${ownerId}::uuid, ${strangerId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Konflikt-Erkennung: LLM wird befragt ─────────────────────────────────

Deno.test({
  name:
    "BrainService — detectConflicts: LLM erkennt Widerspruch (fake LLM mit conflict=true)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const ownerId = await createUser(sql, "owner-conflict");
    try {
      const db = createPostgresDatabaseClient(sql);
      const conflictLlm = new FakeLlm(
        '{"conflict": true, "reason": "Aussagen widersprechen sich bezüglich EU-Expansion."}',
      );
      const fakeEmbedder = {
        async embed(_text: string): Promise<number[]> {
          return Array.from({ length: 1536 }, (_, i) => i === 0 ? 0.9 : 0.1);
        },
      };
      const svc = new BrainService(db, conflictLlm, fakeEmbedder);
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Konflikt-Test",
      });

      const { entry: entryA } = await svc.addEntry(project.id, ownerId, {
        type: "decision",
        content: "Wir expandieren 2025 nach EU.",
      });
      assertEquals(entryA.type, "decision");

      const { conflicts } = await svc.addEntry(project.id, ownerId, {
        type: "decision",
        content: "Wir expandieren 2025 NICHT nach EU.",
      });

      assertEquals(conflicts.length, 1);
      assertEquals(conflicts[0]!.resolved, false);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${ownerId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── Konflikt auflösen ─────────────────────────────────────────────────────

Deno.test({
  name: "BrainService — resolveConflict: Konflikt wird als resolved markiert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const ownerId = await createUser(sql, "owner-resolve");
    try {
      const db = createPostgresDatabaseClient(sql);
      const conflictLlm = new FakeLlm('{"conflict": true, "reason": "Widerspruch"}');
      const fakeEmbedder = {
        async embed(_text: string): Promise<number[]> {
          return Array.from({ length: 1536 }, () => 0.5);
        },
      };
      const svc = new BrainService(db, conflictLlm, fakeEmbedder);
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Resolve-Test",
      });

      await svc.addEntry(project.id, ownerId, {
        type: "fact",
        content: "Hans ist Betriebsleiter.",
      });
      const { conflicts } = await svc.addEntry(project.id, ownerId, {
        type: "fact",
        content: "Hans ist kein Betriebsleiter.",
      });
      assertEquals(conflicts.length, 1);

      await svc.resolveConflict(conflicts[0]!.id, ownerId);

      const open = await svc.getConflicts(project.id, ownerId);
      assertEquals(open.length, 0);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${ownerId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── deleteEntry ───────────────────────────────────────────────────────────

Deno.test({
  name: "BrainService — deleteEntry: Entry wird deaktiviert",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const ownerId = await createUser(sql, "owner-del");
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Delete-Test",
      });
      const { entry } = await svc.addEntry(project.id, ownerId, {
        type: "context",
        content: "Wird gelöscht.",
      });

      await svc.deleteEntry(entry.id, ownerId);

      const entries = await svc.getEntries(project.id, ownerId);
      assertEquals(entries.length, 0);
    } finally {
      await sql`DELETE FROM cos_users WHERE id = ${ownerId}::uuid`;
      await sql.end({ timeout: 5 });
    }
  },
});

// ── deleteEntry: kein Recht ───────────────────────────────────────────────

Deno.test({
  name: "BrainService — member kann Entry nicht löschen (ForbiddenError)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const url = resolveTestDatabaseUrl();
    await runMigrations(url);
    const sql = postgres(url, { max: 2 });
    const [ownerId, memberId] = await Promise.all([
      createUser(sql, "owner-del2"),
      createUser(sql, "member-del2"),
    ]);
    try {
      const db = createPostgresDatabaseClient(sql);
      const svc = new BrainService(db, new FakeLlm("[]"));
      const tenantId = await getTenantId(sql);

      const project = await svc.createProject(tenantId, ownerId, {
        name: "Delete-Perm-Test",
      });
      await svc.inviteMember(project.id, memberId, "member", ownerId);
      const { entry } = await svc.addEntry(project.id, ownerId, {
        type: "fact",
        content: "Dieser Eintrag ist sicher.",
      });

      await assertRejects(
        () => svc.deleteEntry(entry.id, memberId),
        BrainForbiddenError,
      );

      const entries = await svc.getEntries(project.id, memberId);
      assertEquals(entries.length, 1);
    } finally {
      await sql`DELETE FROM cos_users WHERE id IN (${ownerId}::uuid, ${memberId}::uuid)`;
      await sql.end({ timeout: 5 });
    }
  },
});
