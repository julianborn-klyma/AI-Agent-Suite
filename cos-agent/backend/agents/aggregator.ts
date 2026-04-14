import type { LlmClient } from "../services/llm/llmTypes.ts";
import { CHAT_MODEL } from "./constants.ts";
import type { AgentContext, SubAgentResult } from "./types.ts";

export class AggregatorAgent {
  constructor(private llm: LlmClient) {}

  async aggregate(params: {
    originalMessage: string;
    results: SubAgentResult[];
    context: AgentContext;
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

    const res = await this.llm.chat({
      model: CHAT_MODEL,
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
