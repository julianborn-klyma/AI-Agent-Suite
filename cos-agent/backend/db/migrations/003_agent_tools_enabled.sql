ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS tools_enabled TEXT[] NOT NULL DEFAULT ARRAY['notion']::text[];
