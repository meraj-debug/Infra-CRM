/**
 * Customers migration: scoping, concurrent edits, and the snapshot backfill.
 *
 *   npm test
 *
 * Runs against a real in-memory MongoDB (mongodb-memory-server) and the real
 * app, so the index/atomicity behaviour under test is the actual behaviour.
 * Imports src/app.js, never src/server.js, so nothing touches a live database.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { execFile } from 'node:child_process';

const mem = await MongoMemoryServer.create();
process.env.MONGODB_URI = mem.getUri();
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.SEED_ON_BOOT = 'false';
process.env.CORS_ORIGINS = '*';

const { default: app } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Customer } = await import('../src/models/Customer.js');
const { State } = await import('../src/models/State.js');
const { Activity } = await import('../src/models/Activity.js');
await mongoose.connect(process.env.MONGODB_URI);

const pw = await bcrypt.hash('p', 8);
const head = await User.create({ username: 'head', fullName: 'Saurabh Kushwah', profile: 'Branch Head', city: 'All', passwordHash: pw });
const tl = await User.create({ username: 'tl', fullName: 'Yash Verma', profile: 'Sales Team Leader', city: 'Gurgaon', manager: head._id, passwordHash: pw });
await User.create({ username: 'rm', fullName: 'Abhishek Sagar', profile: 'Sales Executive (RM)', city: 'Gurgaon', manager: tl._id, passwordHash: pw });
await User.create({ username: 'other', fullName: 'Neeraj Dagur', profile: 'Sales Executive (RM)', city: 'Gurgaon', passwordHash: pw });
await User.create({ username: 'ba', fullName: 'Rakesh (BA)', profile: 'Business Associate', city: 'Gurgaon', passwordHash: pw });

const server = http.createServer(app).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const login = async (u) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'p' }),
  });
  return (await r.json()).token;
};
const call = async (tok, path, opts = {}) => {
  const r = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, ...(opts.headers || {}) },
  });
  return { status: r.status, body: await r.json() };
};

let fail = 0;
const check = (n, ok, x = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };

const tHead = await login('head'), tTl = await login('tl'), tRm = await login('rm'),
      tOther = await login('other'), tBa = await login('ba');

// --- a snapshot blob to migrate out of ---------------------------------------
await State.create({ workspace: 'default', key: 'db', rev: 5, value: { customers: [
  { id: 'c1', name: 'Lead One',   owner: 'Abhishek Sagar', cityMRC: 'Gurgaon', stage: 'New',     createdAt: '2024-01-15T10:00:00.000Z', notes: [{ n: 'from blob' }] },
  { id: 'c2', name: 'Lead Two',   owner: 'Neeraj Dagur',   cityMRC: 'Gurgaon', stage: 'Working', createdAt: '2024-02-20T10:00:00.000Z' },
  { id: 'c3', name: 'Lead Three', owner: 'Yash Verma',     cityMRC: 'Noida',   stage: 'New',     createdAt: '2024-03-01T10:00:00.000Z' },
  { id: 'c4', name: 'BA Lead',    owner: 'Abhishek Sagar', ba: 'Rakesh (BA)',  cityMRC: 'Gurgaon', createdAt: '2024-04-01T10:00:00.000Z' },
  { id: 'c5', name: '',           owner: 'Nobody' },
  { id: 'c1', name: 'Dup',        owner: 'Abhishek Sagar' },
] } });

const run = (args) => new Promise((res) =>
  execFile(process.execPath, ['src/scripts/backfill-customers.js', ...args],
    { env: { ...process.env }, cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') },
    (e, so, se) => res(String(so) + String(se))));

let out = await run([]);
check('dry run writes nothing', (await Customer.countDocuments()) === 0);
check('dry run reports 4 creatable', /to create   : 4/.test(out), (out.match(/to create.*/) || [''])[0].trim());
check('dry run flags 2 invalid', /invalid     : 2/.test(out), (out.match(/invalid.*/) || [''])[0].trim());

out = await run(['--write']);
check('write created 4', (await Customer.countDocuments()) === 4);
const c1 = await Customer.findOne({ id: 'c1' }).lean();
check('snapshot createdAt preserved', new Date(c1.createdAt).toISOString() === '2024-01-15T10:00:00.000Z', String(c1.createdAt));
check('nested notes survived', c1.notes && c1.notes[0] && c1.notes[0].n === 'from blob');
check('snapshot left untouched', (await State.findOne({ key: 'db' }).lean()).value.customers.length === 6);

out = await run(['--write']);
check('re-run is idempotent', (await Customer.countDocuments()) === 4 && /skipped     : 4/.test(out), (out.match(/skipped.*/) || [''])[0].trim());

// --- scoping ------------------------------------------------------------------
let r = await call(tRm, '/api/customers');
check('RM sees only own leads', r.body.data.every((c) => c.owner === 'Abhishek Sagar') && r.body.total === 2, `total=${r.body.total}`);

r = await call(tTl, '/api/customers');
const tlIds = r.body.data.map((c) => c.id).sort().join(',');
check('TL sees own + subordinates, city-bounded', tlIds === 'c1,c4', tlIds);

r = await call(tHead, '/api/customers');
check('Branch Head sees all 4', r.body.total === 4, `total=${r.body.total}`);

r = await call(tBa, '/api/customers');
check('BA sees only their channel lead', r.body.total === 1 && r.body.data[0].id === 'c4', `total=${r.body.total}`);

r = await call(tOther, '/api/customers/c1');
check('non-owner gets 404 not 403', r.status === 404, String(r.status));
r = await call(tRm, '/api/customers/c1');
check('owner can read own', r.status === 200 && r.body.data.id === 'c1');

r = await call(tRm, '/api/customers?q=Lead One');
check('search is scoped too', r.body.total === 1 && r.body.data[0].id === 'c1');
r = await call(tRm, '/api/customers?q=.*');
check('search regex is escaped', r.body.total === 0, `total=${r.body.total}`);

// --- the point of the migration: concurrent field-level edits -----------------
const [a, b] = await Promise.all([
  call(tRm,   '/api/customers/c1', { method: 'PATCH', body: JSON.stringify({ remarks: 'called, interested' }) }),
  call(tHead, '/api/customers/c1', { method: 'PATCH', body: JSON.stringify({ stage: 'Working' }) }),
]);
check('both concurrent field edits succeed', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
const merged = await Customer.findOne({ id: 'c1' }).lean();
check('BOTH edits survived, no overwrite', merged.remarks === 'called, interested' && merged.stage === 'Working', `remarks="${merged.remarks}" stage="${merged.stage}"`);
check('audit trail recorded both', (merged.audit || []).length === 2, `${(merged.audit || []).length} entries`);

await Promise.all([
  call(tRm,   '/api/customers/c1/notes', { method: 'POST', body: JSON.stringify({ text: 'note from RM' }) }),
  call(tHead, '/api/customers/c1/notes', { method: 'POST', body: JSON.stringify({ text: 'note from Head' }) }),
]);
check('concurrent notes both appended', (await Customer.findOne({ id: 'c1' }).lean()).notes.length === 3);

// --- protected fields ----------------------------------------------------------
r = await call(tRm, '/api/customers/c1', { method: 'PATCH', body: JSON.stringify({ id: 'hacked', notes: [] }) });
check('protected-only patch rejected', r.status === 400, `${r.status} ${r.body.error || ''}`);
check('id unchanged', !!(await Customer.findOne({ id: 'c1' })));

// --- create + idempotent replay -------------------------------------------------
r = await call(tRm, '/api/customers', { method: 'POST', body: JSON.stringify({ id: 'c9', name: 'New Lead' }) });
check('create returns 201 and defaults owner', r.status === 201 && r.body.data.owner === 'Abhishek Sagar', String(r.status));
r = await call(tRm, '/api/customers', { method: 'POST', body: JSON.stringify({ id: 'c9', name: 'New Lead' }) });
check('duplicate create is idempotent not 500', r.status === 200 && r.body.duplicate === true, String(r.status));
r = await call(tRm, '/api/customers', { method: 'POST', body: JSON.stringify({ name: 'No id' }) });
check('create without id -> 400', r.status === 400);

const noAuth = await fetch(`${base}/api/customers`);
check('unauthenticated -> 401', noAuth.status === 401, String(noAuth.status));

const acts = await Activity.find({ type: { $in: ['CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_MIGRATED'] } }).lean();
check('activity log recorded (enum accepts new types)', acts.length >= 3, `${acts.length} entries`);

console.log(fail ? `\n${fail} FAILING` : '\nAll cases pass.');
server.close();
await mongoose.disconnect();
await mem.stop();
process.exit(fail ? 1 : 0);
