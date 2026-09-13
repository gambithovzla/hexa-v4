/**
 * nflPropCandidates.js — assembles the NFL player-prop menu for one game.
 *
 * The IO half of the prop engine: it gathers the posted offers, the player
 * histories, the opponent's defensive rates and the availability feed, hands each
 * offer to the pure projection engine, and returns a ranked shortlist.
 *
 * Everything here degrades instead of failing. No sidecar → no player history →
 * no projections, and the caller falls back to team markets. No odds event → no
 * props for that game. A single unprojectable offer never sinks the slate.
 */

import { getNflPlayerPropOdds } from '../nfl-props-odds.js';
import { enrichNflPropOffers } from './nflPropFeatureEnricher.js';
import { getNflPlayerStats, findNflPlayerPropStat } from '../nfl-player-fetcher.js';
import { getNflDefenseAllowed, findNflDefenseAllowed } from '../nfl-defense-fetcher.js';
import { getNflTeam } from '../nfl-team-map.js';
import { projectProp, rankPropProjections } from './nflPropProjection.js';

/** Human labels used in the Oracle context block and the admin board. */
export const NFL_PROP_LABELS = {
  pass_yds: 'Passing Yards',
  pass_tds: 'Passing TDs',
  pass_completions: 'Completions',
  pass_attempts: 'Pass Attempts',
  pass_interceptions: 'Interceptions',
  rush_yds: 'Rushing Yards',
  rush_attempts: 'Rush Attempts',
  reception_yds: 'Receiving Yards',
  receptions: 'Receptions',
  anytime_td: 'Anytime TD',
  first_td: 'First TD',
  last_td: 'Last TD',
  rush_rec_yds: 'Rush + Rec Yards',
  pass_rush_rec_yds: 'Pass + Rush + Rec Yards',
  pass_rush_rec_tds: 'Pass + Rush + Rec TDs',
  longest_completion: 'Longest Completion',
  longest_rush: 'Longest Rush',
  longest_reception: 'Longest Reception',
  kicking_points: 'Kicking Points',
  field_goals: 'Field Goals',
  sacks: 'Sacks',
  tackles_assists: 'Tackles + Assists',
  def_interceptions: 'Defensive INTs',
};

export function nflPropLabel(propKind) {
  return NFL_PROP_LABELS[propKind] ?? String(propKind ?? '').replace(/_/g, ' ');
}

function canonAbbr(abbr) {
  if (!abbr) return null;
  const team = getNflTeam({ teamAbbr: abbr });
  return team?.abbr ?? String(abbr).toUpperCase();
}

/**
 * Which side of this game the player is on, and therefore which spread governs
 * his game script and which defense he faces.
 */
function resolveSides({ playerTeam, homeAbbr, awayAbbr, marketOdds }) {
  const player = canonAbbr(playerTeam);
  const home = canonAbbr(homeAbbr);
  const away = canonAbbr(awayAbbr);
  const total = marketOdds?.total?.line ?? null;

  if (player && home && player === home) {
    return { side: 'home', teamSpread: marketOdds?.spread?.home ?? null, opponentAbbr: away, total };
  }
  if (player && away && player === away) {
    return { side: 'away', teamSpread: marketOdds?.spread?.away ?? null, opponentAbbr: home, total };
  }
  // Unknown roster: no spread adjustment (neutral script) rather than a guess
  // that could be exactly backwards.
  return { side: null, teamSpread: null, opponentAbbr: null, total };
}

/**
 * Build and rank the prop candidates for one game.
 *
 * @param {object} args
 * @param {object} args.game        slate game (home/away abbrs, season)
 * @param {object} [args.event]     matched odds event { eventId, sportKey }
 * @param {object} [args.marketOdds] resolved team market odds (spread + total)
 * @param {object} [args.availability] prebuilt availability index
 * @param {Array}  [args.offers]    pre-fetched offers (the board already has them)
 * @param {string} [args.markets]   'core' | 'extended' | 'all'
 * @param {number} [args.limit]     how many ranked candidates to return
 * @param {string[]} [args.propKinds] restrict the menu to these kinds (bet focus)
 * @returns {{ offers, enriched, projections, ranked, meta }}
 */
export async function buildNflPropCandidates({
  game,
  event = null,
  marketOdds = null,
  availability = null,
  offers = null,
  markets = 'core',
  limit = 12,
  rankOptions = {},
  findAvailability = null,
  propKinds = null,
} = {}) {
  const empty = {
    offers: [], enriched: [], projections: [], ranked: [],
    meta: { offerCount: 0, projectedCount: 0, rankedCount: 0, playerStats: false, defenseStats: false, reason: null },
  };
  if (!game) return { ...empty, meta: { ...empty.meta, reason: 'no_game' } };

  let rawOffers = offers;
  if (!rawOffers) {
    if (!event?.eventId) return { ...empty, meta: { ...empty.meta, reason: 'no_odds_event' } };
    rawOffers = await getNflPlayerPropOdds({
      eventId: event.eventId,
      sportKey: event.sportKey,
      markets,
    });
  }
  if (!rawOffers?.length) return { ...empty, meta: { ...empty.meta, reason: 'no_offers' } };

  const kindFilter = Array.isArray(propKinds) && propKinds.length ? new Set(propKinds) : null;
  const enriched = enrichNflPropOffers(rawOffers)
    .filter(o => !kindFilter || kindFilter.has(o.propKind));
  if (!enriched.length) {
    return { ...empty, offers: rawOffers, meta: { ...empty.meta, offerCount: 0, reason: 'no_offers_for_focus' } };
  }

  const [playerStats, defenseStats] = await Promise.all([
    getNflPlayerStats(game.season).catch(() => null),
    getNflDefenseAllowed(game.season).catch(() => null),
  ]);

  if (!playerStats) {
    return {
      offers: rawOffers,
      enriched,
      projections: [],
      ranked: [],
      meta: {
        offerCount: enriched.length, projectedCount: 0, rankedCount: 0,
        playerStats: false, defenseStats: Boolean(defenseStats), reason: 'no_player_history',
      },
    };
  }

  const projections = [];
  for (const offer of enriched) {
    const stat = findNflPlayerPropStat(playerStats, offer.playerName, offer.propKind);
    if (!stat) continue;

    const { side, teamSpread, opponentAbbr, total } = resolveSides({
      playerTeam: stat.team,
      homeAbbr: game.home_team_abbr,
      awayAbbr: game.away_team_abbr,
      marketOdds,
    });

    const defense = opponentAbbr
      ? findNflDefenseAllowed(defenseStats, opponentAbbr, offer.propKind)
      : null;

    const avail = findAvailability && availability
      ? findAvailability(availability, offer.playerName)
      : null;

    const projection = projectProp({
      propKind: offer.propKind,
      side: offer.side,
      line: offer.line,
      player: {
        seasonAvg: stat.seasonAvg,
        recentAvg: stat.recentAvg,
        games: stat.games,
        playerStd: stat.playerStd,
        position: stat.position,
      },
      environment: { teamSpread, total },
      defense: defense ?? {},
      availability: avail,
      market: {
        fairProb: offer.fairProb,
        impliedProb: offer.impliedProb,
        oddsAmerican: offer.oddsAmerican,
        pairedBookmakerCount: offer.pairedBookmakerCount,
      },
    });

    if (!projection.ok) continue;

    projections.push({
      ...projection,
      playerName: offer.playerName,
      playerTeam: canonAbbr(stat.team),
      teamSide: side,
      opponentAbbr,
      oddsAmerican: offer.oddsAmerican,
      label: nflPropLabel(offer.propKind),
      availability: avail ?? null,
      defenseStat: defense?.stat ?? null,
    });
  }

  const ranked = rankPropProjections(projections, { limit, ...rankOptions });

  return {
    offers: rawOffers,
    enriched,
    projections,
    ranked,
    meta: {
      offerCount: enriched.length,
      projectedCount: projections.length,
      rankedCount: ranked.length,
      playerStats: true,
      defenseStats: Boolean(defenseStats),
      defenseFallbackSeason: defenseStats?.isFallback ? defenseStats.season : null,
      reason: null,
    },
  };
}

/**
 * The offers list the output guard checks a prop pick against: exactly the rows
 * the model was shown, nothing more. Keeping this derived from `ranked` is what
 * makes "the model may only pick from its menu" enforceable.
 */
export function propOffersFromRanked(ranked) {
  return (ranked ?? []).map((p) => ({
    propKind: p.propKind,
    playerName: p.playerName,
    side: p.side,
    line: p.line,
    oddsAmerican: p.oddsAmerican ?? null,
    modelProb: p.modelProb,
    marketProb: p.marketProb,
    edge: p.edge,
    confidence: p.confidence,
  }));
}
