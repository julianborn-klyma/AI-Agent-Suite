import type { LlmClient } from "../services/llm/llmTypes.ts";
import { MODEL_IDS } from "./modelSelector.ts";
import { parseJsonObject } from "./jsonUtils.ts";
import type {
  AgentContext,
  LearningCandidate,
  SubAgentResult,
  ValidationIssue,
  ValidationResult,
} from "./types.ts";

type ValidatorJson = {
  approved?: boolean;
  issues?: Array<{
    type?: string;
    severity?: string;
    detail?: string;
  }>;
  needsRetry?: boolean;
  retryFeedback?: string;
  newLearnings?: LearningCandidate[];
};

export class ValidatorAgent {
  constructor(private llm: LlmClient) {}

  async validate(params: {
    originalMessage: string;
    proposedResponse: string;
    results: SubAgentResult[];
    context: AgentContext;
    isRetry?: boolean;
  }): Promise<ValidationResult> {
    const resultsJson = JSON.stringify(
      params.results.map((r) => ({
        agent: r.agentType,
        ok: r.success,
        data: r.data,
        error: r.error,
      })),
    );

    const model = params.isRetry ? MODEL_IDS.opus : MODEL_IDS.haiku;
    const res = await this.llm.chat({
      model,
      system:
        "Du bist ein strenger Qualitätsprüfer. Antworte NUR mit einem JSON-Objekt (kein Markdown) mit Feldern: " +
        "approved (boolean), issues (array von {type, severity: low|medium|high, detail}), " +
        "needsRetry (boolean), optional retryFeedback (string), optional newLearnings (array von {kind, summary, source?, confidence?}). " +
        "Prüfe: (1) Halluzinationen — steht etwas in der Antwort, das nicht aus den Sub-Agent-Ergebnissen abgeleitet werden kann? " +
        "(2) Relevanz — beantwortet die Antwort die Nutzerfrage? " +
        "(3) Ton — passt der Stil zum Kommunikationskontext? " +
        "(4) Vollständigkeit — wurden alle Teile der Frage bedient? " +
        "Bei mindestens einem Issue mit severity \"high\": needsRetry = true und konkretes retryFeedback.",
      messages: [
        {
          role: "user",
          content:
            `Nutzerfrage:\n${params.originalMessage}\n\nVorgeschlagene Antwort:\n${
              params.proposedResponse
            }\n\nZugrundeliegende Ergebnisse:\n${resultsJson}\n\nKontext-Hinweise:\n${
              JSON.stringify(params.context.userContexts)
            }`,
        },
      ],
      metadata: { user_id: params.context.userId, source: "cos-agent" },
    });

    const parsed = parseJsonObject<ValidatorJson>(res.content ?? "");
    if (!parsed) {
      return {
        approved: true,
        issues: [],
        needsRetry: false,
      };
    }

    const issues: ValidationIssue[] = (parsed.issues ?? []).map((i) => ({
      type: String(i.type ?? "unknown"),
      severity: normalizeSeverity(i.severity),
      detail: String(i.detail ?? ""),
    }));

    const hasHigh = issues.some((i) => i.severity === "high");
    const needsRetry = Boolean(parsed.needsRetry) || hasHigh;
    const hasHallucination = issues.some((i) => i.type === "hallucination");
    const approved = parsed.approved !== undefined
      ? Boolean(parsed.approved)
      : !hasHallucination && !hasHigh;

    return {
      approved,
      issues,
      needsRetry,
      retryFeedback: typeof parsed.retryFeedback === "string"
        ? parsed.retryFeedback
        : hasHigh
        ? issues.find((i) => i.severity === "high")?.detail
        : undefined,
      newLearnings: Array.isArray(parsed.newLearnings)
        ? parsed.newLearnings
        : undefined,
    };
  }
}

function normalizeSeverity(
  s: string | undefined,
): "low" | "medium" | "high" {
  if (s === "high" || s === "medium" || s === "low") return s;
  return "medium";
}
