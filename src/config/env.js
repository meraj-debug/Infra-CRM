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
};
