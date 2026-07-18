import dotenv from 'dotenv';
dotenv.config();

// Fail fast if a required secret is missing — never fall back to a hardcoded value.
const required = ['MONGODB_URI', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const list = (v, fallback = '') =>
  (v || fallback).split(',').map((s) => s.trim()).filter(Boolean);

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',

  // Comma-separated allowed origins. Supports exact origins and "*" wildcard.
  CORS_ORIGINS: list(process.env.CORS_ORIGINS, 'http://localhost:5173'),

  // Shared key the browser sends as x-workspace-key to read/write CRM state.
  WORKSPACE_KEY: process.env.WORKSPACE_KEY || '',

  // Max JSON body — the CRM snapshot carries activity photos, so 1mb is not enough.
  JSON_LIMIT: process.env.JSON_LIMIT || '25mb',

  SEED_ON_BOOT: String(process.env.SEED_ON_BOOT || 'true') === 'true',
  SENTRY_DSN: process.env.SENTRY_DSN || '',

  // --- Outbound mail (password resets) ---
  // Gmail / Workspace: SMTP_USER is the mailbox and APP_PASSWORD_EMAIL is an
  // App Password, NOT the account password. Defaults suit Gmail; override for
  // Zoho, Titan, Outlook, etc.
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '465', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  // APP_PASSWORD_EMAIL is the name already used in .env; SMTP_PASSWORD is
  // accepted too so the variable can be named either way.
  SMTP_PASSWORD: process.env.APP_PASSWORD_EMAIL || process.env.SMTP_PASSWORD || '',
  SMTP_FROM: process.env.SMTP_FROM || '',

  // Link included in reset e-mails so people land on the right site.
  FRONTEND_URL: process.env.FRONTEND_URL || '',
};
