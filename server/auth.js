/**
 * auth.js — JWT authentication routes for H.E.X.A. V4
 *
 * Routes:
 *   POST /api/auth/register — create account, return JWT
 *   POST /api/auth/login    — validate credentials, return JWT
 *   GET  /api/auth/me       — return current user (protected)
 *
 * Users are stored in server/users.db.json as a flat JSON array.
 * New users start with 10 free credits.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';
import { verifyToken } from './middleware/auth-middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'users.db.json');

// ── DB helpers ────────────────────────────────────────────────────────────────

function readUsers() {
  if (!existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(readFileSync(DB_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  writeFileSync(DB_PATH, JSON.stringify(users, null, 2), 'utf8');
}

// ── Token helper ──────────────────────────────────────────────────────────────

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign(
    { id: user.id, email: user.email },
    secret,
    { expiresIn: '7d' }
  );
}

function safeUser(user) {
  const { passwordHash, ...rest } = user; // eslint-disable-line no-unused-vars
  return rest;
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id:           randomUUID(),
      email:        email.toLowerCase().trim(),
      passwordHash,
      createdAt:    new Date().toISOString(),
      credits:      10,
    };

    users.push(newUser);
    writeUsers(users);

    const token = signToken(newUser);
    return res.status(201).json({ token, user: safeUser(newUser) });
  } catch (err) {
    console.error('[auth] register error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const users = readUsers();
    const user  = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    return res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('[auth] login error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me  — protected
router.get('/me', verifyToken, (req, res) => {
  try {
    const users = readUsers();
    const user  = users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: safeUser(user) });
  } catch (err) {
    console.error('[auth] me error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
