import jwt from 'jsonwebtoken';
import * as cookie from 'cookie';
import { env } from '../config/env.js';

// The name of the httpOnly cookie that carries the refresh token.
export const REFRESH_COOKIE = 'crm_refresh';

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

// --- Access token: short-lived, sent as Authorization: Bearer -----------------
// Kept named `signToken` for backward compatibility, but now short-lived.
export function signToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.ACCESS_EXPIRES_IN });
}
export const signAccessToken = signToken;

// --- Refresh token: long-lived, stored in the httpOnly cookie -----------------
// It only needs to identify the user; the fresh claims are re-read from the DB
// (or copied) when a new access token is minted.
export function signRefreshToken(payload) {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: env.REFRESH_EXPIRES_IN });
}
export function verifyRefreshToken(token) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
}

// --- Password-reset token: 10-minute JWT put inside the e-mailed link ---------
// A distinct `typ` claim stops a reset token being replayed as a login token.
export function signResetToken(payload) {
  return jwt.sign({ ...payload, typ: 'reset' }, env.JWT_SECRET, { expiresIn: env.RESET_EXPIRES_IN });
}
export function verifyResetToken(token) {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (decoded.typ !== 'reset') throw new Error('Not a reset token');
  return decoded;
}

// --- Refresh cookie helpers ---------------------------------------------------
export function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,               // JavaScript cannot read it → safe from XSS theft
    secure: env.COOKIE_SECURE,    // only sent over https in production
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',            // the browser only sends it to the auth routes
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, matches REFRESH_EXPIRES_IN
  });
}
export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
  });
}
// Read the refresh token out of the incoming request's Cookie header.
export function readRefreshCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const jar = cookie.parse(raw);
  return jar[REFRESH_COOKIE] || null;
}
