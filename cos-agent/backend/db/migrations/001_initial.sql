-- Basistabellen; System-Prompts kommen aus DB, nicht aus Code.
CREATE TABLE IF NOT EXISTS agent_configs (
  id SERIAL PRIMARY KEY,
  agent_key TEXT NOT NULL UNIQUE,
  system_prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_agent_key ON agent_configs (agent_key);
