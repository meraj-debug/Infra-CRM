import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { notFound, errorHandler } from './middleware/error.js';

import healthRoutes from './routes/health.js';
import dealRoutes from './routes/deals.js';
import customerRoutes from './routes/customers.js';
import userRoutes from './routes/users.js';
import stateRoutes from './routes/state.js';
import authRoutes from './routes/auth.js';
import seedRoutes from './routes/seed.js';

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });

const app = express();
app.set('trust proxy', 1);

/* ---------------------------------------------------------------------------
   CORS — registered FIRST so preflights never fall through to another handler.
   Allows: any origin listed in CORS_ORIGINS, plus same-origin/tooling requests
   that send no Origin header at all (curl, health checks). "*" opens it up.
--------------------------------------------------------------------------- */
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (env.CORS_ORIGINS.includes('*') || env.CORS_ORIGINS.includes(origin)) return cb(null, true);
    logger.warn(`CORS blocked origin: ${origin}`);
    // cb(null, false) -> no CORS headers, but still a clean 4xx instead of a 500.
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-workspace-key', 'x-workspace'],
  exposedHeaders: ['Content-Length'],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// --- Security & performance middleware ---
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: env.JSON_LIMIT }));   // snapshots carry photos — see JSON_LIMIT
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting. State writes are chatty (one per debounced render), so they
// get their own generous bucket instead of sharing the default /api budget.
app.use('/api/state', rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 240, standardHeaders: true, legacyHeaders: false }));

// --- Routes ---
app.get('/', (req, res) => res.json({
  name: 'Inframantra CRM API',
  status: 'ok',
  endpoints: ['/health', '/api/auth/login', '/api/state/:key', '/api/customers', '/api/deals', '/api/seed'],
}));
app.use('/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/state', stateRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/users', userRoutes);
app.use('/api/seed', seedRoutes);

// --- 404 + error handling ---
app.use(notFound);
if (env.SENTRY_DSN && Sentry.setupExpressErrorHandler) Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

export default app;
