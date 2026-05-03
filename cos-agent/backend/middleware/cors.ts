import type { AppEnv } from "../config/env.ts";

/** Browser-Origin: nur Loopback-Host, beliebiger Port (Vite dev/preview, …). */
export function isLocalLoopbackBrowserOrigin(origin: string): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return u.hostname === "localhost" || u.hostname === "127.0.0.1" ||
    u.hostname === "[::1]";
}

export function corsHeaders(
  req: Request,
  env: AppEnv,
): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return {};
  }
  const allowed =
    env.corsOrigins.includes(origin) ||
    (env.corsAllowLocalhost && isLocalLoopbackBrowserOrigin(origin));
  if (!allowed) {
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
