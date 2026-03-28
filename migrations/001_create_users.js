/* eslint-disable camelcase */

/**
 * Migration: Create users table
 * Run: npm run db:migrate
 */
exports.up = (pgm) => {
  // Enable UUID extension
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: {
      type: 'varchar(80)',
      notNull: true,
    },
    email: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
    },
    password_hash: {
      type: 'varchar(255)',
      notNull: true,
    },
    phone: {
      type: 'varchar(15)',
    },
    rera_number: {
      type: 'varchar(50)',
    },
    role: {
      type: 'varchar(20)',
      notNull: true,
      default: 'agent',
      check: "role IN ('agent', 'agency_admin', 'admin')",
    },
    profile_photo: {
      type: 'text',
    },
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    is_verified: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    last_login: {
      type: 'timestamptz',
    },
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

  // Indexes
  pgm.createIndex('users', 'email');
  pgm.createIndex('users', 'role');
  pgm.createIndex('users', 'created_at');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
