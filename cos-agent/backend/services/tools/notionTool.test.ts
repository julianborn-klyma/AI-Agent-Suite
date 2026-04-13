import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DatabaseClient } from "../../db/databaseClient.ts";
import { notionTool } from "./notionTool.ts";

class FakeDb implements DatabaseClient {
  contexts: { key: string; value: string }[] = [];

  async findAgentConfigForUser(): Promise<null> {
    return null;
  }
  async listUserContexts(): Promise<{ key: string; value: string }[]> {
    return this.contexts;
  }
  async listRecentConversationMessages(): Promise<
    { role: string; content: string }[]
  > {
    return [];
  }
  async insertConversationMessage(): Promise<void> {}
  async insertLlmCall(_params: {
    userId: string;
    sessionId: string | null;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    latencyMs: number | null;
  }): Promise<void> {}
  async findBriefingUser(): Promise<{ name: string; email: string } | null> {
    return null;
  }
  async findUserByEmail(): Promise<null> {
    return null;
  }
  async findUserProfileById(): Promise<null> {
    return null;
  }
  async getSessionOwnerUserId(): Promise<string | null> {
    return null;
  }
  async listChatHistoryForUser(): Promise<
    { role: string; content: string; created_at: Date }[]
  > {
    return [];
  }
  async listChatSessionsForUser(): Promise<
    {
      session_id: string;
      preview: string;
      last_activity: Date;
      message_count: number;
    }[]
  > {
    return [];
  }
  async deleteChatSessionForUser(): Promise<number> {
    return 0;
  }
  async upsertUserContext(): Promise<void> {}

  async insertOauthState(_params: {
    state: string;
    userId: string;
    provider: string;
  }): Promise<void> {}

  async consumeOauthState(
    _state: string,
  ): Promise<{ userId: string; provider: string } | null> {
    return null;
  }

  async deleteUserContextsByKeys(_userId: string, _keys: string[]): Promise<void> {}
}

const userId = "00000000-0000-4000-8000-000000000001";

Deno.test("notionTool — ohne notion_token → nicht verbunden", async () => {
  const db = new FakeDb();
  db.contexts = [];
  const r = await notionTool.execute(
    { action: "list_tasks", database_id: "db-1" },
    userId,
    db,
  );
  assertEquals(r.success, false);
  assertStringIncludes(r.error ?? "", "nicht verbunden");
});

Deno.test({
  name: "notionTool — list_tasks ruft Notion-Query mit Auth auf",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const orig = globalThis.fetch;
    const calls: { url: string; headers: Headers }[] = [];
    globalThis.fetch = ((
      input: string | Request | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
        ? input.url
        : input.href;
      const headers = new Headers(init?.headers);
      calls.push({ url, headers });
      return Promise.resolve(
        new Response(JSON.stringify({ object: "list", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;
    try {
      const db = new FakeDb();
      db.contexts = [{ key: "notion_token", value: "secret-notion" }];
      await notionTool.execute(
        { action: "list_tasks", database_id: "abc-123-db" },
        userId,
        db,
      );
      assertEquals(calls.length >= 1, true);
      const q = calls.find((c) => c.url.includes("/databases/abc-123-db/query"));
      assertEquals(q !== undefined, true);
      assertEquals(q?.headers.get("Authorization"), "Bearer secret-notion");
      assertEquals(q?.headers.get("Notion-Version"), "2022-06-28");
    } finally {
      globalThis.fetch = orig;
    }
  },
});

Deno.test({
  name: "notionTool — Notion 401 → API Fehler",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const orig = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(new Response("no", { status: 401 }));
    try {
      const db = new FakeDb();
      db.contexts = [{ key: "notion_token", value: "tok" }];
      const r = await notionTool.execute(
        { action: "list_tasks", database_id: "dbx" },
        userId,
        db,
      );
      assertEquals(r.success, false);
      assertStringIncludes(r.error ?? "", "API Fehler");
      assertStringIncludes(r.error ?? "", "401");
    } finally {
      globalThis.fetch = orig;
    }
  },
});
