import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import { requireAdmin } from "../../middleware/auth.ts";
import { isAdminUser } from "../../services/adminService.ts";
import { jsonResponse } from "../json.ts";

export function adminUnauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export function adminForbidden(): Response {
  return jsonResponse({ error: "Forbidden" }, { status: 403 });
}

export async function requireAdminContext(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<{ ok: true; adminUserId: string } | { ok: false; response: Response }> {
  const r = await requireAdmin(req, env, (id) => isAdminUser(deps.sql, id));
  if (!r.ok) {
    return {
      ok: false,
      response: r.kind === "unauthorized"
        ? adminUnauthorized()
        : adminForbidden(),
    };
  }
  return { ok: true, adminUserId: r.userId };
}
