import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { requireAuth, requireAuthAllowQueryToken } from "../middleware/auth.ts";
import { jsonResponse } from "./json.ts";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function redirect(url: string): Response {
  return Response.redirect(url, 302);
}

function connectionsBase(env: AppEnv): string {
  return env.frontendUrl.replace(/\/+$/, "");
}

export async function handleConnectionsGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  const data = await deps.oauthService.getConnectionStatus(userId);
  return jsonResponse(data);
}

export async function handleConnectionsDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  provider: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  if (
    provider !== "google" && provider !== "notion" && provider !== "slack"
  ) {
    return jsonResponse({
      error: "provider muss google, notion oder slack sein.",
    }, {
      status: 400,
    });
  }
  await deps.oauthService.disconnectProvider(userId, provider);
  return jsonResponse({ disconnected: true });
}

export async function handleGoogleAuthStart(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuthAllowQueryToken(req, env);
  if (!userId) return unauthorized();
  if (!env.googleClientId.trim()) {
    return jsonResponse(
      { error: "Google OAuth nicht konfiguriert" },
      { status: 503 },
    );
  }
  const state = await deps.oauthService.createState(userId, "google");
  const url = deps.oauthService.buildGoogleAuthUrl(state);
  return redirect(url);
}

export async function handleGoogleCallback(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const base = connectionsBase(env);
  const fail = () =>
    redirect(`${base}/settings?error=google_failed`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return fail();
  }

  const consumed = await deps.oauthService.consumeState(state);
  if (!consumed || consumed.provider !== "google") {
    return fail();
  }

  if (!env.googleClientId.trim() || !env.googleClientSecret.trim()) {
    return fail();
  }

  try {
    const tokens = await deps.oauthService.exchangeGoogleCode(code);
    await deps.oauthService.saveGoogleTokens(consumed.userId, tokens);
  } catch {
    return fail();
  }

  return redirect(`${base}/settings/connections?connected=google`);
}

export async function handleNotionConnectPut(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "PUT") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const token = (body as Record<string, unknown>).token;
  if (typeof token !== "string" || !token.trim()) {
    return jsonResponse({ error: "token ist Pflicht." }, { status: 400 });
  }
  const t = token.trim();
  if (!t.startsWith("secret_")) {
    return jsonResponse({
      error: "Notion Internal Integration Token muss mit secret_ beginnen",
    }, { status: 400 });
  }

  try {
    await deps.oauthService.saveNotionToken(userId, t);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "Ungültiger Notion Token") {
      return jsonResponse({
        error: "Ungültiger Notion Token. Bitte prüfe ob der Token korrekt ist.",
      }, { status: 422 });
    }
    return jsonResponse({ error: msg || "Notion-Verbindung fehlgeschlagen." }, {
      status: 500,
    });
  }

  return jsonResponse({ connected: true });
}

export async function handleSlackAuthStart(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuthAllowQueryToken(req, env);
  if (!userId) return unauthorized();
  if (!env.slackClientId.trim() || !env.slackClientSecret.trim()) {
    return jsonResponse(
      { error: "Slack OAuth nicht konfiguriert" },
      { status: 503 },
    );
  }
  const state = await deps.oauthService.createState(userId, "slack");
  const url = deps.oauthService.buildSlackAuthUrl(state);
  return redirect(url);
}

export async function handleSlackCallback(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const base = connectionsBase(env);
  const fail = () =>
    redirect(`${base}/settings/connections?error=slack_failed`);

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const state = url.searchParams.get("state")?.trim() ?? "";
  if (!code || !state) {
    return fail();
  }

  const consumed = await deps.oauthService.consumeState(state);
  if (!consumed || consumed.provider !== "slack") {
    return fail();
  }

  if (!env.slackClientId.trim() || !env.slackClientSecret.trim()) {
    return fail();
  }

  try {
    const { userAccessToken } = await deps.oauthService.exchangeSlackCode(code);
    await deps.oauthService.saveSlackUserToken(consumed.userId, userAccessToken);
  } catch {
    return fail();
  }

  return redirect(`${base}/settings/connections?connected=slack`);
}

export async function handleDriveFolderPut(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "PUT") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const folder_id = (body as Record<string, unknown>).folder_id;
  if (typeof folder_id !== "string" || !folder_id.trim()) {
    return jsonResponse({ error: "folder_id ist Pflicht." }, { status: 400 });
  }
  await deps.db.upsertUserContext({
    userId,
    key: "drive_folder_id",
    value: folder_id.trim(),
  });
  return jsonResponse({ saved: true });
}

export async function handleNotionDatabasePut(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "PUT") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const database_id = (body as Record<string, unknown>).database_id;
  if (typeof database_id !== "string" || !database_id.trim()) {
    return jsonResponse({ error: "database_id ist Pflicht." }, { status: 400 });
  }
  await deps.db.upsertUserContext({
    userId,
    key: "notion_database_id",
    value: database_id.trim(),
  });
  return jsonResponse({ saved: true });
}
