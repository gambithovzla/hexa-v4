/**
 * projectedTotal.js
 *
 * Display-only estimate of an MLB game's total runs from the same Statcast /
 * team features the Oracle already receives. Used as a FALLBACK reference line
 * for Over/Under picks when the sportsbook total is unavailable (odds not
 * loaded), so the pick shows "Under 8.7 (proy.)" instead of a bare
 * "Under (Total de Carreras)".
 *
 * This is intentionally NOT the resolution line: a projected total must never
 * be written into the persisted pick text, because the pick was not actually
 * placed at this number. It exists purely so the user has a reference figure.
 *
 * The arithmetic mirrors the (frozen, non-exported) buildExpectedTotal in
 * market-intelligence.js. It lives in its own file to avoid touching the frozen
 * module; if that formula changes, this estimate may drift slightly, which is
 * acceptable for a display-only reference.
 */

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function averageLineupXwoba(batters = []) {
  const withData = (batters ?? []).filter((b) => b?.savant?.xwOBA != null);
  if (!withData.length) return null;
  const total = withData.reduce((sum, b) => sum + Number(b.savant.xwOBA ?? 0), 0);
  return total / withData.length;
}

/**
 * Returns a projected game total (rounded to 1 decimal) or null when there is
 * not enough feature signal to make the estimate meaningful (so we avoid
 * displaying a bare 8.5 league-average default with no basis).
 *
 * @param {object} features — context-builder _features payload
 * @returns {number|null}
 */
export function estimateProjectedTotal(features = {}) {
  const homePitcherXwoba = toNumber(features?.homePitcherSavant?.xwOBA_against);
  const awayPitcherXwoba = toNumber(features?.awayPitcherSavant?.xwOBA_against);
  const homePitcherEra = toNumber(features?.homePitcherStats?.stats?.era);
  const awayPitcherEra = toNumber(features?.awayPitcherStats?.stats?.era);
  const homeTeamOps = toNumber(features?.homeHitting?.ops);
  const awayTeamOps = toNumber(features?.awayHitting?.ops);
  const homeLineupXwoba = averageLineupXwoba(features?.savantBatters?.home);
  const awayLineupXwoba = averageLineupXwoba(features?.savantBatters?.away);
  const parkOverall = toNumber(features?.parkFactorData?.park_factor_overall);
  const temperature = toNumber(features?.weatherData?.temperature);
  const windSpeed = toNumber(features?.weatherData?.windSpeed ?? features?.weatherData?.wind_speed);
  const coherence = String(features?.signalCoherence?.dominantDirection ?? '').toLowerCase();

  // Require at least one substantive offense/pitching signal — otherwise the
  // estimate is just the league baseline and would be misleadingly precise.
  const hasSignal = [
    homePitcherXwoba, awayPitcherXwoba, homePitcherEra, awayPitcherEra,
    homeTeamOps, awayTeamOps, homeLineupXwoba, awayLineupXwoba,
  ].some((v) => v != null);
  if (!hasSignal) return null;

  let projection = 8.5;
  projection += (((homePitcherXwoba ?? 0.315) - 0.315) + ((awayPitcherXwoba ?? 0.315) - 0.315)) * 10;
  projection += (((homeLineupXwoba ?? 0.315) - 0.315) + ((awayLineupXwoba ?? 0.315) - 0.315)) * 14;
  projection += (((homeTeamOps ?? 0.710) - 0.710) + ((awayTeamOps ?? 0.710) - 0.710)) * 3;
  projection += (((homePitcherEra ?? 4.1) - 4.1) + ((awayPitcherEra ?? 4.1) - 4.1)) * 0.12;
  projection += ((parkOverall ?? 100) - 100) * 0.03;
  if (temperature != null) projection += (temperature - 72) * 0.02;
  if (windSpeed != null) projection += (windSpeed - 8) * 0.015;
  if (coherence.includes('over')) projection += 0.25;
  if (coherence.includes('under')) projection -= 0.25;

  // Clamp to a sane MLB range so an outlier feature can't produce nonsense.
  projection = Math.max(5, Math.min(15, projection));
  return Math.round(projection * 10) / 10;
}
