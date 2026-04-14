import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import {
  listActiveJobSchedules,
  updateScheduleJobRun,
} from "../services/adminService.ts";
import { berlinClock, berlinDateKey, isBriefingDue } from "./dailyBriefing.ts";

const TICK_MS = 60_000;

/** Pro User max. ein Style-Learn pro Berlin-Kalendertag (Montag 6:xx). */
const lastEmailStyleLearnBerlinDay = new Map<string, string>();

export function startEmailCategorizationCron(
  deps: AppDependencies,
  _env: AppEnv,
): void {
  setInterval(async () => {
    try {
      const rows = await listActiveJobSchedules(
        deps.sql,
        "email_categorization",
        { requireGoogle: true },
      );

      const now = new Date();
      const bc = berlinClock(now);
      const todayKey = berlinDateKey(now);
      const mondayMorning =
        bc.cronDow === 1 && bc.hour === 6 && bc.minute < 5;

      if (mondayMorning) {
        for (const s of rows) {
          if (lastEmailStyleLearnBerlinDay.get(s.user_id) === todayKey) {
            continue;
          }
          lastEmailStyleLearnBerlinDay.set(s.user_id, todayKey);
          void deps.emailStyleService.learnEmailStyle(s.user_id).catch((err) => {
            console.error(
              JSON.stringify({
                job: "email-style-learn",
                userId: s.user_id,
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          });
        }
      }

      const due = rows.filter((s) =>
        isBriefingDue({ cron_expression: s.cron_expression, last_run: s.last_run })
      );
      await Promise.allSettled(
        due.map(async (s) => {
          try {
            await deps.emailCategorizationService.categorizeEmails(s.user_id);
            await updateScheduleJobRun(deps.sql, s.user_id, "email_categorization", "success");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              JSON.stringify({
                job: "email-categorization",
                userId: s.user_id,
                error: msg,
              }),
            );
            await updateScheduleJobRun(
              deps.sql,
              s.user_id,
              "email_categorization",
              "error",
            );
          }
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "cron",
          job: "email-categorization",
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
      job: "email-categorization",
      event: "started",
      interval_ms: TICK_MS,
    }),
  );
}
