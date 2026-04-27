import { getTodayGames } from '../../mlb-api.js';
import { getGameOdds, hydrateOddsForGame, matchOddsToGame } from '../../odds-api.js';
import { buildContext } from '../../context-builder.js';
import { buildDeterministicSafePayload } from '../../market-intelligence.js';
import { calculateParallelScore } from '../xgboostValidator.js';

// 5-minute in-memory cache keyed by date + sorted gameIds
const poolCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCacheKey(date, gameIds) {
  return `${date}::${[...gameIds].map(Number).sort((a, b) => a - b).join(',')}`;
}

/** Convert American odds to decimal. Returns null if input is null. */
function americanToDecimal(american) {
  if (american == null) return null;
  if (american > 0) return +((american / 100) + 1).toFixed(4);
  return +((-100 / american) + 1).toFixed(4);
}

/**
 * Map prop_kind from safe_candidates to the ParlayCandidate propKind enum.
 * safe_candidates uses 'strikeouts'; the schema uses 'k'.
 */
function propKindFromRaw(prop_kind) {
  if (prop_kind === 'hits') return 'hits';
  if (prop_kind === 'strikeouts') return 'k';
  return null;
}

/**
 * Build a stable candidateId that is unique within a pool.
 * Format: {gamePk}::{marketType}::{side}::{pick_slug}
 */
function buildCandidateId(gamePk, marketType, side, pick) {
  const slug = pick.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
  return `${gamePk}::${marketType}::${side ?? 'na'}::${slug}`;
}

/**
 * Derive a per-candidate model risk from edge, data quality, and model probability.
 * Conservative heuristic — Fase 2 can refine with riskVector.
 */
function deriveModelRisk(edge, dataQualityScore, modelProbability) {
  if (dataQualityScore < 50 || edge == null || edge < 0) return 'high';
  if (edge >= 5 && dataQualityScore >= 70 && modelProbability >= 65) return 'low';
  return 'medium';
}

/**
 * Check whether the XGBoost prediction agrees with the candidate's pick direction.
 * Only meaningful for moneyline and runline (same-side check by team abbreviation).
 */
function computeXgbAgreement(marketType, side, xgbResult, gameData) {
  if (!xgbResult?.predicted_winner_abbr) return false;
  if (marketType === 'moneyline' || marketType === 'runline') {
    const homeAbbr = gameData.teams?.home?.abbreviation;
    const awayAbbr = gameData.teams?.away?.abbreviation;
    const winner = xgbResult.predicted_winner_abbr;
    if (side === 'home') return winner === homeAbbr;
    if (side === 'away') return winner === awayAbbr;
  }
  return false;
}

/**
 * Build the ParlayCandidate[] for a single game.
 * All heavy lifting (context, xgb, safe payload) happens here.
 */
async function buildPoolForGame({ gameData, allOdds, lang, deps }) {
  const {
    _hydrateOddsForGame,
    _matchOddsToGame,
    _buildContext,
    _buildDeterministicSafePayload,
    _calculateParallelScore,
  } = deps;

  const gamePk = gameData.gamePk;
  const matchedOdds = _matchOddsToGame(
    allOdds,
    gameData.teams.home.name,
    gameData.teams.away.name,
  );
  const { _features } = await _buildContext(gameData, matchedOdds ?? null);
  const propsAllowed = ['FULL_ANALYSIS', 'STANDARD_ANALYSIS'].includes(String(_features?.dataQuality?.strategy ?? ''));
  const oddsData = propsAllowed
    ? await _hydrateOddsForGame(matchedOdds)
    : matchedOdds;

  const statcastData = {
    homePitcher: _features.homePitcherSavant ?? {},
    awayPitcher: _features.awayPitcherSavant ?? {},
    homeLineup: _features.savantBatters?.home ?? [],
    awayLineup: _features.savantBatters?.away ?? [],
  };

  let xgbResult = null;
  try {
    xgbResult = _calculateParallelScore(statcastData, gameData);
  } catch (err) {
    console.warn(`[parlay-synergy] xgb failed for gamePk ${gamePk}:`, err.message);
  }

  const safePayload = _buildDeterministicSafePayload({
    gameData,
    features: _features,
    oddsData,
    xgboostResult: xgbResult,
    lang,
    llmData: null,
  });

  const dataQualityScore = _features.dataQuality?.score ?? 50;
  const homeAbbr = gameData.teams?.home?.abbreviation ?? gameData.teams?.home?.name ?? '???';
  const awayAbbr = gameData.teams?.away?.abbreviation ?? gameData.teams?.away?.name ?? '???';
  const matchup = `${awayAbbr} @ ${homeAbbr}`;
  const gameDate = gameData.gameDate?.slice(0, 10) ?? '';
  const gameStartUTC = gameData.gameDate ?? '';

  // Main-market candidates (ML/RL/OU) stay in the pool even if odds are null:
  // the odds API can fail to match a game (team-name mismatch, rate limit, etc.)
  // and dropping them turns the whole pool empty. Player props, however, require
  // real prices — an unpriced prop is not bettable and has no edge to reason about.
  const allCandidates = safePayload.safe_candidates ?? [];
  const pricedCandidates = allCandidates.filter(sc =>
    sc.market_type !== 'playerprop' || sc.odds != null
  );
  const omitted = allCandidates.length - pricedCandidates.length;
  if (omitted > 0) {
    console.warn(`[parlay-synergy] gamePk ${gamePk}: omitted ${omitted} unpriced player prop(s) before architect pool`);
  }
  const unpricedMain = pricedCandidates.filter(sc => sc.market_type !== 'playerprop' && sc.odds == null).length;
  if (unpricedMain > 0) {
    console.warn(`[parlay-synergy] gamePk ${gamePk}: ${unpricedMain} main-market candidate(s) have null odds (odds API match may have failed)`);
  }

  return pricedCandidates.map(sc => {
    const marketType = sc.market_type;
    const side = sc.side ?? null;
    const propKind = propKindFromRaw(sc.prop_kind);
    const candidateId = buildCandidateId(gamePk, marketType, side, sc.pick);
    const modelProbability = sc.hit_probability ?? sc.model_probability ?? 0;
    const edge = sc.edge ?? null;

    return {
      // Identity
      candidateId,
      gamePk,
      matchup,
      gameDate,
      gameStartUTC,
      // Pick
      pick: sc.pick,
      type: sc.type,
      marketType,
      side,
      propKind,
      teamSide: sc.team_side ?? null,
      line: sc.line ?? null,
      propMarketKey: sc.prop_market_key ?? null,
      // Probabilities
      modelProbability,
      impliedProbability: sc.implied_probability ?? null,
      edge,
      // Odds
      odds: sc.odds ?? null,
      decimalOdds: americanToDecimal(sc.odds),
      // XGBoost
      xgbScore: xgbResult?.score ?? null,
      xgbConfidence: xgbResult?.confidence ?? null,
      xgbAgreement: computeXgbAgreement(marketType, side, xgbResult, gameData),
      // Risk profile — populated in Fase 2
      riskVector: null,
      gameScript: null,
      failureMode: null,
      // Metadata
      dataQualityScore,
      modelRisk: deriveModelRisk(edge, dataQualityScore, modelProbability),
      reasoning: sc.reasoning ?? '',
    };
  });
}

/**
 * Factory that returns a buildCandidatePool function with injected dependencies.
 * Used directly in production (with real deps) and in tests (with mocks).
 *
 * @param {object} deps
 * @returns {function({ gameIds, date, lang }): Promise<ParlayCandidate[]>}
 */
export function createPoolBuilder({
  _getTodayGames,
  _getGameOdds,
  _hydrateOddsForGame = async (oddsData) => oddsData,
  _matchOddsToGame,
  _buildContext,
  _buildDeterministicSafePayload,
  _calculateParallelScore,
}) {
  const deps = {
    _hydrateOddsForGame,
    _matchOddsToGame,
    _buildContext,
    _buildDeterministicSafePayload,
    _calculateParallelScore,
  };

  return async function buildCandidatePool({ gameIds, date, lang = 'en' }) {
    const cacheKey = getCacheKey(date, gameIds);
    const cached = poolCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      console.log(`[parlay-synergy] pool cache hit: ${cacheKey}`);
      return cached.data;
    }

    const [allGames, allOdds] = await Promise.all([
      _getTodayGames(date),
      _getGameOdds({ date }),
    ]);

    const gameMap = new Map(allGames.map(g => [g.gamePk, g]));
    const results = [];

    for (const id of gameIds) {
      const gamePk = Number(id);
      const gameData = gameMap.get(gamePk);
      if (!gameData) {
        console.warn(`[parlay-synergy] gamePk ${gamePk} not found for date ${date}`);
        continue;
      }
      try {
        const candidates = await buildPoolForGame({ gameData, allOdds, lang, deps });
        results.push(...candidates);
        console.log(`[parlay-synergy] gamePk ${gamePk}: ${candidates.length} candidates`);
      } catch (err) {
        console.error(`[parlay-synergy] pool error for gamePk ${gamePk}:`, err.message);
      }
    }

    poolCache.set(cacheKey, { ts: Date.now(), data: results });
    console.log(`[parlay-synergy] total pool: ${results.length} candidates from ${gameIds.length} games`);
    return results;
  };
}

/** Clear the in-memory cache. Useful in tests and for manual cache invalidation. */
export function clearPoolCache() {
  poolCache.clear();
}

/**
 * Filter a candidate pool by bet-type focus.
 *
 * Mirrors the "Bet Focus" selector exposed in the single-game Analysis view so
 * the user can constrain the architect to a single market family. Unknown or
 * 'all' values pass everything through.
 *
 * Allowed values: 'all' | 'moneyline' | 'runline' | 'totals' |
 *                 'pitcher_props' | 'batter_props'
 */
export function filterCandidatesByBetType(candidates, betType) {
  if (!betType || betType === 'all') return candidates;
  switch (betType) {
    case 'moneyline':
      return candidates.filter(c => c.marketType === 'moneyline');
    case 'runline':
      return candidates.filter(c => c.marketType === 'runline');
    case 'totals':
      return candidates.filter(c => c.marketType === 'overunder');
    case 'pitcher_props':
      return candidates.filter(c => c.marketType === 'playerprop' && c.propKind === 'k');
    case 'batter_props':
      return candidates.filter(c => c.marketType === 'playerprop' && c.propKind === 'hits');
    default:
      return candidates;
  }
}

// Default export uses real production dependencies.
export const buildCandidatePool = createPoolBuilder({
  _getTodayGames: getTodayGames,
  _getGameOdds: getGameOdds,
  _hydrateOddsForGame: hydrateOddsForGame,
  _matchOddsToGame: matchOddsToGame,
  _buildContext: buildContext,
  _buildDeterministicSafePayload: buildDeterministicSafePayload,
  _calculateParallelScore: calculateParallelScore,
});
