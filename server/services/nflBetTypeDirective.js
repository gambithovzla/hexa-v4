/**
 * nflBetTypeDirective.js — turns the UI's "Bet Focus" selection into an Oracle
 * instruction plus the prop kinds the menu should be narrowed to.
 *
 * MLB has had a bet-focus selector since the start; NFL shipped without one
 * because only team markets existed. Now that props are live the same control
 * applies, with NFL-shaped choices (spread, not run line; touchdown scorer,
 * not pitcher strikeouts).
 *
 * An explicitly requested market changes the gate downstream: asking for "player
 * props" means "show me your best prop", not "show me a prop only if it clears
 * the edge bar". The engine still refuses to invent one when the books have
 * posted nothing.
 *
 * Pure; exported for tests.
 */

/** Prop kinds each focus narrows to. `null` = every kind. */
const PROP_FOCUS_KINDS = {
  props: null,
  td_scorer: ['anytime_td', 'first_td', 'last_td'],
  qb_props: ['pass_yds', 'pass_tds', 'pass_completions', 'pass_attempts', 'pass_interceptions'],
  rush_props: ['rush_yds', 'rush_attempts', 'longest_rush'],
  rec_props: ['reception_yds', 'receptions', 'longest_reception'],
};

const TEAM_DIRECTIVES = {
  spread: 'MANDATORY BET TYPE: Spread. Your best_pick.type MUST be Spread. Respect key numbers 3 and 7.',
  total: 'MANDATORY BET TYPE: Total (Over/Under). Your best_pick.type MUST be Total.',
  moneyline: 'MANDATORY BET TYPE: Moneyline. Your best_pick.type MUST be Moneyline.',
};

const PROP_DIRECTIVES = {
  props: 'MANDATORY BET TYPE: Player Prop. Your best_pick.type MUST be PlayerProp, selected from a PLAYER PROP MARKET row.',
  td_scorer: 'MANDATORY BET TYPE: Player Prop — touchdown scorer only. Select an Anytime/First/Last TD row from PLAYER PROP MARKET.',
  qb_props: 'MANDATORY BET TYPE: Player Prop — quarterback only (passing yards, TDs, completions, attempts, interceptions). Select from PLAYER PROP MARKET.',
  rush_props: 'MANDATORY BET TYPE: Player Prop — rushing only (rushing yards, carries). Select from PLAYER PROP MARKET.',
  rec_props: 'MANDATORY BET TYPE: Player Prop — receiving only (receiving yards, receptions). Select from PLAYER PROP MARKET.',
};

export const NFL_BET_TYPES = ['all', 'spread', 'total', 'moneyline', ...Object.keys(PROP_DIRECTIVES)];

export function isNflPropFocus(betType) {
  return Object.prototype.hasOwnProperty.call(PROP_DIRECTIVES, String(betType ?? ''));
}

/**
 * @param {string} betType        one of NFL_BET_TYPES ('all' when unset)
 * @param {boolean} propsAvailable whether a PLAYER PROP MARKET block exists
 * @returns {{ betType, directive, propKinds, propsRequested, unavailable }}
 */
export function resolveNflBetTypeDirective(betType, { propsAvailable = false } = {}) {
  const focus = NFL_BET_TYPES.includes(String(betType ?? '')) ? String(betType) : 'all';

  if (focus === 'all') {
    return {
      betType: focus,
      directive: propsAvailable
        ? 'Bet focus: evaluate spread, total, moneyline and the posted player props — select the highest-value bet type based on the data. Respect key numbers 3 and 7.'
        : 'Bet focus: spread first, then total, then moneyline — select the highest-value bet type based on the data. Respect key numbers 3 and 7. No player props.',
      propKinds: null,
      propsRequested: false,
      unavailable: false,
    };
  }

  if (isNflPropFocus(focus)) {
    if (!propsAvailable) {
      // Honest degradation: the user asked for a market the books have not
      // posted for this game (or the data to project it is missing). Say so
      // rather than quietly returning a spread as if it had been requested.
      return {
        betType: focus,
        directive:
          'REQUESTED BET TYPE UNAVAILABLE: the requested player-prop market has no posted lines for this game. ' +
          'Select the best available team market (Spread / Total / Moneyline) and state in the first line of ' +
          'oracle_report that player props were unavailable for this game.',
        propKinds: PROP_FOCUS_KINDS[focus] ?? null,
        propsRequested: true,
        unavailable: true,
      };
    }
    return {
      betType: focus,
      directive: PROP_DIRECTIVES[focus],
      propKinds: PROP_FOCUS_KINDS[focus] ?? null,
      propsRequested: true,
      unavailable: false,
    };
  }

  return {
    betType: focus,
    directive: TEAM_DIRECTIVES[focus],
    propKinds: null,
    propsRequested: false,
    unavailable: false,
  };
}
