/**
 * Copy customers out of the snapshot blob into the `customers` collection.
 *
 *   node src/scripts/backfill-customers.js            # dry run, prints a report
 *   node src/scripts/backfill-customers.js --write     # actually write
 *   node src/scripts/backfill-customers.js --write --workspace acme
 *
 * NON-DESTRUCTIVE BY DESIGN. It never edits or deletes the snapshot, so the UI
 * keeps working off the blob while the collection fills up behind it. Re-runs
 * are safe: rows are upserted on the CRM's own `id`, so running it twice does
 * not duplicate, and a customer already in the collection is left alone unless
 * --overwrite says otherwise.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { State } from '../models/State.js';
import { Customer } from '../models/Customer.js';
import { logActivity } from '../models/Activity.js';
import { logger } from '../utils/logger.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const WRITE = flag('write');
const OVERWRITE = flag('overwrite');
const WORKSPACE = opt('workspace', 'default');
const KEY = opt('key', 'db');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const snap = await State.findOne({ workspace: WORKSPACE, key: KEY }).lean();
  if (!snap || !snap.value) {
    logger.error(`No snapshot at workspace="${WORKSPACE}" key="${KEY}". Nothing to migrate.`);
    return { read: 0 };
  }

  const rows = Array.isArray(snap.value.customers) ? snap.value.customers : [];
  logger.info(`Snapshot rev ${snap.rev} holds ${rows.length} customer(s).`);

  const existing = new Set(
    (await Customer.find({}, 'id').lean()).map((c) => c.id)
  );

  const report = { read: rows.length, created: 0, updated: 0, skipped: 0, invalid: [] };
  const ops = [];
  const seen = new Set();

  for (const r of rows) {
    if (!r || !r.id || !String(r.name || '').trim()) {
      report.invalid.push(r?.id || '(no id)');
      continue;
    }
    if (seen.has(r.id)) {          // duplicate ids inside the blob itself
      report.invalid.push(`${r.id} (duplicate in snapshot)`);
      continue;
    }
    seen.add(r.id);

    if (existing.has(r.id) && !OVERWRITE) { report.skipped++; continue; }
    existing.has(r.id) ? report.updated++ : report.created++;

    // Preserve the snapshot's own timestamps rather than stamping "now" —
    // otherwise every migrated lead looks like it was created today and the
    // aging/funnel reports become nonsense.
    const { _id, __v, ...rest } = r;
    const doc = { ...rest, id: String(r.id), name: String(r.name).trim() };
    if (r.createdAt) doc.createdAt = new Date(r.createdAt);
    if (r.updatedAt) doc.updatedAt = new Date(r.updatedAt);

    ops.push({
      updateOne: {
        filter: { id: doc.id },
        update: OVERWRITE ? { $set: doc } : { $setOnInsert: doc },
        upsert: true,
      },
    });
  }

  if (!WRITE) {
    logger.warn('DRY RUN — nothing written. Re-run with --write to apply.');
  } else if (ops.length) {
    // timestamps:false — otherwise Mongoose stamps createdAt/updatedAt with
    // "now" on insert and overwrites the dates carried in from the snapshot,
    // making every migrated lead look like it arrived today.
    const res = await Customer.bulkWrite(ops, { ordered: false, timestamps: false });
    logger.info(`bulkWrite: ${res.upsertedCount} upserted, ${res.modifiedCount} modified.`);
    await logActivity({
      type: 'CUSTOMER_MIGRATED', actorName: 'backfill-script',
      detail: { workspace: WORKSPACE, snapshotRev: snap.rev, ...report, invalid: report.invalid.length },
    });
  }

  console.log('\n--- backfill report ---');
  console.log(`  in snapshot : ${report.read}`);
  console.log(`  to create   : ${report.created}`);
  console.log(`  to update   : ${report.updated}${OVERWRITE ? '' : ' (needs --overwrite)'}`);
  console.log(`  skipped     : ${report.skipped} (already present)`);
  console.log(`  invalid     : ${report.invalid.length}${report.invalid.length ? ' -> ' + report.invalid.slice(0, 10).join(', ') : ''}`);
  console.log(`  mode        : ${WRITE ? 'WRITE' : 'dry run'}${OVERWRITE ? ' +overwrite' : ''}\n`);

  // Verification the operator can trust: count what actually landed.
  if (WRITE) {
    const total = await Customer.countDocuments();
    console.log(`  collection now holds ${total} customer(s).\n`);
  }
  return report;
}

main()
  .catch((e) => { logger.error(`Backfill failed: ${e.message}`); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); });
