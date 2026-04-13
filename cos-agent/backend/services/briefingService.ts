import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient, LlmResponse } from "./llm/llmTypes.ts";
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
};

function firstName(fullName: string): string {
  const p = fullName.trim().split(/\s+/)[0];
  return p ?? fullName;
}

function contextsToMap(rows: { key: string; value: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.key, r.value);
  return m;
}

export class BriefingService {
  private readonly notionRun: BriefingToolRunner;
  private readonly gmailRun: BriefingToolRunner;

  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    _toolExecutor: ToolExecutor,
    opts?: BriefingServiceOptions,
  ) {
    this.notionRun = opts?.notionRunner ??
      ((p, u, d) => notionTool.execute(p, u, d));
    this.gmailRun = opts?.gmailRunner ??
      ((p, u, d) => gmailTool.execute(p, u, d));
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

    const settled = await Promise.allSettled([notionP, gmailP]);

    const notionResult: ToolResult = settled[0]!.status === "fulfilled"
      ? settled[0]!.value
      : { success: false, error: String(settled[0]!.reason) };
    const gmailResult: ToolResult = settled[1]!.status === "fulfilled"
      ? settled[1]!.value
      : { success: false, error: String(settled[1]!.reason) };

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
