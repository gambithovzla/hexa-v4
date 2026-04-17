/**
 * auth-middleware.js — JWT verification middleware for H.E.X.A. V4
 *
 * verifyToken(req, res, next)
 *   Extracts the Bearer token from the Authorization header,
 *   verifies it against JWT_SECRET, and attaches the decoded
 *   payload to req.user.
 *
 *   Returns 401 { error: 'Unauthorized' } if token is missing or invalid.
 */

import jwt from 'jsonwebtoken';
import pool from '../db.js';

export function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not configured');
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

/**
 * requireVerifiedEmail — must follow verifyToken.
 * Looks up the current user and rejects if email_verified is not true.
 * Admins are always allowed through so ops work isn't blocked.
 */
export async function requireVerifiedEmail(req, res, next) {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.user.is_admin === true) return next();

  try {
    const { rows } = await pool.query(
      'SELECT email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (rows[0].email_verified !== true) {
      return res.status(403).json({
        success: false,
        error:   'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before saving picks.',
      });
    }
    next();
  } catch {
    return res.status(500).json({ success: false, error: 'Verification check failed' });
  }
}
