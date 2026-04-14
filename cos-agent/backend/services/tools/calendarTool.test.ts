import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import type { DatabaseClient, Learning } from "../../db/databaseClient.ts";
import { testAuthDbStubMethods } from "../../db/databaseClientTestAuthStubs.ts";
import { taskQueueTestStubs } from "../../db/taskQueueTestStubs.ts";
import { documentTestStubs, scheduleTestStubs } from "../../db/documentTestStubs.ts";
import { encrypt } from "./credentialHelper.ts";
import { calendarTool } from "./calendarTool.ts";

const HEX_KEY = "c".repeat(64);

class FakeDb implements DatabaseClient {
  countLoginAttemptsByIpSince =
    testAuthDbStubMethods.countLoginAttemptsByIpSince;
  insertLoginAttempt = testAuthDbStubMethods.insertLoginAttempt;
  incrementFailedLogin = testAuthDbStubMethods.incrementFailedLogin;
  recordSuccessfulLogin = testAuthDbStubMethods.recordSuccessfulLogin;
  updateUserPasswordHash = testAuthDbStubMethods.updateUserPasswordHash;
  insertAuditLog = testAuthDbStubMethods.insertAuditLog;
  listAuditLog = testAuthDbStubMethods.listAuditLog;
  findUserWithPasswordById = testAuthDbStubMethods.findUserWithPasswordById;
  getTenant = testAuthDbStubMethods.getTenant;
  getTenantBySlug = testAuthDbStubMethods.getTenantBySlug;
  listTenants = testAuthDbStubMethods.listTenants;
  insertTenant = testAuthDbStubMethods.insertTenant;
  updateTenant = testAuthDbStubMethods.updateTenant;
  updateTenantCredentials = testAuthDbStubMethods.updateTenantCredentials;
  getTenantForUser = testAuthDbStubMethods.getTenantForUser;
  setOnboardingCompleted = testAuthDbStubMethods.setOnboardingCompleted;
  getUserOnboardingSnapshot = testAuthDbStubMethods.getUserOnboardingSnapshot;

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

  insertTask = taskQueueTestStubs.insertTask;
  getTasks = taskQueueTestStubs.getTasks;
  getTask = taskQueueTestStubs.getTask;
  getNextPendingTask = taskQueueTestStubs.getNextPendingTask;
  updateTaskStatus = taskQueueTestStubs.updateTaskStatus;
  cancelTask = taskQueueTestStubs.cancelTask;
}

function withEnv(fn: () => Promise<void>): Promise<void> {
  const prevE = Deno.env.get("ENCRYPTION_KEY");
  const prevI = Deno.env.get("GOOGLE_CLIENT_ID");
  const prevS = Deno.env.get("GOOGLE_CLIENT_SECRET");
  Deno.env.set("ENCRYPTION_KEY", HEX_KEY);
  Deno.env.set("GOOGLE_CLIENT_ID", "cid");
  Deno.env.set("GOOGLE_CLIENT_SECRET", "sec");
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

Deno.test("calendarTool — ohne google_connected → nicht verbunden", async () => {
  await withEnv(async () => {
    const db = new FakeDb();
    db.contexts = [{ key: "gmail_access_token", value: await encrypt("t") }];
    const r = await calendarTool.execute(
      { action: "get_today_events" },
      "u1",
      db,
    );
    assertEquals(r.success, false);
    assertEquals(r.error, "Google Calendar nicht verbunden.");
  });
});

Deno.test("calendarTool — get_today_events: timeMin/timeMax + Europe/Berlin", async () => {
  await withEnv(async () => {
    const db = new FakeDb();
    db.contexts = [
      { key: "google_connected", value: "true" },
      { key: "gmail_access_token", value: await encrypt("acc") },
    ];
    let url = "";
    const orig = globalThis.fetch;
    globalThis.fetch = ((
      input: RequestInfo | URL,
    ): Promise<Response> => {
      url = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;
    try {
      const r = await calendarTool.execute(
        { action: "get_today_events" },
        "u1",
        db,
      );
      assertEquals(r.success, true);
      assertStringIncludes(url, "timeMin=");
      assertStringIncludes(url, "timeMax=");
      assertStringIncludes(url, "Europe");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

Deno.test("calendarTool — find_free_slots: Zeitfenster", async () => {
  await withEnv(async () => {
    const db = new FakeDb();
    db.contexts = [
      { key: "google_connected", value: "true" },
      { key: "gmail_access_token", value: await encrypt("acc") },
    ];
    const orig = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [
                  {
                    start: "2026-04-07T10:00:00+02:00",
                    end: "2026-04-07T11:00:00+02:00",
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    try {
      const r = await calendarTool.execute(
        {
          action: "find_free_slots",
          date: "2026-04-07",
          duration_minutes: 30,
        },
        "u1",
        db,
      );
      assertEquals(r.success, true);
      const slots = (r.data as { free_slots?: unknown[] })?.free_slots;
      assertExists(slots);
      assertEquals(Array.isArray(slots), true);
      assertEquals((slots as { duration_minutes?: number }[]).length >= 1, true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
