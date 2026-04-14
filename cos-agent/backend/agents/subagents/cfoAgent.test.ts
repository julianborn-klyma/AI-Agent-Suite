import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DatabaseClient, Learning } from "../../db/databaseClient.ts";
import { documentTestStubs, scheduleTestStubs } from "../../db/documentTestStubs.ts";
import type { DocumentService } from "../../services/documentService.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../../services/llm/llmTypes.ts";
import { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext } from "../types.ts";
import { CfoAgent } from "./cfoAgent.ts";

class MinDb implements DatabaseClient {
  async findAgentConfigForUser(): Promise<null> {
    return null;
  }
  async listUserContexts(): Promise<{ key: string; value: string }[]> {
    return [];
  }
  async upsertUserContext(): Promise<void> {}
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

class CaptureLlm implements LlmClient {
  last: LlmRequest | null = null;
  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.last = req;
    return {
      content: "Analyse: Umsatz steigt, Kosten stabil.",
      input_tokens: 1,
      output_tokens: 2,
      stop_reason: "end_turn",
    };
  }
}

const ctxBase = (tools: string[]): AgentContext => ({
  userId: "u-cfo",
  systemPrompt: "sys",
  userContexts: [],
  userProfile: null,
  learnings: [],
  connectedTools: tools,
  recentHistory: [],
});

Deno.test("CfoAgent — answer_question: CFO-Systemprompt im LLM-Call", async () => {
  const llm = new CaptureLlm();
  const doc = {
    async buildDocumentContext() {
      return "";
    },
    async askDocument() {
      throw new Error("unexpected");
    },
  } as unknown as DocumentService;
  const agent = new CfoAgent(llm, new MinDb(), new ToolExecutor(), doc);
  await agent.execute(
    { type: "answer_question", question: "Wie sieht Cashflow aus?" },
    ctxBase(["cfo"]),
  );
  assertStringIncludes(llm.last?.system ?? "", "CFO-Analyst");
});

Deno.test("CfoAgent — review_document: buildDocumentContext wird genutzt", async () => {
  const llm = new CaptureLlm();
  let buildCalls = 0;
  const doc = {
    async buildDocumentContext() {
      buildCalls++;
      return "## Dokumente\n**X:** y";
    },
    async askDocument() {
      return {
        answer: "Zahlen ok",
        sources: [],
        chunksSearched: 1,
      };
    },
  } as unknown as DocumentService;
  const agent = new CfoAgent(llm, new MinDb(), new ToolExecutor(), doc);
  await agent.execute(
    { type: "review_document", documentId: crypto.randomUUID(), question: "?" },
    ctxBase(["cfo"]),
  );
  assertEquals(buildCalls, 1);
  assertStringIncludes(llm.last?.messages[0]?.content ?? "", "## Dokumente");
});

Deno.test("CfoAgent — question_decision: Best Case / Base Case / Worst Case im User-Block", async () => {
  const llm = new CaptureLlm();
  const doc = {
    async buildDocumentContext() {
      return "";
    },
    async askDocument() {
      throw new Error("unexpected");
    },
  } as unknown as DocumentService;
  const agent = new CfoAgent(llm, new MinDb(), new ToolExecutor(), doc);
  await agent.execute(
    { type: "question_decision", decision: "Sollen wir expandieren?" },
    ctxBase(["cfo"]),
  );
  assertStringIncludes(
    llm.last?.messages[0]?.content ?? "",
    "Best Case / Base Case / Worst Case",
  );
});

Deno.test("CfoAgent — review_document ohne Dokument → success false", async () => {
  const llm = new CaptureLlm();
  const { DocumentNotFoundError } = await import(
    "../../services/documentService.ts"
  );
  const doc = {
    async buildDocumentContext() {
      return "";
    },
    async askDocument() {
      throw new DocumentNotFoundError();
    },
  } as unknown as DocumentService;
  const agent = new CfoAgent(llm, new MinDb(), new ToolExecutor(), doc);
  const res = await agent.execute(
    { type: "review_document", documentId: "00000000-0000-4000-8000-00000000dead" },
    ctxBase(["cfo"]),
  );
  assertEquals(res.success, false);
  assertStringIncludes(res.error ?? "", "nicht gefunden");
});
