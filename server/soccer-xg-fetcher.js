/**
 * soccer-xg-fetcher.js — xG (Expected Goals) data from Understat.
 *
 * Understat embeds team stats as JSON inside <script> tags on their league pages.
 * This fetcher extracts that data, normalizes it, and caches it for 6 hours.
 * Falls back gracefully to null on any failure — never breaks the pick flow.
 *
 * Supported leagues (Understat slug → ESPN slug):
 *   EPL → eng.1, La_liga → esp.1, Bundesliga → ger.1,
 *   Serie_A → ita.1, Ligue_1 → fra.1
 * MLS is not covered by Understat (returns null for usa.1).
 *
 * Usage:
 *   const xg = await getSoccerTeamXg('eng.1', 'Arsenal');
 *   // → { xG: 45.2, xGA: 28.1, npxG: 41.5, npxGA: 26.3 } or null
 */

const UNDERSTAT_SLUGS = {
  'eng.1': 'EPL',
  'esp.1': 'La_liga',
  'ger.1': 'Bundesliga',
  'ita.1': 'Serie_A',
  'fra.1': 'Ligue_1',
};

const CURRENT_SEASON = 2024; // Understat season = calendar year of season start

const _cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function normName(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute xG stats (including rolling averages and PPDA) from a single team's
 * Understat history array. Pure function — exported for testing.
 *
 * @param {Array} history — array of match objects from Understat teamsData
 * @returns {{ xG, xGA, npxG, npxGA, wins, draws, losses, matches,
 *             xG_7, xGA_7, xG_5, xGA_5, ppda, ppdaAllowed } | null}
 */
export function computeXgStats(history) {
  if (!Array.isArray(history) || !history.length) return null;

  let xG = 0, xGA = 0, npxG = 0, npxGA = 0;
  let actualGoals = 0, actualGoalsAgainst = 0;
  let wins = 0, draws = 0, losses = 0;
  let ppdaSum = 0, ppdaCount = 0, ppdaAllowedSum = 0, ppdaAllowedCount = 0;

  for (const m of history) {
    xG    += Number(m.xG    ?? 0);
    xGA   += Number(m.xGA   ?? 0);
    npxG  += Number(m.npxG  ?? 0);
    npxGA += Number(m.npxGA ?? 0);
    const scored = Number(m.scored ?? 0);
    const missed = Number(m.missed ?? 0);
    actualGoals        += scored;
    actualGoalsAgainst += missed;
    if (scored > missed)       wins++;
    else if (scored === missed) draws++;
    else                       losses++;

    if (m.ppda?.att > 0 && m.ppda?.def > 0) {
      ppdaSum += m.ppda.att / m.ppda.def;
      ppdaCount++;
    }
    if (m.ppda_allowed?.att > 0 && m.ppda_allowed?.def > 0) {
      ppdaAllowedSum += m.ppda_allowed.att / m.ppda_allowed.def;
      ppdaAllowedCount++;
    }
  }

  const last7 = history.slice(-7);
  const last5 = history.slice(-5);
  const rollingAvg = (arr, key) =>
    arr.length
      ? Math.round((arr.reduce((s, m) => s + Number(m[key] ?? 0), 0) / arr.length) * 100) / 100
      : null;

  const xGRounded  = Math.round(xG  * 10) / 10;
  const xGARounded = Math.round(xGA * 10) / 10;

  return {
    xG:    xGRounded,
    xGA:   xGARounded,
    npxG:  Math.round(npxG  * 10) / 10,
    npxGA: Math.round(npxGA * 10) / 10,
    actualGoals:        actualGoals,
    actualGoalsAgainst: actualGoalsAgainst,
    // xGDiff > 0 means team scored more than xG suggests (overperforming — regression risk)
    // xGDiff < 0 means team scored less than xG suggests (underperforming — recovery potential)
    xGDiff:  Math.round((actualGoals        - xGRounded)  * 10) / 10,
    xGADiff: Math.round((actualGoalsAgainst - xGARounded) * 10) / 10,
    wins, draws, losses,
    matches: history.length,
    xG_7:  rollingAvg(last7, 'xG'),
    xGA_7: rollingAvg(last7, 'xGA'),
    xG_5:  rollingAvg(last5, 'xG'),
    xGA_5: rollingAvg(last5, 'xGA'),
    ppda:        ppdaCount        > 0 ? Math.round(ppdaSum        / ppdaCount        * 10) / 10 : null,
    ppdaAllowed: ppdaAllowedCount > 0 ? Math.round(ppdaAllowedSum / ppdaAllowedCount * 10) / 10 : null,
  };
}

/**
 * Fetch and parse Understat's embedded teamsData JSON for a league.
 * Returns Map<canonicalName → xgStats> or null.
 */
async function fetchLeagueXg(leagueSlug, season = CURRENT_SEASON) {
  const ustSlug = UNDERSTAT_SLUGS[leagueSlug];
  if (!ustSlug) return null; // MLS or unsupported

  const cacheKey = `xg:${leagueSlug}:${season}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const url = `https://understat.com/league/${ustSlug}/${season}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Hexa Soccer xG fetcher)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Understat HTTP ${res.status}`);
    const html = await res.text();

    // Understat embeds: var teamsData = JSON.parse('...encoded...')
    const match = html.match(/var\s+teamsData\s*=\s*JSON\.parse\s*\(\s*'([^']+)'/);
    if (!match) throw new Error('teamsData not found in Understat HTML');

    // Decode the URI-encoded JSON string
    const raw = decodeURIComponent(match[1].replace(/\\\//g, '/'));
    const teamsData = JSON.parse(raw);

    const result = new Map();
    for (const [teamName, data] of Object.entries(teamsData)) {
      const h = data?.history ?? [];
      const stats = computeXgStats(h);
      if (!stats) continue;
      result.set(normName(teamName), stats);
    }

    _cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log(`[soccer-xg] fetched Understat ${ustSlug}/${season}: ${result.size} teams`);
    return result;
  } catch (err) {
    console.warn(`[soccer-xg] Understat fetch failed for ${leagueSlug}: ${err.message}`);
    return null;
  }
}

/**
 * Get xG stats for a specific team in a league.
 * @param {string} leagueSlug — e.g. 'eng.1'
 * @param {string} teamName   — display name from ESPN (e.g. 'Arsenal')
 * @returns {{ xG, xGA, npxG, npxGA, matches } | null}
 */
export async function getSoccerTeamXg(leagueSlug, teamName) {
  const data = await fetchLeagueXg(leagueSlug);
  if (!data) return null;

  const needle = normName(teamName);

  // Exact match first
  if (data.has(needle)) return data.get(needle);

  // Partial match: needle contained in a key, or key contained in needle
  for (const [key, val] of data.entries()) {
    if (key.includes(needle) || needle.includes(key)) return val;
  }

  return null;
}

/**
 * Get xG for both teams in a matchup.
 * Returns { home: { xG, xGA }, away: { xG, xGA } } — nulls on failure.
 */
export async function getSoccerGameXg(leagueSlug, homeTeamName, awayTeamName) {
  const [home, away] = await Promise.all([
    getSoccerTeamXg(leagueSlug, homeTeamName).catch(() => null),
    getSoccerTeamXg(leagueSlug, awayTeamName).catch(() => null),
  ]);
  return { home, away };
}
