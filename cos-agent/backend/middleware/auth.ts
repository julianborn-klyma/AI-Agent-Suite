import * as jose from "jose";
import type { AppEnv } from "../config/env.ts";

export type AuthContext = {
  userId: string;
};

/** Health / interne Probes: Service-Token (nicht JWT). */
export function requireServiceToken(req: Request, env: AppEnv): boolean {
  const token = req.headers.get("X-Service-Token");
  return token === env.serviceToken;
}

/** JWT-User-ID; Alias für konsistente Route-Handler (`requireAuth`). */
export async function requireAuth(
  req: Request,
  env: AppEnv,
): Promise<string | null> {
  return requireJwtUserId(req, env);
}

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; kind: "unauthorized" | "forbidden" };

/** JWT + Admin-Rolle (`cos_users.role = 'admin'`, aktiv). */
export async function requireAdmin(
  req: Request,
  env: AppEnv,
  isAdmin: (userId: string) => Promise<boolean>,
): Promise<AdminAuthResult> {
  const userId = await requireAuth(req, env);
  if (!userId) return { ok: false, kind: "unauthorized" };
  if (!(await isAdmin(userId))) return { ok: false, kind: "forbidden" };
  return { ok: true, userId };
}

export async function requireJwtUserId(
  req: Request,
  env: AppEnv,
): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const secret = new TextEncoder().encode(env.jwtSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    if (typeof sub !== "string" || !sub) return null;
    return sub;
  } catch {
    return null;
  }
}

/** JWT aus `Authorization: Bearer` oder Query `?token=` (OAuth-Browser-Redirect). */
export async function requireAuthAllowQueryToken(
  req: Request,
  env: AppEnv,
): Promise<string | null> {
  const url = new URL(req.url);
  const q = url.searchParams.get("token")?.trim();
  if (q) {
    try {
      const secret = new TextEncoder().encode(env.jwtSecret);
      const { payload } = await jose.jwtVerify(q, secret, {
        algorithms: ["HS256"],
      });
      const sub = payload.sub;
      if (typeof sub === "string" && sub) return sub;
    } catch {
      return null;
    }
  }
  return requireJwtUserId(req, env);
}
