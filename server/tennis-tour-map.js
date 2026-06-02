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
