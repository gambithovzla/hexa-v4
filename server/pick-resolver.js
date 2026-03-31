/**
 * pick-resolver.js
 * Resolves pending Oracle picks against actual MLB game results.
 *
 * Exported:
 *   resolvePendingPicks() → { resolved, wins, losses, pushes, errors[] }
 */

import pool from './db.js';
import { getTodayGames } from './mlb-api.js';
import { getLiveGameData } from './live-feed.js';

// ── Nickname → abbreviation (lowercase keys for case-insensitive lookup) ─────

const NICKNAME_TO_ABBR = {
  'yankees': 'NYY', 'red sox': 'BOS', 'blue jays': 'TOR', 'orioles': 'BAL', 'rays': 'TB',
  'guardians': 'CLE', 'tigers': 'DET', 'white sox': 'CWS', 'royals': 'KC', 'twins': 'MIN',
  'astros': 'HOU', 'mariners': 'SEA', 'rangers': 'TEX', 'angels': 'LAA', 'athletics': 'OAK',
  'braves': 'ATL', 'mets': 'NYM', 'phillies': 'PHI', 'marlins': 'MIA', 'nationals': 'WSH',
  'brewers': 'MIL', 'cubs': 'CHC', 'cardinals': 'STL', 'reds': 'CIN', 'pirates': 'PIT',
  'dodgers': 'LAD', 'giants': 'SF', 'padres': 'SD', 'rockies': 'COL', 'diamondbacks': 'AZ',
};

// ── Abbreviation → nickname (all 30 franchises) ───────────────────────────────

const ABBR_TO_NICKNAME = {
  SF: 'Giants', SD: 'Padres', LAD: 'Dodgers', LAA: 'Angels',
  NYY: 'Yankees', NYM: 'Mets', BOS: 'Red Sox', CHC: 'Cubs',
  CWS: 'White Sox', HOU: 'Astros', ATL: 'Braves', PHI: 'Phillies',
  MIA: 'Marlins', WSH: 'Nationals', PIT: 'Pirates', STL: 'Cardinals',
  MIL: 'Brewers', CIN: 'Reds', COL: 'Rockies', AZ: 'Diamondbacks',
  TEX: 'Rangers', OAK: 'Athletics', SEA: 'Mariners', MIN: 'Twins',
  DET: 'Tigers', CLE: 'Guardians', KC: 'Royals', TB: 'Rays',
  TOR: 'Blue Jays', BAL: 'Orioles',
};

// ── Team matching helpers ─────────────────────────────────────────────────────

/**
 * Returns true if `token` identifies the team given by (teamName, teamAbbr).
 * Accepts: abbreviation ("NYY"), full name ("New York Yankees"), nickname ("Yankees").
 */
function tokenMatchesTeam(token, teamName, teamAbbr) {
  if (!token) return false;
  const t = token.trim().toLowerCase();
  const nameLower = (teamName ?? '').toLowerCase();
  const abbrLower = (teamAbbr ?? '').toLowerCase();

  // Direct abbreviation match: "SF" === "SF"
  if (abbrLower && t === abbrLower) return true;

  // Full / partial name match: "San Francisco Giants".includes("Giants")
  if (nameLower && nameLower.includes(t)) return true;

  // Token includes team name: "SF Giants".includes("Giants") — reversed check
  if (nameLower && t.includes(nameLower)) return true;

  // Nickname via reverse map: "Giants" → "SF"
  const abbrFromNick = NICKNAME_TO_ABBR[t];
  if (abbrFromNick && abbrLower && abbrFromNick === teamAbbr) return true;

  // Multi-word token: split and check if abbreviation OR nickname matches any word
  // Handles "SF Giants" → checks "sf" (=== abbr) ✓ and "giants" (=== nickname) ✓
  const words = t.split(/\s+/);
  if (words.length > 1) {
    for (const w of words) {
      if (abbrLower && w === abbrLower) return true;
      if (NICKNAME_TO_ABBR[w] === teamAbbr) return true;
    }
  }

  return false;
}

/**
 * Finds the game that corresponds to a matchup string.
 * Supports formats: "NYY vs BOS", "NYY @ BOS", "New York Yankees vs Boston Red Sox", etc.
 * Returns the game object or null.
 */
function findGame(matchup, games) {
  if (!matchup) return null;
  const parts = matchup.split(/\s+(?:vs\.?|@|at|-)\s+/i);
  if (parts.length < 2) return null;

  const [token1, token2] = parts;

  // Debug: log all available games so we can diagnose matching failures
  const date = games[0]?.gameDate?.slice(0, 10) ?? 'unknown';
  console.log(
    `[pick-resolver] Available games for ${date}:`,
    games.map(g => `${g.teams?.away?.abbreviation}(${g.teams?.away?.name}) @ ${g.teams?.home?.abbreviation}(${g.teams?.home?.name})`)
  );
  console.log(`[pick-resolver] Trying to match: "${matchup}" → tokens ["${token1}", "${token2}"]`);

  for (const game of games) {
    const home = game.teams?.home;
    const away = game.teams?.away;
    if (!home || !away) continue;

    // Standard: token1=away, token2=home  OR  token1=home, token2=away
    const direct   = tokenMatchesTeam(token1, away.name, away.abbreviation) &&
                     tokenMatchesTeam(token2, home.name, home.abbreviation);
    const reversed = tokenMatchesTeam(token1, home.name, home.abbreviation) &&
                     tokenMatchesTeam(token2, away.name, away.abbreviation);

    if (direct || reversed) return game;
  }
  return null;
}

// ── Player prop helpers ───────────────────────────────────────────────────────

function normalizeStat(raw) {
  const s = raw.toLowerCase().replace(/[^a-záéíóú\s]/g, '').trim();
  if (/hits?$/.test(s)) return 'hits';
  if (/home\s*runs?|hr|jonron/.test(s)) return 'homeRuns';
  if (/total\s*bases?|bases\s*totales/.test(s)) return 'totalBases';
  if (/rbi|carreras?\s*impulsadas?|runs?\s*batted/.test(s)) return 'rbi';
  if (/strikeouts?|ponches?|k/.test(s)) return 'strikeOuts';
  if (/stolen\s*bases?|bases?\s*robadas?|sb/.test(s)) return 'stolenBases';
  if (/walks?|bases?\s*por\s*bolas?|bb/.test(s)) return 'walks';
  return null;
}

function findPlayerStat(playerStats, playerName, stat) {
  if (!playerStats || !playerName || !stat) return null;
  const target = playerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const side of ['home', 'away']) {
    const sideData = playerStats[side];
    if (!sideData) continue;

    // Check batters for batting stats
    if (stat !== 'strikeOuts' || stat === 'strikeOuts') {
      const batters = sideData.batters ?? [];
      for (const b of batters) {
        const name = (b.name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (name.includes(target) || target.includes(name)) {
          if (stat === 'strikeOuts' && b[stat] != null) return b[stat];
          if (b[stat] != null) return b[stat];
        }
      }
    }

    // Check pitchers for strikeouts
    if (stat === 'strikeOuts') {
      const pitchers = sideData.pitchers ?? [];
      for (const p of pitchers) {
        const name = (p.name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (name.includes(target) || target.includes(name)) {
          if (p[stat] != null) return p[stat];
        }
      }
    }
  }
  return null;
}

// ── Pick parsing ──────────────────────────────────────────────────────────────

/**
 * Parses a pick string into structured components.
 * Supports English, Spanish and common betting abbreviations.
 *
 * Examples:
 *   "NYY Moneyline"              → { type: 'moneyline', team: 'NYY', line: null }
 *   "NYY ML"                     → { type: 'moneyline', team: 'NYY', line: null }
 *   "NYY A ganar"                → { type: 'moneyline', team: 'NYY', line: null }
 *   "NYY Dinero"                 → { type: 'moneyline', team: 'NYY', line: null }
 *   "NYY -1.5 Run Line"          → { type: 'runline_fav', team: 'NYY', line: 1.5 }
 *   "NYY -1.5 RL"                → { type: 'runline_fav', team: 'NYY', line: 1.5 }
 *   "NYY -1.5 Línea de Carrera"  → { type: 'runline_fav', team: 'NYY', line: 1.5 }
 *   "BOS +1.5 Run Line"          → { type: 'runline_dog', team: 'BOS', line: 1.5 }
 *   "Over 8.5"                   → { type: 'over',  team: null, line: 8.5 }
 *   "O 8.5"                      → { type: 'over',  team: null, line: 8.5 }
 *   "Más de 8.5"                 → { type: 'over',  team: null, line: 8.5 }
 *   "NYY Alta 8.5"               → { type: 'over',  team: 'NYY', line: 8.5 }
 *   "Under 8.5"                  → { type: 'under', team: null, line: 8.5 }
 *   "U 8.5"                      → { type: 'under', team: null, line: 8.5 }
 *   "Menos de 8.5"               → { type: 'under', team: null, line: 8.5 }
 *   "NYY Baja 8.5"               → { type: 'under', team: 'NYY', line: 8.5 }
 *
 * Returns null if the string cannot be parsed.
 */
function parsePick(pickStr) {
  if (!pickStr) return null;
  const s = pickStr.replace(/\s*\([^)]*\)\s*$/g, '').trim();

  // Strip all trailing parenthetical groups: "Over 8.5 (-104)" → "Over 8.5"
  // Handles multiple groups like "SF Giants Moneyline (Away) (-150)" → "SF Giants Moneyline"
  const cleaned = s.replace(/(\s*\([^)]*\))+\s*$/, '').trim();

  // Over — standalone: "Over 8.5", "O 8.5", "Más de 8.5", "Mas de 8.5"
  let m = cleaned.match(/^(?:Over|O|M[aá]s\s+de)\s+(\d+\.?\d*)\s*(?:Runs?|runs?)?$/i);
  if (m) return { type: 'over', team: null, line: parseFloat(m[1]) };

  // Under — standalone: "Under 8.5", "U 8.5", "Menos de 8.5"
  m = cleaned.match(/^(?:Under|U|Menos\s+de)\s+(\d+\.?\d*)\s*(?:Runs?|runs?)?$/i);
  if (m) return { type: 'under', team: null, line: parseFloat(m[1]) };

  // Over with team prefix — "NYY Alta 8.5"
  m = cleaned.match(/^(.+?)\s+Alta\s+(\d+\.?\d*)$/i);
  if (m) return { type: 'over', team: m[1].trim(), line: parseFloat(m[2]) };

  // Under with team prefix — "NYY Baja 8.5"
  m = cleaned.match(/^(.+?)\s+Baja\s+(\d+\.?\d*)$/i);
  if (m) return { type: 'under', team: m[1].trim(), line: parseFloat(m[2]) };

  // TEAM Moneyline — "NYY Moneyline", "NYY ML", "NYY A ganar", "NYY Dinero"
  m = cleaned.match(/^(.+?)\s+(?:Moneyline|ML|A\s+ganar|Dinero)$/i);
  if (m) return { type: 'moneyline', team: m[1].trim(), line: null };

  // Run Line keyword pattern
  const RL = /(?:Run\s+Line|RL|L[ií]nea\s+de\s+Carrera)/i;

  // TEAM +X.X Run Line  (underdog)
  m = cleaned.match(new RegExp(`^(.+?)\\s+\\+(\\d+\\.?\\d*)\\s+${RL.source}$`, 'i'));
  if (m) return { type: 'runline_dog', team: m[1].trim(), line: parseFloat(m[2]) };

  // TEAM -X.X Run Line  (favorite)
  m = cleaned.match(new RegExp(`^(.+?)\\s+-(\\d+\\.?\\d*)\\s+${RL.source}$`, 'i'));
  if (m) return { type: 'runline_fav', team: m[1].trim(), line: parseFloat(m[2]) };

  // Player prop: "Player Name — Over/Más de X.X hits/HR/strikeouts/etc (-odds)"
  // Also: "Player Name — Under/Menos de X.X hits (-odds)"
  m = cleaned.match(/^(.+?)\s*[—–-]\s*(?:Over|M[aá]s\s+de)\s+(\d+\.?\d*)\s+(.+)$/i);
  if (m) return { type: 'player_prop', direction: 'over', player: m[1].trim(), line: parseFloat(m[2]), stat: normalizeStat(m[3].trim()) };

  m = cleaned.match(/^(.+?)\s*[—–-]\s*(?:Under|Menos\s+de)\s+(\d+\.?\d*)\s+(.+)$/i);
  if (m) return { type: 'player_prop', direction: 'under', player: m[1].trim(), line: parseFloat(m[2]), stat: normalizeStat(m[3].trim()) };

  return null;
}

// ── Result resolution ─────────────────────────────────────────────────────────

/**
 * Determines whether a parsed pick won, lost, or pushed given a final game.
 * Returns 'win' | 'loss' | 'push' | null (null = unable to determine).
 */
function resolvePickResult(parsed, game) {
  const home = game.teams.home;
  const away = game.teams.away;
  const homeScore = Number(home.score);
  const awayScore = Number(away.score);

  if (isNaN(homeScore) || isNaN(awayScore)) return null;

  // ── Totals bets ────────────────────────────────────────────────────────────
  if (parsed.type === 'over') {
    const total = homeScore + awayScore;
    if (total > parsed.line) return 'win';
    if (total < parsed.line) return 'loss';
    return 'push';
  }

  if (parsed.type === 'under') {
    const total = homeScore + awayScore;
    if (total < parsed.line) return 'win';
    if (total > parsed.line) return 'loss';
    return 'push';
  }

  // ── Team bets: identify which side was picked ──────────────────────────────
  const pickedHome = tokenMatchesTeam(parsed.team, home.name, home.abbreviation);
  const pickedAway = tokenMatchesTeam(parsed.team, away.name, away.abbreviation);

  if (!pickedHome && !pickedAway) return null; // team not identified

  const pickedScore = pickedHome ? homeScore : awayScore;
  const otherScore  = pickedHome ? awayScore : homeScore;
  const diff        = pickedScore - otherScore; // positive = picked team winning

  if (parsed.type === 'moneyline') {
    if (diff > 0) return 'win';
    if (diff < 0) return 'loss';
    return 'push';
  }

  if (parsed.type === 'runline_fav') {
    // -1.5 → picked team must win by 2+ (diff > 1.5)
    if (diff > parsed.line) return 'win';
    if (diff < parsed.line) return 'loss';
    return 'push';
  }

  if (parsed.type === 'runline_dog') {
    // +1.5 → picked team must not lose by more than 1.5
    // Covers if diff + line > 0
    const margin = diff + parsed.line;
    if (margin > 0) return 'win';
    if (margin < 0) return 'loss';
    return 'push';
  }

  console.log(`[debug] parsed:`, JSON.stringify(parsed));
  console.log(`[debug] home:`, JSON.stringify({ name: game.teams.home.name, abbr: game.teams.home.abbreviation, score: game.teams.home.score }));
  console.log(`[debug] away:`, JSON.stringify({ name: game.teams.away.name, abbr: game.teams.away.abbreviation, score: game.teams.away.score }));
  console.log(`[debug] tokenMatch home:`, tokenMatchesTeam(parsed.team, game.teams.home.name, game.teams.home.abbreviation));
  console.log(`[debug] tokenMatch away:`, tokenMatchesTeam(parsed.team, game.teams.away.name, game.teams.away.abbreviation));
  return null;
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Fetches all pending picks, groups by date, resolves each against actual
 * game results, and writes the outcome ('win' | 'loss' | 'push') to the DB.
 *
 * @returns {Promise<{ resolved: number, wins: number, losses: number, pushes: number, errors: string[] }>}
 */
export async function resolvePendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, errors: [] };

  // 1. Fetch all pending picks (system job — no user_id filter)
  const { rows: picks } = await pool.query(
    "SELECT id, matchup, pick, created_at FROM picks WHERE result = 'pending'"
  );

  if (picks.length === 0) {
    console.log('[pick-resolver] No pending picks found.');
    return summary;
  }

  console.log(`[pick-resolver] Found ${picks.length} pending pick(s). Starting resolution...`);

  // 2. Group picks by date (YYYY-MM-DD from created_at)
  const byDate = {};
  for (const pick of picks) {
    // Use ET date from created_at (MLB games are scheduled in ET)
    // This prevents the UTC midnight boundary from shifting the date
    const pickDate = new Date(pick.created_at);
    const date = pickDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(pick);
  }

  // 3. Process each date
  for (const [date, datePicks] of Object.entries(byDate)) {
    let games;
    try {
      games = await getTodayGames(date);
    } catch (err) {
      const msg = `Failed to fetch games for ${date}: ${err.message}`;
      console.error(`[pick-resolver] ${msg}`);
      summary.errors.push(msg);
      continue;
    }

    for (const pick of datePicks) {
      try {
        // a. Find the game for this matchup
        const game = findGame(pick.matchup, games);
        if (!game) {
          console.log(
            `[pick-resolver] Pick #${pick.id}: "${pick.matchup}" — no matching game found for ${date}`
          );
          continue;
        }

        console.log(`[pick-resolver] Game found:`, JSON.stringify({
          matchup: `${game.teams?.away?.abbreviation} @ ${game.teams?.home?.abbreviation}`,
          status: game.status,
          score: `${game.teams?.away?.score} - ${game.teams?.home?.score}`
        }));

        // b. Skip if not final yet
        if (game.status?.simplified !== 'final') {
          console.log(
            `[pick-resolver] Pick #${pick.id}: "${pick.matchup}" — status: ${game.status?.simplified} (not final)`
          );
          continue;
        }

        // c. Parse the pick string
        const parsed = parsePick(pick.pick);
        if (!parsed) {
          const msg = `Pick #${pick.id}: unparseable pick string "${pick.pick}"`;
          console.warn(`[pick-resolver] ${msg}`);
          summary.errors.push(msg);
          continue;
        }

        if (parsed.type === 'player_prop') {
          // Need boxscore data to resolve player props
          if (!parsed.stat) {
            console.log(`[pick-resolver] Pick #${pick.id}: player prop with unknown stat type — skipping`);
            continue;
          }

          // Find the game for this pick
          const ppGame = findGame(pick.matchup, games);
          if (!ppGame) {
            console.log(`[pick-resolver] Pick #${pick.id}: no matching game for "${pick.matchup}"`);
            continue;
          }

          // Only resolve if game is final
          const gameStatus = (ppGame.status?.simplified ?? ppGame.status?.abstractGameState ?? '').toLowerCase();
          if (gameStatus !== 'final') {
            console.log(`[pick-resolver] Pick #${pick.id}: game not final yet (${gameStatus})`);
            continue;
          }

          try {
            const liveData = await getLiveGameData(ppGame.gamePk);
            if (!liveData?.playerStats) {
              console.log(`[pick-resolver] Pick #${pick.id}: no playerStats in boxscore`);
              continue;
            }

            const actual = findPlayerStat(liveData.playerStats, parsed.player, parsed.stat);
            if (actual == null) {
              console.log(`[pick-resolver] Pick #${pick.id}: player "${parsed.player}" stat "${parsed.stat}" not found in boxscore`);
              continue;
            }

            let result;
            if (parsed.direction === 'over') {
              result = actual > parsed.line ? 'win' : actual === parsed.line ? 'push' : 'loss';
            } else {
              result = actual < parsed.line ? 'win' : actual === parsed.line ? 'push' : 'loss';
            }

            await pool.query('UPDATE picks SET result = $1 WHERE id = $2', [result, pick.id]);
            summary.resolved++;
            if (result === 'win') summary.wins++;
            else if (result === 'loss') summary.losses++;
            else summary.pushes++;
            console.log(`[pick-resolver] Pick #${pick.id}: ${parsed.player} ${parsed.stat} = ${actual} vs ${parsed.direction} ${parsed.line} → ${result}`);
          } catch (err) {
            summary.errors.push(`Pick #${pick.id}: player prop resolve error — ${err.message}`);
          }
          continue;
        }

        // d. Determine result
        const result = resolvePickResult(parsed, game);
        if (!result) {
          const msg = `Pick #${pick.id}: could not resolve "${pick.pick}" for matchup "${pick.matchup}"`;
          console.warn(`[pick-resolver] ${msg}`);
          summary.errors.push(msg);
          continue;
        }

        // e. Persist result
        await pool.query('UPDATE picks SET result = $1 WHERE id = $2', [result, pick.id]);

        const awayScore = game.teams.away.score;
        const homeScore = game.teams.home.score;
        console.log(
          `[pick-resolver] Pick #${pick.id}: "${pick.matchup}" — pick: "${pick.pick}" — result: ${result.toUpperCase()} (score: ${awayScore}-${homeScore})`
        );

        summary.resolved++;
        if (result === 'win')  summary.wins++;
        if (result === 'loss') summary.losses++;
        if (result === 'push') summary.pushes++;

      } catch (err) {
        const msg = `Pick #${pick.id}: unexpected error — ${err.message}`;
        console.error(`[pick-resolver] ${msg}`);
        summary.errors.push(msg);
      }
    }
  }

  console.log(
    `[pick-resolver] Done — resolved: ${summary.resolved}, wins: ${summary.wins}, ` +
    `losses: ${summary.losses}, pushes: ${summary.pushes}, errors: ${summary.errors.length}`
  );
  return summary;
}
