import { Router } from 'express';
import { dbHealthy } from '../config/db.js';

const router = Router();

// Liveness + DB health check (Render uses this for health monitoring).
router.get('/', (req, res) => {
  const db = dbHealthy();
  res.status(db ? 200 : 503).json({
    status: db ? 'ok' : 'degraded',
    db: db ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    ts: new Date().toISOString(),
  });
});

export default router;
