/* eslint-disable camelcase */

/**
 * Migration: Create qr_codes and qr_scans tables
 * Run: npm run db:migrate
 */
exports.up = (pgm) => {
  // ── QR CODES TABLE ────────────────────────────────────────────────────────
  pgm.createTable('qr_codes', {
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
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    short_code: {
      type: 'varchar(12)',
      notNull: true,
      unique: true,
    },

    // ── QR APPEARANCE ────────────────────────────────────────────────────
    style: {
      type: 'varchar(20)',
      default: "'standard'",
      // standard | branded | minimal
    },
    foreground_color: {
      type: 'varchar(7)',
      default: "'#000000'",
    },
    background_color: {
      type: 'varchar(7)',
      default: "'#FFFFFF'",
    },
    include_logo: {
      type: 'boolean',
      default: false,
    },
    include_frame: {
      type: 'boolean',
      default: false,
    },
    frame_label: {
      type: 'varchar(60)',
      // e.g. "Scan to View Property"
    },

    // ── GENERATED ASSETS ─────────────────────────────────────────────────
    qr_url: {
      type: 'text',
      // Cloudinary URL of the generated QR image
    },
    qr_public_id: {
      type: 'varchar(200)',
    },
    target_url: {
      type: 'text',
      notNull: true,
      // The URL the QR code points to
    },

    // ── STATS ─────────────────────────────────────────────────────────────
    scan_count: {
      type: 'integer',
      default: 0,
    },
    is_active: {
      type: 'boolean',
      default: true,
    },

    // ── TIMESTAMPS ────────────────────────────────────────────────────────
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

  pgm.createIndex('qr_codes', 'listing_id');
  pgm.createIndex('qr_codes', 'agent_id');
  pgm.createIndex('qr_codes', 'short_code');
  pgm.createIndex('qr_codes', 'is_active');

  // ── QR SCANS TABLE ────────────────────────────────────────────────────────
  pgm.createTable('qr_scans', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    qr_code_id: {
      type: 'uuid',
      notNull: true,
      references: '"qr_codes"',
      onDelete: 'CASCADE',
    },
    listing_id: {
      type: 'uuid',
      notNull: true,
      references: '"listings"',
      onDelete: 'CASCADE',
    },

    // ── SCAN METADATA ─────────────────────────────────────────────────────
    ip_address: {
      type: 'varchar(45)',
    },
    user_agent: {
      type: 'text',
    },
    device_type: {
      type: 'varchar(20)',
      // mobile | tablet | desktop
    },
    city: {
      type: 'varchar(100)',
    },
    country: {
      type: 'varchar(100)',
    },
    referrer: {
      type: 'text',
    },
    scanned_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.createIndex('qr_scans', 'qr_code_id');
  pgm.createIndex('qr_scans', 'listing_id');
  pgm.createIndex('qr_scans', 'scanned_at');
};

exports.down = (pgm) => {
  pgm.dropTable('qr_scans');
  pgm.dropTable('qr_codes');
};
