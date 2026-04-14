import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { listActiveJobSchedules, updateScheduleJobRun } from "../services/adminService.ts";
import { isBriefingDue } from "./dailyBriefing.ts";

const TICK_MS = 60_000;

export function startDriveSyncCron(
  deps: AppDependencies,
  _env: AppEnv,
): void {
  setInterval(async () => {
    try {
      const rows = await listActiveJobSchedules(deps.sql, "drive_sync", {
        requireGoogle: true,
      });
      const due = rows.filter((s) =>
        isBriefingDue({ cron_expression: s.cron_expression, last_run: s.last_run })
      );
      await Promise.allSettled(
        due.map(async (s) => {
          try {
            await deps.driveSyncService.syncNewDocuments(s.user_id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              JSON.stringify({ job: "drive-sync", userId: s.user_id, error: msg }),
            );
            await updateScheduleJobRun(deps.sql, s.user_id, "drive_sync", "error");
          }
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "cron",
          job: "drive-sync",
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
      job: "drive-sync",
      event: "started",
      interval_ms: TICK_MS,
    }),
  );
}
