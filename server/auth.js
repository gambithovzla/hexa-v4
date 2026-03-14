/**
 * auth.js — JWT authentication routes for H.E.X.A. V4
 *
 * Routes:
 *   POST /api/auth/register — create account, return JWT
 *   POST /api/auth/login    — validate credentials, return JWT
 *   GET  /api/auth/me       — return current user (protected)
 *
 * Bankroll routes (mounted at /api/bankroll):
 *   GET    /api/bankroll            — get bankroll data
 *   POST   /api/bankroll/setup      — initialize bankroll
 *   POST   /api/bankroll/bet        — add a bet
 *   PATCH  /api/bankroll/bet/:betId — update bet result
 *   DELETE /api/bankroll/bet/:betId — remove a bet
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

// ── Bankroll helpers ──────────────────────────────────────────────────────────

function calcPotentialWin(stake, odds) {
  const s = Number(stake);
  const o = Number(odds);
  if (!s || !o || !isFinite(o)) return 0;
  return o > 0
    ? parseFloat((s * (o / 100)).toFixed(2))
    : parseFloat((s * (100 / Math.abs(o))).toFixed(2));
}

function getBankrollData(user) {
  return {
    initialBankroll:  user.initialBankroll  ?? null,
    currentBankroll:  user.currentBankroll  ?? null,
    bets:             user.bets             ?? [],
  };
}

// ── Auth Router ───────────────────────────────────────────────────────────────

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
      id:              randomUUID(),
      email:           email.toLowerCase().trim(),
      passwordHash,
      createdAt:       new Date().toISOString(),
      credits:         10,
      initialBankroll: null,
      currentBankroll: null,
      bets:            [],
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

// ── Admin seed ────────────────────────────────────────────────────────────────

export async function seedAdminUser() {
  const users = readUsers();
  if (users.find(u => u.email === 'admin@hexa.com')) return;
  const passwordHash = await bcrypt.hash('hexa2025admin', 10);
  users.push({
    id:              randomUUID(),
    email:           'admin@hexa.com',
    passwordHash,
    createdAt:       new Date().toISOString(),
    credits:         999999,
    initialBankroll: null,
    currentBankroll: null,
    bets:            [],
  });
  writeUsers(users);
  console.log('[H.E.X.A.] Admin account seeded');
}

// ── Bankroll Router (mounted at /api/bankroll) ────────────────────────────────

export const bankrollRouter = Router();

// GET /api/bankroll
bankrollRouter.get('/', verifyToken, (req, res) => {
  try {
    const users = readUsers();
    const user  = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, data: getBankrollData(user) });
  } catch (err) {
    console.error('[bankroll] GET error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bankroll/setup
bankrollRouter.post('/setup', verifyToken, (req, res) => {
  try {
    const { initialBankroll } = req.body ?? {};
    const amount = Number(initialBankroll);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'initialBankroll must be a positive number' });
    }

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    if (users[idx].initialBankroll !== null && users[idx].initialBankroll !== undefined) {
      return res.status(409).json({ error: 'Bankroll already initialized' });
    }

    users[idx].initialBankroll = amount;
    users[idx].currentBankroll = amount;
    users[idx].bets            = users[idx].bets ?? [];
    writeUsers(users);

    return res.json({ success: true, data: getBankrollData(users[idx]) });
  } catch (err) {
    console.error('[bankroll] setup error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bankroll/bet
bankrollRouter.post('/bet', verifyToken, (req, res) => {
  try {
    const { matchup, pick, odds, stake, source = 'manual', notes = '' } = req.body ?? {};

    if (!matchup || !pick || odds == null || !stake) {
      return res.status(400).json({ error: 'matchup, pick, odds, and stake are required' });
    }
    if (Number(stake) <= 0) {
      return res.status(400).json({ error: 'stake must be positive' });
    }

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const potentialWin = calcPotentialWin(stake, odds);

    const bet = {
      id:           `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date:         new Date().toISOString(),
      matchup:      String(matchup),
      pick:         String(pick),
      odds:         Number(odds),
      stake:        Number(stake),
      potentialWin,
      result:       'pending',
      source:       source === 'hexa' ? 'hexa' : 'manual',
      notes:        String(notes ?? ''),
    };

    users[idx].bets = users[idx].bets ?? [];
    users[idx].bets.push(bet);
    writeUsers(users);

    return res.json({ success: true, data: getBankrollData(users[idx]) });
  } catch (err) {
    console.error('[bankroll] add bet error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/bankroll/bet/:betId
bankrollRouter.patch('/bet/:betId', verifyToken, (req, res) => {
  try {
    const { betId }  = req.params;
    const { result } = req.body ?? {};

    if (!['pending', 'won', 'lost'].includes(result)) {
      return res.status(400).json({ error: 'result must be pending, won, or lost' });
    }

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const bets   = users[idx].bets ?? [];
    const betIdx = bets.findIndex(b => b.id === betId);
    if (betIdx === -1) return res.status(404).json({ error: 'Bet not found' });

    const bet         = bets[betIdx];
    const prevResult  = bet.result;
    let bankroll      = users[idx].currentBankroll ?? users[idx].initialBankroll ?? 0;

    // Reverse previous effect
    if (prevResult === 'won')  bankroll -= bet.potentialWin;
    if (prevResult === 'lost') bankroll += bet.stake;

    // Apply new effect
    if (result === 'won')  bankroll += bet.potentialWin;
    if (result === 'lost') bankroll -= bet.stake;

    bets[betIdx].result       = result;
    users[idx].bets           = bets;
    users[idx].currentBankroll = parseFloat(bankroll.toFixed(2));
    writeUsers(users);

    return res.json({ success: true, data: getBankrollData(users[idx]) });
  } catch (err) {
    console.error('[bankroll] update bet error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/bankroll/bet/:betId
bankrollRouter.delete('/bet/:betId', verifyToken, (req, res) => {
  try {
    const { betId } = req.params;

    const users = readUsers();
    const idx   = users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    const bets   = users[idx].bets ?? [];
    const bet    = bets.find(b => b.id === betId);
    if (!bet) return res.status(404).json({ error: 'Bet not found' });

    // Reverse the bet's effect on bankroll before deleting
    let bankroll = users[idx].currentBankroll ?? users[idx].initialBankroll ?? 0;
    if (bet.result === 'won')  bankroll -= bet.potentialWin;
    if (bet.result === 'lost') bankroll += bet.stake;

    users[idx].bets            = bets.filter(b => b.id !== betId);
    users[idx].currentBankroll = parseFloat(bankroll.toFixed(2));
    writeUsers(users);

    return res.json({ success: true, data: getBankrollData(users[idx]) });
  } catch (err) {
    console.error('[bankroll] delete bet error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});
