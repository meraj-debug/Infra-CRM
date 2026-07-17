import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';

import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { logger } from './utils/logger.js';
import { notFound, errorHandler } from './middleware/error.js';
import { logActivity } from './models/Activity.js';

import healthRoutes from './routes/health.js';
import dealRoutes from './routes/deals.js';

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });

const app = express();
app.set('trust proxy', 1);

// --- Security & performance middleware ---
app.use(helmet());                       // security headers
app.use(compression());                  // gzip responses
app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: (origin, cb) => (!origin || env.CORS_ORIGINS.includes(origin))
    ? cb(null, true)
    : cb(new Error(`Origin ${origin} not allowed by CORS`)),
  credentials: true,
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev')); // request logging
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));          // basic rate limiting

// --- Routes ---
app.use('/health', healthRoutes);
app.use('/api/deals', dealRoutes);

// --- 404 + error handling (proper HTTP status codes) ---
app.use(notFound);
if (env.SENTRY_DSN && Sentry.setupExpressErrorHandler) Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

// --- Boot + graceful shutdown ---
let server;
(async () => {
  await connectDB();
  server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (${env.NODE_ENV})`));
})().catch((err) => { logger.error(`Fatal boot error: ${err.message}`); process.exit(1); });

async function shutdown(signal) {
  logger.warn(`${signal} received — shutting down gracefully`);
  try { await logActivity({ type: 'API_EVENT', detail: { event: 'shutdown', signal } }); } catch {}
  if (server) await new Promise((r) => server.close(r));
  await disconnectDB();
  process.exit(0);
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));
process.on('unhandledRejection', (r) => logger.error(`Unhandled rejection: ${r}`));

export default app;
