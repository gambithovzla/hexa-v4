/**
 * nfl-props-resolver.js — Parses and resolves NFL player prop picks against
 * ESPN game boxscore player stats.
 *
 * Isolated from the MLB props-resolver.js (which is baseball-centric: GUMBO feed,
 * batting/pitching). This is the NFL analogue: it reads ESPN's `/summary` boxscore
 * (`boxscore.players[].statistics[]` — passing / rushing / receiving categories,
 * each with labels + athletes[].stats) and resolves over/under prop picks.
 *
 * Supported prop kinds (the liquid, cleanly-resolvable ones):
 *   pass_yds, pass_tds, pass_completions, pass_attempts, pass_interceptions,
 *   rush_yds, rush_attempts, reception_yds, receptions, anytime_td
 *
 * Exported:
 *   NFL_PROP_KINDS                  — Set of canonical kinds
 *   parseNflProp(text)             — pick string → { playerName, side, line, propKind } | null
 *   resolveNflPropKind(raw)        — free text → canonical kind | null
 *   getNflGameBoxscore(eventId)    — ESPN summary → { [normName]: playerStats }
 *   resolveNflPlayerProp(pick, players)  — { result, playerName, propType, line, actual } | null
 *   resolveNflPropFromActual(parsed, actual) — pure resolver (unit-testable, no network)
 */

const ESPN_NFL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

export const NFL_PROP_KINDS = new Set([
  'pass_yds', 'pass_tds', 'pass_completions', 'pass_attempts', 'pass_interceptions',
  'rush_yds', 'rush_attempts', 'reception_yds', 'receptions', 'anytime_td',
]);

// [keyword, canonical kind]. Matched LONGEST keyword first so "receiving yards"
// wins over a bare "yards" and "passing touchdowns" never collides with "passing
// yards". Bilingual (en/es). Bare "td" is deliberately excluded — too collision-prone.
const NFL_PROP_KIND_ENTRIES = [
  ['passing yards', 'pass_yds'], ['pass yards', 'pass_yds'], ['pass yds', 'pass_yds'],
  ['yardas de pase', 'pass_yds'], ['yardas por pase', 'pass_yds'],
  ['passing touchdowns', 'pass_tds'], ['passing tds', 'pass_tds'], ['pass tds', 'pass_tds'],
  ['pass td', 'pass_tds'], ['touchdowns de pase', 'pass_tds'],
  ['pass completions', 'pass_completions'], ['completions', 'pass_completions'],
  ['pases completos', 'pass_completions'],
  ['passing attempts', 'pass_attempts'], ['pass attempts', 'pass_attempts'],
  ['intentos de pase', 'pass_attempts'],
  ['interceptions', 'pass_interceptions'], ['intercepciones', 'pass_interceptions'],
  ['rushing yards', 'rush_yds'], ['rush yards', 'rush_yds'], ['rush yds', 'rush_yds'],
  ['yardas terrestres', 'rush_yds'], ['yardas por tierra', 'rush_yds'],
  ['rushing attempts', 'rush_attempts'], ['rush attempts', 'rush_attempts'],
  ['carries', 'rush_attempts'], ['acarreos', 'rush_attempts'],
  ['receiving yards', 'reception_yds'], ['reception yards', 'reception_yds'],
  ['rec yards', 'reception_yds'], ['rec yds', 'reception_yds'],
  ['yardas por recepcion', 'reception_yds'], ['yardas de recepcion', 'reception_yds'],
  ['receptions', 'receptions'], ['recepciones', 'receptions'], ['catches', 'receptions'],
  ['anytime touchdown', 'anytime_td'], ['anytime td', 'anytime_td'],
  ['anotar touchdown', 'anytime_td'], ['td scorer', 'anytime_td'], ['touchdown', 'anytime_td'],
].sort((a, b) => b[0].length - a[0].length);

function normalizeText(t) {
  return String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveNflPropKind(raw) {
  const key = normalizeText(raw);
  if (!key) return null;
  for (const [keyword, kind] of NFL_PROP_KIND_ENTRIES) {
    if (key.includes(keyword)) return kind;
  }
  return null;
}

function resolveSide(raw) {
  const key = normalizeText(raw);
  if (/^(over|o|mas de|alto|arriba)$/.test(key) || key.includes('over') || key.includes('mas de')) {
    return 'over';
  }
  if (/^(under|u|menos de|bajo|abajo)$/.test(key) || key.includes('under') || key.includes('menos de')) {
    return 'under';
  }
  return null;
}

/**
 * Parses an NFL player prop pick string into structured fields. Tolerates both
 * orderings ("Player Over 274.5 Passing Yards" and "Player Passing Yards Over
 * 274.5") plus the line-less "Player Anytime TD" yes-market form.
 *
 * Anchors on the over/under+line token and the prop-kind keyword independently,
 * so word order between them does not matter. Returns null when the text is not
 * a recognizable NFL prop (e.g. a team spread/total/moneyline pick).
 */
export function parseNflProp(text) {
  if (!text) return null;
  const s = String(text)
    .trim()
    .replace(/\s*\([+-]?\d+\)\s*$/i, '')   // strip trailing "(-110)"
    .replace(/\s+[+-]\d{2,3}\s*$/i, '')     // strip trailing "-110"
    .replace(/\s*\((?:yes|si|sí|over|under)\)\s*$/i, '')
    .trim();
  if (!s) return null;

  const kindHit = matchKindInText(s);
  if (!kindHit) return null;

  const slMatch = s.match(/\b(over|under|mas de|m[aá]s de|menos de|alto|bajo)\s+(\d+(?:\.\d+)?)\b/i);
  if (slMatch) {
    const player = stripSegments(s, [slMatch[0], kindHit.matched]);
    if (!player) return null;
    return {
      playerName: player,
      side: resolveSide(slMatch[1]),
      line: parseFloat(slMatch[2]),
      propKind: kindHit.kind,
    };
  }

  // Line-less anytime TD: "Christian McCaffrey Anytime TD" → over 0.5.
  if (kindHit.kind === 'anytime_td') {
    const player = stripSegments(s, [kindHit.matched]);
    if (player) return { playerName: player, side: 'over', line: 0.5, propKind: 'anytime_td' };
  }
  return null;
}

function matchKindInText(s) {
  const norm = normalizeText(s);
  for (const [keyword, kind] of NFL_PROP_KIND_ENTRIES) {
    if (!norm.includes(keyword)) continue;
    // Recover the matched substring from the original (un-normalized) string so
    // we can strip it. Accent-insensitive match on word-ish boundaries.
    const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const m = s.normalize('NFD').replace(/[̀-ͯ]/g, '').match(re);
    return { kind, matched: m ? m[0] : keyword };
  }
  return null;
}

function stripSegments(s, segments) {
  let out = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const seg of segments) {
    if (!seg) continue;
    const re = new RegExp(seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function findPlayer(players, playerName) {
  const query = normName(playerName);
  if (!query) return null;
  if (players[query]) return players[query];

  for (const [key, player] of Object.entries(players)) {
    if (key.includes(query) || query.includes(key)) return player;
    const queryLast = query.split(' ').pop();
    const keyLast = key.split(' ').pop();
    if (queryLast === keyLast && queryLast.length > 2) return player;
  }
  return null;
}

// ── Boxscore ────────────────────────────────────────────────────────────────

function labelIndex(labels, name) {
  if (!Array.isArray(labels)) return -1;
  return labels.findIndex(l => String(l).toUpperCase() === name.toUpperCase());
}

function numAt(stats, idx) {
  if (idx < 0 || !Array.isArray(stats)) return null;
  const v = parseFloat(String(stats[idx] ?? '').replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

/**
 * Builds a flat per-player stat map from an ESPN summary boxscore.players block.
 * Pure (no network) so it can be unit-tested with a captured fixture.
 *
 * @param {Array} teams - boxscore.players (array of two team blocks)
 * @returns {Object} { [normName]: { name, team, pass_yds, pass_tds, ... , anytime_td } }
 */
export function parseNflBoxscorePlayers(teams) {
  const players = {};
  if (!Array.isArray(teams)) return players;

  for (const team of teams) {
    const teamAbbr = team?.team?.abbreviation ?? null;
    for (const cat of team?.statistics ?? []) {
      const name = String(cat?.name ?? '').toLowerCase();
      const labels = cat?.labels ?? [];
      for (const athlete of cat?.athletes ?? []) {
        const displayName = athlete?.athlete?.displayName;
        if (!displayName) continue;
        const stats = athlete?.stats ?? [];
        const key = normName(displayName);
        const p = (players[key] ??= {
          name: displayName, team: teamAbbr, playerId: athlete?.athlete?.id ?? null,
          pass_yds: null, pass_tds: null, pass_completions: null, pass_attempts: null,
          pass_interceptions: null, rush_yds: null, rush_attempts: null, rush_td: null,
          reception_yds: null, receptions: null, rec_td: null,
        });

        if (name === 'passing') {
          p.pass_yds = numAt(stats, labelIndex(labels, 'YDS'));
          p.pass_tds = numAt(stats, labelIndex(labels, 'TD'));
          p.pass_interceptions = numAt(stats, labelIndex(labels, 'INT'));
          const cAtt = String(stats[labelIndex(labels, 'C/ATT')] ?? '');
          const [comp, att] = cAtt.split('/').map(x => parseInt(x, 10));
          p.pass_completions = Number.isFinite(comp) ? comp : null;
          p.pass_attempts = Number.isFinite(att) ? att : null;
        } else if (name === 'rushing') {
          p.rush_yds = numAt(stats, labelIndex(labels, 'YDS'));
          p.rush_attempts = numAt(stats, labelIndex(labels, 'CAR'));
          p.rush_td = numAt(stats, labelIndex(labels, 'TD'));
        } else if (name === 'receiving') {
          p.reception_yds = numAt(stats, labelIndex(labels, 'YDS'));
          p.receptions = numAt(stats, labelIndex(labels, 'REC'));
          p.rec_td = numAt(stats, labelIndex(labels, 'TD'));
        }
      }
    }
  }

  // Anytime TD = rushing + receiving touchdowns (a thrown TD does not score the QB).
  for (const p of Object.values(players)) {
    p.anytime_td = (p.rush_td ?? 0) + (p.rec_td ?? 0);
  }
  return players;
}

/**
 * Fetches an ESPN game summary and returns the flattened per-player stat map.
 * Throws on HTTP failure (the resolver loop catches and logs).
 */
export async function getNflGameBoxscore(eventId) {
  const url = `${ESPN_NFL}/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN summary failed: ${res.status}`);
  const data = await res.json();
  return parseNflBoxscorePlayers(data?.boxscore?.players);
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Pure over/under resolution given the actual stat value. Unit-testable.
 */
export function resolveNflPropFromActual(parsed, actual) {
  if (!parsed || actual == null) return null;
  const { side, line } = parsed;
  let result;
  if (side === 'over') {
    result = actual > line ? 'win' : actual < line ? 'loss' : 'push';
  } else {
    result = actual < line ? 'win' : actual > line ? 'loss' : 'push';
  }
  return result;
}

/**
 * Resolves an NFL player prop pick string against a boxscore player map.
 * Returns { result, playerName, propType, line, actual } — result is null with
 * an `error` field when the player or stat cannot be located.
 */
export function resolveNflPlayerProp(pickStr, players) {
  const parsed = parseNflProp(pickStr);
  if (!parsed || !players) return null;

  const player = findPlayer(players, parsed.playerName);
  if (!player) {
    return { result: null, playerName: parsed.playerName, propType: parsed.propKind, line: parsed.line, actual: null, error: 'player_not_found' };
  }

  const actual = player[parsed.propKind];
  if (actual == null) {
    return { result: null, playerName: parsed.playerName, propType: parsed.propKind, line: parsed.line, actual: null, error: 'stat_not_found' };
  }

  const result = resolveNflPropFromActual(parsed, actual);
  return { result, playerName: parsed.playerName, propType: parsed.propKind, line: parsed.line, actual };
}
