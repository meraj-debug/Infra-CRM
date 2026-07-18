/**
 * Customer dual-write mirror.
 *
 * Loads the REAL sync code out of the frontend's index.html (the "4b · CUSTOMERS
 * — DUAL-WRITE" section) and runs it against the real API on an in-memory Mongo.
 * Extracting the source rather than re-implementing it means this exercises the
 * shipped algorithm — if someone edits that block, this test sees the edit.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(here, '../../../project/index.html');

const mem = await MongoMemoryServer.create();
process.env.MONGODB_URI = mem.getUri();
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.SEED_ON_BOOT = 'false';
process.env.CORS_ORIGINS = '*';

const { default: app } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Customer } = await import('../src/models/Customer.js');
await mongoose.connect(process.env.MONGODB_URI);

await User.create({
  username: 'rm', fullName: 'Abhishek Sagar', profile: 'Sales Executive (RM)',
  city: 'All', passwordHash: await bcrypt.hash('p', 8),
});

const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const token = (await (await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'rm', password: 'p' }),
})).json()).token;

// --- pull the dual-write block straight out of the shipped HTML --------------
const html = fs.readFileSync(INDEX, 'utf8');
const start = html.indexOf('const CUST_TRAILS');
const end = html.indexOf('window.V7_custSyncAll');
if (start < 0 || end < 0) {
  console.log('FAIL  could not locate the dual-write block in index.html');
  process.exit(1);
}
const source = html.slice(start, html.indexOf('};', end) + 2);

// --- minimal environment the block expects -----------------------------------
const DB = { customers: [] };
let apiCalls = 0;
const sandbox = {
  DB, console,
  V7_online: true,
  V6_TOKEN_KEY: 'tok',
  toast: () => {},
  encodeURIComponent,
  JSON, Promise, Map, Set, Object, Array, String,
  localStorage: { getItem: () => JSON.stringify({ jwt: token }) },
  window: {},
  V7_api(pathname, opts) {
    apiCalls++;
    return fetch(base + pathname, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    }).then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(body.error || 'HTTP ' + r.status); e.status = r.status; e.body = body; throw e; }
      return body;
    });
  },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

let fail = 0;
const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
const sync = () => vm.runInContext('V7_custSync()', sandbox);
const baseline = () => vm.runInContext('V7_custBaseline()', sandbox);

// 1. A brand-new customer is created.
DB.customers.push({ id: 'c100', name: 'Ravi Kumar', owner: 'Abhishek Sagar', stage: 'New', notes: [], activities: [], comms: [], chatter: [], audit: [] });
await sync();
let row = await Customer.findOne({ id: 'c100' }).lean();
check('new customer mirrored', !!row && row.name === 'Ravi Kumar');

// 2. A no-op save sends nothing.
const before = apiCalls;
await sync();
check('unchanged customer causes no API traffic', apiCalls === before, `${apiCalls - before} calls`);

// 3. A field edit becomes a PATCH of only that field.
DB.customers[0].stage = 'Working';
await sync();
row = await Customer.findOne({ id: 'c100' }).lean();
check('field edit mirrored', row.stage === 'Working');
check('audit written server-side', (row.audit || []).length === 1, `${(row.audit || []).length} entries`);

// 4. Trails append in the right order (frontend unshifts newest to the front).
DB.customers[0].notes.unshift({ text: 'first' });
await sync();
DB.customers[0].notes.unshift({ text: 'second' });
await sync();
row = await Customer.findOne({ id: 'c100' }).lean();
check('both notes mirrored', row.notes.length === 2, `${row.notes.length}`);
check('newest note is first, order preserved', row.notes[0].text === 'second' && row.notes[1].text === 'first',
  row.notes.map((n) => n.text).join(','));

// 5. Two notes added between saves both go over.
DB.customers[0].notes.unshift({ text: 'third' });
DB.customers[0].notes.unshift({ text: 'fourth' });
await sync();
row = await Customer.findOne({ id: 'c100' }).lean();
check('batched trail appends all mirrored', row.notes.length === 4, `${row.notes.length}`);
check('batched order preserved', row.notes.map((n) => n.text).join(',') === 'fourth,third,second,first',
  row.notes.map((n) => n.text).join(','));

// 6. The baseline stops a page load from re-POSTing everything.
baseline();
const beforeBaseline = apiCalls;
await sync();
check('baseline suppresses redundant re-sync', apiCalls === beforeBaseline, `${apiCalls - beforeBaseline} calls`);

// 7. A record the API rejects is baselined, not retried forever.
DB.customers.push({ id: 'c101', name: '', owner: 'Abhishek Sagar', notes: [], activities: [], comms: [], chatter: [], audit: [] });
await sync();
const afterReject = apiCalls;
await sync();
check('permanently-rejected record is not retried', apiCalls === afterReject, `${apiCalls - afterReject} extra calls`);

// 8. A transient failure IS retried on the next save.
DB.customers.push({ id: 'c102', name: 'Retry Me', owner: 'Abhishek Sagar', notes: [], activities: [], comms: [], chatter: [], audit: [] });
sandbox.V7_api = () => Promise.reject(Object.assign(new Error('network down'), { status: undefined }));
await sync();
check('transient failure leaves record unsynced', !(await Customer.findOne({ id: 'c102' })));
check('drift counter reports it', vm.runInContext('V7_custDrift', sandbox) === 1, String(vm.runInContext('V7_custDrift', sandbox)));
sandbox.V7_api = sandbox.V7_api; // restore below
vm.runInContext('void 0', sandbox);
sandbox.V7_api = (pathname, opts) => fetch(base + pathname, {
  ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
}).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.error || 'HTTP ' + r.status); e.status = r.status; e.body = body; throw e; }
  return body;
});
await sync();
check('retried successfully on the next save', !!(await Customer.findOne({ id: 'c102' })));

// 9. Never mirrors without a JWT (offline sign-in).
sandbox.localStorage = { getItem: () => JSON.stringify({ u: 'rm' }) };   // no jwt
DB.customers.push({ id: 'c103', name: 'No Token', owner: 'Abhishek Sagar', notes: [], activities: [], comms: [], chatter: [], audit: [] });
const beforeNoJwt = apiCalls;
await sync();
check('no JWT -> no mirroring attempted', apiCalls === beforeNoJwt && !(await Customer.findOne({ id: 'c103' })));

// 10. The per-cycle cap holds.
sandbox.localStorage = { getItem: () => JSON.stringify({ jwt: token }) };
for (let i = 0; i < 40; i++) {
  DB.customers.push({ id: 'b' + i, name: 'Bulk ' + i, owner: 'Abhishek Sagar', notes: [], activities: [], comms: [], chatter: [], audit: [] });
}
// Count every record synced this cycle, not just the bulk ones: c103 is still
// pending from the no-JWT case above and legitimately claims one of the slots.
const totalBefore = await Customer.countDocuments();
await sync();
const synced = (await Customer.countDocuments()) - totalBefore;
check('sync is capped at 25 records per cycle', synced === 25, `${synced} synced in one cycle`);
await sync();
await sync();
check('remainder goes out on later cycles', (await Customer.countDocuments({ name: /^Bulk / })) === 40,
  String(await Customer.countDocuments({ name: /^Bulk / })));

console.log(fail ? `\n${fail} FAILING` : '\nAll cases pass.');
server.close();
await mongoose.disconnect();
await mem.stop();
process.exit(fail ? 1 : 0);
