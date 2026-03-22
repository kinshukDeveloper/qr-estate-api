const puppeteer = require('puppeteer');
const { query } = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// ── GET LISTING WITH QR FOR BROCHURE ─────────────────────────────────────────
async function getListingForBrochure(listingId, agentId) {
  const result = await query(
    `SELECT
       l.*,
       u.name as agent_name, u.phone as agent_phone,
       u.rera_number as agent_rera, u.email as agent_email,
       q.qr_url, q.short_code as qr_short_code, q.target_url
     FROM listings l
     JOIN users u ON u.id = l.agent_id
     LEFT JOIN qr_codes q ON q.listing_id = l.id
     WHERE l.id = $1 AND l.agent_id = $2`,
    [listingId, agentId]
  );
  if (!result.rows[0]) throw createError('Listing not found', 404);
  return result.rows[0];
}

// ── FORMAT PRICE ──────────────────────────────────────────────────────────────
function formatPrice(price, type) {
  const suffix = type === 'rent' ? '/month' : '';
  if (price >= 10000000) return `₹${(price / 10000000).toFixed(2)} Crore${suffix}`;
  if (price >= 100000) return `₹${(price / 100000).toFixed(2)} Lakh${suffix}`;
  return `₹${Number(price).toLocaleString('en-IN')}${suffix}`;
}

// ── BUILD BROCHURE HTML ───────────────────────────────────────────────────────
function buildBrochureHTML(listing) {
  const primaryImage = listing.images?.find(i => i.is_primary) || listing.images?.[0];
  const galleryImages = (listing.images || []).slice(0, 4);
  const amenities = listing.amenities || [];
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  const specs = [
    listing.bedrooms != null && { icon: '🛏', label: 'Bedrooms', value: listing.bedrooms },
    listing.bathrooms != null && { icon: '🚿', label: 'Bathrooms', value: listing.bathrooms },
    listing.area_sqft && { icon: '📐', label: 'Area', value: `${listing.area_sqft} sq.ft` },
    listing.floor_number != null && { icon: '🏢', label: 'Floor', value: `${listing.floor_number} / ${listing.total_floors || '?'}` },
    listing.furnishing && { icon: '🛋', label: 'Furnishing', value: listing.furnishing.replace('-', ' ') },
    listing.facing && { icon: '🧭', label: 'Facing', value: listing.facing },
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', Arial, sans-serif;
      background: #fff;
      color: #1C1C1C;
      width: 794px;
    }

    /* ── HEADER ── */
    .header {
      background: #1C1C1C;
      padding: 24px 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon {
      width: 36px; height: 36px;
      border: 2px solid #00D4C8;
      display: flex; align-items: center; justify-content: center;
    }
    .brand-dot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; }
    .dot { width: 7px; height: 7px; }
    .dot.filled { background: #00D4C8; }
    .dot.empty { border: 1.5px solid #00D4C8; }
    .brand-name { color: white; font-weight: 800; font-size: 16px; letter-spacing: 0.5px; }
    .for-badge {
      background: #00D4C8;
      color: #1C1C1C;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 2px;
      text-transform: uppercase;
      padding: 6px 14px;
    }

    /* ── HERO IMAGE ── */
    .hero {
      width: 100%;
      height: 320px;
      object-fit: cover;
      display: block;
    }
    .hero-placeholder {
      width: 100%; height: 320px;
      background: #F0F0F0;
      display: flex; align-items: center; justify-content: center;
      font-size: 48px;
    }

    /* ── PRICE BAR ── */
    .price-bar {
      background: #1C1C1C;
      padding: 18px 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .price-main { color: #00D4C8; font-size: 28px; font-weight: 800; }
    .price-type { color: #999; font-size: 12px; margin-top: 2px; text-transform: uppercase; letter-spacing: 1px; }
    .status-badge {
      background: #00D4C8;
      color: #1C1C1C;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 2px;
      text-transform: uppercase;
      padding: 6px 14px;
    }

    /* ── MAIN CONTENT ── */
    .content { padding: 32px 36px; }

    .property-title {
      font-size: 22px;
      font-weight: 800;
      color: #1C1C1C;
      margin-bottom: 6px;
      line-height: 1.3;
    }
    .property-location {
      font-size: 13px;
      color: #666;
      margin-bottom: 28px;
    }
    .property-location span { color: #C0392B; margin-right: 4px; }

    /* ── SPECS GRID ── */
    .specs-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }
    .spec-box {
      border: 1px solid #E8E8E8;
      padding: 14px 16px;
      text-align: center;
    }
    .spec-icon { font-size: 20px; margin-bottom: 6px; }
    .spec-value { font-size: 15px; font-weight: 700; color: #1C1C1C; }
    .spec-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }

    /* ── DESCRIPTION ── */
    .section-title {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #E8E8E8;
    }
    .description {
      font-size: 13px;
      line-height: 1.7;
      color: #444;
      margin-bottom: 28px;
    }

    /* ── AMENITIES ── */
    .amenities-section { margin-bottom: 28px; }
    .amenities-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .amenity-tag {
      background: #F0FAF0;
      border: 1px solid #C8E6C9;
      color: #2D7A3A;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 12px;
    }

    /* ── GALLERY ── */
    .gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 28px; }
    .gallery img { width: 100%; height: 90px; object-fit: cover; }

    /* ── BOTTOM ROW ── */
    .bottom-row {
      display: flex;
      gap: 20px;
      align-items: stretch;
      border-top: 2px solid #1C1C1C;
      padding-top: 24px;
    }

    /* Agent card */
    .agent-card { flex: 1; }
    .agent-label { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #999; margin-bottom: 12px; }
    .agent-info { display: flex; align-items: center; gap: 14px; }
    .agent-avatar {
      width: 52px; height: 52px;
      background: #1C1C1C;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 18px; font-weight: 800;
      flex-shrink: 0;
    }
    .agent-name { font-size: 16px; font-weight: 700; color: #1C1C1C; }
    .agent-phone { font-size: 13px; color: #666; margin-top: 3px; }
    .agent-rera { font-size: 10px; color: #00897B; font-weight: 700; letter-spacing: 1px; margin-top: 4px; text-transform: uppercase; }

    /* QR section */
    .qr-section { text-align: center; flex-shrink: 0; }
    .qr-label { font-size: 10px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase; color: #999; margin-bottom: 10px; }
    .qr-image { width: 100px; height: 100px; border: 2px solid #1C1C1C; }
    .qr-placeholder {
      width: 100px; height: 100px;
      border: 2px solid #1C1C1C;
      display: flex; align-items: center; justify-content: center;
      font-size: 28px;
    }
    .qr-url { font-size: 9px; color: #999; margin-top: 6px; max-width: 110px; word-break: break-all; }

    /* ── FOOTER ── */
    .footer {
      background: #F5F5F5;
      padding: 12px 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 24px;
    }
    .footer-left { font-size: 10px; color: #999; }
    .footer-right { font-size: 10px; color: #999; }
    .footer-brand { font-weight: 700; color: #1C1C1C; }
  </style>
</head>
<body>
  <!-- HEADER -->
  <div class="header">
    <div class="brand">
      <div class="brand-icon">
        <div class="brand-dot-grid">
          <div class="dot filled"></div>
          <div class="dot empty"></div>
          <div class="dot empty"></div>
          <div class="dot filled"></div>
        </div>
      </div>
      <span class="brand-name">QR Estate</span>
    </div>
    <div class="for-badge">For ${listing.listing_type === 'sale' ? 'Sale' : 'Rent'}</div>
  </div>

  <!-- HERO IMAGE -->
  ${primaryImage?.url
    ? `<img class="hero" src="${primaryImage.url}" alt="${listing.title}" />`
    : `<div class="hero-placeholder">🏠</div>`
  }

  <!-- PRICE BAR -->
  <div class="price-bar">
    <div>
      <div class="price-main">${formatPrice(listing.price, listing.listing_type)}</div>
      <div class="price-type">${listing.property_type.charAt(0).toUpperCase() + listing.property_type.slice(1)} · For ${listing.listing_type}</div>
    </div>
    <div class="status-badge">${listing.status === 'active' ? 'Available' : listing.status}</div>
  </div>

  <!-- MAIN CONTENT -->
  <div class="content">
    <h1 class="property-title">${listing.title}</h1>
    <div class="property-location">
      <span>📍</span>
      ${listing.locality ? `${listing.locality}, ` : ''}${listing.address}, ${listing.city}, ${listing.state}${listing.pincode ? ` — ${listing.pincode}` : ''}
    </div>

    <!-- SPECS -->
    ${specs.length > 0 ? `
    <div class="specs-grid">
      ${specs.map(s => `
        <div class="spec-box">
          <div class="spec-icon">${s.icon}</div>
          <div class="spec-value">${s.value}</div>
          <div class="spec-label">${s.label}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <!-- DESCRIPTION -->
    ${listing.description ? `
    <div style="margin-bottom: 28px;">
      <div class="section-title">About this Property</div>
      <div class="description">${listing.description}</div>
    </div>` : ''}

    <!-- AMENITIES -->
    ${amenities.length > 0 ? `
    <div class="amenities-section">
      <div class="section-title">Amenities & Features</div>
      <div class="amenities-grid">
        ${amenities.map(a => `<span class="amenity-tag">✓ ${a}</span>`).join('')}
      </div>
    </div>` : ''}

    <!-- GALLERY -->
    ${galleryImages.length > 1 ? `
    <div style="margin-bottom: 28px;">
      <div class="section-title">Photo Gallery</div>
      <div class="gallery">
        ${galleryImages.map(img => `<img src="${img.url}" alt="" />`).join('')}
      </div>
    </div>` : ''}

    <!-- BOTTOM ROW -->
    <div class="bottom-row">
      <div class="agent-card">
        <div class="agent-label">Listed By</div>
        <div class="agent-info">
          <div class="agent-avatar">${listing.agent_name?.split(' ').map(n => n[0]).join('').slice(0, 2)}</div>
          <div>
            <div class="agent-name">${listing.agent_name}</div>
            <div class="agent-phone">📱 +91 ${listing.agent_phone || 'N/A'}</div>
            ${listing.agent_rera ? `<div class="agent-rera">RERA: ${listing.agent_rera}</div>` : ''}
            ${listing.agent_email ? `<div style="font-size:11px;color:#666;margin-top:3px;">✉ ${listing.agent_email}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="qr-section">
        <div class="qr-label">Scan to View</div>
        ${listing.qr_url
          ? `<img class="qr-image" src="${listing.qr_url}" alt="QR Code" />`
          : `<div class="qr-placeholder">🔲</div>`
        }
        <div class="qr-url">${listing.target_url || `${appUrl}/p/${listing.short_code || ''}`}</div>
      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-left">
      Generated by <span class="footer-brand">QR Estate</span> · India's QR-Native Listing Platform
    </div>
    <div class="footer-right">
      ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
    </div>
  </div>
</body>
</html>`;
}

// ── GENERATE BROCHURE PDF ─────────────────────────────────────────────────────
async function generateBrochurePDF(listingId, agentId) {
  const listing = await getListingForBrochure(listingId, agentId);
  const html = buildBrochureHTML(listing);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return {
      buffer: pdfBuffer,
      filename: `qr-estate-${listing.title.substring(0, 30).replace(/\s+/g, '-').toLowerCase()}.pdf`,
      listing_title: listing.title,
    };
  } finally {
    if (browser) await browser.close();
  }
}

// ── GENERATE BROCHURE HTML PREVIEW ───────────────────────────────────────────
async function generateBrochurePreview(listingId, agentId) {
  const listing = await getListingForBrochure(listingId, agentId);
  return buildBrochureHTML(listing);
}

module.exports = { generateBrochurePDF, generateBrochurePreview };
