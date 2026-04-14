import { assertEquals, assertExists } from "@std/assert";
import type { LearningCandidate } from "../agents/types.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";
import type { ToolResult } from "./tools/types.ts";
import { EmailCategorizationService } from "./emailCategorizationService.ts";
import { EmailStyleService } from "./emailStyleService.ts";

/** Wie in `orchestrator.test.ts`: feste Antworten pro `chat()`-Aufruf. */
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

type ExecRecord = { tool: string; params: unknown; userId: string };

class StubGmailToolExecutor {
  readonly calls: ExecRecord[] = [];
  listUnreadResult: ToolResult = { success: false, error: "unset" };
  createDraftSuccess = true;

  async execute(
    toolName: string,
    params: unknown,
    userId: string,
    _db: DatabaseClient,
  ): Promise<ToolResult> {
    this.calls.push({ tool: toolName, params, userId });
    if (toolName === "gmail") {
      const action = (params as { action?: string }).action;
      if (action === "list_unread") return this.listUnreadResult;
      if (action === "create_draft") {
        return this.createDraftSuccess
          ? { success: true, data: { ok: true } }
          : { success: false, error: "draft_failed" };
      }
    }
    return { success: false, error: `unexpected ${toolName}` };
  }
}

function asToolExecutor(x: StubGmailToolExecutor): ToolExecutor {
  return x as unknown as ToolExecutor;
}

function makeCatSvc(
  db: DatabaseClient,
  llm: LlmClient,
  exec: StubGmailToolExecutor,
): EmailCategorizationService {
  const emailStyleService = new EmailStyleService(db, llm, asToolExecutor(exec));
  return new EmailCategorizationService(db, llm, asToolExecutor(exec), emailStyleService);
}

function threeUnreadMails() {
  return [
    {
      id: "1",
      subject: "A",
      from: "Alice <alice@example.com>",
      snippet: "s1",
    },
    {
      id: "2",
      subject: "B",
      from: "bob@example.com",
      snippet: "s2",
    },
    {
      id: "3",
      subject: "C",
      from: "spam@example.com",
      snippet: "s3",
    },
  ];
}

Deno.test({
  name:
    "EmailCategorizationService — categorizeEmails: Kategorien + 1 Draft",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubGmailToolExecutor();
    exec.listUnreadResult = { success: true, data: threeUnreadMails() };

    const catJson = JSON.stringify([
      {
        message_id: "1",
        subject: "A",
        from: "Alice <alice@example.com>",
        category: "urgent",
        reason: "Deadline",
        draft_needed: true,
      },
      {
        message_id: "2",
        subject: "B",
        from: "bob@example.com",
        category: "fyi",
        draft_needed: false,
      },
      {
        message_id: "3",
        subject: "C",
        from: "spam@example.com",
        category: "junk",
        draft_needed: false,
      },
    ]);
    const learnJson = JSON.stringify([
      {
        category: "preference",
        content: "Bevorzugt knappe Antworten.",
        confidence: 0.75,
      },
    ]);

    const llm = new QueuedFakeLlm([
      {
        content: catJson,
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
      {
        content: "Hier der Entwurfstext.",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
      {
        content: learnJson,
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);

    const upsertCtx: { key: string; value: string }[] = [];
    let capturedLearnings: LearningCandidate[] = [];

    const db = {
      findUserProfileById: async () => ({
        id: "u1",
        name: "Uli",
        email: "u@t.de",
        role: "member",
      }),
      getLearnings: async () => [],
      listUserContexts: async () => [],
      upsertUserContext: async (p: { key: string; value: string }) => {
        upsertCtx.push({ key: p.key, value: p.value });
      },
      upsertLearnings: async (_uid: string, c: LearningCandidate[]) => {
        capturedLearnings = c;
        return [];
      },
    } as unknown as DatabaseClient;

    const svc = makeCatSvc(db, llm, exec);
    const r = await svc.categorizeEmails("u1");

    assertEquals(r.urgent, 1);
    assertEquals(r.fyi, 1);
    assertEquals(r.junk, 1);
    assertEquals(r.reply_needed, 0);
    assertEquals(r.drafts_created, 1);
    assertEquals(r.total, 3);
    assertEquals(exec.calls.some((c) =>
      c.tool === "gmail" &&
      (c.params as { action?: string }).action === "create_draft"
    ), true);
    assertEquals(capturedLearnings.length >= 1, true);
  },
});

Deno.test({
  name: "EmailCategorizationService — create_draft wird ausgeführt (gemockt)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubGmailToolExecutor();
    exec.listUnreadResult = {
      success: true,
      data: [
        {
          id: "x1",
          subject: "Hi",
          from: "T <t@t.de>",
          snippet: "s",
        },
      ],
    };
    const llm = new QueuedFakeLlm([
      {
        content: JSON.stringify([
          {
            message_id: "x1",
            subject: "Hi",
            from: "T <t@t.de>",
            category: "urgent",
            reason: "r",
            draft_needed: true,
          },
        ]),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
      {
        content: "Draft body",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
      {
        content: "[]",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const db = {
      findUserProfileById: async () => ({
        id: "u1",
        name: "N",
        email: "n@t.de",
        role: "member",
      }),
      getLearnings: async () => [],
      listUserContexts: async () => [],
      upsertUserContext: async () => {},
      upsertLearnings: async () => [],
    } as unknown as DatabaseClient;

    const svc = makeCatSvc(db, llm, exec);
    await svc.categorizeEmails("u1");

    const drafts = exec.calls.filter((c) =>
      c.tool === "gmail" &&
      (c.params as { action?: string }).action === "create_draft"
    );
    assertEquals(drafts.length, 1);
    assertEquals((drafts[0]!.params as { action: string }).action, "create_draft");
  },
});

Deno.test({
  name: "EmailCategorizationService — list_unread fehlgeschlagen: kein LLM",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubGmailToolExecutor();
    exec.listUnreadResult = { success: false, error: "nicht verbunden" };
    const llm = new QueuedFakeLlm([
      {
        content: "sollte-nicht-laufen",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const db = {
      findUserProfileById: async () => null,
      getLearnings: async () => [],
      listUserContexts: async () => [],
      upsertUserContext: async () => {
        throw new Error("upsertUserContext should not run");
      },
      upsertLearnings: async () => {
        throw new Error("upsertLearnings should not run");
      },
    } as unknown as DatabaseClient;

    const svc = makeCatSvc(db, llm, exec);
    const r = await svc.categorizeEmails("u1");
    assertEquals(llm.invocationCount, 0);
    assertEquals(r.total, 0);
    assertEquals(r.drafts_created, 0);
  },
});

Deno.test({
  name: "EmailCategorizationService — LLM liefert kein JSON-Array",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubGmailToolExecutor();
    exec.listUnreadResult = {
      success: true,
      data: [
        { id: "z", subject: "Z", from: "z@z.de", snippet: "z" },
      ],
    };
    const llm = new QueuedFakeLlm([
      {
        content: "Das sind die Kategorien: urgent, fyi",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
      {
        content: "[]",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const db = {
      findUserProfileById: async () => ({
        id: "u1",
        name: "N",
        email: "n@t.de",
        role: "member",
      }),
      getLearnings: async () => [],
      listUserContexts: async () => [],
      upsertUserContext: async () => {},
      upsertLearnings: async () => [],
    } as unknown as DatabaseClient;

    const svc = makeCatSvc(db, llm, exec);
    const r = await svc.categorizeEmails("u1");
    assertEquals(r.total, 0);
    assertEquals(r.urgent + r.fyi + r.junk + r.reply_needed, 0);
  },
});

Deno.test({
  name:
    "EmailCategorizationService — LearningCandidates (Quelle email_categorization)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubGmailToolExecutor();
    exec.listUnreadResult = {
      success: true,
      data: [
        { id: "1", subject: "S", from: "a@b.de", snippet: "x" },
      ],
    };
    const llm = new QueuedFakeLlm([
      {
        content: JSON.stringify([
          {
            message_id: "1",
            subject: "S",
            from: "a@b.de",
            category: "fyi",
            reason: "info",
            draft_needed: false,
          },
        ]),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
      {
        content: JSON.stringify([
          {
            category: "decision_pattern",
            content: "Bei Dringlichkeit priorisiert der User kurzfristig.",
            confidence: 0.88,
          },
        ]),
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);

    let lastCandidates: LearningCandidate[] = [];
    const db = {
      findUserProfileById: async () => ({
        id: "u1",
        name: "N",
        email: "n@t.de",
        role: "member",
      }),
      getLearnings: async () => [],
      listUserContexts: async () => [],
      upsertUserContext: async () => {},
      upsertLearnings: async (_uid: string, c: LearningCandidate[]) => {
        lastCandidates = c;
        return [];
      },
    } as unknown as DatabaseClient;

    const svc = makeCatSvc(db, llm, exec);
    await svc.categorizeEmails("u1");

    assertEquals(lastCandidates.length >= 1, true);
    const first = lastCandidates[0]!;
    assertExists(first.content);
    assertEquals(first.source, "email_categorization");
  },
});
