import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { logActivity } from '../models/Activity.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken,
  signResetToken, verifyResetToken,
  setRefreshCookie, clearRefreshCookie, readRefreshCookie,
  requireAuth,
} from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { sendMail, mailerConfigured } from '../utils/mailer.js';
import { env } from '../config/env.js';

const router = Router();
const BCRYPT_ROUNDS = 10;

// Escape a user-supplied string before it reaches a RegExp, so a value like
// ".*" can't turn a lookup into a match-everything query.
const rxEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Build the claims we put inside a token. `city` and `profile` are AUTHORIZATION
// claims — record scoping reads them — so they must always ship.
function claimsFor(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    fullName: user.fullName,
    profile: user.profile,
    role: user.role,
    city: user.city || 'All',
  };
}

// The safe user shape we return to the browser (never the password hash).
function publicUser(user) {
  return {
    id: user._id, username: user.username, fullName: user.fullName,
    profile: user.profile, role: user.role, city: user.city,
    email: user.email || '', mustChange: !!user.mustChange,
  };
}

// A readable temporary password, same character classes the frontend used.
function tempPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789', s = '@#$%&*';
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  const base = [pick(A), pick(A), pick(a), pick(a), pick(a), pick(d), pick(d), pick(d), pick(s)];
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}

/* =============================================================================
   1.3  LOGIN  — POST /api/auth/login  { username, password }
   Returns a short-lived access token in the body and sets a long-lived refresh
   token in an httpOnly cookie. `username` may be the CRM username OR the e-mail.
============================================================================= */
router.post('/login', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const identifier = body.username || body.identifier || body.email;
  const { password } = body;
  console.log(password)

  if (!identifier || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const id = String(identifier).trim().toLowerCase();
  const user = await User.findOne({
    $or: [
      { username: new RegExp(`^${rxEscape(id)}$`, 'i') },
      { email: id },
    ],
  }).select('+passwordHash');

  // Same message either way so we don't reveal which usernames exist.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.active === false) {
    return res.status(403).json({ error: 'This login is deactivated. Ask an administrator.' });
  }

  const claims = claimsFor(user);
  setRefreshCookie(res, signRefreshToken({ id: claims.id }));
  await logActivity({ type: 'LOGIN', actor: user._id, actorName: user.fullName });

  res.json({ token: signAccessToken(claims), user: publicUser(user) });
}));

/* =============================================================================
   1.1  REGISTER  — POST /api/auth/register  { fullName, username, email, city }
   Creates the account with a TEMPORARY password, e-mails the username + temp
   password to the address given, and flags the account so the user must choose
   their own password on first sign-in. The admin assigns the real profile later
   (Module 1.4); new accounts start on a minimal default profile.
============================================================================= */
router.post('/register', asyncHandler(async (req, res) => {
  const { fullName, username, email, city } = req.body || {};
  if (!fullName || !username || !email) {
    return res.status(400).json({ error: 'fullName, username and email are required' });
  }

  const uname = String(username).trim();
  const mail = String(email).trim().toLowerCase();

  // Reject duplicates up front with a clear message (the unique index is the
  // real guard, but this gives a friendlier error).
  const clash = await User.findOne({
    $or: [
      { username: new RegExp(`^${rxEscape(uname)}$`, 'i') },
      { email: mail },
    ],
  });
  if (clash) {
    return res.status(409).json({ error: 'That username or e-mail is already registered.' });
  }

  if (!mailerConfigured()) {
    return res.status(503).json({
      error: 'E-mail is not configured on the server, so the temporary password could not be delivered. Nothing was created.',
    });
  }

  const temp = tempPassword();
  const user = await User.create({
    fullName: String(fullName).trim(),
    username: uname,
    email: mail,
    city: (city && String(city).trim()) || 'All',
    profile: 'Pre-Sales Executive',   // minimal default; admin upgrades later
    role: 'presales',
    passwordHash: await bcrypt.hash(temp, BCRYPT_ROUNDS),
    mustChange: true,
  });

  const link = env.FRONTEND_URL || '';
  const text =
    `Hi ${user.fullName},\n\n` +
    `An Inframantra CRM account has been created for you.\n\n` +
    (link ? `Sign in : ${link}\n` : '') +
    `Username : ${user.username}\n` +
    `Temporary password : ${temp}\n\n` +
    `You'll be asked to choose your own password the first time you sign in.\n\n` +
    `— Inframantra CRM`;
  const html =
    `<p>Hi ${user.fullName},</p>` +
    `<p>An Inframantra CRM account has been created for you.</p>` +
    `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">` +
    (link ? `<tr><td><b>Sign in</b></td><td><a href="${link}">${link}</a></td></tr>` : '') +
    `<tr><td><b>Username</b></td><td>${user.username}</td></tr>` +
    `<tr><td><b>Temporary password</b></td><td><code style="font-size:15px">${temp}</code></td></tr></table>` +
    `<p>You'll be asked to choose your own password the first time you sign in.</p>` +
    `<p style="color:#888">— Inframantra CRM</p>`;

  const mailRes = await sendMail({
    to: user.email,
    subject: 'Welcome to the Inframantra CRM — your temporary password',
    text, html,
  });

  await logActivity({ type: 'USER_ACTION', actor: user._id, actorName: user.fullName, detail: { event: 'REGISTERED' } });

  // The temp password is deliberately NOT returned — it only exists in the inbox.
  res.status(201).json({ ok: true, emailedTo: user.email, delivered: mailRes.delivered });
}));

/* =============================================================================
   1.3  REFRESH  — POST /api/auth/refresh
   Reads the refresh cookie, re-reads the user (so profile/city changes take
   effect), and returns a fresh access token.
============================================================================= */
router.post('/refresh', asyncHandler(async (req, res) => {
  const token = readRefreshCookie(req);
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }

  const user = await User.findById(payload.id);
  if (!user || user.active === false) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Session expired' });
  }

  res.json({ token: signAccessToken(claimsFor(user)) });
}));

/* =============================================================================
   ME  — GET /api/auth/me   (access token required)
   Returns the current signed-in user, read fresh from the DB.
============================================================================= */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
}));

/* =============================================================================
   LOGOUT  — POST /api/auth/logout
   Clears the refresh cookie. (The access token simply expires on its own.)
============================================================================= */
router.post('/logout', asyncHandler(async (req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

/* =============================================================================
   1.2  FORGOT PASSWORD  — POST /api/auth/forgot-password  { email }
   E-mails a reset link containing a JWT that expires in 10 minutes.
   For privacy we ALWAYS reply the same way, so this can't be used to discover
   which e-mails have accounts.
============================================================================= */
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that e-mail has an account, a reset link is on its way.' };

  if (!email) return res.status(400).json({ error: 'email is required' });

  const user = await User.findOne({ email });
  // Only actually send when the account exists AND mail is configured — but the
  // response is identical regardless.
  if (user && mailerConfigured()) {
    const token = signResetToken({ id: user._id.toString() });
    const base = env.FRONTEND_URL || '';
    const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;

    const text =
      `Hi ${user.fullName},\n\n` +
      `We received a request to reset your Inframantra CRM password.\n\n` +
      `Reset your password (expires in 10 minutes):\n${link}\n\n` +
      `If you didn't ask for this, you can ignore this e-mail.\n\n— Inframantra CRM`;
    const html =
      `<p>Hi ${user.fullName},</p>` +
      `<p>We received a request to reset your Inframantra CRM password.</p>` +
      `<p><a href="${link}" style="background:#0E0E10;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Reset your password</a></p>` +
      `<p style="color:#888;font-size:13px">This link expires in 10 minutes. If you didn't ask for this, you can ignore this e-mail.</p>` +
      `<p style="color:#888">— Inframantra CRM</p>`;

    await sendMail({ to: user.email, subject: 'Reset your Inframantra CRM password', text, html });
    await logActivity({ type: 'PASSWORD_RESET', actor: user._id, actorName: user.fullName, detail: { via: 'forgot-password' } });
  }

  res.json(generic);
}));

/* =============================================================================
   1.2  RESET PASSWORD  — POST /api/auth/reset-password  { token, newPassword }
   Verifies the 10-minute token from the e-mail and stores the new password.
============================================================================= */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'token and newPassword are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  let payload;
  try {
    payload = verifyResetToken(token);
  } catch {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }

  const user = await User.findById(payload.id).select('+passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.mustChange = false;
  user.pwdChangedAt = new Date();
  await user.save();

  await logActivity({ type: 'PASSWORD_CHANGED', actor: user._id, actorName: user.fullName, detail: { via: 'reset-link' } });
  res.json({ ok: true });
}));

/* =============================================================================
   1.5  CHANGE PASSWORD  — POST /api/auth/change-password
        { username, oldPassword, newPassword }
   Verifies the username + current password, then stores the new one. Works
   whether or not a token is attached, since the credentials themselves prove
   identity. Clears `mustChange`, retiring a temporary password.
============================================================================= */
router.post('/change-password', asyncHandler(async (req, res) => {
  const { username, oldPassword, newPassword } = req.body || {};
  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: 'username, oldPassword and newPassword are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (oldPassword === newPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }

  const id = String(username).trim().toLowerCase();
  const user = await User.findOne({
    $or: [
      { username: new RegExp(`^${rxEscape(id)}$`, 'i') },
      { email: id },
    ],
  }).select('+passwordHash');

  // Same 401 for "no such user" and "wrong password" so we don't leak accounts.
  if (!user || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Your username or current password is not correct' });
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.mustChange = false;
  user.pwdChangedAt = new Date();
  await user.save();

  await logActivity({ type: 'PASSWORD_CHANGED', actor: user._id, actorName: user.fullName, detail: { via: 'self-service' } });

  // Courtesy notice — never blocks the change.
  if (user.email) {
    sendMail({
      to: user.email,
      subject: 'Your Inframantra CRM password was changed',
      text: `Hi ${user.fullName},\n\nYour Inframantra CRM password was just changed.\n\nIf this wasn't you, contact your administrator immediately.\n\n— Inframantra CRM`,
    }).catch(() => {});
  }

  res.json({ ok: true });
}));

export default router;
