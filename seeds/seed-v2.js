/**
 * QR Estate — Complete Fresh Seed v2
 * Covers: Users, Listings, QR Codes, Scans, Leads, Payments
 * All different from seed.js — new agents, cities, property types
 *
 * Run: node backend/seeds/seed-v2.js
 * WARNING: Clears all existing @qrestate2.dev data first
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── AGENTS ────────────────────────────────────────────────────────────────────
const AGENTS = [
  {
    name: 'Vikram Malhotra',
    email: 'vikram@qrestate2.dev',
    password: 'Test@1234',
    phone: '9810001111',
    rera_number: 'RERA-MH-12-2022-008901',
    role: 'agent',
    city: 'Mumbai',
  },
  {
    name: 'Deepa Nair',
    email: 'deepa@qrestate2.dev',
    password: 'Test@1234',
    phone: '9820002222',
    rera_number: 'RERA-KA-04-2021-003456',
    role: 'agent',
    city: 'Bengaluru',
  },
  {
    name: 'Arjun Mehta',
    email: 'arjun@qrestate2.dev',
    password: 'Test@1234',
    phone: '9830003333',
    rera_number: 'RERA-DL-07-2023-011234',
    role: 'agent',
    city: 'Delhi',
  },
];

// ── LISTINGS ──────────────────────────────────────────────────────────────────
const LISTINGS = [
  // ── VIKRAM (Mumbai) ──────────────────────────────────────────────────────
  {
    agentIndex: 0,
    title: '2 BHK Sea View Apartment — Bandra West',
    description: 'Rare sea-facing apartment on Carter Road with stunning Arabian Sea views from both bedrooms. Imported marble flooring, modular kitchen with Hettich fittings, split ACs in all rooms. Building has rooftop infinity pool and 24/7 concierge. Walking distance to Bandstand promenade.',
    property_type: 'apartment',
    listing_type: 'sale',
    price: 32500000,
    price_negotiable: true,
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 1100,
    floor_number: 14,
    total_floors: 22,
    furnishing: 'fully-furnished',
    facing: 'West',
    address: '1402 Neptune Heights, Carter Road',
    locality: 'Bandra West',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400050',
    amenities: ['Lift', 'Swimming Pool', 'Gym', 'Parking', 'Security', 'CCTV', 'Power Backup', 'Clubhouse'],
    status: 'active',
    view_count: 312,
  },
  {
    agentIndex: 0,
    title: '1 BHK Flat for Rent — Andheri East, Near Metro',
    description: 'Compact, well-maintained flat 200m from Andheri Metro station. Perfect for IT professionals working in SEEPZ or Powai. Society has covered parking, 24/7 security. Immediate possession.',
    property_type: 'apartment',
    listing_type: 'rent',
    price: 32000,
    price_negotiable: true,
    bedrooms: 1,
    bathrooms: 1,
    area_sqft: 550,
    floor_number: 6,
    total_floors: 15,
    furnishing: 'semi-furnished',
    facing: 'East',
    address: 'B-604 Sai Nagar CHS, MIDC Road',
    locality: 'Andheri East',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400093',
    amenities: ['Lift', 'Parking', 'Security', 'Power Backup'],
    status: 'active',
    view_count: 198,
  },
  {
    agentIndex: 0,
    title: '4 BHK Luxury Penthouse — Worli Sea Face',
    description: 'Ultra-premium penthouse spanning entire top floor with 360-degree panoramic views of Mumbai skyline and sea. Private terrace garden, home theatre, smart home automation. 3 covered parking slots.',
    property_type: 'apartment',
    listing_type: 'sale',
    price: 185000000,
    price_negotiable: false,
    bedrooms: 4,
    bathrooms: 5,
    area_sqft: 5200,
    floor_number: 38,
    total_floors: 38,
    furnishing: 'fully-furnished',
    facing: 'South',
    address: 'Penthouse, Palais Royale, Worli Sea Face',
    locality: 'Worli',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400018',
    amenities: ['Lift', 'Swimming Pool', 'Gym', 'Parking', 'Security', 'CCTV', 'Power Backup', 'Clubhouse', 'Garden', 'Fire Safety'],
    status: 'active',
    view_count: 511,
  },
  {
    agentIndex: 0,
    title: 'Commercial Office Space — BKC, Mumbai',
    description: 'Grade A office space in Bandra Kurla Complex financial district. Open plan layout with 2 conference rooms. LEED certified building. Direct connectivity to BKC metro station.',
    property_type: 'commercial',
    listing_type: 'rent',
    price: 280000,
    price_negotiable: true,
    area_sqft: 3500,
    floor_number: 12,
    total_floors: 30,
    address: 'Unit 1204, G Block, BKC',
    locality: 'Bandra Kurla Complex',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400051',
    amenities: ['Lift', 'Parking', 'Power Backup', 'Security', 'CCTV', 'Fire Safety'],
    status: 'active',
    view_count: 87,
  },
  {
    agentIndex: 0,
    title: '3 BHK Villa — Lonavala Hill Station',
    description: 'Weekend retreat villa with mountain views, private pool, and lush garden. 2 hours from Mumbai. Ideal for holiday home or Airbnb investment. Fully furnished and maintained.',
    property_type: 'villa',
    listing_type: 'sale',
    price: 18500000,
    price_negotiable: true,
    bedrooms: 3,
    bathrooms: 3,
    area_sqft: 2800,
    furnishing: 'fully-furnished',
    facing: 'North',
    address: 'Villa 12, Green Valley, Tungarli',
    locality: 'Tungarli',
    city: 'Lonavala',
    state: 'Maharashtra',
    pincode: '410401',
    amenities: ['Parking', 'Swimming Pool', 'Garden', 'Security', 'Power Backup'],
    status: 'active',
    view_count: 243,
  },

  // ── DEEPA (Bengaluru) ────────────────────────────────────────────────────
  {
    agentIndex: 1,
    title: '3 BHK Apartment — Whitefield, Bengaluru',
    description: 'Spacious east-facing apartment in premium gated community near Whitefield IT corridor. Embassy Tech Village and Bagmane Tech Park within 5 km. International school and hospital in same township.',
    property_type: 'apartment',
    listing_type: 'sale',
    price: 9200000,
    price_negotiable: true,
    bedrooms: 3,
    bathrooms: 3,
    area_sqft: 1650,
    floor_number: 9,
    total_floors: 20,
    furnishing: 'semi-furnished',
    facing: 'East',
    address: 'C-904 Prestige Tech Park Residences, Whitefield',
    locality: 'Whitefield',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560066',
    amenities: ['Lift', 'Parking', 'Swimming Pool', 'Gym', 'Security', 'CCTV', 'Power Backup', 'Children Play Area', 'Clubhouse'],
    status: 'active',
    view_count: 367,
  },
  {
    agentIndex: 1,
    title: '2 BHK Flat for Rent — Indiranagar 100 Feet Road',
    description: 'Premium semi-furnished flat on iconic 100 Feet Road. Walking distance to metro, pubs, restaurants and CMH Road market. Perfect for young professionals. Pet-friendly society.',
    property_type: 'apartment',
    listing_type: 'rent',
    price: 42000,
    price_negotiable: false,
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 1050,
    floor_number: 3,
    total_floors: 4,
    furnishing: 'semi-furnished',
    facing: 'North',
    address: '45 3rd Cross, 100 Feet Road',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
    amenities: ['Parking', 'Security', 'Power Backup', 'CCTV'],
    status: 'active',
    view_count: 445,
  },
  {
    agentIndex: 1,
    title: 'Plot for Sale — Sarjapur Road, 2400 sqft',
    description: 'BDA approved residential plot in upcoming layout. East-facing corner site. All utilities available — BWSSB water connection, BESCOM electricity, underground drainage. Clear title and khata.',
    property_type: 'plot',
    listing_type: 'sale',
    price: 8400000,
    price_negotiable: true,
    area_sqft: 2400,
    address: 'Site 34, Namma Layout, Sarjapur Road',
    locality: 'Sarjapur Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560035',
    amenities: [],
    status: 'active',
    view_count: 156,
  },
  {
    agentIndex: 1,
    title: '4 BHK Independent House — Jayanagar 4th Block',
    description: 'Old Bengaluru character home on prime 40×60 site. Ground + 2 floors. Excellent rental yield potential. Walking distance to Jayanagar Shopping Complex and Metro.',
    property_type: 'house',
    listing_type: 'sale',
    price: 28000000,
    price_negotiable: true,
    bedrooms: 4,
    bathrooms: 4,
    area_sqft: 3200,
    furnishing: 'unfurnished',
    address: '23 4th Block, Jayanagar',
    locality: 'Jayanagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560011',
    amenities: ['Parking', 'Garden', 'Security'],
    status: 'active',
    view_count: 289,
  },
  {
    agentIndex: 1,
    title: 'Studio Apartment — Koramangala, Fully Furnished',
    description: 'Brand new studio apartment, perfect for solo professionals. Comes with queen bed, sofa, refrigerator, microwave, washing machine and AC. High-speed wifi. Near Koramangala food street.',
    property_type: 'pg',
    listing_type: 'rent',
    price: 22000,
    price_negotiable: false,
    bedrooms: 1,
    bathrooms: 1,
    area_sqft: 400,
    floor_number: 5,
    total_floors: 6,
    furnishing: 'fully-furnished',
    address: '501 Amber Enclave, 5th Block',
    locality: 'Koramangala',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560095',
    amenities: ['Lift', 'Security', 'Power Backup', 'CCTV'],
    status: 'active',
    view_count: 523,
  },

  // ── ARJUN (Delhi) ────────────────────────────────────────────────────────
  {
    agentIndex: 2,
    title: '3 BHK Builder Floor — Vasant Kunj, Delhi',
    description: 'Premium builder floor with separate entry in upscale Vasant Kunj. Italian marble flooring, modular kitchen. Society has 24/7 guard, CCTV. 10 min drive to Ambience Mall and DLF Promenade.',
    property_type: 'house',
    listing_type: 'sale',
    price: 19500000,
    price_negotiable: true,
    bedrooms: 3,
    bathrooms: 3,
    area_sqft: 2200,
    floor_number: 2,
    total_floors: 4,
    furnishing: 'semi-furnished',
    facing: 'South',
    address: 'B-284 Second Floor, Pocket B, Vasant Kunj',
    locality: 'Vasant Kunj',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110070',
    amenities: ['Parking', 'Security', 'CCTV', 'Power Backup', 'Garden'],
    status: 'active',
    view_count: 278,
  },
  {
    agentIndex: 2,
    title: '2 BHK Apartment for Rent — Dwarka Sector 12',
    description: 'Well-maintained apartment in DDA society. Close to Dwarka Sector 10 Metro. Two-wheeler and car parking available. Ideal for families with children — school and park nearby.',
    property_type: 'apartment',
    listing_type: 'rent',
    price: 24000,
    price_negotiable: true,
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 1050,
    floor_number: 4,
    total_floors: 7,
    furnishing: 'semi-furnished',
    facing: 'East',
    address: 'B-4/12 DDA Flats, Sector 12 Dwarka',
    locality: 'Dwarka Sector 12',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110075',
    amenities: ['Lift', 'Parking', 'Security', 'Power Backup', 'Children Play Area'],
    status: 'active',
    view_count: 167,
  },
  {
    agentIndex: 2,
    title: 'Commercial Shop — Connaught Place, Prime Location',
    description: 'Ground floor retail shop in inner circle of Connaught Place. One of Delhi\'s most premium commercial addresses. 24/7 footfall. Currently vacant and ready to lease.',
    property_type: 'commercial',
    listing_type: 'rent',
    price: 350000,
    price_negotiable: false,
    area_sqft: 800,
    floor_number: 0,
    address: 'Shop 4, N-Block, Connaught Place',
    locality: 'Connaught Place',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110001',
    amenities: ['Security', 'CCTV', 'Power Backup', 'Fire Safety'],
    status: 'active',
    view_count: 412,
  },
  {
    agentIndex: 2,
    title: '5 BHK Farmhouse — Chattarpur',
    description: 'Sprawling 1-acre farmhouse with private pool, manicured lawns, and 5 ensuite bedrooms. Fully staffed with cook, gardener and security. Popular for weddings and corporate events.',
    property_type: 'villa',
    listing_type: 'sale',
    price: 85000000,
    price_negotiable: true,
    bedrooms: 5,
    bathrooms: 6,
    area_sqft: 8000,
    furnishing: 'fully-furnished',
    address: 'Farm No. 7, Satbari Village, Chattarpur',
    locality: 'Chattarpur',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110074',
    amenities: ['Parking', 'Swimming Pool', 'Garden', 'Security', 'Power Backup', 'CCTV', 'Servant Room'],
    status: 'active',
    view_count: 634,
  },
  {
    agentIndex: 2,
    title: '1 BHK Apartment — Noida Sector 62 (SOLD)',
    description: 'Compact 1BHK near Noida Sector 62 Metro. Recently sold. Kept for portfolio reference.',
    property_type: 'apartment',
    listing_type: 'sale',
    price: 4800000,
    price_negotiable: false,
    bedrooms: 1,
    bathrooms: 1,
    area_sqft: 650,
    floor_number: 8,
    total_floors: 14,
    furnishing: 'semi-furnished',
    address: 'H-804 Galaxy Apartments, Sector 62',
    locality: 'Sector 62',
    city: 'Noida',
    state: 'Uttar Pradesh',
    pincode: '201301',
    amenities: ['Lift', 'Parking', 'Security', 'Power Backup'],
    status: 'sold',
    view_count: 89,
  },
];

// ── LEADS DATA ────────────────────────────────────────────────────────────────
const LEAD_NAMES = [
  'Aditya Kapoor', 'Sneha Iyer', 'Rahul Bose', 'Meera Pillai',
  'Suresh Menon', 'Anjali Desai', 'Karthik Rao', 'Preethi Subramaniam',
  'Nikhil Agarwal', 'Pooja Choudhary', 'Siddharth Jain', 'Lakshmi Venkat',
  'Gaurav Khanna', 'Ritu Saxena', 'Tarun Bhatia', 'Nandini Krishnan',
  'Mohit Suri', 'Swati Pandey', 'Aryan Trivedi', 'Kavya Reddy',
];

const LEAD_MESSAGES = [
  'Looking to buy this year. Can we schedule a site visit?',
  'Is the price final? What are the maintenance charges?',
  'Very interested. Is there a loan facility available?',
  'Is the society pet-friendly? I have a Labrador.',
  'Can I get the floor plan? Want to check if my furniture will fit.',
  'What is the age of the building? Any pending dues?',
  'Is possession immediate or under construction?',
  'Can we do an online video call first before visiting?',
  'Looking for 2 year lease minimum. Is that possible?',
  'Do you have similar properties in the same area?',
  null,
  null,
];

const LEAD_STATUSES = ['new', 'new', 'new', 'contacted', 'contacted', 'interested', 'interested', 'not_interested', 'converted', 'lost'];
const LEAD_SOURCES = ['whatsapp', 'whatsapp', 'whatsapp', 'call', 'call', 'manual', 'qr_scan'];

const SCAN_DEVICES = ['mobile', 'mobile', 'mobile', 'mobile', 'tablet', 'desktop'];
const SCAN_CITIES = ['Mumbai', 'Pune', 'Bengaluru', 'Delhi', 'Hyderabad', 'Chennai', 'Ahmedabad', 'Kolkata'];

// ── HELPERS ───────────────────────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomPhone() { return `${pick(['98','97','96','95','94','93','91','90','89','88'])}${rand(10000000, 99999999)}`; }
function hoursAgo(n) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}
function daysAgo(n, jitterHours = 12) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(rand(8, 22), rand(0, 59));
  return d.toISOString();
}

// ── MAIN SEED ─────────────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();

  try {
    console.log('\n🌱 QR Estate Seed v2 — Starting...\n');
    await client.query('BEGIN');

    // ── Clear v2 seed data ────────────────────────────────────────────────────
    console.log('🗑  Clearing previous v2 seed data...');
    await client.query(`DELETE FROM users WHERE email LIKE '%@qrestate2.dev'`);
    console.log('   ✓ Cleared\n');

    // ── Create agents ─────────────────────────────────────────────────────────
    console.log('👤 Creating agents...');
    const agentIds = [];
    for (const agent of AGENTS) {
      const hash = await bcrypt.hash(agent.password, 10);
      const res = await client.query(
        `INSERT INTO users (name, email, password_hash, phone, rera_number, role, plan, is_active, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,true) RETURNING id`,
        [agent.name, agent.email, hash, agent.phone, agent.rera_number, agent.role,
         // Vikram on Pro, Deepa on Pro, Arjun on Free
         agentIds.length === 2 ? 'free' : 'pro']
      );
      agentIds.push(res.rows[0].id);
      console.log(`   ✓ ${agent.name} (${agent.email}) — ${agentIds.length <= 2 ? 'Pro' : 'Free'} plan`);
    }
    console.log();

    // Set Pro expiry for Vikram and Deepa
    const proExpiry = new Date();
    proExpiry.setFullYear(proExpiry.getFullYear() + 1);
    await client.query(
      `UPDATE users SET plan_expires_at = $1 WHERE id = ANY($2)`,
      [proExpiry.toISOString(), [agentIds[0], agentIds[1]]]
    );

    // ── Create listings ───────────────────────────────────────────────────────
    console.log('🏠 Creating listings...');
    const listingRecords = [];

    for (const listing of LISTINGS) {
      const shortCode = nanoid(8);
      const agentId = agentIds[listing.agentIndex];

      const res = await client.query(
        `INSERT INTO listings (
          agent_id, title, description, property_type, listing_type,
          price, price_negotiable, bedrooms, bathrooms, area_sqft,
          floor_number, total_floors, furnishing, facing,
          address, locality, city, state, pincode,
          amenities, status, short_code, view_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING id, short_code, title`,
        [
          agentId, listing.title, listing.description,
          listing.property_type, listing.listing_type,
          listing.price, listing.price_negotiable ?? true,
          listing.bedrooms ?? null, listing.bathrooms ?? null,
          listing.area_sqft ?? null,
          listing.floor_number != null ? listing.floor_number : null,
          listing.total_floors ?? null,
          listing.furnishing ?? null, listing.facing ?? null,
          listing.address, listing.locality ?? null,
          listing.city, listing.state, listing.pincode ?? null,
          listing.amenities, listing.status, shortCode, listing.view_count,
        ]
      );

      const row = res.rows[0];
      listingRecords.push({ ...row, agentId, status: listing.status });
      console.log(`   ✓ ${listing.title.substring(0, 58)}...`);
    }
    console.log();

    // ── Create QR codes ───────────────────────────────────────────────────────
    console.log('📱 Creating QR codes...');
    const qrRecords = [];
    const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';
    const APP_URL = process.env.APP_URL || 'http://localhost:5000';

    const QR_STYLES = [
      { style: 'standard', fg: '#000000', bg: '#FFFFFF', frame: false, label: 'Scan to View Property' },
      { style: 'branded', fg: '#1C3A5F', bg: '#FFFFFF', frame: true, label: 'View Property Details' },
      { style: 'minimal', fg: '#2D6A4F', bg: '#FFFFFF', frame: false, label: '' },
      { style: 'standard', fg: '#7B2D8B', bg: '#FFFFFF', frame: true, label: 'Scan & Enquire Now' },
      { style: 'standard', fg: '#B5451B', bg: '#FFFFFF', frame: false, label: '' },
    ];

    for (const listing of listingRecords) {
      if (listing.status === 'sold') continue;

      const style = pick(QR_STYLES);
      const res = await client.query(
        `INSERT INTO qr_codes (
          listing_id, agent_id, short_code,
          style, foreground_color, background_color,
          include_frame, frame_label,
          target_url, scan_count, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,true)
        RETURNING id`,
        [
          listing.id, listing.agentId, listing.short_code,
          style.style, style.fg, style.bg,
          style.frame, style.label,
          `${APP_URL}/q/${listing.short_code}`,
        ]
      );
      qrRecords.push({ id: res.rows[0].id, listingId: listing.id, shortCode: listing.short_code });
      console.log(`   ✓ QR (${style.style}) → ${listing.title.substring(0, 42)}...`);
    }
    console.log();

    // ── Create scan history (60 days, weighted by listing popularity) ─────────
    console.log('📊 Generating 60-day scan history...');
    let totalScans = 0;

    for (let i = 0; i < qrRecords.length; i++) {
      const qr = qrRecords[i];
      // More popular listings get more scans (weighted)
      const baseScan = [45, 28, 62, 15, 38, 55, 70, 22, 33, 48, 41, 65, 80, 19][i] || rand(15, 60);

      for (let s = 0; s < baseScan; s++) {
        const daysBack = rand(0, 59);
        await client.query(
          `INSERT INTO qr_scans (qr_code_id, listing_id, device_type, city, country, scanned_at)
           VALUES ($1,$2,$3,$4,'India',$5)`,
          [qr.id, qr.listingId, pick(SCAN_DEVICES), pick(SCAN_CITIES), daysAgo(daysBack)]
        );
        totalScans++;
      }

      await client.query(
        'UPDATE qr_codes SET scan_count = (SELECT COUNT(*) FROM qr_scans WHERE qr_code_id = $1) WHERE id = $1',
        [qr.id]
      );
    }
    console.log(`   ✓ ${totalScans} scan events across 60 days\n`);

    // ── Create leads ──────────────────────────────────────────────────────────
    console.log('🎯 Creating leads...');
    let totalLeads = 0;

    const activeListings = listingRecords.filter(l => l.status === 'active');

    for (const listing of activeListings) {
      const leadCount = rand(3, 9);

      for (let l = 0; l < leadCount; l++) {
        const status = pick(LEAD_STATUSES);
        const daysBack = rand(0, 44);
        const followUp = ['contacted', 'interested'].includes(status)
          ? new Date(Date.now() + rand(1, 10) * 86400000).toISOString()
          : null;

        await client.query(
          `INSERT INTO leads (
             agent_id, listing_id, name, phone, email,
             message, source, status, notes, follow_up_date,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
          [
            listing.agentId, listing.id,
            pick(LEAD_NAMES), randomPhone(),
            Math.random() > 0.4 ? `${pick(LEAD_NAMES).split(' ')[0].toLowerCase()}${rand(10,99)}@gmail.com` : null,
            pick(LEAD_MESSAGES),
            pick(LEAD_SOURCES), status,
            '[seed-v2] Auto-generated',
            followUp,
            daysAgo(daysBack),
          ]
        );
        totalLeads++;
      }
    }
    console.log(`   ✓ ${totalLeads} leads across ${activeListings.length} listings\n`);

    // ── Create payment history (Pro agents) ───────────────────────────────────
    console.log('💳 Creating payment history...');

    // Vikram — paid Pro 6 months ago
    await client.query(
      `INSERT INTO payments (user_id, razorpay_order_id, razorpay_payment_id, plan, amount, status, created_at)
       VALUES ($1,'order_test_vikram001','pay_test_vik001','pro',49900,'success',$2)`,
      [agentIds[0], daysAgo(180)]
    );

    // Deepa — paid Pro 3 months ago + one failed attempt before that
    await client.query(
      `INSERT INTO payments (user_id, razorpay_order_id, plan, amount, status, created_at)
       VALUES ($1,'order_test_deepa_fail','pro',49900,'failed',$2)`,
      [agentIds[1], daysAgo(100)]
    );
    await client.query(
      `INSERT INTO payments (user_id, razorpay_order_id, razorpay_payment_id, plan, amount, status, created_at)
       VALUES ($1,'order_test_deepa001','pay_test_dep001','pro',49900,'success',$2)`,
      [agentIds[1], daysAgo(92)]
    );

    console.log(`   ✓ 3 payment records (1 failed, 2 success)\n`);

    await client.query('COMMIT');

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('━'.repeat(60));
    console.log('✅ SEED V2 COMPLETE\n');
    console.log('Login credentials:');
    console.log(`  📧 vikram@qrestate2.dev  🔑 Test@1234  (Pro · Mumbai · 5 listings)`);
    console.log(`  📧 deepa@qrestate2.dev   🔑 Test@1234  (Pro · Bengaluru · 5 listings)`);
    console.log(`  📧 arjun@qrestate2.dev   🔑 Test@1234  (Free · Delhi · 5 listings)`);
    console.log();
    console.log(`  🏠 ${LISTINGS.length} listings  (Mumbai, Bengaluru, Delhi, Noida, Lonavala)`);
    console.log(`  📱 ${qrRecords.length} QR codes  (5 different styles/colors)`);
    console.log(`  📊 ${totalScans} scan events  (60 days, mixed devices + cities)`);
    console.log(`  🎯 ${totalLeads} leads  (mixed statuses, follow-up dates)`);
    console.log(`  💳 3 payment records  (Pro plans for Vikram & Deepa)`);
    console.log('━'.repeat(60));
    console.log('\n⚠  Previous seed (rajesh/priya @qrestate.dev) still exists.');
    console.log('   Run seed.js again if you want to re-seed those too.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed v2 failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
