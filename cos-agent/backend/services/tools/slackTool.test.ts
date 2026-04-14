import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DatabaseClient, Learning } from "../../db/databaseClient.ts";
import { testAuthDbStubMethods } from "../../db/databaseClientTestAuthStubs.ts";
import { taskQueueTestStubs } from "../../db/taskQueueTestStubs.ts";
import { documentTestStubs, scheduleTestStubs } from "../../db/documentTestStubs.ts";
import { encrypt } from "./credentialHelper.ts";
import { slackTool } from "./slackTool.ts";

const HEX_KEY = "a".repeat(64);

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

function withKey(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("ENCRYPTION_KEY");
  Deno.env.set("ENCRYPTION_KEY", HEX_KEY);
  return (async () => {
    try {
      await fn();
    } finally {
      if (prev !== undefined) Deno.env.set("ENCRYPTION_KEY", prev);
      else Deno.env.delete("ENCRYPTION_KEY");
    }
  })();
}

Deno.test("slackTool — ohne slack_access_token → nicht verbunden", async () => {
  await withKey(async () => {
    const db = new FakeDb();
    const r = await slackTool.execute(
      { action: "list_channels" },
      "u1",
      db,
    );
    assertEquals(r.success, false);
    assertEquals(r.error, "Slack nicht verbunden.");
  });
});

Deno.test("slackTool — list_channels: Authorization Bearer", async () => {
  await withKey(async () => {
    const db = new FakeDb();
    db.contexts = [{
      key: "slack_access_token",
      value: await encrypt("xoxb-test-token"),
    }];
    const seen: { auth?: string }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = ((
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      seen.push({
        auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      });
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, channels: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;
    try {
      const r = await slackTool.execute({ action: "list_channels" }, "u1", db);
      assertEquals(r.success, true);
      assertStringIncludes(seen[0]?.auth ?? "", "Bearer xoxb-test-token");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

Deno.test("slackTool — ok: false → success false", async () => {
  await withKey(async () => {
    const db = new FakeDb();
    db.contexts = [{
      key: "slack_access_token",
      value: await encrypt("xoxb-x"),
    }];
    const orig = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    try {
      const r = await slackTool.execute({ action: "list_channels" }, "u1", db);
      assertEquals(r.success, false);
      assertStringIncludes(r.error ?? "", "Slack API Fehler: invalid_auth");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

Deno.test("slackTool — HTTP 429 → Retry-After → zweiter Versuch", async () => {
  await withKey(async () => {
    const db = new FakeDb();
    db.contexts = [{
      key: "slack_access_token",
      value: await encrypt("xoxb-x"),
    }];
    let n = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = () => {
      n++;
      if (n === 1) {
        return Promise.resolve(
          new Response("", {
            status: 429,
            headers: { "Retry-After": "0" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, channels: [{ id: "C1" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    try {
      const r = await slackTool.execute({ action: "list_channels" }, "u1", db);
      assertEquals(r.success, true);
      assertEquals(n, 2);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
