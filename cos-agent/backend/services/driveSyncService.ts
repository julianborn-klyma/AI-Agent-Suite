import type { DatabaseClient } from "../db/databaseClient.ts";
import type { DocumentService } from "./documentService.ts";
import type { LlmClient } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";

export type DriveSyncResult = {
  skipped: boolean;
  reason?: string;
  new_documents: number;
  skipped_files: number;
  errors: number;
};

export class DriveSyncService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly _llm: LlmClient,
    private readonly documentService: DocumentService,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  async syncNewDocuments(userId: string): Promise<DriveSyncResult> {
    void this._llm;
    const ctx = await this.db.listUserContexts(userId);
    const m = new Map(ctx.map((r) => [r.key, r.value]));
    if (m.get("google_connected") !== "true") {
      return {
        skipped: true,
        reason: "Google nicht verbunden.",
        new_documents: 0,
        skipped_files: 0,
        errors: 0,
      };
    }
    const folderId = (m.get("drive_folder_id") ?? "").trim();
    if (!folderId) {
      return {
        skipped: true,
        reason: "drive_folder_id fehlt.",
        new_documents: 0,
        skipped_files: 0,
        errors: 0,
      };
    }

    const schedules = await this.db.getUserSchedules(userId);
    const driveSched = schedules.find((s) => s.job_type === "drive_sync");
    const since = driveSched?.last_run
      ? new Date(driveSched.last_run).toISOString()
      : new Date(Date.now() - 7 * 86400000).toISOString();

    const list = await this.toolExecutor.execute(
      "drive",
      { action: "list_files", folder_id: folderId, limit: 50 },
      userId,
      this.db,
    );
    if (!list.success) {
      await this.db.recordScheduleRun(userId, "drive_sync", "error");
      return {
        skipped: false,
        new_documents: 0,
        skipped_files: 0,
        errors: 1,
      };
    }

    const data = (list.data ?? {}) as {
      files?: { id: string; name?: string; mimeType?: string; modifiedTime?: string }[];
    };
    const files = data.files ?? [];
    const sinceMs = new Date(since).getTime();
    let newDocs = 0;
    let skippedFiles = 0;
    let errors = 0;

    for (const f of files) {
      const mt = f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0;
      if (mt && mt < sinceMs) {
        skippedFiles++;
        continue;
      }
      const existing = await this.db.getDocuments(userId, {
        drive_file_id: f.id,
        limit: 1,
      });
      if (existing.length > 0) {
        skippedFiles++;
        continue;
      }
      const contentRes = await this.toolExecutor.execute(
        "drive",
        { action: "get_file_content", file_id: f.id },
        userId,
        this.db,
      );
      if (!contentRes.success) {
        errors++;
        continue;
      }
      const payload = contentRes.data as {
        name?: string;
        mimeType?: string;
        content?: string;
      };
      const mime = String(payload.mimeType ?? "application/octet-stream");
      const body = new TextEncoder().encode(payload.content ?? "");
      try {
        await this.documentService.processUpload({
          userId,
          name: payload.name ?? f.id,
          documentType: "other",
          content: body,
          mimeType: mime,
          source: "drive_sync",
          driveFileId: f.id,
        });
        newDocs++;
      } catch {
        errors++;
      }
    }

    await this.db.recordScheduleRun(userId, "drive_sync", "success");
    return {
      skipped: false,
      new_documents: newDocs,
      skipped_files: skippedFiles,
      errors,
    };
  }
}
