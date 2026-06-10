-- Brain & Firm Knowledge System
-- Layer 1: Personal Memory → cos_learnings (bestehend, unverändert)
-- Layer 2: Project Knowledge → brain_entries (kuratiert, nur knowledge_owner/owner schreiben)
-- Layer 3: Firm Brain → firm_insights (auto-extrahiert aus allen Projekt-Chats)
--
-- Voraussetzung: pgvector >= 0.5.0 (für HNSW-Index und vector-Typ)

CREATE EXTENSION IF NOT EXISTS vector;

-- Projekte: Wissens-Container mit expliziten Mitgliedschaften
CREATE TABLE IF NOT EXISTS brain_projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES cos_tenants(id),
  owner_id    UUID        NOT NULL REFERENCES cos_users(id),
  name        TEXT        NOT NULL,
  description TEXT,
  color       TEXT        NOT NULL DEFAULT '#6366f1',
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mitgliedschaft + Rolle pro Projekt
-- owner:           Projekt verwalten, Members einladen/entfernen, Rollen setzen, Wissen schreiben
-- knowledge_owner: Wissen schreiben/lesen, kein Member-Management
-- member:          Nur lesen + chatten (Chat-Inhalte fließen in Firm Brain)
CREATE TABLE IF NOT EXISTS brain_project_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES brain_projects(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES cos_users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL CHECK (role IN ('owner', 'knowledge_owner', 'member')),
  invited_by  UUID        REFERENCES cos_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- Kuratiertes Projekt-Wissen (nur owner + knowledge_owner dürfen schreiben)
CREATE TABLE IF NOT EXISTS brain_entries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES brain_projects(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES cos_tenants(id),
  created_by  UUID        NOT NULL REFERENCES cos_users(id),
  type        TEXT        NOT NULL CHECK (type IN ('fact', 'decision', 'preference', 'context', 'process')),
  content     TEXT        NOT NULL,
  source      TEXT,
  confidence  FLOAT       NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  tags        TEXT[]      NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ,          -- NULL = läuft nicht ab
  embedding   vector(1536),         -- Für semantische Suche (pgvector)
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Firm Brain: Automatisch aus allen Projekt-Chats extrahiertes Firmenwissen
-- Wird nie manuell befüllt; nur via FirmBrainService nach jedem Chat
-- Admins können einzelne Insights suppressen (admin_suppressed = true)
CREATE TABLE IF NOT EXISTS firm_insights (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES cos_tenants(id),
  source_project_id UUID        REFERENCES brain_projects(id) ON DELETE SET NULL,
  source_user_id    UUID        REFERENCES cos_users(id) ON DELETE SET NULL,
  source_session_id TEXT,
  -- person | company | project | decision | pattern | relationship
  category          TEXT        NOT NULL,
  content           TEXT        NOT NULL,
  confidence        FLOAT       NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  tags              TEXT[]      NOT NULL DEFAULT '{}',
  embedding         vector(1536),
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  admin_suppressed  BOOLEAN     NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Widersprüche zwischen brain_entries innerhalb eines Projekts
-- Werden per LLM erkannt (cosine-Vorfilter + LLM-Reasoning)
CREATE TABLE IF NOT EXISTS brain_conflicts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID        NOT NULL REFERENCES brain_projects(id) ON DELETE CASCADE,
  entry_a_id           UUID        NOT NULL REFERENCES brain_entries(id) ON DELETE CASCADE,
  entry_b_id           UUID        NOT NULL REFERENCES brain_entries(id) ON DELETE CASCADE,
  conflict_description TEXT,
  resolved             BOOLEAN     NOT NULL DEFAULT false,
  resolved_by          UUID        REFERENCES cos_users(id),
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Projekt-gebundene Chats (rückwärtskompatibel: NULL = globaler Chat ohne Projekt-Context)
ALTER TABLE cos_conversations
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES brain_projects(id) ON DELETE SET NULL;

-- Indexes: Abfragen nach Projekt, Tenant, aktive Einträge
CREATE INDEX IF NOT EXISTS idx_brain_projects_tenant
  ON brain_projects(tenant_id);

CREATE INDEX IF NOT EXISTS idx_brain_project_members_project
  ON brain_project_members(project_id);

CREATE INDEX IF NOT EXISTS idx_brain_project_members_user
  ON brain_project_members(user_id);

CREATE INDEX IF NOT EXISTS idx_brain_entries_project
  ON brain_entries(project_id);

CREATE INDEX IF NOT EXISTS idx_brain_entries_tenant
  ON brain_entries(tenant_id);

CREATE INDEX IF NOT EXISTS idx_brain_entries_active
  ON brain_entries(project_id, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_brain_entries_expires
  ON brain_entries(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_firm_insights_tenant
  ON firm_insights(tenant_id);

CREATE INDEX IF NOT EXISTS idx_firm_insights_active
  ON firm_insights(tenant_id, is_active, admin_suppressed)
  WHERE is_active = true AND admin_suppressed = false;

CREATE INDEX IF NOT EXISTS idx_conversations_project
  ON cos_conversations(project_id)
  WHERE project_id IS NOT NULL;

-- HNSW-Vektorindizes für semantische Suche (pgvector >= 0.5.0)
-- Funktionieren auch auf leeren Tabellen (kein Training nötig wie bei IVFFlat)
CREATE INDEX IF NOT EXISTS idx_brain_entries_embedding
  ON brain_entries USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_firm_insights_embedding
  ON firm_insights USING hnsw (embedding vector_cosine_ops);
