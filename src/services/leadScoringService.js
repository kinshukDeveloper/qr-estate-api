const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F13 — Smart Lead Scoring
 *
 * Score = scan_count×5 + dwell_minutes×2 + callback_requested×20
 *       + message_quality×15 + follow_up_responded×10 + listing_saves×8
 *
 * Grade: HOT ≥70 | WARM 40–69 | COLD <40
 *
 * Scores are recalculated on every lead action (scan, message, callback, etc.)
 * and stored in lead_scores for dashboard display.
 */

const WEIGHTS = {
  scan_count:          5,
  dwell_minutes:       2,
  callback_requested: 20,
  message_quality:    15,
  follow_up_responded: 10,
  listing_saves:       8,
};

const MAX_SCORE = 100;

function gradeFromScore(score) {
  if (score >= 70) return 'HOT';
  if (score >= 40) return 'WARM';
  return 'COLD';
}

/**
 * Calculate and upsert score for a single lead.
 */
async function scoreLeadById(leadId) {
  const leadRes = await pool.query(
    `SELECT
        l.id, l.name, l.phone, l.message,
        l.listing_id, l.status, l.created_at,
        -- Scan count for this lead's listing
        COALESCE((
          SELECT COUNT(*) FROM qr_codes qc
          JOIN listings li ON li.id = qc.listing_id
          WHERE li.id = l.listing_id
        ), 0) AS scan_count,
        -- How many times this buyer saved the listing
        COALESCE((
          SELECT COUNT(*) FROM saved_listings sl
          WHERE sl.listing_id = l.listing_id
            AND (sl.buyer_email = l.email OR sl.session_token IS NOT NULL)
        ), 0) AS listing_saves,
        -- Follow-up responded: lead status changed to 'interested' or 'converted'
        CASE WHEN l.status IN ('interested', 'converted') THEN true ELSE false END AS follow_up_responded,
        -- Callback: has any follow-up sequence been manually triggered
        CASE WHEN l.status IN ('contacted', 'interested', 'converted') THEN true ELSE false END AS callback_requested
     FROM leads l
     WHERE l.id = $1`,
    [leadId]
  );
  if (!leadRes.rows.length) throw new Error('Lead not found');
  const lead = leadRes.rows[0];

  // Message quality via GPT (quick scoring, no GPT call if message is short)
  let messageQualityScore = 0;
  if (lead.message && lead.message.length > 20) {
    messageQualityScore = await scoreMessageQuality(lead.message);
  }

  // Compute raw score
  const breakdown = {
    scan_count:          Math.min(parseInt(lead.scan_count), 10) * WEIGHTS.scan_count,
    dwell_minutes:       0,  // not tracked yet — placeholder
    callback_requested:  lead.callback_requested ? WEIGHTS.callback_requested : 0,
    message_quality:     messageQualityScore,
    follow_up_responded: lead.follow_up_responded ? WEIGHTS.follow_up_responded : 0,
    listing_saves:       Math.min(parseInt(lead.listing_saves), 3) * WEIGHTS.listing_saves,
  };

  const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.min(Math.round(rawScore), MAX_SCORE);
  const grade = gradeFromScore(score);

  // Upsert
  await pool.query(
    `INSERT INTO lead_scores
       (lead_id, score, grade, scan_count, callback_requested, message_quality_score,
        follow_up_responded, listing_saves, score_breakdown, last_scored_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (lead_id) DO UPDATE SET
       score = EXCLUDED.score,
       grade = EXCLUDED.grade,
       scan_count = EXCLUDED.scan_count,
       callback_requested = EXCLUDED.callback_requested,
       message_quality_score = EXCLUDED.message_quality_score,
       follow_up_responded = EXCLUDED.follow_up_responded,
       listing_saves = EXCLUDED.listing_saves,
       score_breakdown = EXCLUDED.score_breakdown,
       last_scored_at = now()`,
    [leadId, score, grade,
     parseInt(lead.scan_count), lead.callback_requested,
     messageQualityScore, lead.follow_up_responded,
     parseInt(lead.listing_saves), JSON.stringify(breakdown)]
  );

  return { leadId, score, grade, breakdown };
}

/**
 * Score all leads for an agent (batch).
 */
async function scoreAllLeadsForAgent(agentId) {
  const leadsRes = await pool.query(
    `SELECT id FROM leads WHERE agent_id=$1`, [agentId]
  );
  let scored = 0, failed = 0;
  for (const lead of leadsRes.rows) {
    try { await scoreLeadById(lead.id); scored++; }
    catch (err) { logger.warn(`[LeadScore] Failed ${lead.id}: ${err.message}`); failed++; }
  }
  return { scored, failed };
}

/**
 * Score all leads globally (cron).
 */
async function scoreAllLeads() {
  const leadsRes = await pool.query(
    `SELECT l.id FROM leads l
     LEFT JOIN lead_scores ls ON ls.lead_id = l.id
     WHERE ls.last_scored_at IS NULL
        OR ls.last_scored_at < now() - INTERVAL '6 hours'
     LIMIT 500`
  );
  logger.info(`[LeadScore] Scoring ${leadsRes.rows.length} leads...`);
  let scored = 0, failed = 0;
  for (const lead of leadsRes.rows) {
    try { await scoreLeadById(lead.id); scored++; }
    catch { failed++; }
  }
  return { scored, failed };
}

/**
 * GPT message quality scoring (0–20).
 * Quick call: score the buyer's message for seriousness.
 */
async function scoreMessageQuality(message) {
  if (!process.env.OPENAI_API_KEY) {
    // Heuristic: length + keywords
    const keywords = ['interested', 'budget', 'visit', 'buy', 'purchase', 'family', 'urgent', 'loan', 'serious'];
    const matches = keywords.filter((k) => message.toLowerCase().includes(k)).length;
    return Math.min(matches * 4, 20);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini', max_tokens: 10, temperature: 0,
        messages: [{
          role: 'user',
          content: `Rate this real estate buyer enquiry message for seriousness and intent to purchase, on a scale of 0-20. Respond with ONLY an integer.\n\nMessage: "${message}"`
        }]
      }),
    });
    const data = await res.json();
    const raw = parseInt(data.choices?.[0]?.message?.content?.trim(), 10);
    return isNaN(raw) ? 0 : Math.min(Math.max(raw, 0), 20);
  } catch {
    return 0;
  }
}

/**
 * Get lead scores for dashboard with lead details.
 */
async function getLeadScores(agentId, { grade, page = 1, limit = 20 } = {}) {
  const conditions = [`l.agent_id = $1`];
  const params = [agentId];
  let idx = 2;
  if (grade) { conditions.push(`ls.grade = $${idx++}`); params.push(grade); }
  const offset = (page - 1) * limit;
  const res = await pool.query(
    `SELECT
        l.id, l.name, l.phone, l.email, l.status, l.source, l.created_at, l.listing_id,
        li.title AS listing_title,
        ls.score, ls.grade, ls.score_breakdown, ls.last_scored_at,
        COALESCE(ls.score, 0) AS sort_score
     FROM leads l
     LEFT JOIN lead_scores ls ON ls.lead_id = l.id
     LEFT JOIN listings li ON li.id = l.listing_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sort_score DESC, l.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM leads l LEFT JOIN lead_scores ls ON ls.lead_id=l.id WHERE ${conditions.join(' AND ')}`,
    params
  );
  return {
    leads: res.rows,
    pagination: { total: parseInt(countRes.rows[0].count), page, limit, pages: Math.ceil(countRes.rows[0].count / limit) },
  };
}

/**
 * Get score summary counts for an agent (HOT/WARM/COLD totals).
 */
async function getScoreSummary(agentId) {
  const res = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN ls.grade='HOT'  THEN 1 ELSE 0 END), 0) AS hot,
        COALESCE(SUM(CASE WHEN ls.grade='WARM' THEN 1 ELSE 0 END), 0) AS warm,
        COALESCE(SUM(CASE WHEN ls.grade='COLD' THEN 1 ELSE 0 END), 0) AS cold,
        COALESCE(SUM(CASE WHEN ls.grade IS NULL THEN 1 ELSE 0 END), 0) AS unscored,
        COUNT(l.id) AS total
     FROM leads l
     LEFT JOIN lead_scores ls ON ls.lead_id = l.id
     WHERE l.agent_id = $1`,
    [agentId]
  );
  return res.rows[0];
}

module.exports = { scoreLeadById, scoreAllLeads, scoreAllLeadsForAgent, getLeadScores, getScoreSummary };
