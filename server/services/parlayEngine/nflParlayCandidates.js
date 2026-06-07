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
  if (ml.home != null || ml.away != null) {
    const pHome = model?.moneyline ?? americanToImplied(ml.home);
    const homeFav = (pHome ?? 0.5) >= 0.5;
    const side = homeFav ? 'home' : 'away';
    const sideOdds = homeFav ? ml.home : ml.away;
    const sideModel = model?.moneyline != null ? (homeFav ? model.moneyline : 1 - model.moneyline) : null;
    const team = homeFav ? homeAbbr : awayAbbr;
    push('moneyline', side, sideOdds, sideModel, null, `${team} ML`);
  }

  // ── Spread (NFL primary market) ───────────────────────────────────────────────
  const sp = odds.spread ?? {};
  if (sp.home != null || sp.away != null) {
    const pCover = model?.spread ?? 0.5;
    const homeSide = pCover >= 0.5;
    const side = homeSide ? 'home' : 'away';
    const line = homeSide ? sp.home : sp.away;
    const price = homeSide ? sp.homePrice : sp.awayPrice;
    const sideModel = model?.spread != null ? (homeSide ? model.spread : 1 - model.spread) : null;
    const team = homeSide ? homeAbbr : awayAbbr;
    const lineStr = line != null ? `${line > 0 ? '+' : ''}${line}` : '';
    push('spread', side, price, sideModel, line, `${team} ${lineStr}`.trim());
  }

  // ── Total ─────────────────────────────────────────────────────────────────────
  const tot = odds.total ?? {};
  if (tot.line != null) {
    const pOver = model?.total ?? 0.5;
    const over = pOver >= 0.5;
    const side = over ? 'over' : 'under';
    const price = over ? tot.overPrice : tot.underPrice;
    const sideModel = model?.total != null ? (over ? model.total : 1 - model.total) : null;
    push('overunder', side, price, sideModel, tot.line, `${over ? 'Over' : 'Under'} ${tot.line}`);
  }

  return out;
}

/**
 * Build the full NFL candidate pool from an array of per-game entries.
 */
export function buildNflParlayCandidates(entries = []) {
  return entries.flatMap(buildNflGameCandidates);
}
