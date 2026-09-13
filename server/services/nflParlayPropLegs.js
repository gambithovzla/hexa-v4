/**
 * nflParlayPropLegs.js — turns projected player props into parlay legs.
 *
 * The NFL parlay shipped with team markets only (spread / total / moneyline),
 * because when it was built there was no model for a player prop. There is now
 * (nflPropProjection), and props are the half of the board where the books are
 * softest — lower limits, algorithmic lines, far less sharp money policing them
 * than sides and totals. Leaving them out of the parlay left the best-priced
 * legs on the table.
 *
 * Deliberately a new file rather than an edit to parlayEngine/nflParlayCandidates.js:
 * the parlay engine directory is frozen, so this composes with it from outside and
 * emits the exact candidate shape the engine already consumes.
 *
 * Pure; exported for tests.
 */

const PROP_LEG_DEFAULT_DATA_QUALITY = 70;

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function americanToDecimal(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function slug(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function round1(v) {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
}

function sideLabel(side) {
  return String(side).toLowerCase() === 'under' ? 'Under' : 'Over';
}

/**
 * Build parlay-engine candidates from one game's ranked prop projections.
 *
 * @param {object} entry  the game entry the parlay route already assembles
 *   ({ gameId, matchup, gameDate, dataQuality })
 * @param {Array}  ranked ranked projections from buildNflPropCandidates
 * @param {object} [opts]
 * @param {number} [opts.maxPerGame]  cap legs from a single game — a parlay of
 *   six props off one quarterback is one bet wearing a costume
 * @param {number} [opts.minModelProb] floor on the leg's own probability: a
 *   parlay multiplies, so a 45% leg poisons every combination it enters
 */
export function buildNflPropLegCandidates(entry, ranked, { maxPerGame = 4, minModelProb = 0.5 } = {}) {
  const { gameId, matchup, gameDate, dataQuality = PROP_LEG_DEFAULT_DATA_QUALITY } = entry ?? {};
  if (!gameId || !Array.isArray(ranked) || !ranked.length) return [];

  const out = [];
  for (const p of ranked) {
    if (!p?.ok) continue;
    if (!(p.modelProb >= minModelProb)) continue;
    if (p.oddsAmerican == null) continue; // an unpriced leg cannot be staked

    const implied = americanToImplied(p.oddsAmerican);
    const modelPct = round1(p.modelProb * 100);
    const impliedPct = implied != null ? round1(implied * 100) : null;
    const label = `${p.playerName} ${sideLabel(p.side)} ${p.line} ${p.label ?? p.propKind}`;

    out.push({
      candidateId: `nfl_${gameId}::prop::${p.propKind}::${p.side}::${p.line}::${slug(p.playerName)}`,
      gamePk: gameId,
      matchup,
      gameDate,
      pick: label,
      type: 'single',
      marketType: 'prop',
      side: p.side,
      propKind: p.propKind,
      line: p.line ?? null,
      modelProbability: modelPct,
      impliedProbability: impliedPct,
      edge: impliedPct != null ? round1(modelPct - impliedPct) : null,
      odds: p.oddsAmerican,
      decimalOdds: americanToDecimal(p.oddsAmerican),
      xgbScore: null,
      xgbConfidence: null,
      xgbAgreement: false,
      riskVector: null,
      gameScript: p.factors?.script ?? null,
      failureMode: null,
      // The projection's own confidence is what this leg rests on, so it drives
      // the data-quality the engine sees rather than the game-level number.
      dataQualityScore: Math.round((p.confidence ?? 0.6) * 100),
      modelRisk: (p.confidence ?? 0) >= 0.7 ? 'medium' : 'high',
      reasoning: p.rationale ?? '',
    });

    if (out.length >= maxPerGame) break;
  }
  return out;
}
