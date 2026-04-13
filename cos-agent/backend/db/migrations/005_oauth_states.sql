-- OAuth CSRF-State (Google OAuth Redirect-Flow)
CREATE TABLE cos_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES cos_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX cos_oauth_states_state_idx ON cos_oauth_states (state);
CREATE INDEX cos_oauth_states_expires_at_idx ON cos_oauth_states (expires_at);
