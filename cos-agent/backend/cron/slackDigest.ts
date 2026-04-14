import { loadAgentContext } from "../agents/contextLoader.ts";
import { SlackAgent } from "../agents/subagents/slackAgent.ts";
import type { AppDependencies } from "../app_deps.ts";
import type { AppEnv } from "../config/env.ts";
import {
  listActiveJobSchedules,
  updateScheduleJobRun,
} from "../services/adminService.ts";
import { BriefingDelivery } from "../services/briefingDelivery.ts";
import { formatGermanDate } from "../services/briefingService.ts";
import { LearningService } from "../services/learningService.ts";
import { isBriefingDue } from "./dailyBriefing.ts";

const TICK_MS = 60_000;

export function startSlackDigestCron(
  deps: AppDependencies,
  env: AppEnv,
): void {
  const delivery = new BriefingDelivery(env);

  setInterval(async () => {
    try {
      const rows = await listActiveJobSchedules(deps.sql, "slack_digest", {
        requireSlack: true,
      });
      const due = rows.filter((s) =>
        isBriefingDue({ cron_expression: s.cron_expression, last_run: s.last_run })
      );
      await Promise.allSettled(
        due.map(async (s) => {
          try {
            const learningService = new LearningService(deps.db, deps.llm);
            const ctx = await loadAgentContext(
              deps.db,
              s.user_id,
              () => new Date(),
              [],
              learningService,
              deps.documentService,
            );
            const ctx2 = {
              ...ctx,
              connectedTools: [...new Set([...ctx.connectedTools, "slack"])],
            };
            const agent = new SlackAgent(deps.llm, deps.db, deps.toolExecutor);
            const out = await agent.execute(
              { action: "summarize_day" },
              ctx2,
            );
            const summary = out.success && out.data &&
                typeof (out.data as { summary?: string }).summary === "string"
              ? String((out.data as { summary: string }).summary)
              : "Slack-Digest ohne Inhalt.";
            const dateKey = new Date().toISOString().slice(0, 10);
            await deps.db.upsertUserContext({
              userId: s.user_id,
              key: `slack_summary_${dateKey}`,
              value: summary.slice(0, 8000),
            });
            const subject = `Slack Digest – ${formatGermanDate(new Date())}`;
            if (s.delivery_channel === "email") {
              await delivery.sendEmail(s.delivery_target, subject, summary);
            } else if (s.delivery_channel === "slack") {
              await delivery.sendSlack(s.delivery_target, summary);
            }
            await updateScheduleJobRun(deps.sql, s.user_id, "slack_digest", "success");
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(
              JSON.stringify({ job: "slack-digest", userId: s.user_id, error: msg }),
            );
            await updateScheduleJobRun(deps.sql, s.user_id, "slack_digest", "error");
          }
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          level: "error",
          component: "cron",
          job: "slack-digest",
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
      job: "slack-digest",
      event: "started",
      interval_ms: TICK_MS,
    }),
  );
}
