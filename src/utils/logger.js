// Minimal structured logger. Emits single-line JSON in production (friendly for
// Render's log drains / aggregators) and readable text in development.
const isProd = process.env.NODE_ENV === 'production';

function emit(level, msg, meta) {
  const rec = { ts: new Date().toISOString(), level, msg, ...(meta || {}) };
  const line = isProd ? JSON.stringify(rec) : `[${rec.ts}] ${level.toUpperCase()} ${msg}`;
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
