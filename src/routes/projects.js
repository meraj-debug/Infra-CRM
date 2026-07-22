import { Router } from 'express';
import { Project } from '../models/Project.js';
import { logActivity } from '../models/Activity.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

/**
 * Projects — shared reference data (inventory, plans, collateral, FB form maps).
 * Everyone signed in can see them all, so there is no per-user scoping here.
 *
 * Keyed by the unique `name`: deals (`projectSales`) and customers (`projectMRC`)
 * reference a project BY NAME, so name is the real join key and the URL param.
 * Renaming is therefore refused — it would orphan every reference at once.
 */

const router = Router();
router.use(requireAuth);

const PROTECTED = new Set(['_id', '__v', 'createdAt', 'updatedAt']);
const clean = (body) => {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) if (!PROTECTED.has(k)) out[k] = v;
  return out;
};

// GET /api/projects
router.get('/', asyncHandler(async (req, res) => {
  const data = await Project.find({}).sort({ name: 1 }).lean();
  res.json({ data });
}));

// POST /api/projects  { name, ... }
router.post('/', asyncHandler(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const doc = await Project.create({ ...clean(req.body), name, lastModifiedBy: req.user.fullName });
    await logActivity({
      type: 'PROJECT_CREATED', actor: req.user.id, actorName: req.user.fullName,
      entity: 'project', entityId: doc._id, detail: { name },
    });
    return res.status(201).json({ data: doc });
  } catch (e) {
    if (e.code === 11000) {
      // Same name already exists — idempotent replay, return the existing row.
      const existing = await Project.findOne({ name }).lean();
      return res.status(200).json({ data: existing, duplicate: true });
    }
    throw e;
  }
}));

// PATCH /api/projects/:name — partial update (arrays like configs/plans/images
// are sent whole; they're edited in the UI, not append-only).
router.patch('/:name', asyncHandler(async (req, res) => {
  const patch = clean(req.body);
  delete patch.name; // renaming would orphan every deal/customer reference
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No updatable fields supplied' });

  const updated = await Project.findOneAndUpdate(
    { name: req.params.name },
    { $set: { ...patch, lastModifiedBy: req.user.fullName } },
    { new: true }
  ).lean();
  if (!updated) return res.status(404).json({ error: 'Project not found' });
  res.json({ data: updated });
}));

// DELETE /api/projects/:name
router.delete('/:name', asyncHandler(async (req, res) => {
  const r = await Project.deleteOne({ name: req.params.name });
  if (!r.deletedCount) return res.status(404).json({ error: 'Project not found' });
  await logActivity({
    type: 'PROJECT_DELETED', actor: req.user.id, actorName: req.user.fullName,
    detail: { name: req.params.name },
  });
  res.json({ ok: true, name: req.params.name });
}));

export default router;
