/**
 * nflSeasonPhase.js — preseason awareness for the NFL pipeline.
 *
 * The models and the whole Sprint 9.4 precision layer are regular-season
 * artifacts: nflverse_loader filters its training frame to season_type == "REG",
 * so nfl_moneyline / nfl_spread / nfl_total have never seen a preseason snap.
 * Every signal the Oracle leans on assumes starters play — EPA, red-zone and
 * third-down rates, sack rates, and above all the QB-confirmed availability
 * gate. In preseason the listed starter plays a series or two and third-string
 * players decide the result.
 *
 * That combination is the dangerous one: eight signals agreeing on statistics
 * drawn from a different population raises confidence rather than lowering it.
 * So preseason is treated as a distinct phase — confidence is capped hard, the
 * output is flagged, and the Imperdible lock is switched off entirely.
 *
 * ESPN seasontype: 1 = preseason, 2 = regular, 3 = postseason.
 */

export const NFL_SEASON_TYPE = { PRESEASON: 1, REGULAR: 2, POSTSEASON: 3 };

/** Confidence ceiling for preseason picks, vs the 72 regular-season cap. */
export const PRESEASON_CONFIDENCE_CEIL = 55;

export const PRESEASON_ALERT_FLAG =
  'PRESEASON: starters play limited snaps — team-level metrics (EPA, red zone, ' +
  'third down, sack rate) are regular-season averages and do not describe this game. ' +
  'Confidence capped; treat as informational, not a betting edge.';

export function isPreseason(seasonType) {
  return Number(seasonType) === NFL_SEASON_TYPE.PRESEASON;
}

export function seasonPhaseLabel(seasonType) {
  switch (Number(seasonType)) {
    case NFL_SEASON_TYPE.PRESEASON: return 'preseason';
    case NFL_SEASON_TYPE.REGULAR: return 'regular';
    case NFL_SEASON_TYPE.POSTSEASON: return 'postseason';
    default: return 'unknown';
  }
}

/** Shape attached to the context so every downstream consumer reads one source. */
export function buildSeasonPhase(seasonType) {
  const st = Number(seasonType);
  const known = Number.isFinite(st) && st >= 1 && st <= 3;
  return {
    seasonType: known ? st : null,
    label: seasonPhaseLabel(st),
    isPreseason: isPreseason(st),
  };
}
