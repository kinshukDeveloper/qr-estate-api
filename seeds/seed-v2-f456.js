/**
 * QR Estate v2 — Features 4, 5 & 6 Seed
 * ─────────────────────────────────────────────────────────────
 * F4: Callback requests (connected, missed, pending)
 * F5: Virtual tour URLs on select listings
 * F6: White-label brand configs for 2 agencies
 *
 * Run AFTER seed-v2-features.js
 * node seeds/seed-v2-f456.js
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rPhone() { return `9${ri(100000000, 999999999)}`; }
function hoursAgo(h) { return new Date(Date.now() - h * 3600 * 1000).toISOString(); }
function minutesAgo(m) { return new Date(Date.now() - m * 60 * 1000).toISOString(); }

const TOUR_URLS = [
  // Matterport (3D tours)
  'https://my.matterport.com/show/?m=SxQL3iGyvde',
  'https://my.matterport.com/show/?m=ascyhMLNAD5',
  // YouTube virtual tours
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=ScMzIvxBSi4',
  // Vimeo tours
  'https://vimeo.com/76979871',
];

const CALLBACK_SCENARIOS = [
  // Connected calls — good SLA
  { status: 'connected', requested_at: hoursAgo(2),  connected_at: minutesAgo(118), buyer_phone: rPhone() },
  { status: 'connected', requested_at: hoursAgo(5),  connected_at: new Date(Date.now() - 5*3600*1000 + 45000).toISOString(), buyer_phone: rPhone() },
  { status: 'connected', requested_at: hoursAgo(24), connected_at: new Date(Date.now() - 24*3600*1000 + 30000).toISOString(), buyer_phone: rPhone() },
  // Missed calls — follow-up needed
  { status: 'missed', requested_at: hoursAgo(1),  buyer_phone: rPhone() },
  { status: 'missed', requested_at: hoursAgo(3),  buyer_phone: rPhone() },
  { status: 'missed', requested_at: minutesAgo(25), buyer_phone: rPhone() },
  // Today's missed (shows in missed_today counter)
  { status: 'missed', requested_at: minutesAgo(10), buyer_phone: rPhone() },
  { status: 'missed', requested_at: minutesAgo(45), buyer_phone: rPhone() },
  // Pending (just came in)
  { status: 'pending', requested_at: minutesAgo(2), buyer_phone: rPhone() },
  { status: 'pending', requested_at: minutesAgo(8), buyer_phone: rPhone() },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 QR Estate v2 — F4/5/6 Seed\n');
    await client.query('BEGIN');

    // ── Clear previous F456 seed data ────────────────────────────────────────
    console.log('🗑  Clearing previous F456 seed data...');
    await client.query(`DELETE FROM callback_requests`);
    await client.query(`DELETE FROM white_label_configs`);
    await client.query(`UPDATE listings SET tour_url = NULL`);
    console.log('   ✓ Done\n');

    // ── Get all agents + their listings ──────────────────────────────────────
    const agentsRes = await client.query(
      `SELECT u.id, u.email, u.agency_id FROM users u
       WHERE email IN ('rajesh@qrestate.dev','vikram@qrestate2.dev','deepa@qrestate2.dev')`
    );
    const agents = agentsRes.rows;
    const agentMap = {};
    agents.forEach(a => { agentMap[a.email] = a; });

    // ── FEATURE 5: Set tour URLs on select listings ───────────────────────────
    console.log('🎬 Feature 5 — Setting virtual tour URLs...');
    const listingsRes = await client.query(
      `SELECT id, title, agent_id FROM listings WHERE status = 'active' ORDER BY created_at LIMIT 15`
    );
    const listings = listingsRes.rows;

    // Give 5 listings tour URLs (every 3rd listing)
    let tourIdx = 0;
    for (let i = 0; i < listings.length; i += 3) {
      if (tourIdx >= TOUR_URLS.length) break;
      const l = listings[i];
      await client.query(
        `UPDATE listings SET tour_url = $1 WHERE id = $2`,
        [TOUR_URLS[tourIdx], l.id]
      );
      console.log(`   ✓ Tour set on: ${l.title.substring(0, 50)}...`);
      tourIdx++;
    }
    console.log();

    // ── FEATURE 4: Create callback requests ───────────────────────────────────
    console.log('📞 Feature 4 — Creating callback requests...');
    const rajesh = agentMap['rajesh@qrestate.dev'];
    const vikram = agentMap['vikram@qrestate2.dev'];

    // Rajesh gets most scenarios (Chandigarh agent with most listings)
    for (const scenario of CALLBACK_SCENARIOS) {
      // Pick a random active listing for this agent
      const listingRes = await client.query(
        `SELECT id FROM listings WHERE agent_id = $1 AND status = 'active' ORDER BY RANDOM() LIMIT 1`,
        [rajesh.id]
      );
      const listing = listingRes.rows[0];
      if (!listing) continue;

      const uniquePhone = `${scenario.buyer_phone.slice(0,9)}${ri(0,9)}`;
      await client.query(
        `INSERT INTO callback_requests
           (listing_id, agent_id, buyer_phone, status, requested_at, connected_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          listing.id, rajesh.id, uniquePhone, scenario.status,
          scenario.requested_at, scenario.connected_at || null
        ]
      );
    }
    console.log(`   ✓ ${CALLBACK_SCENARIOS.length} callback requests created for rajesh@qrestate.dev`);

    // Vikram gets a few too
    const vikramCallbacks = [
      { status: 'connected', requested_at: hoursAgo(6), connected_at: new Date(Date.now() - 6*3600*1000 + 55000).toISOString(), buyer_phone: rPhone() },
      { status: 'missed',    requested_at: hoursAgo(2), buyer_phone: rPhone() },
    ];
    for (const scenario of vikramCallbacks) {
      const listingRes = await client.query(
        `SELECT id FROM listings WHERE agent_id = $1 AND status = 'active' LIMIT 1`,
        [vikram.id]
      );
      const listing = listingRes.rows[0];
      if (!listing) continue;
      await client.query(
        `INSERT INTO callback_requests (listing_id, agent_id, buyer_phone, status, requested_at, connected_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [listing.id, vikram.id, scenario.buyer_phone, scenario.status, scenario.requested_at, scenario.connected_at || null]
      );
    }
    console.log(`   ✓ 2 callback requests created for vikram@qrestate2.dev\n`);

    // ── FEATURE 6: White-label configs ────────────────────────────────────────
    console.log('🎨 Feature 6 — Creating white-label brand configs...');

    // Agency A: Tricity Homes Realty (Chandigarh)
    const agencyA = await client.query(
      `SELECT a.id FROM agencies a WHERE a.owner_id = $1`, [rajesh.id]
    );
    if (agencyA.rows[0]) {
      await client.query(
        `INSERT INTO white_label_configs
           (agency_id, brand_name, logo_url, primary_color, secondary_color,
            font_choice, support_email, support_phone, website, footer_text,
            hide_powered_by, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT (agency_id) DO UPDATE SET
           brand_name = EXCLUDED.brand_name,
           updated_at = NOW()`,
        [
          agencyA.rows[0].id,
          'Tricity Homes Realty',
          'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg',
          '#1E3A5F',   // dark navy
          '#C8A96E',   // gold
          'Poppins',
          'support@tricityhomes.in',
          '+91 98765 11111',
          'https://tricityhomes.in',
          '© 2025 Tricity Homes Realty. RERA Registered.',
          true,        // hide powered by
        ]
      );
      console.log('   ✓ Tricity Homes Realty — navy + gold, Poppins, hide_powered_by: true');
    }

    // Agency B: Mumbai Prime Properties
    const agencyB = await client.query(
      `SELECT a.id FROM agencies a WHERE a.owner_id = $1`, [vikram.id]
    );
    if (agencyB.rows[0]) {
      await client.query(
        `INSERT INTO white_label_configs
           (agency_id, brand_name, primary_color, secondary_color,
            font_choice, support_email, support_phone, website, footer_text,
            hide_powered_by, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
         ON CONFLICT (agency_id) DO UPDATE SET
           brand_name = EXCLUDED.brand_name, updated_at = NOW()`,
        [
          agencyB.rows[0].id,
          'Mumbai Prime Properties',
          '#8B1A1A',   // deep crimson
          '#D4AF37',   // gold
          'Raleway',
          'hello@mumbaiprime.com',
          '+91 98200 22222',
          'https://mumbaiprime.com',
          '© 2025 Mumbai Prime Properties. All rights reserved.',
          false,       // keep powered_by for now
        ]
      );
      console.log('   ✓ Mumbai Prime Properties — crimson + gold, Raleway, hide_powered_by: false');
    }

    await client.query('COMMIT');

    // ── Stats ─────────────────────────────────────────────────────────────────
    const cbCount = await client.query('SELECT COUNT(*) FROM callback_requests');
    const tourCount = await client.query(`SELECT COUNT(*) FROM listings WHERE tour_url IS NOT NULL`);
    const wlCount = await client.query('SELECT COUNT(*) FROM white_label_configs');

    console.log('\n' + '═'.repeat(60));
    console.log('✅  F4/5/6 SEED COMPLETE\n');

    console.log('FEATURE 4 — 60-Second Callback');
    console.log('─'.repeat(40));
    console.log(`  ✓ ${cbCount.rows[0].count} callback requests created`);
    console.log('  Login as rajesh@qrestate.dev → Dashboard → Callbacks');
    console.log('  → 2 missed TODAY (shows alert banner)');
    console.log('  → 3 connected, 5 missed, 2 pending');
    console.log('  Open any property page → "Get a callback in 60 seconds" button is live\n');

    console.log('FEATURE 5 — Virtual Tour Embed');
    console.log('─'.repeat(40));
    console.log(`  ✓ ${tourCount.rows[0].count} listings have tour URLs set`);
    console.log('  Login → Listings → Edit any listing → AI sidebar → Tour tab');
    console.log('  Open property page → scroll down → tour embed appears\n');

    console.log('FEATURE 6 — White-label Platform');
    console.log('─'.repeat(40));
    console.log(`  ✓ ${wlCount.rows[0].count} brand configs created`);
    console.log('  Tricity Homes: Navy #1E3A5F | Gold #C8A96E | Poppins | powered_by HIDDEN');
    console.log('  Mumbai Prime:  Crimson #8B1A1A | Gold #D4AF37 | Raleway');
    console.log('  Login → Dashboard → Brand (sidebar)');
    console.log('  Upgrade agency plan to test hide_powered_by and domain setup\n');

    console.log('  SQL to upgrade plan for testing:');
    console.log("  UPDATE agencies SET plan='agency', max_agents=25 WHERE name='Tricity Homes Realty';");
    console.log('═'.repeat(60));

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
