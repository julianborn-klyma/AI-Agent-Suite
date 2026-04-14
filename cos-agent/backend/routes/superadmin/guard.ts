import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import { requireSuperAdmin } from "../../middleware/auth.ts";
import { isSuperAdminUser } from "../../services/adminService.ts";
import { jsonResponse } from "../json.ts";

export function superAdminUnauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

export function superAdminForbidden(): Response {
  return jsonResponse({ error: "Forbidden" }, { status: 403 });
}

export async function requireSuperAdminContext(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const r = await requireSuperAdmin(req, env, (id) =>
    isSuperAdminUser(deps.sql, id)
  );
  if (!r.ok) {
    return {
      ok: false,
      response: r.kind === "unauthorized"
        ? superAdminUnauthorized()
        : superAdminForbidden(),
    };
  }
  return { ok: true, userId: r.userId };
}
