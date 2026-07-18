import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { logActivity } from '../models/Activity.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

// Escape a user-supplied string before it reaches a RegExp, so a value like
// ".*" can't turn the email lookup into a match-everything query.
const rxEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// POST /api/auth/login { username, password } -> { token, user }
// `username` accepts either the CRM username or the user's e-mail address —
// people type whichever they remember, and the form has one field for both.
router.post('/login', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const identifier = body.username || body.identifier || body.email;
  const { password } = body;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const id = String(identifier).trim().toLowerCase();
  const user = await User.findOne({
    // username is stored trimmed but case-as-entered; email is lowercased by the
    // schema. Anchored + case-insensitive so both match what the user typed.
    $or: [
      { username: new RegExp(`^${rxEscape(id)}$`, 'i') },
      { email: id },
    ],
  }).select('+passwordHash');
  // Same message either way so we don't leak which usernames exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken({
    id: user._id.toString(), username: user.username,
    fullName: user.fullName, profile: user.profile, role: user.role,
    // `city` is an AUTHORIZATION claim, not decoration: the record scoping in
    // utils/scope.js filters on it. Leaving it out silently disables city
    // segregation instead of failing loudly, so it must ship in the token.
    city: user.city || 'All',
  });

  await logActivity({ type: 'LOGIN', actor: user._id, actorName: user.fullName });

  res.json({
    token,
    user: {
      id: user._id, username: user.username, fullName: user.fullName,
      profile: user.profile, role: user.role, city: user.city, email: user.email || '',
    },
  });
}));

export default router;
