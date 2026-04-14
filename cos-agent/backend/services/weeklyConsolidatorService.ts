import { CHAT_MODEL } from "../agents/constants.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient } from "./llm/llmTypes.ts";
import { LearningService } from "./learningService.ts";

function isoWeekKey(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    (((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7,
  );
  return { year: t.getUTCFullYear(), week: weekNo };
}

export class WeeklyConsolidatorService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly learningService: LearningService,
  ) {}

  async consolidate(userId: string): Promise<void> {
    const since = new Date(Date.now() - 7 * 86400000);
    const learnings = await this.db.getLearnings(userId, {
      activeOnly: true,
      since,
      limit: 200,
    });
    const contexts = await this.db.listUserContexts(userId);
    const summaries = contexts.filter((c) =>
      c.key.startsWith("email_summary_") || c.key.startsWith("slack_summary_")
    );
    const convo = await this.db.listConversationMessagesForUserSince(
      userId,
      since,
      50,
    );
    const profile = await this.db.findUserProfileById(userId);
    const name = profile?.name ?? "User";

    let text = "";
    try {
      const res = await this.llm.chat({
        model: CHAT_MODEL,
        system:
          "Du verdichtest Wocheninformationen auf Deutsch, strukturiert, max. 500 Wörter.",
        messages: [{
          role: "user",
          content:
            `Verdichte diese Woche für ${name}:\n- Was waren die wichtigsten Entscheidungen?\n- Welche Prioritäten haben sich verändert?\n- Welche Commitments wurden gemacht?\n- Was läuft gut, was ist ein Risiko?\n\nLearnings (7 Tage):\n${
              JSON.stringify(learnings.map((l) => l.content), null, 2)
            }\n\nDaily Summaries:\n${
              JSON.stringify(summaries, null, 2)
            }\n\nChat (Auszug):\n${
              JSON.stringify(
                convo.map((m) => ({ role: m.role, t: m.content.slice(0, 400) })),
                null,
                2,
              )
            }`,
        }],
        metadata: { user_id: userId, source: "cos-weekly-consolidate" },
      });
      text = (res.content ?? "").trim();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          component: "weeklyConsolidator",
          userId,
          event: "llm_failed",
          error: msg,
        }),
      );
    }
    const { year, week } = isoWeekKey(new Date());
    await this.db.upsertUserContext({
      userId,
      key: `weekly_summary_${year}_w${week}`,
      value: text,
    });

    await this.db.bulkConfirmLearningsByTimesConfirmed(userId, 3);
    await this.db.purgeUserContextSummariesOlderThan(userId, [
      "email_summary_",
      "slack_summary_",
    ], 14);
    await this.db.purgeUserConversationsOlderThan(userId, 30);
    void this.learningService; // reserviert für künftige Learning-Pipeline
  }
}
