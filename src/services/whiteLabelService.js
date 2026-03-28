'use strict';
/**
 * whiteLabelService.js — Feature 6: White-label Platform
 * Lets Agency-plan users brand the buyer-facing property pages
 * with their own logo, colors, domain, and footer.
 */

const { query, getClient } = require('../config/database');
const { createError }      = require('../middleware/errorHandler');
const { nanoid }           = require('nanoid');

const ALLOWED_FONTS   = ['Outfit','Poppins','Inter','Raleway','Lato','DM Sans'];
const COLOR_RE        = /^#[0-9A-Fa-f]{6}$/;
const DOMAIN_RE       = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
const PLAN_REQUIRES   = ['agency','white_label'];  // plans that can use white-label

// ── Guard: only agency/white_label plan owners ────────────────────────────────
async function assertPlan(agentId) {
  const res = await query(
    `SELECT u.plan, u.agency_id, u.agency_role, a.id AS aid
     FROM users u
     LEFT JOIN agencies a ON a.id = u.agency_id
     WHERE u.id = $1`,
    [agentId]
  );
  const user = res.rows[0];
  if (!user) throw createError('User not found', 404);
  if (!PLAN_REQUIRES.includes(user.plan)) {
    throw createError('White-label requires an Agency or White-Label plan.', 403);
  }
  if (user.agency_role !== 'owner') {
    throw createError('Only the agency owner can manage white-label settings.', 403);
  }
  return { agencyId: user.agency_id };
}

// ── Get config (or null if not set) ──────────────────────────────────────────
async function getConfig(agentId) {
  const { agencyId } = await assertPlan(agentId);
  const res = await query(
    'SELECT * FROM white_label_configs WHERE agency_id = $1',
    [agencyId]
  );
  if (!res.rows[0]) return { config: null, agency_id: agencyId };
  const cfg = res.rows[0];
  return { config: cfg, agency_id: agencyId };
}

// ── Get config by domain (used in middleware for incoming custom domains) ─────
async function getConfigByDomain(domain) {
  const res = await query(
    `SELECT wlc.*, a.name AS agency_name
     FROM white_label_configs wlc
     JOIN agencies a ON a.id = wlc.agency_id
     WHERE wlc.custom_domain = $1 AND wlc.domain_verified = true AND wlc.is_active = true`,
    [domain.toLowerCase().replace(/^www\./, '')]
  );
  return res.rows[0] || null;
}

// ── Create or update config ───────────────────────────────────────────────────
async function upsertConfig(agentId, data) {
  const { agencyId } = await assertPlan(agentId);

  const {
    brand_name, logo_url, favicon_url,
    primary_color, secondary_color, font_choice,
    support_email, support_phone, website, footer_text,
    hide_powered_by, custom_email_from,
  } = data;

  // Validate
  if (!brand_name?.trim()) throw createError('brand_name is required', 400);
  if (primary_color   && !COLOR_RE.test(primary_color))   throw createError('primary_color must be a valid hex color (#RRGGBB)', 400);
  if (secondary_color && !COLOR_RE.test(secondary_color)) throw createError('secondary_color must be a valid hex color (#RRGGBB)', 400);
  if (font_choice     && !ALLOWED_FONTS.includes(font_choice)) {
    throw createError(`font_choice must be one of: ${ALLOWED_FONTS.join(', ')}`, 400);
  }
  if (hide_powered_by && typeof hide_powered_by !== 'boolean') {
    throw createError('hide_powered_by must be true or false', 400);
  }

  const existing = await query('SELECT id FROM white_label_configs WHERE agency_id = $1', [agencyId]);

  if (existing.rows[0]) {
    // UPDATE
    const res = await query(
      `UPDATE white_label_configs SET
         brand_name        = COALESCE($1, brand_name),
         logo_url          = COALESCE($2, logo_url),
         favicon_url       = COALESCE($3, favicon_url),
         primary_color     = COALESCE($4, primary_color),
         secondary_color   = COALESCE($5, secondary_color),
         font_choice       = COALESCE($6, font_choice),
         support_email     = COALESCE($7, support_email),
         support_phone     = COALESCE($8, support_phone),
         website           = COALESCE($9, website),
         footer_text       = COALESCE($10, footer_text),
         hide_powered_by   = COALESCE($11, hide_powered_by),
         custom_email_from = COALESCE($12, custom_email_from),
         updated_at        = NOW()
       WHERE agency_id = $13
       RETURNING *`,
      [brand_name, logo_url, favicon_url,
       primary_color, secondary_color, font_choice,
       support_email, support_phone, website, footer_text,
       hide_powered_by, custom_email_from,
       agencyId]
    );
    return res.rows[0];
  } else {
    // INSERT
    const res = await query(
      `INSERT INTO white_label_configs
         (agency_id, brand_name, logo_url, favicon_url,
          primary_color, secondary_color, font_choice,
          support_email, support_phone, website, footer_text,
          hide_powered_by, custom_email_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [agencyId, brand_name.trim(), logo_url, favicon_url,
       primary_color || '#00D4C8', secondary_color || '#FFB830',
       font_choice   || 'Outfit',
       support_email, support_phone, website, footer_text,
       hide_powered_by || false, custom_email_from]
    );
    return res.rows[0];
  }
}

// ── Custom domain setup ───────────────────────────────────────────────────────
async function initDomainSetup(agentId, customDomain) {
  const { agencyId } = await assertPlan(agentId);
  const domain = customDomain.toLowerCase().trim().replace(/^www\./, '').replace(/\/.*$/, '');

  if (!DOMAIN_RE.test(domain)) throw createError('Invalid domain format. Use: subdomain.yourdomain.com', 400);

  // Check domain not claimed by another agency
  const clash = await query(
    'SELECT agency_id FROM white_label_configs WHERE custom_domain = $1 AND agency_id != $2',
    [domain, agencyId]
  );
  if (clash.rows[0]) throw createError('This domain is already used by another agency.', 409);

  // Generate a verification token
  const token = `qre-verify-${nanoid(32)}`;

  await query(
    `UPDATE white_label_configs
     SET custom_domain = $1, domain_verified = false, verify_token = $2, updated_at = NOW()
     WHERE agency_id = $3`,
    [domain, token, agencyId]
  );

  return {
    domain,
    verify_token:    token,
    dns_instruction: `Add a DNS TXT record to your domain:\n  Name: _qrestate-verify.${domain}\n  Value: ${token}\nVerification may take up to 48 hours to propagate.`,
    cname_instruction: `Then add a CNAME record:\n  Name: ${domain}\n  Value: cname.vercel-dns.com`,
  };
}

// ── Verify domain (checks DNS TXT record) ─────────────────────────────────────
async function verifyDomain(agentId) {
  const { agencyId } = await assertPlan(agentId);
  const cfgRes = await query(
    'SELECT custom_domain, verify_token FROM white_label_configs WHERE agency_id = $1',
    [agencyId]
  );
  const cfg = cfgRes.rows[0];
  if (!cfg?.custom_domain) throw createError('No custom domain set. Call initDomainSetup first.', 404);

  // In production: do a real DNS lookup
  // For now, we simulate success so devs can test the flow
  const dns = require('dns').promises;
  let verified = false;
  try {
    const records = await dns.resolveTxt(`_qrestate-verify.${cfg.custom_domain}`);
    verified = records.flat().includes(cfg.verify_token);
  } catch {
    // DNS lookup failed — domain not set up yet
    verified = false;
  }

  if (verified) {
    await query(
      'UPDATE white_label_configs SET domain_verified = true, updated_at = NOW() WHERE agency_id = $1',
      [agencyId]
    );
  }

  return {
    domain:   cfg.custom_domain,
    verified,
    message:  verified
      ? `✅ Domain ${cfg.custom_domain} verified! Property pages on this domain will now use your branding.`
      : `⏳ Verification pending. DNS TXT record not found yet for _qrestate-verify.${cfg.custom_domain}. This can take up to 48 hours.`,
  };
}

module.exports = {
  getConfig,
  getConfigByDomain,
  upsertConfig,
  initDomainSetup,
  verifyDomain,
};
