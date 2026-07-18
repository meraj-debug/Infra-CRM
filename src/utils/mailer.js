import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Outbound mail.
 *
 * Configured entirely from the environment. Gmail / Google Workspace needs an
 * APP PASSWORD (Google Account → Security → 2-Step Verification → App
 * passwords), not the account's own password — that is what APP_PASSWORD_EMAIL
 * holds. SMTP_USER is the mailbox it belongs to, and is also the From address
 * unless SMTP_FROM says otherwise.
 *
 * If SMTP is not configured the mail is LOGGED instead of sent, and the caller
 * is told (`delivered:false`). That keeps a half-configured deploy usable
 * without silently pretending a password reset reached somebody.
 */

let transport = null;
let transportError = null;

function getTransport() {
  if (transport || transportError) return transport;
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) return null;

  try {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is implicit TLS; 587 upgrades with STARTTLS.
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        // Google shows app passwords in 4-character groups. The spaces are
        // display only — leaving them in makes auth fail with a confusing
        // "Username and Password not accepted".
        pass: env.SMTP_PASSWORD.replace(/\s+/g, ''),
      },
    });
  } catch (e) {
    transportError = e;
    logger.error(`Mailer could not be created: ${e.message}`);
  }
  return transport;
}

export function mailerConfigured() {
  return !!(env.SMTP_USER && env.SMTP_PASSWORD);
}

/** Verify the SMTP credentials without sending anything. */
export async function verifyMailer() {
  const t = getTransport();
  if (!t) return { ok: false, reason: 'SMTP is not configured (set SMTP_USER and APP_PASSWORD_EMAIL)' };
  try {
    await t.verify();
    return { ok: true, from: env.SMTP_FROM || env.SMTP_USER };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Send a mail. Never throws — a failed notification must not roll back the
 * action that triggered it (the password really was reset either way), so the
 * outcome is returned for the caller to report to the user.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!to) return { delivered: false, reason: 'no recipient address' };

  const t = getTransport();
  if (!t) {
    logger.warn(`[mail NOT SENT — SMTP unconfigured] to=${to} subject="${subject}"`);
    return { delivered: false, reason: 'SMTP is not configured on the server' };
  }

  try {
    const info = await t.sendMail({
      from: env.SMTP_FROM || `Inframantra CRM <${env.SMTP_USER}>`,
      to, subject, text, html,
    });
    logger.info(`Mail sent to ${to} (${info.messageId})`);
    return { delivered: true, messageId: info.messageId };
  } catch (e) {
    logger.error(`Mail to ${to} failed: ${e.message}`);
    return { delivered: false, reason: e.message };
  }
}
