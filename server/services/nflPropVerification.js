/**
 * nflPropVerification.js — proves an Oracle prop pick exists in the real market.
 *
 * The failure mode this exists to stop: an LLM asked for a player prop will
 * happily produce a plausible one that no book has posted — right player, wrong
 * line, or a stat type that isn't offered for this game. A team-market pick is
 * self-limiting (there is one spread), but the prop space is effectively infinite,
 * so the model must be held to the menu it was given. A pick that cannot be
 * matched back to an offered line is unbettable and unresolvable, so it is
 * rejected before it ever reaches the user.
 *
 * Pure and synchronous. Exported for tests.
 */

import { parseNflProp } from '../nfl-props-resolver.js';

const LINE_TOLERANCE = 1e-6;

function normName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'’\-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Do two player names refer to the same person? Books and ESPN disagree on
 * suffixes, initials and hyphens, so an exact string match is too strict — but
 * a last-name-only match is too loose (two Browns on one roster). Requires the
 * surname plus a compatible first name.
 */
export function playerNamesMatch(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const pa = na.split(' ');
  const pb = nb.split(' ');
  const lastA = pa[pa.length - 1];
  const lastB = pb[pb.length - 1];
  if (lastA !== lastB) return false;
  if (pa.length === 1 || pb.length === 1) return true;

  const firstA = pa[0];
  const firstB = pb[0];
  if (firstA === firstB) return true;
  // "P. Mahomes" vs "Patrick Mahomes"
  return firstA.length === 1 || firstB.length === 1
    ? firstA[0] === firstB[0]
    : false;
}

/**
 * Verify a prop pick against the offers that were actually shown to the model.
 *
 * @param {object} args
 * @param {string} args.pickText    master_prediction.pick
 * @param {string} [args.detail]    best_pick.detail (tried as a fallback)
 * @param {Array}  args.propOffers  offers presented in the PLAYER PROP MARKET block,
 *                                  each { propKind, playerName, side, line, ... }
 * @returns {{ ok: boolean, reason?: string, parsed?: object, matched?: object }}
 */
export function verifyNflPropPick({ pickText, detail = null, propOffers = null }) {
  if (!Array.isArray(propOffers) || propOffers.length === 0) {
    return { ok: false, reason: 'no_prop_market_offered' };
  }

  const parsed = parseNflProp(pickText) ?? (detail ? parseNflProp(detail) : null);
  if (!parsed) return { ok: false, reason: 'prop_unparseable' };

  const sameKind = propOffers.filter((o) => o.propKind === parsed.propKind);
  if (!sameKind.length) return { ok: false, reason: 'prop_kind_not_offered', parsed };

  const samePlayer = sameKind.filter((o) => playerNamesMatch(o.playerName, parsed.playerName));
  if (!samePlayer.length) return { ok: false, reason: 'prop_player_not_offered', parsed };

  const sameLine = samePlayer.filter(
    (o) => Number.isFinite(Number(o.line)) && Math.abs(Number(o.line) - parsed.line) < LINE_TOLERANCE
  );
  if (!sameLine.length) {
    const offered = [...new Set(samePlayer.map((o) => o.line))].join(', ');
    return { ok: false, reason: `prop_line_not_offered:${parsed.line} (offered: ${offered})`, parsed };
  }

  const matched = sameLine.find((o) => String(o.side).toLowerCase() === parsed.side);
  if (!matched) return { ok: false, reason: 'prop_side_not_offered', parsed };

  return { ok: true, parsed, matched };
}
