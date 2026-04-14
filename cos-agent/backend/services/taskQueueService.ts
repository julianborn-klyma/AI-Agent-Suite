import { AggregatorAgent } from "../agents/aggregator.ts";
import { OrchestratorAgent } from "../agents/orchestrator.ts";
import { ValidatorAgent } from "../agents/validator.ts";
import type { DatabaseClient, TaskQueueRow } from "../db/databaseClient.ts";
import { DocumentService } from "./documentService.ts";
import { LearningService } from "./learningService.ts";
import { BriefingDelivery } from "./briefingDelivery.ts";
import type { LlmClient } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";

export type TaskProcessResult = {
  processed: boolean;
  taskId?: string;
  success?: boolean;
  reason?: string;
  durationMs?: number;
};

export type TaskQueueServiceOptions = {
  /** Test: Timeout für Orchestrator-Lauf (Standard 5 Min). */
  runTimeoutMs?: number;
  /** Test: ersetzt den echten Orchestrator-Lauf. */
  runOrchestrator?: (args: {
    userId: string;
    sessionId: string;
    message: string;
  }) => Promise<{ content: string }>;
};

function wrapLlmPassthrough(llm: LlmClient): LlmClient {
  return { chat: (req) => llm.chat(req) };
}

async function raceWithTimeout<T>(
  runPromise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let tid: ReturnType<typeof setTimeout> | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    tid = setTimeout(() => {
      reject(new Error("Task timeout after 5min"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([runPromise, timeoutP]);
  } finally {
    if (tid !== undefined) clearTimeout(tid);
  }
}

export class TaskQueueService {
  private readonly runTimeoutMs: number;
  private readonly runOrchestrator?: TaskQueueServiceOptions["runOrchestrator"];

  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly toolExecutor: ToolExecutor,
    private readonly documentService: DocumentService,
    private readonly learningService: LearningService,
    private readonly briefingDelivery: BriefingDelivery,
    private readonly nowFn: () => Date = () => new Date(),
    opts?: TaskQueueServiceOptions,
  ) {
    this.runTimeoutMs = opts?.runTimeoutMs ?? 300_000;
    this.runOrchestrator = opts?.runOrchestrator;
  }

  async processNextTask(): Promise<TaskProcessResult> {
    const t0 = performance.now();
    const task = await this.db.getNextPendingTask();
    if (!task) {
      return { processed: false, reason: "queue_empty" };
    }

    const user = await this.db.findBriefingUser(task.user_id);
    const email = user?.email ?? null;

    const fail = async (msg: string) => {
      await this.db.updateTaskStatus(task.id, "failed", {
        completed_at: this.nowFn(),
        error_message: msg,
      });
      if (email) {
        await this.briefingDelivery.sendEmail(
          email,
          `✗ Task fehlgeschlagen: ${task.title}`,
          `Fehler: ${msg}`,
        );
      }
      return {
        processed: true,
        taskId: task.id,
        success: false,
        durationMs: Math.round(performance.now() - t0),
      };
    };

    try {
      const docParts: string[] = [];
      const ids = task.document_ids ?? [];
      for (const did of ids) {
        const d = await this.db.getDocument(did, task.user_id);
        if (d) {
          const sum = (d.summary ?? d.content_text ?? "").slice(0, 800);
          docParts.push(`- **${d.name}** (id ${d.id}): ${sum || "(kein Text)"}`);
        }
      }
      const documentSummaries = docParts.join("\n");

      const message =
        `## Aufgabe\n${task.title}\n\n## Beschreibung\n${task.description}\n\n` +
        (task.context ? `## Zusätzlicher Kontext\n${task.context}\n\n` : "") +
        (docParts.length > 0
          ? `## Referenz-Dokumente\n${documentSummaries}\n\n`
          : "") +
        `## Wichtig\n` +
        `Arbeite diese Aufgabe vollständig ab.\n` +
        `Nutze alle verfügbaren Tools (Notion, Gmail, Drive, Calendar).\n` +
        `Gib am Ende eine strukturierte Zusammenfassung deiner Ergebnisse.\n`;

      let content: string;
      if (this.runOrchestrator) {
        const runPromise = this.runOrchestrator({
          userId: task.user_id,
          sessionId: task.id,
          message,
        });
        const result = await raceWithTimeout(runPromise, this.runTimeoutMs);
        content = result.content;
      } else {
        const trackedLlm = wrapLlmPassthrough(this.llm);
        const validator = new ValidatorAgent(trackedLlm);
        const aggregator = new AggregatorAgent(trackedLlm);
        const orchestrator = new OrchestratorAgent(
          trackedLlm,
          this.db,
          this.toolExecutor,
          validator,
          aggregator,
          this.nowFn,
          this.learningService,
          this.llm,
          this.documentService,
        );
        const runPromise = orchestrator.run({
          userId: task.user_id,
          sessionId: task.id,
          message,
          historyMessages: [],
          now: this.nowFn,
        });
        const result = await raceWithTimeout(runPromise, this.runTimeoutMs);
        content = result.content;
      }

      const notionPageId = await this.maybeSaveNotionResult(task, content);
      const completedPatch: {
        completed_at: Date;
        result: string;
        result_notion_page_id?: string;
      } = {
        completed_at: this.nowFn(),
        result: content,
      };
      if (notionPageId) completedPatch.result_notion_page_id = notionPageId;
      await this.db.updateTaskStatus(task.id, "completed", completedPatch);

      if (email) {
        await this.briefingDelivery.sendEmail(
          email,
          `✓ Task abgeschlossen: ${task.title}`,
          content,
        );
      }

      return {
        processed: true,
        taskId: task.id,
        success: true,
        durationMs: Math.round(performance.now() - t0),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return await fail(msg);
    }
  }

  /** Speichert Kurz-Ergebnis als Notion-Task in der User-Datenbank, falls verbunden. */
  private async maybeSaveNotionResult(
    task: TaskQueueRow,
    content: string,
  ): Promise<string | null> {
    const ctx = await this.db.listUserContexts(task.user_id);
    const hasToken = ctx.some((r) => r.key === "notion_token" && r.value?.trim());
    const dbId = ctx.find((r) => r.key === "notion_database_id")?.value?.trim();
    if (!hasToken || !dbId) return null;

    const title = `Task-Ergebnis: ${task.title}`.slice(0, 180);
    const project = content.replace(/\s+/g, " ").trim().slice(0, 1900);
    const r = await this.toolExecutor.execute(
      "notion",
      {
        action: "add_task",
        database_id: dbId,
        title,
        priority: "medium",
        project: project || undefined,
      },
      task.user_id,
      this.db,
    );
    if (!r.success || r.data === null || typeof r.data !== "object") return null;
    const id = (r.data as { id?: string }).id;
    return typeof id === "string" && id ? id : null;
  }
}
