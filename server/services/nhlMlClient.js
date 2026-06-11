/**
 * nhlMlClient.js — thin HTTP client for NHL ML sidecar endpoints (Sprint 10e).
 *
 * Endpoints called:
 *   POST /predict/nhl_moneyline → P(home wins)
 *   POST /predict/nhl_puckline  → P(home covers -1.5)
 *   POST /predict/nhl_total     → P(OVER hits the goals line)
 *
 * nhl_moneyline / nhl_puckline are pre-trained from official NHL API history
 * (api-web.nhle.com); nhl_total trains from resolved live picks. Uses its own
 * lightweight circuit breaker so NHL predictions fail independently of the
 * MLB sidecar circuit state. mlModelClient.js is frozen — this file handles
 * NHL without touching it. Mirrors soccerMlClient.js.
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
      console.warn(`[nhlMlClient] ${path} → HTTP ${response.status}`);
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
      console.warn(`[nhlMlClient] ${path} timed out`);
    } else {
      console.warn(`[nhlMlClient] ${path} error: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the NHL feature payload from context + gameMeta + marketOdds.
 * Mirrors the pick_features columns from nhlShadowPersistence.js and the
 * NHL training frame (gf/ga per game, points%, rest/B2B, goalie status).
 */
export function buildNhlFeaturePayload(context = {}, gameMeta = {}, marketOdds = {}) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};

  return {
    home_goal_diff:   home.goalDiff ?? null,
    away_goal_diff:   away.goalDiff ?? null,
    home_gf_per_game: home.goalsForPerGame ?? null,
    away_gf_per_game: away.goalsForPerGame ?? null,
    home_ga_per_game: home.goalsAgainstPerGame ?? null,
    away_ga_per_game: away.goalsAgainstPerGame ?? null,
    home_points_pct:  home.pointsPct ?? null,
    away_points_pct:  away.pointsPct ?? null,

    // Special teams (null until a richer live source — NaN-tolerated)
    home_pp_pct: home.ppPct ?? null,
    away_pp_pct: away.ppPct ?? null,
    home_pk_pct: home.pkPct ?? null,
    away_pk_pct: away.pkPct ?? null,

    home_last10_wins: _parseWins(home.recentForm),
    away_last10_wins: _parseWins(away.recentForm),

    home_rest_days: home.restDays ?? null,
    away_rest_days: away.restDays ?? null,
    home_is_b2b: _bool01(home.isBackToBack),
    away_is_b2b: _bool01(away.isBackToBack),

    goalie_home_confirmed: _goalieConfirmed(home.goalieStatus),
    goalie_away_confirmed: _goalieConfirmed(away.goalieStatus),
    injuries_home_severe: home.injuries?.severeCount ?? null,
    injuries_away_severe: away.injuries?.severeCount ?? null,

    odds_ml_home:    marketOdds?.moneyline?.home ?? null,
    odds_ml_away:    marketOdds?.moneyline?.away ?? null,
    odds_ou_total:   marketOdds?.total?.line ?? null,
    line:            marketOdds?.total?.line ?? null,
    puck_line_close: 1.5,

    context_completeness: context?.context_meta?.overallCompleteness ?? null,
    oracle_confidence:    gameMeta.oracleConfidence ?? null,
  };
}

function _parseWins(recentForm) {
  if (!recentForm?.record) return null;
  const m = String(recentForm.record).match(/^(\d+)-\d+/);
  if (!m) return null;
  return Number(m[1]);
}

function _bool01(value) {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function _goalieConfirmed(goalieStatus) {
  if (goalieStatus == null) return null;
  const key = String(goalieStatus.statusKey ?? goalieStatus).toLowerCase();
  // A goalie appearing in the injury feed as out/doubtful means the expected
  // starter is NOT confirmed healthy — anything else from the feed is noise.
  return ['out', 'doubtful', 'out_for_season'].includes(key) ? 0 : 1;
}

export async function predictNhlMoneyline(features) {
  if (!_guard()) return null;
  return _post('/predict/nhl_moneyline', features ?? {});
}

export async function predictNhlPuckline(features) {
  if (!_guard()) return null;
  return _post('/predict/nhl_puckline', features ?? {});
}

export async function predictNhlTotal(features) {
  if (!_guard()) return null;
  return _post('/predict/nhl_total', features ?? {});
}

/**
 * Predict all three NHL game markets at once (parlay builder / enrichment).
 * Returns { moneyline: P(home win), puckline: P(home -1.5), total: P(over) }
 * in [0,1] (null per market when the sidecar is down or that model isn't
 * trained yet), or null when nothing resolved. Mirrors predictSoccerGameModel.
 */
export async function predictNhlGameModel(context = {}, gameMeta = {}, marketOdds = {}) {
  if (!_guard()) return null;
  const features = buildNhlFeaturePayload(context, gameMeta, marketOdds);
  const [ml, pl, tot] = await Promise.all([
    predictNhlMoneyline(features),
    predictNhlPuckline(features),
    predictNhlTotal(features),
  ]);
  const prob = r => (r && typeof r.probability === 'number' ? r.probability : null);
  const moneyline = prob(ml);
  const puckline = prob(pl);
  const total = prob(tot);
  if (moneyline == null && puckline == null && total == null) return null;
  return { moneyline, puckline, total };
}
