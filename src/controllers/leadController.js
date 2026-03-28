const leadService = require('../services/leadService');

async function create(req, res) {
  const lead = await leadService.createLead(req.user.id, req.body);
  res.status(201).json({ success: true, message: 'Lead created', data: { lead } });
}

async function getAll(req, res) {
  const result = await leadService.getLeads(req.user.id, req.query);
  res.json({ success: true, data: result });
}

async function getOne(req, res) {
  const lead = await leadService.getLead(req.params.id, req.user.id);
  res.json({ success: true, data: { lead } });
}

async function update(req, res) {
  const lead = await leadService.updateLead(req.params.id, req.user.id, req.body);
  res.json({ success: true, message: 'Lead updated', data: { lead } });
}

async function remove(req, res) {
  await leadService.deleteLead(req.params.id, req.user.id);
  res.json({ success: true, message: 'Lead deleted' });
}

async function getStats(req, res) {
  const stats = await leadService.getLeadStats(req.user.id);
  res.json({ success: true, data: { stats } });
}

// Public: buyer submits enquiry from property page
async function capturePublic(req, res) {
  const { shortCode } = req.params;
  const lead = await leadService.capturePublicLead(shortCode, req.body);
  res.status(201).json({ success: true, message: 'Enquiry received', data: { lead_id: lead.id } });
}

module.exports = { create, getAll, getOne, update, remove, getStats, capturePublic };
