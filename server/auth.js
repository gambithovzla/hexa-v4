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

// ── Token helpers ──────────────────────────────────────────────────────────────

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign(
    { id: user.id, email: user.email },
    secret,
    { expiresIn: '7d' }
  );
}

/** Strip password_hash before sending to client */
function safeUser(row) {
  return {
    id:        row.id,
    email:     row.email,
    credits:   Number(row.credits),
    createdAt: row.created_at,
  };
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
    `SELECT id, date, matchup, pick, odds, stake, potential_win, result, source, notes
     FROM bets WHERE user_id = $1 ORDER BY created_at ASC`,
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
       RETURNING id, email, credits, created_at`,
      [id, normalizedEmail, passwordHash, 5]
    );

    const newUser = rows[0];
    const token   = signToken(newUser);
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
      'SELECT id, email, password_hash, credits, created_at FROM users WHERE email = $1',
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

// GET /api/auth/me — protected
router.get('/me', verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, credits, created_at FROM users WHERE id = $1',
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

export default router;

// ── Admin seed ─────────────────────────────────────────────────────────────────

export async function seedAdminUser() {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE email = $1',
    ['admin@hexa.com']
  );
  if (rows.length > 0) return;

  const passwordHash = await bcrypt.hash('hexa2025admin', 10);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, credits)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), 'admin@hexa.com', passwordHash, 999999]
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

// POST /api/bankroll/bet
bankrollRouter.post('/bet', verifyToken, async (req, res) => {
  try {
    const { matchup, pick, odds, stake, source = 'manual', notes = '' } = req.body ?? {};

    if (!matchup || !pick || odds == null || !stake) {
      return res.status(400).json({ error: 'matchup, pick, odds, and stake are required' });
    }
    if (Number(stake) <= 0) {
      return res.status(400).json({ error: 'stake must be positive' });
    }

    const potentialWin = calcPotentialWin(stake, odds);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await pool.query(
      `INSERT INTO bets (id, user_id, matchup, pick, odds, stake, potential_win, result, source, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)`,
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
bankrollRouter.get('/kelly', authenticateToken, async (req, res) => {
  const { odds, confidence } = req.query;
  const userId = req.user.userId;
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
bankrollRouter.get('/stats', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    // Stats generales
    const generalStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE result = 'won') as wins,
        COUNT(*) FILTER (WHERE result = 'lost') as losses,
        COUNT(*) FILTER (WHERE result = 'pending') as pending,
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
