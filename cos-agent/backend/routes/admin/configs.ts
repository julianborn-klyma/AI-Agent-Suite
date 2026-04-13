import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import {
  assignConfigFromTemplate,
  createConfig,
  deleteConfig,
  getConfigById,
  listConfigs,
  updateConfig,
} from "../../services/adminService.ts";
import { jsonResponse } from "../json.ts";
import { requireAdminContext } from "./guard.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseConfigId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export async function handleAdminConfigsList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const data = await listConfigs(deps.sql);
  return jsonResponse(data);
}

export async function handleAdminConfigsCreate(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

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
  const name = o.name;
  const system_prompt = o.system_prompt;
  if (typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "name ist Pflicht." }, { status: 400 });
  }
  if (typeof system_prompt !== "string" || !system_prompt.trim()) {
    return jsonResponse({ error: "system_prompt ist Pflicht." }, {
      status: 400,
    });
  }
  let tools_enabled: string[] = [];
  if (o.tools_enabled !== undefined) {
    if (!Array.isArray(o.tools_enabled) || !o.tools_enabled.every((x) => typeof x === "string")) {
      return jsonResponse({ error: "tools_enabled muss string[] sein." }, {
        status: 400,
      });
    }
    tools_enabled = o.tools_enabled as string[];
  }
  const is_template = o.is_template === true;

  const row = await createConfig(deps.sql, {
    name: name.trim(),
    system_prompt: system_prompt.trim(),
    tools_enabled,
    is_template,
  });
  return jsonResponse(row, { status: 201 });
}

export async function handleAdminConfigPatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  configId: string,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const id = parseConfigId(configId);
  if (id === null) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }

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
  const patch: { name?: string; system_prompt?: string; tools_enabled?: string[] } = {};
  if ("name" in o) {
    if (typeof o.name !== "string") {
      return jsonResponse({ error: "name muss ein String sein." }, {
        status: 400,
      });
    }
    patch.name = o.name;
  }
  if ("system_prompt" in o) {
    if (typeof o.system_prompt !== "string") {
      return jsonResponse({ error: "system_prompt muss ein String sein." }, {
        status: 400,
      });
    }
    patch.system_prompt = o.system_prompt;
  }
  if ("tools_enabled" in o) {
    if (!Array.isArray(o.tools_enabled) || !o.tools_enabled.every((x) => typeof x === "string")) {
      return jsonResponse({ error: "tools_enabled muss string[] sein." }, {
        status: 400,
      });
    }
    patch.tools_enabled = o.tools_enabled as string[];
  }

  const updated = await updateConfig(deps.sql, id, patch);
  if (!updated) {
    return jsonResponse({ error: "Config nicht gefunden." }, { status: 404 });
  }
  return jsonResponse(updated);
}

export async function handleAdminConfigDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  configId: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const id = parseConfigId(configId);
  if (id === null) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }
  const ok = await deleteConfig(deps.sql, id);
  if (!ok) {
    return jsonResponse({ error: "Config nicht gefunden." }, { status: 404 });
  }
  return jsonResponse({ deleted: true });
}

export async function handleAdminConfigAssign(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  configId: string,
  targetUserId: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const id = parseConfigId(configId);
  if (id === null) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }
  if (!UUID_RE.test(targetUserId)) {
    return jsonResponse({ error: "userId ungültig." }, { status: 400 });
  }
  const user = await deps.sql`
    SELECT id FROM cos_users WHERE id = ${targetUserId}::uuid LIMIT 1
  ` as { id: string }[];
  if (!user[0]) {
    return jsonResponse({ error: "User nicht gefunden." }, { status: 404 });
  }
  const tpl = await getConfigById(deps.sql, id);
  if (!tpl || !tpl.is_template) {
    return jsonResponse(
      { error: "Nur Templates können zugewiesen werden." },
      { status: 400 },
    );
  }
  const newId = await assignConfigFromTemplate(deps.sql, id, targetUserId);
  if (!newId) {
    return jsonResponse({ error: "Template nicht gefunden." }, { status: 404 });
  }
  return jsonResponse({ config_id: newId }, { status: 201 });
}
