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

// PUT /api/state/:key  { data, baseRev? }  -> upsert the whole snapshot.
//
// Optimistic concurrency: when the client sends the `rev` it last read as
// `baseRev`, the write only lands if the stored rev still matches. Otherwise
// somebody else saved in the meantime and this whole-snapshot PUT would
// silently erase their work, so we refuse with 409 and let the client decide.
//
// `baseRev` is optional — a client that omits it gets the old last-write-wins
// behaviour, so older tabs keep working during a rollout.
router.put('/:key', asyncHandler(async (req, res) => {
  const payload = Object.prototype.hasOwnProperty.call(req.body, 'data') ? req.body.data : req.body;
  const by = req.body.by || req.user?.fullName || '';
  const filter = { workspace: ws(req), key: req.params.key };
  const update = { $set: { value: payload, updatedByName: by }, $inc: { rev: 1 } };

  const hasBase = req.body.baseRev !== undefined && req.body.baseRev !== null;
  if (!hasBase) {
    const doc = await State.findOneAndUpdate(
      filter,
      { ...update, $setOnInsert: filter },
      { new: true, upsert: true }
    ).lean();
    return res.json({ ok: true, rev: doc.rev, updatedAt: doc.updatedAt });
  }

  const baseRev = Number(req.body.baseRev);
  if (!Number.isFinite(baseRev) || baseRev < 0) {
    return res.status(400).json({ error: 'baseRev must be a non-negative number' });
  }

  // Guarded update: rev is part of the filter, so the check and the write are
  // one atomic operation — no read-then-write race between two savers.
  const doc = await State.findOneAndUpdate({ ...filter, rev: baseRev }, update, { new: true }).lean();
  if (doc) return res.json({ ok: true, rev: doc.rev, updatedAt: doc.updatedAt });

  // No match: either a genuine conflict, or nothing is stored yet.
  const current = await State.findOne(filter).lean();
  if (!current) {
    if (baseRev !== 0) {
      return res.status(409).json({ error: 'No stored state — reload before saving.', rev: 0 });
    }
    try {
      const created = await State.create({ ...filter, value: payload, updatedByName: by, rev: 1 });
      return res.json({ ok: true, rev: created.rev, updatedAt: created.updatedAt });
    } catch (e) {
      if (e.code !== 11000) throw e;
      // Another saver inserted first — that is a conflict like any other.
      const raced = await State.findOne(filter).lean();
      return res.status(409).json({
        error: 'Someone else saved first.',
        rev: raced?.rev ?? 0, updatedByName: raced?.updatedByName || '', updatedAt: raced?.updatedAt || null,
      });
    }
  }

  return res.status(409).json({
    error: 'This snapshot changed since you loaded it.',
    rev: current.rev,
    updatedByName: current.updatedByName || '',
    updatedAt: current.updatedAt,
  });
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
