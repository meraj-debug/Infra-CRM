import { User } from '../models/User.js';
import { logger } from './logger.js';

/**
 * Server-side mirror of the frontend's record visibility rules.
 *
 * The CRM keys ownership by a user's FULL NAME (`rec.owner === 'Abhishek Sagar'`),
 * not by id — that is how the snapshot has always been shaped, and how the UI
 * still reads it. The relational User rows link `manager` by ObjectId, so the
 * helpers below resolve the id graph down to the names the records carry.
 *
 * Keep this in step with `mine()` / `filterByCity()` in index.html. Where the
 * two disagree, the server wins: the frontend filter is presentation, this one
 * is enforcement, and until now there was no enforcement at all.
 */

// Profiles whose `act.viewAll` is 1 in the frontend's PROFILES table.
export const VIEW_ALL_PROFILES = new Set([
  'System Administrator',
  'Branch Head',
  'Sales Head',
  'CFO',
  'CEO',
  'Finance / Management',
]);

/**
 * Full names of a user plus everyone reporting up to them, at any depth.
 * Walks the tree level by level so a cycle in the manager graph terminates
 * instead of recursing forever (the frontend guards this with a `seen` set).
 */
export async function teamNames(user) {
  const all = await User.find({}, 'fullName manager').lean();
  const byId = new Map(all.map((u) => [String(u._id), u]));

  const childrenOf = new Map();
  for (const u of all) {
    if (!u.manager) continue;
    const k = String(u.manager);
    if (!childrenOf.has(k)) childrenOf.set(k, []);
    childrenOf.get(k).push(u);
  }

  const names = new Set([user.fullName]);
  const seen = new Set([String(user.id || user._id)]);
  let frontier = [String(user.id || user._id)];

  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const child of childrenOf.get(id) || []) {
        const cid = String(child._id);
        if (seen.has(cid)) continue;
        seen.add(cid);
        names.add(child.fullName);
        next.push(cid);
      }
    }
    frontier = next;
  }

  // A user missing from the collection (e.g. a JWT issued before a re-seed)
  // still sees their own records rather than nothing at all.
  if (!byId.has(String(user.id || user._id))) names.add(user.fullName);
  return [...names].filter(Boolean);
}

/**
 * A Mongo filter limiting a customer query to what `user` may see.
 * Returns null when the user may see everything, so callers can skip the $and.
 */
export async function customerScopeFilter(user) {
  // Business Associates are channel partners: strictly their own leads.
  if (user.profile === 'Business Associate') return { ba: user.fullName };

  if (VIEW_ALL_PROFILES.has(user.profile)) {
    // Still bounded by city for a single-city manager.
    return cityFilter(user);
  }

  const team = await teamNames(user);
  const own = { $or: [{ owner: { $in: team } }, { manager: user.fullName }] };
  const city = cityFilter(user);
  return city ? { $and: [own, city] } : own;
}

/** City segregation. `All` (or unset) sees every city. */
export function cityFilter(user) {
  const c = user.city;
  // A token minted before `city` became a claim scopes to nothing and silently
  // disables segregation. Say so — a quiet failure here is a data leak between
  // branches. Tokens expire in 12h, so this clears itself after a re-login.
  if (c === undefined) {
    logger.warn(`Token for ${user.username || user.fullName} carries no city claim — city scoping skipped. Re-login to refresh.`);
    return null;
  }
  if (!c || c === 'All') return null;
  // A record with no city recorded stays visible — the frontend's recCity()
  // falls back through three fields and yields '' rather than hiding the row.
  return {
    $or: [
      { cityMRC: c }, { citySales: c }, { cityMkt: c },
      { $and: [
        { $or: [{ cityMRC: { $in: ['', null] } }, { cityMRC: { $exists: false } }] },
        { $or: [{ citySales: { $in: ['', null] } }, { citySales: { $exists: false } }] },
        { $or: [{ cityMkt: { $in: ['', null] } }, { cityMkt: { $exists: false } }] },
      ] },
    ],
  };
}

/** True if `user` may see this already-loaded customer. */
export async function canSeeCustomer(user, cust) {
  if (user.profile === 'Business Associate') return cust.ba === user.fullName;
  if (!VIEW_ALL_PROFILES.has(user.profile)) {
    const team = await teamNames(user);
    if (!team.includes(cust.owner) && cust.manager !== user.fullName) return false;
  }
  const c = user.city;
  if (!c || c === 'All') return true;
  const recCity = cust.cityMRC || cust.citySales || cust.cityMkt || '';
  return !recCity || recCity === c;
}
