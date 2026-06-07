/**
 * hexaSoccerSignalsService.js
 *
 * Pure rule-based signal generators for the soccer Pizarra del Día — the soccer
 * analog of hexaSmartSignalsService.js (MLB). No ML, no LLM: every signal is a
 * deterministic function over the soccer context (form, xG, goal diff / points,
 * league profile, de-vigged 3-way market). Each detector never throws and
 * returns [] on missing data.
 *
 * Signal shape (same as MLB so the board can render uniformly):
 *   { type, icon, text: { es, en }, priority, meta }
 *
 * Detectors:
 *   detectSoccerStreak(team)              — leading run of W/L in the form string
 *   detectXgDivergence(team)              — season goals vs xG (over/under-performing)
 *   detectStrengthMismatch(home, away)    — points / goal-diff gap
 *   detectMarketSignals(marketOdds)       — heavy favorite / tight 3-way / draw risk
 *   detectLeagueLean(leagueMeta, marketOdds) — league scoring profile → over/draw lean
 *   buildSoccerGameSignals(context, marketOdds) — aggregate + rank + trim
 */

const T = {
  streak:   { hotMinWins: 3, coldMinLosses: 3 },
  xg:       { divergenceGoals: 5 },
  market:   { heavyFavorite: 0.60, tightThreeWay: 0.38, drawElevated: 0.30 },
  strength: { pointsGap: 12, goalDiffGap: 15 },
  league:   { highScoring: 2.9, drawHeavy: 0.27 },
  output:   { maxInsights: 12 },
  priority: {
    team_streak_hot: 80, team_streak_cold: 65,
    xg_overperforming: 70, xg_underperforming: 75,
    heavy_favorite: 60, tight_three_way: 72, draw_risk: 78,
    high_scoring_lean: 85, low_scoring_lean: 68, strength_mismatch: 66,
  },
};

function priorityFor(type, boost = 0) {
  const base = T.priority[type] ?? 50;
  return Math.min(100, Math.max(0, base + boost));
}

function toNum(v) {
  // Guard null/undefined/'' explicitly — Number(null) is 0 (a finite value),
  // which would wrongly treat a missing xG (MLS) as 0 goals expected.
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function americanToRawProb(american) {
  const n = toNum(american);
  if (n == null) return null;
  return n >= 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

/** De-vig 3-way → { home, draw, away } fractions, or null. */
function deVig3Way(tw) {
  if (!tw) return null;
  const rH = americanToRawProb(tw.home);
  const rD = americanToRawProb(tw.draw);
  const rA = americanToRawProb(tw.away);
  if (rH == null || rD == null || rA == null) return null;
  const total = rH + rD + rA;
  if (total <= 0) return null;
  return { home: rH / total, draw: rD / total, away: rA / total };
}

// ── Signal: form streak ────────────────────────────────────────────────────────

/**
 * @param {{teamName, teamAbbr, recentForm:{recent?:string}}} team
 * Counts the leading run of identical results in the form string (by convention
 * most-recent-first). 3+ wins → hot, 3+ losses → cold.
 */
export function detectSoccerStreak(team) {
  const recent = team?.recentForm?.recent;
  if (!team?.teamName || typeof recent !== 'string' || !recent) return [];
  const chars = recent.toUpperCase().split('').filter(c => 'WDL'.includes(c));
  if (!chars.length) return [];
  const first = chars[0];
  let run = 0;
  for (const c of chars) { if (c === first) run++; else break; }

  if (first === 'W' && run >= T.streak.hotMinWins) {
    return [{
      type: 'team_streak_hot', icon: '🔥',
      text: {
        es: `${team.teamName} llega con ${run} victorias seguidas`,
        en: `${team.teamName} come in on a ${run}-match win streak`,
      },
      priority: priorityFor('team_streak_hot', Math.min(10, run - T.streak.hotMinWins)),
      meta: { teamAbbr: team.teamAbbr, teamName: team.teamName, streak: run, kind: 'wins' },
    }];
  }
  if (first === 'L' && run >= T.streak.coldMinLosses) {
    return [{
      type: 'team_streak_cold', icon: '❄️',
      text: {
        es: `${team.teamName} encadena ${run} derrotas`,
        en: `${team.teamName} have lost ${run} in a row`,
      },
      priority: priorityFor('team_streak_cold', Math.min(10, run - T.streak.coldMinLosses)),
      meta: { teamAbbr: team.teamAbbr, teamName: team.teamName, streak: run, kind: 'losses' },
    }];
  }
  return [];
}

// ── Signal: xG over/under-performance ──────────────────────────────────────────

/**
 * Season goals vs xG. Scoring well above xG → finishing hot (regression risk);
 * well below → unlucky (positive-regression value). Big 5 only (xG null in MLS).
 */
export function detectXgDivergence(team) {
  const xg = toNum(team?.xG);
  const gf = toNum(team?.goalsFor);
  if (xg == null || gf == null) return [];
  const diff = gf - xg;
  if (diff >= T.xg.divergenceGoals) {
    return [{
      type: 'xg_overperforming', icon: '📈',
      text: {
        es: `${team.teamName} marca ${diff.toFixed(1)} goles por encima de su xG (riesgo de regresión)`,
        en: `${team.teamName} are ${diff.toFixed(1)} goals above their xG (regression risk)`,
      },
      priority: priorityFor('xg_overperforming'),
      meta: { teamAbbr: team.teamAbbr, teamName: team.teamName, goalsFor: gf, xG: xg, diff: Math.round(diff * 10) / 10 },
    }];
  }
  if (diff <= -T.xg.divergenceGoals) {
    return [{
      type: 'xg_underperforming', icon: '📉',
      text: {
        es: `${team.teamName} marca ${Math.abs(diff).toFixed(1)} goles por debajo de su xG (valor por regresión)`,
        en: `${team.teamName} are ${Math.abs(diff).toFixed(1)} goals below their xG (positive-regression value)`,
      },
      priority: priorityFor('xg_underperforming'),
      meta: { teamAbbr: team.teamAbbr, teamName: team.teamName, goalsFor: gf, xG: xg, diff: Math.round(diff * 10) / 10 },
    }];
  }
  return [];
}

// ── Signal: strength mismatch ──────────────────────────────────────────────────

export function detectStrengthMismatch(home, away) {
  const hp = toNum(home?.points), ap = toNum(away?.points);
  const hgd = toNum(home?.goalDiff), agd = toNum(away?.goalDiff);
  const pointsGap = hp != null && ap != null ? Math.abs(hp - ap) : null;
  const gdGap     = hgd != null && agd != null ? Math.abs(hgd - agd) : null;
  if ((pointsGap == null || pointsGap < T.strength.pointsGap) &&
      (gdGap == null || gdGap < T.strength.goalDiffGap)) return [];

  const homeStronger = (hp ?? 0) >= (ap ?? 0);
  const strong = homeStronger ? home : away;
  return [{
    type: 'strength_mismatch', icon: '⚖️',
    text: {
      es: `${strong.teamName} llega muy por encima en la tabla`,
      en: `${strong.teamName} come in well above their opponent in the table`,
    },
    priority: priorityFor('strength_mismatch'),
    meta: { strongerAbbr: strong.teamAbbr, strongerName: strong.teamName, pointsGap, goalDiffGap: gdGap },
  }];
}

// ── Signal: market shape ────────────────────────────────────────────────────────

export function detectMarketSignals(marketOdds, gameMeta = {}) {
  const dist = deVig3Way(marketOdds?.threeWay);
  if (!dist) return [];
  const out = [];
  const maxWin = Math.max(dist.home, dist.away);

  if (maxWin >= T.market.heavyFavorite) {
    const homeFav = dist.home >= dist.away;
    const name = homeFav ? (gameMeta.homeName ?? 'Home') : (gameMeta.awayName ?? 'Away');
    const abbr = homeFav ? gameMeta.homeAbbr : gameMeta.awayAbbr;
    out.push({
      type: 'heavy_favorite', icon: '💪',
      text: {
        es: `${name} es favorito claro del mercado (${Math.round(maxWin * 100)}%)`,
        en: `${name} is a clear market favorite (${Math.round(maxWin * 100)}%)`,
      },
      priority: priorityFor('heavy_favorite', Math.round((maxWin - T.market.heavyFavorite) * 50)),
      meta: { teamAbbr: abbr, teamName: name, impliedProb: Math.round(maxWin * 1000) / 10 },
    });
  }

  if (dist.draw >= T.market.drawElevated) {
    out.push({
      type: 'draw_risk', icon: '🤝',
      text: {
        es: `Empate con probabilidad elevada (${Math.round(dist.draw * 100)}%)`,
        en: `Elevated draw probability (${Math.round(dist.draw * 100)}%)`,
      },
      priority: priorityFor('draw_risk'),
      meta: { drawProb: Math.round(dist.draw * 1000) / 10 },
    });
  }

  if (Math.max(dist.home, dist.draw, dist.away) <= T.market.tightThreeWay) {
    out.push({
      type: 'tight_three_way', icon: '🎲',
      text: {
        es: 'Partido muy parejo a 3 vías — sin favorito claro',
        en: 'Tight three-way market — no clear favorite',
      },
      priority: priorityFor('tight_three_way'),
      meta: { home: Math.round(dist.home * 1000) / 10, draw: Math.round(dist.draw * 1000) / 10, away: Math.round(dist.away * 1000) / 10 },
    });
  }
  return out;
}

// ── Signal: league scoring profile lean ─────────────────────────────────────────

export function detectLeagueLean(leagueMeta, marketOdds) {
  if (!leagueMeta) return [];
  const out = [];
  const avgGoals = toNum(leagueMeta.avgGoals);
  const drawPct  = toNum(leagueMeta.drawPct);

  if (avgGoals != null && avgGoals >= T.league.highScoring) {
    const overFav = marketOdds?.total?.overPrice != null && marketOdds?.total?.underPrice != null
      ? americanToRawProb(marketOdds.total.overPrice) >= americanToRawProb(marketOdds.total.underPrice)
      : null;
    out.push({
      type: 'high_scoring_lean', icon: '🎯',
      text: {
        es: `Liga de alta anotación (${avgGoals.toFixed(1)} goles/partido)${overFav ? ' — mercado apoya el Over' : ''}`,
        en: `High-scoring league (${avgGoals.toFixed(1)} goals/game)${overFav ? ' — market backs the Over' : ''}`,
      },
      priority: priorityFor('high_scoring_lean', overFav ? 8 : 0),
      meta: { avgGoals, overFavored: overFav },
    });
  }

  if (drawPct != null && drawPct >= T.league.drawHeavy) {
    out.push({
      type: 'low_scoring_lean', icon: '🛡️',
      text: {
        es: `Liga defensiva con muchos empates (${Math.round(drawPct * 100)}%)`,
        en: `Defensive, draw-heavy league (${Math.round(drawPct * 100)}%)`,
      },
      priority: priorityFor('low_scoring_lean'),
      meta: { drawPct },
    });
  }
  return out;
}

// ── Aggregator ──────────────────────────────────────────────────────────────────

export function rankAndTrim(signals) {
  const seen = new Set();
  const out = [];
  for (const s of signals) {
    if (!s) continue;
    const key = `${s.type}:${s.meta?.teamAbbr ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  out.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return out.slice(0, T.output.maxInsights);
}

/**
 * Build the full ranked signal list for one soccer game from its context
 * (buildSoccerGameContext output) and the resolved marketOdds.
 */
export function buildSoccerGameSignals(context, marketOdds = null) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};
  const leagueMeta = context?.leagueMeta ?? null;
  const gameMeta = {
    homeName: home.teamName, awayName: away.teamName,
    homeAbbr: home.teamAbbr, awayAbbr: away.teamAbbr,
  };

  const signals = [
    ...detectSoccerStreak(home),
    ...detectSoccerStreak(away),
    ...detectXgDivergence(home),
    ...detectXgDivergence(away),
    ...detectStrengthMismatch(home, away),
    ...detectMarketSignals(marketOdds, gameMeta),
    ...detectLeagueLean(leagueMeta, marketOdds),
  ];
  return rankAndTrim(signals);
}

export const SOCCER_SIGNAL_THRESHOLDS = T;
