-- ============================================================
--  QR Estate v2 — Features 7, 8 & 9
--  Run AFTER v2_f456_callback_tour_whitelabel.sql
--  Idempotent — safe to re-run
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FEATURE 7 — Portal API
-- ─────────────────────────────────────────────────────────────

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id    UUID REFERENCES agencies(id) ON DELETE SET NULL,

  name         VARCHAR(100) NOT NULL,              -- "MagicBricks Integration"
  key_prefix   TEXT   NOT NULL,              -- "qre_live_"
  key_hash     VARCHAR(64)  NOT NULL UNIQUE,       -- SHA-256 of the full key
  key_preview  VARCHAR(20)  NOT NULL,              -- "qre_live_aBcD...XyZ"

  -- Permissions (bitmask stored as array for readability)
  scopes       TEXT[]       NOT NULL DEFAULT ARRAY['listings:read'],

  -- Rate limiting
  rate_limit   INTEGER      NOT NULL DEFAULT 1000,  -- requests per hour
  last_used_at TIMESTAMPTZ,
  usage_count  BIGINT       NOT NULL DEFAULT 0,

  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  expires_at   TIMESTAMPTZ,                         -- NULL = never expires
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_agent   ON api_keys(agent_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash    ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix  ON api_keys(key_prefix);

-- Webhook endpoints
CREATE TABLE IF NOT EXISTS webhooks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id    UUID REFERENCES agencies(id) ON DELETE SET NULL,

  name         VARCHAR(100) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  secret       VARCHAR(64)  NOT NULL,   -- HMAC-SHA256 signing secret
  events       TEXT[]       NOT NULL DEFAULT ARRAY['lead.created'],

  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  success_count INTEGER     NOT NULL DEFAULT 0,
  fail_count    INTEGER     NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_agent   ON webhooks(agent_id);

-- Webhook delivery log (last 100 per webhook)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id   UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type   VARCHAR(50) NOT NULL,
  payload      JSONB       NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success      BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_wh_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_wh_deliveries_time    ON webhook_deliveries(delivered_at DESC);

-- ─────────────────────────────────────────────────────────────
-- FEATURE 8 — AI Optimizer (reuses ai_cache table)
-- adds new cache_types: 'price_suggest' | 'title_optimize' | 'amenity_gap'
-- No new tables needed — extend ai_cache
-- ─────────────────────────────────────────────────────────────

-- Add optimizer columns to listings
DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN suggested_price BIGINT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN conversion_score SMALLINT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_listings_conv_score ON listings(conversion_score);
CREATE INDEX IF NOT EXISTS idx_listings_sug_price  ON listings(suggested_price)
  WHERE suggested_price IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- FEATURE 9 — Builder Suite
-- ─────────────────────────────────────────────────────────────

-- Listing templates
CREATE TABLE IF NOT EXISTS listing_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id    UUID REFERENCES agencies(id) ON DELETE SET NULL,

  name         VARCHAR(100) NOT NULL,
  description  VARCHAR(500),
  template_data JSONB       NOT NULL,   -- full listing fields as JSON
  use_count    INTEGER      NOT NULL DEFAULT 0,
  is_shared    BOOLEAN      NOT NULL DEFAULT FALSE,  -- share within agency

  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_agent    ON listing_templates(agent_id);
CREATE INDEX IF NOT EXISTS idx_templates_agency   ON listing_templates(agency_id)
  WHERE agency_id IS NOT NULL;

-- Bulk import jobs (tracks CSV import status)
CREATE TABLE IF NOT EXISTS import_jobs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed
  filename     VARCHAR(255),
  total_rows   INTEGER NOT NULL DEFAULT 0,
  success_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows  INTEGER NOT NULL DEFAULT 0,
  errors       JSONB   NOT NULL DEFAULT '[]',
  created_listing_ids UUID[] DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_agent ON import_jobs(agent_id);
