/* eslint-disable camelcase */
/**
 * Migration 007 — F05 Video, F06 E-Signature, F07 Commission, F08 Follow-ups
 */
exports.up = (pgm) => {

  // ── F05: LISTING VIDEOS ─────────────────────────────────────────────────────
  pgm.createTable('listing_videos', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id: { type: 'uuid', notNull: true, references: '"listings"', onDelete: 'CASCADE' },
    cloudinary_public_id: { type: 'varchar(300)', notNull: true },
    url:        { type: 'text', notNull: true },
    thumbnail_url: { type: 'text' },
    duration_seconds: { type: 'integer' },
    size_bytes: { type: 'bigint' },
    label:      { type: 'varchar(100)', default: "'Property Tour'" },
    sort_order: { type: 'smallint', default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('listing_videos', 'listing_id');

  // ── F06: EOI SIGNATURES ─────────────────────────────────────────────────────
  pgm.createType('eoi_status', ['pending', 'accepted', 'rejected', 'expired']);
  pgm.createTable('eoi_signatures', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id:   { type: 'uuid', notNull: true, references: '"listings"', onDelete: 'CASCADE' },
    agent_id:     { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    buyer_name:   { type: 'varchar(200)', notNull: true },
    buyer_phone:  { type: 'varchar(20)', notNull: true },
    buyer_email:  { type: 'varchar(255)' },
    offer_price:  { type: 'numeric(15,2)', notNull: true },
    message:      { type: 'text' },
    // Base64 SVG of the drawn signature
    signature_data: { type: 'text', notNull: true },
    // PDF Cloudinary URL once generated
    pdf_url:      { type: 'text' },
    status:       { type: 'eoi_status', default: "'pending'" },
    expires_at:   { type: 'timestamptz' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('eoi_signatures', 'listing_id');
  pgm.createIndex('eoi_signatures', 'agent_id');

  // ── F08: FOLLOW-UP SEQUENCES ────────────────────────────────────────────────
  pgm.createType('followup_status', ['scheduled', 'sent', 'failed', 'skipped', 'paused']);
  pgm.createType('followup_channel', ['whatsapp', 'email', 'sms']);
  pgm.createTable('follow_up_sequences', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    lead_id:    { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    agent_id:   { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    step:       { type: 'smallint', notNull: true },   // 1,2,3,4
    channel:    { type: 'followup_channel', notNull: true },
    template_key: { type: 'varchar(50)', notNull: true },
    scheduled_at: { type: 'timestamptz', notNull: true },
    sent_at:    { type: 'timestamptz' },
    status:     { type: 'followup_status', default: "'scheduled'" },
    error_msg:  { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('follow_up_sequences', 'lead_id');
  pgm.createIndex('follow_up_sequences', ['status', 'scheduled_at']);
  pgm.createIndex('follow_up_sequences', 'agent_id');
};

exports.down = (pgm) => {
  pgm.dropTable('follow_up_sequences');
  pgm.dropType('followup_channel');
  pgm.dropType('followup_status');
  pgm.dropTable('eoi_signatures');
  pgm.dropType('eoi_status');
  pgm.dropTable('listing_videos');
};
