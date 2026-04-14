import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { requireAuth } from "../middleware/auth.ts";
import { serializeLearningForApi } from "../services/emailStyleService.ts";
import { jsonResponse } from "./json.ts";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export async function handleEmailStyleLearnPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  const result = await deps.emailStyleService.learnEmailStyle(userId);
  return jsonResponse(result);
}

export async function handleEmailStyleGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  const rows = await deps.db.getLearnings(userId, {
    categories: ["email_style"],
    limit: 1,
    activeOnly: true,
  });
  const style = rows[0] ?? null;
  return jsonResponse({
    style: style ? serializeLearningForApi(style) : null,
    last_updated: style ? style.last_confirmed.toISOString() : null,
  });
}

export async function handleEmailStyleDraftPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const message_id = typeof body.message_id === "string" ? body.message_id.trim() : "";
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const textBody = typeof body.body === "string" ? body.body : "";
  if (!message_id || !from || !subject || !textBody.trim()) {
    return jsonResponse(
      { error: "message_id, from, subject und body sind Pflichtfelder." },
      { status: 400 },
    );
  }
  const context = typeof body.context === "string" && body.context.trim()
    ? body.context.trim()
    : undefined;
  const result = await deps.emailStyleService.createStyledDraft({
    userId,
    inReplyTo: { message_id, from, subject, body: textBody },
    context,
  });
  return jsonResponse(result);
}
