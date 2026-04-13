import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { requireJwtUserId } from "../middleware/auth.ts";
import { getMePayload } from "../services/me_service.ts";
import { jsonResponse } from "./json.ts";

/** Profil aus DB (mit deps); ohne deps nur `{ userId }` (Tests). */
export async function handleMe(
  req: Request,
  env: AppEnv,
  deps?: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireJwtUserId(req, env);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (deps) {
    const profile = await deps.db.findUserProfileById(userId);
    if (!profile) {
      return jsonResponse({ error: "User nicht gefunden." }, { status: 404 });
    }
    return jsonResponse(profile);
  }
  return jsonResponse(getMePayload(userId));
}
