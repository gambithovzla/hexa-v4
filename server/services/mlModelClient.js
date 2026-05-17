/**
 * server/services/mlModelClient.js
 *
 * HTTP client for the Python ML sidecar (FastAPI + XGBoost).
 *
 * Features:
 *   - Feature flag: ML_SIDECAR_ENABLED (default false — safe until the sidecar
 *     is deployed and has artifacts).
 *   - 500ms timeout per request so the Node API is never blocked.
 *   - One automatic retry on network errors (not on 4xx/5xx).
 *   - Circuit breaker: 3 consecutive failures within a 5-minute window opens
 *     the circuit for 2 minutes. Callers receive null and fall back to the
 *     legacy xgboostValidator.js deterministic scorer transparently.
 *
 * Auth:
 *   Every request includes `Authorization: Bearer $HEXA_ML_INTERNAL_TOKEN`.
 *   When the env var is unset (local dev) the header is omitted and the
 *   Python server should have auth disabled too.
 *
 * Exports:
 *   predictMoneyline(features)  → Prediction | null
 *   predictOverUnder(features)  → Prediction | null
 *   predictRunLine(features)    → Prediction | null
 *   predictBatch(items)         → Prediction[] | null
 *   getCalibration()            → object | null
 *   isEnabled()                 → boolean
 *   getCircuitState()           → { state, failures, openUntil }
 */

// ── Config ────────────────────────────────────────────────────────────────────

const DISABLED_VALUES = new Set(['0', 'false', 'off', 'no']);

function readBool(envKey, defaultValue) {
  const raw = process.env[envKey];
  if (raw == null) return defaultValue;
  return !DISABLED_VALUES.has(String(raw).toLowerCase());
}

const ML_SIDECAR_ENABLED   = readBool('ML_SIDECAR_ENABLED', false);
const ENSEMBLE_ENABLED     = readBool('ENSEMBLE_ENABLED', false);
const ML_API_URL           = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const ML_TOKEN             = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';
const TIMEOUT_MS           = 500;
const MAX_RETRIES          = 1;
const FAILURE_THRESHOLD    = 3;   // consecutive failures to open circuit
const FAILURE_WINDOW_MS    = 5 * 60 * 1000;  // 5 minutes
const OPEN_CIRCUIT_MS      = 2 * 60 * 1000;  // keep circuit open 2 minutes

// ── Circuit Breaker State ─────────────────────────────────────────────────────

const _circuit = {
  state: 'closed',   // 'closed' | 'open' | 'half-open'
  failures: 0,
  firstFailureAt: null,  // timestamp of first failure in current window
  openUntil: null,       // timestamp when circuit auto-resets to half-open
};

function _recordSuccess() {
  _circuit.state = 'closed';
  _circuit.failures = 0;
  _circuit.firstFailureAt = null;
  _circuit.openUntil = null;
}

function _recordFailure() {
  const now = Date.now();

  // Reset window counter if the first failure was more than FAILURE_WINDOW_MS ago
  if (_circuit.firstFailureAt && (now - _circuit.firstFailureAt) > FAILURE_WINDOW_MS) {
    _circuit.failures = 0;
    _circuit.firstFailureAt = null;
  }

  if (_circuit.firstFailureAt == null) {
    _circuit.firstFailureAt = now;
  }

  _circuit.failures += 1;

  if (_circuit.failures >= FAILURE_THRESHOLD) {
    _circuit.state = 'open';
    _circuit.openUntil = now + OPEN_CIRCUIT_MS;
    console.warn(
      `[mlModelClient] Circuit OPEN after ${_circuit.failures} failures. ` +
      `Auto-reset in ${OPEN_CIRCUIT_MS / 1000}s.`
    );
  }
}

function _isCircuitOpen() {
  if (_circuit.state === 'closed') return false;
  if (_circuit.state === 'half-open') return false;

  const now = Date.now();
  if (_circuit.openUntil && now >= _circuit.openUntil) {
    // Auto-transition to half-open: allow one probe request
    _circuit.state = 'half-open';
    console.info('[mlModelClient] Circuit half-open — sending probe request.');
    return false;
  }
  return true;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function _buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (ML_TOKEN) {
    headers['Authorization'] = `Bearer ${ML_TOKEN}`;
  }
  return headers;
}

async function _fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function _post(path, body, attempt = 0) {
  if (_isCircuitOpen()) {
    return null;
  }

  const url = `${ML_API_URL}${path}`;
  try {
    const response = await _fetchWithTimeout(url, {
      method: 'POST',
      headers: _buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // 4xx/5xx from the server — record failure, no retry
      _recordFailure();
      const text = await response.text().catch(() => '');
      console.warn(`[mlModelClient] ${path} → HTTP ${response.status}: ${text.slice(0, 200)}`);
      return null;
    }

    _recordSuccess();
    return response.json();
  } catch (err) {
    // Network error, timeout, etc.
    const isRetryable = attempt < MAX_RETRIES && err.name !== 'AbortError';
    if (isRetryable) {
      // One immediate retry without delay (we're already within a single request)
      return _post(path, body, attempt + 1);
    }
    _recordFailure();
    if (err.name === 'AbortError') {
      console.warn(`[mlModelClient] ${path} timed out after ${TIMEOUT_MS}ms`);
    } else {
      console.warn(`[mlModelClient] ${path} error: ${err.message}`);
    }
    return null;
  }
}

async function _get(path) {
  if (_isCircuitOpen()) {
    return null;
  }

  const url = `${ML_API_URL}${path}`;
  try {
    const response = await _fetchWithTimeout(url, {
      method: 'GET',
      headers: _buildHeaders(),
    });

    if (!response.ok) {
      _recordFailure();
      return null;
    }

    _recordSuccess();
    return response.json();
  } catch (err) {
    _recordFailure();
    console.warn(`[mlModelClient] GET ${path} error: ${err.message}`);
    return null;
  }
}

// ── Guard — fast exit when disabled ──────────────────────────────────────────

function _guard() {
  if (!ML_SIDECAR_ENABLED) return false;
  if (!ML_API_URL) {
    // Warn once per process
    if (!_guard._warned) {
      console.warn('[mlModelClient] ML_SIDECAR_ENABLED=true but HEXA_ML_API_URL is not set. Skipping.');
      _guard._warned = true;
    }
    return false;
  }
  return true;
}
_guard._warned = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Prediction
 * @property {string} market
 * @property {number} probability  0-1
 * @property {number} confidence   0-100
 * @property {Array}  top_features
 * @property {string|null} model_version
 */

/**
 * Predict moneyline (home win probability).
 * @param {Object} features  — keys matching FeaturePayload in serve.py
 * @returns {Promise<Prediction|null>}
 */
export async function predictMoneyline(features) {
  if (!_guard()) return null;
  return _post('/predict/moneyline', features ?? {});
}

/**
 * Predict over/under (P(total > line)).
 * The `line` field must be included in features.
 * @param {Object} features
 * @returns {Promise<Prediction|null>}
 */
export async function predictOverUnder(features) {
  if (!_guard()) return null;
  return _post('/predict/overunder', features ?? {});
}

/**
 * Predict run line (P(home covers -1.5)).
 * @param {Object} features
 * @returns {Promise<Prediction|null>}
 */
export async function predictRunLine(features) {
  if (!_guard()) return null;
  return _post('/predict/runline', features ?? {});
}

const PROP_KIND_ENDPOINTS = {
  hits: 'hits',
  strikeouts: 'strikeouts',
  total_bases: 'total_bases',
  home_runs: 'home_runs',
  rbis: 'rbis',
};

export async function predictProp(propKind, features) {
  if (!_guard()) return null;
  const kind = String(propKind ?? '').toLowerCase();
  const segment = PROP_KIND_ENDPOINTS[kind];
  if (!segment) return null;
  return _post(`/predict/prop/${segment}`, features ?? {});
}

/**
 * Score up to 50 items in one call. Each item must include a `market` field.
 * @param {Array<{market: string, [key: string]: any}>} items
 * @returns {Promise<{predictions: Prediction[]}|null>}
 */
export async function predictBatch(items) {
  if (!_guard()) return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  return _post('/predict/batch', { items });
}

/**
 * Fetch calibration manifest from the sidecar (reflects last training run).
 * @returns {Promise<Object|null>}
 */
export async function getCalibration() {
  if (!_guard()) return null;
  return _get('/calibration');
}

/**
 * Fetch the ensemble manifest (Sprint 4) — per-source weights + Brier scores.
 * @returns {Promise<Object|null>}
 */
export async function getEnsembleCalibration() {
  if (!_guard()) return null;
  return _get('/calibration/ensemble');
}

/**
 * Combine the 3 source probabilities through the trained meta-learner.
 * Returns null when the sidecar is unavailable, the ensemble hasn't been
 * trained yet, or any source probability is missing.
 *
 * @param {Object} payload
 * @param {string} [payload.market='moneyline']
 * @param {number} payload.oracle_prob  — home win prob from the LLM Oracle
 * @param {number} payload.legacy_prob  — home win prob from xgboostValidator.js
 * @param {number} payload.python_prob  — home win prob from the Python XGBoost
 * @returns {Promise<{
 *   market: string,
 *   probability: number,
 *   confidence: number,
 *   sources: {oracle: number, legacy: number, python: number},
 *   weights: {oracle: number, legacy: number, python: number, intercept: number},
 *   model_version: string|null
 * }|null>}
 */
export async function predictEnsemble(payload) {
  if (!_guard()) return null;
  if (!payload) return null;
  const required = ['oracle_prob', 'legacy_prob', 'python_prob'];
  for (const key of required) {
    const v = Number(payload[key]);
    if (!Number.isFinite(v) || v < 0 || v > 1) return null;
  }
  return _post('/predict/ensemble', {
    market: payload.market ?? 'moneyline',
    oracle_prob: Number(payload.oracle_prob),
    legacy_prob: Number(payload.legacy_prob),
    python_prob: Number(payload.python_prob),
  });
}

/** Whether the sidecar integration is enabled via env var. */
export function isEnabled() {
  return ML_SIDECAR_ENABLED && Boolean(ML_API_URL);
}

/** Whether the ensemble meta-learner endpoint is enabled (Sprint 4). */
export function isEnsembleEnabled() {
  return ENSEMBLE_ENABLED && isEnabled();
}

/** Inspect current circuit breaker state (for health/debug endpoints). */
export function getCircuitState() {
  return {
    state: _circuit.state,
    failures: _circuit.failures,
    openUntil: _circuit.openUntil,
  };
}

/**
 * Build a feature payload compatible with the Python sidecar from the objects
 * already available inside shadow-model.js / recordShadowModelRun().
 *
 * @param {object} statcastData  — from buildShadowStatcastData()
 * @param {object} features      — raw features from context-builder
 * @returns {object}
 */
export function buildMLFeaturePayload(statcastData = {}, features = {}) {
  function safe(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const homePitcher = statcastData?.homePitcher ?? {};
  const awayPitcher = statcastData?.awayPitcher ?? {};
  const homeLineup  = statcastData?.homeLineup  ?? {};
  const awayLineup  = statcastData?.awayLineup  ?? {};
  const weather     = features?.weatherData ?? {};
  const park        = features?.parkFactorData ?? {};
  const odds        = features?.oddsData ?? {};

  return {
    home_pitcher_xwoba:             safe(homePitcher.xwOBA_against),
    away_pitcher_xwoba:             safe(awayPitcher.xwOBA_against),
    home_pitcher_whiff:             safe(homePitcher.whiff_percent),
    away_pitcher_whiff:             safe(awayPitcher.whiff_percent),
    home_pitcher_k_pct:             safe(homePitcher.k_percent),
    away_pitcher_k_pct:             safe(awayPitcher.k_percent),
    home_pitcher_era:               safe(homePitcher.era),
    away_pitcher_era:               safe(awayPitcher.era),
    home_pitcher_days_rest:         safe(features?.homePitcherDaysRest),
    away_pitcher_days_rest:         safe(features?.awayPitcherDaysRest),
    home_pitcher_pitches_last_start:safe(features?.homePitcherPitchesLastStart),
    away_pitcher_pitches_last_start:safe(features?.awayPitcherPitchesLastStart),
    home_bullpen_pitches_last_3d:   safe(features?.homeBullpenPitchesLast3d),
    away_bullpen_pitches_last_3d:   safe(features?.awayBullpenPitchesLast3d),
    home_team_ops:                  safe(features?.homeTeamOps),
    away_team_ops:                  safe(features?.awayTeamOps),
    home_lineup_avg_xwoba:          safe(homeLineup.avg_xwOBA),
    away_lineup_avg_xwoba:          safe(awayLineup.avg_xwOBA),
    park_factor_overall:            safe(park?.overall ?? park?.parkFactorOverall),
    park_factor_hr:                 safe(park?.hr ?? park?.parkFactorHr),
    temperature:                    safe(weather?.temperature ?? weather?.temp),
    wind_speed:                     safe(weather?.windSpeed ?? weather?.wind_speed),
    is_day_game:                    features?.isDayGame != null ? (features.isDayGame ? 1 : 0) : null,
    is_dome:                        features?.isDome != null ? (features.isDome ? 1 : 0) : null,
    game_number_in_series:          safe(features?.gameNumberInSeries),
    odds_ml_home:                   safe(odds?.moneylineHome ?? odds?.homeML),
    odds_ml_away:                   safe(odds?.moneylineAway ?? odds?.awayML),
    odds_ou_total:                  safe(odds?.total ?? odds?.ouTotal),
  };
}

export function buildPropMLFeaturePayload(row = {}) {
  const base = buildMLFeaturePayload(
    {
      homePitcher: {
        xwOBA_against: row.home_pitcher_xwoba,
        whiff_percent: row.home_pitcher_whiff,
        k_percent: row.home_pitcher_k_pct,
        era: row.home_pitcher_era,
      },
      awayPitcher: {
        xwOBA_against: row.away_pitcher_xwoba,
        whiff_percent: row.away_pitcher_whiff,
        k_percent: row.away_pitcher_k_pct,
        era: row.away_pitcher_era,
      },
      homeLineup: { avg_xwOBA: row.home_lineup_avg_xwoba },
      awayLineup: { avg_xwOBA: row.away_lineup_avg_xwoba },
    },
    {
      homePitcherDaysRest: row.home_pitcher_days_rest,
      awayPitcherDaysRest: row.away_pitcher_days_rest,
      homePitcherPitchesLastStart: row.home_pitcher_pitches_last_start,
      awayPitcherPitchesLastStart: row.away_pitcher_pitches_last_start,
      homeBullpenPitchesLast3d: row.home_bullpen_pitches_last_3d,
      awayBullpenPitchesLast3d: row.away_bullpen_pitches_last_3d,
      homeTeamOps: row.home_team_ops,
      awayTeamOps: row.away_team_ops,
      isDayGame: row.is_day_game,
      isDome: row.is_dome,
      gameNumberInSeries: row.game_number_in_series,
      weatherData: { temperature: row.temperature, wind_speed: row.wind_speed },
      parkFactorData: { overall: row.park_factor_overall, hr: row.park_factor_hr },
      oddsData: {
        moneylineHome: row.odds_ml_home,
        moneylineAway: row.odds_ml_away,
        total: row.odds_ou_total,
      },
    },
  );

  function safe(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const side = String(row.side ?? '').toLowerCase();
  return {
    ...base,
    line: safe(row.line),
    prop_side_over: side === 'over' ? 1 : side === 'under' ? 0 : null,
    prop_player_xwoba: safe(row.prop_player_xwoba),
    prop_player_xba: safe(row.prop_player_xba),
    prop_player_xslg: safe(row.prop_player_xslg),
    prop_player_k_pct: safe(row.prop_player_k_pct),
    prop_player_bb_pct: safe(row.prop_player_bb_pct),
    prop_player_avg_exit_velocity: safe(row.prop_player_avg_exit_velocity),
    prop_player_barrel_pct: safe(row.prop_player_barrel_pct),
    prop_player_hard_hit_pct: safe(row.prop_player_hard_hit_pct),
    prop_player_rolling_woba_7d: safe(row.prop_player_rolling_woba_7d),
    prop_player_rolling_woba_14d: safe(row.prop_player_rolling_woba_14d),
    prop_player_rolling_woba_21d: safe(row.prop_player_rolling_woba_21d),
    prop_player_ops_vs_lhp: safe(row.prop_player_ops_vs_lhp),
    prop_player_ops_vs_rhp: safe(row.prop_player_ops_vs_rhp),
    prop_opponent_pitcher_hand: row.prop_opponent_pitcher_hand ?? null,
    prop_opponent_pitcher_xwoba_against: safe(row.prop_opponent_pitcher_xwoba_against),
    prop_opponent_pitcher_k_pct: safe(row.prop_opponent_pitcher_k_pct),
    prop_odds_american: safe(row.prop_odds_american),
    prop_implied_prob: safe(row.prop_implied_prob),
  };
}
