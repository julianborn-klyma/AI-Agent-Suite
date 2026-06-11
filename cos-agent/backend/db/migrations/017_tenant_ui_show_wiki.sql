-- Tenant-weite UI-Preference: Firmen-Handbuch (Wiki) in Navigation anzeigen (Default aus).

ALTER TABLE cos_tenants
  ADD COLUMN IF NOT EXISTS ui_show_tenant_wiki BOOLEAN NOT NULL DEFAULT false;
