/**
 * tennis-context-builder.js — assembles a per-match context payload for tennis.
 *
 * Tour-aware (atp/wta) and individual-sport shaped: player A vs player B instead
 * of home/away teams. Mirrors soccer-context-builder.js but with tennis-specific
 * dimensions:
 *   - surface is the "park factor" — carried through from the match metadata
 *   - ELO-by-surface + H2H + recent form: null until the Sackmann fetcher
 *     (tennis-elo-fetcher.js) lands in Sprint 12b, exactly like xG was null in
 *     Soccer 11a until the Understat fetcher
 *   - fatigue derived from round depth (no external source)
 *   - 2-way market (no draw); context_meta tracks moneyline completeness
 *
 * For dataset reuse, player A maps to the "home" slot and player B to "away".
 */

import { getTennisRankings } from './tennis-api.js';
import { getTennisTour, isSupportedTour } from './tennis-tour-map.js';
import { getSurfaceElo, getH2H, getRecentForm } from './tennis-elo-fetcher.js';

function fractionPresent(...vals) {
  const present = vals.filter(v => v != null).length;
  return vals.length ? Math.round((present / vals.length) * 100) / 100 : 0;
}

function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/,/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function overlap(a, b) {
  const wb = new Set(words(b));
  return words(a).filter(w => wb.has(w)).length;
}

/**
 * Pull a player's official ranking out of the ESPN rankings payload by name.
 * The rankings shape is fragile across tours; degrade to null gracefully.
 */
function extractRank(rankingsPayload, playerName) {
  if (!rankingsPayload || !playerName) return null;
  try {
    const lists = rankingsPayload?.rankings ?? [];
    for (const list of lists) {
      const ranks = list?.ranks ?? list?.entries ?? [];
      let best = null;
      let bestScore = 0;
      for (const r of ranks) {
        const name = r?.athlete?.displayName ?? r?.athlete?.fullName ?? r?.competitor?.displayName ?? '';
        const score = overlap(playerName, name);
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (best && bestScore > 0) {
        return best?.current ?? best?.rank ?? best?.statistics?.rank ?? null;
      }
    }
  } catch {
    // rankings shape varies; null is fine
  }
  return null;
}

/**
 * Build a per-player block. ELO/form come from the Sackmann fetcher (12b) when
 * available; they degrade to null (rankings-only) when GitHub is unreachable.
 */
function buildPlayerBlock(player, rank, surface, elo, form) {
  return {
    playerId: player?.id ?? null,
    playerName: player?.name ?? null,
    country: player?.country ?? null,
    seed: player?.seed ?? null,
    rank: rank ?? null,
    eloOverall: elo?.overall ?? null,
    eloSurface: elo?.surface ?? null,
    surface: surface ?? null,
    recentForm: form ?? null,    // { record, recent, surfaceRecord } from Sackmann
    // fatigue — derived from draw progress when available
    restDays: null,
    setsPlayedTourney: null,
  };
}

/**
 * buildTennisMatchContext({
 *   tour,                // 'atp' | 'wta'
 *   playerAName,         // display name from ESPN
 *   playerBName,
 *   playerAId?,          // ESPN athlete id (optional)
 *   playerBId?,
 *   matchDate,           // 'YYYY-MM-DD'
 *   surface?,            // 'hard' | 'clay' | 'grass' | 'carpet'
 *   round?,              // ESPN round label
 *   roundDepth?,         // 1..7
 *   bestOf?,             // 3 | 5
 *   marketOdds?,         // { moneyline, setHandicap, totalGames } from tennis-odds.js
 * })
 *
 * Returns { tour, tourMeta, matchDate, surface, round, bestOf, playerA, playerB, context_meta }.
 */
export async function buildTennisMatchContext({
  tour,
  playerAName,
  playerBName,
  playerAId = null,
  playerBId = null,
  matchDate,
  surface = null,
  round = null,
  roundDepth = null,
  bestOf = null,
  marketOdds = null,
}) {
  if (!isSupportedTour(tour)) {
    throw new Error(`[tennis-context] unsupported tour: ${tour}`);
  }

  const startedAt = Date.now();
  const tourMeta = getTennisTour(tour);
  const effectiveBestOf = bestOf ?? (tour === 'atp' ? null : 3); // ATP varies (5 in Slams)

  const [rankingsPayload, eloA, eloB, formA, formB, h2h] = await Promise.all([
    getTennisRankings(tour).catch(err => {
      console.warn(`[tennis-context] rankings failed (${tour}): ${err.message}`);
      return null;
    }),
    getSurfaceElo(tour, playerAName, surface).catch(() => null),
    getSurfaceElo(tour, playerBName, surface).catch(() => null),
    getRecentForm(tour, playerAName, surface).catch(() => null),
    getRecentForm(tour, playerBName, surface).catch(() => null),
    getH2H(tour, playerAName, playerBName, surface).catch(() => null),
  ]);

  const rankA = extractRank(rankingsPayload, playerAName);
  const rankB = extractRank(rankingsPayload, playerBName);

  const playerA = buildPlayerBlock({ id: playerAId, name: playerAName }, rankA, surface, eloA, formA);
  const playerB = buildPlayerBlock({ id: playerBId, name: playerBName }, rankB, surface, eloB, formB);

  const eloSurfacePresent = eloA?.surface != null && eloB?.surface != null;
  const h2hPresent = h2h != null && (h2h.aWins + h2h.bWins) > 0;

  const staleFlags = [];
  if (rankA == null) staleFlags.push('player_a_rank_missing');
  if (rankB == null) staleFlags.push('player_b_rank_missing');
  if (!surface) staleFlags.push('surface_unknown');
  if (!marketOdds?.moneyline || marketOdds.moneyline.a == null) staleFlags.push('moneyline_odds_missing');
  if (!eloSurfacePresent) staleFlags.push('elo_surface_unavailable');
  if (!h2hPresent) staleFlags.push('h2h_unavailable');

  const completeness = {
    rankings:  fractionPresent(rankA, rankB),
    surface:   surface ? 1 : 0,
    marketOdds: marketOdds?.moneyline?.a != null ? 1 : 0,
    eloSurface: eloSurfacePresent ? 1 : 0,
    h2h: h2hPresent ? 1 : 0,
  };
  const overall = +(
    (completeness.rankings   * 0.20 +
     completeness.surface    * 0.15 +
     completeness.marketOdds * 0.25 +
     completeness.eloSurface * 0.30 +
     completeness.h2h        * 0.10).toFixed(2)
  );

  const context_meta = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    tour,
    sources: {
      rankings: {
        ok: !!(rankA != null && rankB != null),
        source: rankingsPayload ? 'espn-rankings' : 'unavailable',
      },
      eloSurface: {
        ok: eloSurfacePresent,
        source: eloSurfacePresent ? 'sackmann-elo' : 'unavailable — Sackmann fetch failed or player not found',
      },
      h2h: {
        ok: h2hPresent,
        source: h2hPresent ? 'sackmann-matches' : 'unavailable — no matchup history found',
      },
      marketOdds: {
        ok: !!(marketOdds?.moneyline?.a != null),
        source: marketOdds?.source ?? null,
        provided: marketOdds ? (marketOdds.provided ?? 'server') : null,
      },
    },
    completeness,
    overallCompleteness: overall,
    staleFlags,
  };

  return {
    tour,
    tourMeta,
    matchDate,
    surface,
    round,
    roundDepth,
    bestOf: effectiveBestOf,
    playerA,
    playerB,
    h2h: h2h ?? null,
    context_meta,
  };
}

export default { buildTennisMatchContext };
