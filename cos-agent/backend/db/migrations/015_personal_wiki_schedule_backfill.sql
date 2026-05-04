-- Job-Zeile für bestehende Nutzer: Persönliches Wiki (Cron, standardmäßig inaktiv wie andere Jobs)
INSERT INTO cos_schedules (
  user_id,
  job_type,
  cron_expression,
  delivery_channel,
  delivery_target,
  is_active,
  display_name,
  description
)
SELECT
  u.id,
  'personal_wiki_enrichment',
  '30 19 * * 1-5',
  'email',
  u.email,
  false,
  'Persönliches Wiki',
  'E-Mail-/Slack-Summaries, Learnings und Daily-Reflexion in me-*-Wiki-Seiten einarbeiten'
FROM cos_users u
WHERE u.is_active = true
  AND u.email IS NOT NULL
  AND trim(u.email) <> ''
ON CONFLICT (user_id, job_type) DO NOTHING;
