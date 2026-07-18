import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { logActivity } from '../models/Activity.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const router = Router();

// POST /api/auth/login { username, password } -> { token, user }
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const user = await User.findOne({ username: String(username).trim().toLowerCase() })
    .select('+passwordHash');
  // Same message either way so we don't leak which usernames exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken({
    id: user._id.toString(), username: user.username,
    fullName: user.fullName, profile: user.profile, role: user.role,
  });

  await logActivity({ type: 'LOGIN', actor: user._id, actorName: user.fullName });

  res.json({
    token,
    user: {
      id: user._id, username: user.username, fullName: user.fullName,
      profile: user.profile, role: user.role, city: user.city,
    },
  });
}));

export default router;
