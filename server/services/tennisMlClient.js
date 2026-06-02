/**
 * tennisMlClient.js — thin HTTP client for Tennis ML sidecar endpoints.
 *
 * Endpoints called:
 *   POST /predict/tennis_moneyline     → P(player A wins)
 *   POST /predict/tennis_set_handicap  → P(player A covers the set handicap)
 *   POST /predict/tennis_total_games   → P(OVER hits the total-games line)
 *
 * Uses its own lightweight circuit breaker so tennis predictions fail
 * independently of the MLB sidecar circuit state. mlModelClient.js is frozen —
 * this file handles tennis without touching it. Mirrors nflMlClient.js.
 *
 * Individual sport: player A = "home" slot, player B = "away" slot. The payload
 * feeds the same column names the Python feature builder expects.
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
      console.warn(`[tennisMlClient] ${path} → HTTP ${response.status}`);
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
      console.warn(`[tennisMlClient] ${path} timed out`);
    } else {
      console.warn(`[tennisMlClient] ${path} error: ${err.message}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the tennis feature payload from a buildTennisMatchContext() output.
 * Player A → "home" columns, player B → "away". All fields optional — the
 * sidecar handles NaN natively.
 */
export function buildTennisFeaturePayload(context = {}, marketOdds = {}) {
  const a = context.playerA ?? {};
  const b = context.playerB ?? {};
  const h2h = context.h2h ?? {};
  return {
    home_elo_surface:        a.eloSurface ?? null,
    away_elo_surface:        b.eloSurface ?? null,
    home_elo_overall:        a.eloOverall ?? null,
    away_elo_overall:        b.eloOverall ?? null,
    home_rank:               a.rank ?? null,
    away_rank:               b.rank ?? null,
    h2h_surface_wins_home:   h2h.aWinsSurface ?? null,
    h2h_surface_wins_away:   h2h.bWinsSurface ?? null,
    h2h_total_wins_home:     h2h.aWins ?? null,
    h2h_total_wins_away:     h2h.bWins ?? null,
    home_rest_days:          a.restDays ?? null,
    away_rest_days:          b.restDays ?? null,
    home_sets_played_tourney: a.setsPlayedTourney ?? null,
    away_sets_played_tourney: b.setsPlayedTourney ?? null,
    surface:                 context.surface ?? null,
    best_of:                 context.bestOf ?? null,
    set_handicap_close:      marketOdds.setHandicap?.line ?? null,
    total_games_close:       marketOdds.totalGames?.line ?? null,
    oracle_confidence:       context.oracleConfidence ?? null,
    data_quality_score:      context.context_meta?.overallCompleteness ?? null,
    signal_coherence_score:  null,
  };
}

export async function predictTennisMoneyline(features) {
  if (!_guard()) return null;
  return _post('/predict/tennis_moneyline', features ?? {});
}

export async function predictTennisSetHandicap(features) {
  if (!_guard()) return null;
  return _post('/predict/tennis_set_handicap', features ?? {});
}

export async function predictTennisTotalGames(features) {
  if (!_guard()) return null;
  return _post('/predict/tennis_total_games', features ?? {});
}
