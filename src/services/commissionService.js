/**
 * F07 — Commission Calculator Service
 * Calculates: agent commission, stamp duty (state-wise), registration,
 * GST 18% on commission, TDS 1% if >50L.
 * Pure computation — no DB needed.
 */

/** Stamp duty % by state (approximate 2025 rates) */
const STAMP_DUTY = {
  'maharashtra':       { male: 6, female: 5, joint: 5.5 },
  'delhi':             { male: 6, female: 4, joint: 5 },
  'karnataka':         { male: 5.6, female: 5.6, joint: 5.6 },
  'tamil_nadu':        { male: 7, female: 7, joint: 7 },
  'gujarat':           { male: 4.9, female: 4.9, joint: 4.9 },
  'rajasthan':         { male: 6, female: 5, joint: 5.5 },
  'uttar_pradesh':     { male: 7, female: 7, joint: 7 },
  'haryana':           { male: 7, female: 5, joint: 6 },
  'punjab':            { male: 6, female: 4, joint: 5 },
  'telangana':         { male: 5, female: 5, joint: 5 },
  'andhra_pradesh':    { male: 5, female: 5, joint: 5 },
  'west_bengal':       { male: 6, female: 6, joint: 6 },
  'madhya_pradesh':    { male: 7.5, female: 7.5, joint: 7.5 },
  'kerala':            { male: 8, female: 8, joint: 8 },
  'himachal_pradesh':  { male: 5, female: 4, joint: 4.5 },
  'uttarakhand':       { male: 5, female: 3.75, joint: 4.375 },
  'jharkhand':         { male: 6, female: 4, joint: 5 },
  'odisha':            { male: 5, female: 4, joint: 4.5 },
  'chhattisgarh':      { male: 5, female: 4, joint: 4.5 },
  'bihar':             { male: 6, female: 5.7, joint: 5.85 },
  'assam':             { male: 8.25, female: 8.25, joint: 8.25 },
  'chandigarh':        { male: 6, female: 4, joint: 5 },
  'goa':               { male: 3.5, female: 3.5, joint: 3.5 },
  'tripura':           { male: 5, female: 5, joint: 5 },
  'meghalaya':         { male: 9.9, female: 9.9, joint: 9.9 },
  'manipur':           { male: 7, female: 7, joint: 7 },
  'nagaland':          { male: 8, female: 8, joint: 8 },
  'sikkim':            { male: 4, female: 4, joint: 4 },
};

/** Registration charge % (flat rate — typically 1%) */
const REGISTRATION_RATE = 1;

/** Agent commission tiers */
const COMMISSION_TIERS = [
  { upTo: 2000000,   rate: 2 },    // up to 20L → 2%
  { upTo: 5000000,   rate: 1.75 }, // 20-50L → 1.75%
  { upTo: 10000000,  rate: 1.5 },  // 50L-1Cr → 1.5%
  { upTo: 50000000,  rate: 1.25 }, // 1Cr-5Cr → 1.25%
  { upTo: Infinity,  rate: 1 },    // 5Cr+ → 1%
];

function getCommissionRate(price) {
  return COMMISSION_TIERS.find((t) => price <= t.upTo)?.rate ?? 1;
}

/**
 * Main calculation function.
 * @param {object} params
 * @param {number} params.price - Sale price in INR
 * @param {string} params.state - State slug (e.g. 'maharashtra')
 * @param {'male'|'female'|'joint'} params.buyerGender
 * @param {number} params.customCommissionRate - Override commission % (optional)
 * @param {boolean} params.isRent - If true, skip stamp duty, show rental commission
 */
function calculate({ price, state, buyerGender = 'male', customCommissionRate = null, isRent = false }) {
  const p = Number(price);
  if (!p || p <= 0) throw new Error('Invalid price');

  const result = { price: p };

  if (isRent) {
    // Rental: 1 month commission is standard in India
    const commissionRate = customCommissionRate ?? 8.33; // ~1 month = 8.33% of annual
    const commission = (p * commissionRate) / 100;
    const gst = commission * 0.18;
    return {
      price: p,
      listing_type: 'rent',
      commission: { rate: commissionRate, amount: commission, gst, total: commission + gst },
      breakdown: [
        { label: 'Monthly Rent', amount: p },
        { label: `Agent Commission (${commissionRate}%)`, amount: commission },
        { label: 'GST on Commission (18%)', amount: gst },
        { label: 'Total Agent Fee', amount: commission + gst, highlight: true },
      ],
    };
  }

  // Commission
  const commissionRate = customCommissionRate ?? getCommissionRate(p);
  const commission = (p * commissionRate) / 100;
  const gst = commission * 0.18;
  const commissionTotal = commission + gst;

  // TDS (1% if sale > 50L, deducted by buyer)
  const tdsApplicable = p > 5000000;
  const tds = tdsApplicable ? p * 0.01 : 0;

  // Stamp duty
  const stateKey = state?.toLowerCase().replace(/ /g, '_') || 'maharashtra';
  const stampRates = STAMP_DUTY[stateKey] || STAMP_DUTY['maharashtra'];
  const stampRate = stampRates[buyerGender] ?? stampRates.male;
  const stampDuty = (p * stampRate) / 100;

  // Registration
  const registration = (p * REGISTRATION_RATE) / 100;

  // Totals
  const totalBuyerCost = p + stampDuty + registration + tds;
  const agentReceives = commissionTotal;

  return {
    price: p,
    listing_type: 'sale',
    state: stateKey,
    buyer_gender: buyerGender,
    commission: {
      rate: commissionRate,
      amount: commission,
      gst,
      total: commissionTotal,
    },
    stamp_duty: {
      rate: stampRate,
      amount: stampDuty,
    },
    registration: {
      rate: REGISTRATION_RATE,
      amount: registration,
    },
    tds: {
      applicable: tdsApplicable,
      rate: tdsApplicable ? 1 : 0,
      amount: tds,
    },
    totals: {
      buyer_total_cost: totalBuyerCost,
      agent_receives: agentReceives,
    },
    breakdown: [
      { label: 'Property Price', amount: p },
      { label: `Stamp Duty (${stampRate}%)`, amount: stampDuty },
      { label: `Registration (${REGISTRATION_RATE}%)`, amount: registration },
      ...(tdsApplicable ? [{ label: 'TDS Deducted (1%)', amount: -tds }] : []),
      { label: 'Total Cost to Buyer', amount: totalBuyerCost, highlight: true },
      { label: `Agent Commission (${commissionRate}%)`, amount: commission },
      { label: 'GST on Commission (18%)', amount: gst },
      { label: 'Agent Receives', amount: commissionTotal, highlight: true },
    ],
  };
}

function getAvailableStates() {
  return Object.keys(STAMP_DUTY).map((key) => ({
    value: key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  }));
}

module.exports = { calculate, getAvailableStates };
