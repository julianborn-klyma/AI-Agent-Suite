import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import { jsonResponse } from "../json.ts";
import { requireAdminContext } from "./guard.ts";

export async function handleAdminTenantUiPatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }

  if (typeof body.ui_show_tenant_wiki !== "boolean") {
    return jsonResponse(
      { error: "ui_show_tenant_wiki muss boolean sein." },
      { status: 400 },
    );
  }

  const tenant = await deps.db.getTenantForUser(gate.adminUserId);
  if (!tenant) {
    return jsonResponse({ error: "Kein Tenant für diesen Admin." }, { status: 403 });
  }

  await deps.db.setTenantUiShowWiki(tenant.id, body.ui_show_tenant_wiki);
  return jsonResponse({ ui_show_tenant_wiki: body.ui_show_tenant_wiki });
}
