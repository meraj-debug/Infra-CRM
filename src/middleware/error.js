import { logger } from '../utils/logger.js';

// Wrap async route handlers so thrown/rejected errors reach the error handler.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// Single place that turns errors into proper HTTP status codes + JSON.
export function errorHandler(err, req, res, _next) {
  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
  if (status >= 500) logger.error(err.message, { stack: err.stack, path: req.originalUrl });
  res.status(status).json({
    error: err.publicMessage || (status < 500 ? err.message : 'Internal server error'),
  });
}
