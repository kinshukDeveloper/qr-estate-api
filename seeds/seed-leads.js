/**
 * Leads seed — run AFTER main seed.js
 * Run: node backend/seeds/seed-leads.js
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const NAMES = [
  'Amit Verma', 'Sunita Patel', 'Rohit Sharma', 'Kavita Singh',
  'Manish Gupta', 'Pooja Mehta', 'Vikram Nair', 'Anita Reddy',
  'Deepak Joshi', 'Neha Bansal', 'Suresh Kumar', 'Ritu Aggarwal',
  'Aakash Malhotra', 'Divya Kapoor', 'Harpreet Kaur', 'Sanjay Rao',
];

const MESSAGES = [
  'Interested in viewing the property this weekend.',
  'What is the final price? Can we negotiate?',
  'Is the society pet-friendly?',
  'Is parking included in the price?',
  'Can I get a virtual tour?',
  'How old is the building? Any maintenance issues?',
  'Is the flat available for immediate possession?',
  'What are the monthly maintenance charges?',
  null, null, // some without message
];

const STATUSES = ['new', 'new', 'new', 'contacted', 'interested', 'not_interested', 'converted'];
const SOURCES = ['whatsapp', 'whatsapp', 'call', 'manual', 'qr_scan'];

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomPhone() { return `9${randomInt(100000000, 999999999)}`; }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

async function seedLeads() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding leads...\n');
    await client.query('BEGIN');

    // Get all listings with their agents
    const listingsRes = await client.query(
      `SELECT l.id, l.agent_id, l.title FROM listings l
       WHERE l.status = 'active' ORDER BY l.created_at`
    );
    const listings = listingsRes.rows;

    if (!listings.length) {
      console.log('❌ No listings found. Run seed.js first.');
      return;
    }

    // Clear existing seeded leads
    await client.query(`DELETE FROM leads WHERE notes LIKE '%[seeded]%'`);

    let total = 0;

    for (const listing of listings) {
      // 3–8 leads per listing
      const count = randomInt(3, 8);

      for (let i = 0; i < count; i++) {
        const daysBack = randomInt(0, 29);
        const status = randomItem(STATUSES);
        const followUpDate = ['contacted', 'interested'].includes(status)
          ? new Date(Date.now() + randomInt(1, 7) * 86400000).toISOString()
          : null;

        await client.query(
          `INSERT INTO leads (
             agent_id, listing_id, name, phone, email, message,
             source, status, notes, follow_up_date, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
          [
            listing.agent_id,
            listing.id,
            randomItem(NAMES),
            randomPhone(),
            Math.random() > 0.5 ? `${randomItem(NAMES).split(' ')[0].toLowerCase()}${randomInt(10, 99)}@gmail.com` : null,
            randomItem(MESSAGES),
            randomItem(SOURCES),
            status,
            '[seeded] Auto-generated test lead',
            followUpDate,
            daysAgo(daysBack),
          ]
        );
        total++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ ${total} leads seeded across ${listings.length} listings`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Lead seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedLeads();
