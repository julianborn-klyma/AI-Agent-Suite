import type { DatabaseClient } from "../db/databaseClient.ts";
import type { DocumentService } from "../services/documentService.ts";
import type { LearningService } from "../services/learningService.ts";
import type { LlmMessage } from "../services/llm/llmTypes.ts";
import type { AgentContext, LearningCandidate, UserContextRow } from "./types.ts";

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

  const nowFormatted = formatGermanDateTime(now());
  const systemPrompt = injectPromptPlaceholders(
    config.system_prompt,
    block,
    nowFormatted,
  );
  const connectedTools = config.tools_enabled?.length
    ? config.tools_enabled
    : ["notion"];

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
