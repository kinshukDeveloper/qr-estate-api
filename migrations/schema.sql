-- ============================================================
--  QR Estate — Neon DB Schema
--  Run this file once in your Neon SQL Editor or via psql:
--    psql $DATABASE_URL -f migrations/schema.sql
-- ============================================================

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUM TYPES ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE property_type   AS ENUM ('apartment','villa','plot','commercial','pg','house');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_type    AS ENUM ('sale','rent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status  AS ENUM ('draft','active','sold','rented','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status     AS ENUM ('new','contacted','interested','not_interested','converted','lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_source     AS ENUM ('whatsapp','call','manual','qr_scan','website');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plan_name       AS ENUM ('free','pro','agency');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                     VARCHAR(80)  NOT NULL,
  email                    VARCHAR(255) NOT NULL UNIQUE,
  password_hash            VARCHAR(255) NOT NULL,
  phone                    VARCHAR(15),
  rera_number              VARCHAR(50),
  role                     VARCHAR(20)  NOT NULL DEFAULT 'agent'
                             CHECK (role IN ('agent','agency_admin','admin')),
  profile_photo            TEXT,
  is_active                BOOLEAN      NOT NULL DEFAULT TRUE,
  is_verified              BOOLEAN      NOT NULL DEFAULT FALSE,
  last_login               TIMESTAMPTZ,

  -- Billing (migration 005)
  plan                     plan_name    NOT NULL DEFAULT 'free',
  plan_expires_at          TIMESTAMPTZ,
  razorpay_customer_id     VARCHAR(100),
  razorpay_subscription_id VARCHAR(100),
  subscription_status      VARCHAR(20)  DEFAULT 'active',

  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- ── LISTINGS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Core
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  property_type    property_type NOT NULL,
  listing_type     listing_type  NOT NULL,

  -- Pricing
  price            NUMERIC(15,2) NOT NULL,
  price_negotiable BOOLEAN DEFAULT FALSE,

  -- Specs
  bedrooms         SMALLINT,
  bathrooms        SMALLINT,
  area_sqft        NUMERIC(10,2),
  floor_number     SMALLINT,
  total_floors     SMALLINT,
  furnishing       VARCHAR(20) CHECK (furnishing IN ('unfurnished','semi-furnished','fully-furnished')),
  facing           VARCHAR(20),

  -- Location
  address          TEXT NOT NULL,
  locality         VARCHAR(100),
  city             VARCHAR(100) NOT NULL,
  state            VARCHAR(100) NOT NULL,
  pincode          VARCHAR(10),
  latitude         NUMERIC(10,7),
  longitude        NUMERIC(10,7),

  -- Media
  images           JSONB NOT NULL DEFAULT '[]',
  amenities        TEXT[] NOT NULL DEFAULT '{}',

  -- Status
  status           listing_status NOT NULL DEFAULT 'draft',
  is_featured      BOOLEAN DEFAULT FALSE,
  view_count       INTEGER DEFAULT 0,
  short_code       VARCHAR(12) UNIQUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_agent_id      ON listings(agent_id);
CREATE INDEX IF NOT EXISTS idx_listings_status        ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_city          ON listings(city);
CREATE INDEX IF NOT EXISTS idx_listings_property_type ON listings(property_type);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type  ON listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_listings_price         ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_created_at    ON listings(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_short_code    ON listings(short_code);

-- ── QR CODES ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_codes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id       UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  short_code       VARCHAR(12) NOT NULL UNIQUE,

  -- Appearance
  style            VARCHAR(20) DEFAULT 'standard',
  foreground_color VARCHAR(7)  DEFAULT '#000000',
  background_color VARCHAR(7)  DEFAULT '#FFFFFF',
  include_logo     BOOLEAN     DEFAULT FALSE,
  include_frame    BOOLEAN     DEFAULT FALSE,
  frame_label      VARCHAR(60),

  -- Generated assets
  qr_url           TEXT,
  qr_public_id     VARCHAR(200),
  target_url       TEXT NOT NULL,

  -- Stats
  scan_count       INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_codes_listing_id  ON qr_codes(listing_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_agent_id    ON qr_codes(agent_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_short_code  ON qr_codes(short_code);
CREATE INDEX IF NOT EXISTS idx_qr_codes_is_active   ON qr_codes(is_active);

-- ── QR SCANS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qr_scans (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  qr_code_id   UUID NOT NULL REFERENCES qr_codes(id)  ON DELETE CASCADE,
  listing_id   UUID NOT NULL REFERENCES listings(id)  ON DELETE CASCADE,

  ip_address   VARCHAR(45),
  user_agent   TEXT,
  device_type  VARCHAR(20),
  city         VARCHAR(100),
  country      VARCHAR(100),
  referrer     TEXT,
  scanned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_scans_qr_code_id ON qr_scans(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_scans_listing_id ON qr_scans(listing_id);
CREATE INDEX IF NOT EXISTS idx_qr_scans_scanned_at ON qr_scans(scanned_at);

-- ── LEADS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id       UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  listing_id     UUID          REFERENCES listings(id) ON DELETE SET NULL,

  -- Contact
  name           VARCHAR(100),
  phone          VARCHAR(20) NOT NULL,
  email          VARCHAR(200),
  message        TEXT,

  -- CRM
  status         lead_status NOT NULL DEFAULT 'new',
  source         lead_source NOT NULL DEFAULT 'manual',
  notes          TEXT,
  follow_up_date TIMESTAMPTZ,
  budget         NUMERIC(15,2),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_agent_id    ON leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_listing_id  ON leads(listing_id);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);

-- ── PAYMENTS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id    VARCHAR(100),
  razorpay_payment_id  VARCHAR(100),
  razorpay_signature   VARCHAR(200),
  plan                 plan_name NOT NULL,
  amount               INTEGER NOT NULL, -- in paise
  currency             VARCHAR(5) DEFAULT 'INR',
  status               VARCHAR(20) NOT NULL DEFAULT 'pending',
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id           ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order_id ON payments(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status            ON payments(status);
