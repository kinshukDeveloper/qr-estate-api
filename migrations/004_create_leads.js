/* eslint-disable camelcase */

/**
 * Migration: Create leads table
 * Run: npm run db:migrate
 */
exports.up = (pgm) => {
  pgm.createType('lead_status', ['new', 'contacted', 'interested', 'not_interested', 'converted', 'lost']);
  pgm.createType('lead_source', ['whatsapp', 'call', 'manual', 'qr_scan', 'website']);

  pgm.createTable('leads', {
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
    listing_id: {
      type: 'uuid',
      references: '"listings"',
      onDelete: 'SET NULL',
    },

    // ── CONTACT INFO ──────────────────────────────────────────────
    name: { type: 'varchar(100)' },
    phone: { type: 'varchar(20)', notNull: true },
    email: { type: 'varchar(200)' },
    message: { type: 'text' },

    // ── CRM FIELDS ────────────────────────────────────────────────
    status: {
      type: 'lead_status',
      notNull: true,
      default: "'new'",
    },
    source: {
      type: 'lead_source',
      notNull: true,
      default: "'manual'",
    },
    notes: { type: 'text' },
    follow_up_date: { type: 'timestamptz' },
    budget: { type: 'numeric(15,2)' },

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

  pgm.createIndex('leads', 'agent_id');
  pgm.createIndex('leads', 'listing_id');
  pgm.createIndex('leads', 'status');
  pgm.createIndex('leads', 'phone');
  pgm.createIndex('leads', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('leads');
  pgm.dropType('lead_source');
  pgm.dropType('lead_status');
};
