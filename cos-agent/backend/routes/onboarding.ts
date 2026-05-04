import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { requireAuth } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";
import { OnboardingService } from "../services/onboardingService.ts";
import { ensurePersonalWikiPages } from "../services/personalWikiSeed.ts";
import { withWorkspaceTx } from "../services/workspaceService.ts";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function svc(deps: AppDependencies): OnboardingService {
  return new OnboardingService(deps.db, deps.tenantService, deps.auditService);
}

export async function handleOnboardingStatusGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  const status = await svc(deps).getStatus(userId);
  return jsonResponse(status);
}

export async function handleOnboardingCompletePost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  await svc(deps).completeOnboarding(userId, req);
  const seeded = await withWorkspaceTx(deps.sql, userId, async (tx, tenantId) => {
    await ensurePersonalWikiPages(tx, tenantId, userId);
    return true;
  });
  if (!seeded.ok) {
    return jsonResponse(
      { completed: true, personal_wiki_seed: false, error: seeded.message },
      { status: 200 },
    );
  }
  return jsonResponse({ completed: true, personal_wiki_seed: true });
}

export async function handleOnboardingProfilePost(
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
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  const role = typeof o.role === "string" ? o.role.trim() : "";
  if (role.length < 3) {
    return jsonResponse(
      { error: "role ist Pflicht und muss mindestens 3 Zeichen haben." },
      { status: 400 },
    );
  }

  await deps.db.upsertUserContext({ userId, key: "role", value: role });

  const team = typeof o.team === "string" ? o.team.trim() : "";
  if (team) {
    await deps.db.upsertUserContext({ userId, key: "team", value: team });
  }
  const priorities = typeof o.priorities === "string" ? o.priorities.trim() : "";
  if (priorities) {
    await deps.db.upsertUserContext({
      userId,
      key: "current_focus",
      value: priorities,
    });
  }
  const comm = typeof o.communication_style === "string"
    ? o.communication_style.trim()
    : "";
  if (comm) {
    await deps.db.upsertUserContext({
      userId,
      key: "communication_preference",
      value: comm,
    });
  }
  const work = typeof o.work_style === "string" ? o.work_style.trim() : "";
  if (work) {
    await deps.db.upsertUserContext({ userId, key: "work_style", value: work });
  }

  return jsonResponse({ saved: true });
}

export async function handleOnboardingSkipPost(
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
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const step = (body as Record<string, unknown>).step;
  if (step !== "connections" && step !== "chat") {
    return jsonResponse(
      { error: "step muss \"connections\" oder \"chat\" sein." },
      { status: 400 },
    );
  }
  await svc(deps).skipStep(userId, step);
  return jsonResponse({ skipped: true });
}
