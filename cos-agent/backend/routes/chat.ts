import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { requireAuth } from "../middleware/auth.ts";
import {
  deleteSession,
  ForbiddenError,
  getHistory,
  getSessions,
  parseHistoryQuery,
  postChat,
  SessionNotFoundError,
} from "../services/chatService.ts";
import { jsonResponse } from "./json.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export async function handleChatPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: "Ungültiger JSON-Body." },
      { status: 400 },
    );
  }

  const result = await postChat(deps, userId, body);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, { status: result.status });
  }
  return jsonResponse(result.data);
}

export async function handleChatHistoryGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  const url = new URL(req.url);
  const parsed = parseHistoryQuery(
    url.searchParams.get("session_id"),
    url.searchParams.get("limit"),
  );
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, { status: parsed.status });
  }

  try {
    const data = await getHistory(
      deps.db,
      userId,
      parsed.sessionId,
      parsed.limit,
    );
    return jsonResponse(data);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return jsonResponse(
        { error: "Kein Zugriff auf diese Session." },
        { status: 403 },
      );
    }
    if (e instanceof SessionNotFoundError) {
      return jsonResponse({ error: e.message }, { status: 404 });
    }
    throw e;
  }
}

export async function handleChatSessionsGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  const data = await getSessions(deps.db, userId);
  return jsonResponse(data);
}

export async function handleChatSessionDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  sessionId: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  if (!UUID_RE.test(sessionId)) {
    return jsonResponse({ error: "session_id ungültig." }, { status: 400 });
  }

  try {
    await deleteSession(deps.db, userId, sessionId);
    return jsonResponse({ deleted: true });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return jsonResponse(
        { error: "Kein Zugriff auf diese Session." },
        { status: 403 },
      );
    }
    if (e instanceof SessionNotFoundError) {
      return jsonResponse({ error: e.message }, { status: 404 });
    }
    throw e;
  }
}
