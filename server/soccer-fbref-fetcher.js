/**
 * soccer-fbref-fetcher.js — set-piece stats (SCA/GCA dead-ball per 90) from FBref.
 *
 * FBref embeds squad stats in HTML tables with `data-stat` attributes on every cell,
 * making regex-based extraction reliable without a full HTML parser. We fetch the
 * Goal Creation (GCA) page per league and extract dead-ball shot/goal-creation rates
 * for both the offensive table (how dangerous from set pieces) and the defensive table
 * (how many set-piece chances the team concedes).
 *
 * Supported leagues:
 *   eng.1 → /comps/9/gca/Premier-League-Stats
 *   esp.1 → /comps/12/gca/La-Liga-Stats
 *   ita.1 → /comps/11/gca/Serie-A-Stats
 *   ger.1 → /comps/20/gca/Bundesliga-Stats
 *   fra.1 → /comps/13/gca/Ligue-1-Stats
 *   usa.1 → /comps/22/gca/Major-League-Soccer-Stats
 *
 * Usage:
 *   const sp = await getSoccerSetPieceStats('eng.1', 'Arsenal');
 *   // → { scaDeadBallPer90: 1.7, gcaDeadBallPer90: 0.24,
 *   //     scaDeadBallAllowedPer90: 1.4, gcaDeadBallAllowedPer90: 0.18 } | null
 */

const FBREF_LEAGUES = {
  'eng.1': { id: 9,  slug: 'Premier-League' },
  'esp.1': { id: 12, slug: 'La-Liga' },
  'ita.1': { id: 11, slug: 'Serie-A' },
  'ger.1': { id: 20, slug: 'Bundesliga' },
  'fra.1': { id: 13, slug: 'Ligue-1' },
  'usa.1': { id: 22, slug: 'Major-League-Soccer' },
};

// Dead-ball (set-piece) columns in FBref GCA tables
const GCA_FIELDS = ['sca_passes_dead_per90', 'gca_passes_dead_per90'];

// FBref uses these table IDs for squad GCA stats (try each in order)
const TABLE_FOR     = ['stats_squads_gca_for',     'stats_gca_squads_for',     'stats_gca'];
const TABLE_AGAINST = ['stats_squads_gca_against',  'stats_gca_squads_against', 'stats_gca_against'];

const _cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — set-piece stats stable within a matchweek

function normName(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|cf|sc|afc|ac|club|cd|ud|rc)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Parse FBref squad HTML tables with `data-stat` attributes.
 * Exported as a pure function for unit tests.
 *
 * @param {string} html        — full page HTML (or partial containing the table)
 * @param {string[]} tableIds  — ordered list of table IDs to try
 * @param {string[]} fields    — data-stat column names to extract
 * @returns {Map<normName, {name, ...fields}> | null}
 */
export function parseFBrefSquadTable(html, tableIds, fields) {
  if (!html) return null;

  // Find the first matching table
  let tableHtml = null;
  for (const tid of tableIds) {
    const re = new RegExp(`<table[^>]+id="${tid}"[^>]*>([\\s\\S]*?)<\\/table>`, 'i');
    const m = html.match(re);
    if (m) { tableHtml = m[1]; break; }
  }
  if (!tableHtml) return null;

  const result = new Map();

  // Iterate over all <tr> elements inside the table
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];

    // Skip sub-header rows (all-<th> rows inserted as repeat headers in tbody)
    if (!/<td/.test(rowHtml)) continue;

    // Extract team name — FBref puts it in a <th> or <td> with data-stat="squad"
    const squadM = rowHtml.match(/data-stat="squad"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    if (!squadM) continue;
    const teamName = squadM[1].trim();
    if (!teamName || teamName === 'Squad') continue;

    const teamData = { name: teamName };
    for (const field of fields) {
      const re = new RegExp(`data-stat="${field}"[^>]*>([^<]*)`);
      const m = rowHtml.match(re);
      if (m) {
        const raw = m[1].trim().replace(/,/g, '');
        const n = parseFloat(raw);
        teamData[field] = Number.isFinite(n) ? n : null;
      } else {
        teamData[field] = null;
      }
    }

    result.set(normName(teamName), teamData);
  }

  return result.size > 0 ? result : null;
}

/**
 * Fetch and parse FBref GCA page for a league.
 * Returns { for: Map, against: Map } — either can be null on failure.
 */
async function fetchLeagueGca(leagueSlug) {
  const meta = FBREF_LEAGUES[leagueSlug];
  if (!meta) return null;

  const cacheKey = `fbref:gca:${leagueSlug}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const url = `https://fbref.com/en/comps/${meta.id}/gca/${meta.slug}-Stats`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Hexa Soccer set-piece stats fetcher)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`FBref HTTP ${res.status}`);
    const html = await res.text();

    const forMap     = parseFBrefSquadTable(html, TABLE_FOR,     GCA_FIELDS);
    const againstMap = parseFBrefSquadTable(html, TABLE_AGAINST, GCA_FIELDS);

    const data = { for: forMap, against: againstMap };
    _cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    console.log(`[soccer-fbref] fetched ${leagueSlug} GCA: for=${forMap?.size ?? 0} against=${againstMap?.size ?? 0} teams`);
    return data;
  } catch (err) {
    console.warn(`[soccer-fbref] fetch failed for ${leagueSlug}: ${err.message}`);
    if (cached) return cached.data;
    return null;
  }
}

function lookupTeam(map, teamName) {
  if (!map) return null;
  const needle = normName(teamName);
  if (map.has(needle)) return map.get(needle);
  for (const [key, val] of map.entries()) {
    if (key.includes(needle) || needle.includes(key)) return val;
  }
  return null;
}

/**
 * Get set-piece stats for a specific team.
 * @returns {{ scaDeadBallPer90, gcaDeadBallPer90,
 *             scaDeadBallAllowedPer90, gcaDeadBallAllowedPer90 } | null}
 */
export async function getSoccerSetPieceStats(leagueSlug, teamName) {
  const leagueData = await fetchLeagueGca(leagueSlug);
  if (!leagueData) return null;

  const forRow     = lookupTeam(leagueData.for,     teamName);
  const againstRow = lookupTeam(leagueData.against, teamName);

  if (!forRow && !againstRow) return null;

  return {
    scaDeadBallPer90:         forRow?.sca_passes_dead_per90     ?? null,
    gcaDeadBallPer90:         forRow?.gca_passes_dead_per90     ?? null,
    scaDeadBallAllowedPer90:  againstRow?.sca_passes_dead_per90 ?? null,
    gcaDeadBallAllowedPer90:  againstRow?.gca_passes_dead_per90 ?? null,
  };
}

/**
 * Get set-piece stats for both teams in a matchup (parallel fetch).
 */
export async function getSoccerGameSetPieceStats(leagueSlug, homeTeamName, awayTeamName) {
  const [home, away] = await Promise.all([
    getSoccerSetPieceStats(leagueSlug, homeTeamName).catch(() => null),
    getSoccerSetPieceStats(leagueSlug, awayTeamName).catch(() => null),
  ]);
  return { home, away };
}
