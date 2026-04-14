import type { AgentContext } from "../agents/types.ts";
import { CalendarAgent } from "../agents/subagents/calendarAgent.ts";
import { SlackAgent } from "../agents/subagents/slackAgent.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient, LlmResponse } from "./llm/llmTypes.ts";
import { decrypt, getCredential } from "./tools/credentialHelper.ts";
import { gmailTool } from "./tools/gmailTool.ts";
import { notionTool } from "./tools/notionTool.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";
import type { ToolResult } from "./tools/types.ts";

const BRIEFING_MODEL = "claude-sonnet-4-20250514";
const USD_PER_INPUT_TOKEN = 0.000003;
const USD_PER_OUTPUT_TOKEN = 0.000015;

export const DEFAULT_SYSTEM_PROMPT =
  "Du bist ein präziser Chief of Staff. Du kommunizierst direkt und auf den Punkt.\n" +
  "Kein Bullshit, keine unnötigen Füllwörter. Deutsch.";

export function formatGermanDate(date: Date): string {
  const timeZone = "Europe/Berlin";
  const weekday = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    timeZone,
  }).format(date);
  const day = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    timeZone,
  }).format(date);
  const month = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    timeZone,
  }).format(date);
  const year = new Intl.DateTimeFormat("de-DE", {
    year: "numeric",
    timeZone,
  }).format(date);
  return `${weekday}, ${day}. ${month} ${year}`;
}

export type BriefingToolRunner = (
  params: unknown,
  userId: string,
  db: DatabaseClient,
) => Promise<ToolResult>;

export type BriefingServiceOptions = {
  notionRunner?: BriefingToolRunner;
  gmailRunner?: BriefingToolRunner;
  slackRunner?: BriefingToolRunner;
  calendarRunner?: BriefingToolRunner;
};

export type DailyBriefingAgentStep = {
  agent: string;
  task: Record<string, unknown>;
};

/**
 * Paralleler Orchestrierungs-Plan fürs Daily Briefing (Agent-Tasks, nicht Chat-Orchestrator).
 */
export function buildDailyBriefingSteps(params: {
  toolsEnabled: string[];
  contexts: Map<string, string>;
}): DailyBriefingAgentStep[] {
  const tools = params.toolsEnabled.length ? params.toolsEnabled : ["notion"];
  const m = params.contexts;
  const steps: DailyBriefingAgentStep[] = [];
  const notionDb = m.get("notion_database_id")?.trim();
  if (tools.includes("notion") && notionDb) {
    steps.push({ agent: "notion", task: { action: "get_today_tasks" } });
  }
  if (tools.includes("gmail")) {
    steps.push({
      agent: "gmail",
      task: { action: "list_unread", max_results: 10 },
    });
  }
  if (tools.includes("calendar") && m.get("google_connected") === "true") {
    steps.push({ agent: "calendar", task: { action: "get_today" } });
  }
  if (tools.includes("slack") && m.get("slack_connected") === "true") {
    steps.push({ agent: "slack", task: { action: "summarize_day" } });
  }
  return steps;
}

function firstName(fullName: string): string {
  const p = fullName.trim().split(/\s+/)[0];
  return p ?? fullName;
}

function contextsToMap(rows: { key: string; value: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.key, r.value);
  return m;
}

function buildBriefingAgentContext(
  userId: string,
  rows: { key: string; value: string }[],
  toolsEnabled: string[],
  systemPrompt: string,
): AgentContext {
  const tools = toolsEnabled.length ? toolsEnabled : ["notion"];
  return {
    userId,
    systemPrompt,
    userContexts: rows,
    userProfile: null,
    learnings: [],
    connectedTools: tools,
    recentHistory: [],
  };
}

export class BriefingService {
  private readonly notionRun: BriefingToolRunner;
  private readonly gmailRun: BriefingToolRunner;
  private readonly slackRun: BriefingToolRunner;
  private readonly calendarRun: BriefingToolRunner;

  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly toolExecutor: ToolExecutor,
    opts?: BriefingServiceOptions,
  ) {
    this.notionRun = opts?.notionRunner ??
      ((p, u, d) => notionTool.execute(p, u, d));
    this.gmailRun = opts?.gmailRunner ??
      ((p, u, d) => gmailTool.execute(p, u, d));
    this.slackRun = opts?.slackRunner ??
      ((p, u, d) => this.defaultSlackRunner(p, u, d));
    this.calendarRun = opts?.calendarRunner ??
      ((p, u, d) => this.defaultCalendarRunner(p, u, d));
  }

  private async defaultSlackRunner(
    _params: unknown,
    userId: string,
    d: DatabaseClient,
  ): Promise<ToolResult> {
    const cfg = await d.findAgentConfigForUser(userId);
    const system = (cfg?.system_prompt?.trim() ?? "")
      ? cfg!.system_prompt
      : DEFAULT_SYSTEM_PROMPT;
    const tools = cfg?.tools_enabled?.length ? cfg.tools_enabled : ["notion"];
    const rows = await d.listUserContexts(userId);
    const m = contextsToMap(rows);
    if (!tools.includes("slack") || m.get("slack_connected") !== "true") {
      return { success: false, error: "slack skipped" };
    }
    const enc = await getCredential(d, userId, "slack_access_token");
    if (!enc) return { success: false, error: "slack skipped" };
    try {
      await decrypt(enc);
    } catch {
      return { success: false, error: "slack skipped" };
    }
    const ctx = buildBriefingAgentContext(userId, rows, tools, system);
    const agent = new SlackAgent(this.llm, d, this.toolExecutor);
    const r = await agent.execute({ action: "summarize_day" }, ctx);
    if (!r.success) {
      return { success: false, error: r.error ?? "slack failed" };
    }
    return { success: true, data: r.data };
  }

  private async defaultCalendarRunner(
    _params: unknown,
    userId: string,
    d: DatabaseClient,
  ): Promise<ToolResult> {
    const cfg = await d.findAgentConfigForUser(userId);
    const system = (cfg?.system_prompt?.trim() ?? "")
      ? cfg!.system_prompt
      : DEFAULT_SYSTEM_PROMPT;
    const tools = cfg?.tools_enabled?.length ? cfg.tools_enabled : ["notion"];
    const rows = await d.listUserContexts(userId);
    const m = contextsToMap(rows);
    if (!tools.includes("calendar") || m.get("google_connected") !== "true") {
      return { success: false, error: "calendar skipped" };
    }
    const tok = await getCredential(d, userId, "gmail_access_token");
    if (!tok) return { success: false, error: "calendar skipped" };
    const ctx = buildBriefingAgentContext(userId, rows, tools, system);
    const agent = new CalendarAgent(this.llm, d, this.toolExecutor);
    const r = await agent.execute({ action: "get_today" }, ctx);
    if (!r.success) {
      return { success: false, error: r.error ?? "calendar failed" };
    }
    return { success: true, data: r.data };
  }

  async generateBriefing(userId: string): Promise<string> {
    const user = await this.db.findBriefingUser(userId);
    if (!user) {
      throw new Error(`User nicht gefunden oder inaktiv: ${userId}`);
    }

    const config = await this.db.findAgentConfigForUser(userId);
    const system = (config?.system_prompt?.trim() ?? "")
      ? config!.system_prompt
      : DEFAULT_SYSTEM_PROMPT;

    const contextRows = await this.db.listUserContexts(userId);
    const contexts = contextsToMap(contextRows);
    const notionDbId = contexts.get("notion_database_id")?.trim() ?? "";

    const notionP = notionDbId
      ? this.notionRun(
        { action: "get_today_tasks", database_id: notionDbId },
        userId,
        this.db,
      )
      : Promise.resolve({ success: false as const, error: "notion skipped" });

    const gmailP = this.gmailRun(
      { action: "list_unread", max_results: 10 },
      userId,
      this.db,
    );

    const slackP = this.slackRun({}, userId, this.db);
    const calendarP = this.calendarRun({}, userId, this.db);

    const settled = await Promise.allSettled([
      notionP,
      gmailP,
      calendarP,
      slackP,
    ]);

    const notionResult: ToolResult = settled[0]!.status === "fulfilled"
      ? settled[0]!.value
      : { success: false, error: String(settled[0]!.reason) };
    const gmailResult: ToolResult = settled[1]!.status === "fulfilled"
      ? settled[1]!.value
      : { success: false, error: String(settled[1]!.reason) };
    const calendarResult: ToolResult = settled[2]!.status === "fulfilled"
      ? settled[2]!.value
      : { success: false, error: String(settled[2]!.reason) };
    const slackResult: ToolResult = settled[3]!.status === "fulfilled"
      ? settled[3]!.value
      : { success: false, error: String(settled[3]!.reason) };

    const fn = firstName(user.name);
    const briefingPrompt =
      `
Heute ist ${formatGermanDate(new Date())}.

Erstelle ein präzises Daily Briefing für ${user.name}.

## Verfügbare Daten

### Notion Tasks (heute + hohe Priorität):
${
        notionResult.success
          ? JSON.stringify(notionResult.data, null, 2)
          : "Nicht verfügbar"
      }

### Ungelesene Emails (Top 10):
${
        gmailResult.success
          ? JSON.stringify(gmailResult.data, null, 2)
          : "Nicht verfügbar"
      }

### Kalender (heute, Europe/Berlin):
${
        calendarResult.success
          ? JSON.stringify(calendarResult.data, null, 2)
          : "Nicht verfügbar"
      }

### Slack (Tagesüberblick):
${
        slackResult.success
          ? JSON.stringify(slackResult.data, null, 2)
          : "Nicht verfügbar"
      }

### Persönlicher Kontext:
${
        Array.from(contexts.entries()).map(([k, v]) => `${k}: ${v}`).join(
          "\n",
        )
      }

## Ausgabeformat (exakt so):

## ☀️ Guten Morgen, ${fn}!

**Deine Top 3 für heute:**
1. [wichtigste Aufgabe]
2. [zweitwichtigste]
3. [drittwichtigste]

**Offene Tasks** (falls Notion-Daten vorhanden)
[max 5 Tasks, kompakt]

**Email-Triage** (falls Gmail-Daten vorhanden)
[max 3 Emails: Absender + Betreff + eine Zeile Kontext]

**Termine** (falls Kalender-Daten vorhanden)
[max 5 Termine, kompakt]

**Slack** (falls Slack-Daten vorhanden)
[kurz: wichtigste Kanäle / eigene Aktivität]

**Fokus heute:**
[1-2 Sätze strategischer Kontext — was ist der rote Faden des Tages]
`.trim();

    const t0 = performance.now();
    const response: LlmResponse = await this.llm.chat({
      model: BRIEFING_MODEL,
      system,
      messages: [{ role: "user", content: briefingPrompt }],
      metadata: { user_id: userId, source: "cos-briefing" },
    });
    const latencyMs = Math.round(performance.now() - t0);

    const costUsd =
      response.input_tokens * USD_PER_INPUT_TOKEN +
      response.output_tokens * USD_PER_OUTPUT_TOKEN;

    await this.db.insertLlmCall({
      userId,
      sessionId: null,
      model: BRIEFING_MODEL,
      inputTokens: response.input_tokens,
      outputTokens: response.output_tokens,
      costUsd,
      latencyMs,
    });

    return response.content;
  }
}
