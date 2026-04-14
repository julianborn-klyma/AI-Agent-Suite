import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  AgentConfigRow,
  DatabaseClient,
  Learning,
} from "../db/databaseClient.ts";
import { testAuthDbStubMethods } from "../db/databaseClientTestAuthStubs.ts";
import { documentTestStubs, scheduleTestStubs } from "../db/documentTestStubs.ts";
import { taskQueueTestStubs } from "../db/taskQueueTestStubs.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import { AgentService } from "./agentService.ts";
import { ToolExecutor } from "./tools/toolExecutor.ts";

class FakeLlmClient implements LlmClient {
  lastRequest: LlmRequest | null = null;
  response: LlmResponse = {
    content: "assistant-ok",
    input_tokens: 10,
    output_tokens: 20,
    stop_reason: "end_turn",
  };

  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.lastRequest = req;
    return this.response;
  }
}

class FakeDatabaseClient implements DatabaseClient {
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

  prompt: string | null =
    "BASE\n{{USER_CONTEXT}}\n---\n{{NOW}}";
  contexts: { key: string; value: string }[] = [];
  toolsEnabled: string[] = [];

  async findAgentConfigForUser(
    _userId: string,
  ): Promise<AgentConfigRow | null> {
    if (this.prompt === null) return null;
    return {
      system_prompt: this.prompt,
      tools_enabled: this.toolsEnabled,
    };
  }

  async listUserContexts(_userId: string): Promise<{ key: string; value: string }[]> {
    return this.contexts.slice().sort((a, b) => a.key.localeCompare(b.key));
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
    userId: string | null;
    provider: string;
  }): Promise<void> {}

  async consumeOauthState(
    _state: string,
  ): Promise<{ userId: string | null; provider: string } | null> {
    return null;
  }

  async deleteUserContextsByKeys(_userId: string, _keys: string[]): Promise<void> {}

  async getLearnings(): Promise<Learning[]> {
    return [];
  }

  async upsertLearning(): Promise<Learning> {
    throw new Error("not used in agentService tests");
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

const fixedNow = new Date("2026-04-07T07:15:00.000Z");

Deno.test("buildSystemPrompt — User ohne Kontext: {{USER_CONTEXT}} leer", async () => {
  const db = new FakeDatabaseClient();
  db.prompt = "Vor [[{{USER_CONTEXT}}]] Nach";
  db.contexts = [];
  const llm = new FakeLlmClient();
  const svc = new AgentService(db, llm, new ToolExecutor(), {
    now: () => fixedNow,
  });
  const prompt = await svc.buildSystemPrompt("u1");

  assertStringIncludes(prompt, "Vor [[");
  assertStringIncludes(prompt, "]] Nach");
  assertEquals(prompt.includes("{{USER_CONTEXT}}"), false);
  const inner = prompt.slice(
    prompt.indexOf("[[") + 2,
    prompt.indexOf("]]"),
  );
  assertEquals(inner, "");
});

Deno.test("buildSystemPrompt — drei Kontexte, sortiert als key: value", async () => {
  const db = new FakeDatabaseClient();
  db.prompt = "CTX:\n{{USER_CONTEXT}}\nEND";
  db.contexts = [
    { key: "z_last", value: "3" },
    { key: "a_first", value: "1" },
    { key: "m_mid", value: "2" },
  ];
  const llm = new FakeLlmClient();
  const svc = new AgentService(db, llm, new ToolExecutor(), {
    now: () => fixedNow,
  });
  const prompt = await svc.buildSystemPrompt("u2");

  assertStringIncludes(prompt, "a_first: 1");
  assertStringIncludes(prompt, "m_mid: 2");
  assertStringIncludes(prompt, "z_last: 3");
  const ctxStart = prompt.indexOf("CTX:\n") + "CTX:\n".length;
  const ctxEnd = prompt.indexOf("\nEND");
  const block = prompt.slice(ctxStart, ctxEnd);
  assertEquals(block, "a_first: 1\nm_mid: 2\nz_last: 3");
});

Deno.test("buildSystemPrompt — ohne {{USER_CONTEXT}} Placeholder: kein Fehler", async () => {
  const db = new FakeDatabaseClient();
  db.prompt = "Nur Datum: {{NOW}} — fertig.";
  db.contexts = [{ key: "ignored", value: "x" }];
  const llm = new FakeLlmClient();
  const svc = new AgentService(db, llm, new ToolExecutor(), {
    now: () => fixedNow,
  });
  const prompt = await svc.buildSystemPrompt("u3");

  assertEquals(prompt.includes("{{USER_CONTEXT}}"), false);
  assertEquals(prompt.includes("{{NOW}}"), false);
  assertStringIncludes(prompt, "Nur Datum:");
  assertStringIncludes(prompt, "— fertig.");
});
