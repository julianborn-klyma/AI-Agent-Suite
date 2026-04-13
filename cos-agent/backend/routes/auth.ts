import * as jose from "jose";
import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { jsonResponse } from "./json.ts";

const LOGIN_FAILED = "Anmeldung fehlgeschlagen";

export async function handleAuthLogin(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: LOGIN_FAILED }, { status: 401 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: LOGIN_FAILED }, { status: 401 });
  }
  const o = body as Record<string, unknown>;
  const email = o.email;
  if (typeof email !== "string" || !email.trim()) {
    return jsonResponse({ error: LOGIN_FAILED }, { status: 401 });
  }

  const user = await deps.db.findUserByEmail(email);
  if (!user || !user.is_active) {
    return jsonResponse({ error: LOGIN_FAILED }, { status: 401 });
  }

  const secret = new TextEncoder().encode(env.jwtSecret);
  const token = await new jose.SignJWT({
    role: user.role,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  return jsonResponse({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}
