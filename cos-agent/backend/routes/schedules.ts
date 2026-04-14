import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import type { Schedule } from "../db/databaseClient.ts";
import { requireAuth } from "../middleware/auth.ts";
import { isValidJobType } from "../schedules/constants.ts";
import { BriefingDelivery } from "../services/briefingDelivery.ts";
import { BriefingService, formatGermanDate } from "../services/briefingService.ts";
import { jsonResponse } from "./json.ts";

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function serializeSchedule(s: Schedule) {
  return {
    id: s.id,
    user_id: s.user_id,
    job_type: s.job_type,
    cron_expression: s.cron_expression,
    delivery_channel: s.delivery_channel,
    delivery_target: s.delivery_target,
    is_active: s.is_active,
    display_name: s.display_name,
    description: s.description,
    last_run: s.last_run ? s.last_run.toISOString() : null,
    last_run_status: s.last_run_status,
    created_at: s.created_at.toISOString(),
  };
}

async function ensureUserSchedules(
  deps: AppDependencies,
  userId: string,
): Promise<void> {
  const rows = await deps.db.getUserSchedules(userId);
  if (rows.length > 0) return;
  const profile = await deps.db.findUserProfileById(userId);
  const email = profile?.email?.trim() ?? "";
  if (!email) {
    throw new Error("NO_USER_EMAIL");
  }
  await deps.db.initDefaultSchedules(userId, email);
}

export async function handleSchedulesGet(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  try {
    await ensureUserSchedules(deps, userId);
  } catch (e) {
    if (e instanceof Error && e.message === "NO_USER_EMAIL") {
      return jsonResponse(
        { error: "Keine E-Mail im Profil — Schedules können nicht angelegt werden." },
        { status: 400 },
      );
    }
    throw e;
  }
  const rows = await deps.db.getUserSchedules(userId);
  return jsonResponse(rows.map(serializeSchedule));
}

export async function handleScheduleTogglePatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  jobType: string,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  if (!isValidJobType(jobType)) {
    return jsonResponse({ error: "Ungültiger job_type." }, { status: 400 });
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
  const is_active = (body as Record<string, unknown>).is_active;
  if (typeof is_active !== "boolean") {
    return jsonResponse({ error: "is_active muss boolean sein." }, {
      status: 400,
    });
  }

  try {
    await ensureUserSchedules(deps, userId);
    await deps.db.toggleJobSchedule(userId, jobType, is_active);
  } catch (e) {
    if (e instanceof Error && e.message === "NO_USER_EMAIL") {
      return jsonResponse({ error: "Keine E-Mail im Profil." }, { status: 400 });
    }
    throw e;
  }
  return jsonResponse({ job_type: jobType, is_active, updated: true });
}

export async function handleSchedulePatch(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  jobType: string,
): Promise<Response> {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  if (!isValidJobType(jobType)) {
    return jsonResponse({ error: "Ungültiger job_type." }, { status: 400 });
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

  try {
    await ensureUserSchedules(deps, userId);
  } catch (e) {
    if (e instanceof Error && e.message === "NO_USER_EMAIL") {
      return jsonResponse({ error: "Keine E-Mail im Profil." }, { status: 400 });
    }
    throw e;
  }

  const existing = (await deps.db.getUserSchedules(userId)).find((s) =>
    s.job_type === jobType
  );
  if (!existing) {
    return jsonResponse({ error: "Schedule nicht gefunden." }, { status: 404 });
  }

  const cron_expression = typeof o.cron_expression === "string" &&
      o.cron_expression.trim()
    ? o.cron_expression.trim()
    : existing.cron_expression;
  let delivery_channel = existing.delivery_channel;
  if ("delivery_channel" in o) {
    if (o.delivery_channel !== "email" && o.delivery_channel !== "slack") {
      return jsonResponse(
        { error: 'delivery_channel muss "email" oder "slack" sein.' },
        { status: 400 },
      );
    }
    delivery_channel = o.delivery_channel;
  }
  const delivery_target = typeof o.delivery_target === "string" &&
      o.delivery_target.trim()
    ? o.delivery_target.trim()
    : existing.delivery_target;

  const updated = await deps.db.upsertJobSchedule(userId, {
    job_type: jobType,
    cron_expression,
    delivery_channel,
    delivery_target,
    is_active: existing.is_active,
  });
  return jsonResponse(serializeSchedule(updated));
}

const RUN_NOW_ALLOWED = new Set([
  "daily_briefing",
  "email_categorization",
  "drive_sync",
]);

export async function handleScheduleRunNowPost(
  req: Request,
  env: AppEnv,
  deps: AppDependencies,
  jobType: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await requireAuth(req, env);
  if (!userId) return unauthorized();
  if (!isValidJobType(jobType)) {
    return jsonResponse({ error: "Ungültiger job_type." }, { status: 400 });
  }
  if (!RUN_NOW_ALLOWED.has(jobType)) {
    return jsonResponse(
      { error: "Dieser Job kann nicht manuell gestartet werden." },
      { status: 400 },
    );
  }

  try {
    await ensureUserSchedules(deps, userId);
  } catch (e) {
    if (e instanceof Error && e.message === "NO_USER_EMAIL") {
      return jsonResponse({ error: "Keine E-Mail im Profil." }, { status: 400 });
    }
    throw e;
  }

  const schedules = await deps.db.getUserSchedules(userId);
  const sched = schedules.find((s) => s.job_type === jobType);
  if (!sched) {
    return jsonResponse({ error: "Schedule nicht gefunden." }, { status: 404 });
  }

  const run = async () => {
    try {
      if (jobType === "daily_briefing") {
        const briefing = new BriefingService(
          deps.db,
          deps.llm,
          deps.toolExecutor,
        );
        const delivery = new BriefingDelivery(env);
        const text = await briefing.generateBriefing(userId);
        const subject = `Daily Briefing – ${formatGermanDate(new Date())}`;
        if (sched.delivery_channel === "email") {
          await delivery.sendEmail(sched.delivery_target, subject, text);
        } else if (sched.delivery_channel === "slack") {
          await delivery.sendSlack(sched.delivery_target, text);
        }
      } else if (jobType === "email_categorization") {
        await deps.emailCategorizationService.categorizeEmails(userId);
      } else if (jobType === "drive_sync") {
        await deps.driveSyncService.syncNewDocuments(userId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({ job: "run-now", jobType, userId, error: msg }),
      );
    }
  };

  queueMicrotask(() => {
    void run();
  });

  return jsonResponse({ started: true, job_type: jobType });
}
