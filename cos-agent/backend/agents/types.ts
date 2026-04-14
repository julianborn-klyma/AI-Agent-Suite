import type { LlmMessage } from "../services/llm/llmTypes.ts";

export type UserContextRow = { key: string; value: string };

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: string;
};

/** Laufzeit-Kontext für Orchestrator und Sub-Agents. */
export type AgentContext = {
  userId: string;
  /** Aufgelöster System-Prompt inkl. {{USER_CONTEXT}} / {{NOW}}. */
  systemPrompt: string;
  userContexts: UserContextRow[];
  userProfile: UserProfile | null;
  /** Aktive Learnings aus cos_learnings (Kurzform für Intent). */
  learnings: LearningCandidate[];
  /** Aus agent_config (User/Template), Default wie bisher `["notion"]`. */
  connectedTools: string[];
  /** Letzte Chat-Turns (User/Assistant), chronologisch. */
  recentHistory: LlmMessage[];
};

export type SubAgentResult = {
  agentType: string;
  success: boolean;
  data?: unknown;
  error?: string;
  learningCandidates?: LearningCandidate[];
  durationMs?: number;
};

export type AgentStep = {
  agent: string;
  task: Record<string, unknown>;
  rationale?: string;
};

export type AgentPlan = {
  steps: AgentStep[];
  reasoning?: string;
};

export type ValidationIssue = {
  type:
    | "hallucination"
    | "irrelevant"
    | "wrong_tone"
    | "incomplete"
    | string;
  severity: "low" | "medium" | "high";
  detail: string;
};

export type ValidationResult = {
  approved: boolean;
  issues: ValidationIssue[];
  needsRetry: boolean;
  retryFeedback?: string;
  newLearnings?: LearningCandidate[];
};

/** Kandidat für cos_learnings (LLM-Extraktion / Validator). */
export type LearningCandidate = {
  /** Legacy / Intent */
  kind?: string;
  /** DB-Spalte category */
  category?: string;
  summary?: string;
  content?: string;
  source?: string;
  source_ref?: string;
  confidence?: number;
};

export type OrchestratorResult = {
  content: string;
  tool_calls_made: string[];
  stop_reason: string;
};
