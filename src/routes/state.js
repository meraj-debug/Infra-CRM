import { Router } from 'express';
import { State } from '../models/State.js';
import { logActivity } from '../models/Activity.js';
import { workspaceGuard } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();
router.use(workspaceGuard);

const ws = (req) => (req.get('x-workspace') || 'default').trim() || 'default';

// GET /api/state/:key  -> { data, rev, updatedAt }
// Returns data:null (200, not 404) when nothing is stored yet, so the frontend
// can fall back to its local seed() exactly like it did with IndexedDB.
router.get('/:key', asyncHandler(async (req, res) => {
  const doc = await State.findOne({ workspace: ws(req), key: req.params.key }).lean();
  res.set('Cache-Control', 'no-store');
  res.json({
    data: doc ? doc.value : null,
    rev: doc ? doc.rev : 0,
    updatedAt: doc ? doc.updatedAt : null,
  });
}));

// PUT /api/state/:key  { data }  -> upsert the whole snapshot.
router.put('/:key', asyncHandler(async (req, res) => {
  const payload = Object.prototype.hasOwnProperty.call(req.body, 'data') ? req.body.data : req.body;

  const doc = await State.findOneAndUpdate(
    { workspace: ws(req), key: req.params.key },
    {
      $set: { value: payload, updatedByName: req.body.by || req.user?.fullName || '' },
      $inc: { rev: 1 },
      $setOnInsert: { workspace: ws(req), key: req.params.key },
    },
    { new: true, upsert: true }
  ).lean();

  res.json({ ok: true, rev: doc.rev, updatedAt: doc.updatedAt });
}));

// DELETE /api/state/:key -> used by "Clear stored data" in Setup → Data & storage.
router.delete('/:key', asyncHandler(async (req, res) => {
  await State.findOneAndUpdate(
    { workspace: ws(req), key: req.params.key },
    { $set: { value: null }, $inc: { rev: 1 } },
    { upsert: true }
  );
  await logActivity({ type: 'API_EVENT', detail: { event: 'state_cleared', key: req.params.key } });
  res.json({ ok: true });
}));

export default router;
