import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import { startDailyBriefingCron } from "./dailyBriefing.ts";

/**
 * Cron-Jobs hier registrieren (eine Datei pro Job). Jeder Lauf: strukturierte Logs,
 * idempotentes Verhalten, Fehler explizit erfassen.
 */
export function registerCronJobs(_env: AppEnv): void {
  console.log(
    JSON.stringify({
      level: "info",
      component: "cron",
      event: "register",
      message:
        "Periodische Jobs werden nach Server-Start via startAllCrons(deps) aktiviert.",
    }),
  );
}

export function startAllCrons(deps: AppDependencies, env: AppEnv): void {
  startDailyBriefingCron(deps, env);
}
