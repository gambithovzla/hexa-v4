/**
 * nflPropFeaturePersistence.js — promotes an NFL prop pick's feature row to a
 * trainable `source='live'` snapshot, enriched with market + player signal.
 *
 * NFL prop picks are born in Oracle Chat, which persists a minimal pick_features
 * row with source='oracle_chat' — excluded from the training loader (it filters
 * source='live'). For NFL props, chat IS the production origin (the user chose
 * it), so a genuinely-made prop pick should accumulate for training. This module
 * re-fetches the at-pick market odds (de-vigged fair prob) + the player's
 * season/recent averages and UPDATEs the row to source='live'.
 *
 * Fire-and-forget, gated by NFL_PROPS_ENABLED, never throws.
 */

import pool from '../db.js';
import { parseNflProp } from '../nfl-props-resolver.js';
import { getNflPlayerPropOdds } from '../nfl-props-odds.js';
import { enrichNflPropOffers } from './nflPropFeatureEnricher.js';
import { getNflPlayerStats, findNflPlayerPropStat } from '../nfl-player-fetcher.js';

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameName(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const la = na.split(' ').pop();
  const lb = nb.split(' ').pop();
  return la === lb && la.length > 2;
}

/**
 * @param {object} args
 * @param {number} args.pickId
 * @param {string} args.rawPickText   — the pick string (e.g. "Patrick Mahomes Over 274.5 Passing Yards")
 * @param {string|null} args.eventId  — The Odds API event id (for prop odds), if known
 * @param {number|null} args.season   — NFL season (for player averages)
 */
export async function enrichAndPersistNflPropPick({ pickId, rawPickText, eventId = null, season = null }) {
  if (process.env.NFL_PROPS_ENABLED !== 'true' || !pickId) return;
  const parsed = parseNflProp(rawPickText);
  if (!parsed) return;

  try {
    // ── Market signal: re-fetch the event's prop offers, de-vig the pair ──────
    let oddsAmerican = null;
    let impliedProb = null;
    let fairProb = null;
    if (eventId) {
      const offers = enrichNflPropOffers(await getNflPlayerPropOdds({ eventId }));
      const match = offers.find(o =>
        o.propKind === parsed.propKind && o.side === parsed.side && sameName(o.playerName, parsed.playerName));
      if (match) {
        oddsAmerican = match.oddsAmerican ?? null;
        impliedProb = match.impliedProb ?? null;
        fairProb = match.fairProb ?? null;
      }
    }

    // ── Player signal: season + recent averages from nflverse ─────────────────
    let seasonAvg = null;
    let recentAvg = null;
    let games = null;
    if (season != null) {
      const ps = findNflPlayerPropStat(await getNflPlayerStats(season), parsed.playerName, parsed.propKind);
      if (ps) {
        seasonAvg = ps.seasonAvg;
        recentAvg = ps.recentAvg;
        games = ps.games;
      }
    }

    await pool.query(
      `UPDATE pick_features SET
         source = 'live',
         market_type = 'prop',
         side = $2,
         line = $3,
         prop_kind = $4,
         prop_player_name = $5,
         prop_odds_american = $6,
         prop_implied_prob = $7,
         nfl_prop_fair_prob = $8,
         nfl_prop_player_season_avg = $9,
         nfl_prop_player_recent_avg = $10,
         nfl_prop_player_games = $11
       WHERE pick_id = $1`,
      [
        pickId, parsed.side, parsed.line, parsed.propKind, parsed.playerName,
        oddsAmerican, impliedProb, fairProb, seasonAvg, recentAvg, games,
      ]
    );
    console.log(
      `[nfl-prop-persist] pick #${pickId} → source=live ` +
      `(${parsed.propKind} ${parsed.side} ${parsed.line}; fair=${fairProb}, seasonAvg=${seasonAvg})`
    );
  } catch (err) {
    console.warn(`[nfl-prop-persist] pick #${pickId} failed: ${err.message}`);
  }
}
