/* eslint-disable camelcase */
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

/**
 * Seed — QR Estate V3 · F13–F18
 * Run AFTER seed-v3-features.js (which covers F01–F12).
 * Usage: node backend/src/seeds/seed-v3-f13-f18.js
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const rand  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randN = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo   = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString();

const BUYER_NAMES  = ['Sachin Bansal', 'Neha Agarwal', 'Kiran Reddy', 'Pooja Iyer', 'Manish Gupta', 'Ritu Saxena', 'Arjun Kapoor', 'Smita Rao', 'Gaurav Jain', 'Meera Pillai', 'Arun Nair', 'Divya Sharma', 'Rohit Verma', 'Priti Shah', 'Suresh Pillai'];
const email = (n) => `${n.toLowerCase().replace(/\s/g, '.')}@gmail.com`;

const NRI_COUNTRIES = ['United States', 'United Kingdom', 'UAE', 'Canada', 'Australia', 'Singapore', 'Germany'];
const NRI_TIMEZONES = ['America/New_York', 'Europe/London', 'Asia/Dubai', 'America/Toronto', 'Australia/Sydney', 'Asia/Singapore', 'Europe/Berlin'];

const REVIEW_TITLES = [
  'Excellent service, very professional',
  'Helped us find our dream home',
  'Highly responsive agent',
  'Made the process seamless',
  'Very knowledgeable about the area',
  'Great experience overall',
  'Quick to respond and very helpful',
  'Transparent throughout the process',
];
const REVIEW_BODIES = [
  'We were looking for a 3BHK in Andheri for 6 months before finding this agent. The QR system was super convenient — I just scanned the hoarding and got all details instantly.',
  'Very honest about the property conditions. Helped us negotiate a good price. The EOI signing was smooth and professional.',
  'Called back within minutes every time. Arranged 3 site visits in one weekend. Would highly recommend.',
  'Knew every detail about the locality — schools, hospitals, metro distance. Very thorough.',
  'The brochure PDF was excellent quality. Made it easy to share with family before deciding.',
  'First-time buyer here. The agent explained everything clearly including stamp duty and registration process.',
  'Fast transaction. From first scan to possession in under 45 days. Amazing!',
];

const CHAT_SESSIONS = [
  { userMsgs: ['What is the price?', 'Is it negotiable?', 'How many floors?'], aiMsgs: ['The property is listed at ₹1.8Cr.', 'Yes, the price is slightly negotiable.', 'It is on the 8th floor of a 15-floor tower.'] },
  { userMsgs: ['Where exactly is this located?', 'Is there parking?', 'I want to schedule a visit'], aiMsgs: ['Located in Andheri West, 5 mins from metro.', 'Yes, 2 dedicated parking spots included.', "I'll connect you with the agent to arrange a visit!"] },
  { userMsgs: ['Is this available for immediate possession?', 'What amenities are included?'], aiMsgs: ['Yes, possession is immediate.', 'Amenities include gym, pool, security, lift, and power backup.'] },
  { userMsgs: ['What is the sqft size?', 'Is it furnished?', 'Best time to call?'], aiMsgs: ['1450 sqft carpet area.', 'Semi-furnished with modular kitchen and wardrobes.', "I'll pass your preferred time to the agent!"] },
];

const PHOTO_FEEDBACK = [
  { score: 82, issues: [{ issue: 'Minor clutter', severity: 'low', suggestion: 'Remove personal items from frame before shooting.' }], feedback: 'Good natural lighting and wide angle. Remove the few personal items visible on the counter for a cleaner shot.' },
  { score: 64, issues: [{ issue: 'Poor lighting', severity: 'high', suggestion: 'Shoot during daytime with curtains open.' }, { issue: 'Cluttered space', severity: 'medium', suggestion: 'Clear countertops and arrange furniture neatly.' }], feedback: 'The room looks cramped due to poor lighting and clutter. Open the curtains and declutter before the next shoot.' },
  { score: 91, issues: [], feedback: 'Excellent professional-quality photograph. Great lighting, clean space, and good composition showing the room to its best advantage.' },
  { score: 55, issues: [{ issue: 'Overexposed', severity: 'medium', suggestion: 'Adjust camera exposure or shoot at different time of day.' }, { issue: 'Low resolution', severity: 'high', suggestion: 'Use minimum 12MP camera or DSLR for property photos.' }], feedback: 'The bright exposure washes out details. Use HDR mode or manual exposure adjustment. Higher resolution is strongly recommended.' },
  { score: 75, issues: [{ issue: 'Awkward angle', severity: 'medium', suggestion: 'Shoot from corner at shoulder height for better spatial depth.' }], feedback: 'Decent photo but the angle makes the room look smaller. Corner shots at shoulder height typically work better for Indian apartments.' },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 QR Estate V3 — F13–F18 Seed Starting...\n');

    const usersRes    = await client.query(`SELECT id, name FROM users LIMIT 10`);
    const listingsRes = await client.query(`SELECT id, price, agent_id, title FROM listings LIMIT 20`);
    const leadsRes    = await client.query(`SELECT id, agent_id, message FROM leads LIMIT 30`);

    if (!usersRes.rows.length)    throw new Error('No users found. Run seed.js first.');
    if (!listingsRes.rows.length) throw new Error('No listings found. Run seed.js first.');

    const users    = usersRes.rows;
    const listings = listingsRes.rows;
    const leads    = leadsRes.rows;

    // ── F13: LEAD SCORES ─────────────────────────────────────────────────────
    console.log('🎯 F13: Seeding lead_scores...');
    const grades = ['HOT', 'HOT', 'WARM', 'WARM', 'WARM', 'COLD', 'COLD'];
    let lsCount = 0;
    for (const lead of leads) {
      const grade = rand(grades);
      const score = grade === 'HOT' ? randN(70, 98) : grade === 'WARM' ? randN(40, 69) : randN(5, 39);
      const breakdown = {
        scan_count:          randN(0, 50),
        dwell_minutes:       0,
        callback_requested:  grade === 'HOT' ? 20 : 0,
        message_quality:     grade === 'HOT' ? randN(10, 20) : grade === 'WARM' ? randN(4, 12) : randN(0, 5),
        follow_up_responded: grade !== 'COLD' ? 10 : 0,
        listing_saves:       randN(0, 24),
      };
      await client.query(
        `INSERT INTO lead_scores (lead_id, score, grade, scan_count, callback_requested, message_quality_score, follow_up_responded, listing_saves, score_breakdown, last_scored_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (lead_id) DO UPDATE SET score=EXCLUDED.score, grade=EXCLUDED.grade, score_breakdown=EXCLUDED.score_breakdown`,
        [lead.id, score, grade, breakdown.scan_count, grade !== 'COLD', breakdown.message_quality, grade !== 'COLD', Math.floor(breakdown.listing_saves / 8), JSON.stringify(breakdown), daysAgo(randN(0, 7))]
      );
      lsCount++;
    }
    console.log(`   ✓ ${lsCount} lead scores\n`);

    // ── F14: PHOTO ADVISOR REPORTS ────────────────────────────────────────────
    console.log('📸 F14: Seeding photo_advisor_reports...');
    let paCount = 0;
    for (const listing of listings.slice(0, 10)) {
      const numPhotos = randN(2, 4);
      const sampleUrls = [
        'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800',
        'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800',
        'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
        'https://images.unsplash.com/photo-1574362848149-11496d93a7c7?w=800',
      ];
      for (let i = 0; i < numPhotos; i++) {
        const fb = rand(PHOTO_FEEDBACK);
        await client.query(
          `INSERT INTO photo_advisor_reports (listing_id, agent_id, image_url, overall_score, issues, ai_feedback, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [listing.id, listing.agent_id, sampleUrls[i % sampleUrls.length], fb.score, JSON.stringify(fb.issues), fb.feedback, daysAgo(randN(0, 20))]
        );
        paCount++;
      }
    }
    console.log(`   ✓ ${paCount} photo reports\n`);

    // ── F15: AI CHAT SESSIONS ─────────────────────────────────────────────────
    console.log('💬 F15: Seeding ai_chat_sessions...');
    let chatCount = 0;
    for (const listing of listings.slice(0, 12)) {
      const numSessions = randN(1, 4);
      for (let s = 0; s < numSessions; s++) {
        const session = rand(CHAT_SESSIONS);
        const messages = [];
        for (let i = 0; i < session.userMsgs.length; i++) {
          messages.push({ role: 'user', content: session.userMsgs[i], ts: daysAgo(randN(0, 10)) });
          if (session.aiMsgs[i]) messages.push({ role: 'assistant', content: session.aiMsgs[i], ts: daysAgo(randN(0, 10)) });
        }
        const leadCaptured = rand([true, false, false]);
        const buyer = rand(BUYER_NAMES);
        await client.query(
          `INSERT INTO ai_chat_sessions (listing_id, session_token, messages, lead_captured, lead_name, lead_phone, lead_email, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [listing.id, `sess_${crypto.randomBytes(10).toString('hex')}`, JSON.stringify(messages),
           leadCaptured, leadCaptured ? buyer : null,
           leadCaptured ? `9${randN(100000000, 999999999)}` : null,
           leadCaptured ? email(buyer) : null, daysAgo(randN(0, 30))]
        );
        chatCount++;
      }
    }
    console.log(`   ✓ ${chatCount} chat sessions\n`);

    // ── F16: NRI CALLBACKS ────────────────────────────────────────────────────
    console.log('🌍 F16: Seeding nri_callbacks...');
    let nriCount = 0;
    for (const listing of listings.slice(0, 10)) {
      const numCBs = randN(0, 3);
      for (let i = 0; i < numCBs; i++) {
        const buyer = rand(BUYER_NAMES);
        const countryIdx = randN(0, NRI_COUNTRIES.length - 1);
        await client.query(
          `INSERT INTO nri_callbacks (listing_id, agent_id, name, email, phone, country, timezone, preferred_time, message, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [listing.id, listing.agent_id, buyer, email(buyer),
           `+${randN(1, 99)}${randN(1000000000, 9999999999)}`,
           NRI_COUNTRIES[countryIdx], NRI_TIMEZONES[countryIdx],
           rand(['Weekdays 8–10pm IST', 'Weekend mornings IST', 'Any time IST', 'Monday–Friday after 6pm IST']),
           rand(['Interested in buying for investment', 'Looking to move back to India', 'Buying for parents', null]),
           rand(['pending', 'pending', 'scheduled', 'completed']),
           daysAgo(randN(0, 30))]
        );
        nriCount++;
      }
    }
    console.log(`   ✓ ${nriCount} NRI callbacks\n`);

    // ── F18: FEATURED LISTINGS ────────────────────────────────────────────────
    console.log('⭐ F18: Seeding featured_listings...');
    const tiers = ['basic', 'premium', 'top', 'basic', 'premium'];
    const tierPrices = { basic: 9900, premium: 24900, top: 49900 };
    let featCount = 0;
    for (const listing of listings.slice(0, 8)) {
      const tier = rand(tiers);
      const startDaysAgo = randN(0, 5);
      try {
        await client.query(
          `INSERT INTO featured_listings (listing_id, agent_id, boost_tier, price_paid, starts_at, ends_at, impressions, clicks, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (listing_id) DO NOTHING`,
          [listing.id, listing.agent_id, tier, tierPrices[tier],
           daysAgo(startDaysAgo), daysAhead(7 - startDaysAgo),
           randN(50, 800), randN(5, 80), daysAgo(startDaysAgo)]
        );
        featCount++;
      } catch (_) {}
    }
    console.log(`   ✓ ${featCount} featured listings\n`);

    // ── F18: AGENT REVIEWS ────────────────────────────────────────────────────
    console.log('⭐ F18: Seeding agent_reviews...');
    const ratingWeights = [5, 5, 5, 4, 4, 4, 3, 2]; // skewed positive
    let revCount = 0;
    for (const user of users) {
      const numReviews = randN(3, 8);
      for (let i = 0; i < numReviews; i++) {
        const buyer = rand(BUYER_NAMES);
        const rating = rand(ratingWeights);
        const listing = rand(listings.filter((l) => l.agent_id === user.id)) || rand(listings);
        await client.query(
          `INSERT INTO agent_reviews (agent_id, listing_id, reviewer_name, reviewer_email, rating, title, body, is_verified, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [user.id, listing.id, buyer, email(buyer), rating,
           rand(REVIEW_TITLES), rand(REVIEW_BODIES),
           rand([true, true, false]), daysAgo(randN(0, 180))]
        );
        revCount++;
      }
    }
    console.log(`   ✓ ${revCount} agent reviews\n`);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('═'.repeat(55));
    console.log('✅ F13–F18 Seed complete!');
    console.log(`   F13 Lead Scores:       ${lsCount}`);
    console.log(`   F14 Photo Reports:     ${paCount}`);
    console.log(`   F15 Chat Sessions:     ${chatCount}`);
    console.log(`   F16 NRI Callbacks:     ${nriCount}`);
    console.log(`   F18 Featured:          ${featCount}`);
    console.log(`   F18 Reviews:           ${revCount}`);
    console.log('═'.repeat(55));

  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => { console.error('❌ Seed failed:', err.message); process.exit(1); });
