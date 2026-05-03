-- SaaS-ready Kern: Schema app, Tasks + Wiki, tenant_id überall, RLS (Session-Var app.current_tenant_id).
-- Legacy-Tabellen bleiben in public (cos_*); neue Domäne nur unter app.* qualifizieren.

CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
'Multi-tenant Anwendungsdomäne: nur app.* ansprechen; tenant_id Pflicht wo angegeben; RLS nutzt current_setting(''app.current_tenant_id'', true)::uuid.';

-- ---------------------------------------------------------------------------
-- Teams & Projekte
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS app.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- Tasks + n:m Zuweisungen (tenant_id denormalisiert für RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.cos_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.team_members (
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES app.teams (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.cos_users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'lead')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.task_assignees (
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.cos_users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.task_teams (
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES app.teams (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, team_id)
);

-- Konsistenz: task.tenant_id = project.tenant_id
CREATE OR REPLACE FUNCTION app.enforce_task_project_same_tenant ()
  RETURNS TRIGGER
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT
      1
    FROM
      app.projects p
    WHERE
      p.id = NEW.project_id
      AND p.tenant_id = NEW.tenant_id) THEN
  RAISE EXCEPTION 'app.tasks: project_id muss zum gleichen tenant_id gehören';
END IF;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_project_tenant_check ON app.tasks;

CREATE TRIGGER tasks_project_tenant_check
  BEFORE INSERT OR UPDATE OF project_id, tenant_id ON app.tasks
  FOR EACH ROW
  EXECUTE PROCEDURE app.enforce_task_project_same_tenant ();

-- Denormalisiertes tenant_id aus Parent-Zeilen
CREATE OR REPLACE FUNCTION app.sync_tenant_from_team ()
  RETURNS TRIGGER
  AS $$
DECLARE
  t UUID;
BEGIN
  SELECT
    tenant_id INTO t
  FROM
    app.teams
  WHERE
    id = NEW.team_id;
  IF t IS NULL THEN
    RAISE EXCEPTION 'app.team_members: team nicht gefunden';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_members_set_tenant ON app.team_members;

CREATE TRIGGER team_members_set_tenant
  BEFORE INSERT OR UPDATE OF team_id ON app.team_members
  FOR EACH ROW
  EXECUTE PROCEDURE app.sync_tenant_from_team ();

CREATE OR REPLACE FUNCTION app.sync_tenant_from_task ()
  RETURNS TRIGGER
  AS $$
DECLARE
  t UUID;
BEGIN
  SELECT
    tenant_id INTO t
  FROM
    app.tasks
  WHERE
    id = NEW.task_id;
  IF t IS NULL THEN
    RAISE EXCEPTION 'app.task_*: task nicht gefunden';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_assignees_set_tenant ON app.task_assignees;

CREATE TRIGGER task_assignees_set_tenant
  BEFORE INSERT OR UPDATE OF task_id ON app.task_assignees
  FOR EACH ROW
  EXECUTE PROCEDURE app.sync_tenant_from_task ();

DROP TRIGGER IF EXISTS task_teams_set_tenant ON app.task_teams;

CREATE TRIGGER task_teams_set_tenant
  BEFORE INSERT OR UPDATE OF task_id ON app.task_teams
  FOR EACH ROW
  EXECUTE PROCEDURE app.sync_tenant_from_task ();

CREATE INDEX IF NOT EXISTS tasks_tenant_project_idx ON app.tasks (tenant_id, project_id);

CREATE INDEX IF NOT EXISTS tasks_tenant_status_due_idx ON app.tasks (tenant_id, status, due_at);

CREATE INDEX IF NOT EXISTS team_members_tenant_user_idx ON app.team_members (tenant_id, user_id);

-- ---------------------------------------------------------------------------
-- Wiki (Markdown + JSON-Frontmatter), Index-Konvention slug = 'index' pro Tenant
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app.wiki_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  frontmatter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_tenant TEXT NOT NULL CHECK (scope_tenant IN ('tenant', 'platform')),
  scope_audience TEXT NOT NULL CHECK (scope_audience IN ('user', 'team', 'company', 'platform')),
  owner_user_id UUID REFERENCES public.cos_users (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'deprecated')),
  version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (scope_tenant = 'tenant'
      AND tenant_id IS NOT NULL)
    OR (scope_tenant = 'platform'
      AND tenant_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_tenant_slug_uidx ON app.wiki_pages (tenant_id, slug)
WHERE
  tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_platform_slug_uidx ON app.wiki_pages (slug)
WHERE
  tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS wiki_pages_tenant_status_idx ON app.wiki_pages (tenant_id, status)
WHERE
  tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.wiki_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.cos_tenants (id) ON DELETE CASCADE,
  from_page_id UUID NOT NULL REFERENCES app.wiki_pages (id) ON DELETE CASCADE,
  to_slug TEXT NOT NULL,
  to_page_id UUID REFERENCES app.wiki_pages (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION app.sync_wiki_link_tenant ()
  RETURNS TRIGGER
  AS $$
DECLARE
  t UUID;
BEGIN
  SELECT
    tenant_id INTO t
  FROM
    app.wiki_pages
  WHERE
    id = NEW.from_page_id;
  IF t IS NULL THEN
    RAISE EXCEPTION 'app.wiki_links: nur tenant-Wiki-Seiten verlinken (from_page braucht tenant_id)';
  END IF;
  NEW.tenant_id := t;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wiki_links_set_tenant ON app.wiki_links;

CREATE TRIGGER wiki_links_set_tenant
  BEFORE INSERT OR UPDATE OF from_page_id ON app.wiki_links
  FOR EACH ROW
  EXECUTE PROCEDURE app.sync_wiki_link_tenant ();

CREATE INDEX IF NOT EXISTS wiki_links_tenant_from_idx ON app.wiki_links (tenant_id, from_page_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (Session: SELECT set_config('app.current_tenant_id', '<uuid>', true))
-- Superuser/BypassRLs: in Dev oft aktiv — Produktion: eigener Rolle ohne BYPASSRLS.
-- ---------------------------------------------------------------------------

ALTER TABLE app.teams ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.team_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.task_assignees ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.task_teams ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.wiki_pages ENABLE ROW LEVEL SECURITY;

ALTER TABLE app.wiki_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY teams_tenant_isolation ON app.teams
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY projects_tenant_isolation ON app.projects
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY tasks_tenant_isolation ON app.tasks
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY team_members_tenant_isolation ON app.team_members
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY task_assignees_tenant_isolation ON app.task_assignees
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

CREATE POLICY task_teams_tenant_isolation ON app.task_teams
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- Tenant-Wiki: nur gleicher Tenant; Plattform-Wiki: nur mit explizitem Flag
CREATE POLICY wiki_pages_select ON app.wiki_pages
  FOR SELECT
  USING (
    (tenant_id IS NOT NULL
      AND tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
    OR (tenant_id IS NULL
      AND scope_tenant = 'platform'
      AND current_setting('app.allow_platform_wiki', TRUE) = 'true'));

CREATE POLICY wiki_pages_insert ON app.wiki_pages
  FOR INSERT
  WITH CHECK (
    (tenant_id IS NOT NULL
      AND tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
    OR (tenant_id IS NULL
      AND scope_tenant = 'platform'
      AND current_setting('app.allow_platform_wiki', TRUE) = 'true'));

CREATE POLICY wiki_pages_update ON app.wiki_pages
  FOR UPDATE
  USING (
    (tenant_id IS NOT NULL
      AND tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
    OR (tenant_id IS NULL
      AND scope_tenant = 'platform'
      AND current_setting('app.allow_platform_wiki', TRUE) = 'true'))
  WITH CHECK (
    (tenant_id IS NOT NULL
      AND tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
    OR (tenant_id IS NULL
      AND scope_tenant = 'platform'
      AND current_setting('app.allow_platform_wiki', TRUE) = 'true'));

CREATE POLICY wiki_pages_delete ON app.wiki_pages
  FOR DELETE
  USING (
    (tenant_id IS NOT NULL
      AND tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
    OR (tenant_id IS NULL
      AND scope_tenant = 'platform'
      AND current_setting('app.allow_platform_wiki', TRUE) = 'true'));

CREATE POLICY wiki_links_tenant_isolation ON app.wiki_links
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
