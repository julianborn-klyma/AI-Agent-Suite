import { parseJsonArray } from "../../agents/jsonUtils.ts";
import { MODEL_IDS } from "../../agents/modelSelector.ts";
import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { FirmInsight, FirmInsightCategory } from "../../db/databaseClient.ts";
import type { LlmClient, LlmResponse } from "../llm/llmTypes.ts";
import type { EmbeddingClient } from "../llm/llmTypes.ts";
import type { SubAgentResult } from "../../agents/types.ts";

export type { FirmInsight };

export class FirmBrainService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly llm: LlmClient,
    private readonly embedder?: EmbeddingClient,
  ) {}

  /**
   * Called asynchronously after every project chat.
   * Extracts company-level insights and stores them deduplicated.
   */
  async extractFromChat(params: {
    tenantId: string;
    userId: string;
    projectId?: string | null;
    sessionId?: string | null;
    messages: { role: string; content: string }[];
    agentResults?: SubAgentResult[];
  }): Promise<void> {
    const tail = params.messages.slice(-12);
    if (tail.length === 0) return;

    const agentPart = params.agentResults?.length
      ? `\nAgent-Ergebnisse:\n${
        JSON.stringify(
          params.agentResults.map((r) => ({
            agent: r.agentType,
            ok: r.success,
            data: r.data,
          })),
          null,
          0,
        )
      }`
      : "";

    let res: LlmResponse;
    try {
      res = await this.llm.chat({
        model: MODEL_IDS.haiku,
        system:
          "Du extrahierst firmenbezogenes Wissen aus Konversationen. " +
          "Antworte NUR mit einem JSON-Array (kein Markdown). " +
          'Jedes Element: { "category": string, "content": string, "confidence": number }. ' +
          "Kategorien (nur diese): person | company | project | decision | pattern | relationship. " +
          "Nur belegbare Fakten über das Unternehmen, Personen, Projekte oder Entscheidungen — keine Meinungen.",
        messages: [
          {
            role: "user",
            content:
              `Konversation:\n${JSON.stringify(tail)}${agentPart}\n\nJSON-Array (leer [] wenn nichts Relevantes):`,
          },
        ],
        metadata: {
          user_id: params.userId,
          source: "firm-brain-extraction",
        },
      });
    } catch {
      return;
    }

    const arr = parseJsonArray(res.content ?? "");
    if (!arr?.length) return;

    const VALID_CATEGORIES = new Set<FirmInsightCategory>([
      "person",
      "company",
      "project",
      "decision",
      "pattern",
      "relationship",
    ]);

    for (const raw of arr) {
      if (raw === null || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const category = typeof o.category === "string"
        ? o.category.trim() as FirmInsightCategory
        : null;
      const content = typeof o.content === "string" ? o.content.trim() : "";
      if (!category || !VALID_CATEGORIES.has(category) || !content) continue;

      const confidence = typeof o.confidence === "number" &&
          Number.isFinite(o.confidence)
        ? Math.min(1, Math.max(0, o.confidence))
        : 0.8;

      const embedding = await this.tryEmbed(content);
      await this.upsertInsight({
        tenantId: params.tenantId,
        sourceProjectId: params.projectId ?? null,
        sourceUserId: params.userId,
        sourceSessionId: params.sessionId ?? null,
        category,
        content,
        confidence,
        embedding,
      });
    }
  }

  /** Semantic search for agent context injection. */
  async getRelevantInsights(
    tenantId: string,
    query: string,
    limit = 6,
  ): Promise<FirmInsight[]> {
    const embedding = await this.tryEmbed(query);
    if (!embedding) return [];
    return await this.db.searchFirmInsights({ tenantId, embedding, limit });
  }

  // ── Admin operations ──────────────────────────────────────────────────────

  async listInsights(params: {
    tenantId: string;
    category?: FirmInsightCategory;
    sourceProjectId?: string | null;
    adminSuppressed?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<FirmInsight[]> {
    return await this.db.listFirmInsights(params);
  }

  async suppressInsight(id: string): Promise<void> {
    await this.db.updateFirmInsightSuppression(id, true);
  }

  async unsuppressInsight(id: string): Promise<void> {
    await this.db.updateFirmInsightSuppression(id, false);
  }

  async deleteInsight(id: string): Promise<void> {
    await this.db.deleteFirmInsight(id);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async tryEmbed(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      return await this.embedder.embed(text);
    } catch {
      return null;
    }
  }

  private async upsertInsight(params: {
    tenantId: string;
    sourceProjectId: string | null;
    sourceUserId: string;
    sourceSessionId: string | null;
    category: FirmInsightCategory;
    content: string;
    confidence: number;
    embedding: number[] | null;
  }): Promise<void> {
    if (params.embedding) {
      const similar = await this.db.findSimilarFirmInsights({
        tenantId: params.tenantId,
        embedding: params.embedding,
        threshold: 0.9,
        limit: 1,
      });
      if (similar.length > 0) {
        const merged = Math.min(
          1,
          similar[0]!.confidence * 0.8 + params.confidence * 0.2,
        );
        await this.db.updateFirmInsightConfidence(similar[0]!.id, merged);
        return;
      }
    }

    await this.db.insertFirmInsight(params);
  }
}
