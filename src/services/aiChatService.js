const { pool } = require('../config/database');
const logger = require('../config/logger');

/**
 * F15 — AI Property Chat Widget
 *
 * Each chat session is tied to a listing.
 * The AI knows the full listing details and answers buyer questions.
 * When the AI can't answer or buyer asks for callback → lead capture triggered.
 * All conversations stored in ai_chat_sessions.
 */

function buildSystemPrompt(listing) {
  const price = listing.price >= 10000000
    ? `₹${(listing.price / 10000000).toFixed(2)}Cr`
    : listing.price >= 100000
    ? `₹${(listing.price / 100000).toFixed(1)}L`
    : `₹${listing.price.toLocaleString('en-IN')}`;

  return `You are a helpful real estate assistant for the property: "${listing.title}".

PROPERTY DETAILS:
- Price: ${price} (${listing.listing_type === 'rent' ? 'monthly rent' : 'sale price'})
- Type: ${listing.property_type} | ${listing.bedrooms ? listing.bedrooms + ' BHK' : ''} | ${listing.area_sqft ? listing.area_sqft + ' sqft' : ''}
- Location: ${listing.locality ? listing.locality + ', ' : ''}${listing.city}, ${listing.state}
- Floor: ${listing.floor_number || 'N/A'} / ${listing.total_floors || 'N/A'}
- Furnishing: ${listing.furnishing || 'Not specified'}
- Facing: ${listing.facing || 'Not specified'}
- Agent: ${listing.agent_name} (RERA: ${listing.agent_rera || 'N/A'})
- Amenities: ${(listing.amenities || []).join(', ') || 'Not listed'}
- Status: ${listing.status}
${listing.description ? `- Description: ${listing.description}` : ''}

RULES:
1. Answer ONLY questions about this property. For general real estate advice, keep it brief.
2. Be concise, friendly, and professional. Use Indian rupee formatting.
3. If asked about exact location/map/GPS — say the agent will share on request.
4. If asked about loan, say an EMI calculator is available on this page.
5. If you cannot answer something important (legal issues, exact neighbours, society specifics) → say "I'll connect you with the agent for this" and set "lead_capture": true in your response.
6. If the buyer asks to schedule a visit or call the agent → set "lead_capture": true.
7. ALWAYS respond in JSON: { "message": "<your response>", "lead_capture": <true|false> }`;
}

/**
 * Get or create a chat session.
 */
async function getOrCreateSession(listingId, sessionToken) {
  let session = await pool.query(
    `SELECT * FROM ai_chat_sessions WHERE listing_id=$1 AND session_token=$2`,
    [listingId, sessionToken]
  );
  if (session.rows.length) return session.rows[0];

  const res = await pool.query(
    `INSERT INTO ai_chat_sessions (listing_id, session_token, messages)
     VALUES ($1,$2,'[]') RETURNING *`,
    [listingId, sessionToken]
  );
  return res.rows[0];
}

/**
 * Send a message and get AI response.
 */
async function chat(listingId, sessionToken, userMessage) {
  if (!userMessage?.trim()) throw new Error('Empty message');

  // Get listing details
  const listingRes = await pool.query(
    `SELECT l.*, u.name AS agent_name, u.rera_number AS agent_rera
     FROM listings l JOIN users u ON u.id=l.agent_id
     WHERE l.id=$1`, [listingId]
  );
  if (!listingRes.rows.length) throw new Error('Listing not found');
  const listing = listingRes.rows[0];

  const session = await getOrCreateSession(listingId, sessionToken);
  const history = typeof session.messages === 'string' ? JSON.parse(session.messages) : session.messages;

  // Build messages for OpenAI
  const openaiMessages = [
    { role: 'system', content: buildSystemPrompt(listing) },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  let assistantMessage = "I'd be happy to connect you with the agent for more details!";
  let leadCapture = false;

  if (process.env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 400, temperature: 0.4, messages: openaiMessages }),
      });
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content?.trim() || '{}';
      try {
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        assistantMessage = parsed.message || assistantMessage;
        leadCapture = !!parsed.lead_capture;
      } catch {
        assistantMessage = raw;
      }
    } catch (err) {
      logger.warn(`[AIChat] OpenAI error: ${err.message}`);
    }
  } else {
    // Fallback rule-based responses
    const q = userMessage.toLowerCase();
    if (q.includes('price') || q.includes('cost') || q.includes('rate')) {
      const price = listing.price >= 10000000
        ? `₹${(listing.price / 10000000).toFixed(2)} Crore`
        : `₹${(listing.price / 100000).toFixed(1)} Lakh`;
      assistantMessage = `The property is listed at ${price}${listing.price_negotiable ? ' (price is negotiable)' : ''}. Would you like to schedule a site visit?`;
    } else if (q.includes('visit') || q.includes('schedule') || q.includes('see') || q.includes('call')) {
      assistantMessage = "I'll connect you with the agent to arrange a visit!";
      leadCapture = true;
    } else if (q.includes('location') || q.includes('area') || q.includes('where')) {
      assistantMessage = `The property is located in ${listing.locality ? listing.locality + ', ' : ''}${listing.city}, ${listing.state}.`;
    } else if (q.includes('bhk') || q.includes('bedroom') || q.includes('room')) {
      assistantMessage = `This is a ${listing.bedrooms || '?'}BHK ${listing.property_type} with ${listing.bathrooms || '?'} bathrooms and ${listing.area_sqft || '?'} sqft.`;
    } else {
      assistantMessage = "Great question! Let me connect you with the agent who can answer this in detail.";
      leadCapture = true;
    }
  }

  // Append to history
  const newHistory = [
    ...history,
    { role: 'user', content: userMessage, ts: new Date().toISOString() },
    { role: 'assistant', content: assistantMessage, ts: new Date().toISOString() },
  ].slice(-40); // keep last 40 messages

  await pool.query(
    `UPDATE ai_chat_sessions SET messages=$1, updated_at=now() WHERE id=$2`,
    [JSON.stringify(newHistory), session.id]
  );

  return {
    sessionId: session.id,
    message: assistantMessage,
    leadCapture,
    historyLength: newHistory.length,
  };
}

/**
 * Capture lead from chat session.
 */
async function captureLeadFromChat(sessionId, { name, phone, email }) {
  const session = await pool.query(`SELECT * FROM ai_chat_sessions WHERE id=$1`, [sessionId]);
  if (!session.rows.length) throw new Error('Session not found');
  const s = session.rows[0];

  // Create lead
  if (s.listing_id) {
    const listingRes = await pool.query(`SELECT agent_id FROM listings WHERE id=$1`, [s.listing_id]);
    if (listingRes.rows.length) {
      await pool.query(
        `INSERT INTO leads (listing_id, agent_id, name, phone, email, source, status, notes)
         VALUES ($1,$2,$3,$4,$5,'ai_chat','new','Lead captured via AI chat widget')
         ON CONFLICT DO NOTHING`,
        [s.listing_id, listingRes.rows[0].agent_id, name, phone, email || null]
      );
    }
  }

  await pool.query(
    `UPDATE ai_chat_sessions SET lead_captured=true, lead_name=$1, lead_phone=$2, lead_email=$3, updated_at=now() WHERE id=$4`,
    [name, phone, email || null, sessionId]
  );

  return { captured: true };
}

/**
 * Get full chat history for a session.
 */
async function getHistory(listingId, sessionToken) {
  const res = await pool.query(
    `SELECT messages, lead_captured FROM ai_chat_sessions WHERE listing_id=$1 AND session_token=$2`,
    [listingId, sessionToken]
  );
  if (!res.rows.length) return { messages: [], lead_captured: false };
  const msgs = typeof res.rows[0].messages === 'string'
    ? JSON.parse(res.rows[0].messages)
    : res.rows[0].messages;
  return { messages: msgs, lead_captured: res.rows[0].lead_captured };
}

module.exports = { chat, captureLeadFromChat, getHistory };
