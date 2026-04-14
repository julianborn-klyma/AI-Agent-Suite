import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import type { AgentContext } from "../agents/types.ts";
import { loadAgentContext } from "../agents/contextLoader.ts";
import { requireAuth } from "../middleware/auth.ts";
import { PromptEngineerService } from "../services/promptEngineerService.ts";
import { jsonResponse } from "./json.ts";

const TASK_TYPES = new Set(["research", "analysis", "draft", "decision"]);

function svc(deps: AppDependencies): PromptEngineerService {
  return new PromptEngineerService(deps.llm);
}

type LoadCtxOk = { ok: true; userContext: AgentContext };
type LoadCtxErr =
  | { ok: false; response: Response };

async function loadCtx(req: Request, env: AppEnv, deps: AppDependencies): Promise<LoadCtxOk | LoadCtxErr> {
  const userId = await requireAuth(req, env);
  if (!userId) {
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) };
  }
  try {
    const userContext = await loadAgentContext(
      deps.db,
      userId,
      () => new Date(),
      [],
      undefined,
      deps.documentService,
    );
    return { ok: true, userContext };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      response: jsonResponse(
        {
          error: "Agent-Kontext konnte nicht geladen werden.",
          detail: msg,
        },
        { status: 503 },
      ),
    };
  }
}

export async function handlePromptEngineerOptimize(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await loadCtx(req, env, deps);
  if (!gate.ok) return gate.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }
  const raw = typeof body.raw_request === "string" ? body.raw_request.trim() : "";
  if (!raw || raw.length < 10) {
    return jsonResponse(
      { error: "raw_request ist Pflicht und mindestens 10 Zeichen lang." },
      { status: 400 },
    );
  }
  if (raw.length > 2000) {
    return jsonResponse(
      { error: "raw_request darf höchstens 2000 Zeichen haben." },
      { status: 400 },
    );
  }
  const taskType = typeof body.task_type === "string" ? body.task_type.trim() : "";
  if (!TASK_TYPES.has(taskType)) {
    return jsonResponse(
      { error: 'task_type muss "research", "analysis", "draft" oder "decision" sein.' },
      { status: 400 },
    );
  }
  const out = await svc(deps).optimizeResearchPrompt({
    rawRequest: raw,
    userContext: gate.userContext,
    taskType: taskType as "research" | "analysis" | "draft" | "decision",
  });
  return jsonResponse(out);
}

export async function handlePromptEngineerSearchQueries(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await loadCtx(req, env, deps);
  if (!gate.ok) return gate.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }
  const raw = typeof body.raw_request === "string" ? body.raw_request.trim() : "";
  if (!raw || raw.length < 5) {
    return jsonResponse(
      { error: "raw_request ist Pflicht und mindestens 5 Zeichen lang." },
      { status: 400 },
    );
  }
  let numQueries = 3;
  if (body.num_queries !== undefined && body.num_queries !== null) {
    const n = Number(body.num_queries);
    if (!Number.isFinite(n) || n < 1) {
      return jsonResponse({ error: "num_queries ungültig" }, { status: 400 });
    }
    numQueries = Math.floor(n);
  }
  const queries = await svc(deps).buildSearchQueries({
    rawRequest: raw,
    userContext: gate.userContext,
    numQueries,
  });
  return jsonResponse({ queries });
}

export async function handlePromptEngineerClassify(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message : "";
  const complexity = svc(deps).classifyComplexity(message);
  return jsonResponse({ complexity });
}
