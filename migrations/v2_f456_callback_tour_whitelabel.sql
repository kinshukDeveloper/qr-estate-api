-- ============================================================
--  QR Estate v2 — Features 4, 5 & 6
--  Run AFTER v2_f2_ai_quality.sql
--  Idempotent — safe to re-run
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FEATURE 4 — 60-second callback
-- ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE callback_status AS ENUM (
    'pending', 'calling', 'connected', 'missed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS callback_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id   UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  buyer_phone  VARCHAR(15) NOT NULL,
  status       callback_status NOT NULL DEFAULT 'pending',
  -- Twilio call SID for tracking
  call_sid     VARCHAR(64),
  -- Timestamps
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  -- Prevent spam: one request per buyer phone per listing per hour
  UNIQUE (listing_id, buyer_phone, status)
);

CREATE INDEX IF NOT EXISTS idx_cb_listing_id  ON callback_requests(listing_id);
CREATE INDEX IF NOT EXISTS idx_cb_agent_id    ON callback_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_cb_status      ON callback_requests(status);
CREATE INDEX IF NOT EXISTS idx_cb_requested   ON callback_requests(requested_at);

-- ─────────────────────────────────────────────────────────────
-- FEATURE 5 — Virtual tour embed
-- ─────────────────────────────────────────────────────────────

-- Add tour_url to listings (safe — idempotent)
DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN tour_url VARCHAR(500);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Track tour views separately in qr_scans via event_type column
DO $$ BEGIN
  ALTER TABLE qr_scans ADD COLUMN event_type VARCHAR(20) DEFAULT 'scan';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_listings_tour_url ON listings(tour_url)
  WHERE tour_url IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- FEATURE 6 — White-label platform
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS white_label_configs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id        UUID NOT NULL UNIQUE REFERENCES agencies(id) ON DELETE CASCADE,

  -- Domain routing
  custom_domain    VARCHAR(253),           -- e.g. properties.mybrokerage.com
  domain_verified  BOOLEAN DEFAULT FALSE,
  verify_token     VARCHAR(64),            -- DNS TXT record value

  -- Branding
  brand_name       VARCHAR(100) NOT NULL,
  logo_url         TEXT,
  favicon_url      TEXT,
  primary_color    VARCHAR(7)  DEFAULT '#00D4C8',
  secondary_color  VARCHAR(7)  DEFAULT '#FFB830',
  font_choice      VARCHAR(30) DEFAULT 'Outfit',  -- Outfit | Poppins | Inter | Raleway | Lato

  -- Contact / footer
  support_email    VARCHAR(255),
  support_phone    VARCHAR(20),
  website          VARCHAR(255),
  footer_text      VARCHAR(200),

  -- Feature flags
  hide_powered_by  BOOLEAN DEFAULT FALSE,   -- requires Agency plan
  custom_email_from VARCHAR(255),           -- e.g. noreply@mybrokerage.com

  -- Billing guard
  plan_expires_at  TIMESTAMPTZ,
  is_active        BOOLEAN DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wl_agency_id     ON white_label_configs(agency_id);
CREATE INDEX IF NOT EXISTS idx_wl_custom_domain ON white_label_configs(custom_domain)
  WHERE custom_domain IS NOT NULL;

-- Add white_label plan tier to plan_name enum if not already present
-- (The base schema has: free | pro | agency — white_label is a superset of agency)
DO $$ BEGIN
  ALTER TYPE plan_name ADD VALUE IF NOT EXISTS 'white_label';
EXCEPTION WHEN others THEN NULL; END $$;
