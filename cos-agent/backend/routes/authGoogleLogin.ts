import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { mintUserJwt } from "./authJwt.ts";

function redirect(url: string): Response {
  return Response.redirect(url, 302);
}

function connectionsBase(env: AppEnv): string {
  return env.frontendUrl.replace(/\/+$/, "");
}

export async function handleAuthGoogleLoginGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (!env.googleClientId.trim()) {
    return redirect(`${connectionsBase(env)}/login?error=google_not_configured`);
  }
  const state = crypto.randomUUID();
  await deps.db.insertOauthState({
    state,
    userId: null,
    provider: "google_login",
  });
  const url = deps.oauthService.buildGoogleLoginAuthUrl(state);
  return redirect(url);
}

export async function handleAuthGoogleLoginCallback(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const base = connectionsBase(env);
  const fail = (code: string) =>
    redirect(`${base}/login?error=${encodeURIComponent(code)}`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return fail("google_login_denied");
  }

  const consumed = await deps.db.consumeOauthState(state);
  if (!consumed || consumed.provider !== "google_login") {
    return fail("google_login_state");
  }
  if (consumed.userId !== null) {
    return fail("google_login_state");
  }

  if (!env.googleClientId.trim() || !env.googleClientSecret.trim()) {
    return fail("google_not_configured");
  }

  try {
    const tokens = await deps.oauthService.exchangeGoogleCode(
      code,
      env.googleLoginRedirectUri,
    );
    const profile = await deps.oauthService.fetchGoogleUserProfile(
      tokens.accessToken,
    );
    if (!profile.emailVerified) {
      return fail("google_email_unverified");
    }
    const user = await deps.db.findUserByEmail(profile.email);
    if (!user || !user.is_active) {
      return fail("no_account");
    }
    const token = await mintUserJwt(env, {
      id: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    });
    const frag = new URLSearchParams({ cos_token: token }).toString();
    return redirect(`${base}/login#${frag}`);
  } catch {
    return fail("google_login_failed");
  }
}
