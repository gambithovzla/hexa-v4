/**
 * soccer-national-strength.js — strength prior for national teams (FIFA World Cup).
 *
 * The problem this solves: for international football, every club-level
 * enrichment layer the soccer Oracle relies on is dead — Understat (xG) doesn't
 * cover national teams, API-Football availability is keyed to domestic league ids
 * (no fifa.world), FBref set pieces are club squads, and the ESPN group-stage
 * standings are a 0-3 game sample where every team looks identical. With no data
 * that separates one side from the other, the Oracle correctly collapses to the
 * Draw on nearly every match (maximum entropy). This module gives it the missing
 * strength signal.
 *
 * Why the FIFA World Ranking: it is an Elo-style rating updated after EVERY
 * international match (the SUM formula). The points therefore encode both
 * historical pedigree AND recent form — exactly the prior the TOURNAMENT MODE
 * prompt asks for but never received. It needs no API key and no network, so it
 * can never fail the pipeline.
 *
 * The optional ESPN recent-form fetch (best-effort, null-safe) layers in actual
 * recent results when reachable (e.g. mid-tournament); when it fails, the FIFA
 * points still carry the analysis.
 *
 * Seed snapshot: late-2025 / pre-World-Cup-2026 cycle. Points are approximate
 * FIFA World Ranking values; what matters is the RELATIVE ordering and the gap
 * between two sides. Refresh from the final pre-tournament FIFA ranking when it
 * publishes (typically ~weeks before kickoff).
 */

import { findSoccerTeam } from './soccer-team-map.js';

// canonical national-team name → { rank, points, confederation }
// Points: FIFA World Ranking points (Elo-derived). Rank: position in this seed.
const FIFA_RANKINGS = {
  'Argentina':      { points: 1886, confederation: 'CONMEBOL' },
  'Spain':          { points: 1867, confederation: 'UEFA' },
  'France':         { points: 1862, confederation: 'UEFA' },
  'England':        { points: 1819, confederation: 'UEFA' },
  'Brazil':         { points: 1778, confederation: 'CONMEBOL' },
  'Portugal':       { points: 1772, confederation: 'UEFA' },
  'Netherlands':    { points: 1756, confederation: 'UEFA' },
  'Belgium':        { points: 1740, confederation: 'UEFA' },
  'Italy':          { points: 1718, confederation: 'UEFA' },
  'Germany':        { points: 1716, confederation: 'UEFA' },
  'Croatia':        { points: 1714, confederation: 'UEFA' },
  'Morocco':        { points: 1710, confederation: 'CAF' },
  'Colombia':       { points: 1696, confederation: 'CONMEBOL' },
  'Uruguay':        { points: 1678, confederation: 'CONMEBOL' },
  'United States':  { points: 1665, confederation: 'CONCACAF' },
  'Switzerland':    { points: 1648, confederation: 'UEFA' },
  'Japan':          { points: 1645, confederation: 'AFC' },
  'Senegal':        { points: 1643, confederation: 'CAF' },
  'Denmark':        { points: 1640, confederation: 'UEFA' },
  'Iran':           { points: 1638, confederation: 'AFC' },
  'Mexico':         { points: 1635, confederation: 'CONCACAF' },
  'Austria':        { points: 1580, confederation: 'UEFA' },
  'Ecuador':        { points: 1570, confederation: 'CONMEBOL' },
  'Turkey':         { points: 1560, confederation: 'UEFA' },
  'South Korea':    { points: 1555, confederation: 'AFC' },
  'Canada':         { points: 1540, confederation: 'CONCACAF' },
  'Wales':          { points: 1535, confederation: 'UEFA' },
  'Serbia':         { points: 1530, confederation: 'UEFA' },
  'Poland':         { points: 1525, confederation: 'UEFA' },
  'Egypt':          { points: 1518, confederation: 'CAF' },
  'Nigeria':        { points: 1510, confederation: 'CAF' },
  'Ivory Coast':    { points: 1500, confederation: 'CAF' },
  'Scotland':       { points: 1498, confederation: 'UEFA' },
  'Australia':      { points: 1495, confederation: 'AFC' },
  'Hungary':        { points: 1490, confederation: 'UEFA' },
  'Czech Republic': { points: 1488, confederation: 'UEFA' },
  'Peru':           { points: 1480, confederation: 'CONMEBOL' },
  'Paraguay':       { points: 1475, confederation: 'CONMEBOL' },
  'Cameroon':       { points: 1470, confederation: 'CAF' },
  'Venezuela':      { points: 1465, confederation: 'CONMEBOL' },
  'Chile':          { points: 1460, confederation: 'CONMEBOL' },
  'Saudi Arabia':   { points: 1450, confederation: 'AFC' },
  'Slovakia':       { points: 1445, confederation: 'UEFA' },
  'Ghana':          { points: 1440, confederation: 'CAF' },
  'South Africa':   { points: 1430, confederation: 'CAF' },
  'Qatar':          { points: 1425, confederation: 'AFC' },
  'Bolivia':        { points: 1400, confederation: 'CONMEBOL' },
  'New Zealand':    { points: 1300, confederation: 'OFC' },
  'China':          { points: 1275, confederation: 'AFC' },
  'Indonesia':      { points: 1145, confederation: 'AFC' },
};

// Derive ranks once from the seed points (descending). Keeps the table the
// single source of truth — no hand-maintained rank column to drift.
const _RANKED = Object.entries(FIFA_RANKINGS)
  .sort((a, b) => b[1].points - a[1].points)
  .map(([name], idx) => [name, idx + 1]);
const RANK_BY_NAME = Object.fromEntries(_RANKED);

/**
 * Qualitative tier from FIFA points. Used to label each side in the context.
 */
export function strengthTier(points) {
  if (points == null) return null;
  if (points >= 1740) return 'elite contender';
  if (points >= 1640) return 'strong';
  if (points >= 1520) return 'solid';
  if (points >= 1430) return 'mid-tier';
  return 'developing';
}

/**
 * FIFA strength for one national team. Canonicalises the name through the
 * soccer team map (handles aliases like "Korea Republic" → "South Korea",
 * "USMNT" → "United States"). Returns null for an unseeded nation.
 *
 * @returns {{ name, rank, points, tier, confederation } | null}
 */
export function getNationalTeamStrength(name) {
  if (!name) return null;
  const seeded = findSoccerTeam(name, 'fifa.world');
  const canonical = seeded?.name ?? String(name).trim();
  const entry = FIFA_RANKINGS[canonical];
  if (!entry) return null;
  return {
    name: canonical,
    rank: RANK_BY_NAME[canonical] ?? null,
    points: entry.points,
    tier: strengthTier(entry.points),
    confederation: entry.confederation,
  };
}

/**
 * Classify a points gap into a qualitative band that the prompt can act on.
 * The band — not the raw number — is what tells the Oracle whether a side is a
 * clear favorite or whether the draw is genuinely live on strength alone.
 */
export function strengthGapBand(pointsGap) {
  const g = Math.abs(pointsGap ?? 0);
  if (g >= 150) return 'large';      // clear favorite — draw is NOT the default
  if (g >= 80)  return 'moderate';   // real edge to the stronger side
  if (g >= 35)  return 'slight';     // mild lean; draw stays live
  return 'even';                     // genuinely matched — draw is live on strength
}

/**
 * Compare two national teams on FIFA strength. Returns the gap, the favored side
 * (from the home/away orientation passed in), and a qualitative band. Null when
 * either side is unseeded (caller degrades to the rest of the context).
 *
 * @returns {{ home, away, pointsGap, rankGap, favored, favoredName, band } | null}
 *   pointsGap/rankGap are home − away (positive = home stronger by points).
 *   favored: 'home' | 'away' | 'even'.
 */
export function buildNationalStrengthComparison(homeName, awayName) {
  const home = getNationalTeamStrength(homeName);
  const away = getNationalTeamStrength(awayName);
  if (!home || !away) return null;

  const pointsGap = home.points - away.points;            // + = home stronger
  const rankGap = (away.rank ?? 0) - (home.rank ?? 0);    // + = home better ranked
  const band = strengthGapBand(pointsGap);
  const favored = band === 'even' ? 'even' : (pointsGap > 0 ? 'home' : 'away');
  const favoredName = favored === 'home' ? home.name : favored === 'away' ? away.name : null;

  return { home, away, pointsGap, rankGap, favored, favoredName, band };
}

function _num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare the FIFA-ranking favorite against the MARKET favorite and detect when
 * they diverge. The FIFA ranking lags and does not capture squad quality / a
 * team in a bad moment (e.g. a declining Brazil whose ranking still says
 * "favorite" while bookmakers price it as a coin flip). The market DOES price
 * current player form — so on a real divergence the market wins and the ranking
 * must be downweighted. This is the guard against over-trusting a stale ranking.
 *
 * @param {object} comparison  output of buildNationalStrengthComparison
 * @param {object} threeWay    marketOdds.threeWay ({ homeImplied, awayImplied })
 * @returns {{ level, note, marketFavored, rankFavored, band } | null}
 *   level: 'aligned' | 'mild' | 'strong'
 */
export function assessRankingMarketDivergence(comparison, threeWay) {
  if (!comparison || !threeWay) return null;
  const hi = _num(threeWay.homeImplied);
  const ai = _num(threeWay.awayImplied);
  if (hi == null || ai == null) return null;

  const marketGap = hi - ai;                       // + = home favored by market
  const mAbs = Math.abs(marketGap);
  const marketFavored = mAbs < 8 ? 'even' : (marketGap > 0 ? 'home' : 'away');
  const marketStrength = mAbs >= 30 ? 3 : mAbs >= 15 ? 2 : mAbs >= 8 ? 1 : 0;

  const rankFavored = comparison.favored;          // 'home' | 'away' | 'even'
  const bandStrength = { large: 3, moderate: 2, slight: 1, even: 0 }[comparison.band] ?? 0;

  const rankFavName = rankFavored === 'home' ? comparison.home.name
    : rankFavored === 'away' ? comparison.away.name : null;
  const marketFavName = marketFavored === 'home' ? comparison.home.name
    : marketFavored === 'away' ? comparison.away.name : null;

  // Opposite favorites: the strongest possible divergence.
  if (rankFavored !== 'even' && marketFavored !== 'even' && rankFavored !== marketFavored) {
    return {
      level: 'strong',
      marketFavored, rankFavored, band: comparison.band,
      note: `FIFA ranking favors ${rankFavName} but the MARKET favors ${marketFavName}. The ranking is stale / overstates current strength — TRUST THE MARKET, not the ranking.`,
    };
  }
  // Ranking shouts favorite; market whispers it (or sees a coin flip).
  if (rankFavored !== 'even' && bandStrength - marketStrength >= 2) {
    return {
      level: 'strong',
      marketFavored, rankFavored, band: comparison.band,
      note: `FIFA ranking implies a ${comparison.band} favorite (${rankFavName}) but the market prices the match much closer — the ranking overstates current form (declining squad / bad moment). Downweight the ranking and trust the market.`,
    };
  }
  // Ranking even, market has picked a side.
  if (rankFavored === 'even' && marketStrength >= 2) {
    return {
      level: 'mild',
      marketFavored, rankFavored, band: comparison.band,
      note: `FIFA ranking sees the teams as even but the market favors ${marketFavName} — lean to the market favorite.`,
    };
  }
  // Mild over/understatement.
  if (bandStrength - marketStrength === 1 && rankFavored !== 'even') {
    return {
      level: 'mild',
      marketFavored, rankFavored, band: comparison.band,
      note: `FIFA ranking slightly overstates ${rankFavName} vs the market — temper confidence toward the market read.`,
    };
  }
  return { level: 'aligned', marketFavored, rankFavored, band: comparison.band, note: null };
}

// ── Optional best-effort recent form from ESPN ───────────────────────────────
// During the tournament (and for any reachable national-team schedule) ESPN
// exposes completed fixtures we can fold into recent form. This is layered on
// top of the FIFA prior and is fully optional: any failure returns null and the
// FIFA points still carry the analysis.

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const _formCache = new Map();
const FORM_TTL_MS = 6 * 60 * 60 * 1000; // 6h — international fixtures are infrequent

/**
 * Parse an ESPN team schedule payload into a recent-form summary from the given
 * team's perspective. Pure — exported for tests. Counts only completed events.
 *
 * @returns {{ record, recent, played, avgGoalsFor, avgGoalsAgainst } | null}
 */
export function parseNationalTeamForm(scheduleJson, teamId) {
  const events = scheduleJson?.events;
  if (!Array.isArray(events) || !events.length || teamId == null) return null;
  const tid = String(teamId);

  const results = []; // newest-first 'W'|'D'|'L'
  let gf = 0, ga = 0, counted = 0;

  // ESPN lists oldest→newest; walk from the end for the most recent games.
  for (let i = events.length - 1; i >= 0 && results.length < 6; i--) {
    const comp = events[i]?.competitions?.[0];
    if (!comp) continue;
    const completed = comp?.status?.type?.completed === true
      || comp?.status?.type?.state === 'post';
    if (!completed) continue;
    const competitors = comp?.competitors ?? [];
    const me = competitors.find(c => String(c?.team?.id) === tid);
    const opp = competitors.find(c => String(c?.team?.id) !== tid);
    if (!me || !opp) continue;
    const myScore = Number(me?.score?.value ?? me?.score);
    const oppScore = Number(opp?.score?.value ?? opp?.score);
    if (!Number.isFinite(myScore) || !Number.isFinite(oppScore)) continue;
    results.push(myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'D');
    gf += myScore; ga += oppScore; counted += 1;
  }

  if (!counted) return null;
  const wins = results.filter(r => r === 'W').length;
  const draws = results.filter(r => r === 'D').length;
  const losses = results.filter(r => r === 'L').length;
  return {
    record: `${wins}W-${draws}D-${losses}L`,
    recent: results.join(''),
    played: counted,
    avgGoalsFor: Math.round((gf / counted) * 100) / 100,
    avgGoalsAgainst: Math.round((ga / counted) * 100) / 100,
  };
}

/**
 * Best-effort recent form for a national team via ESPN's team schedule. Returns
 * null on any failure (no team id, network error, no completed fixtures). Never
 * throws — the FIFA prior is the floor.
 */
export async function getNationalTeamRecentForm({ teamId, leagueSlug = 'fifa.world' } = {}) {
  if (teamId == null) return null;
  const cacheKey = `natform:${leagueSlug}:${teamId}`;
  const cached = _formCache.get(cacheKey);
  if (cached && Date.now() - cached.at < FORM_TTL_MS) return cached.data;

  const url = `${ESPN_BASE}/${leagueSlug}/teams/${teamId}/schedule`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (hexa-soccer)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`ESPN ${res.status}`);
    const json = await res.json();
    const form = parseNationalTeamForm(json, teamId);
    _formCache.set(cacheKey, { at: Date.now(), data: form });
    return form;
  } catch (err) {
    console.warn(`[national-strength] recent form fetch failed (team ${teamId}): ${err.message}`);
    if (cached) return cached.data;
    return null;
  }
}

export default {
  getNationalTeamStrength,
  buildNationalStrengthComparison,
  strengthTier,
  strengthGapBand,
  assessRankingMarketDivergence,
  parseNationalTeamForm,
  getNationalTeamRecentForm,
};
