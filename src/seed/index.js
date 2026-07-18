import bcrypt from 'bcryptjs';

import { User } from '../models/User.js';
import { Project } from '../models/Project.js';
import { Customer } from '../models/Customer.js';
import { Deal } from '../models/Deal.js';
import { State } from '../models/State.js';
import { logger } from '../utils/logger.js';
import { USERS, PROJECTS, CUSTOMERS, DEALS } from './data.js';

/**
 * Seeds the database with the initial demo data.
 *
 * Idempotent: re-running it updates the demo rows in place instead of
 * duplicating them, and it never touches a non-empty CRM snapshot unless
 * `force` is passed.
 */
export async function runSeed({ force = false } = {}) {
  const report = { users: 0, projects: 0, customers: 0, deals: 0, state: 'untouched' };

  if (force) {
    await Promise.all([
      User.deleteMany({}), Project.deleteMany({}),
      Customer.deleteMany({}), Deal.deleteMany({}),
    ]);
  }

  // ---- Users (two passes so managers can reference already-created users) ----
  const byName = new Map();
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const doc = await User.findOneAndUpdate(
      { username: u.username },
      {
        $set: {
          fullName: u.fullName, profile: u.profile, role: u.role,
          city: u.city, email: u.email || `${u.username}@inframantra.com`,
        },
        $setOnInsert: { username: u.username, passwordHash },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    byName.set(u.fullName, doc._id);
    report.users++;
  }
  for (const u of USERS) {
    if (!u.manager) continue;
    await User.updateOne({ username: u.username }, { $set: { manager: byName.get(u.manager) || null } });
  }

  // ---- Projects ----
  const projectByName = new Map();
  for (const p of PROJECTS) {
    const doc = await Project.findOneAndUpdate(
      { name: p.name },
      { $set: { ...p, rera: `RC/REP/HARERA/GGM/2024/${100 + PROJECTS.indexOf(p)}` } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    projectByName.set(p.name, doc);
    report.projects++;
  }

  // ---- Customers ----
  const customerDocs = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const [name, mobile, email, campaign, source, subSource, projectMkt, cityMkt, budgetMkt, stage, owner, pIdx] = CUSTOMERS[i];
    const project = PROJECTS[pIdx];
    const doc = await Customer.findOneAndUpdate(
      { mobile },
      {
        $set: {
          name, mobile, email, campaign, source, subSource, projectMkt, cityMkt, budgetMkt,
          stage, leadStatus: stage, owner,
          projectMRC: project.name, budgetMRC: budgetMkt, cityMRC: cityMkt,
          localityMRC: project.locality, categoryMRC: 'Residential',
          propTypeMRC: 'Apartment', configMRC: '3 BHK', type: 'Normal PO',
          remarks: 'Inbound enquiry — looking for possession-ready inventory.',
          ba: name === 'Sana Qureshi' ? 'Rakesh Properties (BA)' : undefined,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    customerDocs.push(doc);
    report.customers++;
  }

  // ---- Deals ----
  for (const d of DEALS) {
    const cust = customerDocs[d.customerIdx];
    if (!cust) continue;
    await Deal.findOneAndUpdate(
      { customer: cust._id },
      {
        $set: {
          name: cust.name, stage: d.stage, substatus: d.substatus,
          rm: byName.get(d.rm), teamLeader: byName.get(d.teamLeader),
          projectSales: cust.projectMRC, budgetSales: cust.budgetMRC,
          citySales: cust.cityMRC, localitySales: cust.localityMRC,
        },
        $setOnInsert: { customer: cust._id },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    report.deals++;
  }

  // ---- CRM snapshot slot ----
  // The browser snapshot is authoritative for the UI, so we only ensure the
  // slot exists. On its very first boot the frontend runs its own seed() and
  // immediately PUTs the result here, which becomes the permanent record.
  const existing = await State.findOne({ workspace: 'default', key: 'db' }).lean();
  if (force || !existing) {
    await State.findOneAndUpdate(
      { workspace: 'default', key: 'db' },
      { $set: { value: existing && !force ? existing.value : null }, $setOnInsert: { rev: 0 } },
      { upsert: true }
    );
    report.state = force ? 'reset' : 'created';
  }

  logger.info(`Seed complete: ${JSON.stringify(report)}`);
  return report;
}
