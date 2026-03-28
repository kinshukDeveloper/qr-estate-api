/* eslint-disable camelcase */
/**
 * Migration 006 — Buyer Features (F01–F04)
 * Adds: saved_listings, price_alerts, listing_price_history, voice_search_logs
 */

exports.up = (pgm) => {
  // ── F01: SAVED LISTINGS ─────────────────────────────────────────────────────
  // Works for both guests (session_token) and logged-in users (user_id)
  pgm.createTable('saved_listings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: '"listings"',
      onDelete: 'CASCADE',
    },
    // Logged-in user (optional)
    user_id: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'CASCADE',
    },
    // Guest session token (used when not logged in)
    session_token: {
      type: 'varchar(128)',
    },
    // Optional: buyer email captured via email gate
    buyer_email: {
      type: 'varchar(255)',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // A listing can only be saved once per user OR once per session
  pgm.addConstraint(
    'saved_listings',
    'saved_listings_user_unique',
    'UNIQUE (listing_id, user_id)'
  );
  pgm.addConstraint(
    'saved_listings',
    'saved_listings_session_unique',
    'UNIQUE (listing_id, session_token)'
  );
  pgm.addConstraint(
    'saved_listings',
    'saved_listings_must_have_identity',
    'CHECK (user_id IS NOT NULL OR session_token IS NOT NULL)'
  );

  pgm.createIndex('saved_listings', 'listing_id');
  pgm.createIndex('saved_listings', 'user_id');
  pgm.createIndex('saved_listings', 'session_token');

  // ── F03: PRICE HISTORY ──────────────────────────────────────────────────────
  // Logged every time a listing price changes (via trigger)
  pgm.createTable('listing_price_history', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: '"listings"',
      onDelete: 'CASCADE',
    },
    old_price: {
      type: 'numeric(15,2)',
      notNull: true,
    },
    new_price: {
      type: 'numeric(15,2)',
      notNull: true,
    },
    changed_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('listing_price_history', 'listing_id');

  // ── F03: PRICE ALERTS ───────────────────────────────────────────────────────
  pgm.createTable('price_alerts', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: '"listings"',
      onDelete: 'CASCADE',
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
    },
    // The price at the time of signup — alerts fire only on drops
    price_at_signup: {
      type: 'numeric(15,2)',
      notNull: true,
    },
    is_active: {
      type: 'boolean',
      default: true,
      notNull: true,
    },
    // Unsubscribe token (sent in email footer)
    unsubscribe_token: {
      type: 'varchar(64)',
      notNull: true,
      unique: true,
    },
    last_notified_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // One alert per email per listing
  pgm.addConstraint(
    'price_alerts',
    'price_alerts_email_listing_unique',
    'UNIQUE (listing_id, email)'
  );

  pgm.createIndex('price_alerts', 'listing_id');
  pgm.createIndex('price_alerts', ['is_active', 'listing_id']);

  // ── F04: VOICE SEARCH LOGS ──────────────────────────────────────────────────
  // Analytics + debugging for voice queries
  pgm.createTable('voice_search_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    transcript: {
      type: 'text',
      notNull: true,
    },
    parsed_filters: {
      type: 'jsonb',
    },
    results_count: {
      type: 'integer',
      default: 0,
    },
    user_id: {
      type: 'uuid',
      references: '"users"',
      onDelete: 'SET NULL',
    },
    session_token: {
      type: 'varchar(128)',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // ── DB TRIGGER: auto-log price changes ─────────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION log_listing_price_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.price IS DISTINCT FROM NEW.price THEN
        INSERT INTO listing_price_history (listing_id, old_price, new_price)
        VALUES (NEW.id, OLD.price, NEW.price);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_listing_price_history
    AFTER UPDATE OF price ON listings
    FOR EACH ROW
    EXECUTE FUNCTION log_listing_price_change();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trigger_listing_price_history ON listings;
    DROP FUNCTION IF EXISTS log_listing_price_change();
  `);
  pgm.dropTable('voice_search_logs');
  pgm.dropTable('price_alerts');
  pgm.dropTable('listing_price_history');
  pgm.dropTable('saved_listings');
};
