import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { env } from '../config/env.js';

/**
 * Asset uploads (Cloudinary), the SIGNED way.
 *
 * The browser never sees the API secret. It asks this route for a short-lived
 * signature, then uploads the file DIRECTLY to Cloudinary (so the bytes don't
 * pass through our server). The signature ties the upload to the exact params
 * we approved (timestamp + folder), and Cloudinary rejects anything else.
 */

const router = Router();
router.use(requireAuth);

export function cloudinaryConfigured() {
  return !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

// GET /api/uploads/status — lets the UI hide the upload button when it's not set up.
router.get('/status', (req, res) => {
  res.json({ configured: cloudinaryConfigured(), cloudName: env.CLOUDINARY_CLOUD_NAME || '' });
});

// POST /api/uploads/sign  { folder? }
// Returns everything the browser needs for one signed upload.
router.post('/sign', asyncHandler(async (req, res) => {
  if (!cloudinaryConfigured()) {
    return res.status(503).json({
      error: 'Uploads are not configured on the server. Set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET.',
    });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  // Keep the folder to a safe, predictable charset.
  const folder = String((req.body && req.body.folder) || 'crm').replace(/[^a-zA-Z0-9/_-]/g, '') || 'crm';

  // Cloudinary signs the upload params sorted alphabetically, joined as
  // `key=value&…`, with the API secret appended, hashed with SHA-1.
  const toSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + env.CLOUDINARY_API_SECRET).digest('hex');

  res.json({
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature,
  });
}));

export default router;
