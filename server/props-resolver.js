/**
 * props-resolver.js — Resolves player prop picks against MLB boxscore data
 *
 * Uses GUMBO feed to get individual player stats from completed games.
 * Supports: Pitcher Ks, Batter Hits, Total Bases, HR, RBI, Stolen Bases
 */

const MLB_BASE = 'https://statsapi.mlb.com/api/v1.1';

/**
 * Fetches boxscore from GUMBO feed and returns individual player stats
 */
export async function getGameBoxscore(gamePk) {
  const url = `${MLB_BASE}/game/${gamePk}/feed/live`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GUMBO feed failed: ${res.status}`);
  const data = await res.json();

  const boxscore = data.liveData?.boxscore;
  if (!boxscore) return null;

  const players = {};

  // Process both teams
  for (const side of ['home', 'away']) {
    const teamPlayers = boxscore.teams?.[side]?.players ?? {};
    for (const [key, player] of Object.entries(teamPlayers)) {
      const name = player.person?.fullName;
      if (!name) continue;

      const batting = player.stats?.batting ?? {};
      const pitching = player.stats?.pitching ?? {};

      players[name.toLowerCase()] = {
        name,
        side,
        playerId: player.person?.id,
        batting: {
          hits: parseInt(batting.hits ?? 0),
          totalBases: parseInt(batting.totalBases ?? 0),
          homeRuns: parseInt(batting.homeRuns ?? 0),
          rbi: parseInt(batting.rbi ?? 0),
          stolenBases: parseInt(batting.stolenBases ?? 0),
          atBats: parseInt(batting.atBats ?? 0),
          runs: parseInt(batting.runs ?? 0),
          doubles: parseInt(batting.doubles ?? 0),
          triples: parseInt(batting.triples ?? 0),
          strikeOuts: parseInt(batting.strikeOuts ?? 0),
          baseOnBalls: parseInt(batting.baseOnBalls ?? 0),
        },
        pitching: {
          strikeOuts: parseInt(pitching.strikeOuts ?? 0),
          inningsPitched: parseFloat(pitching.inningsPitched ?? 0),
          hits: parseInt(pitching.hits ?? 0),
          runs: parseInt(pitching.runs ?? 0),
          earnedRuns: parseInt(pitching.earnedRuns ?? 0),
          baseOnBalls: parseInt(pitching.baseOnBalls ?? 0),
          homeRuns: parseInt(pitching.homeRuns ?? 0),
        },
      };
    }
  }

  return players;
}

/**
 * Normalizes a player name for fuzzy matching
 */
function normName(name) {
  return (name ?? '').toLowerCase().replace(/[.,'-]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Finds a player in the boxscore by name (fuzzy match)
 */
function findPlayer(players, playerName) {
  const query = normName(playerName);

  // Exact match
  if (players[query]) return players[query];

  // Partial match
  for (const [key, player] of Object.entries(players)) {
    if (key.includes(query) || query.includes(key)) return player;
    // Last name match
    const queryLast = query.split(' ').pop();
    const keyLast = key.split(' ').pop();
    if (queryLast === keyLast && queryLast.length > 2) return player;
  }

  return null;
}

/**
 * Parses a player prop pick string and resolves against boxscore
 *
 * Supported formats:
 *   "Colt Keith Over 1.5 Total Bases"
 *   "Gerrit Cole Over 6.5 Strikeouts"
 *   "Juan Soto Over 1.5 Hits"
 *   "Aaron Judge Over 0.5 Home Runs" / "HR"
 *   "Player Over 0.5 RBI"
 *   "Player Over 0.5 Stolen Bases" / "SB"
 *   Also handles Spanish: "Bases Totales", "Ponches", "Carreras Impulsadas"
 *
 * Returns { result: 'win'|'loss'|'push', playerName, propType, line, actual } or null
 */
export function resolvePlayerProp(pickStr, players) {
  if (!pickStr || !players) return null;

  const s = pickStr.trim()
    .replace(/\s*\([+-]?\d+\)\s*$/i, '')
    .replace(/\s+[+-]\d{2,3}\s*$/i, '')
    .replace(/\s*\(estimated[^)]*\)\s*$/i, '')
    .replace(/\s*\(est\.?\)\s*$/i, '')
    .trim();

  // Pattern: [Player Name] [Over|Under] [Line] [Prop Type]
  const patterns = [
    // Stat before direction: "Jack Flaherty Strikeouts Over 4.5"
    { regex: /^(.+?)\s+(?:Total\s+Bases|TB|Bases\s+Totales)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'totalBases', stat: 'batting' },
    { regex: /^(.+?)\s+(?:Strikeouts?|Ks?|Ponches?)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'strikeOuts', stat: 'pitching' },
    { regex: /^(.+?)\s+(?:Hits?|H)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'hits', stat: 'batting' },
    { regex: /^(.+?)\s+(?:Home\s+Runs?|HRs?|Jonrones?|Cuadrangulares?)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'homeRuns', stat: 'batting' },
    { regex: /^(.+?)\s+(?:RBIs?|Carreras?\s+Impulsadas?)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'rbi', stat: 'batting' },
    { regex: /^(.+?)\s+(?:Stolen\s+Bases?|SBs?|Bases?\s+Robadas?)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'stolenBases', stat: 'batting' },
    { regex: /^(.+?)\s+(?:Runs?\s+Scored|Runs?|Carreras?\s+Anotadas?)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'runs', stat: 'batting' },
    { regex: /^(.+?)\s+(?:Walks?|BB|Bases?\s+por\s+Bolas?)\s+(Over|Under)\s+(\d+\.?\d*)/i, prop: 'baseOnBalls', stat: 'batting' },

    // English
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Total\s+Bases|TB|Bases\s+Totales)/i, prop: 'totalBases', stat: 'batting' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Strikeouts?|Ks?|Ponches?)/i, prop: 'strikeOuts', stat: 'pitching' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Hits?|H)/i, prop: 'hits', stat: 'batting' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Home\s+Runs?|HRs?|Jonrones?|Cuadrangulares?)/i, prop: 'homeRuns', stat: 'batting' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:RBIs?|Carreras?\s+Impulsadas?)/i, prop: 'rbi', stat: 'batting' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Stolen\s+Bases?|SBs?|Bases?\s+Robadas?)/i, prop: 'stolenBases', stat: 'batting' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Runs?\s+Scored|Runs?|Carreras?\s+Anotadas?)/i, prop: 'runs', stat: 'batting' },
    { regex: /^(.+?)\s+(Over|Under)\s+(\d+\.?\d*)\s+(?:Walks?|BB|Bases?\s+por\s+Bolas?)/i, prop: 'baseOnBalls', stat: 'batting' },
  ];

  for (const { regex, prop, stat } of patterns) {
    const m = s.match(regex);
    if (!m) continue;

    const playerName = m[1].trim();
    const direction = m[2].toLowerCase();
    const line = parseFloat(m[3]);

    const player = findPlayer(players, playerName);
    if (!player) {
      console.log(`  ⚠ Player "${playerName}" not found in boxscore`);
      return { result: null, playerName, propType: prop, line, actual: null, error: 'player_not_found' };
    }

    const actual = player[stat]?.[prop] ?? null;
    if (actual == null) {
      return { result: null, playerName, propType: prop, line, actual: null, error: 'stat_not_found' };
    }

    let result;
    if (direction === 'over') {
      result = actual > line ? 'win' : actual < line ? 'loss' : 'push';
    } else {
      result = actual < line ? 'win' : actual > line ? 'loss' : 'push';
    }

    console.log(`  → Prop resolved: ${playerName} ${direction} ${line} ${prop} — actual: ${actual} — ${result.toUpperCase()}`);
    return { result, playerName, propType: prop, line, actual };
  }

  return null;
}
