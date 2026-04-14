import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DatabaseClient, Document, Schedule } from "../db/databaseClient.ts";
import type { DocumentService } from "./documentService.ts";
import type { LlmClient, LlmRequest, LlmResponse } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";
import type { ToolResult } from "./tools/types.ts";
import { DriveSyncService } from "./driveSyncService.ts";

const noopLlm: LlmClient = {
  async chat(_req: LlmRequest): Promise<LlmResponse> {
    return {
      content: "",
      input_tokens: 0,
      output_tokens: 0,
      stop_reason: "end_turn",
    };
  },
};

type DriveExecCall = { tool: string; params: unknown; userId: string };

class StubDriveToolExecutor {
  readonly calls: DriveExecCall[] = [];
  listResult: ToolResult = { success: false, error: "unset" };
  readonly contentByFileId = new Map<string, ToolResult>();

  async execute(
    toolName: string,
    params: unknown,
    userId: string,
    _db: DatabaseClient,
  ): Promise<ToolResult> {
    this.calls.push({ tool: toolName, params, userId });
    if (toolName !== "drive") return { success: false, error: "unexpected tool" };
    const action = (params as { action?: string }).action;
    if (action === "list_files") return this.listResult;
    if (action === "get_file_content") {
      const id = (params as { file_id: string }).file_id;
      return this.contentByFileId.get(id) ??
        { success: false, error: "no stub content" };
    }
    return { success: false, error: `unexpected action ${action}` };
  }
}

function asToolExecutor(x: StubDriveToolExecutor): ToolExecutor {
  return x as unknown as ToolExecutor;
}

function asDocumentService(x: unknown): DocumentService {
  return x as DocumentService;
}

function fakeDoc(userId: string, driveId: string): Document {
  const now = new Date();
  return {
    id: "doc-1",
    user_id: userId,
    name: "existing",
    document_type: "other",
    content_text: null,
    summary: null,
    file_size_bytes: 0,
    mime_type: "text/plain",
    source: "drive_sync",
    drive_file_id: driveId,
    processed: true,
    processed_at: now,
    created_at: now,
    updated_at: now,
  };
}

function makeDriveDb(opts: {
  contexts: { key: string; value: string }[];
  existingDriveFileId?: string;
}): DatabaseClient & { recordCalls: { userId: string; job: string; status: string }[] } {
  const recordCalls: { userId: string; job: string; status: string }[] = [];
  const db = {
    recordCalls,
    async listUserContexts(_userId: string): Promise<{ key: string; value: string }[]> {
      return opts.contexts;
    },
    async getUserSchedules(): Promise<Schedule[]> {
      return [];
    },
    async getDocuments(
      _userId: string,
      o?: { drive_file_id?: string },
    ): Promise<Document[]> {
      if (opts.existingDriveFileId && o?.drive_file_id === opts.existingDriveFileId) {
        return [fakeDoc("u-drive", opts.existingDriveFileId)];
      }
      return [];
    },
    async recordScheduleRun(
      userId: string,
      jobType: string,
      status: "success" | "error",
    ): Promise<void> {
      recordCalls.push({ userId, job: jobType, status });
    },
  };
  return db as unknown as DatabaseClient & typeof db;
}

Deno.test({
  name: "DriveSyncService — ohne drive_folder_id → skipped, kein Drive-Call",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubDriveToolExecutor();
    const db = makeDriveDb({
      contexts: [{ key: "google_connected", value: "true" }],
    });
    const docSvc = {
      async processUpload() {
        throw new Error("processUpload should not run");
      },
    };
    const svc = new DriveSyncService(
      db,
      noopLlm,
      asDocumentService(docSvc),
      asToolExecutor(exec),
    );
    const r = await svc.syncNewDocuments("u-drive");
    assertEquals(r.skipped, true);
    assertStringIncludes(r.reason ?? "", "drive_folder_id");
    assertEquals(exec.calls.length, 0);
  },
});

Deno.test({
  name: "DriveSyncService — ohne google_connected → skipped",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubDriveToolExecutor();
    const db = makeDriveDb({
      contexts: [{ key: "drive_folder_id", value: "folder-xyz" }],
    });
    const docSvc = {
      async processUpload() {
        throw new Error("no upload");
      },
    };
    const svc = new DriveSyncService(
      db,
      noopLlm,
      asDocumentService(docSvc),
      asToolExecutor(exec),
    );
    const r = await svc.syncNewDocuments("u-drive");
    assertEquals(r.skipped, true);
    assertEquals(r.reason, "Google nicht verbunden.");
    assertEquals(exec.calls.length, 0);
  },
});

Deno.test({
  name: "DriveSyncService — neue Datei → processUpload + new_documents 1",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubDriveToolExecutor();
    const mt = new Date().toISOString();
    exec.listResult = {
      success: true,
      data: {
        files: [{
          id: "file-new",
          name: "Neu.txt",
          mimeType: "text/plain",
          modifiedTime: mt,
        }],
      },
    };
    exec.contentByFileId.set("file-new", {
      success: true,
      data: { name: "Neu.txt", mimeType: "text/plain", content: "Hallo" },
    });
    const db = makeDriveDb({
      contexts: [
        { key: "google_connected", value: "true" },
        { key: "drive_folder_id", value: "folder-1" },
      ],
    });
    const uploadCalls: unknown[] = [];
    const docSvc = {
      async processUpload(
        p: {
          userId: string;
          name: string;
          documentType: string;
          content: Uint8Array;
          mimeType: string;
          source?: string;
          driveFileId?: string;
        },
      ): Promise<Document> {
        uploadCalls.push(p);
        return fakeDoc(p.userId, p.driveFileId ?? "");
      },
    };
    const svc = new DriveSyncService(
      db,
      noopLlm,
      asDocumentService(docSvc),
      asToolExecutor(exec),
    );
    const r = await svc.syncNewDocuments("u-drive");
    assertEquals(r.skipped, false);
    assertEquals(r.new_documents, 1);
    assertEquals(r.skipped_files, 0);
    assertEquals(r.errors, 0);
    assertEquals(uploadCalls.length, 1);
    assertEquals(
      (uploadCalls[0] as { driveFileId?: string }).driveFileId,
      "file-new",
    );
    assertEquals(db.recordCalls.some((c) => c.status === "success"), true);
  },
});

Deno.test({
  name: "DriveSyncService — bereits indexiert → kein processUpload",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubDriveToolExecutor();
    const mt = new Date().toISOString();
    exec.listResult = {
      success: true,
      data: {
        files: [{
          id: "f-dup",
          name: "Dup.txt",
          mimeType: "text/plain",
          modifiedTime: mt,
        }],
      },
    };
    const db = makeDriveDb({
      contexts: [
        { key: "google_connected", value: "true" },
        { key: "drive_folder_id", value: "f1" },
      ],
      existingDriveFileId: "f-dup",
    });
    const uploadCalls: unknown[] = [];
    const docSvc = {
      async processUpload() {
        uploadCalls.push("called");
        throw new Error("should not upload");
      },
    };
    const svc = new DriveSyncService(
      db,
      noopLlm,
      asDocumentService(docSvc),
      asToolExecutor(exec),
    );
    const r = await svc.syncNewDocuments("u-drive");
    assertEquals(r.new_documents, 0);
    assertEquals(r.skipped_files, 1);
    assertEquals(r.errors, 0);
    assertEquals(uploadCalls.length, 0);
  },
});

Deno.test({
  name: "DriveSyncService — einzelner Upload-Fehler stoppt Schleife nicht",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const exec = new StubDriveToolExecutor();
    const mt = new Date().toISOString();
    exec.listResult = {
      success: true,
      data: {
        files: [
          { id: "bad", name: "a.txt", mimeType: "text/plain", modifiedTime: mt },
          { id: "good", name: "b.txt", mimeType: "text/plain", modifiedTime: mt },
        ],
      },
    };
    exec.contentByFileId.set("bad", {
      success: true,
      data: { name: "a.txt", mimeType: "text/plain", content: "a" },
    });
    exec.contentByFileId.set("good", {
      success: true,
      data: { name: "b.txt", mimeType: "text/plain", content: "b" },
    });
    const db = makeDriveDb({
      contexts: [
        { key: "google_connected", value: "true" },
        { key: "drive_folder_id", value: "fld" },
      ],
    });
    const uploadCalls: unknown[] = [];
    const docSvc = {
      async processUpload(
        p: {
          driveFileId?: string;
          userId: string;
          name: string;
          documentType: string;
          content: Uint8Array;
          mimeType: string;
        },
      ): Promise<Document> {
        uploadCalls.push(p);
        if (p.driveFileId === "bad") {
          throw new Error("upload fail");
        }
        return fakeDoc(p.userId, p.driveFileId ?? "");
      },
    };
    const svc = new DriveSyncService(
      db,
      noopLlm,
      asDocumentService(docSvc),
      asToolExecutor(exec),
    );
    const r = await svc.syncNewDocuments("u-drive");
    assertEquals(r.new_documents, 1);
    assertEquals(r.skipped_files, 0);
    assertEquals(r.errors, 1);
    assertEquals(uploadCalls.length, 2);
  },
});
