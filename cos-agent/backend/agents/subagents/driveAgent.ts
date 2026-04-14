import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, LearningCandidate, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export class DriveAgent extends BaseSubAgent {
  readonly agentType = "drive";
  readonly description = "Google Drive: Dokumente lesen, neue Dateien, Protokolle";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("drive")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "drive nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const kind = String(task.action ?? task.task ?? "get_document_summary");

    try {
      if (kind === "sync_new_documents") {
        return await this.runSyncNewDocuments(context, elapsed);
      }
      if (kind === "get_document_summary") {
        return await this.runDocumentSummary(task, context, elapsed);
      }
      if (kind === "extract_decisions") {
        return await this.runExtractDecisions(task, context, elapsed);
      }
      return {
        agentType: this.agentType,
        success: false,
        error: `Unbekannte Drive-Task: ${kind}`,
        durationMs: elapsed(),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        agentType: this.agentType,
        success: false,
        error: msg,
        durationMs: elapsed(),
      };
    }
  }

  private async runSyncNewDocuments(
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const since = yesterdayIso();
    const listRes = await this.toolExecutor.execute(
      "drive",
      { action: "list_new_files", since },
      context.userId,
      this.db,
    );
    if (!listRes.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: listRes.error,
        durationMs: elapsed(),
      };
    }
    const files = (listRes.data as { files?: unknown[] })?.files ?? [];
    return {
      agentType: this.agentType,
      success: true,
      data: {
        prepared: true,
        since,
        file_count: files.length,
        files_preview: files.slice(0, 10),
        note:
          "cos_documents-Speicherung folgt in Migration 006 (Phase D).",
      },
      durationMs: elapsed(),
    };
  }

  private async runDocumentSummary(
    task: Record<string, unknown>,
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const fileId = String(task.file_id ?? "");
    if (!fileId) {
      return {
        agentType: this.agentType,
        success: false,
        error: "file_id fehlt.",
        durationMs: elapsed(),
      };
    }
    const doc = await this.toolExecutor.execute(
      "drive",
      { action: "get_file_content", file_id: fileId },
      context.userId,
      this.db,
    );
    if (!doc.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: doc.error,
        durationMs: elapsed(),
      };
    }
    const summary = await this.callLlm({
      systemPrompt:
        "Fasse den Dokumentinhalt knapp auf Deutsch (Stichpunkte). Nur aus dem Text.",
      userMessage: String(
        JSON.stringify(doc.data ?? {}, null, 2),
      ).slice(0, 120_000),
      context,
    });
    return {
      agentType: this.agentType,
      success: true,
      data: { summary, meta: doc.data },
      durationMs: elapsed(),
    };
  }

  private async runExtractDecisions(
    task: Record<string, unknown>,
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const fileId = String(task.file_id ?? "");
    if (!fileId) {
      return {
        agentType: this.agentType,
        success: false,
        error: "file_id fehlt.",
        durationMs: elapsed(),
      };
    }
    const doc = await this.toolExecutor.execute(
      "drive",
      { action: "get_file_content", file_id: fileId },
      context.userId,
      this.db,
    );
    if (!doc.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: doc.error,
        durationMs: elapsed(),
      };
    }
    const learningCandidates: LearningCandidate[] = [];
    const content = JSON.stringify(doc.data ?? "");
    if (/beschluss|entscheid|action item|todo:/i.test(content)) {
      learningCandidates.push({
        kind: "decision_pattern",
        category: "decision_pattern",
        summary: "Protokoll/Dokument enthält vermutliche Beschlüsse oder Action Items.",
        source: "drive_extract_decisions",
        confidence: 0.55,
      });
    }
    const digest = await this.callLlm({
      systemPrompt:
        "Extrahiere aus dem Meeting-Protokoll (JSON mit content) mögliche Beschlüsse — kurz, Deutsch.",
      userMessage: JSON.stringify(doc.data, null, 2).slice(0, 120_000),
      context,
    });
    return {
      agentType: this.agentType,
      success: true,
      data: { decisions_digest: digest },
      learningCandidates,
      durationMs: elapsed(),
    };
  }
}
