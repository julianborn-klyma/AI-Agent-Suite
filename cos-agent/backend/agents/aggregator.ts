import type { LlmClient } from "../services/llm/llmTypes.ts";
import { CHAT_MODEL } from "./constants.ts";
import { MODEL_IDS } from "./modelSelector.ts";
import type { AgentContext, SubAgentResult } from "./types.ts";

function serializeResultPayload(results: SubAgentResult[]): string {
  try {
    return JSON.stringify(
      results.map((r) => ({
        agent: r.agentType,
        ok: r.success,
        data: r.data,
        error: r.error,
      })),
    );
  } catch {
    return "";
  }
}

/** Leer, alles fehlgeschlagen oder nur minimale Nutzlast — Haiku reicht oft. */
function areToolResultsWeak(results: SubAgentResult[]): boolean {
  if (results.length === 0) return true;
  if (results.every((r) => !r.success)) return true;
  return serializeResultPayload(results).length < 400;
}

export class AggregatorAgent {
  constructor(private llm: LlmClient) {}

  async aggregate(params: {
    originalMessage: string;
    results: SubAgentResult[];
    context: AgentContext;
    complexity?: "low" | "medium" | "high";
  }): Promise<string> {
    const name = params.context.userProfile?.name ?? "dem Nutzer";
    const styleHint =
      params.context.userContexts.find((c) => c.key === "communication_style")
        ?.value ??
      "Chief of Staff: klar, loyal, ohne Floskeln";

    const payload = params.results.map((r) => ({
      agent: r.agentType,
      ok: r.success,
      data: r.data,
      error: r.error,
    }));

    const complexity = params.complexity ?? "medium";
    const model =
      complexity === "low" && areToolResultsWeak(params.results)
        ? MODEL_IDS.haiku
        : CHAT_MODEL;

    const res = await this.llm.chat({
      model,
      system:
        `Du bist der persönliche Chief of Staff für ${name}. Stil: ${styleHint}. ` +
        "Fasse die folgenden Tool-/Sub-Agent-Ergebnisse zu einer kohärenten Antwort auf die Nutzerfrage zusammen. " +
        "Erfinde keine Fakten, Zahlen oder Namen, die nicht in den Ergebnisdaten vorkommen. Wenn etwas fehlt, sag es offen.",
      messages: [
        {
          role: "user",
          content:
            `Nutzerfrage:\n${params.originalMessage}\n\nSub-Agent-Ergebnisse (JSON):\n${
              JSON.stringify(payload, null, 0)
            }`,
        },
      ],
      metadata: { user_id: params.context.userId, source: "cos-agent" },
    });
    return res.content ?? "";
  }
}
