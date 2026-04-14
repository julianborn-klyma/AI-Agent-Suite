import {
  assertEquals,
  assertExists,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type {
  AgentConfigRow,
  DatabaseClient,
  Document,
  DocumentChunk,
  Learning,
} from "../db/databaseClient.ts";
import { testAuthDbStubMethods } from "../db/databaseClientTestAuthStubs.ts";
import { scheduleTestStubs } from "../db/documentTestStubs.ts";
import { taskQueueTestStubs } from "../db/taskQueueTestStubs.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import {
  DocumentNotFoundError,
  DocumentService,
} from "./documentService.ts";

/** In-Memory-DB nur für Document-Pfade in DocumentService-Tests. */
class DocTestDb implements DatabaseClient {
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

  documents: Document[] = [];
  chunks: DocumentChunk[] = [];
  searchChunksCalls = 0;

  async findAgentConfigForUser(): Promise<AgentConfigRow | null> {
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

  async insertDocument(
    userId: string,
    doc: {
      name: string;
      document_type: string;
      content_text?: string;
      summary?: string;
      file_size_bytes?: number;
      mime_type?: string;
      source?: string;
    },
  ): Promise<Document> {
    const now = new Date();
    const row: Document = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: doc.name,
      document_type: doc.document_type,
      content_text: doc.content_text ?? null,
      summary: doc.summary ?? null,
      file_size_bytes: doc.file_size_bytes ?? null,
      mime_type: doc.mime_type ?? null,
      source: doc.source ?? "upload",
      drive_file_id: null,
      processed: false,
      processed_at: null,
      created_at: now,
      updated_at: now,
    };
    this.documents.push(row);
    return row;
  }

  async getDocuments(
    userId: string,
    options?: {
      document_type?: string;
      processed?: boolean;
      limit?: number;
    },
  ): Promise<Document[]> {
    let rows = this.documents.filter((d) => d.user_id === userId);
    if (options?.document_type) {
      rows = rows.filter((d) => d.document_type === options.document_type);
    }
    if (options?.processed !== undefined) {
      rows = rows.filter((d) => d.processed === options.processed);
    }
    rows = rows.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const lim = options?.limit ?? 200;
    return rows.slice(0, lim);
  }

  async getDocument(id: string, userId: string): Promise<Document | null> {
    const d = this.documents.find((x) => x.id === id && x.user_id === userId);
    return d ?? null;
  }

  async updateDocumentProcessed(
    id: string,
    userId: string,
    result: { summary: string; content_text?: string },
  ): Promise<void> {
    const d = this.documents.find((x) => x.id === id && x.user_id === userId);
    if (!d) return;
    d.processed = true;
    d.processed_at = new Date();
    d.summary = result.summary;
    if (result.content_text !== undefined) d.content_text = result.content_text;
  }

  async deleteDocument(id: string, userId: string): Promise<void> {
    const i = this.documents.findIndex((x) => x.id === id && x.user_id === userId);
    if (i === -1) {
      throw new Error("Dokument nicht gefunden oder keine Berechtigung.");
    }
    this.documents.splice(i, 1);
    this.chunks = this.chunks.filter((c) => c.document_id !== id);
  }

  async insertChunks(
    rows: Array<{
      document_id: string;
      user_id: string;
      chunk_index: number;
      page_number?: number;
      section_title?: string;
      content: string;
      token_count?: number;
    }>,
  ): Promise<void> {
    const now = new Date();
    for (const c of rows) {
      this.chunks.push({
        id: crypto.randomUUID(),
        document_id: c.document_id,
        user_id: c.user_id,
        chunk_index: c.chunk_index,
        page_number: c.page_number ?? null,
        section_title: c.section_title ?? null,
        content: c.content,
        token_count: c.token_count ?? null,
        created_at: now,
      });
    }
  }

  async searchChunks(params: {
    documentId: string;
    userId: string;
    query: string;
    limit?: number;
  }): Promise<DocumentChunk[]> {
    this.searchChunksCalls++;
    let list = this.chunks.filter((c) =>
      c.document_id === params.documentId && c.user_id === params.userId
    );
    const q = params.query.trim().toLowerCase();
    if (q.length > 0) {
      list = list.filter((c) => c.content.toLowerCase().includes(q));
    }
    list = list.sort((a, b) => a.chunk_index - b.chunk_index);
    const lim = params.limit ?? 5;
    return list.slice(0, lim);
  }

  async getChunks(documentId: string, userId: string): Promise<DocumentChunk[]> {
    return this.chunks
      .filter((c) => c.document_id === documentId && c.user_id === userId)
      .sort((a, b) => a.chunk_index - b.chunk_index);
  }

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

class StubDb implements DatabaseClient {
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
  async insertDocument(): Promise<Document> {
    throw new Error("unused");
  }
  async getDocuments(): Promise<Document[]> {
    return [];
  }
  async getDocument(): Promise<null> {
    return null;
  }
  async updateDocumentProcessed(): Promise<void> {}
  async deleteDocument(): Promise<void> {}
  async insertChunks(): Promise<void> {}
  async searchChunks(): Promise<DocumentChunk[]> {
    return [];
  }
  async getChunks(): Promise<DocumentChunk[]> {
    return [];
  }

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

class CaptureLlm implements LlmClient {
  lastRequest: LlmRequest | null = null;
  constructor(private readonly response: LlmResponse) {}
  async chat(req: LlmRequest): Promise<LlmResponse> {
    this.lastRequest = req;
    return this.response;
  }
}

Deno.test("DocumentService.chunkText — 2000 Zeichen, overlap: erwartbare Chunk-Anzahl", () => {
  const svc = new DocumentService(new StubDb(), new CaptureLlm({
    content: "",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  }));
  const text = "a".repeat(2000);
  const chunks = svc.chunkText({
    text,
    documentId: "d1",
    userId: "u1",
    chunkSize: 800,
    overlap: 100,
  });
  assertEquals(chunks.length, 3);
});

Deno.test("DocumentService.chunkText — 'Seite 3' setzt page_number", () => {
  const svc = new DocumentService(new StubDb(), new CaptureLlm({
    content: "",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  }));
  const text = "Einleitung\nSeite 3\n" + "x".repeat(900);
  const chunks = svc.chunkText({
    text,
    documentId: "d1",
    userId: "u1",
    chunkSize: 800,
    overlap: 50,
  });
  const withPage = chunks.find((c) => c.page_number === 3);
  assertExists(withPage);
});

Deno.test("DocumentService.chunkText — Abschnittstitel '1. Revenue Model'", () => {
  const svc = new DocumentService(new StubDb(), new CaptureLlm({
    content: "",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  }));
  const text = "1. Revenue Model\n" + "y".repeat(900);
  const chunks = svc.chunkText({
    text,
    documentId: "d1",
    userId: "u1",
    chunkSize: 800,
    overlap: 50,
  });
  const hit = chunks.find((c) => c.section_title === "1. Revenue Model");
  assertExists(hit);
});

Deno.test("DocumentService.extractText — text/plain", async () => {
  const svc = new DocumentService(new StubDb(), new CaptureLlm({
    content: "",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  }));
  const enc = new TextEncoder().encode("Hallo UTF-8 äöü");
  const t = await svc.extractText({
    content: enc,
    mimeType: "text/plain; charset=utf-8",
  });
  assertStringIncludes(t, "Hallo UTF-8");
});

Deno.test("DocumentService.extractText — unbekannter MIME → leer", async () => {
  const svc = new DocumentService(new StubDb(), new CaptureLlm({
    content: "",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  }));
  const t = await svc.extractText({
    content: new Uint8Array([1, 2, 3]),
    mimeType: "application/octet-stream",
  });
  assertEquals(t, "");
});

Deno.test("DocumentService.summarizeDocument — business_plan enthält Executive Summary im Prompt", async () => {
  const llm = new CaptureLlm({
    content: "ok",
    input_tokens: 1,
    output_tokens: 1,
    stop_reason: "end_turn",
  });
  const svc = new DocumentService(new StubDb(), llm);
  await svc.summarizeDocument({
    userId: "u1",
    name: "BP",
    documentType: "business_plan",
    contentText: "Text",
  });
  const msg = llm.lastRequest?.messages[0]?.content ?? "";
  assertStringIncludes(msg, "Executive Summary");
});

Deno.test("DocumentService.askDocument — ruft searchChunks auf, Antwort mit sources", async () => {
  const db = new DocTestDb();
  const uid = "00000000-0000-4000-8000-0000000000aa";
  const doc = await db.insertDocument(uid, {
    name: "D",
    document_type: "other",
  });
  await db.insertChunks([{
    document_id: doc.id,
    user_id: uid,
    chunk_index: 0,
    content: "Umsatz 2025 beträgt 42 EUR",
    token_count: 10,
  }]);
  await db.updateDocumentProcessed(doc.id, uid, { summary: "s", content_text: "x" });

  const qaJson = JSON.stringify({
    answer: "42 EUR",
    sources: [{
      chunk_index: 0,
      excerpt: "Umsatz",
    }],
  });
  const llm = new CaptureLlm({
    content: qaJson,
    input_tokens: 1,
    output_tokens: 1,
    stop_reason: "end_turn",
  });
  const svc = new DocumentService(db, llm);
  const out = await svc.askDocument({
    documentId: doc.id,
    userId: uid,
    question: "Umsatz?",
  });
  assertEquals(db.searchChunksCalls >= 1, true);
  assertEquals(out.answer, "42 EUR");
  assertEquals(out.sources.length >= 1, true);
});

Deno.test("DocumentService.askDocument — fremdes Dokument → DocumentNotFoundError", async () => {
  const db = new DocTestDb();
  const owner = "00000000-0000-4000-8000-0000000000bb";
  const other = "00000000-0000-4000-8000-0000000000cc";
  const doc = await db.insertDocument(owner, {
    name: "D",
    document_type: "other",
  });
  const llm = new CaptureLlm({
    content: "{}",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  });
  const svc = new DocumentService(db, llm);
  await assertRejects(
    () =>
      svc.askDocument({
        documentId: doc.id,
        userId: other,
        question: "Hi",
      }),
    DocumentNotFoundError,
  );
});

Deno.test("DocumentService.verifyDocument — JSON mit sections_found und critical_assumptions", async () => {
  const db = new DocTestDb();
  const uid = "00000000-0000-4000-8000-0000000000dd";
  const doc = await db.insertDocument(uid, {
    name: "D",
    document_type: "business_plan",
  });
  await db.insertChunks([{
    document_id: doc.id,
    user_id: uid,
    chunk_index: 0,
    content: "Abschnitt A und B",
    token_count: 4,
  }]);
  await db.updateDocumentProcessed(doc.id, uid, { summary: "s" });

  const verifyJson = JSON.stringify({
    sections_found: ["Finanzen", "Markt"],
    missing_sections: [],
    contradictions: [],
    critical_assumptions: ["Wachstum 50% p.a."],
    overall_assessment: "Solide.",
  });
  const llm = new CaptureLlm({
    content: verifyJson,
    input_tokens: 1,
    output_tokens: 1,
    stop_reason: "end_turn",
  });
  const svc = new DocumentService(db, llm);
  const v = await svc.verifyDocument({ documentId: doc.id, userId: uid });
  assertEquals(v.sections_found.includes("Finanzen"), true);
  assertEquals(v.critical_assumptions.length >= 1, true);
});

Deno.test("DocumentService.buildDocumentContext — max 2000 Zeichen, Markdown-Format", async () => {
  const db = new DocTestDb();
  const uid = "00000000-0000-4000-8000-0000000000ee";
  const longSum = "Wort ".repeat(500);
  for (let i = 0; i < 5; i++) {
    const d = await db.insertDocument(uid, {
      name: `Doc-${i}`,
      document_type: "other",
    });
    await db.updateDocumentProcessed(d.id, uid, { summary: longSum });
  }
  const llm = new CaptureLlm({
    content: "",
    input_tokens: 0,
    output_tokens: 0,
    stop_reason: "end_turn",
  });
  const svc = new DocumentService(db, llm);
  const ctx = await svc.buildDocumentContext(uid);
  assertMatch(ctx, /^## Dokumente/);
  assertEquals(ctx.length <= 2000 + 3, true);
});
