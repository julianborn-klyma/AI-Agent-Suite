import type { DatabaseClient } from "../db/databaseClient.ts";
import type { DocumentService } from "../services/documentService.ts";
import type { LearningService } from "../services/learningService.ts";
import type { LlmMessage } from "../services/llm/llmTypes.ts";
import type { AgentContext, LearningCandidate, UserContextRow } from "./types.ts";
import type { BrainService } from "../services/brain/BrainService.ts";
import type { FirmBrainService } from "../services/brain/FirmBrainService.ts";
import type { BrainEntry, FirmInsight } from "../db/databaseClient.ts";

function formatGermanDateTime(date: Date): string {
  const timeZone = "Europe/Berlin";
  const weekday = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    timeZone,
  }).format(date);
  const day = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    timeZone,
  }).format(date);
  const month = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    timeZone,
  }).format(date);
  const year = new Intl.DateTimeFormat("de-DE", {
    year: "numeric",
    timeZone,
  }).format(date);
  const hm = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return `${weekday}, ${day}. ${month} ${year}, ${hm} Uhr`;
}

export interface BrainContextParams {
  projectId?: string | null;
  tenantId?: string | null;
  userMessage?: string;
  brainService?: BrainService;
  firmBrainService?: FirmBrainService;
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  fact: "Fakt",
  decision: "Entscheidung",
  preference: "Präferenz",
  context: "Kontext",
  process: "Prozess",
};

function formatProjectContext(entries: BrainEntry[]): string {
  const lines = entries.map((e) => {
    const date = new Date(e.created_at).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const label = ENTRY_TYPE_LABELS[e.type] ?? e.type;
    return `• ${label} (${date}): ${e.content}`;
  });
  return `[PROJEKT-WISSEN]\n${lines.join("\n")}\n[/PROJEKT-WISSEN]`;
}

function formatFirmContext(insights: FirmInsight[]): string {
  const lines = insights.map((i) => `• ${i.content}`);
  return `[FIRMEN-KONTEXT]\n${lines.join("\n")}\n[/FIRMEN-KONTEXT]`;
}

function buildUserContextBlock(rows: UserContextRow[]): string {
  return rows.map((r) => `${r.key}: ${r.value}`).join("\n");
}

function injectPromptPlaceholders(
  template: string,
  userContextBlock: string,
  nowFormatted: string,
): string {
  return template
    .replaceAll("{{USER_CONTEXT}}", userContextBlock)
    .replaceAll("{{NOW}}", nowFormatted);
}

/**
 * Lädt cos_user_contexts, cos_learnings (Kontext), Profil, agent_config.
 * Optional: `learningService` für den Markdown-Block „Was ich über dich weiß“ im USER_CONTEXT.
 */
export async function loadAgentContext(
  db: DatabaseClient,
  userId: string,
  now: () => Date,
  recentHistory: LlmMessage[],
  learningService?: LearningService,
  documentService?: DocumentService,
  brainParams?: BrainContextParams,
): Promise<AgentContext> {
  const config = await db.findAgentConfigForUser(userId);
  if (config === null || config.system_prompt.trim() === "") {
    throw new Error(
      `Kein agent_config (User oder Template) für user_id=${userId}`,
    );
  }
  const userContexts = await db.listUserContexts(userId);

  const learningRows = await db.getLearnings(userId, {
    activeOnly: true,
    limit: 50,
    minConfidence: 0.6,
  });
  const learnings: LearningCandidate[] = learningRows.map((l) => ({
    kind: l.category,
    category: l.category,
    summary: l.content,
    content: l.content,
    source: l.source,
    confidence: l.confidence,
  }));

  const learningBlock = learningService
    ? (await learningService.buildLearningContext(userId)).trim()
    : "";

  const documentBlock = documentService
    ? (await documentService.buildDocumentContext(userId)).trim()
    : "";

  const baseBlock = buildUserContextBlock(userContexts);
  let block = baseBlock;
  if (learningBlock.trim()) {
    block = block.trim() ? `${block}\n\n${learningBlock}` : learningBlock;
  }
  if (documentBlock.trim()) {
    block = block.trim() ? `${block}\n\n${documentBlock}` : documentBlock;
  }

  // Project Knowledge: curated entries from the project the user is chatting in
  if (
    brainParams?.projectId &&
    brainParams.brainService &&
    brainParams.userMessage
  ) {
    try {
      const entries = await brainParams.brainService.getContextForAgent(
        [brainParams.projectId],
        userId,
        brainParams.userMessage,
        10,
      );
      if (entries.length > 0) {
        const projectBlock = formatProjectContext(entries);
        block = block.trim() ? `${block}\n\n${projectBlock}` : projectBlock;
      }
    } catch {
      // Non-fatal — brain context is best-effort
    }
  }

  // Firm Brain: auto-extracted tenant-wide insights (semantic search)
  if (
    brainParams?.firmBrainService &&
    brainParams.tenantId &&
    brainParams.userMessage
  ) {
    try {
      const insights = await brainParams.firmBrainService.getRelevantInsights(
        brainParams.tenantId,
        brainParams.userMessage,
        5,
      );
      if (insights.length > 0) {
        const firmBlock = formatFirmContext(insights);
        block = block.trim() ? `${block}\n\n${firmBlock}` : firmBlock;
      }
    } catch {
      // Non-fatal
    }
  }

  const nowFormatted = formatGermanDateTime(now());
  const systemPrompt = injectPromptPlaceholders(
    config.system_prompt,
    block,
    nowFormatted,
  );
  const baseTools = config.tools_enabled?.length
    ? config.tools_enabled
    : ["notion"];
  const connectedTools = [...new Set([...baseTools, "web_search", "workspace"])];

  const profile = await db.findUserProfileById(userId);

  return {
    userId,
    systemPrompt,
    userContexts,
    userProfile: profile,
    learnings,
    connectedTools,
    recentHistory,
  };
}

/** Nur aufgelöster System-Prompt (z. B. buildSystemPrompt-Tests). */
export async function buildSystemPromptForUser(
  db: DatabaseClient,
  userId: string,
  now: () => Date,
  learningService?: LearningService,
  documentService?: DocumentService,
): Promise<string> {
  const ctx = await loadAgentContext(
    db,
    userId,
    now,
    [],
    learningService,
    documentService,
  );
  return ctx.systemPrompt;
}
