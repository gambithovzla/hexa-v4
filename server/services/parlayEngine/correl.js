const RISK_VECTOR_KEYS = [
  'pitching_dominance',
  'bullpen_exposure',
  'weather_exposure',
  'lineup_variance',
  'umpire_sensitivity',
  'ballpark_bias',
];

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Stable, order-independent key for a candidate pair.
 * Sorting guarantees corr(A,B) === corr(B,A) uses the same key.
 */
export function pairKey(A, B) {
  const [x, y] = [A.candidateId, B.candidateId].sort();
  return `${x}|${y}`;
}

/**
 * Euclidean distance between two risk vectors.
 * Range: [0, √6] ≈ [0, 2.449]. Higher = more orthogonal risk profiles.
 */
function riskDistance(A, B) {
  if (!A.riskVector || !B.riskVector) return 0;
  let sumSq = 0;
  for (const k of RISK_VECTOR_KEYS) {
    sumSq += ((A.riskVector[k] ?? 0) - (B.riskVector[k] ?? 0)) ** 2;
  }
  return Math.sqrt(sumSq);
}

/**
 * Try to match A→predA and B→predB, OR B→predA and A→predB.
 * Returns [matched_predA_candidate, matched_predB_candidate] or [null, null].
 */
function findPair(A, B, predA, predB) {
  if (predA(A) && predB(B)) return [A, B];
  if (predA(B) && predB(A)) return [B, A];
  return [null, null];
}

// Geographic region groups for weather correlation across nearby stadiums.
const TEAM_REGION = {
  BOS: 'ne', NYY: 'ne', NYM: 'ne', PHI: 'ne', BAL: 'ne', WSH: 'ne',
  ATL: 'se', MIA: 'se', TB: 'se',
  CHC: 'mw', CWS: 'mw', MIL: 'mw', MIN: 'mw', DET: 'mw', CLE: 'mw',
  HOU: 'south', TEX: 'south', KC: 'south',
  COL: 'mtn', ARI: 'mtn',
  LAD: 'pac', LAA: 'pac', SD: 'pac', SF: 'pac', SEA: 'pac', OAK: 'pac',
  TOR: 'can',
  PIT: 'app', CIN: 'app', STL: 'app',
};

/** Return true if both games are played in the same geographic region. */
function sameRegion(A, B) {
  // matchup format: "AWAY @ HOME"
  const homeA = A.matchup?.split('@')[1]?.trim();
  const homeB = B.matchup?.split('@')[1]?.trim();
  if (!homeA || !homeB) return false;
  const ra = TEAM_REGION[homeA];
  const rb = TEAM_REGION[homeB];
  return ra != null && rb != null && ra === rb;
}

// ── Same-game correlation rules ───────────────────────────────────────────

function sameGameCorrelation(A, B) {
  // Direct contradiction: opposite sides of the same moneyline
  if (A.marketType === 'moneyline' && B.marketType === 'moneyline' && A.side !== B.side) {
    return -0.95;
  }

  // Direct contradiction: opposite sides of the same run line
  if (A.marketType === 'runline' && B.marketType === 'runline' && A.side !== B.side) {
    return -0.95;
  }

  // Under + pitcher Ks over: same root cause (pitcher dominates → low scoring + high Ks)
  const [, ksProp] = findPair(A, B,
    c => c.marketType === 'overunder' && c.side === 'under',
    c => c.marketType === 'playerprop' && c.propKind === 'k',
  );
  if (ksProp) return 0.45;

  // Total over + batter hits over: high-scoring game → batters produce hits
  const [, hitsProp] = findPair(A, B,
    c => c.marketType === 'overunder' && c.side === 'over',
    c => c.marketType === 'playerprop' && c.propKind === 'hits',
  );
  if (hitsProp) return 0.35;

  // ML home (favorite, odds < 0) + Under: favorite can win a pitcher's duel (under hits),
  // but can also win a slugfest that breaks the under — slight negative.
  const [mlHome] = findPair(A, B,
    c => c.marketType === 'moneyline' && c.side === 'home' && c.odds != null && c.odds < 0,
    c => c.marketType === 'overunder' && c.side === 'under',
  );
  if (mlHome) return -0.30;

  return 0;
}

// ── Cross-game correlation rules ──────────────────────────────────────────

function crossGameCorrelation(A, B) {
  let corr = 0;

  // Same narrative script = same macro thesis for the day
  if (A.gameScript && B.gameScript &&
      A.gameScript !== 'neutral' &&
      A.gameScript === B.gameScript) {
    corr = Math.max(corr, 0.15);
  }

  // Opposite scripts = conflicting macro theses
  if ((A.gameScript === 'pitchers_duel' && B.gameScript === 'slugfest') ||
      (A.gameScript === 'slugfest'      && B.gameScript === 'pitchers_duel')) {
    corr = Math.min(corr, -0.10);
  }

  // Nearby stadiums share the same weather front
  if (sameRegion(A, B) &&
      (A.riskVector?.weather_exposure ?? 0) > 0.6 &&
      (B.riskVector?.weather_exposure ?? 0) > 0.6) {
    corr = Math.max(corr, 0.20);
  }

  return corr;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build the full pairwise correlation and risk-distance matrices for a pool.
 * Candidates must be enriched with riskVector + gameScript (Fase 2).
 *
 * @param {object[]} candidates  ParlayCandidate[]
 * @returns {{
 *   correlations:  Record<string, number>,  pairKey → [-1, 1]
 *   riskDistances: Record<string, number>,  pairKey → [0, √6]
 * }}
 */
export function buildCorrelationMatrix(candidates) {
  const correlations = {};
  const riskDistances = {};

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const A = candidates[i];
      const B = candidates[j];
      const key = pairKey(A, B);

      const raw = A.gamePk === B.gamePk
        ? sameGameCorrelation(A, B)
        : crossGameCorrelation(A, B);

      correlations[key] = clamp(raw, -1, 1);
      riskDistances[key] = riskDistance(A, B);
    }
  }

  return { correlations, riskDistances };
}

/** Look up the correlation between two candidates from a pre-built matrix. */
export function getCorrelation(correlations, A, B) {
  return correlations[pairKey(A, B)] ?? 0;
}

/** Look up the risk distance between two candidates from a pre-built matrix. */
export function getRiskDistance(riskDistances, A, B) {
  return riskDistances[pairKey(A, B)] ?? 0;
}
