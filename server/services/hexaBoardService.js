/**
 * hexaBoardService.js
 *
 * Orchestrates the H.E.X.A. Pizarra del Día:
 *   1. Reads the day's scheduled games
 *   2. For each unique team playing today, fetches recent schedule + bullpen usage
 *   3. For each confirmed lineup top batter, fetches game log
 *   4. Runs every detector from hexaSmartSignalsService
 *   5. Ranks, trims, and returns a JSON-friendly payload
 *
 * Caching:
 *   - In-memory map keyed by date
 *   - TTL = until 04:00 America/New_York next boundary (i.e. "one day")
 *   - force=true bypasses cache for manual refresh
 */

import {
  getTodayGames,
  getTeamRecentSchedule,
  getBullpenUsage,
  getBatterGameLog,
} from '../mlb-api.js';

import {
  detectTeamStreaks,
  detectHotOffense,
  detectColdOffense,
  detectBullpenFatigue,
  detectHitStreak,
  detectColdBatter,
  detectHighScoringMatchup,
  rankAndTrim,
  getThresholds,
} from './hexaSmartSignalsService.js';

// ── Cache ────────────────────────────────────────────────────────────────────

const _cache = new Map(); // date -> { payload, expiresAt }

function nextDailyBoundaryMs() {
  const now = new Date();
  // 04:00 ET boundary: after MLB "yesterday" games have wrapped and stats settle
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const boundary = new Date(et);
  boundary.setHours(4, 0, 0, 0);
  if (et.getTime() >= boundary.getTime()) boundary.setDate(boundary.getDate() + 1);
  return now.getTime() + (boundary.getTime() - et.getTime());
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} [opts.date]   — YYYY-MM-DD (defaults to local today)
 * @param {boolean} [opts.force] — bypass cache
 */
export async function buildHexaBoard({ date, force = false } = {}) {
  const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  if (!force) {
    const cached = _cache.get(targetDate);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.payload, cached: true };
    }
  }

  const games = await getTodayGames(targetDate);

  // Collect unique teams present today
  const teamIndex = new Map(); // teamId -> { id, name, abbr }
  for (const g of games) {
    const h = g.teams?.home; const a = g.teams?.away;
    if (h?.id) teamIndex.set(h.id, { id: h.id, teamName: h.name, teamAbbr: h.abbreviation });
    if (a?.id) teamIndex.set(a.id, { id: a.id, teamName: a.name, teamAbbr: a.abbreviation });
  }

  // ── Parallel-bounded team fetches (recent schedule + bullpen) ─────────────
  const teamIds = [...teamIndex.keys()];
  const teamData = new Map(); // teamId -> { team, recent, bullpen }

  for (const tid of teamIds) {
    const team = teamIndex.get(tid);
    try {
      const [recent, bullpen] = await Promise.all([
        getTeamRecentSchedule(tid, 14),
        getBullpenUsage(tid).catch(() => null),
      ]);
      teamData.set(tid, { team, recent, bullpen });
    } catch (err) {
      console.warn(`[hexa-board] team ${tid} data fetch failed: ${err.message}`);
      teamData.set(tid, { team, recent: [], bullpen: null });
    }
  }

  // ── Collect signals ───────────────────────────────────────────────────────
  const insights = [];

  for (const { team, recent, bullpen } of teamData.values()) {
    insights.push(...detectTeamStreaks(team, recent));
    insights.push(...detectHotOffense(team, recent));
    insights.push(...detectColdOffense(team, recent));
    insights.push(...detectBullpenFatigue(team, bullpen));
  }

  // Batter-level signals (top confirmed hitters to bound fan-out)
  const thresholds = getThresholds();
  const maxBatters = thresholds.batter?.max_batters_per_team ?? 4;
  const lookback   = thresholds.batter?.hit_streak_lookback ?? 7;

  for (const g of games) {
    const homeLineup = g.lineups?.home ?? [];
    const awayLineup = g.lineups?.away ?? [];
    const lineupPicks = [
      ...homeLineup.slice(0, maxBatters).map(p => ({ ...p, teamId: g.teams?.home?.id, teamAbbr: g.teams?.home?.abbreviation })),
      ...awayLineup.slice(0, maxBatters).map(p => ({ ...p, teamId: g.teams?.away?.id, teamAbbr: g.teams?.away?.abbreviation })),
    ];

    for (const batter of lineupPicks) {
      if (!batter?.id) continue;
      try {
        const log = await getBatterGameLog(batter.id, lookback);
        insights.push(...detectHitStreak(batter, log));
        insights.push(...detectColdBatter(batter, log));
      } catch (err) {
        // Silent — one player's missing log should not break the board
      }
    }
  }

  // Matchup-level signal
  for (const g of games) {
    const homeId = g.teams?.home?.id;
    const awayId = g.teams?.away?.id;
    const homeData = teamData.get(homeId);
    const awayData = teamData.get(awayId);
    if (!homeData || !awayData) continue;
    insights.push(...detectHighScoringMatchup(
      {
        home: { id: homeData.team.id, teamName: homeData.team.teamName, teamAbbr: homeData.team.teamAbbr, recent: homeData.recent },
        away: { id: awayData.team.id, teamName: awayData.team.teamName, teamAbbr: awayData.team.teamAbbr, recent: awayData.recent },
      },
      {
        home: { pitchersYesterday: countPitchersYesterday(homeData.bullpen) },
        away: { pitchersYesterday: countPitchersYesterday(awayData.bullpen) },
      }
    ));
  }

  const ranked = rankAndTrim(insights);

  const payload = {
    date:            targetDate,
    lastUpdatedAt:   new Date().toISOString(),
    totalGames:      games.length,
    teamsAnalyzed:   teamData.size,
    insightsCount:   ranked.length,
    insights:        ranked,
  };

  _cache.set(targetDate, { payload, expiresAt: Date.now() + nextDailyBoundaryMs() });
  return { ...payload, cached: false };
}

function countPitchersYesterday(bullpen) {
  if (!bullpen?.relievers) return 0;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  return bullpen.relievers.filter(r =>
    (r.appearances ?? []).some(a => a.date === y)
  ).length;
}

export function _clearHexaBoardCache() { _cache.clear(); }
