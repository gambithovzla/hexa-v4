/**
 * server/tennis-tour-map.js — registry of the supported tennis tours.
 *
 * Tennis is the platform's first individual sport. Instead of a team map (there
 * are thousands of players and they rotate constantly), the tour is the second
 * dimension — mirroring the league dimension Soccer introduced. One wrapper
 * (`tennis-api.js`) takes a `tour` parameter ('atp' | 'wta') instead of two
 * separate wrappers. This file is the single source of truth that maps our
 * internal tour id → ESPN slug → Odds API sport key, plus the shared surface
 * and round vocabularies the context builder, resolver and prompt all rely on.
 *
 * Each tour entry:
 *   tour         — internal id ('atp' | 'wta'), also the ESPN slug
 *   oddsApiSlug  — The Odds API sport key
 *   gender, name
 *   season       — rough active window, human-readable
 *   bestOfMax    — max best-of for the tour (5 for ATP Grand Slams, 3 for WTA)
 */

const TENNIS_TOURS = {
  atp: {
    tour: 'atp',
    oddsApiSlug: 'tennis_atp',
    gender: 'men',
    name: 'ATP Tour',
    season: 'Jan–Nov (year-round)',
    bestOfMax: 5, // Grand Slams are best-of-5 for men
  },
  wta: {
    tour: 'wta',
    oddsApiSlug: 'tennis_wta',
    gender: 'women',
    name: 'WTA Tour',
    season: 'Jan–Nov (year-round)',
    bestOfMax: 3, // WTA matches are best-of-3, including Grand Slams
  },
};

/**
 * Court surfaces. The surface is tennis' "park factor": surface-specific ELO is
 * the single most predictive signal, ahead of the official ranking.
 */
export const TENNIS_SURFACES = ['hard', 'clay', 'grass', 'carpet'];

export function normalizeSurface(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('carpet')) return 'carpet';
  if (s.includes('hard')) return 'hard';
  return null;
}

/**
 * Surface keyed off the tournament name. ESPN's tennis scoreboard frequently
 * omits the surface field on Grand Slam / combined-tournament payloads — which is
 * why a Roland Garros match arrived at the Oracle as "surface unknown" even
 * though clay is obvious from the name. This is the fallback the API wrapper
 * applies when no explicit surface field is present.
 *
 * High-confidence only: the four Slams plus the well-known clay (Apr–Jun) and
 * grass (Jun–Jul) swing events. Anything we can't place with confidence returns
 * null (stays "unknown") rather than guessing — a wrong surface label is worse
 * than an honest absence. Stuttgart is intentionally omitted (ATP grass in June,
 * WTA clay in April — ambiguous by name alone).
 */
const CLAY_TOURNAMENT_KEYWORDS = [
  'roland garros', 'french open', 'madrid', 'rome', 'italian open', 'internazionali',
  'monte carlo', 'monte-carlo', 'barcelona', 'hamburg', 'estoril', 'munich', 'bmw open',
  'geneva', 'lyon', 'bucharest', 'gstaad', 'kitzbuhel', 'kitzbühel', 'umag', 'bastad',
  'båstad', 'cordoba', 'córdoba', 'buenos aires', 'rio open', 'santiago', 'marrakech',
  'strasbourg', 'rabat', 'palermo', 'parma', 'charleston', 'houston', 'iasi',
];
const GRASS_TOURNAMENT_KEYWORDS = [
  'wimbledon', 'halle', "queen's", 'queens club', 'cinch', 'eastbourne', 'mallorca',
  'hertogenbosch', 'libema', 'libéma', 'newport', 'nottingham', 'birmingham', 'berlin',
  'bad homburg',
];
const HARD_TOURNAMENT_KEYWORDS = [
  'us open', 'australian open', 'indian wells', 'miami open', 'cincinnati', 'canadian open',
  'national bank', 'shanghai', 'paris masters', 'rolex paris', 'atp finals', 'wta finals',
  'dubai', 'doha', 'qatar', 'acapulco', 'beijing', 'china open', 'tokyo', 'washington',
  'winston-salem', 'metz', 'vienna', 'basel', 'antwerp', 'stockholm', 'auckland', 'adelaide',
  'brisbane', 'united cup', 'hong kong', 'montpellier', 'rotterdam', 'marseille', 'delray beach',
  'dallas', 'los cabos', 'almaty', 'astana', 'chengdu', 'hangzhou', 'zhuhai', 'guadalajara',
  'monterrey', 'san diego', 'seoul', 'ningbo', 'jeddah', 'cleveland', 'cancun',
];

// Word-boundary match so "halle" doesn't fire on "cHALLEnger", "rome" on
// "Velodrome", etc. Keywords may contain spaces/hyphens/apostrophes — all
// non-word chars are escaped and the \b anchors sit on the alnum edges.
function hasKeyword(haystack, keywords) {
  return keywords.some((k) => {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(haystack);
  });
}

export function inferSurfaceFromTournament(tournamentName) {
  if (!tournamentName) return null;
  const n = String(tournamentName).toLowerCase();
  if (hasKeyword(n, GRASS_TOURNAMENT_KEYWORDS)) return 'grass';
  if (hasKeyword(n, CLAY_TOURNAMENT_KEYWORDS)) return 'clay';
  if (hasKeyword(n, HARD_TOURNAMENT_KEYWORDS)) return 'hard';
  return null;
}

/**
 * Tournament rounds mapped to a numeric depth (1 = earliest, 7 = final).
 * Used for fatigue features and Oracle context (later rounds = fresher draw,
 * tougher opponents). The string keys cover ESPN's common round labels.
 */
const ROUND_DEPTH = {
  'round of 128': 1, 'r128': 1, '1st round': 1, 'first round': 1,
  'round of 64': 2, 'r64': 2, '2nd round': 2, 'second round': 2,
  'round of 32': 3, 'r32': 3, '3rd round': 3, 'third round': 3,
  'round of 16': 4, 'r16': 4, '4th round': 4, 'fourth round': 4,
  'quarterfinals': 5, 'quarterfinal': 5, 'qf': 5,
  'semifinals': 6, 'semifinal': 6, 'sf': 6,
  'final': 7, 'f': 7,
};

export function roundDepth(roundLabel) {
  if (!roundLabel) return null;
  const key = String(roundLabel).toLowerCase().trim();
  if (ROUND_DEPTH[key] != null) return ROUND_DEPTH[key];
  // Partial match (e.g. "Men's Singles - Quarterfinals")
  for (const [label, depth] of Object.entries(ROUND_DEPTH)) {
    if (key.includes(label)) return depth;
  }
  return null;
}

export function getTennisTour(tour) {
  if (!tour) return null;
  return TENNIS_TOURS[String(tour).toLowerCase()] ?? null;
}

export function isSupportedTour(tour) {
  return Boolean(getTennisTour(tour));
}

export function getTennisTourByOddsSlug(oddsApiSlug) {
  if (!oddsApiSlug) return null;
  const q = String(oddsApiSlug).toLowerCase();
  return Object.values(TENNIS_TOURS).find((t) => t.oddsApiSlug === q) ?? null;
}

export const TENNIS_TOURS_LIST = Object.keys(TENNIS_TOURS);
export const TENNIS_TOUR_COUNT = TENNIS_TOURS_LIST.length;

export default TENNIS_TOURS;
