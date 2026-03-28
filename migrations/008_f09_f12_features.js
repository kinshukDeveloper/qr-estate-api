/* eslint-disable camelcase */
/**
 * Migration 008 — F09 Doc Vault · F10 Market Intelligence · F11 Neighbourhood · F12 AVM
 */
exports.up = (pgm) => {

  // ── F09: DOCUMENT VAULT ─────────────────────────────────────────────────────
  pgm.createType('doc_type', [
    'floor_plan', 'title_deed', 'possession_letter', 'rera_certificate',
    'oc_cc', 'sale_agreement', 'noc', 'tax_receipt', 'other'
  ]);
  pgm.createTable('listing_documents', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id:   { type: 'uuid', notNull: true, references: '"listings"', onDelete: 'CASCADE' },
    agent_id:     { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    doc_type:     { type: 'doc_type', notNull: true },
    label:        { type: 'varchar(200)', notNull: true },
    cloudinary_public_id: { type: 'varchar(300)', notNull: true },
    url:          { type: 'text', notNull: true },
    size_bytes:   { type: 'bigint' },
    is_public:    { type: 'boolean', default: false },   // visible without request
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('listing_documents', 'listing_id');
  pgm.createIndex('listing_documents', 'agent_id');

  // Doc access requests (buyer requests → agent approves → expiring signed URL)
  pgm.createType('doc_request_status', ['pending', 'approved', 'rejected', 'expired']);
  pgm.createTable('document_access_requests', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    document_id:  { type: 'uuid', notNull: true, references: '"listing_documents"', onDelete: 'CASCADE' },
    buyer_name:   { type: 'varchar(200)', notNull: true },
    buyer_email:  { type: 'varchar(255)', notNull: true },
    buyer_phone:  { type: 'varchar(20)' },
    message:      { type: 'text' },
    status:       { type: 'doc_request_status', default: "'pending'" },
    // 48-hour signed URL token generated on approval
    access_token: { type: 'varchar(128)', unique: true },
    expires_at:   { type: 'timestamptz' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('document_access_requests', 'document_id');

  // ── F10: MARKET INTELLIGENCE ────────────────────────────────────────────────
  pgm.createTable('market_snapshots', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    city:             { type: 'varchar(100)', notNull: true },
    locality:         { type: 'varchar(100)' },
    property_type:    { type: 'property_type', notNull: true },
    listing_type:     { type: 'listing_type', notNull: true },
    avg_price:        { type: 'numeric(15,2)' },
    avg_price_sqft:   { type: 'numeric(10,2)' },
    median_price:     { type: 'numeric(15,2)' },
    total_listings:   { type: 'integer', default: 0 },
    total_views:      { type: 'integer', default: 0 },
    total_leads:      { type: 'integer', default: 0 },
    snapshot_date:    { type: 'date', notNull: true },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('market_snapshots', 'market_snapshot_unique',
    'UNIQUE (city, locality, property_type, listing_type, snapshot_date)');
  pgm.createIndex('market_snapshots', ['city', 'snapshot_date']);
  pgm.createIndex('market_snapshots', ['city', 'locality', 'property_type']);

  // ── F11: NEIGHBOURHOOD INTELLIGENCE ────────────────────────────────────────
  pgm.createType('poi_category', [
    'school', 'hospital', 'metro', 'mall', 'park',
    'bank', 'restaurant', 'gym', 'pharmacy', 'supermarket'
  ]);
  pgm.createTable('neighbourhood_pois', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id:   { type: 'uuid', notNull: true, references: '"listings"', onDelete: 'CASCADE' },
    name:         { type: 'varchar(200)', notNull: true },
    category:     { type: 'poi_category', notNull: true },
    address:      { type: 'text' },
    distance_m:   { type: 'integer' },     // metres from listing
    rating:       { type: 'numeric(2,1)' },
    google_place_id: { type: 'varchar(100)' },
    lat:          { type: 'numeric(10,7)' },
    lng:          { type: 'numeric(10,7)' },
    fetched_at:   { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('neighbourhood_pois', 'listing_id');
  pgm.createIndex('neighbourhood_pois', ['listing_id', 'category']);

  // ── F12: AVM VALUATION REPORTS ──────────────────────────────────────────────
  pgm.createTable('avm_reports', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    listing_id:       { type: 'uuid', references: '"listings"', onDelete: 'SET NULL' },
    // Can also be run for arbitrary properties (no listing)
    city:             { type: 'varchar(100)', notNull: true },
    locality:         { type: 'varchar(100)' },
    property_type:    { type: 'property_type', notNull: true },
    area_sqft:        { type: 'integer' },
    bedrooms:         { type: 'smallint' },
    input_price:      { type: 'numeric(15,2)' },    // the listed price
    estimated_low:    { type: 'numeric(15,2)' },
    estimated_mid:    { type: 'numeric(15,2)' },
    estimated_high:   { type: 'numeric(15,2)' },
    confidence_score: { type: 'integer' },           // 0–100
    comparables_used: { type: 'integer' },
    ai_summary:       { type: 'text' },
    comparables:      { type: 'jsonb' },             // array of comparable listings
    requested_by:     { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('avm_reports', 'listing_id');
  pgm.createIndex('avm_reports', ['city', 'locality', 'property_type']);
};

exports.down = (pgm) => {
  pgm.dropTable('avm_reports');
  pgm.dropTable('neighbourhood_pois');
  pgm.dropType('poi_category');
  pgm.dropTable('market_snapshots');
  pgm.dropTable('document_access_requests');
  pgm.dropType('doc_request_status');
  pgm.dropTable('listing_documents');
  pgm.dropType('doc_type');
};
