import { CHAT_MODEL } from "../agents/constants.ts";
import { parseJsonArray } from "../agents/jsonUtils.ts";
import type { LearningCandidate, SubAgentResult } from "../agents/types.ts";
import type { DatabaseClient, Learning } from "../db/databaseClient.ts";
import type { LlmClient } from "./llm/llmTypes.ts";

const CATEGORY_ORDER = [
  "decision_pattern",
  "priority",
  "relationship",
  "project",
  "preference",
  "commitment",
  "financial",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  decision_pattern: "Entscheidungsmuster",
  priority: "Prioritäten",
  relationship: "Beziehungen",
  project: "Projekte",
  preference: "Präferenzen",
  commitment: "Commitments",
  financial: "Finanzen",
};

export class LearningService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
  ) {}

  async extractFromConversation(params: {
    userId: string;
    sessionId: string;
    messages: Array<{ role: string; content: string }>;
    agentResults?: SubAgentResult[];
  }): Promise<LearningCandidate[]> {
    const tail = params.messages.slice(-10);
    if (tail.length === 0) {
      return [];
    }

    const agentPart = params.agentResults?.length
      ? `\nSub-Agent-Ergebnisse (Kurz):\n${
        JSON.stringify(
          params.agentResults.map((r) => ({
            agent: r.agentType,
            ok: r.success,
            data: r.data,
            error: r.error,
          })),
          null,
          0,
        )
      }`
      : "";

    const res = await this.llm.chat({
      model: CHAT_MODEL,
      system:
        "Du extrahierst strukturierte Erkenntnisse über eine Person aus Konversationen. " +
        "Antworte NUR mit einem JSON-Array (kein Markdown). " +
        "Jedes Element: { \"category\": string, \"content\": string, \"confidence\": number, \"source\": \"chat\" }. " +
        "Kategorien (nur diese verwenden): decision_pattern | priority | relationship | project | preference | commitment | financial. " +
        "Keine erfundenen Fakten — nur was aus den Nachrichten oder Agent-Ergebnissen belegbar ist.",
      messages: [
        {
          role: "user",
          content:
            `Letzte Nachrichten:\n${
              JSON.stringify(tail)
            }${agentPart}\n\nGib ein JSON-Array zurück (leer [] wenn nichts Verlässliches).`,
        },
      ],
      metadata: { user_id: params.userId, source: "cos-agent-learning" },
    });

    const arr = parseJsonArray(res.content ?? "");
    if (!arr?.length) return [];

    const out: LearningCandidate[] = [];
    for (const raw of arr) {
      if (raw === null || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const category = typeof o.category === "string" ? o.category.trim() : "";
      const content = typeof o.content === "string" ? o.content.trim() : "";
      if (!category || !content) continue;
      const conf = typeof o.confidence === "number" && Number.isFinite(o.confidence)
        ? Math.min(1, Math.max(0, o.confidence))
        : 0.8;
      const source = typeof o.source === "string" ? o.source : "chat";
      out.push({
        category,
        kind: category,
        content,
        summary: content,
        source,
        confidence: conf,
      });
    }
    return out;
  }

  async consolidateWeekly(userId: string): Promise<void> {
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const rows = await this.db.getLearnings(userId, {
      activeOnly: true,
      limit: 500,
      since,
    });

    const byCat = new Map<string, Learning[]>();
    for (const r of rows) {
      const list = byCat.get(r.category) ?? [];
      list.push(r);
      byCat.set(r.category, list);
    }

    for (const [category, list] of byCat) {
      if (list.length === 0) continue;
      const lines = list.map((l) => `- (${l.times_confirmed}×) ${l.content}`);
      const res = await this.llm.chat({
        model: CHAT_MODEL,
        system:
          "Fasse die folgenden Erkenntnisse einer Person zu EINEM knappen Absatz auf Deutsch zusammen. " +
          "Keine Aufzählung von Einzeldaten die du nicht vereinheitlichen kannst — lieber ein kohärenter Überblick.",
        messages: [
          {
            role: "user",
            content: `Kategorie: ${category}\n\n${lines.join("\n")}`,
          },
        ],
        metadata: { user_id: userId, source: "cos-agent-learning-weekly" },
      });
      const summary = (res.content ?? "").trim();
      if (summary) {
        await this.db.upsertUserContext({
          userId,
          key: `learning_summary_${category}`,
          value: summary,
        });
      }
    }

    await this.db.bulkConfirmLearningsByTimesConfirmed(userId, 3);
  }

  async buildLearningContext(userId: string): Promise<string> {
    const rows = await this.db.getLearnings(userId, {
      activeOnly: true,
      limit: 80,
      minConfidence: 0.6,
    });
    if (rows.length === 0) return "";

    const byCat = new Map<string, Learning[]>();
    for (const r of rows) {
      const list = byCat.get(r.category) ?? [];
      list.push(r);
      byCat.set(r.category, list);
    }
    for (const [cat, list] of byCat) {
      list.sort((a, b) => b.times_confirmed - a.times_confirmed);
      byCat.set(cat, list.slice(0, 3));
    }

    const parts: string[] = ["## Was ich über dich weiß"];
    const orderedCats = [
      ...CATEGORY_ORDER.filter((c) => (byCat.get(c)?.length ?? 0) > 0),
      ...[...byCat.keys()].filter((c) =>
        !(CATEGORY_ORDER as readonly string[]).includes(c)
      ),
    ];
    const seen = new Set<string>();
    for (const cat of orderedCats) {
      if (seen.has(cat)) continue;
      seen.add(cat);
      const list = byCat.get(cat) ?? [];
      if (list.length === 0) continue;
      const label = CATEGORY_LABELS[cat] ?? cat;
      const body = list.map((l) => `• ${l.content}`).join("\n");
      parts.push(`**${label}:**\n${body}`);
    }

    return parts.length > 1 ? parts.join("\n\n") : "";
  }
}
