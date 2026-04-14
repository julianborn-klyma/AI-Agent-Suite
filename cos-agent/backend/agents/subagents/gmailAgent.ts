import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, LearningCandidate, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

type GmailToolParams =
  | { action: "list_unread"; max_results?: number }
  | { action: "summarize_thread"; thread_id: string }
  | {
    action: "create_draft";
    to: string;
    subject: string;
    body: string;
  }
  | { action: "flag_email"; message_id: string; label_ids?: string[] };

export class GmailAgent extends BaseSubAgent {
  readonly agentType = "gmail";
  readonly description = "Liest und verwaltet Emails";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("gmail")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "gmail nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const kind = String(task.action ?? task.task ?? "list_unread");

    try {
      if (kind === "categorize") {
        return await this.runCategorize(context, elapsed);
      }
      if (kind === "summarize_thread") {
        return await this.runSummarizeThread(task, context, elapsed);
      }

      const params = this.buildGmailParams(kind, task);
      if ("error" in params) {
        return {
          agentType: this.agentType,
          success: false,
          error: params.error,
          durationMs: elapsed(),
        };
      }

      const result = await this.toolExecutor.execute(
        "gmail",
        params,
        context.userId,
        this.db,
      );
      return {
        agentType: this.agentType,
        success: result.success,
        data: result.data,
        error: result.error,
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

  private buildGmailParams(
    kind: string,
    task: Record<string, unknown>,
  ): GmailToolParams | { error: string } {
    switch (kind) {
      case "list_unread": {
        const max = task.max_results;
        const n = typeof max === "number" && Number.isInteger(max) && max >= 1 &&
            max <= 50
          ? max
          : 10;
        return { action: "list_unread", max_results: n };
      }
      case "summarize_thread":
        if (typeof task.thread_id !== "string" || !task.thread_id) {
          return { error: "thread_id fehlt." };
        }
        return { action: "summarize_thread", thread_id: task.thread_id };
      case "create_draft": {
        const to = String(task.to ?? "");
        const subject = String(task.subject ?? "");
        const body = String(task.body ?? "");
        if (!to || !subject || !body) {
          return { error: "to, subject und body sind Pflicht." };
        }
        return { action: "create_draft", to, subject, body };
      }
      case "flag_email": {
        const messageId = String(task.message_id ?? "");
        if (!messageId) return { error: "message_id fehlt." };
        const label_ids = Array.isArray(task.label_ids)
          ? task.label_ids.filter((x): x is string => typeof x === "string")
          : undefined;
        return {
          action: "flag_email",
          message_id: messageId,
          label_ids,
        };
      }
      default:
        return { error: `Unbekannte Gmail-Task: ${kind}` };
    }
  }

  private async runSummarizeThread(
    task: Record<string, unknown>,
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const threadId = String(task.thread_id ?? "");
    if (!threadId) {
      return {
        agentType: this.agentType,
        success: false,
        error: "thread_id fehlt.",
        durationMs: elapsed(),
      };
    }
    const toolRes = await this.toolExecutor.execute(
      "gmail",
      { action: "summarize_thread", thread_id: threadId },
      context.userId,
      this.db,
    );
    if (!toolRes.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: toolRes.error,
        durationMs: elapsed(),
      };
    }
    const summary = await this.callLlm({
      systemPrompt:
        "Du fasst Gmail-Thread-Rohdaten knapp auf Deutsch zusammen. Nur Fakten aus den Daten.",
      userMessage: `Thread-Daten:\n${JSON.stringify(toolRes.data)}`,
      context,
    });
    return {
      agentType: this.agentType,
      success: true,
      data: { thread_meta: toolRes.data, summary },
      durationMs: elapsed(),
    };
  }

  private async runCategorize(
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const listRes = await this.toolExecutor.execute(
      "gmail",
      { action: "list_unread", max_results: 20 },
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
    const rows = (listRes.data ?? []) as {
      from?: string;
      subject?: string;
      snippet?: string;
    }[];
    const priorities: Record<string, "high" | "medium" | "low"> = {};
    const learningCandidates: LearningCandidate[] = [];
    const senderCounts = new Map<string, number>();

    for (const r of rows) {
      const subj = (r.subject ?? "").toLowerCase();
      const from = r.from ?? "";
      const key = from.split("<")[0].trim() || from;
      senderCounts.set(key, (senderCounts.get(key) ?? 0) + 1);

      let p: "high" | "medium" | "low" = "medium";
      if (
        /urgent|dringend|asap|wichtig|sofort/i.test(subj) ||
        /noreply|security|alert/i.test(from.toLowerCase())
      ) {
        p = "high";
      } else if (/newsletter|digest|unsubscribe/i.test(subj)) {
        p = "low";
      }
      const id = (r as { id?: string }).id;
      if (id) priorities[id] = p;
    }

    for (const [sender, n] of senderCounts) {
      if (n >= 3) {
        learningCandidates.push({
          kind: "email_sender_pattern",
          summary:
            `Häufiger Absender „${sender}“ (${n} ungelesen) — vermutlich wiederkehrendes Thema.`,
          source: "gmail_categorize",
          confidence: 0.6,
        });
      }
    }

    return {
      agentType: this.agentType,
      success: true,
      data: { priorities, sample_count: rows.length },
      learningCandidates,
      durationMs: elapsed(),
    };
  }
}
