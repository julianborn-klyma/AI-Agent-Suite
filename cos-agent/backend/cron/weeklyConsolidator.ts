import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import {
  listActiveJobSchedules,
  updateScheduleJobRun,
} from "../services/adminService.ts";
import { isBriefingDue } from "./dailyBriefing.ts";

const TICK_MS = 60_000;

export function startWeeklyConsolidatorCron(
  deps: AppDependencies,
  _env: AppEnv,
): void {
  setInterval(async () => {
    try {
      const rows = await listActiveJobSchedules(deps.sql, "weekly_consolidator");
      const due = rows.filter((s) =>
        isBriefingDue({ cron_expression: s.cron_expression, last_run: s.last_run })
      );
      await Promise.allSettled(
        due.map(async (s) => {
          try {
            await deps.weeklyConsolidatorService.consolidate(s.user_id);
            await updateScheduleJobRun(
              deps.sql,
              s.user_id,
              "weekly_consolidator",
              "success",
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              JSON.stringify({
                job: "weekly-consolidator",
                userId: s.user_id,
                error: msg,
              }),
            );
            await updateScheduleJobRun(
              deps.sql,
              s.user_id,
              "weekly_consolidator",
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
          job: "weekly-consolidator",
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
      job: "weekly-consolidator",
      event: "started",
      interval_ms: TICK_MS,
    }),
  );
}
