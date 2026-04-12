import { calculateImpliedProbability } from './odds-api.js';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTeamAliases(team = {}) {
  const name = String(team?.name ?? '').trim();
  const abbreviation = String(team?.abbreviation ?? '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  const nickname = words.length ? words[words.length - 1] : '';
  const city = words.length > 1 ? words.slice(0, -1).join(' ') : '';

  return [
    abbreviation,
    name,
    nickname,
    city,
  ]
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function pickContainsAny(text, aliases) {
  return aliases.some((alias) => alias && text.includes(alias));
}

function parseEmbeddedOdds(text) {
  const match = String(text ?? '').match(/([+-]\d{3,4})/);
  const parsed = match ? Number(match[1]) : null;
  return Number.isFinite(parsed) ? parsed : null;
}

function inferMarketType({ pick, bestPickType = null }) {
  const type = normalizeText(bestPickType);
  const normalizedPick = normalizeText(pick);

  if (type.includes('moneyline')) return 'moneyline';
  if (type.includes('runline')) return 'runline';
  if (type.includes('over-under') || type.includes('overunder') || type.includes('totals')) return 'overunder';
  if (type.includes('playerprop') || type.includes('prop')) return 'playerprop';

  if (/\bover\b|\bunder\b|\bmas\b|\bmenos\b/.test(normalizedPick)) {
    if (/\bhits?\b|\bstrikeouts?\b|\bhr\b|\bhome run\b|\btotal bases?\b|\brbi\b|\bsb\b/.test(normalizedPick)) {
      return 'playerprop';
    }
    return 'overunder';
  }

  if (normalizedPick.includes('run line') || normalizedPick.includes('linea')) return 'runline';
  if (normalizedPick.includes('moneyline') || normalizedPick.includes(' ml')) return 'moneyline';
  return 'moneyline';
}

function inferOddsSelection({ pick, bestPickType, oddsData, gameData }) {
  const odds = oddsData?.odds ?? oddsData ?? {};
  const marketType = inferMarketType({ pick, bestPickType });
  const normalizedPick = normalizeText(pick);
  const homeAliases = buildTeamAliases(gameData?.teams?.home);
  const awayAliases = buildTeamAliases(gameData?.teams?.away);
  const referencesHome = pickContainsAny(normalizedPick, homeAliases);
  const referencesAway = pickContainsAny(normalizedPick, awayAliases);
  const embeddedOdds = parseEmbeddedOdds(pick);

  if (marketType === 'overunder') {
    const isUnder = /\bunder\b|\bmenos\b|\bbaja\b/.test(normalizedPick);
    const oddsValue = isUnder ? odds?.overUnder?.underPrice : odds?.overUnder?.overPrice;
    return {
      marketType,
      side: isUnder ? 'under' : 'over',
      odds: oddsValue ?? embeddedOdds,
    };
  }

  if (marketType === 'runline') {
    if (referencesHome && !referencesAway) {
      return { marketType, side: 'home', odds: odds?.runLine?.home?.price ?? embeddedOdds };
    }
    if (referencesAway && !referencesHome) {
      return { marketType, side: 'away', odds: odds?.runLine?.away?.price ?? embeddedOdds };
    }
    return { marketType, side: null, odds: embeddedOdds };
  }

  if (marketType === 'moneyline') {
    if (referencesHome && !referencesAway) {
      return { marketType, side: 'home', odds: odds?.moneyline?.home ?? embeddedOdds };
    }
    if (referencesAway && !referencesHome) {
      return { marketType, side: 'away', odds: odds?.moneyline?.away ?? embeddedOdds };
    }
    return { marketType, side: null, odds: embeddedOdds };
  }

  return {
    marketType,
    side: null,
    odds: embeddedOdds,
  };
}

function buildValueTier(edgePct, modelProbability, modelRisk = null) {
  if (edgePct == null || modelProbability == null) return null;
  const normalizedRisk = normalizeText(modelRisk);
  if (modelProbability < 52) return 'NO VALUE';
  if (edgePct > 5 && modelProbability >= 58 && normalizedRisk !== 'high') return 'HIGH VALUE';
  if (edgePct > 2 && modelProbability >= 55) return 'MODERATE VALUE';
  if (edgePct > 0) return 'MARGINAL VALUE';
  return 'NO VALUE';
}

export function buildValueBreakdown({ data, oddsData = null, gameData = null }) {
  if (!data || typeof data !== 'object') return null;

  const masterPrediction = data.master_prediction ?? {};
  const bestPick = data.best_pick ?? {};
  const pick = masterPrediction.pick ?? bestPick.detail ?? null;
  const fallbackConfidence = bestPick.confidence != null ? Number(bestPick.confidence) * 100 : null;
  const modelProbability = toNumber(masterPrediction.oracle_confidence ?? fallbackConfidence);

  if (!pick || modelProbability == null) return null;

  const oddsSelection = inferOddsSelection({
    pick,
    bestPickType: bestPick.type,
    oddsData,
    gameData,
  });

  const impliedProbability = oddsSelection.odds != null
    ? calculateImpliedProbability(oddsSelection.odds)
    : null;
  const edge = impliedProbability != null
    ? round(modelProbability - impliedProbability, 1)
    : null;

  return {
    market_type: oddsSelection.marketType,
    odds: oddsSelection.odds ?? null,
    model_probability: round(modelProbability, 1),
    implied_probability: impliedProbability,
    edge,
    value_tier: masterPrediction.bet_value ?? buildValueTier(edge, modelProbability, data.model_risk),
  };
}

function shrinkTowardsCoinFlip(probability, qualityScore) {
  const quality = clamp(toNumber(qualityScore) ?? 60, 25, 100);
  const weight = 0.4 + ((quality - 25) / 75) * 0.6;
  return 0.5 + (probability - 0.5) * weight;
}

function buildExpectedTotal(features = {}, marketTotal = 8.5) {
  const homePitcherXwoba = toNumber(features?.homePitcherSavant?.xwOBA_against);
  const awayPitcherXwoba = toNumber(features?.awayPitcherSavant?.xwOBA_against);
  const homePitcherEra = toNumber(features?.homePitcherStats?.stats?.era);
  const awayPitcherEra = toNumber(features?.awayPitcherStats?.stats?.era);
  const homeTeamOps = toNumber(features?.homeHitting?.ops);
  const awayTeamOps = toNumber(features?.awayHitting?.ops);
  const homeLineupXwoba = averageXwoba(features?.savantBatters?.home);
  const awayLineupXwoba = averageXwoba(features?.savantBatters?.away);
  const parkOverall = toNumber(features?.parkFactorData?.park_factor_overall);
  const temperature = toNumber(features?.weatherData?.temperature);
  const windSpeed = toNumber(features?.weatherData?.windSpeed ?? features?.weatherData?.wind_speed);
  const coherence = normalizeText(features?.signalCoherence?.dominantDirection);

  let projection = marketTotal ?? 8.5;
  projection += (((homePitcherXwoba ?? 0.315) - 0.315) + ((awayPitcherXwoba ?? 0.315) - 0.315)) * 10;
  projection += (((homeLineupXwoba ?? 0.315) - 0.315) + ((awayLineupXwoba ?? 0.315) - 0.315)) * 14;
  projection += (((homeTeamOps ?? 0.710) - 0.710) + ((awayTeamOps ?? 0.710) - 0.710)) * 3;
  projection += (((homePitcherEra ?? 4.1) - 4.1) + ((awayPitcherEra ?? 4.1) - 4.1)) * 0.12;
  projection += ((parkOverall ?? 100) - 100) * 0.03;

  if (temperature != null) projection += (temperature - 72) * 0.02;
  if (windSpeed != null) projection += (windSpeed - 8) * 0.015;
  if (coherence.includes('over')) projection += 0.25;
  if (coherence.includes('under')) projection -= 0.25;

  return round(projection, 2);
}

function averageXwoba(batters = []) {
  const withData = (batters ?? []).filter((batter) => batter?.savant?.xwOBA != null);
  if (!withData.length) return null;
  const total = withData.reduce((sum, batter) => sum + Number(batter.savant.xwOBA ?? 0), 0);
  return total / withData.length;
}

function buildMoneylineProbabilities({ features = {}, xgboostResult = null }) {
  const validatorProb = toNumber(xgboostResult?.score) != null
    ? toNumber(xgboostResult.score) / 100
    : null;

  let homeProbability = validatorProb;

  if (homeProbability == null) {
    const homeOffense = ((averageXwoba(features?.savantBatters?.home) ?? 0.315) - 0.315) * 3.6 +
      ((toNumber(features?.awayPitcherSavant?.xwOBA_against) ?? 0.315) - 0.315) * 3.1;
    const awayOffense = ((averageXwoba(features?.savantBatters?.away) ?? 0.315) - 0.315) * 3.6 +
      ((toNumber(features?.homePitcherSavant?.xwOBA_against) ?? 0.315) - 0.315) * 3.1;
    homeProbability = clamp(0.5 + (homeOffense - awayOffense) * 0.5, 0.34, 0.66);
  }

  homeProbability = shrinkTowardsCoinFlip(homeProbability, features?.dataQuality?.score);
  homeProbability = clamp(homeProbability, 0.36, 0.74);

  return {
    home: round(homeProbability * 100, 1),
    away: round((1 - homeProbability) * 100, 1),
  };
}

function buildRunLineProbabilities({ homeMoneylineProb, expectedTotal, features = {} }) {
  const homeProb = clamp(homeMoneylineProb / 100, 0.36, 0.74);
  const favoriteIsHome = homeProb >= 0.5;
  const favoriteProb = favoriteIsHome ? homeProb : 1 - homeProb;
  const strength = (favoriteProb - 0.5) * 2;
  const scoringBoost = clamp(((expectedTotal ?? 8.5) - 8.5) / 3, -1, 1);

  let favoriteCover = 0.47 + strength * 0.16 + Math.max(0, scoringBoost) * 0.04;
  favoriteCover = shrinkTowardsCoinFlip(favoriteCover, features?.dataQuality?.score);
  favoriteCover = clamp(favoriteCover, 0.42, 0.7);

  let dogCover = 1 - favoriteCover + 0.04 - Math.max(0, scoringBoost) * 0.02;
  dogCover = shrinkTowardsCoinFlip(dogCover, features?.dataQuality?.score);
  dogCover = clamp(dogCover, 0.48, 0.76);

  return favoriteIsHome
    ? { home: round(favoriteCover * 100, 1), away: round(dogCover * 100, 1) }
    : { home: round(dogCover * 100, 1), away: round(favoriteCover * 100, 1) };
}

function buildTotalsProbabilities({ expectedTotal, marketTotal, features = {} }) {
  const delta = (expectedTotal ?? marketTotal ?? 8.5) - (marketTotal ?? 8.5);
  let overProb = 0.5 + delta * 0.13;
  overProb = shrinkTowardsCoinFlip(overProb, features?.dataQuality?.score);
  overProb = clamp(overProb, 0.35, 0.73);
  const underProb = clamp(1 - overProb, 0.27, 0.65);
  return {
    over: round(overProb * 100, 1),
    under: round(underProb * 100, 1),
  };
}

function candidateReasoning({
  lang,
  marketType,
  pick,
  modelProbability,
  impliedProbability,
  edge,
  expectedTotal,
  marketTotal,
  features = {},
}) {
  const homePitcherXwoba = toNumber(features?.homePitcherSavant?.xwOBA_against);
  const awayPitcherXwoba = toNumber(features?.awayPitcherSavant?.xwOBA_against);
  const parkOverall = toNumber(features?.parkFactorData?.park_factor_overall);
  const temperature = toNumber(features?.weatherData?.temperature);
  const windSpeed = toNumber(features?.weatherData?.windSpeed ?? features?.weatherData?.wind_speed);

  if (lang === 'es') {
    if (marketType === 'moneyline') {
      return `${pick} lidera con ${modelProbability}% de acierto estimado; gap de abridores xwOBA ${awayPitcherXwoba ?? 'N/A'} vs ${homePitcherXwoba ?? 'N/A'} y contexto de juego ${parkOverall ?? 100} de park factor.`;
    }
    if (marketType === 'runline') {
      return `${pick} sube por diferencia proyectada de talento y entorno de anotacion; total esperado ${expectedTotal ?? 'N/A'} sobre linea ${marketTotal ?? 'N/A'}.`;
    }
    return `${pick} se apoya en total proyectado ${expectedTotal ?? 'N/A'} frente a linea ${marketTotal ?? 'N/A'}; clima ${temperature ?? 'N/A'}F, viento ${windSpeed ?? 'N/A'} mph y park factor ${parkOverall ?? 100}.`;
  }

  if (marketType === 'moneyline') {
    return `${pick} leads at ${modelProbability}% projected hit rate; starter xwOBA gap ${awayPitcherXwoba ?? 'N/A'} vs ${homePitcherXwoba ?? 'N/A'} with park context ${parkOverall ?? 100}.`;
  }
  if (marketType === 'runline') {
    return `${pick} rises on projected team gap plus scoring environment; expected total ${expectedTotal ?? 'N/A'} against market ${marketTotal ?? 'N/A'}.`;
  }
  return `${pick} is supported by projected total ${expectedTotal ?? 'N/A'} versus market ${marketTotal ?? 'N/A'}; weather ${temperature ?? 'N/A'}F, wind ${windSpeed ?? 'N/A'} mph and park factor ${parkOverall ?? 100}.`;
}

function buildSafeScope({ oddsData, lang }) {
  const estimated = oddsData?.source === 'estimated_spring_training';
  if (lang === 'es') {
    return estimated
      ? 'Top-1 objetivo entre Moneyline, Run Line y Totales soportados. Las props quedan fuera hasta integrar lineas reales; esta corrida usa lineas estimadas.'
      : 'Top-1 objetivo entre Moneyline, Run Line y Totales soportados. Las props quedan fuera hasta integrar lineas reales.';
  }
  return estimated
    ? 'Objective top-1 across supported Moneyline, Run Line and Totals markets. Props stay excluded until a real props feed is integrated; this run uses estimated lines.'
    : 'Objective top-1 across supported Moneyline, Run Line and Totals markets. Props stay excluded until a real props feed is integrated.';
}

export function buildDeterministicSafePayload({
  gameData,
  features = {},
  oddsData = null,
  xgboostResult = null,
  lang = 'en',
  llmData = null,
}) {
  const ml = oddsData?.odds?.moneyline ?? {};
  const rl = oddsData?.odds?.runLine ?? {};
  const ou = oddsData?.odds?.overUnder ?? {};
  const homeTeam = gameData?.teams?.home ?? {};
  const awayTeam = gameData?.teams?.away ?? {};
  const homeAbbr = homeTeam.abbreviation ?? 'HOME';
  const awayAbbr = awayTeam.abbreviation ?? 'AWAY';

  const mlProbabilities = buildMoneylineProbabilities({ features, xgboostResult });
  const expectedTotal = buildExpectedTotal(features, toNumber(ou.total) ?? 8.5);
  const runLineProbabilities = buildRunLineProbabilities({
    homeMoneylineProb: mlProbabilities.home,
    expectedTotal,
    features,
  });
  const totalsProbabilities = buildTotalsProbabilities({
    expectedTotal,
    marketTotal: toNumber(ou.total) ?? 8.5,
    features,
  });

  const candidates = [
    {
      pick: `${awayAbbr} Moneyline`,
      type: 'Moneyline',
      hit_probability: mlProbabilities.away,
      odds: ml.away ?? null,
      market_type: 'moneyline',
      side: 'away',
    },
    {
      pick: `${homeAbbr} Moneyline`,
      type: 'Moneyline',
      hit_probability: mlProbabilities.home,
      odds: ml.home ?? null,
      market_type: 'moneyline',
      side: 'home',
    },
    {
      pick: `${awayAbbr} ${rl.away?.spread != null && rl.away.spread > 0 ? '+' : ''}${rl.away?.spread ?? '+1.5'} Run Line`,
      type: 'RunLine',
      hit_probability: runLineProbabilities.away,
      odds: rl.away?.price ?? null,
      market_type: 'runline',
      side: 'away',
    },
    {
      pick: `${homeAbbr} ${rl.home?.spread != null && rl.home.spread > 0 ? '+' : ''}${rl.home?.spread ?? '-1.5'} Run Line`,
      type: 'RunLine',
      hit_probability: runLineProbabilities.home,
      odds: rl.home?.price ?? null,
      market_type: 'runline',
      side: 'home',
    },
    {
      pick: `Over ${ou.total ?? 8.5}`,
      type: 'OverUnder',
      hit_probability: totalsProbabilities.over,
      odds: ou.overPrice ?? null,
      market_type: 'overunder',
      side: 'over',
    },
    {
      pick: `Under ${ou.total ?? 8.5}`,
      type: 'OverUnder',
      hit_probability: totalsProbabilities.under,
      odds: ou.underPrice ?? null,
      market_type: 'overunder',
      side: 'under',
    },
  ]
    .map((candidate) => {
      const impliedProbability = candidate.odds != null
        ? calculateImpliedProbability(candidate.odds)
        : null;
      const edge = impliedProbability != null
        ? round(candidate.hit_probability - impliedProbability, 1)
        : null;
      return {
        ...candidate,
        model_probability: candidate.hit_probability,
        implied_probability: impliedProbability,
        edge,
      };
    })
    .sort((a, b) => {
      if (b.hit_probability !== a.hit_probability) return b.hit_probability - a.hit_probability;
      if ((b.edge ?? -999) !== (a.edge ?? -999)) return (b.edge ?? -999) - (a.edge ?? -999);
      return 0;
    })
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
      reasoning: candidateReasoning({
        lang,
        marketType: candidate.market_type,
        pick: candidate.pick,
        modelProbability: candidate.model_probability,
        impliedProbability: candidate.implied_probability,
        edge: candidate.edge,
        expectedTotal,
        marketTotal: ou.total ?? 8.5,
        features,
      }),
    }));

  const topPick = candidates[0];
  const alternatives = candidates.slice(1, 3).map((candidate) => ({
    pick: candidate.pick,
    type: candidate.type,
    hit_probability: candidate.hit_probability,
    reasoning: candidate.reasoning,
    model_probability: candidate.model_probability,
    implied_probability: candidate.implied_probability,
    edge: candidate.edge,
    odds: candidate.odds,
    rank: candidate.rank,
  }));

  const alertFlags = Array.isArray(llmData?.alert_flags) ? [...llmData.alert_flags] : [];
  const deterministicFlag = lang === 'es'
    ? 'Safe selector: ranking determinista ML/RL/OU activo'
    : 'Safe selector: deterministic ML/RL/OU ranking active';
  if (!alertFlags.includes(deterministicFlag)) {
    alertFlags.push(deterministicFlag);
  }

  const gameOverview = llmData?.game_overview ??
    (lang === 'es'
      ? `${awayAbbr} vs ${homeAbbr}; top-1 objetivo entre mercados soportados con total proyectado ${expectedTotal}.`
      : `${awayAbbr} at ${homeAbbr}; objective top-1 across supported markets with projected total ${expectedTotal}.`);

  return {
    safe_pick: {
      pick: topPick.pick,
      type: topPick.type,
      hit_probability: topPick.hit_probability,
      reasoning: topPick.reasoning,
      model_probability: topPick.model_probability,
      implied_probability: topPick.implied_probability,
      edge: topPick.edge,
      odds: topPick.odds,
      rank: topPick.rank,
    },
    best_pick: {
      type: topPick.type,
      detail: topPick.pick,
      confidence: round((topPick.hit_probability ?? 0) / 100, 3),
    },
    alternatives,
    safe_candidates: candidates,
    value_breakdown: {
      market_type: topPick.market_type,
      odds: topPick.odds,
      model_probability: topPick.model_probability,
      implied_probability: topPick.implied_probability,
      edge: topPick.edge,
      value_tier: topPick.edge != null
        ? (topPick.edge > 5 ? 'PLUS EV' : topPick.edge > 0 ? 'SMALL EDGE' : 'SAFE ONLY')
        : 'SAFE ONLY',
    },
    probability_model: {
      home_wins: Math.round((mlProbabilities.home / 100) * 10000),
      away_wins: Math.round((mlProbabilities.away / 100) * 10000),
    },
    game_overview: gameOverview,
    alert_flags: alertFlags,
    model_risk: llmData?.model_risk ?? 'medium',
    selection_method: 'deterministic_markets_v1',
    safe_scope: buildSafeScope({ oddsData, lang }),
  };
}
