import * as jose from "jose";
import type { AppEnv } from "../config/env.ts";

export type JwtUserPayload = {
  id: string;
  role: string;
  email: string;
  name: string;
};

export async function mintUserJwt(
  env: AppEnv,
  user: JwtUserPayload,
): Promise<string> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  return await new jose.SignJWT({
    role: user.role,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

/** Einmaliges Setzen des Passworts (z. B. nach Admin-Einladung), 24h gültig. */
export async function mintPasswordSetupJwt(
  env: AppEnv,
  params: { userId: string; email: string },
): Promise<string> {
  const secret = new TextEncoder().encode(env.jwtSecret);
  return await new jose.SignJWT({
    typ: "password_reset",
    email: params.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);
}

export type PasswordSetupPayload = { sub: string; email: string };

export async function verifyPasswordSetupJwt(
  env: AppEnv,
  token: string,
): Promise<PasswordSetupPayload | null> {
  try {
    const secret = new TextEncoder().encode(env.jwtSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    if (payload.typ !== "password_reset") return null;
    const sub = payload.sub;
    const email = typeof payload.email === "string" ? payload.email : "";
    if (typeof sub !== "string" || !sub || !email) return null;
    return { sub, email };
  } catch {
    return null;
  }
}
