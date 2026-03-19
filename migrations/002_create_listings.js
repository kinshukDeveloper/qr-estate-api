/* eslint-disable camelcase */

/**
 * Migration: Create listings table
 * Run: npm run db:migrate
 */
exports.up = (pgm) => {
  // Enums
  pgm.createType('property_type', ['apartment', 'villa', 'plot', 'commercial', 'pg', 'house']);
  pgm.createType('listing_type', ['sale', 'rent']);
  pgm.createType('listing_status', ['draft', 'active', 'sold', 'rented', 'inactive']);

  pgm.createTable('listings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },

    // ── CORE ──────────────────────────────────────────────────────
    title: {
      type: 'varchar(200)',
      notNull: true,
    },
    description: {
      type: 'text',
    },
    property_type: {
      type: 'property_type',
      notNull: true,
    },
    listing_type: {
      type: 'listing_type',
      notNull: true,
    },

    // ── PRICING ───────────────────────────────────────────────────
    price: {
      type: 'numeric(15,2)',
      notNull: true,
    },
    price_negotiable: {
      type: 'boolean',
      default: false,
    },

    // ── SPECS ─────────────────────────────────────────────────────
    bedrooms: {
      type: 'smallint',
    },
    bathrooms: {
      type: 'smallint',
    },
    area_sqft: {
      type: 'numeric(10,2)',
    },
    floor_number: {
      type: 'smallint',
    },
    total_floors: {
      type: 'smallint',
    },
    furnishing: {
      type: 'varchar(20)',
      check: "furnishing IN ('unfurnished','semi-furnished','fully-furnished')",
    },
    facing: {
      type: 'varchar(20)',
    },

    // ── LOCATION ──────────────────────────────────────────────────
    address: {
      type: 'text',
      notNull: true,
    },
    locality: {
      type: 'varchar(100)',
    },
    city: {
      type: 'varchar(100)',
      notNull: true,
    },
    state: {
      type: 'varchar(100)',
      notNull: true,
    },
    pincode: {
      type: 'varchar(10)',
    },
    latitude: {
      type: 'numeric(10,7)',
    },
    longitude: {
      type: 'numeric(10,7)',
    },

    // ── MEDIA ─────────────────────────────────────────────────────
    images: {
      type: 'jsonb',
      default: "'[]'",
      // Array of { url, public_id, is_primary }
    },

    // ── AMENITIES ─────────────────────────────────────────────────
    amenities: {
      type: 'text[]',
      default: "'{}'",
    },

    // ── STATUS & META ─────────────────────────────────────────────
    status: {
      type: 'listing_status',
      notNull: true,
      default: "'draft'",
    },
    is_featured: {
      type: 'boolean',
      default: false,
    },
    view_count: {
      type: 'integer',
      default: 0,
    },
    short_code: {
      type: 'varchar(12)',
      unique: true,
    },

    // ── TIMESTAMPS ────────────────────────────────────────────────
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  // Indexes for common queries
  pgm.createIndex('listings', 'agent_id');
  pgm.createIndex('listings', 'status');
  pgm.createIndex('listings', 'city');
  pgm.createIndex('listings', 'property_type');
  pgm.createIndex('listings', 'listing_type');
  pgm.createIndex('listings', 'price');
  pgm.createIndex('listings', 'created_at');
  pgm.createIndex('listings', 'short_code');
};

exports.down = (pgm) => {
  pgm.dropTable('listings');
  pgm.dropType('listing_status');
  pgm.dropType('listing_type');
  pgm.dropType('property_type');
};
