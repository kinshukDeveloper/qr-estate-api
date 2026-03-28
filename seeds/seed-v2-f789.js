/**
 * QR Estate v2 — Features 7, 8 & 9 Seed
 * F7: Sample API keys + webhook endpoints
 * F8: Conversion scores pre-computed
 * F9: Listing templates from existing listings
 *
 * Run AFTER seed-v2-f456.js
 * node seeds/seed-v2-f789.js
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const KEY_PREFIX = 'qre_live_';
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function randomKey() { return KEY_PREFIX + crypto.randomBytes(24).toString('base64url'); }
function randomSecret() { return crypto.randomBytes(32).toString('hex'); }
function preview(k) { return k.slice(0, 12) + '...' + k.slice(-6); }

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 QR Estate v2 — F7/8/9 Seed\n');
    await client.query('BEGIN');

    // Clear previous
    await client.query('DELETE FROM api_keys');
    await client.query('DELETE FROM webhooks');
    await client.query('DELETE FROM webhook_deliveries');
    await client.query('DELETE FROM listing_templates');
    await client.query('DELETE FROM import_jobs');
    await client.query('UPDATE listings SET conversion_score=0, suggested_price=NULL');
    console.log('🗑  Cleared previous F789 data\n');

    // Get agents
    const agentsRes = await client.query(
      `SELECT id, email FROM users WHERE email IN (
        'rajesh@qrestate.dev','vikram@qrestate2.dev','deepa@qrestate2.dev'
      )`
    );
    const agents = {};
    agentsRes.rows.forEach(a => { agents[a.email] = a.id; });

    // ── FEATURE 7: API Keys + Webhooks ───────────────────────────────────────
    console.log('🔑 Feature 7 — Creating API keys + webhooks...');
    console.log('prefix length:', 'qre_live_'.length);
    const rajeshId = agents['rajesh@qrestate.dev'];
    const vikramId = agents['vikram@qrestate2.dev'];

    // Rajesh gets 2 API keys (simulating MagicBricks + 99acres integrations)
    const key1Raw = randomKey(); const key1Hash = sha256(key1Raw);
    const key2Raw = randomKey(); const key2Hash = sha256(key2Raw);

    await client.query(
      `INSERT INTO api_keys (agent_id, name, key_prefix, key_hash, key_preview, scopes, usage_count, last_used_at)
       VALUES ($1,'MagicBricks Integration','qre_live_',$2,$3,ARRAY['listings:read'],1247,NOW()-INTERVAL '2 hours')`,
      [rajeshId, key1Hash, preview(key1Raw)]
    );
    await client.query(
      `INSERT INTO api_keys (agent_id, name, key_prefix, key_hash, key_preview, scopes, usage_count, last_used_at)
       VALUES ($1,'99acres Feed','qre_live_',$2,$3,ARRAY['listings:read','leads:read'],389,NOW()-INTERVAL '1 day')`,
      [rajeshId, key2Hash, preview(key2Raw)]
    );
    console.log(`   ✓ 2 API keys for rajesh@qrestate.dev (MagicBricks + 99acres)`);

    // Vikram gets 1 key
    const key3Raw = randomKey();
    await client.query(
      `INSERT INTO api_keys (agent_id, name, key_prefix, key_hash, key_preview, scopes, usage_count)
       VALUES ($1,'Mumbai Portal API','qre_live_',$2,$3,ARRAY['listings:read','analytics:read'],55)`,
      [vikramId, sha256(key3Raw), preview(key3Raw)]
    );
    console.log(`   ✓ 1 API key for vikram@qrestate2.dev`);

    // Webhooks
    const wh1Secret = randomSecret();
    const wh2Secret = randomSecret();

    const wh1 = await client.query(
      `INSERT INTO webhooks (agent_id, name, url, secret, events, success_count, fail_count, last_triggered_at)
       VALUES ($1,'Lead Notifications','https://hooks.zapier.com/hooks/catch/12345/abcdef',$2,
               ARRAY['lead.created','lead.updated'],42,2,NOW()-INTERVAL '3 hours')
       RETURNING id`,
      [rajeshId, wh1Secret]
    );
    const wh2 = await client.query(
      `INSERT INTO webhooks (agent_id, name, url, secret, events, success_count, fail_count)
       VALUES ($1,'Listing Updates','https://crm.example.com/qrestate/webhook',$2,
               ARRAY['listing.created','listing.updated','listing.sold'],18,0)
       RETURNING id`,
      [rajeshId, wh2Secret]
    );

    // Add some delivery history
    for (let i = 0; i < 5; i++) {
      await client.query(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, response_status, success, delivered_at)
         VALUES ($1,'lead.created',$2,200,true,NOW()-INTERVAL '${i * 3} hours')`,
        [wh1.rows[0].id, JSON.stringify({ lead_id: 'seed-lead-' + i, source: 'qr_scan' })]
      );
    }
    await client.query(
      `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, response_status, success, delivered_at)
       VALUES ($1,'lead.created',$2,503,false,NOW()-INTERVAL '12 hours')`,
      [wh1.rows[0].id, JSON.stringify({ lead_id: 'seed-lead-fail', source: 'website' })]
    );
    console.log(`   ✓ 2 webhooks for rajesh@qrestate.dev (47 deliveries, 2 failures)\n`);

    // ── FEATURE 8: Compute conversion scores ─────────────────────────────────
    console.log('📈 Feature 8 — Computing conversion scores...');
    const listingsRes = await client.query(
      `SELECT l.id, l.images, l.description, l.area_sqft, l.furnishing,
              l.floor_number, l.amenities, l.tour_url, l.price, l.city, l.property_type, l.listing_type,
              COUNT(qs.id) FILTER (WHERE qs.event_type='scan') AS scan_count,
              COUNT(ld.id) AS lead_count,
              COUNT(qc.id) FILTER (WHERE qc.is_active=true) AS active_qr
       FROM listings l
       LEFT JOIN qr_scans qs ON qs.listing_id=l.id
       LEFT JOIN leads ld   ON ld.listing_id=l.id
       LEFT JOIN qr_codes qc ON qc.listing_id=l.id
       GROUP BY l.id`
    );

    for (const l of listingsRes.rows) {
      let score = 0;
      score += Math.min((l.images?.length || 0) * 5, 30);
      score += (l.description?.split(/\s+/).length || 0) > 100 ? 20 : (l.description?.split(/\s+/).length || 0) > 50 ? 10 : 0;
      score += parseInt(l.active_qr) > 0 ? 15 : 0;
      score += l.tour_url ? 10 : 0;
      score += (l.amenities?.length || 0) >= 5 ? 5 : (l.amenities?.length || 0);
      score += l.area_sqft ? 10 : 0;

      await client.query('UPDATE listings SET conversion_score=$1 WHERE id=$2', [score, l.id]);
    }
    console.log(`   ✓ ${listingsRes.rows.length} conversion scores computed\n`);

    // ── FEATURE 9: Listing Templates ─────────────────────────────────────────
    console.log('📋 Feature 9 — Creating listing templates...');

    // Save 3 templates from Rajesh's best listings
    const topListings = await client.query(
      `SELECT * FROM listings WHERE agent_id=$1 AND status='active' ORDER BY quality_score DESC LIMIT 3`,
      [rajeshId]
    );

    const templateNames = ['Standard 3BHK Chandigarh', '2BHK Rental Template', 'Commercial Shop Template'];
    const userRes = await client.query('SELECT agency_id FROM users WHERE id=$1', [rajeshId]);
    const agencyId = userRes.rows[0]?.agency_id || null;

    for (let i = 0; i < topListings.rows.length; i++) {
      const l = topListings.rows[i];
      const templateData = {};
      ['property_type', 'listing_type', 'bedrooms', 'bathrooms', 'area_sqft', 'floor_number', 'total_floors',
        'furnishing', 'facing', 'locality', 'city', 'state', 'pincode', 'amenities', 'description'].forEach(f => {
          if (l[f] != null) templateData[f] = l[f];
        });

      await client.query(
        `INSERT INTO listing_templates (agent_id, agency_id, name, template_data, is_shared, use_count)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rajeshId, agencyId, templateNames[i], JSON.stringify(templateData), i === 0, i * 3]
      );
      console.log(`   ✓ Template: ${templateNames[i]} (${l.property_type})`);
    }
    console.log();

    await client.query('COMMIT');

    // Summary
    const keyCount = await client.query('SELECT COUNT(*) FROM api_keys');
    const whCount = await client.query('SELECT COUNT(*) FROM webhooks');
    const tmplCount = await client.query('SELECT COUNT(*) FROM listing_templates');
    const scoreAvg = await client.query('SELECT ROUND(AVG(conversion_score)) AS avg FROM listings WHERE conversion_score > 0');

    console.log('═'.repeat(60));
    console.log('✅  F7/8/9 SEED COMPLETE\n');

    console.log('FEATURE 7 — Portal API');
    console.log('─'.repeat(40));
    console.log(`  ✓ ${keyCount.rows[0].count} API keys created`);
    console.log(`  ✓ ${whCount.rows[0].count} webhooks + delivery history`);
    console.log('  Login as rajesh@qrestate.dev → Dashboard → Portal API');
    console.log('  Try: GET /api/v1/portal/listings with API key in Authorization header\n');

    console.log('FEATURE 8 — AI Optimizer');
    console.log('─'.repeat(40));
    console.log(`  ✓ Avg conversion score: ${scoreAvg.rows[0].avg}/100`);
    console.log('  Login → Dashboard → Optimizer → select any listing → run tools\n');

    console.log('FEATURE 9 — Builder Suite');
    console.log('─'.repeat(40));
    console.log(`  ✓ ${tmplCount.rows[0].count} templates created`);
    console.log('  Login → Dashboard → Builder → Templates → Clone a template');
    console.log('  Download CSV template from Builder → Import tab');
    console.log('  Bulk Tools → Generate All Missing QR Codes');
    console.log('  Bulk Tools → Export CSV (includes scans + leads + scores)');
    console.log('═'.repeat(60));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message, err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
