import { Router } from 'express';
import { Deal, DEAL_STAGES } from '../models/Deal.js';
import { User } from '../models/User.js';
import { logActivity } from '../models/Activity.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(requireAuth);

// GET /api/deals — list (owner-scoped list logic would go here).
router.get('/', asyncHandler(async (req, res) => {
  const deals = await Deal.find().populate('rm teamLeader', 'fullName').lean();
  res.json({ data: deals });
}));

// POST /api/deals — the DEDICATED "Create Deal" action.
// Validates required fields, auto-resolves the Team Leader from the RM,
// creates + assigns the deal, and records the activity. This is the ONLY
// endpoint that creates a deal.
router.post('/', asyncHandler(async (req, res) => {
  const { customerId, name, rmId } = req.body;
  if (!customerId || !name || !rmId) {
    return res.status(400).json({ error: 'customerId, name and rmId are required' });
  }

  const rm = await User.findById(rmId);
  if (!rm) return res.status(400).json({ error: 'Relationship Manager not found' });

  // Team Leader is derived from the DB mapping (RM's manager), never client-supplied.
  if (!rm.manager) {
    return res.status(422).json({
      error: `No Team Leader is mapped to ${rm.fullName}. Set their reporting manager before creating a deal.`,
    });
  }

  const deal = await Deal.create({
    customer: customerId,
    name: name.trim(),
    rm: rm._id,
    teamLeader: rm.manager,
    createdBy: req.user.id,
    ...pickSalesFields(req.body),
  });

  await logActivity({ type: 'DEAL_CREATED', actor: req.user.id, actorName: req.user.fullName, entity: 'deal', entityId: deal._id });
  await logActivity({ type: 'RM_ASSIGNED', actor: req.user.id, entity: 'deal', entityId: deal._id, detail: { rm: rm._id } });
  await logActivity({ type: 'TEAM_LEADER_ASSIGNED', actor: req.user.id, entity: 'deal', entityId: deal._id, detail: { teamLeader: rm.manager } });

  res.status(201).json({ data: deal });
}));

// PATCH /api/deals/:id/stage — stage management ONLY. Never creates a deal.
router.patch('/:id/stage', asyncHandler(async (req, res) => {
  const { stage } = req.body;
  if (!DEAL_STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${DEAL_STAGES.join(', ')}` });
  }
  const deal = await Deal.findById(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const old = deal.stage;
  deal.stage = stage;
  await deal.save();
  await logActivity({ type: 'STAGE_CHANGED', actor: req.user.id, actorName: req.user.fullName, entity: 'deal', entityId: deal._id, detail: { field: 'stage', old, new: stage } });

  res.json({ data: deal });
}));

function pickSalesFields(b) {
  const { projectSales, budgetSales, citySales, localitySales } = b;
  return { projectSales, budgetSales, citySales, localitySales };
}

export default router;
