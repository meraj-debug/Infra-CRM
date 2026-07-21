import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { logActivity } from '../models/Activity.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { sendMail, mailerConfigured, verifyMailer } from '../utils/mailer.js';
import { env } from '../config/env.js';

const router = Router();
router.use(requireAuth);

// Mirrors PROFILES[...].act.manageUsers in the frontend.
const ADMIN_PROFILES = new Set(['System Administrator', 'CEO']);
const isAdmin = (u) => ADMIN_PROFILES.has(u.profile);

const BCRYPT_ROUNDS = 10;

// Escape a user-supplied string before it goes into a RegExp lookup.
const rxEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Same character classes the frontend's V6_genPassword() used. */
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

// The UI picks a manager by full name; turn that into the User _id we store.
async function resolveManagerId(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const mgr = await User.findOne({ fullName: new RegExp(`^${rxEscape(n)}$`, 'i') });
  return mgr ? mgr._id : null;
}

// GET /api/users — the roster the Users tab renders. Never exposes hashes.
router.get('/', asyncHandler(async (req, res) => {
  const users = await User.find({}, '-passwordHash')
    .populate('manager', 'fullName')
    .sort({ fullName: 1 })
    .lean();
  res.json({ data: users });
}));

/**
 * POST /api/users  (admin only) — CREATE a real account.
 *
 * Makes a genuine, login-capable user with a temporary password. The password
 * is e-mailed when an address + SMTP are available, and is ALSO returned in the
 * response so the admin can always hand it over — even if e-mail is down. The
 * account is flagged `mustChange`, so the person picks their own on first login.
 */
router.post('/', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an administrator can create users' });

  const { fullName, username, email, mobile, city, profile, role, manager } = req.body || {};
  if (!fullName || !username) {
    return res.status(400).json({ error: 'fullName and username are required' });
  }

  const uname = String(username).trim();
  const mail = email ? String(email).trim().toLowerCase() : '';

  // Friendly duplicate check ahead of the unique index.
  const clash = await User.findOne({
    $or: [
      { username: new RegExp(`^${rxEscape(uname)}$`, 'i') },
      ...(mail ? [{ email: mail }] : []),
    ],
  });
  if (clash) return res.status(409).json({ error: 'That username or e-mail is already registered.' });

  const temp = tempPassword();
  const user = await User.create({
    fullName: String(fullName).trim(),
    username: uname,
    email: mail,
    mobile: mobile ? String(mobile).trim() : '',
    city: (city && String(city).trim()) || 'All',
    profile: profile || 'Sales Executive (RM)',
    role: role || 'sales',
    manager: await resolveManagerId(manager),
    passwordHash: await bcrypt.hash(temp, BCRYPT_ROUNDS),
    mustChange: true,
  });

  // Best-effort e-mail — never blocks creation (the admin still gets the temp
  // password in the response below).
  let emailed = false, emailError = '';
  if (mail && mailerConfigured()) {
    const link = env.FRONTEND_URL || '';
    const text =
      `Hi ${user.fullName},\n\n` +
      `An Inframantra CRM account has been created for you by ${req.user.fullName}.\n\n` +
      (link ? `Sign in : ${link}\n` : '') +
      `Username : ${user.username}\n` +
      `Temporary password : ${temp}\n\n` +
      `You'll be asked to choose your own password the first time you sign in.\n\n` +
      `— Inframantra CRM`;
    const html =
      `<p>Hi ${user.fullName},</p>` +
      `<p>An Inframantra CRM account has been created for you by <b>${req.user.fullName}</b>.</p>` +
      `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">` +
      (link ? `<tr><td><b>Sign in</b></td><td><a href="${link}">${link}</a></td></tr>` : '') +
      `<tr><td><b>Username</b></td><td>${user.username}</td></tr>` +
      `<tr><td><b>Temporary password</b></td><td><code style="font-size:15px">${temp}</code></td></tr></table>` +
      `<p>You'll be asked to choose your own password the first time you sign in.</p>` +
      `<p style="color:#888">— Inframantra CRM</p>`;
    const mailRes = await sendMail({
      to: mail, subject: 'Welcome to the Inframantra CRM — your temporary password', text, html,
    });
    emailed = mailRes.delivered;
    if (!emailed) emailError = mailRes.reason || '';
  }

  await logActivity({
    type: 'USER_ACTION', actor: req.user.id, actorName: req.user.fullName,
    entity: 'user', entityId: user._id, detail: { event: 'CREATED', username: user.username },
  });

  const out = user.toObject();
  delete out.passwordHash;
  res.status(201).json({ ok: true, user: out, tempPassword: temp, emailed, emailError });
}));

/**
 * PATCH /api/users/:id  (admin only) — edit an existing account's details.
 * Only touches the fields present in the body; never changes the password here.
 */
router.patch('/:id', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an administrator can edit users' });

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { fullName, email, mobile, profile, role, city, active, manager } = req.body || {};
  if (fullName !== undefined) user.fullName = String(fullName).trim();
  if (email !== undefined) user.email = String(email).trim().toLowerCase();
  if (mobile !== undefined) user.mobile = String(mobile).trim();
  if (profile !== undefined) user.profile = profile;
  if (role !== undefined) user.role = role;
  if (city !== undefined) user.city = city;
  if (active !== undefined) user.active = !!active;
  if (manager !== undefined) user.manager = await resolveManagerId(manager);

  await user.save();
  await user.populate('manager', 'fullName');

  await logActivity({
    type: 'USER_ACTION', actor: req.user.id, actorName: req.user.fullName,
    entity: 'user', entityId: user._id, detail: { event: 'UPDATED', username: user.username },
  });

  const out = user.toObject();
  delete out.passwordHash;
  res.json({ ok: true, user: out });
}));

// GET /api/users/mail-status — lets the UI warn before an admin tries a reset.
router.get('/mail-status', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Not permitted' });
  if (!mailerConfigured()) {
    return res.json({ configured: false, reason: 'SMTP_USER / APP_PASSWORD_EMAIL are not set on the server' });
  }
  res.json({ configured: true, ...(await verifyMailer()) });
}));

/**
 * POST /api/users/:username/reset-password  (admin only)
 *
 * Resets the account to a new TEMPORARY password and flags it so the user must
 * choose their own on next sign-in. Mirrors the create flow: it e-mails the
 * password when it can, and ALSO returns it in the response so the admin always
 * has a credential to hand over — even when SMTP is down or there is no e-mail
 * on record. (An admin who can reset a password can already sign in as anyone,
 * so returning it to them adds no exposure and removes a real dead-end.)
 */
router.post('/:username/reset-password', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an administrator can reset a password' });

  const user = await User.findOne({ username: new RegExp(`^${rxEscape(req.params.username)}$`, 'i') });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const temp = tempPassword();
  user.passwordHash = await bcrypt.hash(temp, BCRYPT_ROUNDS);
  user.mustChange = true;
  user.pwdChangedAt = new Date();
  await user.save();

  // Best-effort e-mail — never blocks the reset (the admin gets the password in
  // the response regardless).
  let emailed = false, emailError = '';
  if (user.email && mailerConfigured()) {
    const link = env.FRONTEND_URL || '';
    const text =
      `Hi ${user.fullName},\n\n` +
      `Your Inframantra CRM password has been reset by ${req.user.fullName}.\n\n` +
      (link ? `Sign in : ${link}\n` : '') +
      `Username : ${user.username}\n` +
      `Temporary password : ${temp}\n\n` +
      `You will be asked to choose a new password the first time you sign in.\n` +
      `If you did not expect this, contact your administrator immediately.\n\n` +
      `— Inframantra CRM`;
    const html =
      `<p>Hi ${user.fullName},</p>` +
      `<p>Your Inframantra CRM password has been reset by <b>${req.user.fullName}</b>.</p>` +
      `<table cellpadding="6" style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">` +
      (link ? `<tr><td><b>Sign in</b></td><td><a href="${link}">${link}</a></td></tr>` : '') +
      `<tr><td><b>Username</b></td><td>${user.username}</td></tr>` +
      `<tr><td><b>Temporary password</b></td><td><code style="font-size:15px">${temp}</code></td></tr></table>` +
      `<p>You will be asked to choose a new password the first time you sign in.<br>` +
      `If you did not expect this, contact your administrator immediately.</p>` +
      `<p style="color:#888">— Inframantra CRM</p>`;
    const mail = await sendMail({
      to: user.email, subject: 'Your Inframantra CRM password has been reset', text, html,
    });
    emailed = mail.delivered;
    if (!emailed) emailError = mail.reason || '';
  }

  await logActivity({
    type: 'PASSWORD_RESET', actor: req.user.id, actorName: req.user.fullName,
    entity: 'user', entityId: user._id,
    detail: { username: user.username, emailedTo: emailed ? user.email : '' },
  });

  res.json({ ok: true, tempPassword: temp, emailed, emailError, emailedTo: user.email || '' });
}));

/**
 * POST /api/users/me/change-password
 * The signed-in user swaps their own password. Also clears `mustChange`, which
 * is how a temporary password gets retired.
 */
router.post('/me/change-password', asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'The new password must be different from the current one' });
  }

  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Your current password is not correct' });
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.mustChange = false;
  user.pwdChangedAt = new Date();
  await user.save();

  await logActivity({
    type: 'PASSWORD_CHANGED', actor: user._id, actorName: user.fullName,
    entity: 'user', entityId: user._id,
  });

  // Courtesy notice. Never blocks the change — the password is already updated.
  if (user.email) {
    sendMail({
      to: user.email,
      subject: 'Your Inframantra CRM password was changed',
      text: `Hi ${user.fullName},\n\nYour Inframantra CRM password was changed on ${new Date().toLocaleString()}.\n\n` +
            `If this wasn't you, contact your administrator immediately.\n\n— Inframantra CRM`,
    }).catch(() => {});
  }

  res.json({ ok: true });
}));

export default router;
