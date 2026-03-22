/**
 * QR Estate — Seed Script
 * Run: node backend/seeds/seed.js
 * Requires: backend/.env to be configured and DB migrated
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── SEED DATA ─────────────────────────────────────────────────────────────────

const AGENTS = [
  {
    name: 'Rajesh Kumar',
    email: 'rajesh@qrestate.dev',
    password: 'Test@1234',
    phone: '9876543210',
    rera_number: 'RERA-PB-01-2023-001234',
    role: 'agent',
  },
  {
    name: 'Priya Sharma',
    email: 'priya@qrestate.dev',
    password: 'Test@1234',
    phone: '9988776655',
    rera_number: 'RERA-PB-01-2023-005678',
    role: 'agent',
  },
];

const LISTINGS = [
  // Rajesh's listings (index 0)
  {
    agentIndex: 0,
    title: '3 BHK Premium Apartment in Sector 17, Chandigarh',
    description: 'Stunning south-facing apartment on 7th floor with panoramic city views. Fully modular kitchen, marble flooring throughout, two covered parking spots. 5 mins walk to Sector 17 plaza. Society has 24/7 security, power backup, and rooftop garden.',
    property_type: 'apartment',
    listing_type: 'sale',
    price: 8500000,
    price_negotiable: true,
    bedrooms: 3,
    bathrooms: 2,
    area_sqft: 1450,
    floor_number: 7,
    total_floors: 12,
    furnishing: 'fully-furnished',
    facing: 'South',
    address: '204 Silver Oak Apartments, Sector 17',
    locality: 'Sector 17',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160017',
    amenities: ['Lift', 'Parking', 'Power Backup', 'Security', 'CCTV', 'Gym', 'Garden'],
    status: 'active',
  },
  {
    agentIndex: 0,
    title: '2 BHK Flat for Rent — Sector 22, Chandigarh',
    description: 'Well-maintained semi-furnished flat in a peaceful society. Near markets, schools and hospital. Ideal for working professionals or small family. Available immediately.',
    property_type: 'apartment',
    listing_type: 'rent',
    price: 18000,
    price_negotiable: true,
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 980,
    floor_number: 3,
    total_floors: 5,
    furnishing: 'semi-furnished',
    facing: 'East',
    address: 'House 112, Sector 22-B',
    locality: 'Sector 22',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160022',
    amenities: ['Lift', 'Parking', 'Security', 'CCTV'],
    status: 'active',
  },
  {
    agentIndex: 0,
    title: 'Independent Villa — Sector 8, Chandigarh',
    description: '4-bedroom independent villa with private garden, servant quarters and double garage. Corner plot, very airy. Rare opportunity in prime sector.',
    property_type: 'villa',
    listing_type: 'sale',
    price: 32000000,
    price_negotiable: true,
    bedrooms: 4,
    bathrooms: 4,
    area_sqft: 3200,
    facing: 'North',
    address: '78 Sector 8-C',
    locality: 'Sector 8',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160008',
    amenities: ['Parking', 'Garden', 'Security', 'Servant Room', 'Gas Pipeline'],
    status: 'active',
  },
  {
    agentIndex: 0,
    title: 'Commercial Shop — Ground Floor, Sector 34',
    description: 'Prime commercial space on main market road. 650 sqft showroom with mezzanine. High footfall area, suitable for retail, clinic or office.',
    property_type: 'commercial',
    listing_type: 'rent',
    price: 55000,
    price_negotiable: false,
    area_sqft: 650,
    floor_number: 0,
    total_floors: 3,
    address: 'SCO 145, Sector 34-A',
    locality: 'Sector 34',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160034',
    amenities: ['Power Backup', 'CCTV', 'Parking'],
    status: 'active',
  },
  {
    agentIndex: 0,
    title: '200 Sq Yd Residential Plot — Mohali Phase 7',
    description: 'GMADA approved 200 sq yd corner plot. All utilities in place — water, electricity, sewage. Quiet residential street, ideal to build your dream home.',
    property_type: 'plot',
    listing_type: 'sale',
    price: 12000000,
    price_negotiable: true,
    area_sqft: 1800,
    address: 'Plot 456, Phase 7',
    locality: 'Phase 7',
    city: 'Mohali',
    state: 'Punjab',
    pincode: '160059',
    amenities: [],
    status: 'active',
  },
  {
    agentIndex: 0,
    title: '1 BHK PG Accommodation — Sector 34, Chandigarh',
    description: 'Clean and affordable PG for working professionals. Attached bathroom, AC, WiFi included. Meals optional. 10 min from IT Park.',
    property_type: 'pg',
    listing_type: 'rent',
    price: 8500,
    price_negotiable: false,
    bedrooms: 1,
    bathrooms: 1,
    area_sqft: 280,
    floor_number: 2,
    total_floors: 4,
    furnishing: 'fully-furnished',
    address: 'House 891, Sector 34-B',
    locality: 'Sector 34',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160034',
    amenities: ['Power Backup', 'Security', 'WiFi'],
    status: 'active',
  },

  // Priya's listings (index 1)
  {
    agentIndex: 1,
    title: '4 BHK Builder Floor — Panchkula Sector 20',
    description: 'Spacious builder floor with separate entrance. Modern kitchen, large drawing room, two balconies. Excellent connectivity to Chandigarh and Zirakpur.',
    property_type: 'house',
    listing_type: 'sale',
    price: 9800000,
    price_negotiable: true,
    bedrooms: 4,
    bathrooms: 3,
    area_sqft: 2100,
    floor_number: 1,
    total_floors: 3,
    furnishing: 'semi-furnished',
    facing: 'West',
    address: 'House 234, Sector 20',
    locality: 'Sector 20',
    city: 'Panchkula',
    state: 'Haryana',
    pincode: '134116',
    amenities: ['Parking', 'Power Backup', 'Security', 'Garden'],
    status: 'active',
  },
  {
    agentIndex: 1,
    title: '3 BHK Flat for Rent — Zirakpur Airport Road',
    description: 'Brand new unfurnished flat in premium society. Swimming pool, gym, kids play area. 15 min to Chandigarh Airport. Ideal for families.',
    property_type: 'apartment',
    listing_type: 'rent',
    price: 22000,
    price_negotiable: true,
    bedrooms: 3,
    bathrooms: 2,
    area_sqft: 1250,
    floor_number: 5,
    total_floors: 14,
    furnishing: 'unfurnished',
    facing: 'North',
    address: 'Tower C, Maple Heights, Airport Road',
    locality: 'Airport Road',
    city: 'Zirakpur',
    state: 'Punjab',
    pincode: '140603',
    amenities: ['Lift', 'Parking', 'Swimming Pool', 'Gym', 'Power Backup', 'Security', 'CCTV', 'Children Play Area'],
    status: 'active',
  },
  {
    agentIndex: 1,
    title: 'Office Space — IT Park, Mohali Phase 8',
    description: '2400 sqft plug-and-play office space. False ceiling, air conditioning, server room, reception area. 200 Mbps leased line. Ideal for IT/ITES companies.',
    property_type: 'commercial',
    listing_type: 'rent',
    price: 95000,
    price_negotiable: true,
    area_sqft: 2400,
    floor_number: 4,
    total_floors: 8,
    address: 'Plot 22-B, IT Park, Phase 8',
    locality: 'IT Park',
    city: 'Mohali',
    state: 'Punjab',
    pincode: '160055',
    amenities: ['Lift', 'Parking', 'Power Backup', 'Security', 'CCTV', 'Fire Safety'],
    status: 'active',
  },
  {
    agentIndex: 1,
    title: '2 BHK Apartment — New Chandigarh Mullanpur',
    description: 'Affordable new possession flat in upcoming township. Metro connectivity coming soon. Great investment opportunity.',
    property_type: 'apartment',
    listing_type: 'sale',
    price: 4200000,
    price_negotiable: false,
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 870,
    floor_number: 8,
    total_floors: 18,
    furnishing: 'unfurnished',
    address: 'Green Valley Apartments, Mullanpur',
    locality: 'Mullanpur',
    city: 'New Chandigarh',
    state: 'Punjab',
    pincode: '140901',
    amenities: ['Lift', 'Parking', 'Power Backup', 'Security', 'Gym'],
    status: 'active',
  },
  {
    agentIndex: 1,
    title: '500 Sq Yd Commercial Plot — Mohali Phase 11',
    description: 'Corner commercial plot on 60 ft road. Best for showroom, hotel or hospital. All clearances done. Freehold property.',
    property_type: 'plot',
    listing_type: 'sale',
    price: 28000000,
    price_negotiable: true,
    area_sqft: 4500,
    address: 'Plot 78, Phase 11',
    locality: 'Phase 11',
    city: 'Mohali',
    state: 'Punjab',
    pincode: '160055',
    amenities: [],
    status: 'active',
  },
  {
    agentIndex: 1,
    title: '3 BHK Villa — Panchkula Sector 5 (SOLD)',
    description: 'Beautiful corner villa. Recently sold. Kept for portfolio reference.',
    property_type: 'villa',
    listing_type: 'sale',
    price: 18500000,
    price_negotiable: false,
    bedrooms: 3,
    bathrooms: 3,
    area_sqft: 2800,
    address: 'House 12, Sector 5',
    locality: 'Sector 5',
    city: 'Panchkula',
    state: 'Haryana',
    pincode: '134109',
    amenities: ['Parking', 'Garden', 'Security'],
    status: 'sold',
  },
];

const DEVICE_TYPES = ['mobile', 'mobile', 'mobile', 'tablet', 'desktop'];
const CITIES = ['Chandigarh', 'Mohali', 'Panchkula', 'Delhi', 'Mumbai', 'Bengaluru'];

// ── HELPERS ───────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(randomInt(8, 22), randomInt(0, 59));
  return d.toISOString();
}

// ── MAIN SEED ─────────────────────────────────────────────────────────────────

async function seed() {
  const client = await pool.connect();

  try {
    console.log('🌱 Starting seed...\n');
    await client.query('BEGIN');

    // ── Clear existing seed data ──────────────────────────────────────────────
    console.log('🗑  Clearing existing seed data...');
    await client.query(`DELETE FROM users WHERE email LIKE '%@qrestate.dev'`);
    console.log('   ✓ Cleared\n');

    // ── Create agents ─────────────────────────────────────────────────────────
    console.log('👤 Creating agents...');
    const agentIds = [];

    for (const agent of AGENTS) {
      const hash = await bcrypt.hash(agent.password, 10);
      const res = await client.query(
        `INSERT INTO users (name, email, password_hash, phone, rera_number, role, is_active, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,true,true) RETURNING id`,
        [agent.name, agent.email, hash, agent.phone, agent.rera_number, agent.role]
      );
      agentIds.push(res.rows[0].id);
      console.log(`   ✓ ${agent.name} (${agent.email})`);
    }
    console.log();

    // ── Create listings ───────────────────────────────────────────────────────
    console.log('🏠 Creating listings...');
    const listingIds = [];

    for (const listing of LISTINGS) {
      const shortCode = nanoid(8);
      const agentId = agentIds[listing.agentIndex];
      const viewCount = randomInt(10, 180);

      const res = await client.query(
        `INSERT INTO listings (
          agent_id, title, description, property_type, listing_type,
          price, price_negotiable, bedrooms, bathrooms, area_sqft,
          floor_number, total_floors, furnishing, facing,
          address, locality, city, state, pincode,
          amenities, status, short_code, view_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        RETURNING id, short_code`,
        [
          agentId, listing.title, listing.description || null,
          listing.property_type, listing.listing_type,
          listing.price, listing.price_negotiable,
          listing.bedrooms || null, listing.bathrooms || null, listing.area_sqft || null,
          listing.floor_number != null ? listing.floor_number : null,
          listing.total_floors || null, listing.furnishing || null, listing.facing || null,
          listing.address, listing.locality || null, listing.city, listing.state, listing.pincode || null,
          listing.amenities, listing.status, shortCode, viewCount,
        ]
      );

      const { id, short_code } = res.rows[0];
      listingIds.push({ id, short_code, agentId, status: listing.status, title: listing.title });
      console.log(`   ✓ ${listing.title.substring(0, 55)}...`);
    }
    console.log();

    // ── Create QR codes ───────────────────────────────────────────────────────
    console.log('📱 Creating QR codes...');
    const qrIds = [];

    for (const listing of listingIds) {
      // Skip sold listings for QR
      if (listing.status === 'sold') continue;

      const res = await client.query(
        `INSERT INTO qr_codes (
          listing_id, agent_id, short_code,
          style, foreground_color, background_color,
          include_frame, frame_label,
          target_url, scan_count, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING id`,
        [
          listing.id, listing.agentId, listing.short_code,
          'standard', '#000000', '#FFFFFF',
          false, 'Scan to View Property',
          `http://localhost:5000/q/${listing.short_code}`,
          0, true,
        ]
      );

      qrIds.push({ id: res.rows[0].id, listingId: listing.id, shortCode: listing.short_code });
      console.log(`   ✓ QR for: ${listing.title.substring(0, 45)}...`);
    }
    console.log();

    // ── Create scan history ───────────────────────────────────────────────────
    console.log('📊 Generating scan history (30 days)...');
    let totalScans = 0;

    for (const qr of qrIds) {
      // Each QR gets 10–35 scans spread over 30 days
      const scanCount = randomInt(10, 35);

      for (let i = 0; i < scanCount; i++) {
        const daysBack = randomInt(0, 29);
        const deviceType = randomItem(DEVICE_TYPES);
        const city = randomItem(CITIES);

        await client.query(
          `INSERT INTO qr_scans (qr_code_id, listing_id, device_type, city, country, scanned_at)
           VALUES ($1,$2,$3,$4,'India',$5)`,
          [qr.id, qr.listingId, deviceType, city, daysAgo(daysBack)]
        );
        totalScans++;
      }

      // Update scan_count on qr_codes
      await client.query(
        'UPDATE qr_codes SET scan_count = (SELECT COUNT(*) FROM qr_scans WHERE qr_code_id = $1) WHERE id = $1',
        [qr.id]
      );

      // Update view_count on listings
      await client.query(
        'UPDATE listings SET view_count = view_count + (SELECT COUNT(*) FROM qr_scans WHERE listing_id = $1) WHERE id = $1',
        [qr.listingId]
      );
    }

    console.log(`   ✓ ${totalScans} scans created across ${qrIds.length} QR codes\n`);

    await client.query('COMMIT');

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('━'.repeat(55));
    console.log('✅ SEED COMPLETE\n');
    console.log('Login with either account:');
    console.log('  📧 rajesh@qrestate.dev   🔑 Test@1234  (6 listings)');
    console.log('  📧 priya@qrestate.dev    🔑 Test@1234  (6 listings)');
    console.log();
    console.log(`  🏠 ${LISTINGS.length} listings created`);
    console.log(`  📱 ${qrIds.length} QR codes created`);
    console.log(`  📊 ${totalScans} scan events created`);
    console.log('━'.repeat(55));

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
// This file is append-safe — run npm run db:seed to re-seed
