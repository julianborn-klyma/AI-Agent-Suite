-- MVP: Ein globales Template, damit Chat ohne manuelle Admin-Zuweisung funktioniert.
-- Wird nur eingefügt, wenn noch kein is_template=true existiert.
INSERT INTO agent_configs (agent_key, system_prompt, tools_enabled, is_template, user_id)
SELECT
  'cos-default-template',
  $prompt$Du bist ein hilfreicher Chief of Staff. Antworte knapp und auf Deutsch.

Benutzerkontext:
{{USER_CONTEXT}}

Aktuelle Zeit: {{NOW}}$prompt$,
  ARRAY['notion']::text[],
  true,
  NULL
WHERE NOT EXISTS (SELECT 1 FROM agent_configs WHERE is_template = true)
  AND NOT EXISTS (SELECT 1 FROM agent_configs WHERE agent_key = 'cos-default-template');
