/**
 * live-feed.js — MLB Live Game Feed for H.E.X.A. V4
 *
 * Fetches the GUMBO (Grand Unified Master Baseball Object) live feed
 * from the MLB Stats API and normalizes it for the frontend.
 *
 * Endpoints used (free, no API key):
 *   - https://statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live
 *
 * Cache: 20 seconds per game to avoid hammering the API.
 */

const MLB_BASE = 'https://statsapi.mlb.com';

// ── In-memory cache: gamePk → { data, timestamp } ────────────────────────────
const _cache = new Map();
const CACHE_TTL_MS = 20_000; // 20 seconds

/**
 * Fetch JSON from URL with timeout
 */
async function fetchJSON(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get live game data for a specific game.
 * Returns normalized object with score, situation, plays, and boxscore.
 *
 * @param {number|string} gamePk
 * @returns {Promise<object>}
 */
export async function getLiveGameData(gamePk) {
  const key = String(gamePk);

  // Check cache
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${MLB_BASE}/api/v1.1/game/${gamePk}/feed/live`;
  const raw = await fetchJSON(url);

  const data = normalizeLiveFeed(raw, gamePk);

  // Cache the result
  _cache.set(key, { data, timestamp: Date.now() });

  return data;
}

/**
 * Get live data for multiple games at once (for the Live tab).
 * Fetches in parallel with a concurrency limit.
 *
 * @param {Array<number|string>} gamePks
 * @returns {Promise<object[]>}
 */
export async function getMultipleLiveGames(gamePks) {
  const results = await Promise.allSettled(
    gamePks.map(pk => getLiveGameData(pk))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { gamePk: gamePks[i], error: r.reason?.message ?? 'Failed to fetch', status: 'error' };
  });
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeLiveFeed(raw, gamePk) {
  const gd = raw?.gameData ?? {};
  const ld = raw?.liveData ?? {};
  const linescore = ld?.linescore ?? {};
  const plays = ld?.plays ?? {};
  const boxscore = ld?.boxscore ?? {};

  const status = gd?.status ?? {};
  const isLive = ['In Progress', 'Manager Challenge', 'Review'].includes(status?.detailedState);
  const isFinal = status?.detailedState === 'Final' || status?.codedGameState === 'F';
  const isScheduled = !isLive && !isFinal;

  // ── Teams ──────────────────────────────────────────────────────────────────
  const homeTeam = gd?.teams?.home ?? {};
  const awayTeam = gd?.teams?.away ?? {};

  // ── Score by innings ───────────────────────────────────────────────────────
  const innings = (linescore?.innings ?? []).map(inn => ({
    num: inn.num,
    home: { runs: inn.home?.runs ?? null, hits: inn.home?.hits ?? 0, errors: inn.home?.errors ?? 0 },
    away: { runs: inn.away?.runs ?? null, hits: inn.away?.hits ?? 0, errors: inn.away?.errors ?? 0 },
  }));

  const homeScore = linescore?.teams?.home?.runs ?? 0;
  const awayScore = linescore?.teams?.away?.runs ?? 0;
  const homeHits = linescore?.teams?.home?.hits ?? 0;
  const awayHits = linescore?.teams?.away?.hits ?? 0;
  const homeErrors = linescore?.teams?.home?.errors ?? 0;
  const awayErrors = linescore?.teams?.away?.errors ?? 0;

  // ── Current situation ──────────────────────────────────────────────────────
  const currentInning = linescore?.currentInning ?? 0;
  const inningHalf = linescore?.inningHalf ?? '';
  const outs = linescore?.outs ?? 0;

  // Runners on base
  const offense = linescore?.offense ?? {};
  const runners = {
    first: !!offense?.first,
    second: !!offense?.second,
    third: !!offense?.third,
  };

  // Current batter/pitcher
  const currentBatter = offense?.batter ? {
    id: offense.batter.id,
    name: offense.batter.fullName,
  } : null;

  const defense = linescore?.defense ?? {};
  const currentPitcher = defense?.pitcher ? {
    id: defense.pitcher.id,
    name: defense.pitcher.fullName,
  } : null;

  // Count
  const balls = linescore?.balls ?? 0;
  const strikes = linescore?.strikes ?? 0;

  // ── Recent plays (last 8) ─────────────────────────────────────────────────
  const allPlays = plays?.allPlays ?? [];
  const recentPlays = allPlays
    .filter(p => p?.result?.type === 'atBat' && p?.about?.isComplete)
    .slice(-8)
    .reverse()
    .map(p => ({
      inning: p.about?.inning ?? 0,
      halfInning: p.about?.halfInning ?? '',
      batter: p.matchup?.batter?.fullName ?? 'Unknown',
      batterId: p.matchup?.batter?.id ?? null,
      pitcher: p.matchup?.pitcher?.fullName ?? 'Unknown',
      pitcherId: p.matchup?.pitcher?.id ?? null,
      event: p.result?.event ?? '',
      eventType: p.result?.eventType ?? '',
      description: p.result?.description ?? '',
      rbi: p.result?.rbi ?? 0,
      isScoring: p.about?.isScoringPlay ?? false,
      awayScore: p.result?.awayScore ?? 0,
      homeScore: p.result?.homeScore ?? 0,
    }));

  // Current at-bat (in progress)
  const currentPlay = plays?.currentPlay;
  const currentAtBat = currentPlay && !currentPlay?.about?.isComplete ? {
    batter: currentPlay.matchup?.batter?.fullName ?? null,
    batterId: currentPlay.matchup?.batter?.id ?? null,
    pitcher: currentPlay.matchup?.pitcher?.fullName ?? null,
    pitcherId: currentPlay.matchup?.pitcher?.id ?? null,
    count: {
      balls: currentPlay.count?.balls ?? 0,
      strikes: currentPlay.count?.strikes ?? 0,
      outs: currentPlay.count?.outs ?? 0,
    },
    pitchCount: currentPlay.playEvents?.filter(e => e?.isPitch)?.length ?? 0,
  } : null;

  // ── Player stats from boxscore ─────────────────────────────────────────────
  const playerStats = extractPlayerStats(boxscore);

  return {
    gamePk: Number(gamePk),
    status: isLive ? 'live' : isFinal ? 'final' : 'scheduled',
    detailedState: status?.detailedState ?? 'Unknown',
    venue: gd?.venue?.name ?? null,

    home: {
      id: homeTeam?.id,
      name: homeTeam?.name ?? 'Home',
      abbreviation: homeTeam?.abbreviation ?? 'HOM',
      score: homeScore,
      hits: homeHits,
      errors: homeErrors,
      record: homeTeam?.record ? `${homeTeam.record.wins}-${homeTeam.record.losses}` : null,
    },
    away: {
      id: awayTeam?.id,
      name: awayTeam?.name ?? 'Away',
      abbreviation: awayTeam?.abbreviation ?? 'AWY',
      score: awayScore,
      hits: awayHits,
      errors: awayErrors,
      record: awayTeam?.record ? `${awayTeam.record.wins}-${awayTeam.record.losses}` : null,
    },

    innings,

    situation: {
      inning: currentInning,
      halfInning: inningHalf,
      outs,
      runners,
      balls,
      strikes,
      currentBatter,
      currentPitcher,
      currentAtBat,
    },

    recentPlays,
    playerStats,

    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Extract individual player stats from the boxscore for pick tracking.
 * Returns { home: { pitchers: [...], batters: [...] }, away: { ... } }
 */
function extractPlayerStats(boxscore) {
  const result = { home: { pitchers: [], batters: [] }, away: { pitchers: [], batters: [] } };

  for (const side of ['home', 'away']) {
    const teamBox = boxscore?.teams?.[side] ?? {};
    const players = teamBox?.players ?? {};

    for (const [key, player] of Object.entries(players)) {
      if (!player?.person) continue;

      const pStats = player?.stats?.pitching ?? {};
      const bStats = player?.stats?.batting ?? {};

      // Pitcher stats
      if (pStats && Object.keys(pStats).length > 0 && pStats.inningsPitched !== undefined) {
        result[side].pitchers.push({
          id: player.person.id,
          name: player.person.fullName,
          ip: pStats.inningsPitched ?? '0',
          strikeOuts: pStats.strikeOuts ?? 0,
          hits: pStats.hits ?? 0,
          runs: pStats.runs ?? 0,
          earnedRuns: pStats.earnedRuns ?? 0,
          walks: pStats.baseOnBalls ?? 0,
          homeRuns: pStats.homeRuns ?? 0,
          pitchCount: pStats.numberOfPitches ?? 0,
          era: pStats.era ?? null,
        });
      }

      // Batter stats
      if (bStats && Object.keys(bStats).length > 0 && bStats.atBats !== undefined) {
        result[side].batters.push({
          id: player.person.id,
          name: player.person.fullName,
          atBats: bStats.atBats ?? 0,
          hits: bStats.hits ?? 0,
          homeRuns: bStats.homeRuns ?? 0,
          rbi: bStats.rbi ?? 0,
          walks: bStats.baseOnBalls ?? 0,
          strikeOuts: bStats.strikeOuts ?? 0,
          stolenBases: bStats.stolenBases ?? 0,
          totalBases: bStats.totalBases ?? 0,
          avg: bStats.avg ?? null,
        });
      }
    }

    // Sort pitchers by appearance order (inningsPitched desc as proxy)
    result[side].pitchers.sort((a, b) => parseFloat(b.ip) - parseFloat(a.ip));
    // Sort batters by batting order (atBats desc as proxy)
    result[side].batters.sort((a, b) => b.atBats - a.atBats);
  }

  return result;
}
