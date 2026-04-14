import type { AppDependencies } from "../app_deps.ts";
import type { DatabaseClient } from "../db/databaseClient.ts";
import { LlmClientError } from "./llm/llmTypes.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor(message = "Forbidden") {
    super(message);
  }
}

export class SessionNotFoundError extends Error {
  override readonly name = "SessionNotFoundError";
  constructor(message = "Session nicht gefunden.") {
    super(message);
  }
}

export type ChatPostResult =
  | {
    ok: true;
    data: {
      response: string;
      session_id: string;
      tool_calls_made: string[];
    };
  }
  | { ok: false; status: number; error: string };

export async function postChat(
  deps: AppDependencies,
  userId: string,
  body: unknown,
): Promise<ChatPostResult> {
  if (body === null || typeof body !== "object") {
    return { ok: false, status: 400, error: "Body muss ein JSON-Objekt sein." };
  }
  const o = body as Record<string, unknown>;
  const message = o.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return { ok: false, status: 400, error: "message darf nicht leer sein" };
  }
  const trimmed = message.trim();
  if (trimmed.length > 4000) {
    return {
      ok: false,
      status: 400,
      error: "message zu lang (max 4000 Zeichen)",
    };
  }

  let sessionId: string;
  if (o.session_id !== undefined && o.session_id !== null) {
    if (typeof o.session_id !== "string" || !UUID_RE.test(o.session_id)) {
      return {
        ok: false,
        status: 400,
        error: "session_id muss eine gültige UUID sein.",
      };
    }
    sessionId = o.session_id;
  } else {
    sessionId = crypto.randomUUID();
  }

  try {
    const out = await deps.agentService.chat({
      userId,
      sessionId,
      message: trimmed,
    });
    return {
      ok: true,
      data: {
        response: out.content,
        session_id: sessionId,
        tool_calls_made: out.tool_calls_made,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Chat fehlgeschlagen.";
    if (e instanceof LlmClientError) {
      const s = e.status;
      if (s === 529 || s === 503 || s === 502) {
        return { ok: false, status: 503, error: msg };
      }
      if (s === 429) {
        return { ok: false, status: 429, error: msg };
      }
    }
    return { ok: false, status: 500, error: msg };
  }
}

export type HistoryQueryParse =
  | { ok: true; sessionId: string; limit: number }
  | { ok: false; status: number; error: string };

export function parseHistoryQuery(
  sessionIdRaw: string | null,
  limitRaw: string | null,
): HistoryQueryParse {
  if (!sessionIdRaw?.trim()) {
    return { ok: false, status: 400, error: "session_id ist erforderlich." };
  }
  const sessionId = sessionIdRaw.trim();
  if (!UUID_RE.test(sessionId)) {
    return { ok: false, status: 400, error: "session_id ungültig." };
  }

  let limit = 20;
  if (limitRaw != null && limitRaw !== "") {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1) {
      return {
        ok: false,
        status: 400,
        error: "limit muss eine positive Ganzzahl sein.",
      };
    }
    limit = Math.min(n, 100);
  }

  return { ok: true, sessionId, limit };
}

export async function getSessionOwner(
  db: DatabaseClient,
  sessionId: string,
): Promise<string | null> {
  return db.getSessionOwnerUserId(sessionId);
}

export type ChatHistoryMessage = {
  role: string;
  content: string;
  created_at: string;
};

export async function getHistory(
  db: DatabaseClient,
  userId: string,
  sessionId: string,
  limit: number,
): Promise<ChatHistoryMessage[]> {
  const owner = await getSessionOwner(db, sessionId);
  if (owner === null) {
    throw new SessionNotFoundError();
  }
  if (owner !== userId) {
    throw new ForbiddenError();
  }
  const rows = await db.listChatHistoryForUser(userId, sessionId, limit);
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    created_at: r.created_at.toISOString(),
  }));
}

export type ChatSessionItem = {
  session_id: string;
  preview: string;
  last_activity: string;
  message_count: number;
};

export async function getSessions(
  db: DatabaseClient,
  userId: string,
): Promise<ChatSessionItem[]> {
  const rows = await db.listChatSessionsForUser(userId);
  return rows.map((r) => ({
    session_id: r.session_id,
    preview: r.preview,
    last_activity: r.last_activity.toISOString(),
    message_count: r.message_count,
  }));
}

export async function deleteSession(
  db: DatabaseClient,
  userId: string,
  sessionId: string,
): Promise<void> {
  const owner = await getSessionOwner(db, sessionId);
  if (owner === null) {
    throw new SessionNotFoundError();
  }
  if (owner !== userId) {
    throw new ForbiddenError();
  }
  await db.deleteChatSessionForUser(userId, sessionId);
}
