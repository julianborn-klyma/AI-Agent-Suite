import type { AppEnv } from "../config/env.ts";
import { requireServiceToken } from "../middleware/auth.ts";
import { getHealthPayload } from "../services/health_service.ts";
import { jsonResponse } from "./json.ts";

export async function handleHealth(
  req: Request,
  env: AppEnv,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!requireServiceToken(req, env)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const body = getHealthPayload();
  return jsonResponse(body);
}
