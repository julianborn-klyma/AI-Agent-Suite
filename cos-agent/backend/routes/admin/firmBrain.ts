import type { AppEnv } from "../../config/env.ts";
import type { AppDependencies } from "../../app_deps.ts";
import type { FirmInsightCategory } from "../../db/databaseClient.ts";
import { jsonResponse } from "../json.ts";
import { requireAdminContext } from "./guard.ts";

const VALID_CATEGORIES = new Set<FirmInsightCategory>([
  "person",
  "company",
  "project",
  "decision",
  "pattern",
  "relationship",
]);

export async function handleAdminFirmBrainList(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

  const tenant = await deps.db.getTenantForUser(gate.adminUserId);
  if (!tenant) return jsonResponse({ error: "Tenant nicht gefunden." }, { status: 403 });

  const url = new URL(req.url);
  const categoryParam = url.searchParams.get("category") ?? undefined;
  const category = categoryParam && VALID_CATEGORIES.has(categoryParam as FirmInsightCategory)
    ? (categoryParam as FirmInsightCategory)
    : undefined;

  const adminSuppressedParam = url.searchParams.get("adminSuppressed");
  const adminSuppressed = adminSuppressedParam === "true"
    ? true
    : adminSuppressedParam === "false"
    ? false
    : undefined;

  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100") || 100, 200);
  const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0;

  const insights = await deps.firmBrainService.listInsights({
    tenantId: tenant.id,
    category,
    adminSuppressed,
    limit,
    offset,
  });
  return jsonResponse(insights);
}

export async function handleAdminFirmBrainPatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Ungültiges JSON" }, { status: 400 });
  }

  if (typeof body.admin_suppressed !== "boolean") {
    return jsonResponse(
      { error: "admin_suppressed (boolean) ist Pflicht." },
      { status: 400 },
    );
  }

  if (body.admin_suppressed) {
    await deps.firmBrainService.suppressInsight(id);
  } else {
    await deps.firmBrainService.unsuppressInsight(id);
  }
  return jsonResponse({ updated: true });
}

export async function handleAdminFirmBrainDelete(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  id: string,
): Promise<Response> {
  const gate = await requireAdminContext(req, env, deps);
  if (!gate.ok) return gate.response;

  await deps.firmBrainService.deleteInsight(id);
  return jsonResponse({ deleted: true });
}
