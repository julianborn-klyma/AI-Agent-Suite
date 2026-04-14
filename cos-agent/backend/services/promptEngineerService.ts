import type { AgentContext } from "../agents/types.ts";
import type { AgentModel } from "../agents/modelSelector.ts";
import { MODEL_IDS, selectModel } from "../agents/modelSelector.ts";
import { parseJsonArray } from "../agents/jsonUtils.ts";
import type { LlmClient } from "./llm/llmTypes.ts";

export type OptimizedPrompt = {
  system_prompt: string;
  user_prompt: string;
  search_queries: string[];
  recommended_model: AgentModel;
  estimated_complexity: "low" | "medium" | "high";
};

const HIGH_PAT =
  /\b(analysiere|analysieren|bewerte|bewerten|businessplan|strategie|finanzierung|investition)\b/i;
const LOW_PAT =
  /\b(was|wie|zeig|zeige|liste|wann|wer|wo)\b/i;

export class PromptEngineerService {
  constructor(private readonly llm: LlmClient) {}

  classifyComplexity(message: string): "low" | "medium" | "high" {
    const t = message.trim();
    const words = t.split(/\s+/).filter(Boolean).length;
    if (words > 200 || HIGH_PAT.test(t)) return "high";
    if (words < 20 && LOW_PAT.test(t)) return "low";
    return "medium";
  }

  async buildSearchQueries(params: {
    rawRequest: string;
    userContext: AgentContext;
    numQueries?: number;
  }): Promise<string[]> {
    const n = Math.min(Math.max(params.numQueries ?? 3, 1), 8);
    const role = params.userContext.userProfile?.role ?? "user";
    const industry =
      params.userContext.userContexts.find((c) => c.key === "industry")?.value ??
      "unbekannt";
    const res = await this.llm.chat({
      model: MODEL_IDS.haiku,
      system:
        "Du bist ein Search Query Optimizer. Antworte NUR mit einem JSON-Array von Strings, keine Erklärung.",
      messages: [{
        role: "user",
        content:
          `Erstelle ${n} optimierte Suchanfragen für:\n"${params.rawRequest}"\n` +
          `Kontext: Rolle ${role}, Branche/Feld: ${industry}.\n` +
          `Antworte NUR mit JSON: ["query1", "query2", ...]`,
      }],
      metadata: { user_id: params.userContext.userId, source: "cos-prompt-engineer" },
    });
    const parsed = parseJsonArray(res.content ?? "");
    if (!parsed) return [];
    const out: string[] = [];
    for (const x of parsed) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
    return out.slice(0, n);
  }

  async optimizeResearchPrompt(params: {
    rawRequest: string;
    userContext: AgentContext;
    taskType: "research" | "analysis" | "draft" | "decision";
  }): Promise<OptimizedPrompt> {
    const complexity = this.classifyComplexity(params.rawRequest);
    const queries = await this.buildSearchQueries({
      rawRequest: params.rawRequest,
      userContext: params.userContext,
      numQueries: 3,
    });
    const mid = selectModel({
      taskType: params.taskType,
      complexity,
      requiresWebSearch: true,
      isRetry: false,
      agentType: "prompt_engineer",
    });
    const recommended_model: AgentModel = mid === MODEL_IDS.opus
      ? "opus"
      : mid === MODEL_IDS.haiku
      ? "haiku"
      : "sonnet";

    const system =
      "Du bist ein Research-Assistent. Nutze nur verlässliche Aussagen; markiere Unsicherheiten.";
    const user =
      `Aufgabe (${params.taskType}):\n${params.rawRequest}\n\n` +
      `Vorgeschlagene Suchschritte:\n${
        queries.map((q, i) => `${i + 1}. ${q}`).join("\n")
      }`;

    return {
      system_prompt: system,
      user_prompt: user,
      search_queries: queries,
      recommended_model,
      estimated_complexity: complexity,
    };
  }
}
