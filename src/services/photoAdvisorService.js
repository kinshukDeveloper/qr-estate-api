const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F14 — AI Photo Enhancement Advisor
 *
 * Sends each property image to GPT-4o Vision.
 * Returns structured feedback: score, issues, suggestions.
 * Results cached in photo_advisor_reports table.
 */

const PHOTO_SYSTEM_PROMPT = `You are a professional real estate photography expert in India.
Analyse the property photograph and respond ONLY with valid JSON (no markdown, no explanation).

Return this exact structure:
{
  "overall_score": <integer 0-100>,
  "issues": [
    {
      "issue": "<short issue name>",
      "severity": "high|medium|low",
      "suggestion": "<1 sentence fix>"
    }
  ],
  "ai_feedback": "<2-3 sentence professional summary of photo quality and most important improvement>"
}

Score guide: 90-100=professional, 70-89=good, 50-69=acceptable, 30-49=needs work, 0-29=poor.
Common issues: poor lighting, cluttered space, wide-angle distortion, low resolution, bad angle,
reflections in mirrors/glass, personal items visible, dirty/unmade, exterior obstructions,
overexposed/underexposed, no natural light, awkward crop.`;

/**
 * Analyse a single image URL using GPT-4o Vision.
 * Returns { overall_score, issues, ai_feedback }
 */
async function analysePhoto(imageUrl) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      overall_score: 65,
      issues: [{ issue: 'API key missing', severity: 'low', suggestion: 'Set OPENAI_API_KEY to enable AI photo analysis.' }],
      ai_feedback: 'AI photo analysis requires OPENAI_API_KEY to be configured.',
    };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 600,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PHOTO_SYSTEM_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Vision error: ${err}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '{}';

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return {
      overall_score: 50,
      issues: [],
      ai_feedback: raw.slice(0, 300),
    };
  }
}

/**
 * Analyse all photos for a listing. Skips already-analysed images.
 */
async function analyseListingPhotos(listingId, agentId, forceRefresh = false) {
  // Get listing images
  const listingRes = await pool.query(
    `SELECT images, agent_id FROM listings WHERE id=$1`, [listingId]
  );
  if (!listingRes.rows.length) throw new Error('Listing not found');
  if (listingRes.rows[0].agent_id !== agentId) throw new Error('Forbidden');

  const images = listingRes.rows[0].images || [];
  if (!images.length) return { reports: [], message: 'No images on this listing' };

  const reports = [];
  for (const img of images.slice(0, 10)) {
    if (!img.url) continue;

    // Check cache
    if (!forceRefresh) {
      const existing = await pool.query(
        `SELECT * FROM photo_advisor_reports WHERE listing_id=$1 AND image_url=$2`, [listingId, img.url]
      );
      if (existing.rows.length) { reports.push(existing.rows[0]); continue; }
    }

    try {
      const analysis = await analysePhoto(img.url);
      const saved = await pool.query(
        `INSERT INTO photo_advisor_reports (listing_id, agent_id, image_url, overall_score, issues, ai_feedback)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [listingId, agentId, img.url, analysis.overall_score, JSON.stringify(analysis.issues), analysis.ai_feedback]
      );
      if (saved.rows.length) reports.push(saved.rows[0]);
    } catch (err) {
      logger.error(`[PhotoAdvisor] Failed for ${img.url}: ${err.message}`);
    }
  }

  // Compute listing-level summary
  if (reports.length) {
    const avgScore = Math.round(reports.reduce((s, r) => s + (r.overall_score || 0), 0) / reports.length);
    const allIssues = reports.flatMap((r) => (typeof r.issues === 'string' ? JSON.parse(r.issues) : r.issues) || []);
    const highPriority = allIssues.filter((i) => i.severity === 'high').length;

    return {
      reports,
      summary: {
        avg_score: avgScore,
        photos_analysed: reports.length,
        high_priority_issues: highPriority,
        grade: avgScore >= 80 ? 'Excellent' : avgScore >= 65 ? 'Good' : avgScore >= 50 ? 'Fair' : 'Poor',
      },
    };
  }

  return { reports, summary: null };
}

module.exports = { analysePhoto, analyseListingPhotos };
