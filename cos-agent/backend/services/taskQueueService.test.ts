import { assertEquals } from "@std/assert";
import type { DatabaseClient, TaskQueueRow } from "../db/databaseClient.ts";
import type { AppEnv } from "../config/env.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import { ToolExecutor } from "./tools/toolExecutor.ts";
import { DocumentService } from "./documentService.ts";
import { LearningService } from "./learningService.ts";
import { BriefingDelivery } from "./briefingDelivery.ts";
import { TaskQueueService } from "./taskQueueService.ts";

class MiniLlm implements LlmClient {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "{}",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  }
}

function deliveryEnv(): AppEnv {
  return {
    port: 8787,
    databaseUrl: "x",
    serviceToken: "test-service-token-32-chars-minimum!!",
    jwtSecret: "test-jwt-secret-32-chars-minimum!!!!",
    corsOrigins: ["http://localhost:5173"],
    anthropicApiKey: "sk-ant-test-dummy-key-20chars",
    googleClientId: "",
    googleClientSecret: "",
    googleRedirectUri: "",
    googleLoginRedirectUri: "",
    frontendUrl: "http://localhost:5174",
    emailServiceUrl: null,
    emailServiceToken: null,
    slackClientId: "",
    slackClientSecret: "",
    slackRedirectUri: "",
  };
}

function baseTask(over: Partial<TaskQueueRow> = {}): TaskQueueRow {
  const now = new Date();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-000000000002",
    title: "T",
    description: "D",
    priority: "medium",
    status: "running",
    document_ids: null,
    context: null,
    result: null,
    result_notion_page_id: null,
    result_draft_id: null,
    error_message: null,
    started_at: now,
    completed_at: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
}

Deno.test("TaskQueueService.processNextTask — Queue leer", async () => {
  const db = {
    async getNextPendingTask() {
      return null;
    },
  } as unknown as DatabaseClient;
  const llm = new MiniLlm();
  const toolExecutor = new ToolExecutor();
  const documentService = new DocumentService(db, llm);
  const learningService = new LearningService(db, llm);
  const svc = new TaskQueueService(
    db,
    llm,
    toolExecutor,
    documentService,
    learningService,
    new BriefingDelivery(deliveryEnv()),
  );
  const r = await svc.processNextTask();
  assertEquals(r.processed, false);
  assertEquals(r.reason, "queue_empty");
});

Deno.test("TaskQueueService.processNextTask — Erfolg mit inject runOrchestrator", async () => {
  const task = baseTask({ id: crypto.randomUUID(), user_id: crypto.randomUUID() });
  const updates: { status: string; id: string }[] = [];
  const db = {
    async getNextPendingTask() {
      return task;
    },
    async updateTaskStatus(id: string, status: string) {
      updates.push({ id, status });
    },
    async findBriefingUser() {
      return { name: "N", email: "n@test.local" };
    },
    async getDocument() {
      return null;
    },
    async listUserContexts() {
      return [];
    },
  } as unknown as DatabaseClient;
  const llm = new MiniLlm();
  const toolExecutor = new ToolExecutor();
  const documentService = new DocumentService(db, llm);
  const learningService = new LearningService(db, llm);
  const svc = new TaskQueueService(
    db,
    llm,
    toolExecutor,
    documentService,
    learningService,
    new BriefingDelivery(deliveryEnv()),
    () => new Date(),
    {
      runOrchestrator: async () => ({ content: "## Ergebnis\nOK" }),
    },
  );
  const r = await svc.processNextTask();
  assertEquals(r.processed, true);
  assertEquals(r.success, true);
  assertEquals(updates.some((u) => u.status === "completed"), true);
});

Deno.test("TaskQueueService.processNextTask — Timeout", async () => {
  const task = baseTask({ id: crypto.randomUUID(), user_id: crypto.randomUUID() });
  const updates: { status: string; id: string }[] = [];
  const db = {
    async getNextPendingTask() {
      return task;
    },
    async updateTaskStatus(id: string, status: string, p?: { error_message?: string }) {
      updates.push({ id, status });
      if (status === "failed") {
        assertEquals(
          (p?.error_message ?? "").toLowerCase().includes("timeout"),
          true,
        );
      }
    },
    async findBriefingUser() {
      return { name: "N", email: "n@test.local" };
    },
    async getDocument() {
      return null;
    },
    async listUserContexts() {
      return [];
    },
  } as unknown as DatabaseClient;
  const llm = new MiniLlm();
  const toolExecutor = new ToolExecutor();
  const documentService = new DocumentService(db, llm);
  const learningService = new LearningService(db, llm);
  const svc = new TaskQueueService(
    db,
    llm,
    toolExecutor,
    documentService,
    learningService,
    new BriefingDelivery(deliveryEnv()),
    () => new Date(),
    {
      runTimeoutMs: 30,
      runOrchestrator: () => new Promise(() => {}),
    },
  );
  const r = await svc.processNextTask();
  assertEquals(r.processed, true);
  assertEquals(r.success, false);
  assertEquals(updates.some((u) => u.status === "failed"), true);
});

Deno.test("TaskQueueService.processNextTask — Orchestrator wirft", async () => {
  const task = baseTask({ id: crypto.randomUUID(), user_id: crypto.randomUUID() });
  const updates: string[] = [];
  const db = {
    async getNextPendingTask() {
      return task;
    },
    async updateTaskStatus(_id: string, status: string) {
      updates.push(status);
    },
    async findBriefingUser() {
      return { name: "N", email: "n@test.local" };
    },
    async getDocument() {
      return null;
    },
    async listUserContexts() {
      return [];
    },
  } as unknown as DatabaseClient;
  const llm = new MiniLlm();
  const toolExecutor = new ToolExecutor();
  const documentService = new DocumentService(db, llm);
  const learningService = new LearningService(db, llm);
  const svc = new TaskQueueService(
    db,
    llm,
    toolExecutor,
    documentService,
    learningService,
    new BriefingDelivery(deliveryEnv()),
    () => new Date(),
    {
      runOrchestrator: async () => {
        throw new Error("boom");
      },
    },
  );
  const r = await svc.processNextTask();
  assertEquals(r.processed, true);
  assertEquals(r.success, false);
  assertEquals(updates.includes("failed"), true);
});

Deno.test("TaskQueueService.processNextTask — Notion-Seite + result_notion_page_id", async () => {
  const task = baseTask({ id: crypto.randomUUID(), user_id: crypto.randomUUID() });
  let lastNotion: unknown = null;
  const toolExecutor = {
    async execute(
      tool: string,
      params: unknown,
      _userId: string,
      _db: DatabaseClient,
    ) {
      if (tool === "notion") {
        lastNotion = params;
        return { success: true, data: { id: "page-xyz-1" } };
      }
      return { success: false, error: "?" };
    },
  } as unknown as ToolExecutor;

  const updates: Array<{ status: string; patch?: { result_notion_page_id?: string } }> =
    [];
  const db = {
    async getNextPendingTask() {
      return task;
    },
    async updateTaskStatus(
      _id: string,
      status: string,
      p?: { result_notion_page_id?: string },
    ) {
      updates.push({ status, patch: p });
    },
    async findBriefingUser() {
      return { name: "N", email: "n@test.local" };
    },
    async getDocument() {
      return null;
    },
    async listUserContexts() {
      return [
        { key: "notion_token", value: "tok" },
        { key: "notion_database_id", value: "db-1" },
      ];
    },
  } as unknown as DatabaseClient;
  const llm = new MiniLlm();
  const documentService = new DocumentService(db, llm);
  const learningService = new LearningService(db, llm);
  const svc = new TaskQueueService(
    db,
    llm,
    toolExecutor,
    documentService,
    learningService,
    new BriefingDelivery(deliveryEnv()),
    () => new Date(),
    {
      runOrchestrator: async () => ({ content: "Markdown-Ergebnis" }),
    },
  );
  const r = await svc.processNextTask();
  assertEquals(r.success, true);
  assertEquals(lastNotion !== null, true);
  const completed = updates.find((u) => u.status === "completed");
  assertEquals(completed?.patch?.result_notion_page_id, "page-xyz-1");
});
