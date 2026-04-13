import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import { getCosts } from "../../services/adminService.ts";
import { jsonResponse } from "../json.ts";
import { requireAdminContext } from "./guard.ts";

function parseIsoDate(raw: string | null, label: string):
  | { ok: true; date: Date }
  | { ok: false; error: string } {
  if (!raw?.trim()) {
    return { ok: false, error: `${label} ist erforderlich.` };
  }
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: `${label} ist kein gültiges ISO-Datum.` };
  }
  return { ok: true, date: d };
}

export async function handleAdminCostsGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const fromP = parseIsoDate(url.searchParams.get("from"), "from");
  if (!fromP.ok) {
    return jsonResponse({ error: fromP.error }, { status: 400 });
  }
  const toP = parseIsoDate(url.searchParams.get("to"), "to");
  if (!toP.ok) {
    return jsonResponse({ error: toP.error }, { status: 400 });
  }
  if (fromP.date.getTime() > toP.date.getTime()) {
    return jsonResponse(
      { error: "from darf nicht nach to liegen." },
      { status: 400 },
    );
  }

  const { by_user, totals } = await getCosts(deps.sql, fromP.date, toP.date);
  return jsonResponse({ by_user, totals });
}
