import type { DatabaseClient } from "../../db/databaseClient.ts";
import type { LlmClient } from "../../services/llm/llmTypes.ts";
import type { DocumentService } from "../../services/documentService.ts";
import type { ToolExecutor } from "../../services/tools/toolExecutor.ts";
import { CHAT_MODEL } from "../constants.ts";
import type { AgentContext, LearningCandidate, SubAgentResult } from "../types.ts";
import { BaseSubAgent } from "./base.ts";

export type CfoTask = {
  type: "answer_question" | "review_document" | "question_decision" | "analyze_cashflow";
  question?: string;
  documentId?: string;
  decision?: string;
  data?: string;
};

export class CfoAgent extends BaseSubAgent {
  readonly agentType = "cfo";
  readonly description = "CFO-Analyse: Zahlen, Businessplan, Finanzierung";

  private readonly CFO_SYSTEM_PROMPT =
    `Du bist CFO-Analyst. Direkt, kritisch, zahlenbasiert. Auf Deutsch.

## Dein Stil
- Zahlen first, dann Interpretation
- Unrealistische Annahmen klar benennen
- Immer: Best Case / Base Case / Worst Case wenn relevant
- Keine Schönfärberei, keine Füllsätze

## Analyse-Framework
1. Was sagen die Zahlen? (Fakten)
2. Was fällt auf? (Abweichungen, Risiken)
3. Kritische Annahmen hinterfragen
4. Konkrete Empfehlung

## BBA-Analyse
1. Liquiditätssituation (12-Monats-Runway)
2. Umsatz vs. Plan
3. Kostenstruktur (Fix vs. variabel)
4. Bankability-Einschätzung (KfW/Hausbank-Perspektive)`;

  constructor(
    llm: LlmClient,
    db: DatabaseClient,
    toolExecutor: ToolExecutor,
    private readonly documentService: DocumentService,
  ) {
    super(llm, db, toolExecutor);
  }

  async execute(
    task: Record<string, unknown>,
    context: AgentContext,
  ): Promise<SubAgentResult> {
    const elapsed = this.startTimer();
    if (!context.connectedTools.includes("cfo")) {
      return {
        agentType: this.agentType,
        success: false,
        error: "cfo nicht in connectedTools",
        durationMs: elapsed(),
      };
    }

    const kind = String(
      (task as CfoTask).type ?? task.task ?? "answer_question",
    ) as CfoTask["type"];

    try {
      const docCtx = await this.documentService.buildDocumentContext(
        context.userId,
      );
      let extra = "";
      if (kind === "review_document") {
        const docId = String((task as CfoTask).documentId ?? "").trim();
        if (!docId) {
          return {
            agentType: this.agentType,
            success: false,
            error: "documentId fehlt für review_document.",
            durationMs: elapsed(),
          };
        }
        try {
          const qa = await this.documentService.askDocument({
            documentId: docId,
            userId: context.userId,
            question:
              "Fasse alle Finanzzahlen und Annahmen aus dem Dokument zusammen.",
          });
          extra = `\n\nDokument-QA:\n${qa.answer}`;
        } catch {
          return {
            agentType: this.agentType,
            success: false,
            error: "Dokument für review_document nicht gefunden.",
            durationMs: elapsed(),
          };
        }
      }

      const q = String((task as CfoTask).question ?? "").trim() ||
        String((task as CfoTask).decision ?? "").trim() ||
        String((task as CfoTask).data ?? "").trim() ||
        "Finanzielle Einschätzung bitte.";

      const userBlock =
        `Kontext aus Dokumenten:\n${docCtx || "(keine Dokumente)"}\n${extra}\n\n` +
        `Aufgabe (${kind}):\n${q}` +
        (kind === "question_decision"
          ? "\n\nBitte Best Case / Base Case / Worst Case explizit ausarbeiten."
          : "");

      const text = await this.llm.chat({
        model: CHAT_MODEL,
        system: this.CFO_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userBlock }],
        metadata: { user_id: context.userId, source: "cos-cfo" },
      });

      const learningCandidates: LearningCandidate[] = [];
      const out = (text.content ?? "").trim();
      if (/umsatz|kosten|marge|cashflow|runway|liquidität/i.test(out)) {
        learningCandidates.push({
          category: "financial",
          content: truncateLearning(out),
          source: "cfo_agent",
          confidence: 0.65,
        });
      }

      return {
        agentType: this.agentType,
        success: true,
        data: { analysis: out, task: kind },
        learningCandidates,
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

function truncateLearning(s: string): string {
  return s.length > 800 ? `${s.slice(0, 800)}…` : s;
}
