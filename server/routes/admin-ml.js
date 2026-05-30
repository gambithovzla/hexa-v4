/**
 * server/routes/admin-ml.js
 *
 * Admin endpoints for the ML Control Center. All routes require verifyToken + requireAdmin.
 *
 *   GET  /api/admin/ml/status                       Quick health: sidecar enabled, circuit state, last ping
 *   GET  /api/admin/ml/ensemble                     Ensemble manifest (per-source Brier + learned weights)
 *   POST /api/admin/ml/retrain                      Trigger per-market retrain on the Python sidecar
 *   POST /api/admin/ml/retrain/ensemble             Trigger ensemble retrain on the Python sidecar
 *   GET  /api/admin/ml/retrain-log                  Last 20 retrain attempts (from ml_retrain_log)
 *   GET  /api/admin/picks/:pickId/ensemble-breakdown
 *                                                   Per-pick breakdown: 3 source probs + ensemble combination
 *
 * The retrain endpoints proxy directly to the Python sidecar (not via mlModelClient,
 * which has a 500ms timeout for inference). Each invocation writes an audit row to
 * ml_retrain_log so the dashboard can render history. A simple in-process rate limit
 * prevents accidental double-trigger (1 retrain per scope every 5 minutes).
 */

import express from 'express';
import pool from '../db.js';
import { verifyToken, requireAdmin } from '../middleware/auth-middleware.js';
import { computeAdminEquity } from '../services/admin-equity.js';
import { simulateBankroll } from '../services/monteCarloSimulator.js';
import {
  getCalibration as getMlCalibration,
  getCircuitState as getMlCircuitState,
  isEnabled as isMlSidecarEnabled,
  isEnsembleEnabled as isMlEnsembleEnabled,
  getEnsembleCalibration as getMlEnsembleCalibration,
  predictEnsemble as predictMlEnsemble,
} from '../services/mlModelClient.js';
import { buildMlObservability } from '../services/mlModelHealth.js';

const router = express.Router();
router.use(verifyToken, requireAdmin);

// ── Sidecar config (admin-only paths bypass the 500ms inference timeout) ──────

const ML_API_URL = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const ML_TOKEN   = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';
const RETRAIN_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes — training can be slow
const HEALTH_TIMEOUT_MS  = 2_000;

const ALLOWED_MARKETS = new Set([
  'all',
  'moneyline', 'overunder', 'runline',
  'prop_hits', 'prop_strikeouts', 'prop_total_bases', 'prop_home_runs', 'prop_rbis',
]);

// In-process rate limit: 1 retrain per scope every 5 minutes.
const _lastRetrainAt = new Map();
const RETRAIN_COOLDOWN_MS = 5 * 60 * 1000;

function _buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ML_TOKEN) headers['Authorization'] = `Bearer ${ML_TOKEN}`;
  return headers;
}

async function _fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function _logRetrain({ userId, market, scope, status, brier, logloss, nTrain, nTest, durationMs, error, response }) {
  try {
    await pool.query(
      `INSERT INTO ml_retrain_log
         (user_id, market, scope, status, brier, logloss, n_train, n_test, duration_ms, error, response, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())`,
      [
        userId ?? null,
        market,
        scope,
        status,
        brier ?? null,
        logloss ?? null,
        nTrain ?? null,
        nTest ?? null,
        durationMs ?? null,
        error ?? null,
        response ? JSON.stringify(response) : null,
      ]
    );
  } catch (err) {
    console.warn(`[admin-ml] failed to write ml_retrain_log: ${err.message}`);
  }
}

function _extractMetrics(payload, market) {
  // /retrain         → { status, summary: { [market]: {n_train, n_test, brier_test, logloss_test, ...} | null } }
  // /retrain/ensemble → { status, summary: { [market]: {...ensemble metrics...} } }
  if (!payload || typeof payload !== 'object') return { brier: null, logloss: null, nTrain: null, nTest: null };
  const summary = payload.summary ?? payload.manifest ?? payload;
  const block = summary?.[market] ?? summary?.moneyline ?? null;
  if (!block) return { brier: null, logloss: null, nTrain: null, nTest: null };
  return {
    brier:   block.brier_test   ?? block.brier        ?? block.brier_ensemble ?? null,
    logloss: block.logloss_test ?? block.logloss      ?? null,
    nTrain:  block.n_train      ?? null,
    nTest:   block.n_test       ?? null,
  };
}

// ── GET /api/admin/ml/status ─────────────────────────────────────────────────

router.get('/ml/status', async (_req, res) => {
  const enabled = isMlSidecarEnabled();
  const ensembleEnabled = isMlEnsembleEnabled();
  const circuit = getMlCircuitState();

  const result = {
    success: true,
    enabled,
    ensemble_enabled: ensembleEnabled,
    sidecar_url: ML_API_URL || null,
    circuit,
    health: null,
    health_latency_ms: null,
    last_retrain: null,
  };

  if (enabled && ML_API_URL) {
    const t0 = Date.now();
    try {
      const resp = await _fetchWithTimeout(`${ML_API_URL}/health`, { method: 'GET', headers: _buildHeaders() }, HEALTH_TIMEOUT_MS);
      result.health_latency_ms = Date.now() - t0;
      if (resp.ok) {
        result.health = await resp.json();
      } else {
        result.health = { ok: false, status: resp.status };
      }
    } catch (err) {
      result.health = { ok: false, error: err.message };
      result.health_latency_ms = Date.now() - t0;
    }
  }

  try {
    const { rows } = await pool.query(
      `SELECT market, scope, status, brier, n_train, duration_ms, created_at, finished_at
         FROM ml_retrain_log
        ORDER BY created_at DESC
        LIMIT 1`
    );
    result.last_retrain = rows[0] ?? null;
  } catch {
    /* table may not exist yet on first deploy — ignore */
  }

  result.observability = buildMlObservability({
    enabled,
    ensembleEnabled,
    circuit,
    health: result.health?.status === 'ok' ? result.health : null,
  });

  res.json(result);
});

// ── GET /api/admin/ml/ensemble ───────────────────────────────────────────────

router.get('/ml/ensemble', async (_req, res) => {
  const enabled = isMlEnsembleEnabled();
  const manifest = enabled ? await getMlEnsembleCalibration() : null;
  res.json({ success: true, enabled, manifest });
});

// ── GET /api/admin/ml/retrain-log ────────────────────────────────────────────

router.get('/ml/retrain-log', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.user_id, u.email AS user_email,
              r.market, r.scope, r.status, r.brier, r.logloss,
              r.n_train, r.n_test, r.duration_ms, r.error,
              r.created_at, r.finished_at
         FROM ml_retrain_log r
         LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/admin/ml/retrain ───────────────────────────────────────────────

router.post('/ml/retrain', async (req, res) => {
  if (!isMlSidecarEnabled() || !ML_API_URL) {
    return res.status(400).json({
      success: false,
      error: 'ML_SIDECAR_ENABLED=false or HEXA_ML_API_URL not set. Configure these env vars on the server first.',
    });
  }

  const market = String(req.body?.market ?? 'all').toLowerCase();
  if (!ALLOWED_MARKETS.has(market)) {
    return res.status(400).json({ success: false, error: `Invalid market. Must be one of: ${Array.from(ALLOWED_MARKETS).join(', ')}` });
  }

  // Cooldown — protects against double-clicks and runaway retries.
  const scopeKey = `market:${market}`;
  const last = _lastRetrainAt.get(scopeKey) ?? 0;
  const wait = RETRAIN_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) {
    return res.status(429).json({
      success: false,
      error: `Cooldown active. Try again in ${Math.ceil(wait / 1000)}s.`,
      cooldown_seconds_remaining: Math.ceil(wait / 1000),
    });
  }
  _lastRetrainAt.set(scopeKey, Date.now());

  const t0 = Date.now();
  const body = { market };
  if (req.body?.force === true) body.force = true;
  if (Number.isFinite(Number(req.body?.min_train_size_override))) {
    body.min_train_size_override = Number(req.body.min_train_size_override);
  }

  let response = null;
  let httpStatus = 0;
  let errorText = null;

  try {
    const resp = await _fetchWithTimeout(
      `${ML_API_URL}/retrain`,
      { method: 'POST', headers: _buildHeaders(), body: JSON.stringify(body) },
      RETRAIN_TIMEOUT_MS
    );
    httpStatus = resp.status;
    if (resp.ok) {
      response = await resp.json().catch(() => null);
    } else {
      errorText = await resp.text().catch(() => '');
    }
  } catch (err) {
    errorText = err.message;
  }

  const durationMs = Date.now() - t0;
  const status = response && !errorText ? 'success' : 'failed';
  const metrics = _extractMetrics(response, market === 'all' ? 'moneyline' : market);

  await _logRetrain({
    userId: req.user?.id,
    market,
    scope: 'market',
    status,
    ...metrics,
    durationMs,
    error: errorText,
    response,
  });

  if (status !== 'success') {
    return res.status(httpStatus >= 400 ? httpStatus : 502).json({
      success: false,
      error: errorText ?? 'Retrain failed',
      duration_ms: durationMs,
    });
  }

  res.json({
    success: true,
    duration_ms: durationMs,
    market,
    metrics,
    response,
  });
});

// ── POST /api/admin/ml/retrain/ensemble ──────────────────────────────────────

router.post('/ml/retrain/ensemble', async (req, res) => {
  if (!isMlEnsembleEnabled()) {
    return res.status(400).json({
      success: false,
      error: 'ENSEMBLE_ENABLED=false or sidecar disabled. Set ENSEMBLE_ENABLED=true to use the meta-learner.',
    });
  }

  const scopeKey = 'ensemble';
  const last = _lastRetrainAt.get(scopeKey) ?? 0;
  const wait = RETRAIN_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) {
    return res.status(429).json({
      success: false,
      error: `Cooldown active. Try again in ${Math.ceil(wait / 1000)}s.`,
      cooldown_seconds_remaining: Math.ceil(wait / 1000),
    });
  }
  _lastRetrainAt.set(scopeKey, Date.now());

  const t0 = Date.now();
  const body = {};
  if (req.body?.force === true) body.force = true;
  if (Number.isFinite(Number(req.body?.min_rows))) body.min_rows = Number(req.body.min_rows);

  let response = null;
  let httpStatus = 0;
  let errorText = null;

  try {
    const resp = await _fetchWithTimeout(
      `${ML_API_URL}/retrain/ensemble`,
      { method: 'POST', headers: _buildHeaders(), body: JSON.stringify(body) },
      RETRAIN_TIMEOUT_MS
    );
    httpStatus = resp.status;
    if (resp.ok) {
      response = await resp.json().catch(() => null);
    } else {
      errorText = await resp.text().catch(() => '');
    }
  } catch (err) {
    errorText = err.message;
  }

  const durationMs = Date.now() - t0;
  const httpOk = response && !errorText;
  const metrics = _extractMetrics(response, 'ensemble');

  // Detect the "soft skip" case: sidecar returned 200 but every market
  // in the summary is null, which means train_ensemble_one() bailed out
  // (not enough eligible rows in shadow_model_runs). The /retrain/ensemble
  // endpoint also short-circuits in <1s in that case. Surface this to the
  // UI as a warning, not a success, and include the actual eligible-row
  // count so the admin knows how far from the threshold they are.
  let skipped = false;
  let eligibleRows = null;
  let minRowsRequired = Number(req.body?.min_rows) || 50;
  if (httpOk) {
    const summary = response.summary ?? {};
    const marketKeys = Object.keys(summary);
    const allNull = marketKeys.length > 0 && marketKeys.every((k) => summary[k] == null);
    if (allNull || metrics.nTrain == null) {
      skipped = true;
      try {
        const { rows: mktRows } = await pool.query(
          `SELECT COALESCE(pick_market_type, 'unknown') AS market,
                  COUNT(*)::INT AS eligible
             FROM shadow_model_runs
            WHERE oracle_pick_prob IS NOT NULL
              AND legacy_pick_prob IS NOT NULL
              AND python_pick_prob IS NOT NULL
              AND actual_status    = 'resolved'
              AND pick_market_type IN ('moneyline','overunder','runline','prop')
            GROUP BY pick_market_type`
        );
        const byMarket = Object.fromEntries(mktRows.map((r) => [r.market, r.eligible]));
        eligibleRows = mktRows.reduce((s, r) => s + r.eligible, 0);
        // attach per-market breakdown so the UI can show it
        response = { ...(response ?? {}), eligible_by_market: byMarket };
      } catch (err) {
        console.warn(`[admin-ml] eligible-rows query failed: ${err.message}`);
      }
    }
  }

  const status = httpOk ? (skipped ? 'skipped' : 'success') : 'failed';

  await _logRetrain({
    userId: req.user?.id,
    market: 'ensemble',
    scope: 'ensemble',
    status,
    ...metrics,
    durationMs,
    error: errorText
      ?? (skipped
        ? `Skipped — only ${eligibleRows ?? '?'} eligible rows (need >= ${minRowsRequired})`
        : null),
    response,
  });

  if (status === 'failed') {
    return res.status(httpStatus >= 400 ? httpStatus : 502).json({
      success: false,
      error: errorText ?? 'Ensemble retrain failed',
      duration_ms: durationMs,
    });
  }

  res.json({
    success: true,
    skipped,
    eligible_rows: eligibleRows,
    eligible_by_market: response?.eligible_by_market ?? null,
    min_rows_required: minRowsRequired,
    duration_ms: durationMs,
    metrics,
    response,
  });
});

// ── GET /api/admin/ml/chat-picks-stats ───────────────────────────────────────

router.get('/ml/chat-picks-stats', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)                                  AS total,
         COUNT(*) FILTER (WHERE result = 'win')    AS wins,
         COUNT(*) FILTER (WHERE result = 'loss')   AS losses,
         COUNT(*) FILTER (WHERE result = 'push')   AS pushes,
         COUNT(*) FILTER (WHERE result IS NULL OR result = 'pending') AS pending,
         COUNT(DISTINCT chat_session_id) FILTER (WHERE chat_session_id IS NOT NULL) AS unique_sessions,
         COUNT(*) FILTER (WHERE result IN ('win','loss')) AS settled,
         CASE
           WHEN COUNT(*) FILTER (WHERE result IN ('win','loss')) > 0
           THEN ROUND(
             100.0 * COUNT(*) FILTER (WHERE result = 'win')
             / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss')), 0),
             1
           )
           ELSE NULL
         END AS hit_rate,
         ROUND(
           SUM(
             CASE
               WHEN result = 'win' THEN
                 CASE
                   WHEN COALESCE(odds_at_pick, -110) > 0 THEN COALESCE(odds_at_pick, -110)::numeric / 100.0
                   ELSE 100.0 / ABS(COALESCE(odds_at_pick, -110)::numeric)
                 END
               WHEN result = 'loss' THEN -1.0
               WHEN result = 'push' THEN 0.0
               ELSE 0.0
             END
           )::numeric,
           3
         ) AS units_profit,
         CASE
           WHEN COUNT(*) FILTER (WHERE result IN ('win','loss','push')) > 0
           THEN ROUND(
             100.0 * SUM(
               CASE
                 WHEN result = 'win' THEN
                   CASE
                     WHEN COALESCE(odds_at_pick, -110) > 0 THEN COALESCE(odds_at_pick, -110)::numeric / 100.0
                     ELSE 100.0 / ABS(COALESCE(odds_at_pick, -110)::numeric)
                   END
                 WHEN result = 'loss' THEN -1.0
                 WHEN result = 'push' THEN 0.0
                 ELSE 0.0
               END
             ) / NULLIF(COUNT(*) FILTER (WHERE result IN ('win','loss','push')), 0),
             1
           )
           ELSE NULL
         END AS roi_pct,
         MIN(created_at)                           AS first_at,
         MAX(created_at)                           AS last_at
       FROM picks
       WHERE source = 'oracle_chat' AND deleted_at IS NULL`
    );

    const byMarketRes = await pool.query(
      `SELECT
          pf.market_type,
          COUNT(*) AS n,
          COUNT(*) FILTER (WHERE p.result = 'win') AS wins,
          COUNT(*) FILTER (WHERE p.result = 'loss') AS losses,
          CASE
            WHEN COUNT(*) FILTER (WHERE p.result IN ('win','loss')) > 0
            THEN ROUND(100.0 * COUNT(*) FILTER (WHERE p.result = 'win') / NULLIF(COUNT(*) FILTER (WHERE p.result IN ('win','loss')), 0), 1)
            ELSE NULL
          END AS hit_rate
         FROM pick_features pf
         JOIN picks p ON p.id = pf.pick_id
        WHERE p.source = 'oracle_chat' AND pf.market_type IS NOT NULL
        GROUP BY pf.market_type
        ORDER BY n DESC`
    );

    const bySportRes = await pool.query(
      `SELECT
          COALESCE(p.sport, 'mlb') AS sport,
          COUNT(*) AS n,
          COUNT(*) FILTER (WHERE p.result = 'win') AS wins,
          COUNT(*) FILTER (WHERE p.result = 'loss') AS losses,
          COUNT(*) FILTER (WHERE p.result IS NULL OR p.result = 'pending') AS pending,
          CASE
            WHEN COUNT(*) FILTER (WHERE p.result IN ('win','loss')) > 0
            THEN ROUND(100.0 * COUNT(*) FILTER (WHERE p.result = 'win') / NULLIF(COUNT(*) FILTER (WHERE p.result IN ('win','loss')), 0), 1)
            ELSE NULL
          END AS hit_rate
        FROM picks p
        WHERE p.source = 'oracle_chat' AND p.deleted_at IS NULL
        GROUP BY COALESCE(p.sport, 'mlb')
        ORDER BY n DESC`
    );

    const byModeRes = await pool.query(
      `SELECT
          COALESCE(os.mode, 'unlinked') AS mode,
          COUNT(*) AS n,
          COUNT(*) FILTER (WHERE p.result = 'win') AS wins,
          COUNT(*) FILTER (WHERE p.result = 'loss') AS losses,
          COUNT(*) FILTER (WHERE p.result IS NULL OR p.result = 'pending') AS pending,
          CASE
            WHEN COUNT(*) FILTER (WHERE p.result IN ('win','loss')) > 0
            THEN ROUND(100.0 * COUNT(*) FILTER (WHERE p.result = 'win') / NULLIF(COUNT(*) FILTER (WHERE p.result IN ('win','loss')), 0), 1)
            ELSE NULL
          END AS hit_rate
        FROM picks p
        LEFT JOIN oracle_sessions os ON os.id = p.chat_session_id
        WHERE p.source = 'oracle_chat' AND p.deleted_at IS NULL
        GROUP BY COALESCE(os.mode, 'unlinked')
        ORDER BY n DESC`
    );

    const recentRes = await pool.query(
      `SELECT p.id, p.matchup, p.pick, p.oracle_confidence, p.result, p.created_at,
              COALESCE(p.sport, 'mlb') AS sport,
              COALESCE(os.mode, 'unlinked') AS mode,
              pf.market_type, pf.side, pf.line
         FROM picks p
         LEFT JOIN pick_features pf ON pf.pick_id = p.id
         LEFT JOIN oracle_sessions os ON os.id = p.chat_session_id
        WHERE p.source = 'oracle_chat' AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT 20`
    );

    res.json({
      success: true,
      summary: rows[0] ?? null,
      by_market: byMarketRes.rows,
      by_sport: bySportRes.rows,
      by_mode: byModeRes.rows,
      recent: recentRes.rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/admin/picks/:pickId/ensemble-breakdown ──────────────────────────

router.get('/picks/:pickId/ensemble-breakdown', async (req, res) => {
  const pickId = Number(req.params.pickId);
  if (!Number.isFinite(pickId)) {
    return res.status(400).json({ success: false, error: 'Invalid pick id' });
  }

  try {
    const pickRes = await pool.query(
      `SELECT id, matchup, pick, oracle_confidence, result, game_pk, created_at, ml_opinion
         FROM picks
        WHERE id = $1 AND deleted_at IS NULL`,
      [pickId]
    );
    if (!pickRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Pick not found' });
    }
    const pick = pickRes.rows[0];

    const shadowRes = await pool.query(
      `SELECT oracle_home_win_prob, shadow_home_win_prob,
              python_model_score, python_model_status, python_model_version,
              shadow_predicted_winner_id, actual_winner_id,
              actual_home_score, actual_away_score,
              home_team_id, away_team_id, home_team_abbr, away_team_abbr,
              pick_market_type, pick_side, pick_line, prop_kind,
              oracle_pick_prob, legacy_pick_prob, python_pick_prob, python_pick_market,
              pick_agree_legacy, pick_agree_python, oracle_pick,
              created_at AS shadow_created_at
         FROM shadow_model_runs
        WHERE pick_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [pickId]
    );

    if (!shadowRes.rows.length) {
      return res.json({
        success: true,
        pick,
        sources: null,
        ensemble: null,
        reason: 'No shadow_model_runs row for this pick yet.',
      });
    }

    const r = shadowRes.rows[0];
    const sources = {
      oracle:  r.oracle_home_win_prob != null ? Number(r.oracle_home_win_prob) : null,
      legacy:  r.shadow_home_win_prob != null ? Number(r.shadow_home_win_prob) : null,
      python:  r.python_model_score   != null ? Number(r.python_model_score)   : null,
    };

    let ensemble = null;
    const haveAll = sources.oracle != null && sources.legacy != null && sources.python != null;
    if (haveAll && isMlEnsembleEnabled()) {
      const result = await predictMlEnsemble({
        market: 'moneyline',
        oracle_prob: sources.oracle,
        legacy_prob: sources.legacy,
        python_prob: sources.python,
      });
      if (result) {
        ensemble = {
          probability: result.probability,
          confidence:  result.confidence,
          weights:     result.weights,
          model_version: result.model_version,
        };
      }
    }

    // Resolution check — was the home side correct?
    let resolution = null;
    if (r.actual_winner_id) {
      const homeWon = String(r.actual_winner_id) === String(r.home_team_id);
      resolution = {
        actual_winner_id: r.actual_winner_id,
        actual_home_score: r.actual_home_score,
        actual_away_score: r.actual_away_score,
        home_won: homeWon,
        oracle_correct:  sources.oracle  != null ? (sources.oracle  >= 0.5) === homeWon : null,
        legacy_correct:  sources.legacy  != null ? (sources.legacy  >= 0.5) === homeWon : null,
        python_correct:  sources.python  != null ? (sources.python  >= 0.5) === homeWon : null,
        ensemble_correct: ensemble?.probability != null ? (ensemble.probability >= 0.5) === homeWon : null,
      };
    }

    res.json({
      success: true,
      pick,
      teams: { home: r.home_team_abbr, away: r.away_team_abbr },
      sources,
      ensemble,
      pickAligned: r.pick_market_type ? {
        market_type: r.pick_market_type,
        oracle_pick_prob: r.oracle_pick_prob,
        legacy_pick_prob: r.legacy_pick_prob,
        python_pick_prob: r.python_pick_prob,
        python_pick_market: r.python_pick_market,
        pick_agree_legacy: r.pick_agree_legacy,
        pick_agree_python: r.pick_agree_python,
        oracle_pick: r.oracle_pick,
      } : null,
      mlOpinion: pick.ml_opinion ?? null,
      resolution,
      python_model_status: r.python_model_status,
      python_model_version: r.python_model_version,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/admin/ml/equity ──────────────────────────────────────────────────
// Returns equity curve, drawdown, Sharpe and monthly breakdown for admin dashboard.
// Query params: sport (mlb|nba|all), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
router.get('/ml/equity', async (req, res) => {
  const { sport = 'all', startDate, endDate } = req.query;
  if (!['all', 'mlb', 'nba'].includes(sport)) {
    return res.status(400).json({ success: false, error: 'sport must be all | mlb | nba' });
  }
  try {
    const data = await computeAdminEquity({ sport, startDate, endDate });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[admin-equity] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/admin/ml/equity/simulate ────────────────────────────────────────
// Monte Carlo bankroll forward simulation. Pulls unit returns from the same
// filtered pick set used by /ml/equity (bootstrap), then projects N futures.
//
// Body: {
//   sport, startDate, endDate,             — same filters as /ml/equity
//   horizonPicks, nSims,                   — simulation size
//   startingBankroll,                      — USD
//   stakeStrategy: 'flat' | 'percent',
//   flatStake, percentStake, ruinThreshold,
//   seed,                                  — optional, for reproducibility
// }
router.post('/ml/equity/simulate', async (req, res) => {
  const { sport = 'all', startDate, endDate, ...simOpts } = req.body ?? {};
  if (!['all', 'mlb', 'nba'].includes(sport)) {
    return res.status(400).json({ success: false, error: 'sport must be all | mlb | nba' });
  }
  try {
    const equity = await computeAdminEquity({ sport, startDate, endDate });
    const outcomeSamples = (equity.series ?? []).map((p) => Number(p.units)).filter(Number.isFinite);
    if (outcomeSamples.length < 10) {
      return res.status(400).json({
        success: false,
        error:   `Need at least 10 resolved picks for the selected filters (got ${outcomeSamples.length})`,
      });
    }
    const t0 = Date.now();
    const result = simulateBankroll({ outcomeSamples, ...simOpts });
    const durationMs = Date.now() - t0;
    return res.json({ success: true, data: result, duration_ms: durationMs });
  } catch (err) {
    console.error('[admin-equity/simulate] error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
