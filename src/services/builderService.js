'use strict';
/**
 * builderService.js — Feature 9: Builder Suite
 *
 * - Listing templates (save / clone / share within agency)
 * - Bulk CSV import (parse, validate, create listings)
 * - Bulk QR generation (all active listings at once)
 * - Bulk export (CSV with analytics)
 */

const { query, getClient } = require('../config/database');
const { createError }      = require('../middleware/errorHandler');
const { nanoid }           = require('nanoid');

// ── TEMPLATES ─────────────────────────────────────────────────────────────────

const TEMPLATE_FIELDS = [
  'property_type','listing_type','bedrooms','bathrooms','area_sqft',
  'floor_number','total_floors','furnishing','facing',
  'locality','city','state','pincode',
  'amenities','description',
];

async function saveTemplate(agentId, { listingId, name, isShared }) {
  if (!name?.trim()) throw createError('Template name is required', 400);

  let templateData;
  if (listingId) {
    // Save from existing listing
    const res = await query(
      'SELECT * FROM listings WHERE id=$1 AND agent_id=$2', [listingId, agentId]
    );
    if (!res.rows[0]) throw createError('Listing not found', 404);
    const l = res.rows[0];
    templateData = {};
    TEMPLATE_FIELDS.forEach(f => { if (l[f] != null) templateData[f] = l[f]; });
  } else {
    throw createError('listingId is required to save a template', 400);
  }

  // Get agency_id for sharing
  const userRes = await query('SELECT agency_id FROM users WHERE id=$1', [agentId]);
  const agencyId = userRes.rows[0]?.agency_id || null;

  const res = await query(
    `INSERT INTO listing_templates (agent_id, agency_id, name, template_data, is_shared)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [agentId, agencyId, name.trim(), JSON.stringify(templateData), !!isShared]
  );
  return res.rows[0];
}

async function listTemplates(agentId) {
  // Own templates + shared templates from same agency
  const userRes = await query('SELECT agency_id FROM users WHERE id=$1', [agentId]);
  const agencyId = userRes.rows[0]?.agency_id;

  const res = await query(
    `SELECT t.*, u.name AS creator_name
     FROM listing_templates t JOIN users u ON u.id=t.agent_id
     WHERE t.agent_id=$1
        OR (t.is_shared=true AND t.agency_id=$2 AND $2 IS NOT NULL)
     ORDER BY t.use_count DESC, t.created_at DESC`,
    [agentId, agencyId]
  );
  return res.rows;
}

async function deleteTemplate(agentId, templateId) {
  const res = await query(
    'DELETE FROM listing_templates WHERE id=$1 AND agent_id=$2 RETURNING id',
    [templateId, agentId]
  );
  if (!res.rows[0]) throw createError('Template not found', 404);
  return { deleted: true };
}

async function cloneFromTemplate(agentId, templateId, overrides = {}) {
  const tRes = await query(
    `SELECT t.* FROM listing_templates t
     LEFT JOIN users u ON u.id=$1
     WHERE t.id=$2 AND (t.agent_id=$1 OR (t.is_shared=true AND t.agency_id=u.agency_id))`,
    [agentId, templateId]
  );
  const tmpl = tRes.rows[0];
  if (!tmpl) throw createError('Template not found', 404);

  // Merge template + overrides
  const data = { ...tmpl.template_data, ...overrides };

  // Required fields
  if (!data.title)    data.title    = `${tmpl.name} — Copy`;
  if (!data.price)    throw createError('price is required as an override', 400);
  if (!data.address)  throw createError('address is required as an override', 400);

  const shortCode = nanoid(8);
  const res = await query(
    `INSERT INTO listings (
       agent_id, title, description, property_type, listing_type,
       price, price_negotiable, bedrooms, bathrooms, area_sqft,
       floor_number, total_floors, furnishing, facing,
       address, locality, city, state, pincode,
       amenities, status, short_code
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      agentId, data.title, data.description || null, data.property_type || 'apartment',
      data.listing_type || 'sale', data.price, data.price_negotiable || false,
      data.bedrooms || null, data.bathrooms || null, data.area_sqft || null,
      data.floor_number ?? null, data.total_floors || null,
      data.furnishing || null, data.facing || null,
      data.address, data.locality || null, data.city || '', data.state || '', data.pincode || null,
      data.amenities || [], 'draft', shortCode,
    ]
  );

  // Increment use_count
  await query('UPDATE listing_templates SET use_count=use_count+1 WHERE id=$1', [templateId]);

  return res.rows[0];
}

// ── BULK CSV IMPORT ───────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'title','property_type','listing_type','price','bedrooms','bathrooms',
  'area_sqft','floor_number','total_floors','furnishing','facing',
  'address','locality','city','state','pincode','amenities','description',
];

function parseCSVRow(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h.trim().toLowerCase()] = (row[i] || '').trim(); });
  return obj;
}

function validateRow(row, rowNum) {
  const errors = [];
  if (!row.title)          errors.push('title is required');
  if (!row.property_type)  errors.push('property_type is required (apartment|villa|house|plot|commercial|pg)');
  if (!row.listing_type)   errors.push('listing_type is required (sale|rent)');
  if (!row.price || isNaN(row.price)) errors.push('price must be a number');
  if (!row.city)           errors.push('city is required');
  if (!row.state)          errors.push('state is required');
  if (!row.address)        errors.push('address is required');
  if (row.property_type && !['apartment','villa','house','plot','commercial','pg'].includes(row.property_type)) {
    errors.push(`invalid property_type: ${row.property_type}`);
  }
  if (row.listing_type && !['sale','rent'].includes(row.listing_type)) {
    errors.push(`invalid listing_type: ${row.listing_type}`);
  }
  return errors;
}

async function processCsvImport(agentId, csvText) {
  const lines   = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) throw createError('CSV must have a header row and at least one data row', 400);

  const headers  = lines[0].split(',');
  const dataRows = lines.slice(1).filter(l => l.trim());

  // Create job record
  const jobRes = await query(
    `INSERT INTO import_jobs (agent_id, total_rows, status) VALUES ($1,$2,'processing') RETURNING id`,
    [agentId, dataRows.length]
  );
  const jobId = jobRes.rows[0].id;

  const errors        = [];
  const successIds    = [];
  let   successCount  = 0;

  const userRes = await query('SELECT agency_id FROM users WHERE id=$1', [agentId]);
  const agencyId = userRes.rows[0]?.agency_id || null;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-indexed, header is row 1
    const cols   = dataRows[i].split(',');
    const row    = parseCSVRow(headers, cols);
    const rowErrors = validateRow(row, rowNum);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, errors: rowErrors });
      continue;
    }

    try {
      const shortCode = nanoid(8);
      const amenities = row.amenities
        ? row.amenities.split('|').map(a => a.trim()).filter(Boolean)
        : [];

      const res = await query(
        `INSERT INTO listings (
           agent_id, agency_id, title, description, property_type, listing_type,
           price, price_negotiable, bedrooms, bathrooms, area_sqft,
           floor_number, total_floors, furnishing, facing,
           address, locality, city, state, pincode,
           amenities, status, short_code
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'draft',$22)
         RETURNING id`,
        [
          agentId, agencyId,
          row.title, row.description || null, row.property_type, row.listing_type,
          parseFloat(row.price), row.price_negotiable === 'true',
          row.bedrooms ? parseInt(row.bedrooms) : null,
          row.bathrooms ? parseInt(row.bathrooms) : null,
          row.area_sqft ? parseFloat(row.area_sqft) : null,
          row.floor_number != null && row.floor_number !== '' ? parseInt(row.floor_number) : null,
          row.total_floors ? parseInt(row.total_floors) : null,
          row.furnishing || null, row.facing || null,
          row.address, row.locality || null, row.city, row.state, row.pincode || null,
          amenities, shortCode,
        ]
      );
      successIds.push(res.rows[0].id);
      successCount++;
    } catch (err) {
      errors.push({ row: rowNum, errors: [`DB error: ${err.message}`] });
    }
  }

  // Update job
  await query(
    `UPDATE import_jobs SET
       status=$1, success_rows=$2, failed_rows=$3, errors=$4,
       created_listing_ids=$5, completed_at=NOW()
     WHERE id=$6`,
    [
      errors.length === 0 ? 'done' : successCount > 0 ? 'done' : 'failed',
      successCount,
      errors.length,
      JSON.stringify(errors),
      successIds,
      jobId,
    ]
  );

  return {
    job_id:        jobId,
    total:         dataRows.length,
    success:       successCount,
    failed:        errors.length,
    errors:        errors.slice(0, 20),
    listing_ids:   successIds,
    template_csv:  getCsvTemplate(),
  };
}

function getCsvTemplate() {
  const header = CSV_COLUMNS.join(',');
  const example = [
    '3BHK Apartment in Sector 17 Chandigarh',
    'apartment','sale','8500000',
    '3','2','1450','7','12','fully-furnished','South',
    '204 Silver Oak Apartments, Sector 17',
    'Sector 17','Chandigarh','Chandigarh','160017',
    'Lift|Parking|Gym|Security',
    'Stunning south-facing apartment with city views',
  ].join(',');
  return `${header}\n${example}`;
}

// ── BULK QR GENERATION ────────────────────────────────────────────────────────
async function bulkGenerateQR(agentId) {
  // Find all active listings that do NOT have an active QR code
  const res = await query(
    `SELECT l.id, l.short_code, l.title
     FROM listings l
     WHERE l.agent_id=$1 AND l.status='active'
       AND NOT EXISTS (
         SELECT 1 FROM qr_codes q WHERE q.listing_id=l.id AND q.is_active=true
       )`,
    [agentId]
  );

  if (res.rows.length === 0) {
    return { generated: 0, message: 'All active listings already have QR codes.' };
  }

  const qrService = require('./qrService');
  const results = [];

  for (const listing of res.rows) {
    try {
      const qr = await qrService.generateQRCode(agentId, {
        listing_id:    listing.id,
        style:         'standard',
        include_frame: false,
        frame_label:   'Scan to View Property',
      });
      results.push({ listing_id: listing.id, qr_id: qr.id, short_code: listing.short_code });
    } catch (err) {
      results.push({ listing_id: listing.id, error: err.message });
    }
  }

  return {
    generated: results.filter(r => !r.error).length,
    failed:    results.filter(r => r.error).length,
    results,
  };
}

// ── BULK CSV EXPORT ───────────────────────────────────────────────────────────
async function exportListingsCsv(agentId, filters = {}) {
  const conds = ['l.agent_id=$1'];
  const vals  = [agentId];
  let i = 2;
  if (filters.status)        { conds.push(`l.status=$${i++}`);        vals.push(filters.status); }
  if (filters.property_type) { conds.push(`l.property_type=$${i++}`); vals.push(filters.property_type); }
  if (filters.city)          { conds.push(`l.city=$${i++}`);          vals.push(filters.city); }

  const res = await query(
    `SELECT
       l.title, l.property_type, l.listing_type, l.price, l.price_negotiable,
       l.bedrooms, l.bathrooms, l.area_sqft, l.floor_number, l.total_floors,
       l.furnishing, l.facing, l.address, l.locality, l.city, l.state, l.pincode,
       array_to_string(l.amenities, '|') AS amenities,
       l.description, l.status, l.short_code,
       l.view_count, l.quality_score, l.conversion_score,
       l.created_at::date AS created_date,
       COUNT(DISTINCT qs.id) AS qr_scans,
       COUNT(DISTINCT ld.id) AS total_leads
     FROM listings l
     LEFT JOIN qr_scans qs ON qs.listing_id=l.id
     LEFT JOIN leads    ld ON ld.listing_id=l.id
     WHERE ${conds.join(' AND ')}
     GROUP BY l.id ORDER BY l.created_at DESC`,
    vals
  );

  const headers = [
    'title','property_type','listing_type','price','price_negotiable',
    'bedrooms','bathrooms','area_sqft','floor_number','total_floors',
    'furnishing','facing','address','locality','city','state','pincode',
    'amenities','description','status','short_code',
    'views','quality_score','conversion_score','created_date','qr_scans','leads',
  ];

  const rows = res.rows.map(r =>
    headers.map(h => {
      const v = r[h];
      if (v == null) return '';
      const str = String(v);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

module.exports = {
  saveTemplate, listTemplates, deleteTemplate, cloneFromTemplate,
  processCsvImport, getCsvTemplate,
  bulkGenerateQR,
  exportListingsCsv,
};
