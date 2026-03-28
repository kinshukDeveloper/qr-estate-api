/* eslint-disable camelcase */
require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

/**
 * Master Seed — QR Estate V3 · F01–F12
 *
 * Seeds realistic Indian real estate data for:
 *   F01 saved_listings        F02 (uses saved + listings)
 *   F03 price_alerts          F04 voice_search_logs
 *   F05 listing_videos        F06 eoi_signatures
 *   F07 (pure calc, no seed)  F08 follow_up_sequences
 *   F09 listing_documents + document_access_requests
 *   F10 market_snapshots      F11 neighbourhood_pois
 *   F12 avm_reports
 *
 * Prerequisites: run all migrations 001–008 first.
 * Usage: node backend/src/seeds/seed-v3-features.js
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

// ── Helpers ───────────────────────────────────────────────────────────────────
const uuid  = () => crypto.randomUUID();
const rand  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randN = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString();

// ── Static data ───────────────────────────────────────────────────────────────
const CITIES = [
  { city: 'Mumbai',    localities: ['Andheri West', 'Bandra West', 'Powai', 'Worli', 'Lower Parel', 'Juhu', 'Kandivali East', 'Malad West', 'BKC', 'Goregaon East'] },
  { city: 'Pune',      localities: ['Koregaon Park', 'Baner', 'Hinjewadi', 'Viman Nagar', 'Kalyani Nagar', 'Kothrud', 'Wakad', 'Aundh'] },
  { city: 'Bangalore', localities: ['Whitefield', 'Koramangala', 'Indiranagar', 'HSR Layout', 'Electronic City', 'Sarjapur', 'Hebbal', 'Marathahalli'] },
  { city: 'Delhi',     localities: ['Vasant Vihar', 'Defence Colony', 'Hauz Khas', 'Greater Kailash', 'Dwarka', 'Rohini', 'Pitampura'] },
  { city: 'Chandigarh',localities: ['Sector 17', 'Sector 22', 'Mohali Phase 5', 'Panchkula Sector 20', 'Zirakpur', 'Aerocity'] },
];

const PROP_TYPES = ['apartment', 'villa', 'house', 'plot', 'commercial', 'pg'];
const LIST_TYPES = ['sale', 'rent'];
const STATUS_LIST = ['active', 'active', 'active', 'draft', 'sold', 'rented'];
const FURNISHING = ['furnished', 'semi-furnished', 'unfurnished'];
const FACING = ['North', 'South', 'East', 'West', 'North-East', 'South-East'];
const AMENITIES = ['Parking', 'Gym', 'Swimming Pool', 'Security', 'Lift', 'Power Backup', 'Garden', 'Clubhouse', 'CCTV', 'Play Area', 'Intercom', 'Gated Community', 'Visitor Parking', 'Temple', 'Jogging Track'];

const AGENT_NAMES  = ['Rahul Mehta', 'Priya Sharma', 'Amit Patel', 'Sunita Joshi', 'Vijay Singh', 'Deepa Nair', 'Rajesh Kumar', 'Anita Desai'];
const BUYER_NAMES  = ['Sachin Bansal', 'Neha Agarwal', 'Kiran Reddy', 'Pooja Iyer', 'Manish Gupta', 'Ritu Saxena', 'Arjun Kapoor', 'Smita Rao', 'Gaurav Jain', 'Meera Pillai', 'Arun Nair', 'Divya Sharma'];
const BUYER_PHONES = ['9876543210', '9765432109', '9654321098', '9543210987', '9432109876', '9321098765', '9210987654', '9109876543'];
const EMAILS       = (name) => `${name.toLowerCase().replace(/\s/g, '.')}@gmail.com`;

// ── Seeder ────────────────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 QR Estate V3 — Full Feature Seed Starting...\n');

    // ── 1. Fetch existing users + listings ────────────────────────────────────
    const usersRes    = await client.query(`SELECT id, name, email FROM users LIMIT 10`);
    const listingsRes = await client.query(`SELECT id, price, city, locality, property_type, listing_type, agent_id FROM listings LIMIT 30`);

    if (!usersRes.rows.length)    throw new Error('No users found. Run seed.js first.');
    if (!listingsRes.rows.length) throw new Error('No listings found. Run seed.js first.');

    const users    = usersRes.rows;
    const listings = listingsRes.rows;
    const agentId  = users[0].id;

    console.log(`Found ${users.length} users, ${listings.length} listings.\n`);

    // ── F01: SAVED LISTINGS ───────────────────────────────────────────────────
    console.log('📌 F01: Seeding saved_listings...');
    let savedCount = 0;
    for (const listing of listings.slice(0, 15)) {
      const numSaves = randN(2, 8);
      for (let i = 0; i < numSaves; i++) {
        const token = `sess_${crypto.randomBytes(12).toString('hex')}`;
        try {
          await client.query(
            `INSERT INTO saved_listings (listing_id, session_token, buyer_email, created_at)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [listing.id, token, EMAILS(rand(BUYER_NAMES)), daysAgo(randN(0, 30))]
          );
          savedCount++;
        } catch (_) {}
      }
    }
    console.log(`   ✓ ${savedCount} saves\n`);

    // ── F03: PRICE ALERTS ─────────────────────────────────────────────────────
    console.log('🔔 F03: Seeding price_alerts...');
    let alertCount = 0;
    for (const listing of listings.slice(0, 12)) {
      const numAlerts = randN(1, 5);
      for (let i = 0; i < numAlerts; i++) {
        const buyer = rand(BUYER_NAMES);
        const priceAtSignup = listing.price * (1 + randN(2, 15) / 100); // signed up when price was slightly higher
        try {
          await client.query(
            `INSERT INTO price_alerts (listing_id, email, price_at_signup, unsubscribe_token, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
            [listing.id, EMAILS(buyer), priceAtSignup, crypto.randomBytes(32).toString('hex'), rand([true, true, true, false]), daysAgo(randN(1, 60))]
          );
          alertCount++;
        } catch (_) {}
      }
    }
    console.log(`   ✓ ${alertCount} price alerts\n`);

    // ── F04: VOICE SEARCH LOGS ────────────────────────────────────────────────
    console.log('🎤 F04: Seeding voice_search_logs...');
    const voiceQueries = [
      { transcript: '3BHK apartment in Andheri under 2 crore for sale', filters: { city: 'Mumbai', locality: 'Andheri West', property_type: 'apartment', listing_type: 'sale', bedrooms: 3, max_price: 20000000 } },
      { transcript: '2 bhk flat for rent in Baner Pune under 30 thousand', filters: { city: 'Pune', locality: 'Baner', property_type: 'apartment', listing_type: 'rent', bedrooms: 2, max_price: 30000 } },
      { transcript: 'villa in Koramangala Bangalore above 3 crore', filters: { city: 'Bangalore', locality: 'Koramangala', property_type: 'villa', listing_type: 'sale', min_price: 30000000 } },
      { transcript: 'commercial space in BKC Mumbai for sale', filters: { city: 'Mumbai', locality: 'BKC', property_type: 'commercial', listing_type: 'sale' } },
      { transcript: 'affordable 1 bhk rent Chandigarh sector 17', filters: { city: 'Chandigarh', locality: 'Sector 17', bedrooms: 1, listing_type: 'rent' } },
      { transcript: 'furnished apartment near metro Delhi', filters: { city: 'Delhi', furnishing: 'furnished', property_type: 'apartment' } },
      { transcript: 'plot for sale in Mohali Phase 5 under 50 lakh', filters: { city: 'Chandigarh', locality: 'Mohali Phase 5', property_type: 'plot', listing_type: 'sale', max_price: 5000000 } },
      { transcript: '4BHK penthouse Juhu Mumbai sea view', filters: { city: 'Mumbai', locality: 'Juhu', bedrooms: 4, property_type: 'apartment', listing_type: 'sale' } },
    ];
    for (const q of voiceQueries) {
      for (let i = 0; i < randN(3, 12); i++) {
        await client.query(
          `INSERT INTO voice_search_logs (transcript, parsed_filters, results_count, session_token, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [q.transcript, JSON.stringify(q.filters), randN(0, 25), `sess_${crypto.randomBytes(8).toString('hex')}`, daysAgo(randN(0, 30))]
        );
      }
    }
    console.log(`   ✓ ${voiceQueries.length * 7} voice search logs\n`);

    // ── F05: LISTING VIDEOS ───────────────────────────────────────────────────
    console.log('🎥 F05: Seeding listing_videos...');
    const videoSamples = [
      { label: 'Property Tour',     url: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',      thumb: 'https://res.cloudinary.com/demo/video/upload/dog.jpg',      duration: 45  },
      { label: 'Neighbourhood Walk', url: 'https://res.cloudinary.com/demo/video/upload/cld_dog.mp4', thumb: 'https://res.cloudinary.com/demo/video/upload/cld_dog.jpg', duration: 62  },
      { label: 'Amenities Tour',     url: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',      thumb: 'https://res.cloudinary.com/demo/video/upload/dog.jpg',      duration: 38  },
    ];
    let videoCount = 0;
    for (const listing of listings.slice(0, 10)) {
      const numVids = randN(1, 2);
      for (let i = 0; i < numVids; i++) {
        const v = videoSamples[i % videoSamples.length];
        await client.query(
          `INSERT INTO listing_videos (listing_id, cloudinary_public_id, url, thumbnail_url, duration_seconds, size_bytes, label, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [listing.id, `qrestate/listings/${listing.id}/vid_${i}`, v.url, v.thumb, v.duration, randN(5, 80) * 1024 * 1024, v.label, i, daysAgo(randN(0, 20))]
        );
        videoCount++;
      }
    }
    console.log(`   ✓ ${videoCount} listing videos\n`);

    // ── F06: EOI SIGNATURES ───────────────────────────────────────────────────
    console.log('✍️  F06: Seeding eoi_signatures...');
    const eoiStatuses = ['pending', 'pending', 'accepted', 'rejected'];
    let eoiCount = 0;
    for (const listing of listings.slice(0, 12)) {
      const numEOIs = randN(0, 3);
      for (let i = 0; i < numEOIs; i++) {
        const buyerName = rand(BUYER_NAMES);
        const offerPrice = listing.price * (rand([0.92, 0.95, 0.97, 1.0, 1.02]));
        await client.query(
          `INSERT INTO eoi_signatures (listing_id, agent_id, buyer_name, buyer_phone, buyer_email, offer_price, message, signature_data, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            listing.id, listing.agent_id, buyerName,
            `9${randN(100000000, 999999999)}`,
            EMAILS(buyerName),
            Math.round(offerPrice),
            rand(['Very interested. Can we visit this weekend?', 'Please confirm availability for site visit.', 'Is the price negotiable?', 'Looking forward to meeting.', null]),
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            rand(eoiStatuses),
            daysAgo(randN(0, 45)),
          ]
        );
        eoiCount++;
      }
    }
    console.log(`   ✓ ${eoiCount} EOI signatures\n`);

    // ── F08: FOLLOW-UP SEQUENCES ──────────────────────────────────────────────
    console.log('📬 F08: Seeding follow_up_sequences...');
    const leadsRes = await client.query(`SELECT id, agent_id FROM leads LIMIT 20`);
    let fuCount = 0;
    for (const lead of leadsRes.rows) {
      const baseTime = new Date(Date.now() - randN(0, 20) * 86400000);
      const steps = [
        { step: 1, channel: 'whatsapp', template_key: 'step1_whatsapp', delay: 0,                  status: 'sent'      },
        { step: 2, channel: 'email',    template_key: 'step2_email',    delay: 24 * 3600000,       status: rand(['sent', 'scheduled']) },
        { step: 3, channel: 'whatsapp', template_key: 'step3_whatsapp', delay: 72 * 3600000,       status: rand(['sent', 'scheduled', 'paused']) },
        { step: 4, channel: 'email',    template_key: 'step4_email',    delay: 7 * 24 * 3600000,   status: rand(['scheduled', 'paused']) },
      ];
      for (const s of steps) {
        const scheduledAt = new Date(baseTime.getTime() + s.delay);
        const sentAt = s.status === 'sent' ? new Date(scheduledAt.getTime() + randN(0, 300000)).toISOString() : null;
        await client.query(
          `INSERT INTO follow_up_sequences (lead_id, agent_id, step, channel, template_key, scheduled_at, sent_at, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
          [lead.id, lead.agent_id, s.step, s.channel, s.template_key, scheduledAt.toISOString(), sentAt, s.status, baseTime.toISOString()]
        );
        fuCount++;
      }
    }
    console.log(`   ✓ ${fuCount} follow-up steps\n`);

    // ── F09: DOCUMENT VAULT ───────────────────────────────────────────────────
    console.log('📁 F09: Seeding listing_documents...');
    const docTypes = [
      { doc_type: 'floor_plan',          label: 'Floor Plan',                is_public: true  },
      { doc_type: 'title_deed',          label: 'Title Deed',                is_public: false },
      { doc_type: 'rera_certificate',    label: 'RERA Certificate',          is_public: true  },
      { doc_type: 'oc_cc',               label: 'Occupancy Certificate',     is_public: false },
      { doc_type: 'possession_letter',   label: 'Possession Letter',         is_public: false },
      { doc_type: 'noc',                 label: 'No Objection Certificate',  is_public: false },
      { doc_type: 'tax_receipt',         label: 'Property Tax Receipt',      is_public: false },
      { doc_type: 'sale_agreement',      label: 'Sale Agreement Draft',      is_public: false },
    ];
    const docIds = [];
    let docCount = 0;
    for (const listing of listings.slice(0, 12)) {
      const numDocs = randN(2, 5);
      const selectedDocs = [...docTypes].sort(() => Math.random() - 0.5).slice(0, numDocs);
      for (const doc of selectedDocs) {
        const res = await client.query(
          `INSERT INTO listing_documents (listing_id, agent_id, doc_type, label, cloudinary_public_id, url, size_bytes, is_public, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [
            listing.id, listing.agent_id, doc.doc_type, doc.label,
            `qrestate/docs/${listing.id}/${doc.doc_type}`,
            `https://res.cloudinary.com/demo/raw/upload/sample.pdf`,
            randN(100, 5000) * 1024,
            doc.is_public,
            daysAgo(randN(0, 60)),
          ]
        );
        docIds.push({ id: res.rows[0].id, is_public: doc.is_public });
        docCount++;
      }
    }
    console.log(`   ✓ ${docCount} documents\n`);

    // F09: Document access requests
    console.log('🔐 F09: Seeding document_access_requests...');
    const privateDocIds = docIds.filter((d) => !d.is_public).map((d) => d.id);
    const reqStatuses = ['pending', 'pending', 'approved', 'rejected'];
    let reqCount = 0;
    for (const docId of privateDocIds.slice(0, 20)) {
      const numReqs = randN(0, 3);
      for (let i = 0; i < numReqs; i++) {
        const buyer = rand(BUYER_NAMES);
        const status = rand(reqStatuses);
        const token = status === 'approved' ? crypto.randomBytes(32).toString('hex') : null;
        const expiresAt = status === 'approved' ? daysAhead(2) : null;
        await client.query(
          `INSERT INTO document_access_requests (document_id, buyer_name, buyer_email, buyer_phone, message, status, access_token, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [docId, buyer, EMAILS(buyer), `9${randN(100000000, 999999999)}`,
           rand(['Please share the floor plan', 'Need documents for bank loan', 'Interested in purchase', null]),
           status, token, expiresAt, daysAgo(randN(0, 15))]
        );
        reqCount++;
      }
    }
    console.log(`   ✓ ${reqCount} access requests\n`);

    // ── F10: MARKET SNAPSHOTS ─────────────────────────────────────────────────
    console.log('📊 F10: Seeding market_snapshots (180 days x cities x types)...');
    let snapCount = 0;
    for (const { city, localities } of CITIES) {
      for (const propType of ['apartment', 'villa', 'commercial']) {
        for (const listType of LIST_TYPES) {
          // Base prices per city/type
          const basePriceMap = {
            'Mumbai':     { apartment: 18000, villa: 28000, commercial: 22000 },
            'Pune':       { apartment: 8500,  villa: 12000, commercial: 9000  },
            'Bangalore':  { apartment: 7200,  villa: 11000, commercial: 8500  },
            'Delhi':      { apartment: 12000, villa: 20000, commercial: 15000 },
            'Chandigarh': { apartment: 5500,  villa: 8000,  commercial: 6500  },
          };
          const basePerSqft = (basePriceMap[city]?.[propType] || 6000);

          // 180 daily snapshots
          for (let daysBack = 180; daysBack >= 0; daysBack -= 7) {
            const trend = 1 + (180 - daysBack) * 0.0008; // slight upward trend over time
            const noise = 1 + (Math.random() - 0.5) * 0.04;
            const pricePerSqft = Math.round(basePerSqft * trend * noise);
            const avgArea = listType === 'rent' ? 900 : 1200;
            const avgPrice = listType === 'rent' ? Math.round(pricePerSqft * 0.12) : Math.round(pricePerSqft * avgArea);
            const snapshotDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

            for (const locality of localities.slice(0, 3)) {
              const localityFactor = 1 + (localities.indexOf(locality) * 0.05);
              try {
                await client.query(
                  `INSERT INTO market_snapshots
                     (city, locality, property_type, listing_type, avg_price, avg_price_sqft, median_price, total_listings, total_views, total_leads, snapshot_date)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT (city, locality, property_type, listing_type, snapshot_date) DO NOTHING`,
                  [
                    city, locality, propType, listType,
                    Math.round(avgPrice * localityFactor),
                    Math.round(pricePerSqft * localityFactor),
                    Math.round(avgPrice * localityFactor * 0.95),
                    randN(3, 40),
                    randN(50, 1200),
                    randN(2, 45),
                    snapshotDate,
                  ]
                );
                snapCount++;
              } catch (_) {}
            }
          }
        }
      }
    }
    console.log(`   ✓ ${snapCount} market snapshots\n`);

    // ── F11: NEIGHBOURHOOD POIs ───────────────────────────────────────────────
    console.log('📍 F11: Seeding neighbourhood_pois...');
    const poiTemplates = [
      { category: 'school',      names: ['Delhi Public School', 'Ryan International', 'Kendriya Vidyalaya', 'Euro Kids', 'Podar International'] },
      { category: 'hospital',    names: ['Apollo Hospital', 'Fortis Healthcare', 'Nanavati Hospital', 'Lilavati Hospital', 'Max Hospital'] },
      { category: 'metro',       names: ['Metro Station', 'Rapid Metro', 'Suburban Rail Station', 'Bus Terminal', 'BRTS Stop'] },
      { category: 'mall',        names: ['Phoenix Mall', 'Inorbit Mall', 'Nexus Mall', 'Seawoods Grand Central', 'Oberoi Mall'] },
      { category: 'park',        names: ['Central Park', 'Joggers Park', 'Butterfly Garden', 'Cubbon Park', 'Rani Bagh'] },
      { category: 'bank',        names: ['HDFC Bank', 'ICICI Bank', 'SBI Branch', 'Kotak Mahindra', 'Axis Bank ATM'] },
      { category: 'restaurant',  names: ["McDonald's", 'Haldirams', 'Barbeque Nation', 'Café Coffee Day', 'Paradise Biryani'] },
      { category: 'supermarket', names: ['DMart', 'Reliance Fresh', 'Big Bazaar', 'Nature\'s Basket', 'More Supermarket'] },
    ];
    let poiCount = 0;
    for (const listing of listings.slice(0, 15)) {
      const listingRes2 = await client.query(`SELECT latitude, longitude FROM listings WHERE id=$1`, [listing.id]);
      const baseLat = parseFloat(listingRes2.rows[0]?.latitude || '19.0760');
      const baseLng = parseFloat(listingRes2.rows[0]?.longitude || '72.8777');

      for (const { category, names } of poiTemplates) {
        const numPOIs = randN(1, 3);
        for (let i = 0; i < numPOIs; i++) {
          const distance = randN(200, 2000);
          const angle = Math.random() * 2 * Math.PI;
          const lat = baseLat + (Math.sin(angle) * distance / 111000);
          const lng = baseLng + (Math.cos(angle) * distance / (111000 * Math.cos(baseLat * Math.PI / 180)));
          await client.query(
            `INSERT INTO neighbourhood_pois (listing_id, name, category, address, distance_m, rating, lat, lng, fetched_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              listing.id,
              rand(names),
              category,
              `Near ${listing.locality || listing.city}`,
              distance,
              (3.5 + Math.random() * 1.5).toFixed(1),
              lat.toFixed(7),
              lng.toFixed(7),
              daysAgo(randN(0, 7)),
            ]
          );
          poiCount++;
        }
      }
    }
    console.log(`   ✓ ${poiCount} neighbourhood POIs\n`);

    // ── F12: AVM REPORTS ──────────────────────────────────────────────────────
    console.log('🤖 F12: Seeding avm_reports...');
    const avmSummaries = [
      'Based on 18 comparable sales in the same locality over the last 90 days, this property appears fairly priced. The micro-market has shown 8% appreciation YoY. Floor level and sea view add ~5% premium.',
      'Valuation is on the higher end relative to comparables. Similar apartments transacted at ₹14,500–₹16,200/sqft in this locality. Recommend pricing at the lower estimate for faster sale.',
      'Strong demand locality. Limited supply of this property type keeps prices elevated. 3BHKs in this segment are transacting within 30 days of listing on average.',
      'Plot sizes in this area have limited transaction history. Estimate based on 12 comparables within 2km. Road-facing plots command 15–20% premium.',
      'Commercial properties in this micro-market are witnessing good demand from IT sector tenants. Rental yields of 6–8% are achievable at this price point.',
    ];
    let avmCount = 0;
    for (const listing of listings.slice(0, 10)) {
      const midPrice = listing.price * (1 + (Math.random() - 0.5) * 0.1);
      const spread = midPrice * 0.08;
      await client.query(
        `INSERT INTO avm_reports
           (listing_id, city, locality, property_type, area_sqft, input_price, estimated_low, estimated_mid, estimated_high, confidence_score, comparables_used, ai_summary, requested_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          listing.id,
          listing.city,
          listing.locality,
          listing.property_type,
          randN(800, 3500),
          listing.price,
          Math.round(midPrice - spread),
          Math.round(midPrice),
          Math.round(midPrice + spread),
          randN(68, 94),
          randN(8, 24),
          rand(avmSummaries),
          listing.agent_id,
          daysAgo(randN(0, 30)),
        ]
      );
      avmCount++;
    }
    console.log(`   ✓ ${avmCount} AVM reports\n`);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('═'.repeat(50));
    console.log('✅ Seed complete! Summary:');
    console.log(`   F01 Saved Listings:       ${savedCount}`);
    console.log(`   F03 Price Alerts:         ${alertCount}`);
    console.log(`   F04 Voice Search Logs:    ~${voiceQueries.length * 7}`);
    console.log(`   F05 Listing Videos:       ${videoCount}`);
    console.log(`   F06 EOI Signatures:       ${eoiCount}`);
    console.log(`   F08 Follow-up Steps:      ${fuCount}`);
    console.log(`   F09 Documents:            ${docCount}`);
    console.log(`   F09 Access Requests:      ${reqCount}`);
    console.log(`   F10 Market Snapshots:     ${snapCount}`);
    console.log(`   F11 Neighbourhood POIs:   ${poiCount}`);
    console.log(`   F12 AVM Reports:          ${avmCount}`);
    console.log('═'.repeat(50));

  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => { console.error('❌ Seed failed:', err.message); process.exit(1); });
