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
