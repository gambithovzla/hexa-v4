/**
 * soccerParlayCandidates.js — builds soccer parlay candidates in the shape the
 * frozen Parlay Synergy engine (composer/correl/hitMath) consumes.
 *
 * Soccer analog of nflParlayCandidates.js. Does NOT touch any frozen file — it
 * only produces candidate objects; the route feeds them to the frozen,
 * sport-agnostic composeParlays / buildCorrelationMatrix / computeHitDistribution.
 *
 * Markets: moneyline (1X2 — picks the most likely of home/draw/away), total
 * (over/under 2.5 goals), btts (both teams to score yes/no). No player props
 * (those ship via the soccer props board).
 *
 * Soccer-specific vs NFL:
 *   - The moneyline is THREE-way. We de-vig {home, draw, away} and emit a single
 *     leg for the most-likely outcome; the soccer_moneyline model (P(home win))
 *     overrides the home leg and rescales draw/away to keep a valid distribution.
 *   - Same-game Over 2.5 + BTTS positive correlation is NOT modeled here: the
 *     frozen correl.js returns 0 for that pair (its rules are MLB-centric). That
 *     refinement needs a frozen-file change and is deferred — MVP parity with the
 *     NFL parlay (9j), which is also generic same-game.
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

/** De-vig a 3-way market → normalized {home, draw, away} fractions, or null. */
function deVig3Way(home, draw, away) {
  const rH = americanToImplied(home);
  const rD = americanToImplied(draw);
  const rA = americanToImplied(away);
  if (rH == null || rD == null || rA == null) return null;
  const total = rH + rD + rA;
  if (total <= 0) return null;
  return { home: rH / total, draw: rD / total, away: rA / total };
}

/** De-vig a 2-way market → normalized {a, b} fractions, or null. */
function deVig2Way(a, b) {
  const rA = americanToImplied(a);
  const rB = americanToImplied(b);
  if (rA == null && rB == null) return null;
  const total = (rA ?? 0) + (rB ?? 0);
  if (total <= 0) return null;
  return { a: (rA ?? 0) / total, b: (rB ?? 0) / total };
}

/**
 * Build candidates for a single soccer game.
 *
 * @param {object} entry
 * @param {string} entry.gameId
 * @param {string} entry.matchup        "AWAY @ HOME"
 * @param {string} entry.gameDate
 * @param {string} entry.homeAbbr
 * @param {string} entry.awayAbbr
 * @param {object} entry.odds           buildMarketOddsForGame() → { threeWay, total, btts }
 * @param {object|null} entry.model     { moneyline: P(home win), total: P(over), btts: P(yes) } in [0,1]
 * @param {number} [entry.dataQuality]  0–100 (context completeness); default 60 (soccer is efficient)
 * @returns {object[]} engine-shaped candidates
 */
export function buildSoccerGameCandidates(entry) {
  const { gameId, matchup, gameDate, homeAbbr, awayAbbr, odds = {}, model = null, dataQuality = 60 } = entry;
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
      candidateId: `soccer_${gameId}::${marketType}::${side}::${line ?? 'na'}::${slug(label)}`,
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
      modelRisk: dataQuality >= 60 ? 'medium' : 'high',
      reasoning: '',
    });
  };

  // ── Moneyline (1X2 — pick the most likely of home/draw/away) ───────────────────
  const tw = odds.threeWay ?? {};
  if (tw.home != null || tw.draw != null || tw.away != null) {
    let dist = deVig3Way(tw.home, tw.draw, tw.away);
    if (dist && model?.moneyline != null) {
      // Override the home probability with the model, rescale draw/away to fill.
      const pHome = Math.max(0, Math.min(1, model.moneyline));
      const rest = dist.draw + dist.away;
      const scale = rest > 0 ? (1 - pHome) / rest : 0;
      dist = { home: pHome, draw: dist.draw * scale, away: dist.away * scale };
    }
    if (dist) {
      const sides = [
        { side: 'home', prob: dist.home, odds: tw.home, label: `${homeAbbr ?? 'HOME'} Win` },
        { side: 'draw', prob: dist.draw, odds: tw.draw, label: 'Draw' },
        { side: 'away', prob: dist.away, odds: tw.away, label: `${awayAbbr ?? 'AWAY'} Win` },
      ].filter(s => s.odds != null);
      const best = sides.sort((a, b) => b.prob - a.prob)[0];
      if (best) push('moneyline', best.side, best.odds, best.prob, null, best.label);
    }
  }

  // ── Total (over/under 2.5 goals) ───────────────────────────────────────────────
  const tot = odds.total ?? {};
  if (tot.line != null && (tot.overPrice != null || tot.underPrice != null)) {
    const dv = deVig2Way(tot.overPrice, tot.underPrice);
    const pOver = model?.total != null ? model.total : (dv ? dv.a : 0.5);
    const over = pOver >= 0.5;
    const side = over ? 'over' : 'under';
    const sideProb = over ? pOver : 1 - pOver;
    const price = over ? tot.overPrice : tot.underPrice;
    push('overunder', side, price, sideProb, tot.line, `${over ? 'Over' : 'Under'} ${tot.line}`);
  }

  // ── BTTS (both teams to score) ─────────────────────────────────────────────────
  const btts = odds.btts ?? {};
  if (btts.yes != null || btts.no != null) {
    const dv = deVig2Way(btts.yes, btts.no);
    const pYes = model?.btts != null ? model.btts : (dv ? dv.a : 0.5);
    const yes = pYes >= 0.5;
    const side = yes ? 'yes' : 'no';
    const sideProb = yes ? pYes : 1 - pYes;
    const price = yes ? btts.yes : btts.no;
    push('btts', side, price, sideProb, null, `BTTS ${yes ? 'Yes' : 'No'}`);
  }

  return out;
}

/**
 * Build the full soccer candidate pool from an array of per-game entries.
 */
export function buildSoccerParlayCandidates(entries = []) {
  return entries.flatMap(buildSoccerGameCandidates);
}
