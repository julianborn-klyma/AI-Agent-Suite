import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import type { AgentContext, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";
import type { LearningCandidate } from "../types.ts";

export class WebSearchAgent extends BaseSubAgent {
  readonly agentType = "web_search";
  readonly description = "Recherchiert aktuelle Informationen im Internet";

  constructor(llm: LlmClient, db: DatabaseClient, toolExecutor: ToolExecutor) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: {
      type?: string;
      query?: string;
      context_hint?: string;
      depth?: string;
    },
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    const kind = String(task.type ?? "search");
    const query = String(task.query ?? "").trim();
    if (!query) {
      return {
        agentType: this.agentType,
        success: false,
        error: "query fehlt",
        durationMs: elapsed(),
      };
    }
    const depth = task.depth === "deep" ? "deep" : "quick";
    const hint = typeof task.context_hint === "string" ? task.context_hint.trim() : "";

    try {
      if (depth === "quick") {
        const text = await this.callLlm({
          systemPrompt:
            "Du bist ein Recherche-Assistent mit Web-Zugriff. Antworte strukturiert mit Quellenhinweisen (Domain/Name), keine erfundenen URLs.",
          userMessage: hint
            ? `Recherche:\n${query}\n\nZusatzkontext:\n${hint}`
            : `Recherche:\n${query}`,
          context: { ...context, currentTask: "research" },
          complexity: "medium",
          useWebSearch: true,
          model: "sonnet",
        });
        return {
          agentType: this.agentType,
          success: true,
          data: { markdown: text },
          summary: text.slice(0, 400),
          learningCandidates: extractLearnings(text),
          durationMs: elapsed(),
        };
      }

      const rounds = [
        `Überblick und zentrale Quellen zum Thema:\n${query}${hint ? `\nKontext: ${hint}` : ""}`,
        `Vertiefung: wichtigste Fakten, Zahlen und Risiken zu:\n${query}`,
        `Kurzfassung + Bewertung der Aussagen (Unsicherheit markieren) zu:\n${query}`,
      ];
      const parts: string[] = [];
      for (const r of rounds) {
        const t = await this.callLlm({
          systemPrompt:
            "Du recherchierst mit Web-Zugriff. Jede Runde baut auf vorherigem Wissen auf. Quellen grob benennen.",
          userMessage: r,
          context: { ...context, currentTask: "research" },
          complexity: "high",
          useWebSearch: true,
          model: "sonnet",
        });
        parts.push(t);
      }
      const merged = parts.join("\n\n---\n\n");
      return {
        agentType: this.agentType,
        success: true,
        data: { markdown: merged, rounds: parts.length },
        summary: merged.slice(0, 500),
        learningCandidates: extractLearnings(merged),
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
}

function extractLearnings(text: string): LearningCandidate[] {
  const lines = text.split("\n").filter((l) =>
    /quelle|http|www\.|studie|bericht|news|förderung|markt/i.test(l),
  );
  return lines.slice(0, 5).map((line) => ({
    category: "fact",
    summary: line.trim().slice(0, 240),
    content: line.trim(),
    source: "web_search",
    confidence: 0.65,
  }));
}
