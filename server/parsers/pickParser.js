/**
 * pickParser.js
 * Parses free-text pick strings produced by the Oracle into structured fields
 * needed for ML training.
 *
 * Exported:
 *   parsePick(text) → { market_type, side, line, prop_kind, prop_player_name }
 *
 * market_type values: 'moneyline' | 'runline' | 'overunder' | 'prop'
 * side values:        'home' | 'away' | 'over' | 'under' | null
 * line:               numeric (e.g. -1.5, 8.5, 0.5) or null
 * prop_kind:          'hits' | 'total_bases' | 'home_runs' | 'strikeouts' |
 *                     'rbis' | 'stolen_bases' | 'walks' | 'outs_recorded' |
 *                     'singles' | 'doubles' | null
 * prop_player_name:   raw player name string from the pick text (null for non-prop)
 */

// ── Team abbreviation sets (both official and common variants) ─────────────
const ALL_TEAM_ABBRS = new Set([
  'NYY', 'BOS', 'TOR', 'BAL', 'TB', 'CLE', 'DET', 'CWS', 'KC', 'MIN',
  'HOU', 'SEA', 'TEX', 'LAA', 'OAK', 'ATL', 'NYM', 'PHI', 'MIA', 'WSH',
  'MIL', 'CHC', 'STL', 'CIN', 'PIT', 'LAD', 'SF', 'SD', 'COL', 'AZ',
  // common aliases
  'ARI', 'ATH', 'CHW', 'KCR', 'SFG', 'SDP', 'TBR', 'WSN', 'NYM', 'SFG',
]);

// ── Run-line patterns ──────────────────────────────────────────────────────
// matches: "NYY -1.5", "BOS +1.5", "NYY RL -1.5"
// Note: \b before [+-] fails because +/- are non-word chars; use lookahead instead
const RL_SIGNED = /(?:rl\s+)?([+-]\d+\.5)(?!\d)/i;

// ── Over/Under patterns ───────────────────────────────────────────────────
const OU_PATTERN = /\b(over|under|o|u)\s+([\d]+(?:\.5)?)\b/i;

// ── Moneyline — plain team abbreviation or "Team ML" ─────────────────────
const ML_EXPLICIT = /\bml\b/i;

// ── Props ─────────────────────────────────────────────────────────────────
// "Aaron Judge Over 0.5 HR", "Shohei Ohtani Under 8.5 Strikeouts"
// "Juan Soto Over 1.5 Hits", "Yordan Alvarez Over 1.5 TB"
const PROP_PATTERN =
  /^(.+?)\s+(over|under)\s+([\d]+(?:\.5)?)\s+(.+)$/i;

const PROP_KIND_MAP = {
  'hit': 'hits', 'hits': 'hits',
  'tb': 'total_bases', 'total base': 'total_bases', 'total bases': 'total_bases',
  'hr': 'home_runs', 'home run': 'home_runs', 'home runs': 'home_runs',
  'k': 'strikeouts', 'strikeout': 'strikeouts', 'strikeouts': 'strikeouts',
  'so': 'strikeouts',
  'rbi': 'rbis', 'rbis': 'rbis',
  'sb': 'stolen_bases', 'stolen base': 'stolen_bases', 'stolen bases': 'stolen_bases',
  'walk': 'walks', 'walks': 'walks', 'bb': 'walks',
  'out': 'outs_recorded', 'outs recorded': 'outs_recorded', 'outs': 'outs_recorded',
  'single': 'singles', 'singles': 'singles',
  'double': 'doubles', 'doubles': 'doubles',
};

function normalizeText(t) {
  return String(t ?? '').trim().toLowerCase();
}

function parseNumber(s) {
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function resolvePropKind(raw) {
  const key = normalizeText(raw).replace(/\s+/g, ' ').trim();
  // exact match first
  if (PROP_KIND_MAP[key]) return PROP_KIND_MAP[key];
  // substring match
  for (const [pattern, kind] of Object.entries(PROP_KIND_MAP)) {
    if (key.includes(pattern)) return kind;
  }
  return null;
}

/**
 * Returns true if the normalized text starts with a known team abbreviation.
 */
function startsWithTeamAbbr(text) {
  const first = text.trim().toUpperCase().split(/\s+/)[0];
  return ALL_TEAM_ABBRS.has(first);
}

/**
 * Determines the side (home/away) for a moneyline or run-line pick.
 * Requires the pick text AND the known home/away team abbreviations.
 * Falls back to null when context is not available.
 */
function resolveMLSide(pickText, homeAbbr, awayAbbr) {
  if (!homeAbbr || !awayAbbr) return null;
  const upper = pickText.toUpperCase();
  const homeUp = homeAbbr.toUpperCase();
  const awayUp = awayAbbr.toUpperCase();
  if (upper.includes(homeUp)) return 'home';
  if (upper.includes(awayUp)) return 'away';
  return null;
}

/**
 * Parses a pick string into structured fields for ML training.
 *
 * @param {string} text             - raw pick text from the Oracle
 * @param {object} [ctx]            - optional game context for side resolution
 * @param {string} [ctx.homeAbbr]   - home team abbreviation (e.g. "NYY")
 * @param {string} [ctx.awayAbbr]   - away team abbreviation
 * @returns {{
 *   market_type: string|null,
 *   side: string|null,
 *   line: number|null,
 *   prop_kind: string|null,
 *   prop_player_name: string|null
 * }}
 */
export function parsePick(text, ctx = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) return { market_type: null, side: null, line: null, prop_kind: null, prop_player_name: null };

  const norm = normalizeText(clean);

  // ── 1. Over/Under ─────────────────────────────────────────────────────────
  const ouMatch = clean.match(OU_PATTERN);
  if (ouMatch) {
    const sideRaw = ouMatch[1].toLowerCase();
    const lineRaw = ouMatch[2];
    // Distinguish team total prop O/U from game total by presence of player/team name before it
    const isProp = PROP_PATTERN.test(clean);
    if (isProp) {
      const propMatch = clean.match(PROP_PATTERN);
      const playerName = propMatch[1].trim();
      const propLineRaw = propMatch[3];
      const propKindRaw = propMatch[4];
      // Heuristic: if playerName starts with a team abbr and propKind is a game-total keyword, treat as OU
      if (startsWithTeamAbbr(playerName) && resolvePropKind(propKindRaw) === null) {
        return {
          market_type: 'overunder',
          side: sideRaw.startsWith('o') ? 'over' : 'under',
          line: parseNumber(propLineRaw),
          prop_kind: null,
          prop_player_name: null,
        };
      }
      return {
        market_type: 'prop',
        side: sideRaw.startsWith('o') ? 'over' : 'under',
        line: parseNumber(propLineRaw),
        prop_kind: resolvePropKind(propKindRaw),
        prop_player_name: playerName,
      };
    }
    return {
      market_type: 'overunder',
      side: sideRaw.startsWith('o') ? 'over' : 'under',
      line: parseNumber(lineRaw),
      prop_kind: null,
      prop_player_name: null,
    };
  }

  // ── 2. Run-line ───────────────────────────────────────────────────────────
  const rlMatch = clean.match(RL_SIGNED);
  if (rlMatch) {
    const line = parseNumber(rlMatch[1]);
    const side = resolveMLSide(clean, ctx.homeAbbr, ctx.awayAbbr);
    return { market_type: 'runline', side, line, prop_kind: null, prop_player_name: null };
  }

  // ── 3. Explicit ML keyword ────────────────────────────────────────────────
  if (ML_EXPLICIT.test(clean)) {
    const side = resolveMLSide(clean, ctx.homeAbbr, ctx.awayAbbr);
    return { market_type: 'moneyline', side, line: null, prop_kind: null, prop_player_name: null };
  }

  // ── 4. Bare team abbreviation → moneyline ─────────────────────────────────
  if (startsWithTeamAbbr(clean)) {
    const side = resolveMLSide(clean, ctx.homeAbbr, ctx.awayAbbr);
    return { market_type: 'moneyline', side, line: null, prop_kind: null, prop_player_name: null };
  }

  // ── 5. Unknown ────────────────────────────────────────────────────────────
  return { market_type: null, side: null, line: null, prop_kind: null, prop_player_name: null };
}
