import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import type { Tenant, TenantListEntry } from "../../db/databaseClient.ts";
import { SlugTakenError } from "../../db/databaseClient.ts";
import { extractIpFromRequest } from "../../middleware/requestIp.ts";
import {
  createUser,
  getSuperAdminCosts,
  getSuperAdminDashboard,
  listUsersByTenant,
} from "../../services/adminService.ts";
import { AUDIT_ACTIONS } from "../../services/auditService.ts";
import { jsonResponse } from "../json.ts";
import { requireSuperAdminContext } from "./guard.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9-]+$/;
const NOTION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicTenantListRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  is_active: boolean;
  admin_email: string | null;
  created_at: string;
  updated_at: string;
  user_count: number;
  credentials_configured: {
    slack: boolean;
    google: boolean;
    notion: boolean;
  };
};

function tenantListPublic(e: TenantListEntry): PublicTenantListRow {
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    plan: e.plan,
    is_active: e.is_active,
    admin_email: e.admin_email,
    created_at: e.created_at,
    updated_at: e.updated_at,
    user_count: e.user_count,
    credentials_configured: e.credentials_configured,
  };
}

/** Tenant für API ohne verschlüsselte Secret-Felder; Client-IDs bleiben (Detail-Ansicht). */
function tenantDetailPublic(t: Tenant): Omit<
  Tenant,
  | "slack_client_secret_enc"
  | "google_client_secret_enc"
  | "notion_client_secret_enc"
> {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    slack_client_id: t.slack_client_id,
    google_client_id: t.google_client_id,
    notion_client_id: t.notion_client_id,
    plan: t.plan,
    is_active: t.is_active,
    admin_email: t.admin_email,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function credentialsFlags(t: Tenant) {
  return {
    slack: Boolean(t.slack_client_id?.trim()),
    google: Boolean(t.google_client_id?.trim()),
    notion: Boolean(t.notion_client_id?.trim()),
  };
}

async function readJson(req: Request): Promise<unknown | "bad"> {
  try {
    return await req.json();
  } catch {
    return "bad";
  }
}

export async function dispatchSuperAdmin(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/superadmin/audit-log" && req.method === "GET") {
    return handleSuperAdminAuditLogGet(req, env, deps);
  }
  if (pathname === "/api/superadmin/status" && req.method === "GET") {
    return handleSuperAdminStatusGet(req, env, deps);
  }
  if (pathname === "/api/superadmin/costs" && req.method === "GET") {
    return handleSuperAdminCostsGet(req, env, deps);
  }

  const credDel = pathname.match(
    /^\/api\/superadmin\/tenants\/([^/]+)\/credentials\/([^/]+)$/,
  );
  if (credDel && req.method === "DELETE") {
    return handleCredentialsDelete(req, env, deps, credDel[1]!, credDel[2]!);
  }

  const credPath = pathname.match(
    /^\/api\/superadmin\/tenants\/([^/]+)\/credentials\/(google|slack|notion)$/,
  );
  if (credPath && req.method === "PUT") {
    return handleCredentialsPut(
      req,
      env,
      deps,
      credPath[1]!,
      credPath[2]! as "google" | "slack" | "notion",
    );
  }

  const usersPath = pathname.match(/^\/api\/superadmin\/tenants\/([^/]+)\/users$/);
  if (usersPath) {
    if (req.method === "GET") {
      return handleTenantUsersGet(req, env, deps, usersPath[1]!);
    }
    if (req.method === "POST") {
      return handleTenantUsersPost(req, env, deps, usersPath[1]!);
    }
  }

  const oneTenant = pathname.match(/^\/api\/superadmin\/tenants\/([^/]+)$/);
  if (oneTenant) {
    if (req.method === "GET") {
      return handleTenantGet(req, env, deps, oneTenant[1]!);
    }
    if (req.method === "PATCH") {
      return handleTenantPatch(req, env, deps, oneTenant[1]!);
    }
  }

  if (pathname === "/api/superadmin/tenants") {
    if (req.method === "GET") return handleTenantsListGet(req, env, deps);
    if (req.method === "POST") return handleTenantsPost(req, env, deps);
  }

  return null;
}

async function handleTenantsListGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const rows = await deps.db.listTenants();
  return jsonResponse(rows.map(tenantListPublic));
}

async function handleTenantsPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const body = await readJson(req);
  if (body === "bad") {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  const name = o.name;
  const slug = o.slug;
  if (typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "name ist Pflicht." }, { status: 400 });
  }
  if (typeof slug !== "string" || !slug.trim()) {
    return jsonResponse({ error: "slug ist Pflicht." }, { status: 400 });
  }
  const s = slug.trim();
  if (!SLUG_RE.test(s)) {
    return jsonResponse({
      error: "Slug darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten",
      example: "mustermann-gmbh",
    }, { status: 400 });
  }
  const plan = typeof o.plan === "string" ? o.plan.trim() : undefined;
  const admin_email = typeof o.admin_email === "string"
    ? o.admin_email.trim()
    : undefined;
  try {
    const t = await deps.tenantService.createTenant(
      {
        name: name.trim(),
        slug: s,
        plan,
        admin_email,
      },
      { userId: gate.userId },
    );
    return jsonResponse(tenantDetailPublic(t), { status: 201 });
  } catch (e) {
    if (e instanceof SlugTakenError) {
      return jsonResponse(
        { error: "Dieser Slug ist bereits vergeben." },
        { status: 409 },
      );
    }
    throw e;
  }
}

async function handleTenantGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(id)) {
    return new Response("Not Found", { status: 404 });
  }
  const t = await deps.db.getTenant(id);
  if (!t) return new Response("Not Found", { status: 404 });
  const list = await deps.db.listTenants();
  const row = list.find((r) => r.id === id);
  const user_count = row?.user_count ?? 0;
  return jsonResponse({
    ...tenantDetailPublic(t),
    user_count,
    credentials_configured: credentialsFlags(t),
  });
}

async function handleTenantPatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(id)) {
    return new Response("Not Found", { status: 404 });
  }
  const before = await deps.db.getTenant(id);
  if (!before) return new Response("Not Found", { status: 404 });
  const body = await readJson(req);
  if (body === "bad") {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  const patch: {
    name?: string;
    plan?: string;
    is_active?: boolean;
    admin_email?: string | null;
  } = {};
  if (o.name !== undefined) {
    if (typeof o.name !== "string" || !o.name.trim()) {
      return jsonResponse({ error: "name ungültig." }, { status: 400 });
    }
    patch.name = o.name.trim();
  }
  if (o.plan !== undefined) {
    if (typeof o.plan !== "string" || !o.plan.trim()) {
      return jsonResponse({ error: "plan ungültig." }, { status: 400 });
    }
    patch.plan = o.plan.trim();
  }
  if (o.is_active !== undefined) {
    if (typeof o.is_active !== "boolean") {
      return jsonResponse({ error: "is_active muss boolean sein." }, {
        status: 400,
      });
    }
    patch.is_active = o.is_active;
  }
  if (o.admin_email !== undefined) {
    if (o.admin_email === null) patch.admin_email = null;
    else if (typeof o.admin_email === "string") {
      patch.admin_email = o.admin_email.trim() || null;
    } else {
      return jsonResponse({ error: "admin_email ungültig." }, {
        status: 400,
      });
    }
  }
  if (
    patch.name === undefined &&
    patch.plan === undefined &&
    patch.is_active === undefined &&
    patch.admin_email === undefined
  ) {
    return jsonResponse(tenantDetailPublic(before));
  }
  const updated = await deps.db.updateTenant(id, patch);
  await deps.auditService.log({
    action: AUDIT_ACTIONS.TENANT_UPDATED,
    userId: gate.userId,
    tenantId: id,
    resourceType: "tenant",
    resourceId: id,
    metadata: {
      before: {
        name: before.name,
        plan: before.plan,
        is_active: before.is_active,
        admin_email: before.admin_email,
      },
      after: {
        name: updated.name,
        plan: updated.plan,
        is_active: updated.is_active,
        admin_email: updated.admin_email,
      },
    },
    success: true,
    req,
  });
  return jsonResponse(tenantDetailPublic(updated));
}

async function handleCredentialsPut(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  tenantId: string,
  provider: "google" | "slack" | "notion",
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(tenantId)) {
    return new Response("Not Found", { status: 404 });
  }
  const tenant = await deps.db.getTenant(tenantId);
  if (!tenant) return new Response("Not Found", { status: 404 });
  const body = await readJson(req);
  if (body === "bad") {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  const client_id = o.client_id;
  const client_secret = o.client_secret;
  if (typeof client_id !== "string" || !client_id.trim()) {
    return jsonResponse({ error: "client_id ist Pflicht." }, { status: 400 });
  }
  if (typeof client_secret !== "string" || !client_secret.trim()) {
    return jsonResponse({ error: "client_secret ist Pflicht." }, {
      status: 400,
    });
  }
  const cid = client_id.trim();
  const csec = client_secret.trim();
  if (provider === "google") {
    if (!cid.endsWith(".apps.googleusercontent.com")) {
      return jsonResponse({
        error: "Ungültige Google Client ID",
        hint:
          "Format: 123456789-xxx.apps.googleusercontent.com\nFundort: console.cloud.google.com → APIs & Dienste → Anmeldedaten → OAuth 2.0-Client-IDs",
      }, { status: 400 });
    }
    if (!csec.startsWith("GOCSPX-")) {
      return jsonResponse({
        error: "Ungültiges Google Client Secret",
        hint:
          "Format: GOCSPX-xxxxxxxxxx\nFundort: console.cloud.google.com → APIs & Dienste → Anmeldedaten → Client-Secret anzeigen",
      }, { status: 400 });
    }
  } else if (provider === "slack") {
    if (!/^[A-Z0-9]+\.[0-9]+$/.test(cid)) {
      return jsonResponse({
        error: "Ungültige Slack Client ID",
        hint:
          "Format: T1234567890.1234567890\nFundort: api.slack.com/apps → App auswählen → Basic Information → App Credentials → Client ID",
      }, { status: 400 });
    }
    if (csec.length < 32) {
      return jsonResponse({
        error: "Ungültiges Slack Client Secret (min. 32 Zeichen)",
        hint:
          "Fundort: api.slack.com/apps → App auswählen → Basic Information → App Credentials → Client Secret",
      }, { status: 400 });
    }
  } else {
    if (!NOTION_UUID_RE.test(cid)) {
      return jsonResponse({
        error: "Ungültige Notion Client ID (UUID-Format erwartet)",
        hint:
          "Fundort: notion.so/my-integrations → Integration auswählen → OAuth → Client ID",
      }, { status: 400 });
    }
  }
  const ip = extractIpFromRequest(req);
  await deps.tenantService.saveCredentials(
    tenantId,
    provider,
    { clientId: cid, clientSecret: csec },
    { userId: gate.userId, ipAddress: ip },
  );
  return jsonResponse({ configured: true });
}

async function handleCredentialsDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  tenantId: string,
  providerRaw: string,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(tenantId)) {
    return new Response("Not Found", { status: 404 });
  }
  const tenant = await deps.db.getTenant(tenantId);
  if (!tenant) return new Response("Not Found", { status: 404 });
  if (providerRaw !== "google" && providerRaw !== "slack" && providerRaw !== "notion") {
    return jsonResponse({ error: "Ungültiger Provider." }, { status: 400 });
  }
  const provider = providerRaw as "google" | "slack" | "notion";
  const ip = extractIpFromRequest(req);
  await deps.tenantService.removeCredentials(tenantId, provider, {
    userId: gate.userId,
    ipAddress: ip,
  });
  return jsonResponse({ removed: true });
}

async function handleTenantUsersGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  tenantId: string,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(tenantId)) {
    return new Response("Not Found", { status: 404 });
  }
  const t = await deps.db.getTenant(tenantId);
  if (!t) return new Response("Not Found", { status: 404 });
  const users = await listUsersByTenant(deps.sql, tenantId);
  return jsonResponse(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      is_active: u.is_active,
      created_at: u.created_at,
    })),
  );
}

async function handleTenantUsersPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  tenantId: string,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  if (!UUID_RE.test(tenantId)) {
    return new Response("Not Found", { status: 404 });
  }
  const tenant = await deps.db.getTenant(tenantId);
  if (!tenant) return new Response("Not Found", { status: 404 });
  const body = await readJson(req);
  if (body === "bad") {
    return jsonResponse({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return jsonResponse({ error: "Body muss ein JSON-Objekt sein." }, {
      status: 400,
    });
  }
  const o = body as Record<string, unknown>;
  const email = o.email;
  const name = o.name;
  if (typeof email !== "string" || !email.trim()) {
    return jsonResponse({ error: "email ist Pflicht." }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return jsonResponse({ error: "name ist Pflicht." }, { status: 400 });
  }
  if (!email.includes("@")) {
    return jsonResponse({ error: "email ungültig." }, { status: 400 });
  }
  let role = "member";
  if (o.role !== undefined) {
    if (o.role !== "admin" && o.role !== "member") {
      return jsonResponse(
        { error: 'role muss "admin" oder "member" sein.' },
        { status: 400 },
      );
    }
    role = o.role;
  }
  const temp = deps.passwordService.generateTemporaryPassword();
  const passwordHash = await deps.passwordService.hashPassword(temp);
  const created = await createUser(deps.sql, {
    email: email.trim(),
    name: name.trim(),
    role,
    password_hash: passwordHash,
    tenant_id: tenantId,
  });
  if (created === "duplicate_email") {
    return jsonResponse({ error: "Email bereits vergeben" }, { status: 409 });
  }
  await deps.auditService.log({
    action: AUDIT_ACTIONS.USER_CREATED,
    userId: gate.userId,
    tenantId,
    resourceType: "user",
    resourceId: created.id,
    metadata: { email: created.email },
    success: true,
    req,
  });
  return jsonResponse(
    {
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        is_active: created.is_active,
        created_at: created.created_at,
      },
      temporary_password: temp,
    },
    { status: 201 },
  );
}

async function handleSuperAdminAuditLogGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const url = new URL(req.url);
  const tenant_id = url.searchParams.get("tenant_id")?.trim() || undefined;
  const action = url.searchParams.get("action")?.trim() || undefined;
  const fromStr = url.searchParams.get("from")?.trim();
  const toStr = url.searchParams.get("to")?.trim();
  const limitRaw = url.searchParams.get("limit")?.trim();
  let limit = 50;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0) limit = Math.min(500, Math.floor(n));
  }
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromStr) {
    const d = new Date(fromStr);
    if (!Number.isNaN(d.getTime())) from = d;
  }
  if (toStr) {
    const d = new Date(toStr);
    if (!Number.isNaN(d.getTime())) to = d;
  }
  const events = await deps.auditService.getAuditLog({
    tenantId: tenant_id,
    action,
    from,
    to,
    limit,
  });
  return jsonResponse(
    events.map((e) => ({
      ...e,
      created_at: e.created_at instanceof Date
        ? e.created_at.toISOString()
        : e.created_at,
    })),
  );
}

async function handleSuperAdminStatusGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;
  const data = await getSuperAdminDashboard(deps.sql);
  return jsonResponse(data);
}

function parseIsoDateParam(
  raw: string | null,
  label: string,
): { ok: true; date: Date } | { ok: false; error: string } {
  if (!raw?.trim()) {
    return { ok: false, error: `${label} ist erforderlich.` };
  }
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: `${label} ist kein gültiges ISO-Datum.` };
  }
  return { ok: true, date: d };
}

async function handleSuperAdminCostsGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  const gate = await requireSuperAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const fromP = parseIsoDateParam(url.searchParams.get("from"), "from");
  if (!fromP.ok) return jsonResponse({ error: fromP.error }, { status: 400 });
  const toP = parseIsoDateParam(url.searchParams.get("to"), "to");
  if (!toP.ok) return jsonResponse({ error: toP.error }, { status: 400 });
  if (fromP.date.getTime() > toP.date.getTime()) {
    return jsonResponse(
      { error: "from darf nicht nach to liegen." },
      { status: 400 },
    );
  }

  const data = await getSuperAdminCosts(deps.sql, fromP.date, toP.date);
  return jsonResponse(data);
}
