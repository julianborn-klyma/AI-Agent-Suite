import { assertEquals, assertMatch } from "@std/assert";
import type { LearningCandidate } from "../agents/types.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";
import type { ToolResult } from "./tools/types.ts";
import { EmailStyleService } from "./emailStyleService.ts";

class QueuedFakeLlm implements LlmClient {
  invocationCount = 0;
  readonly requests: LlmRequest[] = [];
  private qi = 0;
  constructor(private readonly queue: LlmResponse[]) {}
  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.invocationCount++;
    this.requests.push(req);
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

type ExecCall = { tool: string; params: unknown; userId: string };

class FakeGmailExecutor {
  readonly calls: ExecCall[] = [];
  sentResult: ToolResult = { success: false, error: "unset" };
  createDraftOk = true;

  async execute(
    toolName: string,
    params: unknown,
    userId: string,
    _db: DatabaseClient,
  ): Promise<ToolResult> {
    this.calls.push({ tool: toolName, params, userId });
    if (toolName === "gmail") {
      const action = (params as { action?: string }).action;
      if (action === "get_sent_emails") return this.sentResult;
      if (action === "create_draft") {
        return this.createDraftOk
          ? { success: true, data: { id: "draft-test-1" } }
          : { success: false, error: "draft_failed" };
      }
    }
    return { success: false, error: "unexpected" };
  }
}

function asExec(x: FakeGmailExecutor): ToolExecutor {
  return x as unknown as ToolExecutor;
}

function fakeEmails(n: number) {
  const out: {
    id: string;
    to: string;
    subject: string;
    body: string;
    date: string;
    char_count: number;
  }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `m${i}`,
      to: `r${i}@x.de`,
      subject: `S${i}`,
      body: `Hallo, kurzer Text ${i}.`,
      date: "Mon, 1 Jan 2024 12:00:00 +0000",
      char_count: 20,
    });
  }
  return out;
}

const validStyleJson = JSON.stringify({
  greeting: "Hi {Vorname}",
  closing: "VG Test",
  avg_length: "short",
  tone: "direct",
  smalltalk: false,
  bullet_points: true,
  style_by_recipient: {
    colleagues: "Sehr direkt, kein Opener.",
    customers: "Etwas formeller.",
    unknown: "Neutral.",
  },
  signature: "",
  examples: ["Passt, machen wir so.", "Bis morgen."],
});

Deno.test({
  name: "EmailStyleService — learnEmailStyle speichert email_style Learning",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    exec.sentResult = { success: true, data: fakeEmails(10) };
    const llm = new QueuedFakeLlm([{
      content: validStyleJson,
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }]);

    let upsertCategory: string | undefined;
    let upsertSource: string | undefined;
    let upsertSourceRef: string | undefined;
    const db = {
      upsertLearning: async (_uid: string, c: LearningCandidate) => {
        upsertCategory = c.category;
        upsertSource = c.source;
        upsertSourceRef = c.source_ref;
        return {} as never;
      },
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.learnEmailStyle("u1");

    assertEquals(r.learned, true);
    assertEquals(r.emails_analyzed, 10);
    assertEquals(upsertCategory, "email_style");
    assertEquals(upsertSource, "gmail");
    assertEquals(upsertSourceRef, "sent_emails_analysis");
    assertEquals(
      (exec.calls[0]!.params as { action: string }).action,
      "get_sent_emails",
    );
  },
});

Deno.test({
  name: "EmailStyleService — learnEmailStyle zu wenige Emails, kein LLM",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    exec.sentResult = { success: true, data: fakeEmails(3) };
    const llm = new QueuedFakeLlm([]);
    const db = {
      upsertLearning: async () => {
        throw new Error("upsertLearning should not run");
      },
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.learnEmailStyle("u1");
    assertEquals(r.learned, false);
    assertMatch(r.reason ?? "", /wenige/i);
    assertEquals(llm.invocationCount, 0);
  },
});

Deno.test({
  name: "EmailStyleService — learnEmailStyle Gmail-Fehler ohne throw",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    exec.sentResult = { success: false, error: "nicht verbunden" };
    const llm = new QueuedFakeLlm([
      {
        content: "should-not-run",
        input_tokens: 1,
        output_tokens: 1,
        stop_reason: "end_turn",
      },
    ]);
    const db = {} as unknown as DatabaseClient;
    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.learnEmailStyle("u1");
    assertEquals(r.learned, false);
    assertEquals(r.emails_analyzed, 0);
    assertEquals(llm.invocationCount, 0);
  },
});

Deno.test({
  name: "EmailStyleService — learnEmailStyle ungültiges LLM-JSON → Fallback, kein throw",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    exec.sentResult = { success: true, data: fakeEmails(6) };
    const llm = new QueuedFakeLlm([{
      content: "Das ist kein JSON.",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }]);

    let upsertContent = "";
    const db = {
      upsertLearning: async (_uid: string, c: LearningCandidate) => {
        upsertContent = c.content ?? "";
        return {} as never;
      },
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.learnEmailStyle("u1");
    assertEquals(r.learned, true);
    assertEquals(r.emails_analyzed, 6);
    assertMatch(upsertContent, /Anrede: Hallo/);
  },
});

Deno.test({
  name: "EmailStyleService — createStyledDraft mit Style-Learning",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    const styleContent =
      `Anrede: Hi\nAbschluss: VG\nTypische Länge: short\nTon: direct\nSmalltalk: nein\nAufzählungen: ja\nBei Kollegen: direkt\nBei Kunden: formell\nBei unbekannten: neutral\nBeispiele: A | B`;

    const llm = new QueuedFakeLlm([{
      content: "Hi Max,\n\nalles klar.\n\nVG",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }]);

    const db = {
      getLearnings: async (_uid: string, opts?: { categories?: string[] }) => {
        if (opts?.categories?.includes("email_style")) {
          return [{
            id: "l1",
            user_id: "u1",
            category: "email_style",
            content: styleContent,
            source: "gmail",
            source_ref: "sent_emails_analysis",
            confidence: 0.9,
            confirmed_by_user: true,
            times_confirmed: 1,
            contradicts_id: null,
            first_seen: new Date(),
            last_confirmed: new Date(),
            is_active: true,
            created_at: new Date(),
          }];
        }
        return [];
      },
      findUserProfileById: async () => ({
        id: "u1",
        name: "Julian",
        email: "julian@klyma.de",
        role: "member",
      }),
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.createStyledDraft({
      userId: "u1",
      inReplyTo: {
        message_id: "gmid1",
        from: "Max <max@extern.de>",
        subject: "Angebot",
        body: "Hallo …",
      },
    });

    assertEquals(r.success, true);
    assertEquals(r.style_used, true);
    assertEquals(r.draft_id, "draft-test-1");
    const draftCall = exec.calls.find((c) =>
      (c.params as { action?: string }).action === "create_draft"
    );
    assertEquals(draftCall !== undefined, true);
    const p = draftCall!.params as {
      in_reply_to?: string;
      body?: string;
    };
    assertEquals(p.in_reply_to, "gmid1");
    const draftReq = llm.requests.find((q) =>
      q.metadata.source === "cos-email-styled-draft"
    );
    assertEquals(draftReq !== undefined, true);
    const userContent = (draftReq!.messages[0]! as { content: string }).content;
    assertMatch(userContent, /max@extern\.de/);
    assertMatch(userContent, /Anrede: Hi/);
  },
});

Deno.test({
  name: "EmailStyleService — createStyledDraft ohne Style-Learning",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    const llm = new QueuedFakeLlm([{
      content: "Antwort ohne speziellen Stil.",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }]);

    const db = {
      getLearnings: async () => [],
      findUserProfileById: async () => ({
        id: "u1",
        name: "U",
        email: "u@klyma.de",
        role: "member",
      }),
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.createStyledDraft({
      userId: "u1",
      inReplyTo: {
        message_id: "m1",
        from: "x@y.de",
        subject: "T",
        body: "B",
      },
    });

    assertEquals(r.success, true);
    assertEquals(r.style_used, false);
    const draftReq = llm.requests.find((q) =>
      q.metadata.source === "cos-email-styled-draft"
    );
    assertMatch(
      draftReq!.messages[0]!.content as string,
      /Direkt und professionell auf Deutsch/,
    );
  },
});

Deno.test({
  name: "EmailStyleService — createStyledDraft Kollege gleiche Domain",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    const llm = new QueuedFakeLlm([{
      content: "ok",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }]);

    const styleText =
      "Anrede: Hi\nAbschluss: VG\nTypische Länge: short\nTon: direct\nSmalltalk: nein\nAufzählungen: nein\nBei Kollegen: SEHR_DIREKT_MARKER\nBei Kunden: formal\nBei unbekannten: neutral\nBeispiele: x";

    const db = {
      getLearnings: async (_uid: string, opts?: { categories?: string[] }) => {
        if (opts?.categories?.includes("email_style")) {
          return [{
            id: "l1",
            user_id: "u1",
            category: "email_style",
            content: styleText,
            source: "gmail",
            source_ref: "x",
            confidence: 0.9,
            confirmed_by_user: true,
            times_confirmed: 1,
            contradicts_id: null,
            first_seen: new Date(),
            last_confirmed: new Date(),
            is_active: true,
            created_at: new Date(),
          }];
        }
        return [];
      },
      findUserProfileById: async () => ({
        id: "u1",
        name: "Julian",
        email: "julian@klyma.de",
        role: "member",
      }),
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.createStyledDraft({
      userId: "u1",
      inReplyTo: {
        message_id: "mid",
        from: "Kollege <kollege@klyma.de>",
        subject: "Hi",
        body: "Text",
      },
    });

    assertEquals(r.recipient_type, "colleague");
    assertEquals(r.success, true);
    const draftReq = llm.requests.find((q) =>
      q.metadata.source === "cos-email-styled-draft"
    );
    assertMatch(
      draftReq!.messages[0]!.content as string,
      /SEHR_DIREKT_MARKER/,
    );
  },
});

Deno.test({
  name: "EmailStyleService — createStyledDraft Gmail-Entwurf fehlgeschlagen",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new FakeGmailExecutor();
    exec.createDraftOk = false;
    const llm = new QueuedFakeLlm([{
      content: "Nur Text",
      input_tokens: 1,
      output_tokens: 1,
      stop_reason: "end_turn",
    }]);

    const db = {
      getLearnings: async () => [],
      findUserProfileById: async () => ({
        id: "u1",
        name: "U",
        email: "u@u.de",
        role: "member",
      }),
    } as unknown as DatabaseClient;

    const svc = new EmailStyleService(db, llm, asExec(exec));
    const r = await svc.createStyledDraft({
      userId: "u1",
      inReplyTo: {
        message_id: "m1",
        from: "a@b.de",
        subject: "S",
        body: "B",
      },
    });

    assertEquals(r.success, false);
    assertEquals(r.preview, "Nur Text");
  },
});
