import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import {
  listActiveJobSchedules,
  updateScheduleJobRun,
} from "../services/adminService.ts";
import { isBriefingDue } from "./dailyBriefing.ts";

const TICK_MS = 60_000;

export function startPersonalWikiEnrichmentCron(
  deps: AppDependencies,
  _env: AppEnv,
): void {
  setInterval(async () => {
    try {
      const rows = await listActiveJobSchedules(
        deps.sql,
        "personal_wiki_enrichment",
      );
      const due = rows.filter((s) =>
        isBriefingDue({ cron_expression: s.cron_expression, last_run: s.last_run })
      );
      await Promise.allSettled(
        due.map(async (s) => {
          try {
            await deps.personalWikiEnrichmentService.runForUser(s.user_id);
            await updateScheduleJobRun(
              deps.sql,
              s.user_id,
              "personal_wiki_enrichment",
              "success",
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              JSON.stringify({
                job: "personal-wiki-enrichment",
                userId: s.user_id,
                error: msg,
              }),
            );
            await updateScheduleJobRun(
              deps.sql,
              s.user_id,
              "personal_wiki_enrichment",
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
          job: "personal-wiki-enrichment",
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
      job: "personal-wiki-enrichment",
      event: "started",
      interval_ms: TICK_MS,
    }),
  );
}
