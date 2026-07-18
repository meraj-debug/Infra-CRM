import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Verifies a Bearer JWT and attaches the decoded user to req.user.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Guard for the CRM state store.
 *
 * Accepts EITHER:
 *   - a valid Bearer JWT (issued by POST /api/auth/login), or
 *   - the shared workspace key in `x-workspace-key` (== env.WORKSPACE_KEY).
 *
 * If WORKSPACE_KEY is unset the guard is open, which is convenient for local
 * dev. Set it in production so the snapshot is not world-readable.
 */
export function workspaceGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (bearer) {
    try {
      req.user = jwt.verify(bearer, env.JWT_SECRET);
      return next();
    } catch { /* fall through to the workspace key */ }
  }

  if (!env.WORKSPACE_KEY) return next();                        // open dev mode
  if (req.get('x-workspace-key') === env.WORKSPACE_KEY) return next();

  return res.status(401).json({ error: 'Authentication required' });
}

export function signToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}
