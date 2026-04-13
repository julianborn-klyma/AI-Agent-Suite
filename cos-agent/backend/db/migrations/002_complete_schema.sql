CREATE TABLE cos_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fremdschlüssel in agent_configs nachrüsten falls noch nicht vorhanden
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES cos_users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES cos_users(id);

CREATE TABLE cos_user_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cos_users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE TABLE cos_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cos_users(id) ON DELETE CASCADE UNIQUE,
  cron_expression TEXT NOT NULL DEFAULT '0 7 * * 1-5',
  delivery_channel TEXT NOT NULL DEFAULT 'email',
  delivery_target TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_run TIMESTAMPTZ,
  last_run_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cos_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cos_users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON cos_conversations(user_id, created_at DESC);
CREATE INDEX ON cos_conversations(session_id);

CREATE TABLE cos_llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cos_users(id),
  session_id UUID,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd NUMERIC(10, 6),
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON cos_llm_calls(user_id, created_at DESC);
