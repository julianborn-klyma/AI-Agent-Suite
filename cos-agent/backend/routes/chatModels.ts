import type { AppEnv } from "../config/env.ts";
import { listChatModelsPayload } from "../services/chatModels.ts";
import { jsonResponse } from "./json.ts";

export async function handleChatModelsGet(
  req: Request,
  _env: AppEnv,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return jsonResponse(listChatModelsPayload());
}
