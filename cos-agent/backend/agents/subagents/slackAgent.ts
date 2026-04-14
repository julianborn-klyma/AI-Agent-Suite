import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, LearningCandidate, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

function ctxValue(rows: { key: string; value: string }[], key: string): string {
  return rows.find((r) => r.key === key)?.value ?? "";
}

export class SlackAgent extends BaseSubAgent {
  readonly agentType = "slack";
  readonly description = "Slack-Zusammenfassung, Kontextsuche, Entscheidungen";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("slack")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "slack nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const kind = String(task.action ?? task.task ?? "summarize_day");

    try {
      if (kind === "summarize_day") {
        return await this.runSummarizeDay(context, elapsed);
      }
      if (kind === "get_context") {
        return await this.runGetContext(task, context, elapsed);
      }
      if (kind === "extract_decisions") {
        return await this.runExtractDecisions(task, context, elapsed);
      }
      return {
        agentType: this.agentType,
        success: false,
        error: `Unbekannte Slack-Task: ${kind}`,
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

  private async runSummarizeDay(
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const listRes = await this.toolExecutor.execute(
      "slack",
      { action: "list_channels" },
      context.userId,
      this.db,
    );
    const myRes = await this.toolExecutor.execute(
      "slack",
      { action: "get_my_messages", limit: 25 },
      context.userId,
      this.db,
    );
    if (!listRes.success && !myRes.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: listRes.error ?? myRes.error,
        durationMs: elapsed(),
      };
    }
    const summary = await this.callLlm({
      systemPrompt:
        "Du fasst Slack-Aktivität des Tages knapp auf Deutsch (Kanäle + eigene Nachrichten). Nur aus den JSON-Daten, keine Erfindungen.",
      userMessage: `Kanäle:\n${
        JSON.stringify(listRes.data ?? {}, null, 2)
      }\n\nMeine Nachrichten:\n${JSON.stringify(myRes.data ?? {}, null, 2)}`,
      context,
    });
    return {
      agentType: this.agentType,
      success: true,
      data: { summary, raw: { channels: listRes.data, mine: myRes.data } },
      durationMs: elapsed(),
    };
  }

  private async runGetContext(
    task: Record<string, unknown>,
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const topic = String(task.topic ?? task.query ?? "");
    if (!topic) {
      return {
        agentType: this.agentType,
        success: false,
        error: "topic oder query fehlt.",
        durationMs: elapsed(),
      };
    }
    const searchRes = await this.toolExecutor.execute(
      "slack",
      { action: "search_messages", query: topic, limit: 15 },
      context.userId,
      this.db,
    );
    if (!searchRes.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: searchRes.error,
        durationMs: elapsed(),
      };
    }
    return {
      agentType: this.agentType,
      success: true,
      data: searchRes.data,
      durationMs: elapsed(),
    };
  }

  private async runExtractDecisions(
    task: Record<string, unknown>,
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const channelId = String(
      task.channel_id ?? ctxValue(context.userContexts, "slack_default_channel_id"),
    );
    if (!channelId) {
      return {
        agentType: this.agentType,
        success: false,
        error: "channel_id fehlt.",
        durationMs: elapsed(),
      };
    }
    const hist = await this.toolExecutor.execute(
      "slack",
      {
        action: "get_channel_history",
        channel_id: channelId,
        limit: 80,
      },
      context.userId,
      this.db,
    );
    if (!hist.success) {
      return {
        agentType: this.agentType,
        success: false,
        error: hist.error,
        durationMs: elapsed(),
      };
    }
    const learningCandidates: LearningCandidate[] = [];
    const msgs = (hist.data as { messages?: { text?: string; user?: string }[] })
      ?.messages ?? [];
    for (const m of msgs) {
      const t = String(m.text ?? "");
      if (t.length > 120 && /entscheid|decision|go\b|billig|freigabe/i.test(t)) {
        learningCandidates.push({
          kind: "decision_pattern",
          category: "decision_pattern",
          summary: "Mögliche Team-Entscheidung im Channel-Verlauf.",
          content: t.slice(0, 400),
          source: "slack_extract_decisions",
          confidence: 0.55,
        });
      }
    }
    const digest = await this.callLlm({
      systemPrompt:
        "Liste knapp vermutliche Entscheidungen aus Slack-JSON (Deutsch). Wenn unsicher: „unklar“.",
      userMessage: JSON.stringify(hist.data, null, 2),
      context,
    });
    return {
      agentType: this.agentType,
      success: true,
      data: { decisions_digest: digest, message_sample: msgs.length },
      learningCandidates,
      durationMs: elapsed(),
    };
  }
}
