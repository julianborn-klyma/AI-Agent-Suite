-- Multi-Tenant: cos_tenants, cos_users.tenant_id, Standard-Tenant KLYMA

CREATE TABLE IF NOT EXISTS cos_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,

  slack_client_id TEXT,
  slack_client_secret_enc TEXT,
  google_client_id TEXT,
  google_client_secret_enc TEXT,
  notion_client_id TEXT,
  notion_client_secret_enc TEXT,

  plan TEXT NOT NULL DEFAULT 'starter',
  is_active BOOLEAN NOT NULL DEFAULT true,
  admin_email TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cos_tenants_slug_idx ON cos_tenants (slug);
CREATE INDEX IF NOT EXISTS cos_tenants_is_active_idx ON cos_tenants (is_active);

ALTER TABLE cos_users
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES cos_tenants (id);

CREATE INDEX IF NOT EXISTS cos_users_tenant_id_idx ON cos_users (tenant_id);

INSERT INTO cos_tenants (name, slug, plan, admin_email)
VALUES ('KLYMA', 'klyma', 'enterprise', 'julian.born@klyma.de')
ON CONFLICT (slug) DO NOTHING;

UPDATE cos_users
SET tenant_id = (SELECT id FROM cos_tenants WHERE slug = 'klyma' LIMIT 1)
WHERE tenant_id IS NULL;

UPDATE cos_users
SET role = 'superadmin'
WHERE lower(email) = lower('julian.born@klyma.de');

-- Neue User ohne tenant_id erhalten automatisch KLYMA (Tests / lokale Inserts)
CREATE OR REPLACE FUNCTION cos_users_set_default_tenant ()
  RETURNS TRIGGER
  AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT
      id INTO NEW.tenant_id
    FROM
      cos_tenants
    WHERE
      slug = 'klyma'
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cos_users_default_tenant ON cos_users;

CREATE TRIGGER cos_users_default_tenant
  BEFORE INSERT ON cos_users
  FOR EACH ROW
  EXECUTE PROCEDURE cos_users_set_default_tenant ();

UPDATE cos_audit_log
SET tenant_id = NULL
WHERE tenant_id IS NOT NULL
  AND tenant_id NOT IN (SELECT id FROM cos_tenants);

ALTER TABLE cos_audit_log
  DROP CONSTRAINT IF EXISTS cos_audit_log_tenant_id_fkey;

ALTER TABLE cos_audit_log
  ADD CONSTRAINT cos_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES cos_tenants (id) ON DELETE SET NULL;
