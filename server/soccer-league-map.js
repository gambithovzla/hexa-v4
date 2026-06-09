/**
 * server/soccer-league-map.js — registry of the supported soccer leagues.
 *
 * Soccer is league-aware from the base: one wrapper (`soccer-api.js`) takes a
 * `leagueSlug` parameter instead of six separate wrappers. This file is the
 * single source of truth that maps our internal slug → ESPN slug → Odds API
 * slug, plus the per-league style profile the Oracle prompt uses to bias its
 * analysis (Bundesliga skews Over, Serie A skews Under/Draw, etc.).
 *
 * Each entry:
 *   slug         — internal id, also the ESPN slug (they match for these six)
 *   oddsApiSlug  — The Odds API sport key
 *   country, name
 *   season       — rough active window, human-readable
 *   avgGoals     — historical goals/match (Oracle Over/Under prior)
 *   drawPct      — historical draw frequency (Oracle 3-way prior)
 *   style        — short profile string injected into the context block
 *   international — true for national-team tournaments (drives TOURNAMENT MODE in the Oracle prompt)
 *   neutralVenues — true when most/all venues are neutral (discounts home advantage)
 */

const SOCCER_LEAGUES = {
  'eng.1': {
    slug: 'eng.1',
    oddsApiSlug: 'soccer_epl',
    country: 'England',
    name: 'Premier League',
    season: 'Aug–May',
    avgGoals: 2.8,
    drawPct: 0.25,
    style: 'Physical, balanced. Most even of the big leagues — fewer lopsided favorites.',
  },
  'esp.1': {
    slug: 'esp.1',
    oddsApiSlug: 'soccer_spain_la_liga',
    country: 'Spain',
    name: 'La Liga',
    season: 'Aug–May',
    avgGoals: 2.6,
    drawPct: 0.26,
    style: 'Technical, possession-based. Moderate scoring, frequent tight games.',
  },
  'ita.1': {
    slug: 'ita.1',
    oddsApiSlug: 'soccer_italy_serie_a',
    country: 'Italy',
    name: 'Serie A',
    season: 'Aug–May',
    avgGoals: 2.4,
    drawPct: 0.29,
    style: 'Defensive, structured. Lowest scoring — Under and Draw are live more often.',
  },
  'ger.1': {
    slug: 'ger.1',
    oddsApiSlug: 'soccer_germany_bundesliga',
    country: 'Germany',
    name: 'Bundesliga',
    season: 'Aug–May',
    avgGoals: 3.1,
    drawPct: 0.23,
    style: 'High pressing, high scoring. Highest goals/match — Over is more viable.',
  },
  'fra.1': {
    slug: 'fra.1',
    oddsApiSlug: 'soccer_france_ligue_1',
    country: 'France',
    name: 'Ligue 1',
    season: 'Aug–May',
    avgGoals: 2.5,
    drawPct: 0.27,
    style: 'Variable, top-heavy. Wide quality gap top-to-bottom.',
  },
  'usa.1': {
    slug: 'usa.1',
    oddsApiSlug: 'soccer_usa_mls',
    country: 'USA/Canada',
    name: 'MLS',
    season: 'Feb–Dec',
    avgGoals: 2.9,
    drawPct: 0.22,
    style: 'Athletic, less tactical. Fewer draws, more end-to-end. Strong home advantage.',
  },
  'fifa.world': {
    slug: 'fifa.world',
    oddsApiSlug: 'soccer_fifa_world_cup',
    country: 'International',
    name: 'FIFA World Cup',
    season: 'Jun–Jul 2026',
    avgGoals: 2.6,
    drawPct: 0.24,
    style: 'National-team tournament. Group stage skews cautious (draws common, teams play not to lose); knockouts tighten and go to extra time. Squad cohesion, tournament experience and rest between rounds matter more than club form. Neutral venues except host nations (USA/Canada/Mexico).',
    international: true,
    neutralVenues: true,
  },
};

export function getSoccerLeague(slug) {
  if (!slug) return null;
  return SOCCER_LEAGUES[String(slug).toLowerCase()] ?? null;
}

export function isSupportedLeague(slug) {
  return Boolean(getSoccerLeague(slug));
}

/** True for national-team tournaments (FIFA World Cup) — drives TOURNAMENT MODE in the Oracle prompt. */
export function isInternationalLeague(slug) {
  return Boolean(getSoccerLeague(slug)?.international);
}

export function getSoccerLeagueByOddsSlug(oddsApiSlug) {
  if (!oddsApiSlug) return null;
  const q = String(oddsApiSlug).toLowerCase();
  return Object.values(SOCCER_LEAGUES).find((l) => l.oddsApiSlug === q) ?? null;
}

export const SOCCER_LEAGUE_SLUGS = Object.keys(SOCCER_LEAGUES);
export const SOCCER_LEAGUE_COUNT = SOCCER_LEAGUE_SLUGS.length;

export default SOCCER_LEAGUES;
