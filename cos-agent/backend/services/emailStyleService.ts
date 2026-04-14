import { CHAT_MODEL } from "../agents/constants.ts";
import { parseJsonObject } from "../agents/jsonUtils.ts";
import type { DatabaseClient, Learning } from "../db/databaseClient.ts";
import type { LlmClient } from "./llm/llmTypes.ts";
import type { ToolExecutor } from "./tools/toolExecutor.ts";

export type EmailStyleAvgLength = "very_short" | "short" | "medium" | "long";
export type EmailStyleTone = "very_direct" | "direct" | "neutral" | "formal";

export interface EmailStyle {
  greeting: string;
  closing: string;
  avg_length: EmailStyleAvgLength;
  tone: EmailStyleTone;
  smalltalk: boolean;
  bullet_points: boolean;
  style_by_recipient: {
    colleagues: string;
    customers: string;
    unknown: string;
  };
  signature: string;
  examples: string[];
}

export interface EmailStyleLearning {
  learned: boolean;
  style?: EmailStyle;
  emails_analyzed: number;
  reason?: string;
}

export interface StyledDraftResult {
  success: boolean;
  draft_id?: string;
  preview: string;
  style_used: boolean;
  recipient_type: string;
}

type SentEmailRow = {
  id: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  char_count: number;
};

function extractEmail(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  if (m) return m[1]!.trim();
  if (from.includes("@")) return from.trim();
  return "";
}

function extractDomain(addr: string): string | null {
  const e = extractEmail(addr).toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0 || at === e.length - 1) return null;
  return e.slice(at + 1);
}

function defaultEmailStyle(): EmailStyle {
  return {
    greeting: "Hallo",
    closing: "Viele Grüße",
    avg_length: "short",
    tone: "neutral",
    smalltalk: false,
    bullet_points: false,
    style_by_recipient: {
      colleagues: "Sachlich und direkt.",
      customers: "Höflich und klar.",
      unknown: "Neutral-professionell.",
    },
    signature: "",
    examples: ["Kurz und auf den Punkt kommende Formulierungen."],
  };
}

function isAvgLength(x: string): x is EmailStyleAvgLength {
  return x === "very_short" || x === "short" || x === "medium" || x === "long";
}

function isTone(x: string): x is EmailStyleTone {
  return x === "very_direct" || x === "direct" || x === "neutral" || x === "formal";
}

function coerceStyle(raw: Record<string, unknown> | null): EmailStyle {
  const d = defaultEmailStyle();
  if (!raw) return d;

  const greeting = typeof raw.greeting === "string" && raw.greeting.trim()
    ? raw.greeting.trim()
    : d.greeting;
  const closing = typeof raw.closing === "string" && raw.closing.trim()
    ? raw.closing.trim()
    : d.closing;
  const al = typeof raw.avg_length === "string" && isAvgLength(raw.avg_length)
    ? raw.avg_length
    : d.avg_length;
  const tone = typeof raw.tone === "string" && isTone(raw.tone)
    ? raw.tone
    : d.tone;
  const smalltalk = typeof raw.smalltalk === "boolean" ? raw.smalltalk : d.smalltalk;
  const bullet_points = typeof raw.bullet_points === "boolean"
    ? raw.bullet_points
    : d.bullet_points;

  let sbr = d.style_by_recipient;
  const sbrRaw = raw.style_by_recipient;
  if (sbrRaw && typeof sbrRaw === "object" && !Array.isArray(sbrRaw)) {
    const o = sbrRaw as Record<string, unknown>;
    sbr = {
      colleagues: typeof o.colleagues === "string" && o.colleagues.trim()
        ? o.colleagues.trim()
        : d.style_by_recipient.colleagues,
      customers: typeof o.customers === "string" && o.customers.trim()
        ? o.customers.trim()
        : d.style_by_recipient.customers,
      unknown: typeof o.unknown === "string" && o.unknown.trim()
        ? o.unknown.trim()
        : d.style_by_recipient.unknown,
    };
  }

  const signature = typeof raw.signature === "string" ? raw.signature.trim() : d.signature;

  let examples: string[] = d.examples;
  if (Array.isArray(raw.examples)) {
    const ex = raw.examples
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim());
    if (ex.length) examples = ex.slice(0, 5);
  }

  return {
    greeting,
    closing,
    avg_length: al,
    tone,
    smalltalk,
    bullet_points,
    style_by_recipient: sbr,
    signature,
    examples,
  };
}

function styleToReadableText(style: EmailStyle): string {
  return `
Anrede: ${style.greeting}
Abschluss: ${style.closing}
Typische Länge: ${style.avg_length}
Ton: ${style.tone}
Smalltalk: ${style.smalltalk ? "ja" : "nein"}
Aufzählungen: ${style.bullet_points ? "ja" : "nein"}
Bei Kollegen: ${style.style_by_recipient.colleagues}
Bei Kunden: ${style.style_by_recipient.customers}
Bei unbekannten: ${style.style_by_recipient.unknown}
Beispiele: ${style.examples.join(" | ")}
`.trim();
}

function recipientKind(
  userEmail: string | undefined,
  fromHeader: string,
  relationshipRows: { content: string }[],
): "colleague" | "customer" | "unknown" {
  const userDom = userEmail ? extractDomain(userEmail) : null;
  const fromDom = extractDomain(fromHeader);
  if (userDom && fromDom && userDom === fromDom) return "colleague";

  const fromAddr = extractEmail(fromHeader).toLowerCase();
  const fromDomLower = fromDom?.toLowerCase() ?? "";

  for (const r of relationshipRows) {
    const c = r.content.toLowerCase();
    if (fromAddr && c.includes(fromAddr)) {
      if (/kunde|customer|mandant|client/i.test(c)) return "customer";
    }
    if (
      fromDomLower && c.includes(fromDomLower) &&
      /kunde|customer|mandant|client/i.test(c)
    ) {
      return "customer";
    }
  }

  return "unknown";
}

function relationshipSnippet(
  relationshipRows: { content: string }[],
  fromHeader: string,
): string {
  const fromAddr = extractEmail(fromHeader).toLowerCase();
  const local = fromAddr.split("@")[0] ?? "";
  for (const r of relationshipRows) {
    const c = r.content;
    const cl = c.toLowerCase();
    if (fromAddr && cl.includes(fromAddr)) return c;
    if (local.length > 2 && cl.includes(local)) return c;
  }
  return "";
}

function recipientLabel(kind: "colleague" | "customer" | "unknown"): string {
  if (kind === "colleague") return "Kollege";
  if (kind === "customer") return "Kunde";
  return "unbekannt";
}

function styleHintForRecipient(style: EmailStyle, kind: "colleague" | "customer" | "unknown"): string {
  if (kind === "colleague") return style.style_by_recipient.colleagues;
  if (kind === "customer") return style.style_by_recipient.customers;
  return style.style_by_recipient.unknown;
}

export class EmailStyleService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  async learnEmailStyle(userId: string): Promise<EmailStyleLearning> {
    const sent = await this.toolExecutor.execute(
      "gmail",
      { action: "get_sent_emails", limit: 40 },
      userId,
      this.db,
    );

    if (!sent.success) {
      return { learned: false, emails_analyzed: 0 };
    }

    const emails = (sent.data ?? []) as SentEmailRow[];
    if (emails.length < 5) {
      return {
        learned: false,
        reason: "Zu wenige gesendete Emails",
        emails_analyzed: emails.length,
      };
    }

    const block = emails.map((e) =>
      `An: ${e.to}\nBetreff: ${e.subject}\n${e.body}`
    ).join("\n---\n");

    const schemaHint = `{
  "greeting": string,
  "closing": string,
  "avg_length": "very_short" | "short" | "medium" | "long",
  "tone": "very_direct" | "direct" | "neutral" | "formal",
  "smalltalk": boolean,
  "bullet_points": boolean,
  "style_by_recipient": {
    "colleagues": string,
    "customers": string,
    "unknown": string
  },
  "signature": string,
  "examples": string[]
}`;

    const res = await this.llm.chat({
      model: CHAT_MODEL,
      system:
        "Du analysierst den Schreibstil einer Person anhand ihrer gesendeten Emails. Antworte NUR mit JSON.",
      messages: [{
        role: "user",
        content:
          `Analysiere den Schreibstil dieser Person.

Gesendete Emails (neueste zuerst):
${block}

Antworte mit diesem exakten JSON-Schema:
${schemaHint}`,
      }],
      metadata: { user_id: userId, source: "cos-email-style-learn" },
    });

    const parsed = parseJsonObject<Record<string, unknown>>(res.content ?? "");
    const style = coerceStyle(parsed);

    const styleText = styleToReadableText(style);

    await this.db.upsertLearning(userId, {
      category: "email_style",
      content: styleText,
      source: "gmail",
      source_ref: "sent_emails_analysis",
      confidence: 0.9,
    });

    return {
      learned: true,
      style,
      emails_analyzed: emails.length,
    };
  }

  async createStyledDraft(params: {
    userId: string;
    inReplyTo: {
      message_id: string;
      from: string;
      subject: string;
      body: string;
    };
    context?: string;
  }): Promise<StyledDraftResult> {
    const { userId, inReplyTo, context } = params;
    const fromAddr = extractEmail(inReplyTo.from);
    if (!fromAddr) {
      return {
        success: false,
        preview: "",
        style_used: false,
        recipient_type: "unknown",
      };
    }

    const styleRows = await this.db.getLearnings(userId, {
      categories: ["email_style"],
      limit: 1,
      activeOnly: true,
    });
    const styleLearning = styleRows[0] ?? null;

    const relRows = await this.db.getLearnings(userId, {
      categories: ["relationship"],
      limit: 50,
      activeOnly: true,
    });

    const profile = await this.db.findUserProfileById(userId);
    const userName = profile?.name ?? "User";
    const userEmail = profile?.email ?? undefined;

    const relKind = recipientKind(userEmail, inReplyTo.from, relRows);
    const recipient_type = relKind;
    const relationship = relationshipSnippet(relRows, inReplyTo.from);

    const parsedStyle = styleLearning
      ? (() => {
        const lines = styleLearning.content.split("\n");
        const pick = (prefix: string): string | null => {
          const line = lines.find((l) => l.startsWith(prefix));
          return line ? line.slice(prefix.length).trim() : null;
        };
        const greeting = pick("Anrede:") ?? "Hallo";
        const closing = pick("Abschluss:") ?? "Viele Grüße";
        const avgRaw = pick("Typische Länge:");
        const toneRaw = pick("Ton:");
        const st = pick("Smalltalk:");
        const bp = pick("Aufzählungen:");
        const coll = pick("Bei Kollegen:");
        const cust = pick("Bei Kunden:");
        const unk = pick("Bei unbekannten:");
        const exLine = pick("Beispiele:");
        const examples = exLine
          ? exLine.split("|").map((s) => s.trim()).filter(Boolean)
          : [];
        return coerceStyle({
          greeting,
          closing,
          avg_length: avgRaw && isAvgLength(avgRaw) ? avgRaw : "short",
          tone: toneRaw && isTone(toneRaw) ? toneRaw : "neutral",
          smalltalk: st === "ja",
          bullet_points: bp === "ja",
          style_by_recipient: {
            colleagues: coll ?? "",
            customers: cust ?? "",
            unknown: unk ?? "Neutral-professionell.",
          },
          signature: "",
          examples: examples.length ? examples : ["…"],
        });
      })()
      : defaultEmailStyle();

    const styleBlock = styleLearning?.content ??
      "Direkt und professionell auf Deutsch";

    const recipientLabelDe = recipientLabel(relKind);
    const recipientStyleLine = styleHintForRecipient(parsedStyle, relKind);

    const userMsg =
      `Schreibe eine Antwort auf diese Email.

## Dein Schreibstil (befolge das exakt):
${styleBlock}

## Empfänger
Von: ${inReplyTo.from}
Typ: ${recipientLabelDe}
${relationship ? `Beziehung: ${relationship}` : ""}
Stil-Hinweis für diesen Empfängertyp: ${recipientStyleLine}

## Original-Email
Betreff: ${inReplyTo.subject}
${inReplyTo.body}

${context ? `## Was die Antwort sagen soll\n${context}` : ""}

## Regeln
- Klinge GENAU wie ${userName}, nicht wie ein Assistent
- Nutze die typische Anrede und den typischen Abschluss
- Gleiche Tonalität wie bei ${recipientLabelDe}-Kontakten
- Keine generischen Phrasen wie "Vielen Dank für Ihre Nachricht"
- Antworte NUR mit dem Email-Text, keine Erklärungen`;

    const llmRes = await this.llm.chat({
      model: CHAT_MODEL,
      system:
        `Du schreibst Email-Antworten im exakten Stil von ${userName}. Du bist ${userName} — schreibe in der ersten Person. Kein Hinweis dass du ein Assistent bist.`,
      messages: [{ role: "user", content: userMsg }],
      metadata: { user_id: userId, source: "cos-email-styled-draft" },
    });

    const body = (llmRes.content ?? "").trim();
    const preview = body.slice(0, 200);

    const subj = inReplyTo.subject.trim();
    const replySubject = /^re:\s*/i.test(subj) ? subj : `Re: ${subj}`;

    const dr = await this.toolExecutor.execute(
      "gmail",
      {
        action: "create_draft",
        to: fromAddr,
        subject: replySubject.slice(0, 200),
        body: body || "…",
        in_reply_to: inReplyTo.message_id,
      },
      userId,
      this.db,
    );

    if (!dr.success) {
      return {
        success: false,
        preview,
        style_used: Boolean(styleLearning),
        recipient_type,
      };
    }

    const draft_id = (dr.data as { id?: string } | undefined)?.id;

    return {
      success: true,
      draft_id,
      preview,
      style_used: Boolean(styleLearning),
      recipient_type,
    };
  }
}

export function serializeLearningForApi(row: Learning): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    category: row.category,
    content: row.content,
    source: row.source,
    source_ref: row.source_ref,
    confidence: row.confidence,
    confirmed_by_user: row.confirmed_by_user,
    times_confirmed: row.times_confirmed,
    contradicts_id: row.contradicts_id,
    first_seen: row.first_seen.toISOString(),
    last_confirmed: row.last_confirmed.toISOString(),
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
  };
}
