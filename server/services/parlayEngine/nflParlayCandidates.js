/**
 * nflParlayCandidates.js — builds NFL parlay candidates in the shape the frozen
 * Parlay Synergy engine (composer/correl/hitMath) consumes.
 *
 * The MLB candidate generation (pool.js + buildDeterministicSafePayload) is
 * deeply baseball-specific and FROZEN, so NFL gets its own pure builder here.
 * It does NOT touch any frozen file — it only produces the candidate objects;
 * the route then feeds them to the frozen, sport-agnostic composeParlays /
 * buildCorrelationMatrix / computeHitDistribution.
 *
 * Markets: spread (NFL primary), total (overunder), moneyline. No props (the
 * parlay engine treats props separately; NFL props ship via their own board).
 *
 * Pure + dependency-free → unit-testable with synthetic odds/model inputs.
 */

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
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

/**
 * Build candidates for a single NFL game.
 *
 * @param {object} entry
 * @param {string} entry.gameId
 * @param {string} entry.matchup        "AWAY @ HOME"
 * @param {string} entry.gameDate
 * @param {string} entry.homeAbbr
 * @param {string} entry.awayAbbr
 * @param {object} entry.odds           buildMarketOddsForGame() output { spread, total, moneyline }
 * @param {object|null} entry.model     { moneyline: P(home wins), spread: P(home covers), total: P(over) } in [0,1]
 * @param {number} [entry.dataQuality]  0–100 (context completeness); default 70
 * @returns {object[]} engine-shaped candidates
 */
export function buildNflGameCandidates(entry) {
  const { gameId, matchup, gameDate, homeAbbr, awayAbbr, odds = {}, model = null, dataQuality = 70 } = entry;
  if (!gameId || !odds) return [];
  const out = [];

  const push = (marketType, side, americanOdds, modelProbFrac, line, label) => {
    const implied = americanToImplied(americanOdds);
    if (implied == null || (marketType !== 'moneyline' && !Number.isFinite(Number(line)))) return;
    const modelProb = modelProbFrac != null ? modelProbFrac : implied; // fall back to market
    if (modelProb == null) return;
    const modelPct = Math.round(modelProb * 1000) / 10; // 0–100, 1 decimal
    const impliedPct = implied != null ? Math.round(implied * 1000) / 10 : null;
    const edge = impliedPct != null ? round2(modelPct - impliedPct) : null;
    out.push({
      candidateId: `nfl_${gameId}::${marketType}::${side}::${line ?? 'na'}::${slug(label)}`,
      gamePk: gameId,
      matchup,
      gameDate,
      pick: label,
      type: 'single',
      marketType,
      side,
      propKind: null,
      line: line ?? null,
      modelProbability: modelPct,
      impliedProbability: impliedPct,
      edge,
      odds: americanOdds ?? null,
      decimalOdds: americanToDecimal(americanOdds),
      bookmaker: 'consensus',
      xgbScore: null,
      xgbConfidence: null,
      xgbAgreement: false,
      riskVector: null,
      gameScript: null,
      failureMode: null,
      dataQualityScore: dataQuality,
      modelRisk: dataQuality >= 65 ? 'medium' : 'high',
      reasoning: '',
    });
  };

  // ── Moneyline ───────────────────────────────────────────────────────────────
  const ml = odds.moneyline ?? {};
  push('moneyline', 'home', ml.home, model?.moneyline, null, `${homeAbbr} ML`);
  push('moneyline', 'away', ml.away,
    model?.moneyline == null ? null : 1 - model.moneyline, null, `${awayAbbr} ML`);

  // ── Spread (NFL primary market) ───────────────────────────────────────────────
  const sp = odds.spread ?? {};
  for (const [side, team, line, price, probability] of [
    ['home', homeAbbr, sp.home, sp.homePrice, model?.spread],
    ['away', awayAbbr, sp.away, sp.awayPrice,
      model?.spread == null ? null : 1 - model.spread],
  ]) {
    const lineStr = line != null ? `${line > 0 ? '+' : ''}${line}` : '';
    push('spread', side, price, probability, line, `${team} ${lineStr}`.trim());
  }

  // ── Total ─────────────────────────────────────────────────────────────────────
  const tot = odds.total ?? {};
  if (tot.line != null) {
    push('overunder', 'over', tot.overPrice, model?.total, tot.line, `Over ${tot.line}`);
    push('overunder', 'under', tot.underPrice,
      model?.total == null ? null : 1 - model.total, tot.line, `Under ${tot.line}`);
  }

  return out;
}

/**
 * Build the full NFL candidate pool from an array of per-game entries.
 */
export function buildNflParlayCandidates(entries = []) {
  return entries.flatMap(buildNflGameCandidates);
}
