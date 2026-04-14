-- Erweiterte Passwort-/Login-Sicherheit, Versuchs- und Audit-Log

ALTER TABLE cos_users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip TEXT;

CREATE TABLE IF NOT EXISTS cos_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cos_login_attempts_email_created_idx
  ON cos_login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS cos_login_attempts_ip_created_idx
  ON cos_login_attempts (ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS cos_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  user_id UUID REFERENCES cos_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cos_audit_log_tenant_created_idx
  ON cos_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cos_audit_log_user_created_idx
  ON cos_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cos_audit_log_action_created_idx
  ON cos_audit_log (action, created_at DESC);
