/**
 * soccerMlClient.js — thin HTTP client for Soccer ML sidecar endpoints.
 *
 * Endpoints called:
 *   POST /predict/soccer_moneyline  → P(home wins)
 *   POST /predict/soccer_total      → P(OVER hits the goals line)
 *   POST /predict/soccer_btts       → P(both teams score)
 *
 * Uses its own lightweight circuit breaker so soccer predictions fail
 * independently of the MLB sidecar circuit state.
 * The mlModelClient.js is frozen — this file handles soccer without touching it.
 * Trains when there are enough resolved soccer picks in prod.
 */

const ML_SIDECAR_ENABLED = process.env.ML_SIDECAR_ENABLED === 'true' || process.env.ML_SIDECAR_ENABLED === '1';
const ML_API_URL         = (process.env.HEXA_ML_API_URL ?? '').replace(/\/$/, '');
const ML_TOKEN           = process.env.HEXA_ML_INTERNAL_TOKEN ?? '';

const TIMEOUT_MS        = 3000;
const MAX_RETRIES       = 1;
const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 60 * 1000;
const OPEN_CIRCUIT_MS   = 2 * 60 * 1000;

const _circuit = {
  state: 'closed',
  failures: 0,
  firstFailureAt: null,
  openUntil: null,
};

function _recordFailure() {
  const now = Date.now();
  if (_circuit.firstFailureAt && (now - _circuit.firstFailureAt) > FAILURE_WINDOW_MS) {
    _circuit.failures = 0;
    _circuit.firstFailureAt = null;
  }
  if (_circuit.firstFailureAt == null) _circuit.firstFailureAt = now;
  _circuit.failures += 1;
  if (_circuit.failures >= FAILURE_THRESHOLD) {
    _circuit.state = 'open';
    _circuit.openUntil = now + OPEN_CIRCUIT_MS;
  }
}

function _recordSuccess() {
  _circuit.state = 'closed';
  _circuit.failures = 0;
  _circuit.firstFailureAt = null;
  _circuit.openUntil = null;
}

function _isOpen() {
  if (_circuit.state === 'closed') return false;
  if (_circuit.openUntil && Date.now() >= _circuit.openUntil) {
    _circuit.state = 'half-open';
  }
  return _circuit.state === 'open';
}

function _guard() {
  if (!ML_SIDECAR_ENABLED || !ML_API_URL) return false;
  return !_isOpen();
}

async function _post(path, body, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ML_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(ML_TOKEN ? { Authorization: `Bearer ${ML_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      _recordFailure();
      console.warn(`[soccerMlClient] ${path} → HTTP ${response.status}`);
      return null;
    }
    _recordSuccess();
    return response.json();
  } catch (err) {
    if (attempt < MAX_RETRIES && err.name !== 'AbortError') {
      return _post(path, body, attempt + 1);
    }
    _recordFailure();
    if (err.name === 'AbortError') {
      console.warn(`[soccerMlClient] ${path} timed out`);
    } else {
      console.warn(`[soccerMlClient] ${path} error: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the soccer feature payload from context + gameMeta + marketOdds.
 * Mirrors the pick_features columns from soccerShadowPersistence.js.
 */
export function buildSoccerFeaturePayload(context = {}, gameMeta = {}, marketOdds = {}) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};

  return {
    // Season stats
    home_goals_for:    home.goalsFor    ?? null,
    away_goals_for:    away.goalsFor    ?? null,
    home_goals_against: home.goalsAgainst ?? null,
    away_goals_against: away.goalsAgainst ?? null,
    home_goal_diff:    home.goalDiff    ?? null,
    away_goal_diff:    away.goalDiff    ?? null,
    home_points:       home.points      ?? null,
    away_points:       away.points      ?? null,

    // xG from Understat (Big 5 leagues; null for MLS / fetch failure)
    home_xg:  home.xG  ?? null,
    away_xg:  away.xG  ?? null,
    home_xga: home.xGA ?? null,
    away_xga: away.xGA ?? null,

    // Recent form wins (derived from W-D-L record)
    home_last10_wins: _parseWins(home.recentForm),
    away_last10_wins: _parseWins(away.recentForm),

    // 3-way odds
    odds_ml_home:    marketOdds?.threeWay?.home ?? null,
    odds_ml_away:    marketOdds?.threeWay?.away ?? null,
    draw_price:      marketOdds?.threeWay?.draw ?? null,
    odds_ou_total:   marketOdds?.total?.line    ?? null,
    btts_yes_price:  marketOdds?.btts?.yes      ?? null,

    // Context quality
    context_completeness: context?.context_meta?.overallCompleteness ?? null,
    oracle_confidence:    gameMeta.oracleConfidence ?? null,
  };
}

function _parseWins(recentForm) {
  if (!recentForm?.record) return null;
  const m = String(recentForm.record).match(/(\d+)W-(\d+)D-(\d+)L/);
  if (!m) return null;
  return Number(m[1]);
}

export async function predictSoccerMoneyline(features) {
  if (!_guard()) return null;
  return _post('/predict/soccer_moneyline', features ?? {});
}

export async function predictSoccerTotal(features) {
  if (!_guard()) return null;
  return _post('/predict/soccer_total', features ?? {});
}

export async function predictSoccerBtts(features) {
  if (!_guard()) return null;
  return _post('/predict/soccer_btts', features ?? {});
}

/**
 * Predict all three soccer game markets at once for the parlay builder.
 * Returns { moneyline: P(home win), total: P(over), btts: P(yes) } in [0,1]
 * (null per market when the sidecar is down or that model isn't trained yet),
 * or null when nothing resolved. Mirrors predictNflGameModel.
 */
export async function predictSoccerGameModel(context = {}, gameMeta = {}, marketOdds = {}) {
  if (!_guard()) return null;
  const features = buildSoccerFeaturePayload(context, gameMeta, marketOdds);
  const [ml, tot, bt] = await Promise.all([
    predictSoccerMoneyline(features),
    predictSoccerTotal(features),
    predictSoccerBtts(features),
  ]);
  const prob = r => (r && typeof r.probability === 'number' ? r.probability : null);
  const moneyline = prob(ml);
  const total = prob(tot);
  const btts = prob(bt);
  if (moneyline == null && total == null && btts == null) return null;
  return { moneyline, total, btts };
}
