import type { DatabaseClient } from "../db/databaseClient.ts";
import type { DocumentService } from "../services/documentService.ts";
import type { LlmClient, LlmMessage } from "../services/llm/llmTypes.ts";
import type { ToolExecutor } from "../services/tools/toolExecutor.ts";
import { MODEL_IDS } from "./modelSelector.ts";
import { loadAgentContext } from "./contextLoader.ts";
import { parseJsonObject } from "./jsonUtils.ts";
import type {
  AgentContext,
  AgentPlan,
  AgentStep,
  OrchestratorResult,
  SubAgentResult,
} from "./types.ts";
import { BaseSubAgent } from "./subagents/base.ts";
import { CalendarAgent } from "./subagents/calendarAgent.ts";
import { CfoAgent } from "./subagents/cfoAgent.ts";
import { DriveAgent } from "./subagents/driveAgent.ts";
import { GmailAgent } from "./subagents/gmailAgent.ts";
import { NotionAgent } from "./subagents/notionAgent.ts";
import { SlackAgent } from "./subagents/slackAgent.ts";
import type { AggregatorAgent } from "./aggregator.ts";
import type { LearningService } from "../services/learningService.ts";
import { LearningAgent } from "./subagents/learningAgent.ts";
import { WebSearchAgent } from "./subagents/webSearchAgent.ts";
import type { ValidatorAgent } from "./validator.ts";
import { PromptEngineerService } from "../services/promptEngineerService.ts";

function contextValue(
  rows: { key: string; value: string }[],
  key: string,
): string {
  return rows.find((r) => r.key === key)?.value ?? "";
}

const CFO_KEYWORD_RE =
  /cashflow|finanzierung|businessplan|bba|budget|kosten|umsatz|investition|runway|bankability|liquidität|bilanz|gewinn|verlust|forecast/i;

const WEB_KEYWORD_RE =
  /recherchiere|suche|aktuelle|news|heute|markt|wettbewerb|preis|förderung|gesetz|entwicklung|trend|studie|bericht/i;

function cfoKeywordPlan(message: string, context: AgentContext): AgentPlan | null {
  if (!context.connectedTools.includes("cfo")) return null;
  if (!CFO_KEYWORD_RE.test(message)) return null;
  return {
    steps: [{
      agent: "cfo",
      task: { type: "answer_question", question: message },
    }],
  };
}

export class OrchestratorAgent {
  protected agents: Map<string, BaseSubAgent>;
  private readonly learningAgent: LearningAgent;
  private readonly promptEngineer: PromptEngineerService;

  constructor(
    private llm: LlmClient,
    private db: DatabaseClient,
    private toolExecutor: ToolExecutor,
    private validator: ValidatorAgent,
    private aggregator: AggregatorAgent,
    private readonly nowFn: () => Date = () => new Date(),
    private readonly learningService: LearningService,
    learningLlm: LlmClient,
    private readonly documentService: DocumentService,
  ) {
    this.promptEngineer = new PromptEngineerService(llm);
    this.agents = new Map<string, BaseSubAgent>([
      ["gmail", new GmailAgent(llm, db, toolExecutor)],
      ["notion", new NotionAgent(llm, db, toolExecutor)],
      ["slack", new SlackAgent(llm, db, toolExecutor)],
      ["drive", new DriveAgent(llm, db, toolExecutor)],
      ["calendar", new CalendarAgent(llm, db, toolExecutor)],
      ["cfo", new CfoAgent(llm, db, toolExecutor, documentService)],
      ["web_search", new WebSearchAgent(llm, db, toolExecutor)],
    ]);
    this.learningAgent = new LearningAgent(
      learningLlm,
      db,
      toolExecutor,
      learningService,
    );
  }

  async run(params: {
    userId: string;
    sessionId: string;
    message: string;
    retryCount?: number;
    retryFeedback?: string;
    historyMessages: LlmMessage[];
    now?: () => Date;
  }): Promise<OrchestratorResult> {
    const now = params.now ?? this.nowFn;
    let retryCount = params.retryCount ?? 0;
    let retryFeedback = params.retryFeedback;

    const tool_calls_made: string[] = [];
    let lastContent = "";

    while (true) {
      const context = await this.loadContext(
        params.userId,
        params.historyMessages,
        now,
      );
      if (retryFeedback) {
        context.learnings = [
          ...context.learnings,
          {
            kind: "retry_feedback",
            summary: retryFeedback,
            source: "validator",
          },
        ];
      }

      const plan = await this.analyzeIntent(
        params.message,
        context,
        retryFeedback,
      );

      const settled = await Promise.allSettled(
        plan.steps.map(async (step) => {
          const agent = this.agents.get(step.agent);
          if (!agent) {
            return {
              agentType: step.agent,
              success: false,
              error: `Unbekannter Agent: ${step.agent}`,
            } satisfies SubAgentResult;
          }
          if (!context.connectedTools.includes(step.agent)) {
            return {
              agentType: step.agent,
              success: false,
              error: `${step.agent} nicht für diesen User aktiviert`,
            } satisfies SubAgentResult;
          }
          tool_calls_made.push(step.agent);
          return await agent.execute(step.task, context);
        }),
      );

      const results: SubAgentResult[] = settled.map((s, i) => {
        if (s.status === "fulfilled") return s.value;
        const step = plan.steps[i]!;
        return {
          agentType: step.agent,
          success: false,
          error: s.reason instanceof Error
            ? s.reason.message
            : String(s.reason),
        };
      });

      const aggregated = await this.aggregator.aggregate({
        originalMessage: params.message,
        results,
        context,
      });
      lastContent = aggregated;

      const validation = await this.validator.validate({
        originalMessage: params.message,
        proposedResponse: aggregated,
        results,
        context,
        isRetry: retryCount > 0,
      });

      if (validation.needsRetry && retryCount < 2) {
        retryFeedback =
          validation.retryFeedback ??
          validation.issues.find((i) => i.severity === "high")?.detail ??
          "Bitte Antwort anhand der Tool-Daten korrigieren.";
        retryCount += 1;
        continue;
      }

      if (!validation.needsRetry) {
        const conversationMessages = [
          ...params.historyMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role,
              content: typeof m.content === "string" ? m.content : "",
            })),
          { role: "user", content: params.message },
          { role: "assistant", content: aggregated },
        ];
        void this.runLearningAsync(params.userId, params.sessionId, {
          messages: conversationMessages.slice(-12),
          agentResults: results,
          context,
        }).catch((err) =>
          console.error({
            level: "error",
            job: "learning",
            userId: params.userId,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }

      break;
    }

    return {
      content: lastContent,
      tool_calls_made,
      stop_reason: "end_turn",
    };
  }

  private async loadContext(
    userId: string,
    historyMessages: LlmMessage[],
    now: () => Date,
  ): Promise<AgentContext> {
    return await loadAgentContext(
      this.db,
      userId,
      now,
      historyMessages,
      this.learningService,
      this.documentService,
    );
  }

  private async runLearningAsync(
    userId: string,
    sessionId: string,
    data: {
      messages: Array<{ role: string; content: string }>;
      agentResults: SubAgentResult[];
      context: AgentContext;
    },
  ): Promise<void> {
    await this.learningAgent.execute(
      {
        type: "extract_from_conversation",
        sessionId,
        messages: data.messages,
        agentResults: data.agentResults,
      },
      data.context,
    );
  }

  async analyzeIntent(
    message: string,
    context: AgentContext,
    retryFeedback?: string,
  ): Promise<AgentPlan> {
    const available = [...this.agents.keys()].filter((k) =>
      context.connectedTools.includes(k)
    );
    const cfoQuick = cfoKeywordPlan(message, context);
    if (cfoQuick && cfoQuick.steps.every((s) => available.includes(s.agent))) {
      return cfoQuick;
    }

    const complexity = this.promptEngineer.classifyComplexity(message);
    const webHit = WEB_KEYWORD_RE.test(message);
    let researchBlock = "";
    if (complexity === "high" || webHit) {
      try {
        const opt = await this.promptEngineer.optimizeResearchPrompt({
          rawRequest: message,
          userContext: context,
          taskType: "research",
        });
        researchBlock =
          `\n\nResearch-Vorbereitung (System):\n${opt.system_prompt}\n\nResearch-Vorbereitung (User):\n${opt.user_prompt}`;
      } catch {
        /* Prompt-Engineer optional */
      }
    }

    const learningHint = context.learnings.length
      ? `\nAktive Learnings:\n${
        context.learnings.map((l) =>
          `- ${l.kind ?? l.category ?? "?"}: ${l.summary ?? l.content ?? ""}`
        ).join("\n")
      }`
      : "";

    const userBlock =
      `Nutzerfrage:\n${message}\n` +
      (retryFeedback
        ? `\nKorrektur vom Validator (Retry):\n${retryFeedback}\n`
        : "") +
      `\nKomplexität (Heuristik): ${complexity}.` +
      researchBlock +
      `\nVerfügbare Agents (nur diese verwenden): ${available.join(", ")}.` +
      learningHint +
      "\n\nAntworte NUR mit JSON im Format " +
      '{"steps":[{"agent":"notion"|"gmail"|"slack"|"drive"|"calendar"|"cfo"|"web_search","task":{...},"rationale":"optional"}],"reasoning":"optional"}';

    const res = await this.llm.chat({
      model: MODEL_IDS.haiku,
      system:
        "Du bist ein Intent-Analyzer. Antworte NUR mit JSON. Nutze ausschließlich die genannten Agents.",
      messages: [{ role: "user", content: userBlock }],
      metadata: { user_id: context.userId, source: "cos-agent" },
    });

    const parsed = parseJsonObject<{ steps?: unknown }>(res.content ?? "");
    if (!parsed || !Array.isArray(parsed.steps)) {
      return this.fallbackPlan(context);
    }
    const steps: AgentStep[] = [];
    for (const raw of parsed.steps) {
      if (raw === null || typeof raw !== "object") continue;
      const o = raw as Record<string, unknown>;
      const agent = typeof o.agent === "string" ? o.agent : "";
      const task = o.task;
      if (!agent || task === null || typeof task !== "object") continue;
      steps.push({
        agent,
        task: task as Record<string, unknown>,
        rationale: typeof o.rationale === "string" ? o.rationale : undefined,
      });
    }
    if (steps.length === 0) return this.fallbackPlan(context);
    const filtered = steps.filter((s) => available.includes(s.agent));
    if (filtered.length === 0) return this.fallbackPlan(context);

    const shouldInjectWeb =
      (complexity === "high" || webHit) &&
      available.includes("web_search") &&
      !filtered.some((s) => s.agent === "web_search");
    if (shouldInjectWeb) {
      filtered.unshift({
        agent: "web_search",
        task: {
          type: "research",
          query: message,
          depth: complexity === "high" ? "deep" : "quick",
        },
      });
    }

    return {
      steps: filtered,
      reasoning: typeof (parsed as { reasoning?: unknown }).reasoning ===
          "string"
        ? String((parsed as { reasoning?: string }).reasoning)
        : undefined,
    };
  }

  private fallbackPlan(context: AgentContext): AgentPlan {
    const steps: AgentStep[] = [];
    for (const t of context.connectedTools) {
      if (!this.agents.has(t)) continue;
      if (t === "notion") {
        const dbId = contextValue(context.userContexts, "notion_database_id");
        steps.push({
          agent: "notion",
          task: { action: "list_tasks", database_id: dbId },
        });
      }
      if (t === "gmail") {
        steps.push({
          agent: "gmail",
          task: { action: "list_unread", max_results: 10 },
        });
      }
      if (t === "slack") {
        steps.push({
          agent: "slack",
          task: { action: "summarize_day" },
        });
      }
      if (t === "drive") {
        steps.push({
          agent: "drive",
          task: { action: "sync_new_documents" },
        });
      }
      if (t === "calendar") {
        steps.push({
          agent: "calendar",
          task: { action: "get_today" },
        });
      }
    }
    return { steps };
  }
}
