import { assertEquals, assertExists } from "@std/assert";
import { buildDailyBriefingSteps } from "../services/briefingService.ts";
import type {
  AgentConfigRow,
  DatabaseClient,
  Learning,
} from "../db/databaseClient.ts";
import { documentTestStubs, scheduleTestStubs } from "../db/documentTestStubs.ts";
import { DocumentService } from "../services/documentService.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "../services/llm/llmTypes.ts";
import { LearningService } from "../services/learningService.ts";
import { ToolExecutor } from "../services/tools/toolExecutor.ts";
import { AggregatorAgent } from "./aggregator.ts";
import type { AgentContext, LearningCandidate, SubAgentResult } from "./types.ts";
import { OrchestratorAgent } from "./orchestrator.ts";
import { ValidatorAgent } from "./validator.ts";
import { GmailAgent } from "./subagents/gmailAgent.ts";
import { NotionAgent } from "./subagents/notionAgent.ts";

/** LLM für Learning-Pfad: keine Extraktion, damit Test-Queues nicht verdriftet werden. */
class SilentLearningLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "[]",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  }
}

function learningPair(db: DatabaseClient, llm: LlmClient = new SilentLearningLlm()) {
  return {
    learningService: new LearningService(db, llm),
    learningLlm: llm,
  };
}

class QueuedFakeLlm implements LlmClient {
  /** Anzahl abgeschlossener chat()-Aufrufe (für Obergrenzen-Tests). */
  invocationCount = 0;
  private qi = 0;
  constructor(private readonly queue: LlmResponse[]) {}
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    this.invocationCount++;
    const r = this.queue[this.qi];
    this.qi++;
    return r ?? {
      content: "",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  }
}

class MultiConfigDb implements DatabaseClient {
  constructor(
    private readonly byUser: Record<string, AgentConfigRow>,
  ) {}

  async findAgentConfigForUser(userId: string): Promise<AgentConfigRow | null> {
    return this.byUser[userId] ?? null;
  }

  async listUserContexts(_userId: string): Promise<{ key: string; value: string }[]> {
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

  async findUserProfileById(
    userId: string,
  ): Promise<
    { id: string; name: string; email: string; role: string } | null
  > {
    return {
      id: userId,
      name: "T",
      email: "t@t",
      role: "member",
    };
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

  async upsertLearning(
    userId: string,
    candidate: LearningCandidate,
  ): Promise<Learning> {
    const id = crypto.randomUUID();
    return {
      id,
      user_id: userId,
      category: String(candidate.category ?? candidate.kind ?? "preference"),
      content: String(candidate.content ?? candidate.summary ?? "x"),
      source: String(candidate.source ?? "chat"),
      source_ref: null,
      confidence: candidate.confidence ?? 0.8,
      confirmed_by_user: false,
      times_confirmed: 1,
      contradicts_id: null,
      first_seen: new Date(),
      last_confirmed: new Date(),
      is_active: true,
      created_at: new Date(),
    };
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

class RecordingToolExecutor extends ToolExecutor {
  public readonly names: string[] = [];
  public readonly slackUserIds: string[] = [];
  override async execute(
    toolName: string,
    params: unknown,
    userId: string,
    db: DatabaseClient,
  ) {
    this.names.push(toolName);
    if (toolName === "slack") this.slackUserIds.push(userId);
    return { success: true, data: { toolName, params, userId } };
  }
}

class MultiTenantCtxDb extends MultiConfigDb {
  constructor(
    byUser: Record<string, AgentConfigRow>,
    private readonly contextsByUser: Record<
      string,
      { key: string; value: string }[]
    >,
  ) {
    super(byUser);
  }

  override async listUserContexts(
    userId: string,
  ): Promise<{ key: string; value: string }[]> {
    return this.contextsByUser[userId] ?? [];
  }
}

Deno.test("Orchestrator — Multi-Tenant: kein Cross-Leak der Tools", async () => {
  const db = new MultiConfigDb({
    userA: {
      system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
      tools_enabled: ["notion"],
    },
    userB: {
      system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
      tools_enabled: ["gmail"],
    },
  });
  const planJsonBoth =
    `{"steps":[{"agent":"gmail","task":{"action":"list_unread"}},{"agent":"notion","task":{"action":"list_tasks","database_id":"db"}}]}`;

  const teA = new RecordingToolExecutor();
  const llmA = new QueuedFakeLlm([
    { content: planJsonBoth, input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
    { content: "agg-a", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
    {
      content: JSON.stringify({
        approved: true,
        issues: [],
        needsRetry: false,
      }),
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    },
  ]);
  const lpA = learningPair(db);
  const orchA = new OrchestratorAgent(
    llmA,
    db,
    teA,
    new ValidatorAgent(llmA),
    new AggregatorAgent(llmA),
    () => new Date("2026-04-07T12:00:00Z"),
    lpA.learningService,
    lpA.learningLlm,
    new DocumentService(db, llmA),
  );
  await orchA.run({
    userId: "userA",
    sessionId: crypto.randomUUID(),
    message: "Alles",
    historyMessages: [],
  });
  assertEquals(teA.names, ["notion"]);

  const teB = new RecordingToolExecutor();
  const llmB = new QueuedFakeLlm([
    { content: planJsonBoth, input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
    { content: "agg-b", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
    {
      content: JSON.stringify({
        approved: true,
        issues: [],
        needsRetry: false,
      }),
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    },
  ]);
  const lpB = learningPair(db);
  const orchB = new OrchestratorAgent(
    llmB,
    db,
    teB,
    new ValidatorAgent(llmB),
    new AggregatorAgent(llmB),
    () => new Date("2026-04-07T12:00:00Z"),
    lpB.learningService,
    lpB.learningLlm,
    new DocumentService(db, llmB),
  );
  await orchB.run({
    userId: "userB",
    sessionId: crypto.randomUUID(),
    message: "Alles",
    historyMessages: [],
  });
  assertEquals(teB.names, ["gmail"]);
});

Deno.test(
  "Orchestrator — Intent: Tasks-Frage → Plan enthält notion",
  async () => {
    const db = new MultiConfigDb({
      u1: {
        system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
        tools_enabled: ["notion", "gmail"],
      },
    });
    const llm = new QueuedFakeLlm([
      {
        content: JSON.stringify({
          steps: [{ agent: "notion", task: { action: "list_tasks" } }],
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const lp = learningPair(db);
    const orch = new OrchestratorAgent(
      llm,
      db,
      new ToolExecutor(),
      new ValidatorAgent(llm),
      new AggregatorAgent(llm),
      undefined,
      lp.learningService,
      lp.learningLlm,
      new DocumentService(db, llm),
    );
    const ctx = await (
      orch as unknown as {
        loadContext(
          uid: string,
          hist: unknown[],
          now: () => Date,
        ): Promise<AgentContext>;
      }
    ).loadContext("u1", [], () => new Date("2026-04-07T12:00:00Z"));
    const plan = await orch.analyzeIntent("Was sind meine Tasks?", ctx);
    assertEquals(plan.steps.some((s) => s.agent === "notion"), true);
  },
);

Deno.test(
  "Orchestrator — Intent: Emails → Plan enthält gmail",
  async () => {
    const db = new MultiConfigDb({
      u1: {
        system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
        tools_enabled: ["notion", "gmail"],
      },
    });
    const llm = new QueuedFakeLlm([
      {
        content: JSON.stringify({
          steps: [{ agent: "gmail", task: { action: "list_unread" } }],
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const lp = learningPair(db);
    const orch = new OrchestratorAgent(
      llm,
      db,
      new ToolExecutor(),
      new ValidatorAgent(llm),
      new AggregatorAgent(llm),
      undefined,
      lp.learningService,
      lp.learningLlm,
      new DocumentService(db, llm),
    );
    const ctx = await (
      orch as unknown as {
        loadContext(
          uid: string,
          hist: unknown[],
          now: () => Date,
        ): Promise<AgentContext>;
      }
    ).loadContext("u1", [], () => new Date("2026-04-07T12:00:00Z"));
    const plan = await orch.analyzeIntent("Zeig meine Emails", ctx);
    assertEquals(plan.steps.some((s) => s.agent === "gmail"), true);
  },
);

class RetryTwiceValidator extends ValidatorAgent {
  constructor(llm: LlmClient, private readonly state: { n: number }) {
    super(llm);
  }
  override async validate(
    params: Parameters<ValidatorAgent["validate"]>[0],
  ): ReturnType<ValidatorAgent["validate"]> {
    this.state.n++;
    if (this.state.n === 1) {
      return {
        approved: false,
        issues: [
          { type: "incomplete", severity: "high", detail: "Mehr Kontext." },
        ],
        needsRetry: true,
        retryFeedback: "Bitte nacharbeiten.",
      };
    }
    return await super.validate(params);
  }
}

Deno.test(
  "Orchestrator — Validator needsRetry → zweiter Durchlauf",
  async () => {
    const db = new MultiConfigDb({
      u1: {
        system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
        tools_enabled: ["notion"],
      },
    });
    const calls = { n: 0 };
    const llm = new QueuedFakeLlm([
      { content: "invalid-json", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      { content: "agg1", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      { content: "invalid-json", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      { content: "agg2", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      {
        content: JSON.stringify({
          approved: true,
          issues: [],
          needsRetry: false,
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const v = new RetryTwiceValidator(llm, calls);
    const lp = learningPair(db);
    const orch = new OrchestratorAgent(
      llm,
      db,
      new RecordingToolExecutor(),
      v,
      new AggregatorAgent(llm),
      undefined,
      lp.learningService,
      lp.learningLlm,
      new DocumentService(db, llm),
    );
    const out = await orch.run({
      userId: "u1",
      sessionId: crypto.randomUUID(),
      message: "Hi",
      historyMessages: [],
    });
    assertEquals(calls.n, 2);
    assertExists(out.content);
  },
);

class AlwaysRetryValidator extends ValidatorAgent {
  constructor(llm: LlmClient) {
    super(llm);
  }
  override async validate(): ReturnType<ValidatorAgent["validate"]> {
    return {
      approved: false,
      issues: [{ type: "x", severity: "high", detail: "again" }],
      needsRetry: true,
      retryFeedback: "immer",
    };
  }
}

Deno.test(
  "Orchestrator — Validator 3x needsRetry → kein Infinite Loop",
  async () => {
    const db = new MultiConfigDb({
      u1: {
        system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
        tools_enabled: ["notion"],
      },
    });
    const llm = new QueuedFakeLlm(
      Array.from({ length: 20 }, () => ({
        content: "x",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn" as const,
      })),
    );
    const lp = learningPair(db);
    const orch = new OrchestratorAgent(
      llm,
      db,
      new RecordingToolExecutor(),
      new AlwaysRetryValidator(llm),
      new AggregatorAgent(llm),
      undefined,
      lp.learningService,
      lp.learningLlm,
      new DocumentService(db, llm),
    );
    await orch.run({
      userId: "u1",
      sessionId: crypto.randomUUID(),
      message: "Hi",
      historyMessages: [],
    });
    assertEquals(llm.invocationCount <= 12, true);
  },
);

class BoomNotion extends NotionAgent {
  override async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    void task;
    void context;
    throw new Error("notion boom");
  }
}

class MixedOrchestrator extends OrchestratorAgent {
  constructor(
    llm: LlmClient,
    db: DatabaseClient,
    te: ToolExecutor,
    val: ValidatorAgent,
    agg: AggregatorAgent,
    now?: () => Date,
  ) {
    const lp = learningPair(db);
    const documentService = new DocumentService(db, llm);
    super(
      llm,
      db,
      te,
      val,
      agg,
      now,
      lp.learningService,
      lp.learningLlm,
      documentService,
    );
    this.agents.set(
      "notion",
      new BoomNotion(llm, db, te),
    );
    this.agents.set("gmail", new GmailAgent(llm, db, te));
  }
}

Deno.test(
  "Orchestrator — Sub-Agent wirft → Gmail läuft trotzdem (allSettled)",
  async () => {
    const db = new MultiConfigDb({
      u1: {
        system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
        tools_enabled: ["notion", "gmail"],
      },
    });
    const te = new RecordingToolExecutor();
    const plan = JSON.stringify({
      steps: [
        { agent: "notion", task: { action: "list_tasks" } },
        { agent: "gmail", task: { action: "list_unread" } },
      ],
    });
    const llm = new QueuedFakeLlm([
      { content: plan, input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      { content: "ok", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      {
        content: JSON.stringify({
          approved: true,
          issues: [],
          needsRetry: false,
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const orch = new MixedOrchestrator(
      llm,
      db,
      te,
      new ValidatorAgent(llm),
      new AggregatorAgent(llm),
    );
    await orch.run({
      userId: "u1",
      sessionId: crypto.randomUUID(),
      message: "mix",
      historyMessages: [],
    });
    assertEquals(te.names.includes("gmail"), true);
  },
);

Deno.test(
  "Orchestrator — Daily-Briefing-Plan: slack_connected → Slack-Schritt",
  () => {
    const steps = buildDailyBriefingSteps({
      toolsEnabled: ["slack", "notion", "gmail", "calendar"],
      contexts: new Map([
        ["slack_connected", "true"],
        ["google_connected", "true"],
        ["notion_database_id", "db-1"],
      ]),
    });
    assertEquals(steps.some((s) => s.agent === "slack"), true);
  },
);

Deno.test(
  "Orchestrator — Daily-Briefing-Plan: ohne slack_connected → kein Slack",
  () => {
    const steps = buildDailyBriefingSteps({
      toolsEnabled: ["slack", "notion"],
      contexts: new Map([
        ["slack_connected", "false"],
        ["notion_database_id", "db-1"],
      ]),
    });
    assertEquals(steps.some((s) => s.agent === "slack"), false);
  },
);

Deno.test(
  "Orchestrator — Slack-Tool: userId strikt pro User (kein Cross-Leak)",
  async () => {
    const db = new MultiTenantCtxDb(
      {
        userA: {
          system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
          tools_enabled: ["slack"],
        },
        userB: {
          system_prompt: "S {{USER_CONTEXT}} {{NOW}}",
          tools_enabled: ["slack"],
        },
      },
      {
        userA: [{ key: "slack_access_token", value: "enc-a" }],
        userB: [{ key: "slack_access_token", value: "enc-b" }],
      },
    );
    const plan = JSON.stringify({
      steps: [{ agent: "slack", task: { action: "summarize_day" } }],
    });

    const teA = new RecordingToolExecutor();
    const llmA = new QueuedFakeLlm([
      { content: plan, input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      { content: "agg", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      {
        content: JSON.stringify({
          approved: true,
          issues: [],
          needsRetry: false,
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const lpA = learningPair(db);
    const orchA = new OrchestratorAgent(
      llmA,
      db,
      teA,
      new ValidatorAgent(llmA),
      new AggregatorAgent(llmA),
      () => new Date("2026-04-07T12:00:00Z"),
      lpA.learningService,
      lpA.learningLlm,
      new DocumentService(db, llmA),
    );
    await orchA.run({
      userId: "userA",
      sessionId: crypto.randomUUID(),
      message: "Brief",
      historyMessages: [],
    });
    assertEquals(teA.slackUserIds.length >= 1, true);
    assertEquals(teA.slackUserIds.every((id) => id === "userA"), true);

    const teB = new RecordingToolExecutor();
    const llmB = new QueuedFakeLlm([
      { content: plan, input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      { content: "agg2", input_tokens: 1, output_tokens: 1, stop_reason: "end_turn" },
      {
        content: JSON.stringify({
          approved: true,
          issues: [],
          needsRetry: false,
        }),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const lpB = learningPair(db);
    const orchB = new OrchestratorAgent(
      llmB,
      db,
      teB,
      new ValidatorAgent(llmB),
      new AggregatorAgent(llmB),
      () => new Date("2026-04-07T12:00:00Z"),
      lpB.learningService,
      lpB.learningLlm,
      new DocumentService(db, llmB),
    );
    await orchB.run({
      userId: "userB",
      sessionId: crypto.randomUUID(),
      message: "Brief",
      historyMessages: [],
    });
    assertEquals(teB.slackUserIds.every((id) => id === "userB"), true);
  },
);
