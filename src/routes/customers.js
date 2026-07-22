import { Router } from 'express';
import { Customer } from '../models/Customer.js';
import { logActivity } from '../models/Activity.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { customerScopeFilter, canSeeCustomer } from '../utils/scope.js';

const router = Router();
router.use(requireAuth);

/* Fields the client may never set directly. `id` is assigned on create and
   immutable thereafter; the trails have their own append endpoint so a whole
   -array overwrite can't silently drop somebody else's note. */
const PROTECTED = new Set(['_id', 'id', '__v', 'createdAt', 'updatedAt',
  'activities', 'notes', 'comms', 'audit', 'chatter']);

const clean = (body) => {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) if (!PROTECTED.has(k)) out[k] = v;
  return out;
};

// GET /api/customers?q=&stage=&owner=&limit=&page=
// Scoped to what the caller may see — the filtering the frontend does for
// presentation is enforced here, so an unscoped fetch can't leak other teams.
router.get('/', asyncHandler(async (req, res) => {
  const scope = await customerScopeFilter(req.user);
  const and = scope ? [scope] : [];

  if (req.query.stage) and.push({ stage: req.query.stage });
  if (req.query.owner) and.push({ owner: req.query.owner });
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [{ name: rx }, { mobile: rx }, { email: rx }, { projectMRC: rx }] });
  }

  const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const filter = and.length ? { $and: and } : {};

  const [data, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Customer.countDocuments(filter),
  ]);

  res.json({ data, total, page, limit });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const cust = await Customer.findOne({ id: req.params.id }).lean();
  if (!cust) return res.status(404).json({ error: 'Customer not found' });
  if (!(await canSeeCustomer(req.user, cust))) {
    // 404, not 403 — a 403 would confirm the record exists to someone who
    // isn't allowed to know that.
    return res.status(404).json({ error: 'Customer not found' });
  }
  res.json({ data: cust });
}));

// POST /api/customers — the client supplies its own `id` (uid('c')), which
// keeps ID generation where the rest of the CRM's references are minted.
router.post('/', asyncHandler(async (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !String(name || '').trim()) {
    return res.status(400).json({ error: 'id and name are required' });
  }

  const doc = {
    ...clean(req.body),
    id: String(id),
    name: String(name).trim(),
    owner: req.body.owner || req.user.fullName,
    createdBy: req.user.fullName,
    lastModifiedBy: req.user.fullName,
    activities: req.body.activities || [],
    notes: req.body.notes || [],
    comms: req.body.comms || [],
    audit: req.body.audit || [],
    chatter: req.body.chatter || [],
  };

  try {
    const created = await Customer.create(doc);
    await logActivity({
      type: 'CUSTOMER_CREATED', actor: req.user.id, actorName: req.user.fullName,
      entity: 'customer', entityId: created._id, detail: { id: created.id },
    });
    return res.status(201).json({ data: created });
  } catch (e) {
    if (e.code === 11000) {
      // Idempotent re-send (offline replay) — return the existing row.
      const existing = await Customer.findOne({ id: String(id) }).lean();
      return res.status(200).json({ data: existing, duplicate: true });
    }
    throw e;
  }
}));

// PATCH /api/customers/:id — partial, field-level update.
//
// This is the point of the whole migration: two people editing two different
// customers now touch two different documents and never collide, and two people
// editing different FIELDS of the same customer both land. Only the fields
// actually sent are written.
router.patch('/:id', asyncHandler(async (req, res) => {
  const cust = await Customer.findOne({ id: req.params.id }).lean();
  if (!cust) return res.status(404).json({ error: 'Customer not found' });
  if (!(await canSeeCustomer(req.user, cust))) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const patch = clean(req.body);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No updatable fields supplied' });

  const changes = [];
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(cust[k]) !== JSON.stringify(v)) changes.push({ field: k, old: cust[k], new: v });
  }
  if (!changes.length) return res.json({ data: cust, unchanged: true });

  // Atomic $set + $push rather than doc.save().
  //
  // save() sends the whole document guarded by Mongoose's __v, so two people
  // editing DIFFERENT fields of the same customer at the same time make the
  // second save throw a VersionError and lose its edit — precisely the
  // overwrite this migration exists to stop. $set touches only the named
  // fields and $push appends without rewriting the array, so both land.
  const updated = await Customer.findOneAndUpdate(
    { id: req.params.id },
    {
      $set: { ...patch, lastModifiedBy: req.user.fullName },
      $push: {
        audit: {
          $each: changes.map((c) => ({
            field: c.field, old: c.old, new: c.new,
            by: req.user.fullName, at: new Date().toISOString(),
          })),
        },
      },
    },
    { new: true }
  ).lean();
  if (!updated) return res.status(404).json({ error: 'Customer not found' });
  const cust2 = updated;

  await logActivity({
    type: 'CUSTOMER_UPDATED', actor: req.user.id, actorName: req.user.fullName,
    entity: 'customer', entityId: cust2._id,
    detail: { id: cust2.id, fields: changes.map((c) => c.field) },
  });

  res.json({ data: cust2, changed: changes.map((c) => c.field) });
}));

// DELETE /api/customers/:id — remove a customer (scoped, so you can only delete
// what you're allowed to see). Ids are unique, so this removes exactly one row.
router.delete('/:id', asyncHandler(async (req, res) => {
  const cust = await Customer.findOne({ id: req.params.id }).lean();
  if (!cust) return res.status(404).json({ error: 'Customer not found' });
  if (!(await canSeeCustomer(req.user, cust))) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  await Customer.deleteOne({ id: req.params.id });
  await logActivity({
    type: 'CUSTOMER_DELETED', actor: req.user.id, actorName: req.user.fullName,
    entity: 'customer', entityId: cust._id, detail: { id: cust.id, name: cust.name },
  });
  res.json({ ok: true, id: req.params.id });
}));

// POST /api/customers/:id/:trail — append to notes/activities/comms/chatter.
// $push, so concurrent appends from different users all survive.
const TRAILS = new Set(['notes', 'activities', 'comms', 'chatter']);
router.post('/:id/:trail', asyncHandler(async (req, res) => {
  const { trail } = req.params;
  if (!TRAILS.has(trail)) return res.status(404).json({ error: 'Unknown sub-resource' });

  const cust = await Customer.findOne({ id: req.params.id }).lean();
  if (!cust) return res.status(404).json({ error: 'Customer not found' });
  if (!(await canSeeCustomer(req.user, cust))) return res.status(404).json({ error: 'Customer not found' });

  const entry = { ...(req.body || {}), by: req.body?.by || req.user.fullName, at: req.body?.at || new Date().toISOString() };
  const updated = await Customer.findOneAndUpdate(
    { id: req.params.id },
    { $push: { [trail]: { $each: [entry], $position: 0 } }, $set: { lastModifiedBy: req.user.fullName } },
    { new: true }
  ).lean();

  res.status(201).json({ data: updated[trail], entry });
}));

export default router;
