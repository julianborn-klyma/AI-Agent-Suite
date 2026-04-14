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
import { LearningService } from "./learningService.ts";
import { WeeklyConsolidatorService } from "./weeklyConsolidatorService.ts";

/** Referenzdatum für Purge-Logik in Tests (entspricht User-Info 2026-04-07). */
const PURGE_AS_OF = new Date("2026-04-07T12:00:00.000Z");

class QueuedFakeLlm implements LlmClient {
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

class ThrowingLlm implements LlmClient {
  async chat(): Promise<LlmResponse> {
    throw new Error("llm boom");
  }
}

function mkLearning(p: {
  content: string;
  times_confirmed: number;
  confirmed_by_user: boolean;
}): Learning {
  const now = new Date("2026-04-06T10:00:00.000Z");
  return {
    id: crypto.randomUUID(),
    user_id: "u-weekly",
    category: "preference",
    content: p.content,
    source: "chat",
    source_ref: null,
    confidence: 0.85,
    confirmed_by_user: p.confirmed_by_user,
    times_confirmed: p.times_confirmed,
    contradicts_id: null,
    first_seen: now,
    last_confirmed: now,
    is_active: true,
    created_at: now,
  };
}

class WeeklyUnitDb implements DatabaseClient {
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

  readonly upserts: { userId: string; key: string; value: string }[] = [];
  readonly bulkConfirmCalls: { userId: string; min: number }[] = [];
  readonly purgeSummaryCalls: { prefixes: string[]; days: number }[] = [];
  readonly purgeConvCalls: number[] = [];

  constructor(
    readonly learnings: Learning[],
    readonly contexts: { key: string; value: string }[],
    readonly convos: { role: string; content: string; created_at: Date }[],
  ) {}

  async findAgentConfigForUser(): Promise<AgentConfigRow | null> {
    return null;
  }
  async listUserContexts(_userId: string): Promise<{ key: string; value: string }[]> {
    return this.contexts;
  }
  async upsertUserContext(params: {
    userId: string;
    key: string;
    value: string;
  }): Promise<void> {
    this.upserts.push({ userId: params.userId, key: params.key, value: params.value });
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
  async findUserProfileById(_userId: string): Promise<{
    id: string;
    name: string;
    email: string;
    role: string;
  } | null> {
    return {
      id: "u-weekly",
      name: "Anna",
      email: "anna@test.local",
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

  async getLearnings(_userId: string): Promise<Learning[]> {
    return this.learnings;
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
  async bulkConfirmLearningsByTimesConfirmed(
    userId: string,
    minTimes: number,
  ): Promise<void> {
    this.bulkConfirmCalls.push({ userId, min: minTimes });
  }

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

  async listConversationMessagesForUserSince(
    _userId: string,
    _since: Date,
    _limit: number,
  ): Promise<{ role: string; content: string; created_at: Date }[]> {
    return this.convos;
  }

  async purgeUserContextSummariesOlderThan(
    _userId: string,
    keyPrefixes: string[],
    olderThanDays: number,
  ): Promise<void> {
    this.purgeSummaryCalls.push({ prefixes: [...keyPrefixes], days: olderThanDays });
    const cutoff = PURGE_AS_OF.getTime() - olderThanDays * 86400000;
    for (let i = this.contexts.length - 1; i >= 0; i--) {
      const row = this.contexts[i]!;
      for (const raw of keyPrefixes) {
        if (!row.key.startsWith(raw)) continue;
        const suffix = row.key.slice(raw.length);
        const m = /^(\d{4}-\d{2}-\d{2})$/.exec(suffix);
        if (!m) continue;
        const ts = Date.parse(`${m[1]}T12:00:00.000Z`);
        if (Number.isFinite(ts) && ts < cutoff) {
          this.contexts.splice(i, 1);
          break;
        }
      }
    }
  }

  async purgeUserConversationsOlderThan(
    _userId: string,
    olderThanDays: number,
  ): Promise<void> {
    this.purgeConvCalls.push(olderThanDays);
  }

  recordScheduleRun = scheduleTestStubs.recordScheduleRun;

  insertTask = taskQueueTestStubs.insertTask;
  getTasks = taskQueueTestStubs.getTasks;
  getTask = taskQueueTestStubs.getTask;
  getNextPendingTask = taskQueueTestStubs.getNextPendingTask;
  updateTaskStatus = taskQueueTestStubs.updateTaskStatus;
  cancelTask = taskQueueTestStubs.cancelTask;
}

function weeklyShellDb(opts: {
  learnings: Learning[];
  contexts: { key: string; value: string }[];
  convos: { role: string; content: string; created_at: Date }[];
}): WeeklyUnitDb {
  return new WeeklyUnitDb(opts.learnings, opts.contexts, opts.convos);
}

const silentLlm: LlmClient = {
  async chat(): Promise<LlmResponse> {
    return {
      content: "[]",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  },
};

Deno.test({
  name: "WeeklyConsolidatorService — schreibt weekly_summary in cos_user_contexts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const learnings = [
      mkLearning({ content: "L1", times_confirmed: 1, confirmed_by_user: false }),
      mkLearning({ content: "L2", times_confirmed: 1, confirmed_by_user: false }),
      mkLearning({ content: "L3", times_confirmed: 1, confirmed_by_user: false }),
      mkLearning({ content: "L4", times_confirmed: 1, confirmed_by_user: false }),
      mkLearning({ content: "L5", times_confirmed: 1, confirmed_by_user: false }),
    ];
    const convos = [
      { role: "user", content: "Hallo", created_at: new Date("2026-04-05T10:00:00Z") },
      { role: "assistant", content: "Hi", created_at: new Date("2026-04-05T10:01:00Z") },
      { role: "user", content: "Bye", created_at: new Date("2026-04-05T10:02:00Z") },
    ];
    const db = weeklyShellDb({
      learnings,
      contexts: [],
      convos,
    });
    const llm = new QueuedFakeLlm([
      {
        content: "Wochen-Zusammenfassung Testinhalt.",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const learningSvc = new LearningService(db, silentLlm);
    const svc = new WeeklyConsolidatorService(db, llm, learningSvc);
    await svc.consolidate("u-weekly");

    const weeklyUpserts = db.upserts.filter((u) => u.key.includes("weekly_summary"));
    assertEquals(weeklyUpserts.length >= 1, true);
    assertStringIncludes(weeklyUpserts[0]!.key, "weekly_summary");
    assertEquals(weeklyUpserts[0]!.value, "Wochen-Zusammenfassung Testinhalt.");
  },
});

Deno.test({
  name: "WeeklyConsolidatorService — bulkConfirm bei times_confirmed >= 3",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const learnings = [
      mkLearning({
        content: "A",
        times_confirmed: 3,
        confirmed_by_user: false,
      }),
      mkLearning({
        content: "B",
        times_confirmed: 1,
        confirmed_by_user: false,
      }),
    ];
    const db = weeklyShellDb({ learnings, contexts: [], convos: [] });
    const llm = new QueuedFakeLlm([
      {
        content: "kurz",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const learningSvc = new LearningService(db, silentLlm);
    const svc = new WeeklyConsolidatorService(db, llm, learningSvc);
    await svc.consolidate("u-weekly");

    assertEquals(db.bulkConfirmCalls.length, 1);
    assertEquals(db.bulkConfirmCalls[0]!.userId, "u-weekly");
    assertEquals(db.bulkConfirmCalls[0]!.min, 3);
  },
});

Deno.test({
  name: "WeeklyConsolidatorService — purge entfernt alte email_summary_* Keys",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const contexts = [
      { key: "email_summary_2026-03-01", value: "alt" },
      { key: "email_summary_2026-04-07", value: "aktuell" },
    ];
    const db = weeklyShellDb({
      learnings: [],
      contexts,
      convos: [],
    });
    const llm = new QueuedFakeLlm([
      {
        content: "x",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const learningSvc = new LearningService(db, silentLlm);
    const svc = new WeeklyConsolidatorService(db, llm, learningSvc);
    await svc.consolidate("u-weekly");

    assertEquals(db.purgeSummaryCalls.length, 1);
    assertEquals(db.purgeSummaryCalls[0]!.days, 14);
    const keys = contexts.map((c) => c.key);
    assertEquals(keys.includes("email_summary_2026-03-01"), false);
    assertEquals(keys.includes("email_summary_2026-04-07"), true);
  },
});

Deno.test({
  name: "WeeklyConsolidatorService — keine Learnings: kein throw",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = weeklyShellDb({ learnings: [], contexts: [], convos: [] });
    const llm = new QueuedFakeLlm([
      {
        content: "Leere Woche.",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const learningSvc = new LearningService(db, silentLlm);
    const svc = new WeeklyConsolidatorService(db, llm, learningSvc);
    await svc.consolidate("u-weekly");
    const w = db.upserts.find((u) => u.key.includes("weekly_summary"));
    assertEquals(w?.value, "Leere Woche.");
  },
});

Deno.test({
  name: "WeeklyConsolidatorService — LLM-Fehler: kein throw, leere Summary",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const db = weeklyShellDb({
      learnings: [mkLearning({
        content: "x",
        times_confirmed: 1,
        confirmed_by_user: false,
      })],
      contexts: [],
      convos: [],
    });
    const learningSvc = new LearningService(db, new ThrowingLlm());
    const svc = new WeeklyConsolidatorService(db, new ThrowingLlm(), learningSvc);
    await svc.consolidate("u-weekly");
    const w = db.upserts.find((u) => u.key.includes("weekly_summary"));
    assertEquals(w?.value, "");
    assertEquals(db.bulkConfirmCalls.length, 1);
  },
});
