import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";
import { LearningService } from "../services/learningService.ts";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Speichert eine kurze Tagesreflexion (Kontext + optionale Learnings-Extraktion).
 * POST /api/reflection/daily
 */
export async function handleReflectionDailyPost(
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
    return jsonResponse({ error: "Ungültiges JSON." }, { status: 400 });
  }

  const mood = typeof body.mood === "string" ? body.mood.trim() : "";
  const priorities = typeof body.priorities === "string"
    ? body.priorities.trim()
    : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const combined = [mood && `Stimmung: ${mood}`, priorities && `Fokus: ${priorities}`, note]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (combined.length < 3) {
    return jsonResponse(
      { error: "Mindestens mood, priorities oder note (je min. 1 Zeichen) angeben." },
      { status: 400 },
    );
  }

  const dayKey = utcDayKey();
  const key = `daily_reflection_${dayKey}`;
  await deps.db.upsertUserContext({ userId, key, value: combined.slice(0, 12_000) });

  const learningService = new LearningService(deps.db, deps.llm);
  const sessionId = `reflection-${dayKey}`;
  const candidates = await learningService.extractFromConversation({
    userId,
    sessionId,
    messages: [{ role: "user", content: combined }],
  });
  let learnings_saved = 0;
  if (candidates.length > 0) {
    const saved = await deps.db.upsertLearnings(userId, candidates);
    learnings_saved = saved.length;
  }

  return jsonResponse({
    ok: true,
    day_key: dayKey,
    learnings_saved,
  });
}
