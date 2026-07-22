// One-off cleanup: remove broken / duplicate customer rows the collection
// accumulated before the /api/customers migration settled.
//
//   node scripts/dedupe-customers.js            # dry run (reports only)
//   node scripts/dedupe-customers.js --write     # actually delete
//
// Rules (safest first):
//   1. delete rows with no `id`                       (broken — can't be keyed)
//   2. keep the NEWEST row per `id`, delete the rest  (exact-id duplicates)
//   3. keep the NEWEST row per `mobile`, delete rest   (same person, re-created
//                                                       under a different id)
// "Newest" = latest createdAt, falling back to the ObjectId timestamp.

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Customer } from '../src/models/Customer.js';

const WRITE = process.argv.includes('--write');

const ts = (d) => {
  const t = d.createdAt ? new Date(d.createdAt).getTime() : 0;
  return t || d._id.getTimestamp().getTime();
};

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const all = await Customer.find({}).lean();
  console.log(`Loaded ${all.length} customer rows.`);

  const toDelete = new Set();

  // 1. no id
  for (const c of all) if (!c.id) toDelete.add(String(c._id));
  console.log(`  rows with no id           : ${[...toDelete].length}`);

  // 2. duplicate id — keep newest
  const byId = new Map();
  for (const c of all) {
    if (!c.id || toDelete.has(String(c._id))) continue;
    const cur = byId.get(c.id);
    if (!cur || ts(c) > ts(cur)) byId.set(c.id, c);
  }
  let dupId = 0;
  for (const c of all) {
    if (!c.id || toDelete.has(String(c._id))) continue;
    if (byId.get(c.id)._id.toString() !== String(c._id)) { toDelete.add(String(c._id)); dupId++; }
  }
  console.log(`  duplicate-id rows          : ${dupId}`);

  // 3. duplicate mobile — keep newest of the survivors
  const survivors = all.filter((c) => !toDelete.has(String(c._id)));
  const byMob = new Map();
  for (const c of survivors) {
    if (!c.mobile) continue;
    const cur = byMob.get(c.mobile);
    if (!cur || ts(c) > ts(cur)) byMob.set(c.mobile, c);
  }
  let dupMob = 0;
  for (const c of survivors) {
    if (!c.mobile) continue;
    if (byMob.get(c.mobile)._id.toString() !== String(c._id)) { toDelete.add(String(c._id)); dupMob++; }
  }
  console.log(`  duplicate-mobile rows      : ${dupMob}`);

  const ids = [...toDelete];
  console.log(`\nWould delete ${ids.length} rows; ${all.length - ids.length} would remain.`);

  if (!WRITE) {
    console.log('\nDry run — pass --write to apply.');
  } else {
    const res = await Customer.deleteMany({ _id: { $in: ids.map((s) => new mongoose.Types.ObjectId(s)) } });
    console.log(`\nDeleted ${res.deletedCount} rows.`);
    const remaining = await Customer.countDocuments();
    console.log(`Remaining: ${remaining}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
