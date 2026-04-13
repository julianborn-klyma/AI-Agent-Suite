import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import {
  createUser,
  deactivateUser,
  deleteUserContextKey,
  getUserById,
  getUserContext,
  listUsers,
  updateUser,
  upsertUserContext,
} from "../../services/adminService.ts";
import { jsonResponse } from "../json.ts";
import { requireAdminContext } from "./guard.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleAdminUsersList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const data = await listUsers(deps.sql);
  return jsonResponse(data);
}

export async function handleAdminUsersCreate(
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
  const email = o.email;
  const name = o.name;
  if (typeof email !== "string" || !email.trim()) {
    return jsonResponse({ error: "email ist Pflicht." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "name ist Pflicht." }, { status: 400 });
  }
  if (!email.includes("@")) {
    return jsonResponse({ error: "email ungültig." }, { status: 400 });
  }
  let role = "member";
  if (o.role !== undefined) {
    if (o.role !== "admin" && o.role !== "member") {
      return jsonResponse(
        { error: 'role muss "admin" oder "member" sein.' },
        { status: 400 },
      );
    }
    role = o.role;
  }

  const created = await createUser(deps.sql, {
    email: email.trim(),
    name: name.trim(),
    role,
  });
  if (created === "duplicate_email") {
    return jsonResponse({ error: "Email bereits vergeben" }, { status: 409 });
  }
  return jsonResponse(created, { status: 201 });
}

export async function handleAdminUserPatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  userId: string,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(userId)) {
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
  const patch: { name?: string; role?: string; is_active?: boolean } = {};
  if ("name" in o) {
    if (typeof o.name !== "string") {
      return jsonResponse({ error: "name muss ein String sein." }, {
        status: 400,
      });
    }
    patch.name = o.name;
  }
  if ("role" in o) {
    if (typeof o.role !== "string") {
      return jsonResponse({ error: "role muss ein String sein." }, {
        status: 400,
      });
    }
    patch.role = o.role;
  }
  if ("is_active" in o) {
    if (typeof o.is_active !== "boolean") {
      return jsonResponse({ error: "is_active muss boolean sein." }, {
        status: 400,
      });
    }
    patch.is_active = o.is_active;
  }

  const updated = await updateUser(deps.sql, userId, patch);
  if (!updated) {
    return jsonResponse({ error: "User nicht gefunden." }, { status: 404 });
  }
  return jsonResponse(updated);
}

export async function handleAdminUserDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  userId: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(userId)) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }
  const ok = await deactivateUser(deps.sql, userId);
  if (!ok) {
    return jsonResponse({ error: "User nicht gefunden." }, { status: 404 });
  }
  return jsonResponse({ deactivated: true });
}

export async function handleAdminUserContextGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  userId: string,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(userId)) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }
  const u = await getUserById(deps.sql, userId);
  if (!u) {
    return jsonResponse({ error: "User nicht gefunden." }, { status: 404 });
  }
  const data = await getUserContext(deps.sql, userId);
  return jsonResponse(data);
}

export async function handleAdminUserContextPut(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  userId: string,
): Promise<Response> {
  if (req.method !== "PUT") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(userId)) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }
  const u = await getUserById(deps.sql, userId);
  if (!u) {
    return jsonResponse({ error: "User nicht gefunden." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (!Array.isArray(body)) {
    return jsonResponse({ error: "Body muss ein JSON-Array sein." }, {
      status: 400,
    });
  }
  const entries: { key: string; value: string }[] = [];
  for (const item of body) {
    if (item === null || typeof item !== "object") {
      return jsonResponse({ error: "Ungültiger Kontext-Eintrag." }, {
        status: 400,
      });
    }
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string" || typeof row.value !== "string") {
      return jsonResponse({ error: "key und value müssen Strings sein." }, {
        status: 400,
      });
    }
    entries.push({ key: row.key, value: row.value });
  }

  const updated = await upsertUserContext(deps.sql, userId, entries);
  return jsonResponse({ updated });
}

export async function handleAdminUserContextKeyDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  userId: string,
  key: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(userId)) {
    return jsonResponse({ error: "id ungültig." }, { status: 400 });
  }
  const deleted = await deleteUserContextKey(deps.sql, userId, key);
  if (!deleted) {
    return jsonResponse({ error: "Kontext-Key nicht gefunden." }, {
      status: 404,
    });
  }
  return jsonResponse({ deleted: true });
}
