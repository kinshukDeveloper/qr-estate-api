/* eslint-disable camelcase */
/**
 * Migration 009 — F13 Lead Scoring · F14 Photo Advisor · F15 AI Chat
 *               · F16 NRI Portal · F17 EMI Calculator · F18 Featured + Reviews
 */
exports.up = (pgm) => {

  // ── F13: LEAD SCORES ────────────────────────────────────────────────────────
  pgm.createTable('lead_scores', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    lead_id:      { type: 'uuid', notNull: true, unique: true, references: '"leads"', onDelete: 'CASCADE' },
    score:        { type: 'integer', notNull: true, default: 0 },    // 0–100
    grade:        { type: 'varchar(10)', notNull: true, default: "'COLD'" },  // HOT/WARM/COLD
    scan_count:   { type: 'integer', default: 0 },
    dwell_minutes: { type: 'numeric(6,2)', default: 0 },
    callback_requested: { type: 'boolean', default: false },
    message_quality_score: { type: 'integer', default: 0 },         // 0–20 from GPT
    follow_up_responded:   { type: 'boolean', default: false },
    listing_saves:         { type: 'integer', default: 0 },
    score_breakdown: { type: 'jsonb' },   // full factor breakdown
    last_scored_at:  { type: 'timestamptz', default: pgm.func('now()') },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('lead_scores', 'lead_id');
  pgm.createIndex('lead_scores', ['grade', 'score']);

  // ── F14: PHOTO ADVISOR REPORTS ──────────────────────────────────────────────
  pgm.createTable('photo_advisor_reports', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id: { type: 'uuid', notNull: true, references: '"listings"', onDelete: 'CASCADE' },
    agent_id:   { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    image_url:  { type: 'text', notNull: true },
    overall_score:  { type: 'integer' },          // 0–100
    issues:         { type: 'jsonb' },            // array of { issue, severity, suggestion }
    ai_feedback:    { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('photo_advisor_reports', 'listing_id');

  // ── F15: AI CHAT LOGS ───────────────────────────────────────────────────────
  pgm.createTable('ai_chat_sessions', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id: { type: 'uuid', references: '"listings"', onDelete: 'SET NULL' },
    session_token: { type: 'varchar(128)', notNull: true },
    messages:   { type: 'jsonb', notNull: true, default: "'[]'" },   // [{role,content,ts}]
    lead_captured: { type: 'boolean', default: false },
    lead_name:  { type: 'varchar(200)' },
    lead_phone: { type: 'varchar(20)' },
    lead_email: { type: 'varchar(255)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('ai_chat_sessions', 'listing_id');
  pgm.createIndex('ai_chat_sessions', 'session_token');

  // ── F16: NRI CALLBACK REQUESTS ──────────────────────────────────────────────
  pgm.createTable('nri_callbacks', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id:   { type: 'uuid', references: '"listings"', onDelete: 'SET NULL' },
    agent_id:     { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    name:         { type: 'varchar(200)', notNull: true },
    email:        { type: 'varchar(255)', notNull: true },
    phone:        { type: 'varchar(30)' },
    country:      { type: 'varchar(100)', notNull: true },
    timezone:     { type: 'varchar(60)', notNull: true },
    preferred_time: { type: 'varchar(100)' },     // e.g. "Mon–Fri 7–9pm IST"
    message:      { type: 'text' },
    status:       { type: 'varchar(20)', default: "'pending'" },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('nri_callbacks', 'listing_id');
  pgm.createIndex('nri_callbacks', 'agent_id');

  // ── F18: FEATURED LISTINGS ──────────────────────────────────────────────────
  pgm.createTable('featured_listings', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id:   { type: 'uuid', notNull: true, unique: true, references: '"listings"', onDelete: 'CASCADE' },
    agent_id:     { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    boost_tier:   { type: 'varchar(20)', notNull: true, default: "'basic'" },  // basic/premium/top
    price_paid:   { type: 'integer', notNull: true },     // paise
    starts_at:    { type: 'timestamptz', notNull: true },
    ends_at:      { type: 'timestamptz', notNull: true },
    is_active:    { type: 'boolean', default: true },
    impressions:  { type: 'integer', default: 0 },
    clicks:       { type: 'integer', default: 0 },
    payment_id:   { type: 'varchar(100)' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('featured_listings', ['is_active', 'ends_at']);
  pgm.createIndex('featured_listings', 'agent_id');

  // ── F18: AGENT REVIEWS ──────────────────────────────────────────────────────
  pgm.createTable('agent_reviews', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    agent_id:     { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    listing_id:   { type: 'uuid', references: '"listings"', onDelete: 'SET NULL' },
    reviewer_name:  { type: 'varchar(200)', notNull: true },
    reviewer_email: { type: 'varchar(255)' },
    rating:       { type: 'smallint', notNull: true },    // 1–5
    title:        { type: 'varchar(200)' },
    body:         { type: 'text' },
    is_verified:  { type: 'boolean', default: false },    // verified = from confirmed transaction
    is_visible:   { type: 'boolean', default: true },
    agent_reply:  { type: 'text' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('agent_reviews', 'rating_range', 'CHECK (rating BETWEEN 1 AND 5)');
  pgm.createIndex('agent_reviews', 'agent_id');
  pgm.createIndex('agent_reviews', ['agent_id', 'is_visible']);
};

exports.down = (pgm) => {
  pgm.dropTable('agent_reviews');
  pgm.dropTable('featured_listings');
  pgm.dropTable('nri_callbacks');
  pgm.dropTable('ai_chat_sessions');
  pgm.dropTable('photo_advisor_reports');
  pgm.dropTable('lead_scores');
};
