import { assertEquals, assertExists } from "@std/assert";
import type { DatabaseClient, Learning } from "../../db/databaseClient.ts";
import { testAuthDbStubMethods } from "../../db/databaseClientTestAuthStubs.ts";
import { documentTestStubs, scheduleTestStubs } from "../../db/documentTestStubs.ts";
import { taskQueueTestStubs } from "../../db/taskQueueTestStubs.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../services/llm/llmTypes.ts";
import { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import { parseAnthropicResponse } from "../../services/llm/anthropicClient.ts";
import type { AgentContext } from "../types.ts";
import { WebSearchAgent } from "./webSearchAgent.ts";

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

  async findAgentConfigForUser(): Promise<null> {
    return null;
  }
  async listUserContexts(): Promise<{ key: string; value: string }[]> {
    return [];
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

const baseCtx = (): AgentContext => ({
  userId: "u1",
  systemPrompt: "sys",
  userContexts: [],
  userProfile: null,
  learnings: [],
  connectedTools: ["web_search"],
  recentHistory: [],
});

class CaptureLlm implements LlmClient {
  requests: LlmRequest[] = [];
  constructor(private readonly response: LlmResponse) {}
  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    return this.response;
  }
}

Deno.test("WebSearchAgent — search → useWebSearch (tools enthält web_search)", async () => {
  const llm = new CaptureLlm({
    content: "Ergebnis. Quelle: news.example.org",
    input_tokens: 2,
    output_tokens: 3,
    stop_reason: "end_turn",
  });
  const agent = new WebSearchAgent(llm, new FakeDb(), new ToolExecutor());
  await agent.execute(
    { type: "search", query: "Klima news" },
    baseCtx(),
  );
  const tools = llm.requests[0]?.tools;
  assertExists(tools);
  assertEquals(tools.includes("web_search"), true);
});

Deno.test("WebSearchAgent — research deep → bis zu 3 LLM-Calls", async () => {
  const llm = new CaptureLlm({
    content: "A Quelle: a.de",
    input_tokens: 1,
    output_tokens: 1,
    stop_reason: "end_turn",
  });
  const agent = new WebSearchAgent(llm, new FakeDb(), new ToolExecutor());
  await agent.execute(
    { type: "research", query: "Markt", depth: "deep" },
    baseCtx(),
  );
  assertEquals(llm.requests.length, 3);
});

Deno.test("parseAnthropicResponse — web_search Tool-Blöcke → nur Text", () => {
  const r = parseAnthropicResponse({
    usage: { input_tokens: 1, output_tokens: 1 },
    stop_reason: "end_turn",
    content: [
      { type: "text", text: "Fakt " },
      { type: "server_tool_use", id: "1", name: "web_search" },
      { type: "web_search_tool_result", tool_use_id: "1", content: "x" },
      { type: "text", text: "(Quelle: studie.de)" },
    ],
  });
  assertEquals(r.content.includes("Quelle"), true);
});

Deno.test("WebSearchAgent — summary mit Quellenhinweis", async () => {
  const llm = new CaptureLlm({
    content: "Kurzinfo.\nQuelle: bericht.example",
    input_tokens: 1,
    output_tokens: 1,
    stop_reason: "end_turn",
  });
  const agent = new WebSearchAgent(llm, new FakeDb(), new ToolExecutor());
  const r = await agent.execute(
    { type: "search", query: "x" },
    baseCtx(),
  );
  assertExists(r.summary);
  assertEquals(/quelle|bericht/i.test(r.summary ?? ""), true);
});
