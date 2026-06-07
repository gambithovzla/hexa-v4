/**
 * nflMlClient.js — thin HTTP client for NFL ML sidecar endpoints.
 *
 * Endpoints called:
 *   POST /predict/nfl_moneyline  → P(home wins)
 *   POST /predict/nfl_spread     → P(home covers closing spread)
 *   POST /predict/nfl_total      → P(OVER hits the closing total)
 *
 * Uses its own lightweight circuit breaker so NFL predictions fail
 * independently of the MLB sidecar circuit state.
 * The mlModelClient.js is frozen — this file handles NFL without touching it.
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
      console.warn(`[nflMlClient] ${path} → HTTP ${response.status}`);
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
      console.warn(`[nflMlClient] ${path} timed out`);
    } else {
      console.warn(`[nflMlClient] ${path} error: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the NFL feature payload from context + gameMeta.
 * All fields are optional — the sidecar handles NaN natively.
 */
export function buildNflFeaturePayload(context = {}, gameMeta = {}, marketOdds = {}) {
  const { home = {}, away = {}, weather = {}, injuries = {} } = context;

  // context.home.qbStatus is an object { playerName, status, statusKey } or null —
  // read statusKey, never String(obj) which yields "[object Object]" and silently
  // marked every injured QB as active (QB is the dominant NFL variable).
  const qbKey = s => (s && typeof s === 'object' ? s.statusKey : s);
  const qbHomeRaw = qbKey(home.qbStatus);
  const qbAwayRaw = qbKey(away.qbStatus);
  const qbHomeActive = qbHomeRaw
    ? !['out', 'out_for_season', 'doubtful'].includes(String(qbHomeRaw).toLowerCase())
    : null;
  const qbAwayActive = qbAwayRaw
    ? !['out', 'out_for_season', 'doubtful'].includes(String(qbAwayRaw).toLowerCase())
    : null;

  return {
    home_epa_off:         home.epaOff ?? null,
    away_epa_off:         away.epaOff ?? null,
    home_epa_def:         home.epaDef ?? null,
    away_epa_def:         away.epaDef ?? null,
    home_success_rate:    home.successRate ?? null,
    away_success_rate:    away.successRate ?? null,
    home_proe:            home.proe ?? null,
    away_proe:            away.proe ?? null,
    home_rest_days:       gameMeta.homeRestDays ?? null,
    away_rest_days:       gameMeta.awayRestDays ?? null,
    home_is_short_week:   gameMeta.homeIsShortWeek ? 1 : gameMeta.homeIsShortWeek === false ? 0 : null,
    away_is_short_week:   gameMeta.awayIsShortWeek ? 1 : gameMeta.awayIsShortWeek === false ? 0 : null,
    home_is_off_bye:      gameMeta.homeIsOffBye ? 1 : gameMeta.homeIsOffBye === false ? 0 : null,
    away_is_off_bye:      gameMeta.awayIsOffBye ? 1 : gameMeta.awayIsOffBye === false ? 0 : null,
    qb_home_active:       qbHomeActive != null ? (qbHomeActive ? 1 : 0) : null,
    qb_away_active:       qbAwayActive != null ? (qbAwayActive ? 1 : 0) : null,
    wind_mph:             (weather.windSpeed ?? weather.wind_speed) ?? null,
    is_dome:              gameMeta.isDome ? 1 : gameMeta.isDome === false ? 0 : null,
    spread_close:         marketOdds.spread ?? null,
    total_close:          marketOdds.total ?? null,
    injuries_home_severe: injuries.homeSevere ?? null,
    injuries_away_severe: injuries.awaySevere ?? null,
    oracle_confidence:    gameMeta.oracleConfidence ?? null,
    data_quality_score:   context.dataQuality ?? null,
    signal_coherence_score: context.signalCoherence ?? null,
  };
}

/**
 * Build the NFL player-prop feature payload (pooled nfl_prop market). Pick-aligned:
 * the model predicts P(the bet side wins), so `side` is a feature. Player season/
 * recent averages are optional (null until the nflverse player fetcher lands).
 */
export function buildNflPropFeaturePayload({
  propKind,
  side,
  line,
  oddsAmerican = null,
  impliedProb = null,
  fairProb = null,
  playerSeasonAvg = null,
  playerRecentAvg = null,
  playerGames = null,
} = {}) {
  return {
    prop_kind:                  propKind ?? null,
    side:                       side ?? null,
    line:                       line ?? null,
    prop_odds_american:         oddsAmerican,
    prop_implied_prob:          impliedProb,
    nfl_prop_fair_prob:         fairProb,
    nfl_prop_player_season_avg: playerSeasonAvg,
    nfl_prop_player_recent_avg: playerRecentAvg,
    nfl_prop_player_games:      playerGames,
  };
}

export async function predictNflProp(features) {
  if (!_guard()) return null;
  return _post('/predict/nfl_prop', features ?? {});
}

export async function predictNflMoneyline(features) {
  if (!_guard()) return null;
  return _post('/predict/nfl_moneyline', features ?? {});
}

export async function predictNflSpread(features) {
  if (!_guard()) return null;
  return _post('/predict/nfl_spread', features ?? {});
}

export async function predictNflTotal(features) {
  if (!_guard()) return null;
  return _post('/predict/nfl_total', features ?? {});
}

/**
 * Predict all three NFL game markets in parallel and return the model-probability
 * triplet the parlay candidate builder consumes:
 *   { moneyline: P(home wins), spread: P(home covers), total: P(over) }  (each [0,1])
 * Any market whose prediction is unavailable (circuit open / disabled / no
 * artifact) is left null so buildNflGameCandidates falls back to de-vigged
 * market odds for that leg. Returns null if the whole triplet is unavailable.
 */
export async function predictNflGameModel(context = {}, gameMeta = {}, marketOdds = {}) {
  if (!_guard()) return null;
  const features = buildNflFeaturePayload(context, gameMeta, marketOdds);
  const [ml, sp, tot] = await Promise.all([
    predictNflMoneyline(features),
    predictNflSpread(features),
    predictNflTotal(features),
  ]);
  const prob = r => (r && typeof r.probability === 'number' ? r.probability : null);
  const moneyline = prob(ml);
  const spread = prob(sp);
  const total = prob(tot);
  if (moneyline == null && spread == null && total == null) return null;
  return { moneyline, spread, total };
}
