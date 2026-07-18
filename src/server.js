import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { logger } from './utils/logger.js';
import { logActivity } from './models/Activity.js';
import { runSeed } from './seed/index.js';
import app from './app.js';

// --- Boot + graceful shutdown ---
let server;
(async () => {
  await connectDB();
  if (env.SEED_ON_BOOT) {
    try { await runSeed(); } catch (e) { logger.error(`Seed on boot failed: ${e.message}`); }
  }
  server = app.listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (${env.NODE_ENV})`));
})().catch((err) => { logger.error(`Fatal boot error: ${err.message}`); process.exit(1); });

async function shutdown(signal) {
  logger.warn(`${signal} received \u2014 shutting down gracefully`);
  try { await logActivity({ type: 'API_EVENT', detail: { event: 'shutdown', signal } }); } catch {}
  if (server) await new Promise((r) => server.close(r));
  await disconnectDB();
  process.exit(0);
}
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));
process.on('unhandledRejection', (r) => logger.error(`Unhandled rejection: ${r}`));

export default app;
