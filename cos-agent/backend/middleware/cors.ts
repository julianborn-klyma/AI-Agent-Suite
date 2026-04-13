import type { AppEnv } from "../config/env.ts";

export function corsHeaders(
  req: Request,
  env: AppEnv,
): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return {};
  }
  if (!env.corsOrigins.includes(origin)) {
    return null;
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, X-Service-Token",
    "Access-Control-Max-Age": "86400",
  };
}

export function preflightResponse(
  req: Request,
  env: AppEnv,
): Response | null {
  if (req.method !== "OPTIONS") return null;
  const headers = corsHeaders(req, env);
  if (headers === null) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers });
}
