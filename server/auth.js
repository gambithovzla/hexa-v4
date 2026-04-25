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
 * Storage: PostgreSQL via pool from db.js.
 * All queries use parameterized statements ($1, $2, …) — no string interpolation.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from './db.js';
import { verifyToken } from './middleware/auth-middleware.js';
import { generateCode, isEmailConfigured, sendVerificationEmail, sendPasswordResetEmail } from './email.js';

// ── Token helpers ──────────────────────────────────────────────────────────────

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin || false },
    secret,
    { expiresIn: '7d' }
  );
}

/** Strip password_hash before sending to client */
function safeUser(row) {
  return {
    id:             row.id,
    email:          row.email,
    credits:        Number(row.credits),
    is_admin:       row.is_admin || false,
    email_verified: row.email_verified ?? false,
    createdAt:      row.created_at,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_RESET_ATTEMPTS = 5;

function normalizeEmail(email) {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

function validEmail(email) {
  return EMAIL_RE.test(email);
}

function forgotPasswordResponse(res) {
  return res.json({
    success: true,
    message: 'If the email exists, a reset code has been sent.',
  });
}

// ── Bankroll helpers ───────────────────────────────────────────────────────────

function calcPotentialWin(stake, odds) {
  const s = Number(stake);
  const o = Number(odds);
  if (!s || !o || !isFinite(o)) return 0;
  return o > 0
    ? parseFloat((s * (o / 100)).toFixed(2))
    : parseFloat((s * (100 / Math.abs(o))).toFixed(2));
}

/**
 * Load bankroll + bets for a user and return the standard shape.
 * Returns { initialBankroll, currentBankroll, bets }.
 */
async function getBankrollData(userId) {
  const brRes = await pool.query(
    'SELECT initial_bankroll, current_bankroll FROM bankroll WHERE user_id = $1',
    [userId]
  );
  const br = brRes.rows[0] ?? null;

  const betsRes = await pool.query(
    `SELECT b.id, b.date, b.matchup, b.pick, b.odds, b.stake, b.potential_win,
            b.result, b.source, b.notes, b.pick_id,
            p.matchup AS pick_matchup, p.pick AS oracle_pick, p.result AS pick_result
     FROM bets b
     LEFT JOIN picks p ON b.pick_id = p.id
     WHERE b.user_id = $1
     ORDER BY b.created_at ASC`,
    [userId]
  );

  return {
    initialBankroll: br ? parseFloat(br.initial_bankroll) : null,
    currentBankroll: br ? parseFloat(br.current_bankroll) : null,
    bets: betsRes.rows.map(b => ({
      id:           b.id,
      date:         b.date,
      matchup:      b.matchup,
      pick:         b.pick,
      odds:         Number(b.odds),
      stake:        parseFloat(b.stake),
      potentialWin: parseFloat(b.potential_win),
      result:       b.result,
      source:       b.source,
      notes:        b.notes ?? '',
      pickId:       b.pick_id ?? null,
      pickMatchup:  b.pick_matchup ?? null,
      oraclePick:   b.oracle_pick ?? null,
      pickResult:   b.pick_result ?? null,
    })),
  };
}

// ── Auth Router ────────────────────────────────────────────────────────────────

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

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = randomUUID();

    const { rows } = await pool.query(
      `INSERT INTO users (id, email, password_hash, credits)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, credits, is_admin, email_verified, created_at`,
      [id, normalizedEmail, passwordHash, 0]
    );

    let newUser = rows[0];

    // Claim any pending BMC credits for this email
    const pending = await pool.query(
      'SELECT id, credits FROM pending_credits WHERE email = $1 AND claimed = false',
      [normalizedEmail]
    );
    if (pending.rows.length > 0) {
      const totalPending = pending.rows.reduce((sum, r) => sum + r.credits, 0);
      const pendingIds   = pending.rows.map(r => r.id);

      const updated = await pool.query(
        'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, email, credits, is_admin, email_verified, created_at',
        [totalPending, newUser.id]
      );
      await pool.query(
        'UPDATE pending_credits SET claimed = true WHERE id = ANY($1)',
        [pendingIds]
      );
      newUser = updated.rows[0];
      console.log(`[auth] Claimed ${totalPending} pending BMC credits for ${normalizedEmail}`);
    }

    // Generate and send verification code
    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    await pool.query(
      'UPDATE users SET verification_code = $1, verification_expires = $2 WHERE id = $3',
      [code, expires, newUser.id]
    );
    await sendVerificationEmail(normalizedEmail, code);

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

    const { rows } = await pool.query(
      'SELECT id, email, password_hash, credits, is_admin, email_verified, created_at FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
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

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email);
    if (!normalizedEmail || !validEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }
    if (!isEmailConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Email service is not configured. Please contact support.',
      });
    }

    const { rows } = await pool.query(
      'SELECT id, email, password_reset_requested_at FROM users WHERE email = $1',
      [normalizedEmail]
    );
    const user = rows[0];

    if (!user) {
      return forgotPasswordResponse(res);
    }

    if (user.password_reset_requested_at) {
      const lastRequest = new Date(user.password_reset_requested_at).getTime();
      if (Date.now() - lastRequest < RESET_RESEND_COOLDOWN_MS) {
        return forgotPasswordResponse(res);
      }
    }

    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expires = new Date(Date.now() + RESET_CODE_TTL_MS);

    await pool.query(
      `UPDATE users
       SET password_reset_code_hash = $1,
           password_reset_expires = $2,
           password_reset_requested_at = NOW(),
           password_reset_attempts = 0
       WHERE id = $3`,
      [codeHash, expires, user.id]
    );

    await sendPasswordResetEmail(user.email, code);
    return forgotPasswordResponse(res);
  } catch (err) {
    console.error('[auth] forgot-password error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? '').replace(/\D/g, '').slice(0, 6);
    const { password } = req.body ?? {};

    if (!normalizedEmail || !validEmail(normalizedEmail)) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }
    if (!code || code.length !== 6) {
      return res.status(400).json({ success: false, error: 'Reset code must be 6 digits' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const { rows } = await pool.query(
      `SELECT id, password_reset_code_hash, password_reset_expires, password_reset_attempts
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );
    const user = rows[0];
    const invalidMessage = 'Invalid or expired reset code';

    if (
      !user ||
      !user.password_reset_code_hash ||
      !user.password_reset_expires ||
      new Date(user.password_reset_expires) < new Date()
    ) {
      return res.status(400).json({ success: false, error: invalidMessage });
    }

    const attempts = Number(user.password_reset_attempts ?? 0);
    if (attempts >= MAX_RESET_ATTEMPTS) {
      await pool.query(
        `UPDATE users
         SET password_reset_code_hash = NULL,
             password_reset_expires = NULL,
             password_reset_requested_at = NULL,
             password_reset_attempts = 0
         WHERE id = $1`,
        [user.id]
      );
      return res.status(400).json({ success: false, error: invalidMessage });
    }

    const validCode = await bcrypt.compare(code, user.password_reset_code_hash);
    if (!validCode) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_RESET_ATTEMPTS) {
        await pool.query(
          `UPDATE users
           SET password_reset_code_hash = NULL,
               password_reset_expires = NULL,
               password_reset_requested_at = NULL,
               password_reset_attempts = 0
           WHERE id = $1`,
          [user.id]
        );
      } else {
        await pool.query(
          'UPDATE users SET password_reset_attempts = $1 WHERE id = $2',
          [nextAttempts, user.id]
        );
      }
      return res.status(400).json({ success: false, error: invalidMessage });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           email_verified = true,
           password_reset_code_hash = NULL,
           password_reset_expires = NULL,
           password_reset_requested_at = NULL,
           password_reset_attempts = 0
       WHERE id = $2`,
      [passwordHash, user.id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] reset-password error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/auth/me — protected
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, credits, is_admin, email_verified, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user: safeUser(rows[0]) });
  } catch (err) {
    console.error('[auth] me error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/verify-email — requires JWT, body: { code }
router.post('/verify-email', verifyToken, async (req, res) => {
  try {
    const { code } = req.body ?? {};
    if (!code) return res.status(400).json({ success: false, error: 'Code is required' });

    const { rows } = await pool.query(
      'SELECT verification_code, verification_expires FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    if (
      !user.verification_code ||
      user.verification_code !== String(code) ||
      !user.verification_expires ||
      new Date(user.verification_expires) < new Date()
    ) {
      return res.status(400).json({ success: false, error: 'Invalid or expired code' });
    }

    await pool.query(
      'UPDATE users SET email_verified = true, verification_code = NULL, verification_expires = NULL WHERE id = $1',
      [req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] verify-email error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth/resend-code — requires JWT, no body
router.post('/resend-code', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT email, email_verified, verification_expires FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.email_verified) return res.status(400).json({ success: false, error: 'Email already verified' });

    // Rate limit: allow resend only if last code was sent more than 1 minute ago
    if (user.verification_expires) {
      const sentAt = new Date(user.verification_expires).getTime() - 15 * 60 * 1000;
      if (Date.now() - sentAt < 60 * 1000) {
        return res.status(429).json({ success: false, error: 'Please wait 1 minute before requesting a new code' });
      }
    }

    const code = generateCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      'UPDATE users SET verification_code = $1, verification_expires = $2 WHERE id = $3',
      [code, expires, req.user.id]
    );
    await sendVerificationEmail(user.email, code);
    return res.json({ success: true });
  } catch (err) {
    console.error('[auth] resend-code error:', err.message);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;

// ── Admin seed ─────────────────────────────────────────────────────────────────

export async function seedAdminUser() {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    ['admin@hexa.com']
  );
  if (rows.length > 0) return;

  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'hexa2025admin';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, credits, is_admin)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), 'admin@hexa.com', passwordHash, 999999, true]
  );
  console.log('[H.E.X.A.] Admin account seeded');
}

// ── Bankroll Router (mounted at /api/bankroll) ─────────────────────────────────

export const bankrollRouter = Router();

// GET /api/bankroll
bankrollRouter.get('/', verifyToken, async (req, res) => {
  try {
    const data = await getBankrollData(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[bankroll] GET error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bankroll/setup
bankrollRouter.post('/setup', verifyToken, async (req, res) => {
  try {
    const { initialBankroll } = req.body ?? {};
    const amount = Number(initialBankroll);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'initialBankroll must be a positive number' });
    }

    // Check if already initialized
    const existing = await pool.query(
      'SELECT user_id FROM bankroll WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Bankroll already initialized' });
    }

    await pool.query(
      `INSERT INTO bankroll (user_id, initial_bankroll, current_bankroll)
       VALUES ($1, $2, $2)`,
      [req.user.id, amount]
    );

    const data = await getBankrollData(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[bankroll] setup error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/bankroll/setup — modify initial bankroll
bankrollRouter.patch('/setup', verifyToken, async (req, res) => {
  try {
    const { initialBankroll } = req.body ?? {};
    const amount = Number(initialBankroll);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'initialBankroll must be a positive number' });
    }

    const existing = await pool.query(
      'SELECT user_id, current_bankroll, initial_bankroll FROM bankroll WHERE user_id = $1',
      [req.user.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Bankroll not initialized' });
    }

    // Adjust current_bankroll proportionally to the change
    const oldInitial = parseFloat(existing.rows[0].initial_bankroll);
    const oldCurrent = parseFloat(existing.rows[0].current_bankroll);
    const diff = amount - oldInitial;
    const newCurrent = Math.max(0, oldCurrent + diff);

    await pool.query(
      'UPDATE bankroll SET initial_bankroll = $1, current_bankroll = $2 WHERE user_id = $3',
      [amount, newCurrent, req.user.id]
    );

    const data = await getBankrollData(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[bankroll] patch setup error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bankroll/bet
bankrollRouter.post('/bet', verifyToken, async (req, res) => {
  try {
    const { matchup, pick, odds, stake, source = 'manual', notes = '', pick_id = null } = req.body ?? {};

    if (!matchup || !pick || odds == null || !stake) {
      return res.status(400).json({ error: 'matchup, pick, odds, and stake are required' });
    }
    if (Number(stake) <= 0) {
      return res.status(400).json({ error: 'stake must be positive' });
    }

    const potentialWin = calcPotentialWin(stake, odds);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pickId = pick_id != null ? Number(pick_id) : null;

    await pool.query(
      `INSERT INTO bets (id, user_id, matchup, pick, odds, stake, potential_win, result, source, notes, pick_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)`,
      [
        id,
        req.user.id,
        String(matchup),
        String(pick),
        Number(odds),
        Number(stake),
        potentialWin,
        source === 'hexa' ? 'hexa' : 'manual',
        String(notes ?? ''),
        pickId,
      ]
    );

    const data = await getBankrollData(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[bankroll] add bet error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/bankroll/bet/:betId
bankrollRouter.patch('/bet/:betId', verifyToken, async (req, res) => {
  try {
    const { betId }  = req.params;
    const { result } = req.body ?? {};

    if (!['pending', 'won', 'lost'].includes(result)) {
      return res.status(400).json({ error: 'result must be pending, won, or lost' });
    }

    // Load the bet (must belong to this user)
    const betRes = await pool.query(
      'SELECT id, odds, stake, potential_win, result FROM bets WHERE id = $1 AND user_id = $2',
      [betId, req.user.id]
    );
    if (!betRes.rows[0]) {
      return res.status(404).json({ error: 'Bet not found' });
    }
    const bet = betRes.rows[0];

    // Load current bankroll to adjust
    const brRes = await pool.query(
      'SELECT current_bankroll FROM bankroll WHERE user_id = $1',
      [req.user.id]
    );
    let bankroll = brRes.rows[0] ? parseFloat(brRes.rows[0].current_bankroll) : 0;

    // Reverse previous effect
    if (bet.result === 'won')  bankroll -= parseFloat(bet.potential_win);
    if (bet.result === 'lost') bankroll += parseFloat(bet.stake);

    // Apply new effect
    if (result === 'won')  bankroll += parseFloat(bet.potential_win);
    if (result === 'lost') bankroll -= parseFloat(bet.stake);

    bankroll = parseFloat(bankroll.toFixed(2));

    await pool.query('UPDATE bets SET result = $1 WHERE id = $2', [result, betId]);
    await pool.query(
      'UPDATE bankroll SET current_bankroll = $1, updated_at = NOW() WHERE user_id = $2',
      [bankroll, req.user.id]
    );

    const data = await getBankrollData(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[bankroll] update bet error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/bankroll/bet/:betId
bankrollRouter.delete('/bet/:betId', verifyToken, async (req, res) => {
  try {
    const { betId } = req.params;

    const betRes = await pool.query(
      'SELECT id, stake, potential_win, result FROM bets WHERE id = $1 AND user_id = $2',
      [betId, req.user.id]
    );
    if (!betRes.rows[0]) {
      return res.status(404).json({ error: 'Bet not found' });
    }
    const bet = betRes.rows[0];

    // Reverse the bet's effect on bankroll before deleting
    const brRes = await pool.query(
      'SELECT current_bankroll FROM bankroll WHERE user_id = $1',
      [req.user.id]
    );
    let bankroll = brRes.rows[0] ? parseFloat(brRes.rows[0].current_bankroll) : 0;

    if (bet.result === 'won')  bankroll -= parseFloat(bet.potential_win);
    if (bet.result === 'lost') bankroll += parseFloat(bet.stake);
    bankroll = parseFloat(bankroll.toFixed(2));

    await pool.query('DELETE FROM bets WHERE id = $1', [betId]);
    await pool.query(
      'UPDATE bankroll SET current_bankroll = $1, updated_at = NOW() WHERE user_id = $2',
      [bankroll, req.user.id]
    );

    const data = await getBankrollData(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[bankroll] delete bet error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── KELLY CRITERION ────────────────────────────────────────────────
function calcKellyStake(currentBankroll, oracleConfidence, odds) {
  // Convertir odds americanas a decimales
  let decimalOdds;
  if (odds > 0) {
    decimalOdds = (odds / 100) + 1;
  } else {
    decimalOdds = (100 / Math.abs(odds)) + 1;
  }
  const b = decimalOdds - 1; // ganancia neta por unidad
  const p = oracleConfidence / 100; // probabilidad según Oracle (0-1)
  const q = 1 - p;
  // Kelly fraction = (bp - q) / b
  const kellyFraction = (b * p - q) / b;
  // Aplicar Kelly conservador (25% del Kelly completo para gestión de riesgo)
  const conservativeKelly = Math.max(0, kellyFraction * 0.25);
  // Stake sugerido (máximo 5% del bankroll como tope de seguridad)
  const suggestedStake = Math.min(
    currentBankroll * conservativeKelly,
    currentBankroll * 0.05
  );
  return Math.round(suggestedStake * 100) / 100;
}

// GET /api/bankroll/kelly?odds=-110&confidence=72
bankrollRouter.get('/kelly', verifyToken, async (req, res) => {
  const { odds, confidence } = req.query;
  const userId = req.user.id;
  try {
    const result = await pool.query(
      'SELECT current_bankroll FROM bankroll WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Bankroll no configurado' });
    }
    const currentBankroll = parseFloat(result.rows[0].current_bankroll);
    const parsedOdds = parseFloat(odds);
    const parsedConfidence = parseFloat(confidence);
    if (!parsedOdds || !parsedConfidence) {
      return res.status(400).json({ error: 'odds y confidence son requeridos' });
    }
    const suggestedStake = calcKellyStake(currentBankroll, parsedConfidence, parsedOdds);
    res.json({
      success: true,
      data: {
        currentBankroll,
        suggestedStake,
        kellyInputs: { odds: parsedOdds, confidence: parsedConfidence }
      }
    });
  } catch (err) {
    console.error('Kelly error:', err);
    res.status(500).json({ error: 'Error calculando Kelly' });
  }
});

// GET /api/bankroll/stats
bankrollRouter.get('/stats', verifyToken, async (req, res) => {
  const userId = req.user.id;
  try {
    // Stats generales
    const generalStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE result = 'won') as wins,
        COUNT(*) FILTER (WHERE result = 'lost') as losses,
        COUNT(*) FILTER (WHERE result = 'pending') as pending,
        COUNT(*) FILTER (WHERE result = 'push') as pushes,
        COUNT(*) as total,
        COALESCE(SUM(CASE
          WHEN result = 'won' THEN stake * (
            CASE WHEN odds > 0 THEN odds::float/100 ELSE 100.0/ABS(odds) END
          )
          WHEN result = 'lost' THEN -stake
          ELSE 0
        END), 0) as total_profit
      FROM bets WHERE user_id = $1
    `, [userId]);

    // Stats por tipo de pick (usando matchup como referencia)
    const bySource = await pool.query(`
      SELECT
        source,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE result = 'won') as wins,
        ROUND(
          COUNT(*) FILTER (WHERE result = 'won')::numeric /
          NULLIF(COUNT(*) FILTER (WHERE result IN ('won','lost')), 0) * 100, 1
        ) as win_rate
      FROM bets WHERE user_id = $1 GROUP BY source
    `, [userId]);

    // Evolución del bankroll (últimas 30 apuestas)
    const bankrollHistory = await pool.query(`
      SELECT id, created_at, stake, odds, result, matchup, pick
      FROM bets WHERE user_id = $1 ORDER BY created_at ASC LIMIT 30
    `, [userId]);

    // Bankroll actual
    const bankrollResult = await pool.query(
      'SELECT initial_bankroll, current_bankroll FROM bankroll WHERE user_id = $1',
      [userId]
    );

    const stats = generalStats.rows[0];
    const total = parseInt(stats.total);
    const settled = parseInt(stats.wins) + parseInt(stats.losses);

    res.json({
      success: true,
      data: {
        bankroll: bankrollResult.rows[0] || null,
        general: {
          wins: parseInt(stats.wins),
          losses: parseInt(stats.losses),
          pushes: parseInt(stats.pushes),
          pending: parseInt(stats.pending),
          total,
          winRate: settled > 0 ? Math.round((stats.wins / settled) * 100 * 10) / 10 : 0,
          totalProfit: parseFloat(stats.total_profit),
          roi: bankrollResult.rows[0]
            ? Math.round((stats.total_profit / bankrollResult.rows[0].initial_bankroll) * 100 * 10) / 10
            : 0
        },
        bySource: bySource.rows,
        bankrollHistory: bankrollHistory.rows
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});
