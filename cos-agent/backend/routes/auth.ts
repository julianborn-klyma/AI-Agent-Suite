import type { AppEnv } from "../config/env.ts";
import type { AppDependencies } from "../app_deps.ts";
import { extractIpFromRequest } from "../middleware/requestIp.ts";
import { requireAuth } from "../middleware/auth.ts";
import { AUDIT_ACTIONS } from "../services/auditService.ts";
import { jsonResponse } from "./json.ts";
import {
  mintPasswordSetupJwt,
  mintUserJwt,
  verifyPasswordSetupJwt,
} from "./authJwt.ts";

const LOGIN_FAIL = "Email oder Passwort falsch.";
const IP_WINDOW_MIN = 15;
const IP_MAX_ATTEMPTS = 10;
const LOCK_AFTER_FAILS = 5;

function passwordSvc(deps: AppDependencies) {
  return deps.passwordService;
}

function audit(deps: AppDependencies) {
  return deps.auditService;
}

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
    return jsonResponse({ error: LOGIN_FAIL }, { status: 401 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: LOGIN_FAIL }, { status: 401 });
  }
  const o = body as Record<string, unknown>;
  const emailRaw = o.email;
  const password = typeof o.password === "string" ? o.password : undefined;
  if (typeof emailRaw !== "string" || !emailRaw.trim()) {
    return jsonResponse({ error: "email ist erforderlich." }, { status: 400 });
  }
  if (password === undefined) {
    return jsonResponse({ error: "password ist erforderlich." }, { status: 400 });
  }

  const ip = extractIpFromRequest(req);
  const ua = req.headers.get("user-agent");

  const ipCount = await deps.db.countLoginAttemptsByIpSince(ip, IP_WINDOW_MIN);
  if (ipCount >= IP_MAX_ATTEMPTS) {
    return jsonResponse(
      {
        error: "Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.",
        retry_after: IP_WINDOW_MIN * 60,
      },
      { status: 429 },
    );
  }

  const email = emailRaw.trim();
  const user = await deps.db.findUserByEmail(email);

  const logFail = async () => {
    await deps.db.insertLoginAttempt({
      email,
      ipAddress: ip,
      success: false,
      userAgent: ua,
    });
  };

  if (!user || !user.is_active) {
    await logFail();
    await audit(deps).log({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      ipAddress: ip,
      userAgent: ua ?? undefined,
      success: false,
      req,
    });
    return jsonResponse({ error: LOGIN_FAIL }, { status: 401 });
  }

  if (user.locked_until && user.locked_until > new Date()) {
    await logFail();
    return jsonResponse(
      {
        error: `Account gesperrt bis ${user.locked_until.toISOString()}.`,
      },
      { status: 401 },
    );
  }

  const hasPassword = Boolean(user.password_hash?.trim());
  if (!hasPassword) {
    await logFail();
    return jsonResponse(
      {
        error: "Bitte setze zunächst ein Passwort.",
        code: "PASSWORD_REQUIRED",
      },
      { status: 401 },
    );
  }

  const ok = await passwordSvc(deps).verifyPassword(
    password,
    user.password_hash!,
  );
  if (!ok) {
    const { attempts, locked_until } = await deps.db.incrementFailedLogin(user.id);
    await logFail();
    if (attempts >= LOCK_AFTER_FAILS && locked_until) {
      await audit(deps).log({
        action: AUDIT_ACTIONS.USER_LOGIN_LOCKED,
        userId: user.id,
        ipAddress: ip,
      userAgent: ua ?? undefined,
      success: false,
      metadata: { attempts },
      req,
    });
      return jsonResponse(
        {
          error: "Account nach 5 Fehlversuchen für 30 Minuten gesperrt.",
        },
        { status: 401 },
      );
    }
    await audit(deps).log({
      action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
      userId: user.id,
      ipAddress: ip,
      userAgent: ua ?? undefined,
      success: false,
      req,
    });
    return jsonResponse({ error: LOGIN_FAIL }, { status: 401 });
  }

  await deps.db.recordSuccessfulLogin(user.id, ip);
  await deps.db.insertLoginAttempt({
    email: user.email,
    ipAddress: ip,
    success: true,
    userAgent: ua ?? null,
  });
  await audit(deps).log({
    action: AUDIT_ACTIONS.USER_LOGIN,
    userId: user.id,
    ipAddress: ip,
    userAgent: ua ?? undefined,
    success: true,
    req,
  });

  const token = await mintUserJwt(env, {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  });

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

export async function handleAuthChangePassword(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) {
    return jsonResponse({ error: "Nicht angemeldet." }, { status: 401 });
  }

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
  const o = body as Record<string, unknown>;
  const current = typeof o.current_password === "string"
    ? o.current_password
    : "";
  const next = typeof o.new_password === "string" ? o.new_password : "";
  if (!current || !next) {
    return jsonResponse(
      { error: "current_password und new_password sind Pflicht." },
      { status: 400 },
    );
  }

  const user = await deps.db.findUserWithPasswordById(userId);
  if (!user?.is_active || !user.password_hash?.trim()) {
    return jsonResponse({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const curOk = await passwordSvc(deps).verifyPassword(
    current,
    user.password_hash,
  );
  if (!curOk) {
    return jsonResponse({ error: "Aktuelles Passwort ist falsch." }, {
      status: 401,
    });
  }

  const strength = passwordSvc(deps).validatePasswordStrength(next);
  if (!strength.valid) {
    return jsonResponse(
      { error: "Passwort zu schwach.", errors: strength.errors },
      { status: 400 },
    );
  }

  const hash = await passwordSvc(deps).hashPassword(next);
  await deps.db.updateUserPasswordHash(user.id, hash);
  await audit(deps).log({
    action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
    userId: user.id,
    req,
    success: true,
  });

  return jsonResponse({ changed: true });
}

export async function handleAuthSetInitialPassword(
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
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  const token = typeof o.token === "string" ? o.token.trim() : "";
  const next = typeof o.new_password === "string" ? o.new_password : "";
  if (!token || !next) {
    return jsonResponse(
      { error: "token und new_password sind Pflicht." },
      { status: 400 },
    );
  }

  const claims = await verifyPasswordSetupJwt(env, token);
  if (!claims) {
    return jsonResponse({ error: "Token ungültig oder abgelaufen." }, {
      status: 401,
    });
  }

  const strength = passwordSvc(deps).validatePasswordStrength(next);
  if (!strength.valid) {
    return jsonResponse(
      { error: "Passwort zu schwach.", errors: strength.errors },
      { status: 400 },
    );
  }

  const user = await deps.db.findUserWithPasswordById(claims.sub);
  if (!user?.is_active || user.email.toLowerCase() !== claims.email.toLowerCase()) {
    return jsonResponse({ error: "Token ungültig." }, { status: 401 });
  }

  const hash = await passwordSvc(deps).hashPassword(next);
  await deps.db.updateUserPasswordHash(user.id, hash);
  await audit(deps).log({
    action: AUDIT_ACTIONS.USER_PASSWORD_CHANGED,
    userId: user.id,
    metadata: { source: "password_setup_token" },
    success: true,
    req,
  });

  const jwt = await mintUserJwt(env, {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  });

  return jsonResponse({
    token: jwt,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}

export { mintPasswordSetupJwt };
