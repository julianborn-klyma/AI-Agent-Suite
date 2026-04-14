export type AgentModel = "haiku" | "sonnet" | "opus";

export const MODEL_IDS: Record<AgentModel, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-20250514",
};

export interface ModelSelectionContext {
  taskType: string;
  complexity: "low" | "medium" | "high";
  requiresWebSearch: boolean;
  isRetry: boolean;
  agentType: string;
}

export function selectModel(ctx: ModelSelectionContext): string {
  if (ctx.isRetry) return MODEL_IDS.opus;
  if (ctx.taskType === "intent_analysis") return MODEL_IDS.haiku;
  if (ctx.agentType === "prompt_engineer") return MODEL_IDS.sonnet;
  if (ctx.agentType === "validator") return MODEL_IDS.haiku;
  if (ctx.agentType === "cfo") return MODEL_IDS.opus;
  if (ctx.taskType === "review_document") return MODEL_IDS.opus;
  if (ctx.taskType === "financial_analysis") return MODEL_IDS.opus;
  if (ctx.complexity === "high") return MODEL_IDS.opus;

  if (ctx.agentType === "learning") return MODEL_IDS.haiku;
  if (ctx.taskType === "categorize") return MODEL_IDS.haiku;
  if (ctx.taskType === "extract_context") return MODEL_IDS.haiku;
  if (ctx.taskType === "validate" && !ctx.isRetry) return MODEL_IDS.haiku;
  if (ctx.complexity === "low") return MODEL_IDS.haiku;

  return MODEL_IDS.sonnet;
}

/** USD — Preise pro 1M Tokens (April 2026, Richtwerte). */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
    "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
    "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  };
  const p = pricing[model] ?? pricing["claude-sonnet-4-20250514"];
  return (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output;
}
