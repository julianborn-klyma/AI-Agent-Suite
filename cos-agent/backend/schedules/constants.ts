export const SCHEDULE_JOB_TYPES = [
  "daily_briefing",
  "email_categorization",
  "slack_digest",
  "drive_sync",
  "weekly_consolidator",
  "personal_wiki_enrichment",
] as const;

export type ScheduleJobType = (typeof SCHEDULE_JOB_TYPES)[number];

export function isValidJobType(t: string): t is ScheduleJobType {
  return (SCHEDULE_JOB_TYPES as readonly string[]).includes(t);
}

export const DEFAULT_JOB_CRONS: Record<ScheduleJobType, string> = {
  daily_briefing: "0 7 * * 1-5",
  email_categorization: "0 8 * * 1-5",
  slack_digest: "0 18 * * 1-5",
  drive_sync: "0 6 * * *",
  weekly_consolidator: "0 18 * * 0",
  /** Nach typischen Digest-Zeiten; nur persönliche me-*-Wiki-Seiten. */
  personal_wiki_enrichment: "30 19 * * 1-5",
};

export const DEFAULT_JOB_DISPLAY: Record<
  ScheduleJobType,
  { display_name: string; description: string }
> = {
  daily_briefing: {
    display_name: "Tägliches Briefing",
    description:
      "Zusammenfassung von Tasks, Emails und Terminen jeden Morgen",
  },
  email_categorization: {
    display_name: "Email-Kategorisierung",
    description: "Emails priorisieren und Entwürfe vorbereiten",
  },
  slack_digest: {
    display_name: "Slack Digest",
    description: "Tageszusammenfassung aus Slack",
  },
  drive_sync: {
    display_name: "Drive Sync",
    description: "Neue Dateien aus Google Drive importieren",
  },
  weekly_consolidator: {
    display_name: "Wöchentliche Verdichtung",
    description: "Kontext und Learnings der Woche verdichten",
  },
  personal_wiki_enrichment: {
    display_name: "Persönliches Wiki",
    description:
      "E-Mail-/Slack-Summaries, Learnings und Daily-Reflexion in me-*-Wiki-Seiten einarbeiten",
  },
};
