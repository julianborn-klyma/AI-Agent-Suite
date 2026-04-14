import { CHAT_MODEL } from "../agents/constants.ts";
import { parseJsonArray, parseJsonObject } from "../agents/jsonUtils.ts";
import type { LearningCandidate } from "../agents/types.ts";
import type { DatabaseClient, Document, DocumentChunk } from "../db/databaseClient.ts";
import type { LlmClient } from "./llm/llmTypes.ts";

const MAX_EXTRACT = 100_000;
const DOC_QA_MODEL = CHAT_MODEL;

export class DocumentNotFoundError extends Error {
  constructor(message = "Dokument nicht gefunden.") {
    super(message);
    this.name = "DocumentNotFoundError";
  }
}

export interface DocumentQAResult {
  answer: string;
  sources: Array<{
    chunk_index: number;
    page_number?: number;
    section_title?: string;
    excerpt: string;
  }>;
  chunksSearched: number;
}

export interface DocumentVerification {
  sections_found: string[];
  missing_sections: string[];
  contradictions: Array<{
    description: string;
    chunk_a: number;
    chunk_b: number;
  }>;
  critical_assumptions: string[];
  overall_assessment: string;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function stripXmlTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** PDF: grobe Textheuristik (Tj-Literale + UTF-8-Fallback). */
export function extractPdfTextSimple(bytes: Uint8Array): string {
  const latin = new TextDecoder("latin1", { fatal: false }).decode(bytes);
  const parts: string[] = [];
  for (const m of latin.matchAll(/\(([^\\)]*)\)\s*Tj/g)) {
    const t = m[1]?.replace(/\\([nrtbf()\\])|(\\\d{3})/g, (_, a) => {
      if (a === "n") return "\n";
      if (a === "r") return "\r";
      if (a === "t") return "\t";
      return a ?? "";
    }) ?? "";
    if (t.trim()) parts.push(t);
  }
  let out = parts.join(" ");
  if (out.length < 20) {
    out = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    out = out.replace(/[^\x20-\x7E\n\r\täöüÄÖÜß]/g, " ");
  }
  return truncate(out.replace(/\s+/g, " ").trim(), MAX_EXTRACT);
}

export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(bytes);
    const f = zip.file("word/document.xml");
    if (!f) return "";
    const xml = await f.async("string");
    return truncate(stripXmlTags(xml), MAX_EXTRACT);
  } catch {
    return "";
  }
}

export class DocumentService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
  ) {}

  async extractText(params: {
    content: Uint8Array;
    mimeType: string;
  }): Promise<string> {
    try {
      const mt = params.mimeType.toLowerCase();
      if (mt.includes("text/plain")) {
        return truncate(
          new TextDecoder("utf-8", { fatal: false }).decode(params.content),
          MAX_EXTRACT,
        );
      }
      if (mt.includes("pdf")) {
        return extractPdfTextSimple(params.content);
      }
      if (
        mt.includes(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
      ) {
        return await extractDocxText(params.content);
      }
      return "";
    } catch {
      return "";
    }
  }

  chunkText(params: {
    text: string;
    documentId: string;
    userId: string;
    chunkSize?: number;
    overlap?: number;
  }): Array<{
    document_id: string;
    user_id: string;
    chunk_index: number;
    page_number?: number;
    section_title?: string;
    content: string;
    token_count: number;
  }> {
    const chunkSize = params.chunkSize ?? 800;
    const overlap = params.overlap ?? 100;
    const text = params.text;
    const out: Array<{
      document_id: string;
      user_id: string;
      chunk_index: number;
      page_number?: number;
      section_title?: string;
      content: string;
      token_count: number;
    }> = [];

    let i = 0;
    let chunkIndex = 0;
    let currentPage: number | undefined;
    let currentSection: string | undefined;

    const pageRe = /\b(?:Seite|Page)\s+(\d+)\b/gi;
    const sectionRe = /^(\d+(?:\.\d+)*\.?|[IVXLCDM]+\.|[A-ZÄÖÜ][A-ZÄÖÜ0-9\s,\-]{2,})$/;

    while (i < text.length) {
      const windowEnd = Math.min(text.length, i + chunkSize);
      let cut = windowEnd;
      if (windowEnd < text.length) {
        const para = text.lastIndexOf("\n\n", windowEnd);
        if (para > i + chunkSize / 2) cut = para + 2;
        else {
          const nl = text.lastIndexOf("\n", windowEnd);
          if (nl > i + chunkSize / 2) cut = nl + 1;
        }
      }
      if (cut <= i) cut = Math.min(i + 1, text.length);
      const slice = text.slice(i, cut).trim();
      if (slice.length > 0) {
        const lines = slice.split("\n");
        for (const line of lines) {
          const pm = /\b(?:Seite|Page)\s+(\d+)\b/i.exec(line);
          if (pm) currentPage = parseInt(pm[1]!, 10);
          const t = line.trim();
          if (
            t.length >= 5 && t.length < 120 &&
            /^\d+(?:\.\d+)*\.\s+\S/.test(t)
          ) {
            currentSection = t;
          } else if (t.length >= 3 && sectionRe.test(t) && t.length < 120) {
            currentSection = t;
          }
          if (t === t.toUpperCase() && /[A-ZÄÖÜ]/.test(t) && t.length < 100 && t.length > 2) {
            currentSection = t;
          }
        }
        out.push({
          document_id: params.documentId,
          user_id: params.userId,
          chunk_index: chunkIndex++,
          page_number: currentPage,
          section_title: currentSection,
          content: slice,
          token_count: Math.ceil(slice.length / 4),
        });
      }
      if (cut >= text.length) break;
      const nextI = Math.max(cut - overlap, i + 1);
      if (nextI <= i) break;
      i = nextI;
    }
    return out;
  }

  async summarizeDocument(params: {
    userId: string;
    name: string;
    documentType: string;
    contentText: string;
  }): Promise<string> {
    const body = truncate(params.contentText, 120_000);
    let instruction = "";
    switch (params.documentType) {
      case "business_plan":
        instruction =
          "Fasse diesen Businessplan strukturiert zusammen. Gehe ein auf: Executive Summary, Markt + Zielgruppe, Produkt/Dienstleistung, Revenue-Modell, Finanzplanung (Umsatz/Kosten/Break-Even), Team, Risiken. Max 800 Wörter.";
        break;
      case "meeting_summary":
        instruction =
          "Fasse dieses Meeting-Protokoll zusammen. Teilnehmer, Besprochene Themen, Entscheidungen, Offene Punkte, Next Steps mit Verantwortlichen.";
        break;
      case "financial_report":
        instruction =
          "Fasse diesen Finanzbericht zusammen. Umsatz, Kosten, Cashflow, Abweichungen vom Plan, kritische Kennzahlen.";
        break;
      default:
        instruction =
          "Fasse das Dokument sachlich zusammen. Max 400 Wörter.";
    }
    const res = await this.llm.chat({
      model: DOC_QA_MODEL,
      system: "Du bist ein präziser Analyst. Deutsch.",
      messages: [{
        role: "user",
        content: `Dokumentname: ${params.name}\nTyp: ${params.documentType}\n\n${instruction}\n\n---\n\n${body}`,
      }],
      metadata: { user_id: params.userId, source: "cos-document-summarize" },
    });
    return (res.content ?? "").trim();
  }

  async processUpload(params: {
    userId: string;
    name: string;
    documentType: string;
    content: Uint8Array;
    mimeType: string;
    source?: string;
    driveFileId?: string;
  }): Promise<Document> {
    const doc = await this.db.insertDocument(params.userId, {
      name: params.name,
      document_type: params.documentType,
      file_size_bytes: params.content.byteLength,
      mime_type: params.mimeType,
      source: params.source ?? "upload",
      drive_file_id: params.driveFileId,
    });
    const text = await this.extractText({
      content: params.content,
      mimeType: params.mimeType,
    });
    const chunks = this.chunkText({
      text: text || " ",
      documentId: doc.id,
      userId: params.userId,
    });
    await this.db.insertChunks(chunks);
    const summary = await this.summarizeDocument({
      userId: params.userId,
      name: params.name,
      documentType: params.documentType,
      contentText: text,
    });
    await this.db.updateDocumentProcessed(doc.id, params.userId, {
      summary,
      content_text: text,
    });
    const updated = await this.db.getDocument(doc.id, params.userId);
    void this.extractLearningsAsync(
      params.userId,
      doc.id,
      params.documentType,
      summary,
      text,
    );
    return updated ?? { ...doc, processed: true, summary, content_text: text };
  }

  private async extractLearningsAsync(
    userId: string,
    documentId: string,
    documentType: string,
    summary: string,
    contentText: string,
  ): Promise<void> {
    try {
      const cands = await this.buildLearningCandidatesFromUpload({
        userId,
        documentType,
        summary,
        contentText: truncate(contentText, 8000),
        documentId,
      });
      if (cands.length) await this.db.upsertLearnings(userId, cands);
    } catch {
      /* optional */
    }
  }

  private async buildLearningCandidatesFromUpload(params: {
    userId: string;
    documentType: string;
    summary: string;
    contentText: string;
    documentId: string;
  }): Promise<LearningCandidate[]> {
    const res = await this.llm.chat({
      model: DOC_QA_MODEL,
      system:
        "Antworte NUR mit JSON-Array von Objekten {category, content, confidence}. Kategorien: financial, project, commitment, decision_pattern. Max 6 Einträge. Deutsch.",
      messages: [{
        role: "user",
        content:
          `Dokumenttyp: ${params.documentType}\nZusammenfassung:\n${params.summary}\n\nAusschnitt:\n${params.contentText}`,
      }],
      metadata: { user_id: params.userId, source: "cos-document-learnings" },
    });
    const arr = parseJsonArray(res.content ?? "");
    if (!arr) return [];
    const out: LearningCandidate[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const category = String(o.category ?? "").trim();
      const content = String(o.content ?? "").trim();
      const conf = typeof o.confidence === "number" ? o.confidence : 0.65;
      if (!category || !content) continue;
      out.push({
        category,
        content,
        source: "document_upload",
        source_ref: params.documentId,
        confidence: Math.min(1, Math.max(0, conf)),
      });
    }
    if (out.length === 0 && params.documentType === "business_plan") {
      out.push({
        category: "financial",
        content: truncate(params.summary, 500),
        source: "document_upload",
        source_ref: params.documentId,
        confidence: 0.6,
      });
    }
    if (out.length === 0 && params.documentType === "meeting_summary") {
      out.push({
        category: "decision_pattern",
        content: truncate(params.summary, 500),
        source: "document_upload",
        source_ref: params.documentId,
        confidence: 0.55,
      });
    }
    return out;
  }

  async askDocument(params: {
    documentId: string;
    userId: string;
    question: string;
  }): Promise<DocumentQAResult> {
    const doc = await this.db.getDocument(params.documentId, params.userId);
    if (!doc) throw new DocumentNotFoundError();
    let chunks = await this.db.searchChunks({
      documentId: params.documentId,
      userId: params.userId,
      query: params.question,
      limit: 5,
    });
    if (chunks.length === 0) {
      const all = await this.db.getChunks(params.documentId, params.userId);
      chunks = all.slice(0, 3);
    }
    const parts: string[] = [];
    for (const c of chunks) {
      const head =
        `[Chunk ${c.chunk_index}` +
        (c.page_number != null ? `, Seite ${c.page_number}` : "") +
        (c.section_title ? `, '${c.section_title}'` : "") +
        "]\n";
      parts.push(head + c.content);
    }
    const userMsg =
      `Frage: ${params.question}\n\nVerfügbare Textausschnitte:\n\n${parts.join("\n\n---\n\n")}\n\n` +
      "Antworte NUR mit JSON: {\"answer\":\"...\",\"sources\":[{\"chunk_index\":0,\"page_number\":1,\"section_title\":\"...\",\"excerpt\":\"...\"}]}";

    const res = await this.llm.chat({
      model: DOC_QA_MODEL,
      system:
        "Du beantwortest Fragen zu einem Dokument. Antworte NUR basierend auf den gegebenen Textausschnitten. Gib IMMER die Quelle an (Chunk-Index, Seitennummer falls bekannt, Abschnittstitel falls bekannt). Falls die Information nicht in den Ausschnitten steht: Sage klar 'Diese Information ist in den verfügbaren Abschnitten nicht enthalten.' Keine Halluzinationen. Antwortformat: nur JSON.",
      messages: [{ role: "user", content: userMsg }],
      metadata: { user_id: params.userId, source: "cos-document-qa" },
    });

    const parsed = parseJsonObject<{
      answer?: string;
      sources?: unknown[];
    }>(res.content ?? "");
    const answer = typeof parsed?.answer === "string"
      ? parsed.answer
      : (res.content ?? "").trim();
    const sources: DocumentQAResult["sources"] = [];
    if (Array.isArray(parsed?.sources)) {
      for (const s of parsed.sources) {
        if (!s || typeof s !== "object") continue;
        const o = s as Record<string, unknown>;
        const idx = Number(o.chunk_index);
        if (!Number.isInteger(idx)) continue;
        const ex = String(o.excerpt ?? "").slice(0, 200);
        sources.push({
          chunk_index: idx,
          page_number: typeof o.page_number === "number"
            ? o.page_number
            : undefined,
          section_title: typeof o.section_title === "string"
            ? o.section_title
            : undefined,
          excerpt: ex,
        });
      }
    }
    if (sources.length === 0) {
      for (const c of chunks) {
        sources.push({
          chunk_index: c.chunk_index,
          page_number: c.page_number ?? undefined,
          section_title: c.section_title ?? undefined,
          excerpt: c.content.slice(0, 200),
        });
      }
    }
    return { answer, sources, chunksSearched: chunks.length };
  }

  async verifyDocument(params: {
    documentId: string;
    userId: string;
  }): Promise<DocumentVerification> {
    const doc = await this.db.getDocument(params.documentId, params.userId);
    if (!doc) throw new DocumentNotFoundError();
    const chunks = (await this.db.getChunks(params.documentId, params.userId))
      .slice(0, 20);
    const body = chunks.map((c) =>
      `[#${c.chunk_index}] ${c.content}`
    ).join("\n\n");
    const res = await this.llm.chat({
      model: DOC_QA_MODEL,
      system:
        "Du prüfst Dokumentvollständigkeit. Antworte NUR mit JSON gemäß Schema.",
      messages: [{
        role: "user",
        content:
          `Analysiere Vollständigkeit und Widersprüche. JSON-Schema:\n{"sections_found":[],"missing_sections":[],"contradictions":[{"description":"","chunk_a":0,"chunk_b":1}],"critical_assumptions":[],"overall_assessment":""}\n\nText:\n${truncate(body, 60_000)}`,
      }],
      metadata: { user_id: params.userId, source: "cos-document-verify" },
    });
    const parsed = parseJsonObject<DocumentVerification>(
      res.content ?? "",
    );
    if (parsed) {
      return {
        sections_found: Array.isArray(parsed.sections_found)
          ? parsed.sections_found.filter((x): x is string => typeof x === "string")
          : [],
        missing_sections: Array.isArray(parsed.missing_sections)
          ? parsed.missing_sections.filter((x): x is string => typeof x === "string")
          : [],
        contradictions: Array.isArray(parsed.contradictions)
          ? parsed.contradictions
            .filter((x) => x !== null && typeof x === "object")
            .map((x) => {
              const o = x as Record<string, unknown>;
              return {
                description: String(o.description ?? ""),
                chunk_a: Number(o.chunk_a) || 0,
                chunk_b: Number(o.chunk_b) || 0,
              };
            })
          : [],
        critical_assumptions: Array.isArray(parsed.critical_assumptions)
          ? parsed.critical_assumptions.filter((x): x is string =>
            typeof x === "string"
          )
          : [],
        overall_assessment: String(parsed.overall_assessment ?? ""),
      };
    }
    return {
      sections_found: [],
      missing_sections: [],
      contradictions: [],
      critical_assumptions: [],
      overall_assessment: res.content?.trim() ?? "",
    };
  }

  async buildDocumentContext(userId: string): Promise<string> {
    const docs = await this.db.getDocuments(userId, {
      processed: true,
      limit: 40,
    });
    if (docs.length === 0) return "";
    const lines: string[] = ["## Dokumente"];
    for (const d of docs) {
      const date = d.created_at instanceof Date
        ? d.created_at.toISOString().slice(0, 10)
        : String(d.created_at).slice(0, 10);
      const sum = (d.summary ?? "").replace(/\s+/g, " ").trim();
      lines.push(
        `**${d.name} (${d.document_type}, ${date}):** ${sum}`,
      );
    }
    let s = lines.join("\n");
    if (s.length > 2000) s = s.slice(0, 2000) + "\n…";
    return s;
  }
}
