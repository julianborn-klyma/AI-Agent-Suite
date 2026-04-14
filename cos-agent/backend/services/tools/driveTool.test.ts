import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DatabaseClient, Learning } from "../../db/databaseClient.ts";
import { documentTestStubs, scheduleTestStubs } from "../../db/documentTestStubs.ts";
import { encrypt } from "./credentialHelper.ts";
import { driveTool } from "./driveTool.ts";

const HEX_KEY = "b".repeat(64);

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
  async insertLlmCall(): Promise<void> {}
  async findBriefingUser(): Promise<null> {
    return null;
  }
  async findUserByEmail(): Promise<null> {
    return null;
  }
  async findUserProfileById(): Promise<null> {
    return null;
  }
  async getSessionOwnerUserId(): Promise<null> {
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
  async insertOauthState(): Promise<void> {}
  async consumeOauthState(): Promise<null> {
    return null;
  }
  async deleteUserContextsByKeys(): Promise<void> {}
  async getLearnings(): Promise<Learning[]> {
    return [];
  }
  async upsertLearning(): Promise<Learning> {
    throw new Error("unused");
  }
  async upsertLearnings(): Promise<Learning[]> {
    return [];
  }
  async markLearningConflict(): Promise<void> {}
  async confirmLearning(): Promise<void> {}
  async deactivateLearning(): Promise<void> {}
  async bulkConfirmLearningsByTimesConfirmed(): Promise<void> {}

  insertDocument = documentTestStubs.insertDocument;
  getDocuments = documentTestStubs.getDocuments;
  getDocument = documentTestStubs.getDocument;
  updateDocumentProcessed = documentTestStubs.updateDocumentProcessed;
  deleteDocument = documentTestStubs.deleteDocument;
  insertChunks = documentTestStubs.insertChunks;
  searchChunks = documentTestStubs.searchChunks;
  getChunks = documentTestStubs.getChunks;

  getUserSchedules = scheduleTestStubs.getUserSchedules;
  upsertJobSchedule = scheduleTestStubs.upsertJobSchedule;
  toggleJobSchedule = scheduleTestStubs.toggleJobSchedule;
  initDefaultSchedules = scheduleTestStubs.initDefaultSchedules;
  listConversationMessagesForUserSince =
    scheduleTestStubs.listConversationMessagesForUserSince;
  purgeUserContextSummariesOlderThan =
    scheduleTestStubs.purgeUserContextSummariesOlderThan;
  purgeUserConversationsOlderThan = scheduleTestStubs.purgeUserConversationsOlderThan;
  recordScheduleRun = scheduleTestStubs.recordScheduleRun;
}

function withEnv(fn: () => Promise<void>): Promise<void> {
  const prevE = Deno.env.get("ENCRYPTION_KEY");
  const prevI = Deno.env.get("GOOGLE_CLIENT_ID");
  const prevS = Deno.env.get("GOOGLE_CLIENT_SECRET");
  Deno.env.set("ENCRYPTION_KEY", HEX_KEY);
  Deno.env.set("GOOGLE_CLIENT_ID", "test-id");
  Deno.env.set("GOOGLE_CLIENT_SECRET", "test-secret");
  return (async () => {
    try {
      await fn();
    } finally {
      if (prevE !== undefined) Deno.env.set("ENCRYPTION_KEY", prevE);
      else Deno.env.delete("ENCRYPTION_KEY");
      if (prevI !== undefined) Deno.env.set("GOOGLE_CLIENT_ID", prevI);
      else Deno.env.delete("GOOGLE_CLIENT_ID");
      if (prevS !== undefined) Deno.env.set("GOOGLE_CLIENT_SECRET", prevS);
      else Deno.env.delete("GOOGLE_CLIENT_SECRET");
    }
  })();
}

Deno.test("driveTool — ohne google_connected → nicht verbunden", async () => {
  await withEnv(async () => {
    const db = new FakeDb();
    db.contexts = [{ key: "gmail_access_token", value: await encrypt("tok") }];
    const r = await driveTool.execute(
      { action: "list_files" },
      "u1",
      db,
    );
    assertEquals(r.success, false);
    assertEquals(r.error, "Google Drive nicht verbunden.");
  });
});

Deno.test("driveTool — list_files: Drive-API-URL mit parents", async () => {
  await withEnv(async () => {
    const db = new FakeDb();
    const tok = await encrypt("access");
    db.contexts = [
      { key: "google_connected", value: "true" },
      { key: "gmail_access_token", value: tok },
      { key: "drive_folder_id", value: "folder-xyz" },
    ];
    let url = "";
    const orig = globalThis.fetch;
    globalThis.fetch = ((
      input: RequestInfo | URL,
    ): Promise<Response> => {
      url = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;
    try {
      const r = await driveTool.execute(
        { action: "list_files", limit: 10 },
        "u1",
        db,
      );
      assertEquals(r.success, true);
      assertStringIncludes(url, "https://www.googleapis.com/drive/v3/files");
      assertStringIncludes(url, "folder-xyz");
      assertStringIncludes(url, "in%20parents");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

Deno.test("driveTool — get_file_content: max 50.000 Zeichen", async () => {
  await withEnv(async () => {
    const db = new FakeDb();
    const tok = await encrypt("access");
    db.contexts = [
      { key: "google_connected", value: "true" },
      { key: "gmail_access_token", value: tok },
    ];
    const long = "x".repeat(60_000);
    const orig = globalThis.fetch;
    let call = 0;
    globalThis.fetch = ((
      input: RequestInfo | URL,
    ): Promise<Response> => {
      call++;
      const u = String(input);
      if (u.includes("/files/") && u.includes("fields=")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "f1",
              name: "doc",
              mimeType: "application/vnd.google-apps.document",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (u.includes("/export")) {
        return Promise.resolve(
          new Response(long, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as typeof fetch;
    try {
      const r = await driveTool.execute(
        { action: "get_file_content", file_id: "f1" },
        "u1",
        db,
      );
      assertEquals(r.success, true);
      const content = (r.data as { content?: string })?.content ?? "";
      assertEquals(content.length <= 50_000 + 30, true);
      assertStringIncludes(content, "… (gekürzt)");
    } finally {
      globalThis.fetch = orig;
    }
    assertEquals(call >= 2, true);
  });
});
