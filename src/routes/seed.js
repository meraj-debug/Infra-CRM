import { Router } from 'express';
import { runSeed } from '../seed/index.js';
import { workspaceGuard } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

// POST /api/seed          -> idempotent top-up of the demo data
// POST /api/seed?force=1  -> wipe and re-seed (destructive)
router.post('/', workspaceGuard, asyncHandler(async (req, res) => {
  const force = req.query.force === '1' || req.query.force === 'true';
  const report = await runSeed({ force });
  res.json({ ok: true, force, report });
}));

export default router;
