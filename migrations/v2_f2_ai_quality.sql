-- ============================================================
--  QR Estate v2 — Feature 2: Conversion Intelligence AI
--  Run in Neon SQL Editor AFTER v2_f1_agency_workspace.sql
--  Idempotent — safe to re-run
-- ============================================================

-- ── quality_score on listings ─────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN quality_score SMALLINT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN quality_breakdown JSONB DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE listings ADD COLUMN tour_url VARCHAR(500);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_listings_quality_score ON listings(quality_score);

-- ── ai_cache table ────────────────────────────────────────────────────────────
-- Stores OpenAI responses keyed by listing_id + type, with TTL managed in app
CREATE TABLE IF NOT EXISTS ai_cache (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id   UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  cache_type   VARCHAR(40) NOT NULL, -- 'tips' | 'description' | 'photo_check' | 'price_suggest'
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  UNIQUE (listing_id, cache_type)
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_listing_id ON ai_cache(listing_id);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at ON ai_cache(expires_at);

-- ── Backfill quality scores for existing listings ─────────────────────────────
-- This is a simple initial backfill — the app will recompute on next update
UPDATE listings SET quality_score = (
  CASE WHEN images != '[]'::jsonb AND jsonb_array_length(images) > 0 THEN 20 ELSE 0 END +
  CASE WHEN description IS NOT NULL AND length(description) > 100 THEN 20 ELSE 0 END +
  CASE WHEN floor_number IS NOT NULL THEN 10 ELSE 0 END +
  CASE WHEN furnishing IS NOT NULL THEN 10 ELSE 0 END +
  CASE WHEN amenities IS NOT NULL AND array_length(amenities, 1) >= 3 THEN 15 ELSE 0 END +
  CASE WHEN area_sqft IS NOT NULL THEN 10 ELSE 0 END
  -- active QR: 15pts — computed at app level
) WHERE quality_score = 0 OR quality_score IS NULL;
