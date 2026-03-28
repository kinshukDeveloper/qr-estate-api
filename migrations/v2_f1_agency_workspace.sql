-- ============================================================
--  QR Estate v2 — Feature 1: Multi-Agent Agency Workspace
--  Run in Neon SQL Editor AFTER the base schema.sql
--  Idempotent — safe to re-run
-- ============================================================

-- ── AGENCIES TABLE ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agencies (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(120) NOT NULL,
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan         plan_name NOT NULL DEFAULT 'free',
  max_agents   INTEGER NOT NULL DEFAULT 1,   -- free=1, pro=5, agency=25
  logo_url     TEXT,
  website      VARCHAR(255),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agencies_owner_id ON agencies(owner_id);

-- ── ADD agency_id TO USERS ────────────────────────────────────────────────────
-- Adds the column only if it doesn't exist (idempotent)
DO $$ BEGIN
  ALTER TABLE users ADD COLUMN agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE users ADD COLUMN agency_role VARCHAR(20) DEFAULT 'agent'
    CHECK (agency_role IN ('owner', 'agency_admin', 'agent', 'viewer'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_users_agency_id ON users(agency_id);

-- ── AGENCY_MEMBERS TABLE ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agency_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id   UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'agent'
                CHECK (role IN ('owner', 'agency_admin', 'agent', 'viewer')),
  invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_members_agency_id ON agency_members(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_members_user_id   ON agency_members(user_id);

-- ── AGENCY_INVITES TABLE ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agency_invites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id   UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  email       VARCHAR(255) NOT NULL,
  role        VARCHAR(20) NOT NULL DEFAULT 'agent'
                CHECK (role IN ('agency_admin', 'agent', 'viewer')),
  token       VARCHAR(64) NOT NULL UNIQUE,   -- nanoid(32) stored as hex
  invited_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agency_invites_token     ON agency_invites(token);
CREATE INDEX IF NOT EXISTS idx_agency_invites_email     ON agency_invites(email);
CREATE INDEX IF NOT EXISTS idx_agency_invites_agency_id ON agency_invites(agency_id);

-- ── ADD agency_id TO LISTINGS ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_listings_agency_id ON listings(agency_id);

-- ── ADD agency_id TO LEADS ───────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE leads ADD COLUMN agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_leads_agency_id ON leads(agency_id);

-- ── PLAN SEAT LIMITS (reference comment) ────────────────────────────────────
-- free     → max_agents = 1   (solo agent, no team)
-- pro      → max_agents = 5
-- agency   → max_agents = 25
