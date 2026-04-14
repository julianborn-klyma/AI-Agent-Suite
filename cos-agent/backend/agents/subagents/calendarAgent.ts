import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

export class CalendarAgent extends BaseSubAgent {
  readonly agentType = "calendar";
  readonly description = "Google Kalender: heute, Woche, Meeting-Vorbereitung, freie Slots";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("calendar")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "calendar nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const kind = String(task.action ?? task.task ?? "get_today");

    try {
      if (kind === "get_today") {
        const r = await this.toolExecutor.execute(
          "calendar",
          { action: "get_today_events" },
          context.userId,
          this.db,
        );
        return {
          agentType: this.agentType,
          success: r.success,
          data: r.data,
          error: r.error,
          durationMs: elapsed(),
        };
      }
      if (kind === "get_week") {
        const r = await this.toolExecutor.execute(
          "calendar",
          { action: "get_week_events" },
          context.userId,
          this.db,
        );
        return {
          agentType: this.agentType,
          success: r.success,
          data: r.data,
          error: r.error,
          durationMs: elapsed(),
        };
      }
      if (kind === "find_slots") {
        const date = String(task.date ?? "");
        const dur = Number(task.duration_minutes ?? 30);
        if (!date) {
          return {
            agentType: this.agentType,
            success: false,
            error: "date fehlt.",
            durationMs: elapsed(),
          };
        }
        const r = await this.toolExecutor.execute(
          "calendar",
          {
            action: "find_free_slots",
            date,
            duration_minutes: dur,
          },
          context.userId,
          this.db,
        );
        return {
          agentType: this.agentType,
          success: r.success,
          data: r.data,
          error: r.error,
          durationMs: elapsed(),
        };
      }
      if (kind === "prepare_meeting") {
        return await this.runPrepareMeeting(task, context, elapsed);
      }
      return {
        agentType: this.agentType,
        success: false,
        error: `Unbekannte Calendar-Task: ${kind}`,
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

  private async runPrepareMeeting(
    task: Record<string, unknown>,
    context: AgentContext,
    elapsed: () => number,
  ): Promise<SubAgentResult> {
    const eventsRes = await this.toolExecutor.execute(
      "calendar",
      { action: "get_today_events" },
      context.userId,
      this.db,
    );
    const agendaHint = String(task.agenda_hint ?? task.topic ?? "");
    const participants = Array.isArray(task.participants)
      ? (task.participants as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const prep = await this.callLlm({
      systemPrompt:
        "Bereite ein Meeting knapp vor: Teilnehmer, vermutliche Agenda aus Kalenderdaten. Deutsch, sachlich.",
      userMessage:
        `Kalender heute:\n${JSON.stringify(eventsRes.data ?? {}, null, 2)}\n` +
        `Teilnehmer-Hinweis: ${participants.join(", ")}\n` +
        `Agenda-Kontext: ${agendaHint}`,
      context,
    });
    return {
      agentType: this.agentType,
      success: true,
      data: { preparation: prep, calendar_ok: eventsRes.success },
      durationMs: elapsed(),
    };
  }
}
