import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import {
  getUserById,
  listSchedulesGrouped,
  upsertSchedule,
} from "../../services/adminService.ts";
import { jsonResponse } from "../json.ts";
import { requireAdminContext } from "./guard.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleAdminSchedulesList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const data = await listSchedulesGrouped(deps.sql);
  return jsonResponse(data);
}

export async function handleAdminUserSchedulePut(
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
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  if (typeof o.cron_expression !== "string" || !o.cron_expression.trim()) {
    return jsonResponse({ error: "cron_expression ist Pflicht." }, {
      status: 400,
    });
  }
  if (o.delivery_channel !== "email" && o.delivery_channel !== "slack") {
    return jsonResponse(
      { error: 'delivery_channel muss "email" oder "slack" sein.' },
      { status: 400 },
    );
  }
  if (typeof o.delivery_target !== "string" || !o.delivery_target.trim()) {
    return jsonResponse({ error: "delivery_target ist Pflicht." }, {
      status: 400,
    });
  }
  let is_active: boolean | undefined;
  if ("is_active" in o) {
    if (typeof o.is_active !== "boolean") {
      return jsonResponse({ error: "is_active muss boolean sein." }, {
        status: 400,
      });
    }
    is_active = o.is_active;
  }

  const row = await upsertSchedule(deps.sql, userId, {
    cron_expression: o.cron_expression.trim(),
    delivery_channel: o.delivery_channel,
    delivery_target: o.delivery_target.trim(),
    is_active,
  });
  return jsonResponse(row);
}
