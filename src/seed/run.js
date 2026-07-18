// Standalone seeder: `npm run seed` (or `npm run seed:force` to wipe first).
import { connectDB, disconnectDB } from '../config/db.js';
import { runSeed } from './index.js';
import { logger } from '../utils/logger.js';

const force = process.argv.includes('--force');
(async () => {
  await connectDB();
  await runSeed({ force });
  await disconnectDB();
  process.exit(0);
})().catch((e) => { logger.error(`Seed failed: ${e.message}`); process.exit(1); });
