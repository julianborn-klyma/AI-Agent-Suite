import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { LearningOwnershipError } from "../db/databaseClient.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";

function parseLimit(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 100) return fallback;
  return n;
}

export async function handleLearningsList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const category = url.searchParams.get("category")?.trim() || undefined;
  const limit = parseLimit(url.searchParams.get("limit"), 20);

  const rows = await deps.db.getLearnings(userId, {
    activeOnly: true,
    limit,
    categories: category ? [category] : undefined,
  });
  return jsonResponse(rows);
}

export async function handleLearningConfirm(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  try {
    await deps.db.confirmLearning(id, userId);
    return jsonResponse({ confirmed: true });
  } catch (e) {
    if (e instanceof LearningOwnershipError) {
      return jsonResponse({ error: e.message }, { status: 403 });
    }
    throw e;
  }
}

export async function handleLearningDeactivate(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });

  try {
    await deps.db.deactivateLearning(id, userId);
    return jsonResponse({ deactivated: true });
  } catch (e) {
    if (e instanceof LearningOwnershipError) {
      return jsonResponse({ error: e.message }, { status: 403 });
    }
    throw e;
  }
}
