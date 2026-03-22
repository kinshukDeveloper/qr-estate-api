/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createType('plan_name', ['free', 'pro', 'agency']);

  pgm.addColumns('users', {
    plan: {
      type: 'plan_name',
      notNull: true,
      default: "'free'",
    },
    plan_expires_at: {
      type: 'timestamptz',
    },
    razorpay_customer_id: {
      type: 'varchar(100)',
    },
    razorpay_subscription_id: {
      type: 'varchar(100)',
    },
    subscription_status: {
      type: 'varchar(20)',
      default: "'active'",
      // active | past_due | cancelled | paused
    },
  });

  // Payments log table
  pgm.createTable('payments', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: '"users"',
      onDelete: 'CASCADE',
    },
    razorpay_order_id: { type: 'varchar(100)' },
    razorpay_payment_id: { type: 'varchar(100)' },
    razorpay_signature: { type: 'varchar(200)' },
    plan: { type: 'plan_name', notNull: true },
    amount: { type: 'integer', notNull: true }, // in paise
    currency: { type: 'varchar(5)', default: "'INR'" },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: "'pending'",
      // pending | success | failed | refunded
    },
    metadata: { type: 'jsonb' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.createIndex('payments', 'user_id');
  pgm.createIndex('payments', 'razorpay_order_id');
  pgm.createIndex('payments', 'status');
};

exports.down = (pgm) => {
  pgm.dropTable('payments');
  pgm.dropColumns('users', ['plan', 'plan_expires_at', 'razorpay_customer_id', 'razorpay_subscription_id', 'subscription_status']);
  pgm.dropType('plan_name');
};
