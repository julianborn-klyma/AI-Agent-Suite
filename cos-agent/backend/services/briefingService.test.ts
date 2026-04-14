import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  AgentConfigRow,
  DatabaseClient,
  Learning,
} from "../db/databaseClient.ts";
import { testAuthDbStubMethods } from "../db/databaseClientTestAuthStubs.ts";
import { documentTestStubs, scheduleTestStubs } from "../db/documentTestStubs.ts";
import { taskQueueTestStubs } from "../db/taskQueueTestStubs.ts";
import { isBriefingDue } from "../cron/dailyBriefing.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import { BriefingService, DEFAULT_SYSTEM_PROMPT } from "./briefingService.ts";
import { ToolExecutor } from "./tools/toolExecutor.ts";
import type { ToolResult } from "./tools/types.ts";

class CaptureLlm implements LlmClient {
  lastRequest: LlmRequest | null = null;
  response: LlmResponse = {
    content: "briefing-output",
    input_tokens: 5,
    output_tokens: 8,
    stop_reason: "end_turn",
  };

  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.lastRequest = req;
    return this.response;
  }
}

class BriefingTestDb implements DatabaseClient {
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

  briefingUser: { name: string; email: string } | null = {
    name: "Max Mustermann",
    email: "max@test.local",
  };
  agentConfig: AgentConfigRow | null = {
    system_prompt: "Custom system",
    tools_enabled: ["notion", "gmail"],
  };
  contexts: { key: string; value: string }[] = [
    { key: "notion_database_id", value: "db-abc" },
  ];
  insertCalls: number = 0;

  async findAgentConfigForUser(_userId: string): Promise<AgentConfigRow | null> {
    return this.agentConfig;
  }
  async listUserContexts(_userId: string): Promise<{ key: string; value: string }[]> {
    return this.contexts;
  }
  async upsertUserContext(): Promise<void> {}
  async listRecentConversationMessages(): Promise<{ role: string; content: string }[]> {
    return [];
  }
  async insertConversationMessage(): Promise<void> {}
  async insertLlmCall(): Promise<void> {
    this.insertCalls++;
  }
  async findBriefingUser(_userId: string): Promise<{ name: string; email: string } | null> {
    return this.briefingUser;
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

Deno.test("BriefingService — Notion + Gmail Daten im Prompt, Antwort non-empty", async () => {
  const db = new BriefingTestDb();
  const llm = new CaptureLlm();
  const exec = new ToolExecutor();

  const notionTasks = { pages: [{ id: "1", title: "A" }, { id: "2", title: "B" }] };
  const gmailMails = [
    { id: "m1", subject: "S1", from: "a@x", snippet: "x" },
    { id: "m2", subject: "S2", from: "b@x", snippet: "y" },
    { id: "m3", subject: "S3", from: "c@x", snippet: "z" },
  ];

  const svc = new BriefingService(db, llm, exec, {
    notionRunner: async (): Promise<ToolResult> => ({
      success: true,
      data: notionTasks,
    }),
    gmailRunner: async (): Promise<ToolResult> => ({
      success: true,
      data: gmailMails,
    }),
    slackRunner: async () => ({ success: false, error: "skip" }),
    calendarRunner: async () => ({ success: false, error: "skip" }),
  });

  const out = await svc.generateBriefing("u1");
  assertEquals(out, "briefing-output");
  assertEquals(db.insertCalls, 1);
  const req = llm.lastRequest!;
  assertStringIncludes(req.messages[0]!.content, JSON.stringify(notionTasks, null, 2));
  assertStringIncludes(req.messages[0]!.content, JSON.stringify(gmailMails, null, 2));
  assertEquals(req.system, "Custom system");
  assertEquals(req.metadata.source, "cos-briefing");
});

Deno.test("BriefingService — ohne notion_database_id: Notion übersprungen, LLM wird aufgerufen", async () => {
  const db = new BriefingTestDb();
  db.contexts = [{ key: "other", value: "x" }];
  const llm = new CaptureLlm();
  const exec = new ToolExecutor();
  let notionCalls = 0;
  const svc = new BriefingService(db, llm, exec, {
    notionRunner: async (): Promise<ToolResult> => {
      notionCalls++;
      return { success: true, data: {} };
    },
    gmailRunner: async (): Promise<ToolResult> => ({
      success: true,
      data: [],
    }),
    slackRunner: async () => ({ success: false, error: "skip" }),
    calendarRunner: async () => ({ success: false, error: "skip" }),
  });
  await svc.generateBriefing("u1");
  assertEquals(notionCalls, 0);
  assertStringIncludes(llm.lastRequest!.messages[0]!.content, "Nicht verfügbar");
  assertEquals(llm.lastRequest!.model, "claude-sonnet-4-20250514");
});

Deno.test("BriefingService — Tool wirft: Briefing wird trotzdem generiert", async () => {
  const db = new BriefingTestDb();
  const llm = new CaptureLlm();
  const exec = new ToolExecutor();
  const svc = new BriefingService(db, llm, exec, {
    notionRunner: async (): Promise<ToolResult> => {
      throw new Error("notion down");
    },
    gmailRunner: async (): Promise<ToolResult> => ({
      success: true,
      data: [{ x: 1 }],
    }),
    slackRunner: async () => ({ success: false, error: "skip" }),
    calendarRunner: async () => ({ success: false, error: "skip" }),
  });
  const out = await svc.generateBriefing("u1");
  assertEquals(out, "briefing-output");
  assertStringIncludes(llm.lastRequest!.messages[0]!.content, "Nicht verfügbar");
});

Deno.test("BriefingService — kein agent_config: Default-System-Prompt", async () => {
  const db = new BriefingTestDb();
  db.agentConfig = null;
  const llm = new CaptureLlm();
  const exec = new ToolExecutor();
  const svc = new BriefingService(db, llm, exec, {
    notionRunner: async () => ({ success: true, data: {} }),
    gmailRunner: async () => ({ success: true, data: [] }),
    slackRunner: async () => ({ success: false, error: "skip" }),
    calendarRunner: async () => ({ success: false, error: "skip" }),
  });
  await svc.generateBriefing("u1");
  assertEquals(llm.lastRequest!.system, DEFAULT_SYSTEM_PROMPT);
});

Deno.test("isBriefingDue — last_run heute → false", () => {
  const now = new Date("2026-04-07T05:00:00.000Z");
  const schedule = {
    cron_expression: "0 7 * * 1-5",
    last_run: new Date("2026-04-07T04:00:00.000Z"),
  };
  assertEquals(isBriefingDue(schedule, now), false);
});

Deno.test("isBriefingDue — gestern gelaufen, 7:00 Berlin, Wochentag 1–5 → true", () => {
  const now = new Date("2026-04-07T05:00:00.000Z");
  const schedule = {
    cron_expression: "0 7 * * 1-5",
    last_run: new Date("2026-04-06T12:00:00.000Z"),
  };
  assertEquals(isBriefingDue(schedule, now), true);
});

Deno.test("isBriefingDue — Samstag → false", () => {
  const now = new Date("2026-04-11T05:00:00.000Z");
  const schedule = {
    cron_expression: "0 7 * * 1-5",
    last_run: null,
  };
  assertEquals(isBriefingDue(schedule, now), false);
});
