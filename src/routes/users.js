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

// GET /api/users — the roster the Users tab renders. Never exposes hashes.
router.get('/', asyncHandler(async (req, res) => {
  const users = await User.find({}, '-passwordHash')
    .populate('manager', 'fullName')
    .sort({ fullName: 1 })
    .lean();
  res.json({ data: users });
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
 * Generates a temporary password, stores its hash, flags the account so the
 * user must choose a new one, and e-mails it to the address on record.
 *
 * Refuses when there is no e-mail address: the old client-side version happily
 * "sent" to `undefined`, which meant the account's password had been changed
 * and nobody could be told the new one.
 */
router.post('/:username/reset-password', asyncHandler(async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an administrator can reset a password' });

  const user = await User.findOne({ username: new RegExp(`^${String(req.params.username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.email) {
    return res.status(422).json({
      error: `${user.fullName} has no e-mail address on record. Add one before resetting their password.`,
    });
  }
  if (!mailerConfigured()) {
    // Refuse rather than change the password into a void the admin can't see.
    return res.status(503).json({
      error: 'E-mail is not configured on the server, so the new password could not be delivered. Nothing was changed.',
    });
  }

  const temp = tempPassword();
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

  // Send BEFORE persisting: if the mail bounces, the old password still works
  // and the user is not locked out of an account nobody can hand back to them.
  const mail = await sendMail({
    to: user.email,
    subject: 'Your Inframantra CRM password has been reset',
    text, html,
  });

  if (!mail.delivered) {
    return res.status(502).json({
      error: `Could not send the e-mail to ${user.email}, so the password was left unchanged. ${mail.reason || ''}`.trim(),
    });
  }

  user.passwordHash = await bcrypt.hash(temp, BCRYPT_ROUNDS);
  user.mustChange = true;
  user.pwdChangedAt = new Date();
  await user.save();

  await logActivity({
    type: 'PASSWORD_RESET', actor: req.user.id, actorName: req.user.fullName,
    entity: 'user', entityId: user._id,
    detail: { username: user.username, emailedTo: user.email },
  });

  // The temporary password is deliberately NOT returned — it exists only in the
  // recipient's inbox, so an admin cannot read other people's credentials.
  res.json({ ok: true, emailedTo: user.email, messageId: mail.messageId });
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
