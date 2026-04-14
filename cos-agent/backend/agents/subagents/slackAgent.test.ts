import { assertEquals, assertExists } from "@std/assert";
import type { DatabaseClient, Learning } from "../../db/databaseClient.ts";
import { documentTestStubs, scheduleTestStubs } from "../../db/documentTestStubs.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../services/llm/llmTypes.ts";
import { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext } from "../types.ts";
import { SlackAgent } from "./slackAgent.ts";

class FakeDb implements DatabaseClient {
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
}

class StubLlm implements LlmClient {
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

class StubToolExecutor extends ToolExecutor {
  override async execute(
    toolName: string,
    params: unknown,
    _userId: string,
    _db: DatabaseClient,
  ) {
    if (toolName === "slack" && (params as { action?: string }).action === "list_channels") {
      return { success: true, data: { channels: [{ id: "C1", name: "general" }] } };
    }
    if (toolName === "slack" && (params as { action?: string }).action === "get_my_messages") {
      return {
        success: true,
        data: { messages: [{ channel_id: "D1", text: "hi" }] },
      };
    }
    if (toolName === "slack" && (params as { action?: string }).action === "get_channel_history") {
      const long =
        "Wir entscheiden uns für Option A und gehen live nächste Woche. " +
        "Das ist der formale Beschluss nach langer Diskussion im Team; " +
        "bitte alle Stakeholder informieren und die Roadmap entsprechend anpassen.";
      return {
        success: true,
        data: {
          messages: [
            {
              user: "U1",
              text: long,
            },
          ],
        },
      };
    }
    return { success: false, error: "unexpected" };
  }
}

const baseCtx = (tools: string[]): AgentContext => ({
  userId: "u1",
  systemPrompt: "sys",
  userContexts: [{ key: "slack_default_channel_id", value: "C9" }],
  userProfile: null,
  learnings: [],
  connectedTools: tools,
  recentHistory: [],
});

Deno.test("SlackAgent — summarize_day → summary in data", async () => {
  const agent = new SlackAgent(
    new StubLlm("Kurzfassung Slack-Tag"),
    new FakeDb(),
    new StubToolExecutor(),
  );
  const r = await agent.execute(
    { action: "summarize_day" },
    baseCtx(["slack"]),
  );
  assertEquals(r.success, true);
  assertEquals((r.data as { summary?: string })?.summary, "Kurzfassung Slack-Tag");
});

Deno.test("SlackAgent — extract_decisions → LearningCandidates", async () => {
  const agent = new SlackAgent(
    new StubLlm("Entscheidung: Option A"),
    new FakeDb(),
    new StubToolExecutor(),
  );
  const r = await agent.execute(
    { action: "extract_decisions", channel_id: "C9" },
    baseCtx(["slack"]),
  );
  assertEquals(r.success, true);
  assertExists(r.learningCandidates);
  assertEquals(r.learningCandidates!.length >= 1, true);
});
