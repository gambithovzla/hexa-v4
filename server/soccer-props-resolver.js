/**
 * soccer-props-resolver.js — Parses and resolves soccer player prop picks against
 * ESPN match boxscore player stats.
 *
 * Soccer analog of nfl-props-resolver.js (and isolated from the MLB GUMBO
 * props-resolver.js). Reads ESPN's soccer `/summary` boxscore
 * (`boxscore.players[].statistics[]` — one combined stat category per team, each
 * with `keys`/`names`/`labels` + `athletes[].stats`) and resolves over/under prop
 * picks. The pure parser + resolver are unit-testable with a captured fixture;
 * only getSoccerGameBoxscore touches the network.
 *
 * Supported prop kinds (the liquid, cleanly-resolvable ones):
 *   shots_on_target, shots, goals, assists, passes, tackles, fouls, saves,
 *   anytime_goal (yes-market — "to score", line-less, over 0.5)
 *
 * Soccer-specific vs NFL:
 *   - The team boxscore block usually holds ONE stat category with every metric
 *     (not split passing/rushing/receiving), so we merge across categories
 *     defensively.
 *   - anytime_goal is the popular yes-market: actual = 1 if the player scored ≥1.
 *
 * Exported:
 *   SOCCER_PROP_KINDS                       — Set of canonical kinds
 *   parseSoccerProp(text)                   — pick string → { playerName, side, line, propKind } | null
 *   resolveSoccerPropKind(raw)              — free text → canonical kind | null
 *   parseSoccerBoxscorePlayers(teams)       — boxscore.players → { [normName]: stats } (pure)
 *   getSoccerGameBoxscore(leagueSlug, id)   — ESPN summary → { [normName]: stats }
 *   resolveSoccerPropFromActual(parsed, actual)  — pure over/under resolver
 *   resolveSoccerPlayerProp(pick, players)  — { result, playerName, propType, line, actual } | null
 */

import { getSoccerGameSummary } from './soccer-api.js';

export const SOCCER_PROP_KINDS = new Set([
  'shots_on_target', 'shots', 'goals', 'assists',
  'passes', 'tackles', 'fouls', 'saves', 'anytime_goal',
]);

// [keyword, canonical kind]. Matched LONGEST keyword first so "shots on target"
// wins over a bare "shots", and "to score"/"goalscorer" win over "goals".
// Bilingual (en/es). Bare "gol" is deliberately excluded — too collision-prone.
const SOCCER_PROP_KIND_ENTRIES = [
  ['shots on target', 'shots_on_target'], ['shots on goal', 'shots_on_target'],
  ['tiros a puerta', 'shots_on_target'], ['disparos a puerta', 'shots_on_target'],
  ['remates a puerta', 'shots_on_target'],
  ['total shots', 'shots'], ['shots', 'shots'], ['tiros', 'shots'],
  ['disparos', 'shots'], ['remates', 'shots'],
  ['assists', 'assists'], ['asistencias', 'assists'],
  ['passes', 'passes'], ['pases', 'passes'],
  ['tackles', 'tackles'], ['entradas', 'tackles'], ['quites', 'tackles'],
  ['fouls committed', 'fouls'], ['fouls', 'fouls'], ['faltas', 'fouls'],
  ['saves', 'saves'], ['atajadas', 'saves'], ['paradas', 'saves'],
  ['anytime goalscorer', 'anytime_goal'], ['anytime goal', 'anytime_goal'],
  ['goalscorer', 'anytime_goal'], ['to score', 'anytime_goal'],
  ['marcar gol', 'anytime_goal'], ['anotar gol', 'anytime_goal'], ['marca gol', 'anytime_goal'],
  ['goals', 'goals'], ['goles', 'goals'], ['goal', 'goals'],
].sort((a, b) => b[0].length - a[0].length);

// kind → ESPN machine-key candidates (normalized: lowercased, alnum only).
const KIND_STAT_KEYS = {
  goals:           ['goals', 'totalgoals'],
  assists:         ['assists', 'goalassists'],
  shots:           ['totalshots', 'shots', 'shotstotal'],
  shots_on_target: ['shotsongoal', 'shotsontarget', 'ontargetscoringattempt'],
  passes:          ['totalpasses', 'passes', 'accuratepasses'],
  tackles:         ['totaltackles', 'tackles', 'effectivetackles'],
  fouls:           ['foulscommitted', 'fouls'],
  saves:           ['saves', 'savesmade'],
};

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

function normKey(k) {
  return String(k ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

export function resolveSoccerPropKind(raw) {
  const key = normalizeText(raw);
  if (!key) return null;
  for (const [keyword, kind] of SOCCER_PROP_KIND_ENTRIES) {
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

function matchKindInText(s) {
  const norm = normalizeText(s);
  for (const [keyword, kind] of SOCCER_PROP_KIND_ENTRIES) {
    if (!norm.includes(keyword)) continue;
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

/**
 * Parses a soccer player prop pick string into structured fields. Tolerates both
 * orderings ("Salah Over 2.5 Shots On Target" and "Salah Shots On Target Over
 * 2.5") plus the line-less "Haaland Anytime Goalscorer" yes-market form.
 *
 * Returns null when the text is not a recognizable soccer prop (e.g. a 1X2 /
 * total / BTTS team pick).
 */
export function parseSoccerProp(text) {
  if (!text) return null;
  const s = String(text)
    .trim()
    .replace(/\s*\([+-]?\d+\)\s*$/i, '')                // strip trailing "(-110)"
    .replace(/\s+[+-]\d{2,3}\s*$/i, '')                  // strip trailing "-110"
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

  // Line-less anytime goal: "Erling Haaland Anytime Goalscorer" → over 0.5.
  if (kindHit.kind === 'anytime_goal') {
    const player = stripSegments(s, [kindHit.matched]);
    if (player) return { playerName: player, side: 'over', line: 0.5, propKind: 'anytime_goal' };
  }
  return null;
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

function num(v) {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Builds a per-stat-key → index map from a category's keys/names/labels arrays.
 * keys (machine names like "shotsOnGoal") are preferred; names/labels are a
 * fallback. All normalized to lowercase-alnum for matching against KIND_STAT_KEYS.
 */
function buildKeyIndex(cat) {
  const idx = new Map();
  for (const arr of [cat?.keys, cat?.names, cat?.labels]) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((k, i) => {
      const nk = normKey(k);
      if (nk && !idx.has(nk)) idx.set(nk, i);
    });
  }
  return idx;
}

/**
 * Flattens an ESPN soccer summary boxscore.players block into a per-player stat
 * map. Pure (no network) so it can be unit-tested with a captured fixture.
 *
 * @param {Array} teams - boxscore.players (array of team blocks)
 * @returns {Object} { [normName]: { name, team, playerId, goals, assists, ... , anytime_goal } }
 */
export function parseSoccerBoxscorePlayers(teams) {
  const players = {};
  if (!Array.isArray(teams)) return players;

  for (const team of teams) {
    const teamAbbr = team?.team?.abbreviation ?? null;
    for (const cat of team?.statistics ?? []) {
      const idx = buildKeyIndex(cat);
      for (const athlete of cat?.athletes ?? []) {
        const displayName = athlete?.athlete?.displayName;
        if (!displayName) continue;
        const stats = athlete?.stats ?? [];
        const key = normName(displayName);
        const p = (players[key] ??= {
          name: displayName, team: teamAbbr, playerId: athlete?.athlete?.id ?? null,
          goals: null, assists: null, shots: null, shots_on_target: null,
          passes: null, tackles: null, fouls: null, saves: null,
        });

        for (const [kind, candidates] of Object.entries(KIND_STAT_KEYS)) {
          if (p[kind] != null) continue; // already filled from another category
          for (const cand of candidates) {
            if (!idx.has(cand)) continue;
            const v = num(stats[idx.get(cand)]);
            if (v != null) { p[kind] = v; break; }
          }
        }
      }
    }
  }

  // anytime_goal = did the player score ≥ 1 (null when goals unknown).
  for (const p of Object.values(players)) {
    p.anytime_goal = p.goals == null ? null : (p.goals >= 1 ? 1 : 0);
  }
  return players;
}

/**
 * Fetches an ESPN soccer game summary and returns the flattened per-player map.
 * Throws on HTTP failure (the resolver loop catches and logs).
 */
export async function getSoccerGameBoxscore(leagueSlug, eventId) {
  const data = await getSoccerGameSummary(leagueSlug, eventId);
  return parseSoccerBoxscorePlayers(data?.boxscore?.players);
}

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Pure over/under resolution given the actual stat value. Unit-testable.
 */
export function resolveSoccerPropFromActual(parsed, actual) {
  if (!parsed || actual == null) return null;
  const { side, line } = parsed;
  if (side === 'over')  return actual > line ? 'win' : actual < line ? 'loss' : 'push';
  return actual < line ? 'win' : actual > line ? 'loss' : 'push';
}

/**
 * Resolves a soccer player prop pick string against a boxscore player map.
 * Returns { result, playerName, propType, line, actual } — result is null with
 * an `error` field when the player or stat cannot be located.
 */
export function resolveSoccerPlayerProp(pickStr, players) {
  const parsed = parseSoccerProp(pickStr);
  if (!parsed || !players) return null;

  const player = findPlayer(players, parsed.playerName);
  if (!player) {
    return { result: null, playerName: parsed.playerName, propType: parsed.propKind, line: parsed.line, actual: null, error: 'player_not_found' };
  }

  const actual = player[parsed.propKind];
  if (actual == null) {
    return { result: null, playerName: parsed.playerName, propType: parsed.propKind, line: parsed.line, actual: null, error: 'stat_not_found' };
  }

  const result = resolveSoccerPropFromActual(parsed, actual);
  return { result, playerName: parsed.playerName, propType: parsed.propKind, line: parsed.line, actual };
}
