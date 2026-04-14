-- Job-Typen pro User; Unique (user_id, job_type)

ALTER TABLE cos_schedules
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'daily_briefing',
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE cos_schedules DROP CONSTRAINT IF EXISTS cos_schedules_user_id_key;

ALTER TABLE cos_schedules
  ADD CONSTRAINT cos_schedules_user_job_unique UNIQUE (user_id, job_type);

UPDATE cos_schedules
SET
  display_name = COALESCE(NULLIF(display_name, ''), 'Tägliches Briefing'),
  description = COALESCE(
    NULLIF(description, ''),
    'Zusammenfassung von Tasks, Emails und Terminen jeden Morgen'
  )
WHERE job_type = 'daily_briefing';
