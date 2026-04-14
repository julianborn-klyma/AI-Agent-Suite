import { CHAT_MODEL } from "../agents/constants.ts";
import type { LearningCandidate } from "../agents/types.ts";
import { parseJsonArray } from "../agents/jsonUtils.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";
import type { EmailStyleService } from "./emailStyleService.ts";

export type EmailCategorizationResult = {
  total: number;
  urgent: number;
  reply_needed: number;
  fyi: number;
  junk: number;
  drafts_created: number;
  notion_page_created: boolean;
};

type CatRow = {
  message_id: string;
  subject: string;
  from: string;
  category: string;
  reason: string;
  draft_needed?: boolean;
  snippet?: string;
};

function extractEmail(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  if (m) return m[1]!.trim();
  if (from.includes("@")) return from.trim();
  return "";
}

export class EmailCategorizationService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly toolExecutor: ToolExecutor,
    private readonly emailStyleService: EmailStyleService,
  ) {}

  async categorizeEmails(userId: string): Promise<EmailCategorizationResult> {
    const listRes = await this.toolExecutor.execute(
      "gmail",
      { action: "list_unread", max_results: 20 },
      userId,
      this.db,
    );
    if (!listRes.success) {
      return {
        total: 0,
        urgent: 0,
        reply_needed: 0,
        fyi: 0,
        junk: 0,
        drafts_created: 0,
        notion_page_created: false,
      };
    }

    const profile = await this.db.findUserProfileById(userId);
    const userName = profile?.name ?? "User";
    const rows = (listRes.data ?? []) as {
      id: string;
      subject: string;
      from: string;
      snippet: string;
    }[];

    const batches: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += 5) {
      batches.push(rows.slice(i, i + 5));
    }

    const allCats: CatRow[] = [];
    for (const batch of batches) {
      const res = await this.llm.chat({
        model: CHAT_MODEL,
        system:
          `Kategorisiere diese Emails für ${userName}. Antworte NUR mit JSON-Array von Objekten mit Feldern: message_id, subject, from, category, reason, draft_needed (boolean). Kategorien: urgent, reply_needed, fyi, junk. draft_needed true nur wenn category=urgent und eine sinnvolle Antwort möglich ist.`,
        messages: [{
          role: "user",
          content: JSON.stringify(batch, null, 2),
        }],
        metadata: { user_id: userId, source: "cos-email-categorize" },
      });
      const arr = parseJsonArray(res.content ?? "");
      if (!arr) continue;
      for (const x of arr) {
        if (!x || typeof x !== "object") continue;
        const o = x as Record<string, unknown>;
        allCats.push({
          message_id: String(o.message_id ?? ""),
          subject: String(o.subject ?? ""),
          from: String(o.from ?? ""),
          category: String(o.category ?? "fyi"),
          reason: String(o.reason ?? ""),
          draft_needed: Boolean(o.draft_needed),
        });
      }
    }

    const rowById = new Map(rows.map((r) => [r.id, r]));
    for (const c of allCats) {
      const hit = rowById.get(c.message_id);
      if (hit) c.snippet = hit.snippet;
    }

    let drafts = 0;
    for (const c of allCats) {
      if (c.category !== "urgent" || !c.draft_needed) continue;
      const to = extractEmail(c.from);
      if (!to) continue;
      const dr = await this.emailStyleService.createStyledDraft({
        userId,
        inReplyTo: {
          message_id: c.message_id,
          from: c.from,
          subject: c.subject,
          body: c.snippet ?? "",
        },
        context: "Dringende Antwort nötig",
      });
      if (dr.success) drafts++;
    }

    const ctxRows = await this.db.listUserContexts(userId);
    const hasNotion = ctxRows.some((r) =>
      r.key === "notion_connected" && r.value === "true"
    );
    const notionPage = false;
    void hasNotion;

    const dateKey = new Date().toISOString().slice(0, 10);
    const urgent = allCats.filter((c) => c.category === "urgent").length;
    const reply_needed = allCats.filter((c) => c.category === "reply_needed").length;
    const fyi = allCats.filter((c) => c.category === "fyi").length;
    const junk = allCats.filter((c) => c.category === "junk").length;
    const summary =
      `${urgent} urgent, ${reply_needed} reply_needed, ${fyi} fyi, ${junk} junk`;
    await this.db.upsertUserContext({
      userId,
      key: `email_summary_${dateKey}`,
      value: summary,
    });
    await this.db.upsertUserContext({
      userId,
      key: `email_triage_${dateKey}`,
      value: JSON.stringify(allCats),
    });

    const learnRes = await this.llm.chat({
      model: CHAT_MODEL,
      system:
        "Antworte NUR mit JSON-Array von {category, content, confidence}. Max 4. Kategorien: preference, decision_pattern. Deutsch.",
      messages: [{
        role: "user",
        content: `Email-Kategorien-Statistik:\n${summary}\nBeispiele:\n${
          JSON.stringify(allCats.slice(0, 6), null, 2)
        }`,
      }],
      metadata: { user_id: userId, source: "cos-email-learning-candidates" },
    });
    const lc = parseJsonArray(learnRes.content ?? "");
    const candidates: LearningCandidate[] = [];
    if (lc) {
      for (const x of lc) {
        if (!x || typeof x !== "object") continue;
        const o = x as Record<string, unknown>;
        const content = String(o.content ?? "").trim();
        if (!content) continue;
        candidates.push({
          category: String(o.category ?? "preference"),
          content,
          source: "email_categorization",
          confidence: typeof o.confidence === "number" ? o.confidence : 0.6,
        });
      }
    }
    if (candidates.length) await this.db.upsertLearnings(userId, candidates);

    return {
      total: allCats.length,
      urgent,
      reply_needed,
      fyi,
      junk,
      drafts_created: drafts,
      notion_page_created: notionPage,
    };
  }
}
