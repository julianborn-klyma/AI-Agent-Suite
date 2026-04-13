import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import {
  listActiveBriefingSchedules,
  updateScheduleBriefingRun,
  type ActiveBriefingScheduleRow,
} from "../services/adminService.ts";
import { BriefingDelivery } from "../services/briefingDelivery.ts";
import { BriefingService, formatGermanDate } from "../services/briefingService.ts";

const TICK_MS = 60_000;

function berlinDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Berlin" });
}

function berlinClock(now: Date): { hour: number; minute: number; cronDow: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const hour = parseInt(
    parts.find((p) => p.type === "hour")?.value ?? "0",
    10,
  );
  const minute = parseInt(
    parts.find((p) => p.type === "minute")?.value ?? "0",
    10,
  );
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return { hour, minute, cronDow: map[wd] ?? 0 };
}

function matchesCronWeekday(field: string, cronDow: number): boolean {
  const f = field.trim();
  if (f === "*") return true;
  if (f.includes("-")) {
    const [a, b] = f.split("-").map((x) => parseInt(x.trim(), 10));
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return cronDow >= a && cronDow <= b;
  }
  const parts = f.split(",").map((x) => x.trim());
  return parts.some((p) => parseInt(p, 10) === cronDow);
}

export type BriefingDueSchedule = {
  cron_expression: string;
  last_run: Date | string | null;
};

/** Export für Tests (`now` injizierbar). */
export function isBriefingDue(
  schedule: BriefingDueSchedule,
  now: Date = new Date(),
): boolean {
  const parts = schedule.cron_expression.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [minStr, hourStr, , , weekdays] = parts;
  const minute = parseInt(minStr, 10);
  const hour = parseInt(hourStr, 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return false;

  const { hour: bh, minute: bm, cronDow } = berlinClock(now);
  const matchesTime = bh === hour && bm === minute;
  const matchesDay = matchesCronWeekday(weekdays, cronDow);

  const todayKey = berlinDateKey(now);
  let notRunToday = true;
  if (schedule.last_run) {
    const lr = new Date(schedule.last_run);
    notRunToday = berlinDateKey(lr) !== todayKey;
  }

  return matchesTime && matchesDay && notRunToday;
}

async function runBriefingForUser(
  schedule: ActiveBriefingScheduleRow,
  deps: AppDependencies,
  briefing: BriefingService,
  delivery: BriefingDelivery,
): Promise<void> {
  const userId = schedule.user_id;
  try {
    const text = await briefing.generateBriefing(userId);
    const subject = `Daily Briefing – ${formatGermanDate(new Date())}`;
    if (schedule.delivery_channel === "email") {
      await delivery.sendEmail(
        schedule.delivery_target,
        subject,
        text,
      );
    } else if (schedule.delivery_channel === "slack") {
      await delivery.sendSlack(schedule.delivery_target, text);
    }
    await updateScheduleBriefingRun(deps.sql, userId, "success");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        job: "daily-briefing",
        userId,
        error: msg,
      }),
    );
    await updateScheduleBriefingRun(deps.sql, userId, "error");
  }
}

export function startDailyBriefingCron(
  deps: AppDependencies,
  env: AppEnv,
): void {
  const briefing = new BriefingService(
    deps.db,
    deps.llm,
    deps.toolExecutor,
  );
  const delivery = new BriefingDelivery(env);

  setInterval(async () => {
    try {
      const rows = await listActiveBriefingSchedules(deps.sql);
      const due = rows.filter((s) =>
        isBriefingDue({
          cron_expression: s.cron_expression,
          last_run: s.last_run,
        })
      );
      await Promise.allSettled(
        due.map((s) => runBriefingForUser(s, deps, briefing, delivery)),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "cron",
          job: "daily-briefing",
          event: "tick_failed",
          error: msg,
        }),
      );
    }
  }, TICK_MS);

  console.log(
    JSON.stringify({
      level: "info",
      component: "cron",
      job: "daily-briefing",
      event: "started",
      interval_ms: TICK_MS,
    }),
  );
}
