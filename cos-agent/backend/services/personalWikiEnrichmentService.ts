import { parseJsonObject } from "../agents/jsonUtils.ts";
import { MODEL_IDS } from "../agents/modelSelector.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import type { LlmClient } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";
import {
  canAutoApprovePersonalWikiPage,
  isPersonalWikiSlug,
  PERSONAL_WIKI_SLUGS,
} from "./personalWikiConstants.ts";
import { ensurePersonalWikiPages } from "./personalWikiSeed.ts";
import { withWorkspaceTx } from "./workspaceService.ts";
import {
  getWikiPageBySlug,
  patchWikiPage,
} from "./workspaceWikiService.ts";
import type postgres from "postgres";

type Sql = postgres.Sql;

async function sha256HexShort(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  ).slice(0, 24);
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export type PersonalWikiEnrichmentResult = {
  skipped: boolean;
  reason?: string;
  patches_applied?: number;
  day_key: string;
};

export class PersonalWikiEnrichmentService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly sql: Sql,
    private readonly llm: LlmClient,
    private readonly _toolExecutor: ToolExecutor,
  ) {
    void this._toolExecutor;
  }

  async runForUser(userId: string): Promise<PersonalWikiEnrichmentResult> {
    const dayKey = utcDayKey();
    const rows = await this.db.listUserContexts(userId);
    const ctx = new Map(rows.map((r) => [r.key, r.value]));
    const emailSummary = ctx.get(`email_summary_${dayKey}`)?.trim() ?? "";
    const slackSummary = ctx.get(`slack_summary_${dayKey}`)?.trim() ?? "";
    const reflection = ctx.get(`daily_reflection_${dayKey}`)?.trim() ?? "";

    const learnings = await this.db.getLearnings(userId, {
      activeOnly: true,
      limit: 40,
      minConfidence: 0.55,
    });
    const learningLines = learnings.map((l) =>
      `- [${l.category}] ${l.content.slice(0, 500)}`
    ).join("\n");

    const signalBlob = JSON.stringify({
      day: dayKey,
      email: emailSummary.slice(0, 12_000),
      slack: slackSummary.slice(0, 12_000),
      reflection: reflection.slice(0, 8000),
      learnings: learningLines.slice(0, 12_000),
    });
    const fingerprint = await sha256HexShort(signalBlob);
    const fpKey = `personal_wiki_fp_${dayKey}`;
    const prevFp = ctx.get(fpKey)?.trim() ?? "";
    if (prevFp === fingerprint) {
      return { skipped: true, reason: "unchanged_fingerprint", day_key: dayKey };
    }

    if (
      !emailSummary && !slackSummary && !reflection && !learningLines.trim()
    ) {
      return { skipped: true, reason: "no_signals", day_key: dayKey };
    }

    const r = await withWorkspaceTx(this.sql, userId, async (tx, tenantId) => {
      await ensurePersonalWikiPages(tx, tenantId, userId);

      const system =
        "Du bist ein Assistent für ein persönliches Wiki (nur der/die Nutzer:in sieht es). " +
        "Antworte NUR mit JSON (kein Markdown außerhalb). Form: " +
        '{"patches":[{"slug":"me-kommunikation","append_markdown":"..."}]}. ' +
        "Erlaubte slug-Werte exakt: " +
        PERSONAL_WIKI_SLUGS.join(", ") +
        ". Verteile Inhalte sinnvoll: Kommunikation → me-kommunikation, Entscheidungen → me-entscheidungen, " +
        "Learnings/Reflexion → me-lernen, Allgemeines → me-index. " +
        "Jeder append_markdown: kurz, stichpunktartig, deutsch, keine Zitate voller E-Mails, keine Geheimnisse/Token. " +
        "Wenn nichts Sinnvolles: patches: [].";

      const userPrompt =
        `Kalendertag (UTC): ${dayKey}\n\n` +
        `E-Mail-Tageszusammenfassung (falls vorhanden):\n${
          emailSummary || "(leer)"
        }\n\nSlack-Tageszusammenfassung (falls vorhanden):\n${
          slackSummary || "(leer)"
        }\n\nDaily-Reflexion (falls vorhanden):\n${
          reflection || "(leer)"
        }\n\nAktive Learnings (Auszug):\n${
          learningLines || "(keine)"
        }\n\nErzeuge JSON mit patches.`;

      const res = await this.llm.chat({
        model: MODEL_IDS.haiku,
        system,
        messages: [{ role: "user", content: userPrompt }],
        metadata: { user_id: userId, source: "cos-personal-wiki-enrich" },
      });

      const parsed = parseJsonObject<{ patches?: unknown }>(res.content ?? "");
      const rawPatches = parsed && Array.isArray(parsed.patches)
        ? parsed.patches
        : null;
      if (rawPatches === null) {
        return -1;
      }

      let applied = 0;
      const maxAppend = 6000;
      for (const raw of rawPatches) {
        if (raw === null || typeof raw !== "object") continue;
        const o = raw as Record<string, unknown>;
        const slug = typeof o.slug === "string" ? o.slug.trim() : "";
        const md = typeof o.append_markdown === "string"
          ? o.append_markdown.trim()
          : "";
        if (!slug || !md || !isPersonalWikiSlug(slug)) continue;
        const page = await getWikiPageBySlug(tx, slug);
        if (!page) continue;
        if (
          !canAutoApprovePersonalWikiPage({
            slug: page.slug,
            scope_audience: page.scope_audience,
            owner_user_id: page.owner_user_id,
            editorUserId: userId,
          })
        ) {
          continue;
        }
        const addition = `\n\n---\n*Automatisch ${dayKey}*\n\n` +
          md.slice(0, maxAppend);
        const newBody = `${page.body_md}${addition}`.slice(0, 120_000);
        const patched = await patchWikiPage(tx, tenantId, page.id, userId, {
          body_md: newBody,
          status: "approved",
        });
        if (patched && !("error" in patched)) applied++;
      }

      await this.db.upsertUserContext({
        userId,
        key: fpKey,
        value: fingerprint,
      });

      return applied;
    });

    if (!r.ok) {
      return {
        skipped: true,
        reason: r.message,
        day_key: dayKey,
      };
    }

    if (r.value === -1) {
      return {
        skipped: true,
        reason: "llm_json_invalid",
        day_key: dayKey,
      };
    }

    return {
      skipped: false,
      patches_applied: r.value,
      day_key: dayKey,
    };
  }
}
