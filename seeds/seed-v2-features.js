/**
 * QR Estate v2 — Features 1, 2 & 3 Seed
 * ─────────────────────────────────────────────────────────────────────────────
 * Feature 1: Multi-Agent Agency Workspace
 *   → 3 agencies (Chandigarh, Mumbai, Bengaluru)
 *   → Owners, admins, agents per agency
 *   → Pending invites with real tokens
 *
 * Feature 2: Conversion Intelligence AI
 *   → quality_score + quality_breakdown on every listing
 *   → ai_cache pre-populated (tips + description variants)
 *     so AI panels load instantly without hitting OpenAI
 *
 * Feature 3: Regional Languages
 *   → Listings already have rich 150-200 word descriptions
 *     so the AI description writer and translation showcase well
 *   → No DB changes — purely frontend
 *
 * Prerequisites:
 *   1. Run schema.sql
 *   2. Run v2_f1_agency_workspace.sql
 *   3. Run v2_f2_ai_quality.sql
 *   4. Run seed.js first (creates @qrestate.dev agents + listings)
 *   5. Run seed-v2.js (creates @qrestate2.dev agents)
 *   6. Run THIS file: node seeds/seed-v2-features.js
 *
 * Run: node backend/seeds/seed-v2-features.js
 */

// require('dotenv').config({ path: __dirname + '/backend/.env.production' });
require('dotenv').config({ path: __dirname + '/backend/.env' });
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const { nanoid } = require('nanoid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Helpers ───────────────────────────────────────────────────────────────────
const ri  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const rp  = ()         => `9${ri(100000000, 999999999)}`;
const uid = ()         => nanoid(32);

function daysAgo(n, hour = null) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour ?? ri(8, 22), ri(0, 59));
  return d.toISOString();
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

// ── New users for v2 agencies ─────────────────────────────────────────────────
// These join existing seed agents inside their agencies
const NEW_MEMBERS = [
  // Chandigarh agency members
  {
    name:        'Simran Kaur',
    email:       'simran@qrestate.dev',
    password:    'Test@1234',
    phone:       '9876001001',
    rera_number: 'RERA-PB-01-2024-007001',
    role:        'agent',
  },
  {
    name:        'Harinder Singh',
    email:       'harinder@qrestate.dev',
    password:    'Test@1234',
    phone:       '9876001002',
    rera_number: null,
    role:        'agent',
  },
  // Mumbai agency members
  {
    name:        'Sheetal Desai',
    email:       'sheetal@qrestate2.dev',
    password:    'Test@1234',
    phone:       '9820001003',
    rera_number: 'RERA-MH-12-2024-009001',
    role:        'agent',
  },
  // Bengaluru agency — viewer role
  {
    name:        'Kavya Rajan',
    email:       'kavya@qrestate2.dev',
    password:    'Test@1234',
    phone:       '9900001004',
    rera_number: null,
    role:        'agent',
  },
];

// ── AI Cache data — rule-based tips + 3 description variants ─────────────────
// Pre-populated so AI panels work immediately without an OpenAI key
const AI_TIPS_SETS = {
  // Tips for listings with good quality scores (60+)
  good: [
    { icon: '📸', tip: 'Add 2-3 more photos showing the kitchen and master bedroom — these are the top 2 rooms buyers ask about before scheduling a visit.' },
    { icon: '📍', tip: 'Your listing is in a high-demand area. Add the exact GPS coordinates so buyers can check commute times to their office on Google Maps.' },
    { icon: '💬', tip: 'Mention nearby landmarks (school, hospital, metro station) in the description — buyers search for these terms directly.' },
  ],
  // Tips for listings needing improvement (below 60)
  fair: [
    { icon: '📸', tip: 'No photos detected. Listings without photos receive 90% fewer enquiries. Upload at least 6 clear daylight photos to unlock full buyer reach.' },
    { icon: '✍️', tip: 'Your description is under 100 words. Add details about floor number, natural light, nearby schools and hospitals, and what makes this property special.' },
    { icon: '🛋️', tip: 'Furnishing status is not set. Buyers filter listings by furnishing — setting it ensures your property appears in the right search results.' },
  ],
  // Tips for plots/commercial
  commercial: [
    { icon: '📐', tip: 'Add the exact carpet area and plot dimensions — commercial buyers compare price per sq.ft across multiple options simultaneously.' },
    { icon: '🏢', tip: 'Mention the FSI/FAR allowed, proximity to IT parks or business districts, and any existing tenants — these are the key commercial buyer questions.' },
    { icon: '🔑', tip: 'Possession status (ready/under construction) is critical for commercial buyers. Add it to the description and the title for maximum visibility.' },
  ],
};

// Description variants template builder
function buildDescriptionVariants(listing) {
  const beds   = listing.bedrooms  ? `${listing.bedrooms}BHK `  : '';
  const area   = listing.area_sqft ? `${listing.area_sqft} sq.ft ` : '';
  const loc    = [listing.locality, listing.city].filter(Boolean).join(', ');
  const priceL = listing.price >= 10000000
    ? `₹${(listing.price / 10000000).toFixed(2)} Crore`
    : listing.price >= 100000
    ? `₹${(listing.price / 100000).toFixed(1)} Lakh`
    : `₹${listing.price.toLocaleString('en-IN')}`;
  const neg  = listing.price_negotiable ? ' (negotiable)' : '';
  const fur  = listing.furnishing === 'fully-furnished' ? 'Fully furnished. '
             : listing.furnishing === 'semi-furnished'  ? 'Semi-furnished. '
             : listing.furnishing === 'unfurnished'     ? 'Unfurnished. ' : '';
  const amen = listing.amenities?.length ? listing.amenities.slice(0, 4).join(', ') : '';
  const face = listing.facing ? `${listing.facing}-facing. ` : '';
  const flr  = listing.floor_number != null ? `Floor ${listing.floor_number} of ${listing.total_floors ?? '?'}. ` : '';
  const purp = listing.listing_type === 'rent' ? 'For Rent' : 'For Sale';

  return [
    {
      label: 'Short',
      words: 48,
      text: `${beds}${listing.property_type} ${purp.toLowerCase()} in ${loc}. ${area}${fur}${face}Priced at ${priceL}${neg}. Contact agent for site visit.`,
    },
    {
      label: 'Medium',
      words: 95,
      text: `Well-presented ${beds}${listing.property_type} available for ${purp.toLowerCase()} in ${loc}. ${area ? `Spanning ${area}, ` : ''}this property offers ${listing.bathrooms ? listing.bathrooms + ' bathrooms, ' : ''}${fur.toLowerCase()}and ${flr.toLowerCase()}${amen ? 'Key amenities: ' + amen + '. ' : ''}Excellent connectivity to markets, schools, and transport. Priced at ${priceL}${neg}. RERA-compliant listing.`,
    },
    {
      label: 'Detailed',
      words: 165,
      text: `Presenting a ${listing.price_negotiable ? 'competitively priced, negotiable ' : ''}${beds}${listing.property_type} ${purp.toLowerCase()} in the sought-after locality of ${loc}. ${area ? `This ${area}unit ` : 'This property '}is a testament to thoughtful living — ${fur.toLowerCase()}${face}${flr}${amen ? 'Residents benefit from ' + amen + '. ' : ''}Located in ${listing.city}, you are minutes from reputed educational institutions, healthcare facilities, and major business districts. ${listing.state === 'Punjab' || listing.state === 'Haryana' || listing.state === 'Chandigarh' ? 'Chandigarh Tricity\'s expanding infrastructure makes this a strong investment. ' : listing.city === 'Mumbai' ? 'Mumbai\'s premium real estate market ensures excellent long-term appreciation. ' : listing.city === 'Bengaluru' ? 'Bengaluru\'s thriving tech economy drives consistent rental demand. ' : ''}Priced at ${priceL}${neg} — a competitive offer in today's market. RERA-compliant. Schedule a site visit today.`,
    },
  ];
}

// ── Quality score computation (mirrors backend aiService.js) ─────────────────
function computeScore(listing, hasActiveQR) {
  const breakdown = {
    photos:      listing.images?.length > 0 ? 20 : 0,
    description: listing.description && listing.description.split(/\s+/).length > 100 ? 20 : 0,
    floor:       listing.floor_number != null ? 10 : 0,
    furnishing:  listing.furnishing ? 10 : 0,
    amenities:   (listing.amenities?.length ?? 0) >= 3 ? 15 : 0,
    area:        listing.area_sqft ? 10 : 0,
    active_qr:   hasActiveQR ? 15 : 0,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown };
}

// ── MAIN SEED ─────────────────────────────────────────────────────────────────
async function seedV2Features() {
  const client = await pool.connect();

  try {
    console.log('🌱 QR Estate v2 — Features 1, 2 & 3 Seed\n');
    await client.query('BEGIN');

    // ── 0. Clear previous v2 seed data ───────────────────────────────────────
    console.log('🗑  Clearing previous v2 feature seed data...');
    await client.query(`DELETE FROM agency_invites WHERE token LIKE 'SEED_%'`);
    await client.query(`DELETE FROM agencies WHERE name LIKE '%Seed Agency%' OR name IN (
      'Tricity Homes Realty', 'Mumbai Prime Properties', 'Bengaluru Smart Homes'
    )`);
    await client.query(`DELETE FROM users WHERE email IN (${NEW_MEMBERS.map((_, i) => `$${i + 1}`).join(',')})`,
      NEW_MEMBERS.map(m => m.email));
    await client.query('DELETE FROM ai_cache');
    console.log('   ✓ Done\n');

    // ── 1. Create new team members ────────────────────────────────────────────
    console.log('👤 Creating new team members...');
    const memberIds = {};

    for (const m of NEW_MEMBERS) {
      const hash = await bcrypt.hash(m.password, 10);
      const res  = await client.query(
        `INSERT INTO users (name, email, password_hash, phone, rera_number, role, is_active, is_verified, plan)
         VALUES ($1,$2,$3,$4,$5,'agent',true,true,'free') RETURNING id`,
        [m.name, m.email, hash, m.phone, m.rera_number]
      );
      memberIds[m.email] = res.rows[0].id;
      console.log(`   ✓ ${m.name} (${m.email})`);
    }
    console.log();

    // ── 2. Fetch existing agents ──────────────────────────────────────────────
    const agentsRes = await client.query(
      `SELECT id, name, email, phone FROM users WHERE email IN (
        'rajesh@qrestate.dev', 'priya@qrestate.dev',
        'vikram@qrestate2.dev', 'deepa@qrestate2.dev', 'arjun@qrestate2.dev'
      )`
    );
    const agentMap  = {};
    agentsRes.rows.forEach(a => { agentMap[a.email] = a; });

    // ── 3. Create agencies ────────────────────────────────────────────────────
    console.log('🏢 Creating agencies...\n');

    // ── Agency A: Tricity Homes Realty (Chandigarh) ───────────────────────────
    console.log('  [A] Tricity Homes Realty — Chandigarh');
    const ownerA = agentMap['rajesh@qrestate.dev'];

    const agencyARes = await client.query(
      `INSERT INTO agencies (name, owner_id, plan, max_agents, website)
       VALUES ('Tricity Homes Realty', $1, 'pro', 5, 'https://tricityhomes.in')
       RETURNING id`,
      [ownerA.id]
    );
    const agencyA = agencyARes.rows[0].id;

    // Update owner
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='owner', role='agency_admin', plan='pro' WHERE id=$2`,
      [agencyA, ownerA.id]
    );

    // Insert owner into agency_members
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
       VALUES ($1,$2,'owner',$2)`,
      [agencyA, ownerA.id]
    );

    // Add priya@qrestate.dev as agency_admin
    const priya = agentMap['priya@qrestate.dev'];
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='agency_admin', role='agency_admin' WHERE id=$2`,
      [agencyA, priya.id]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by, joined_at)
       VALUES ($1,$2,'agency_admin',$3, $4)`,
      [agencyA, priya.id, ownerA.id, daysAgo(20)]
    );
    console.log(`     ✓ ${ownerA.name} (owner)`);
    console.log(`     ✓ ${priya.name} (agency_admin)`);

    // Add simran as agent
    const simranId = memberIds['simran@qrestate.dev'];
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='agent' WHERE id=$2`,
      [agencyA, simranId]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by, joined_at)
       VALUES ($1,$2,'agent',$3,$4)`,
      [agencyA, simranId, ownerA.id, daysAgo(12)]
    );
    console.log(`     ✓ Simran Kaur (agent)`);

    // Add harinder as viewer
    const harinderId = memberIds['harinder@qrestate.dev'];
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='viewer' WHERE id=$2`,
      [agencyA, harinderId]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by, joined_at)
       VALUES ($1,$2,'viewer',$3,$4)`,
      [agencyA, harinderId, priya.id, daysAgo(5)]
    );
    console.log(`     ✓ Harinder Singh (viewer)`);

    // Pending invite (expires 48h from now)
    const inviteTokenA1 = `SEED_${uid()}`;
    await client.query(
      `INSERT INTO agency_invites (agency_id, email, role, token, invited_by, expires_at)
       VALUES ($1, 'newagent@example.com', 'agent', $2, $3, $4)`,
      [agencyA, inviteTokenA1, ownerA.id, hoursFromNow(48)]
    );
    console.log(`     📧 Pending invite → newagent@example.com (token: ${inviteTokenA1.slice(0, 16)}...)`);

    // Expired invite (already expired)
    const inviteTokenA2 = `SEED_${uid()}`;
    await client.query(
      `INSERT INTO agency_invites (agency_id, email, role, token, invited_by, expires_at)
       VALUES ($1, 'expired@example.com', 'agent', $2, $3, $4)`,
      [agencyA, inviteTokenA2, priya.id, daysAgo(1)] // 1 day ago = expired
    );
    console.log(`     ⏰ Expired invite → expired@example.com`);

    // Link Agency A listings
    await client.query(
      `UPDATE listings SET agency_id=$1 WHERE agent_id IN ($2,$3)`,
      [agencyA, ownerA.id, priya.id]
    );
    await client.query(
      `UPDATE listings SET agency_id=$1 WHERE agent_id=$2`,
      [agencyA, simranId]
    );
    console.log(`     ✓ Listings linked to agency`);

    // ── Agency B: Mumbai Prime Properties ────────────────────────────────────
    console.log('\n  [B] Mumbai Prime Properties — Mumbai');
    const ownerB = agentMap['vikram@qrestate2.dev'];

    const agencyBRes = await client.query(
      `INSERT INTO agencies (name, owner_id, plan, max_agents)
       VALUES ('Mumbai Prime Properties', $1, 'pro', 5) RETURNING id`,
      [ownerB.id]
    );
    const agencyB = agencyBRes.rows[0].id;

    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='owner', role='agency_admin', plan='pro' WHERE id=$2`,
      [agencyB, ownerB.id]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
       VALUES ($1,$2,'owner',$2)`,
      [agencyB, ownerB.id]
    );
    console.log(`     ✓ ${ownerB.name} (owner)`);

    // sheetal as agent
    const sheetalId = memberIds['sheetal@qrestate2.dev'];
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='agent' WHERE id=$2`,
      [agencyB, sheetalId]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by, joined_at)
       VALUES ($1,$2,'agent',$3,$4)`,
      [agencyB, sheetalId, ownerB.id, daysAgo(8)]
    );
    console.log(`     ✓ Sheetal Desai (agent)`);

    // Pending invite
    const inviteTokenB = `SEED_${uid()}`;
    await client.query(
      `INSERT INTO agency_invites (agency_id, email, role, token, invited_by, expires_at)
       VALUES ($1, 'premiumagent@example.com', 'agency_admin', $2, $3, $4)`,
      [agencyB, inviteTokenB, ownerB.id, hoursFromNow(36)]
    );
    console.log(`     📧 Pending invite → premiumagent@example.com`);

    await client.query(
      `UPDATE listings SET agency_id=$1 WHERE agent_id IN ($2,$3)`,
      [agencyB, ownerB.id, sheetalId]
    );
    console.log(`     ✓ Listings linked to agency`);

    // ── Agency C: Bengaluru Smart Homes ──────────────────────────────────────
    console.log('\n  [C] Bengaluru Smart Homes — Bengaluru');
    const ownerC = agentMap['deepa@qrestate2.dev'];

    const agencyCRes = await client.query(
      `INSERT INTO agencies (name, owner_id, plan, max_agents)
       VALUES ('Bengaluru Smart Homes', $1, 'agency', 25) RETURNING id`,
      [ownerC.id]
    );
    const agencyC = agencyCRes.rows[0].id;

    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='owner', role='agency_admin', plan='agency' WHERE id=$2`,
      [agencyC, ownerC.id]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
       VALUES ($1,$2,'owner',$2)`,
      [agencyC, ownerC.id]
    );
    console.log(`     ✓ ${ownerC.name} (owner)`);

    // arjun as agency_admin
    const arjun = agentMap['arjun@qrestate2.dev'];
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='agency_admin', role='agency_admin' WHERE id=$2`,
      [agencyC, arjun.id]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by, joined_at)
       VALUES ($1,$2,'agency_admin',$3,$4)`,
      [agencyC, arjun.id, ownerC.id, daysAgo(30)]
    );
    console.log(`     ✓ ${arjun.name} (agency_admin)`);

    // kavya as agent
    const kavyaId = memberIds['kavya@qrestate2.dev'];
    await client.query(
      `UPDATE users SET agency_id=$1, agency_role='agent' WHERE id=$2`,
      [agencyC, kavyaId]
    );
    await client.query(
      `INSERT INTO agency_members (agency_id, user_id, role, invited_by, joined_at)
       VALUES ($1,$2,'agent',$3,$4)`,
      [agencyC, kavyaId, arjun.id, daysAgo(15)]
    );
    console.log(`     ✓ Kavya Rajan (agent)`);

    await client.query(
      `UPDATE listings SET agency_id=$1 WHERE agent_id IN ($2,$3,$4)`,
      [agencyC, ownerC.id, arjun.id, kavyaId]
    );
    console.log(`     ✓ Listings linked to agency`);

    console.log();

    // ── 4. Quality scores + AI cache ─────────────────────────────────────────
    console.log('🤖 Computing quality scores + seeding AI cache...\n');

    // Get all listings with QR info
    const listingsRes = await client.query(
      `SELECT l.*,
              COUNT(q.id) FILTER (WHERE q.is_active = true) AS active_qr_count
       FROM listings l
       LEFT JOIN qr_codes q ON q.listing_id = l.id
       GROUP BY l.id
       ORDER BY l.created_at ASC`
    );

    let scored = 0;
    let cached = 0;

    for (const listing of listingsRes.rows) {
      const hasQR      = parseInt(listing.active_qr_count) > 0;
      const { score, breakdown } = computeScore(listing, hasQR);

      // ── Update quality score ────────────────────────────────────────────────
      await client.query(
        `UPDATE listings SET quality_score=$1, quality_breakdown=$2 WHERE id=$3`,
        [score, JSON.stringify(breakdown), listing.id]
      );
      scored++;

      // ── Seed ai_cache: tips ─────────────────────────────────────────────────
      const tipsKey = score >= 60
        ? (listing.property_type === 'commercial' || listing.property_type === 'plot' ? 'commercial' : 'good')
        : 'fair';
      const tips = AI_TIPS_SETS[tipsKey];

      await client.query(
        `INSERT INTO ai_cache (listing_id, cache_type, payload, expires_at)
         VALUES ($1, 'tips', $2, NOW() + INTERVAL '24 hours')
         ON CONFLICT (listing_id, cache_type)
         DO UPDATE SET payload=$2, expires_at=NOW() + INTERVAL '24 hours', created_at=NOW()`,
        [listing.id, JSON.stringify({ tips })]
      );
      cached++;

      // ── Seed ai_cache: description variants ────────────────────────────────
      const variants = buildDescriptionVariants(listing);
      await client.query(
        `INSERT INTO ai_cache (listing_id, cache_type, payload, expires_at)
         VALUES ($1, 'description', $2, NOW() + INTERVAL '12 hours')
         ON CONFLICT (listing_id, cache_type)
         DO UPDATE SET payload=$2, expires_at=NOW() + INTERVAL '12 hours', created_at=NOW()`,
        [listing.id, JSON.stringify({ variants })]
      );
      cached++;

      const scoreLabel = score >= 80 ? '🟢' : score >= 60 ? '🔵' : score >= 40 ? '🟡' : '🔴';
      console.log(
        `  ${scoreLabel} [${String(score).padStart(3)}] ${listing.title.substring(0, 52).padEnd(52)} ` +
        `| photos:${breakdown.photos} desc:${breakdown.description} qr:${breakdown.active_qr}`
      );
    }

    console.log(`\n  ✓ ${scored} listings scored`);
    console.log(`  ✓ ${cached} AI cache entries created (tips + description variants)`);
    console.log();

    await client.query('COMMIT');

    // ── 5. Summary ────────────────────────────────────────────────────────────
    const memberCount = await client.query(`SELECT COUNT(*) FROM agency_members`);
    const inviteCount = await client.query(`SELECT COUNT(*) FROM agency_invites`);
    const cacheCount  = await client.query(`SELECT COUNT(*) FROM ai_cache`);

    console.log('═'.repeat(65));
    console.log('✅  V2 FEATURES SEED COMPLETE\n');

    console.log('FEATURE 1 — AGENCY WORKSPACE');
    console.log('─'.repeat(40));
    console.log('  3 agencies created:\n');

    console.log('  🏢 Tricity Homes Realty (Chandigarh) · Pro plan · 4/5 seats');
    console.log('     👑 rajesh@qrestate.dev      Test@1234  owner');
    console.log('     🛡  priya@qrestate.dev       Test@1234  agency_admin');
    console.log('     👤 simran@qrestate.dev      Test@1234  agent');
    console.log('     👁  harinder@qrestate.dev   Test@1234  viewer');
    console.log('     📧 Pending invite: newagent@example.com');

    console.log('\n  🏢 Mumbai Prime Properties · Pro plan · 2/5 seats');
    console.log('     👑 vikram@qrestate2.dev     Test@1234  owner');
    console.log('     👤 sheetal@qrestate2.dev    Test@1234  agent');
    console.log('     📧 Pending invite: premiumagent@example.com');

    console.log('\n  🏢 Bengaluru Smart Homes · Agency plan · 3/25 seats');
    console.log('     👑 deepa@qrestate2.dev      Test@1234  owner');
    console.log('     🛡  arjun@qrestate2.dev      Test@1234  agency_admin');
    console.log('     👤 kavya@qrestate2.dev      Test@1234  agent');

    console.log(`\n  Total members: ${memberCount.rows[0].count}`);
    console.log(`  Total invites: ${inviteCount.rows[0].count} (2 pending, 1 expired)`);

    console.log('\nFEATURE 2 — AI CONVERSION INTELLIGENCE');
    console.log('─'.repeat(40));
    console.log(`  ✓ ${scored} listings scored (quality_score + quality_breakdown updated)`);
    console.log(`  ✓ ${cacheCount.rows[0].count} AI cache rows (tips + description variants)`);
    console.log('  ℹ  AI panels work immediately — no OpenAI key needed');
    console.log('  ℹ  Cache expires naturally (tips: 24h, descriptions: 12h)');

    console.log('\nFEATURE 3 — REGIONAL LANGUAGES');
    console.log('─'.repeat(40));
    console.log('  ✓ Frontend-only feature — no DB changes');
    console.log('  ✓ All listing descriptions are 100+ words → trigger full description score');
    console.log('  ✓ Open any /p/:shortCode page and tap the 🌐 globe icon top-left');
    console.log('  ✓ Languages: English · हिन्दी · ਪੰਜਾਬੀ · मराठी · தமிழ்');

    console.log('\nQUICK TEST FLOWS');
    console.log('─'.repeat(40));
    console.log('  Feature 1:');
    console.log('    Log in as rajesh@qrestate.dev → Dashboard → Team');
    console.log('    You should see 4 members, 1 pending invite, 0/5 seats available');
    console.log();
    console.log('  Feature 2:');
    console.log('    Log in → Listings → click any listing → Edit');
    console.log('    Right sidebar shows Score / Tips / Photos tabs with data loaded');
    console.log('    Listings page shows quality score badge on each card');
    console.log();
    console.log('  Feature 3:');
    console.log('    Open any /p/:shortCode in browser (find short_code in DB)');
    console.log('    Tap 🌐 globe top-left → switch to हिन्दी or ਪੰਜਾਬੀ');
    console.log('    All UI text, CTA buttons, and price units switch instantly');

    console.log('\n' + '═'.repeat(65));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedV2Features();
