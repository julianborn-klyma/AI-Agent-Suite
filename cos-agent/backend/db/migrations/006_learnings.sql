-- Hinweis: 005 ist oauth_states; Learnings folgen als 006.
CREATE TABLE cos_learnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cos_users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  confidence NUMERIC(3,2) DEFAULT 0.80,
  confirmed_by_user BOOLEAN DEFAULT false,
  times_confirmed INTEGER DEFAULT 1,
  contradicts_id UUID REFERENCES cos_learnings(id),
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_confirmed TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON cos_learnings(user_id, category);
CREATE INDEX ON cos_learnings(user_id, is_active);
CREATE INDEX ON cos_learnings(last_confirmed DESC);
