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

function averageRollingWindow(batters = [], key = 'woba_7d') {
  const withData = (batters ?? []).filter((batter) => batter?.savant?.rolling_windows?.[key] != null);
  if (!withData.length) return null;
  const total = withData.reduce((sum, batter) => sum + Number(batter.savant.rolling_windows?.[key] ?? 0), 0);
  return total / withData.length;
}

function getLineupPlayers(gameData, side) {
  const fromTeams = gameData?.teams?.[side]?.lineup;
  if (Array.isArray(fromTeams) && fromTeams.length) return fromTeams;
  const fromRoot = gameData?.lineups?.[side];
  return Array.isArray(fromRoot) ? fromRoot : [];
}

function playerLabel(player) {
  return String(player?.fullName ?? player?.name ?? '').trim();
}

function samePlayerName(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const aParts = a.split(' ').filter(Boolean);
  const bParts = b.split(' ').filter(Boolean);
  if (!aParts.length || !bParts.length) return false;

  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  return aLast === bLast;
}

function findSavantBatterByName(batters = [], name) {
  return (batters ?? []).find((entry) => samePlayerName(entry?.name, name)) ?? null;
}

function findSplitEntry(splitPool = [], player = null) {
  const playerId = player?.id ?? player?.playerId ?? null;
  if (playerId != null) {
    const byId = (splitPool ?? []).find((entry) => String(entry?.id) === String(playerId));
    if (byId) return byId;
  }

  const name = playerLabel(player);
  return (splitPool ?? []).find((entry) => samePlayerName(entry?.name, name)) ?? null;
}

function getMatchupSplit(splitEntry, pitcherHand = null) {
  if (!splitEntry?.splits) return null;
  if (pitcherHand === 'L') return splitEntry.splits.vsLHP ?? null;
  if (pitcherHand === 'R') return splitEntry.splits.vsRHP ?? null;
  return splitEntry.splits.vsRHP ?? splitEntry.splits.vsLHP ?? null;
}

function estimatePitcherKLine({ whiffPercent, kPercent }) {
  const whiff = toNumber(whiffPercent) ?? 24;
  const kRate = toNumber(kPercent) ?? 22;

  if (whiff >= 33 || kRate >= 30) return 7.5;
  if (whiff >= 30 || kRate >= 27) return 6.5;
  if (whiff >= 26 || kRate >= 24) return 5.5;
  if (whiff >= 23 || kRate >= 21) return 4.5;
  return 3.5;
}

function buildHitsPropReasoning({
  lang,
  playerName,
  matchupHand,
  splitOps,
  xwoba,
  rolling7,
  pitcherXwoba,
  pitcherName,
}) {
  const handLabel = matchupHand === 'L' ? 'LHP' : matchupHand === 'R' ? 'RHP' : 'starter';
  if (lang === 'es') {
    return `${playerName} Over 0.5 Hits se sostiene por xwOBA ${xwoba ?? 'N/A'}, forma 7d ${rolling7 ?? 'N/A'} y split ${handLabel} OPS ${splitOps ?? 'N/A'} frente a ${pitcherName ?? 'TBD'} (xwOBA permitida ${pitcherXwoba ?? 'N/A'}).`;
  }
  return `${playerName} Over 0.5 Hits is backed by xwOBA ${xwoba ?? 'N/A'}, 7d form ${rolling7 ?? 'N/A'} and ${handLabel} split OPS ${splitOps ?? 'N/A'} versus ${pitcherName ?? 'TBD'} (xwOBA allowed ${pitcherXwoba ?? 'N/A'}).`;
}

function buildKPropReasoning({
  lang,
  pitcherName,
  line,
  direction,
  whiff,
  kRate,
  opponentAvgXwoba,
  weakCount,
}) {
  if (lang === 'es') {
    if (direction === 'over') {
      return `${pitcherName} Over ${line} Strikeouts sube por Whiff% ${whiff ?? 'N/A'}, K% ${kRate ?? 'N/A'} y lineup rival xwOBA ${opponentAvgXwoba ?? 'N/A'} con ${weakCount} bates flojos.`;
    }
    return `${pitcherName} Under ${line} Strikeouts gana peso por un techo K mas bajo frente a lineup rival xwOBA ${opponentAvgXwoba ?? 'N/A'} aun con Whiff% ${whiff ?? 'N/A'}.`;
  }

  if (direction === 'over') {
    return `${pitcherName} Over ${line} Strikeouts rises on Whiff% ${whiff ?? 'N/A'}, K% ${kRate ?? 'N/A'} and an opponent lineup xwOBA of ${opponentAvgXwoba ?? 'N/A'} with ${weakCount} weak bats.`;
  }
  return `${pitcherName} Under ${line} Strikeouts gains value on a softer K ceiling versus an opponent lineup xwOBA of ${opponentAvgXwoba ?? 'N/A'} even with Whiff% ${whiff ?? 'N/A'}.`;
}

function canUseProps(features = {}) {
  const strategy = String(features?.dataQuality?.strategy ?? '');
  return strategy === 'FULL_ANALYSIS' || strategy === 'STANDARD_ANALYSIS';
}

function buildBatterPropCandidates({ gameData, features = {}, lang = 'en' }) {
  if (!canUseProps(features)) return [];

  const parkOverall = toNumber(features?.parkFactorData?.park_factor_overall);
  const qualityScore = features?.dataQuality?.score;
  const homePitcher = features?.homePitcher ?? null;
  const awayPitcher = features?.awayPitcher ?? null;
  const splitPools = features?.batterSplitsMap ?? { home: [], away: [] };
  const savantPools = features?.savantBatters ?? { home: [], away: [] };

  return ['home', 'away'].flatMap((side) => {
    const lineup = getLineupPlayers(gameData, side).slice(0, 9);
    const opponentPitcher = side === 'home' ? awayPitcher : homePitcher;
    const opponentPitcherSavant = side === 'home' ? features?.awayPitcherSavant : features?.homePitcherSavant;
    const matchupHand = opponentPitcher?.throwingHand ?? null;
    const splitPool = splitPools?.[side] ?? [];
    const savantPool = savantPools?.[side] ?? [];
    const pitcherXwoba = toNumber(opponentPitcherSavant?.xwOBA_against);
    const pitcherWhiff = toNumber(opponentPitcherSavant?.whiff_percent);

    return lineup.map((player, index) => {
      const name = playerLabel(player);
      const savantEntry = findSavantBatterByName(savantPool, name);
      const savant = savantEntry?.savant ?? null;
      if (!name || !savant) return null;

      const splitEntry = findSplitEntry(splitPool, player);
      const matchupSplit = getMatchupSplit(splitEntry, matchupHand);
      const xwoba = toNumber(savant?.xwOBA);
      const xba = toNumber(savant?.xBA);
      const rolling7 = toNumber(savant?.rolling_windows?.woba_7d ?? savant?.rolling_woba_30d);
      const splitOps = toNumber(matchupSplit?.ops);
      const splitAvg = toNumber(matchupSplit?.avg);
      const splitAb = toNumber(matchupSplit?.atBats);
      const avgExitVelocity = toNumber(savant?.avg_exit_velocity);

      let probability = 0.52;
      if (xwoba != null) probability += (xwoba - 0.315) * 0.80;
      if (xba != null) probability += (xba - 0.245) * 0.55;
      if (rolling7 != null) probability += (rolling7 - 0.320) * 0.40;
      if (splitOps != null) probability += (splitOps - 0.720) * 0.06;
      if (splitAvg != null) probability += (splitAvg - 0.245) * 0.22;
      if (pitcherXwoba != null) probability += (pitcherXwoba - 0.315) * 0.50;
      if (pitcherWhiff != null) probability -= Math.max(0, pitcherWhiff - 24) * 0.003;
      if (avgExitVelocity != null) probability += (avgExitVelocity - 89) * 0.002;
      if (parkOverall != null) probability += (parkOverall - 100) * 0.0015;
      if (index <= 4) probability += 0.008;
      if (index >= 7) probability -= 0.012;
      if (splitAb != null && splitAb > 0 && splitAb < 40) probability -= 0.015;

      probability = shrinkTowardsCoinFlip(probability, qualityScore);
      probability = clamp(probability, 0.42, 0.68);
      if (probability < 0.55) return null;

      return {
        pick: `${name} Over 0.5 Hits`,
        type: 'PlayerProp',
        hit_probability: round(probability * 100, 1),
        odds: null,
        market_type: 'playerprop',
        side,
        prop_kind: 'hits',
        reasoning: buildHitsPropReasoning({
          lang,
          playerName: name,
          matchupHand,
          splitOps: round(splitOps, 3),
          xwoba: round(xwoba, 3),
          rolling7: round(rolling7, 3),
          pitcherXwoba: round(pitcherXwoba, 3),
          pitcherName: opponentPitcher?.fullName ?? opponentPitcher?.name ?? null,
        }),
      };
    }).filter(Boolean);
  });
}

function buildPitcherPropCandidates({ features = {}, lang = 'en' }) {
  if (!canUseProps(features)) return [];

  const qualityScore = features?.dataQuality?.score;
  const parkOverall = toNumber(features?.parkFactorData?.park_factor_overall);

  return [
    {
      pitcher: features?.homePitcher ?? null,
      savant: features?.homePitcherSavant ?? null,
      opponentBatters: features?.savantBatters?.away ?? [],
      side: 'home',
    },
    {
      pitcher: features?.awayPitcher ?? null,
      savant: features?.awayPitcherSavant ?? null,
      opponentBatters: features?.savantBatters?.home ?? [],
      side: 'away',
    },
  ].flatMap(({ pitcher, savant, opponentBatters, side }) => {
    if (!pitcher?.fullName || !savant) return [];

    const whiff = toNumber(savant?.whiff_percent);
    const kRate = toNumber(savant?.k_percent);
    const csw = toNumber(savant?.csw_percent);
    const chase = toNumber(savant?.o_swing_percent);
    const pitcherXwoba = toNumber(savant?.xwOBA_against);
    const opponentAvgXwoba = averageXwoba(opponentBatters);
    const weakCount = (opponentBatters ?? []).filter((batter) => toNumber(batter?.savant?.xwOBA) != null && toNumber(batter?.savant?.xwOBA) < 0.31).length;
    const estimatedLine = estimatePitcherKLine({ whiffPercent: whiff, kPercent: kRate });

    let overProbability = 0.48;
    if (whiff != null) overProbability += (whiff - 24) * 0.008;
    if (kRate != null) overProbability += (kRate - 22) * 0.007;
    if (csw != null) overProbability += (csw - 28) * 0.004;
    if (chase != null) overProbability += (chase - 30) * 0.003;
    if (pitcherXwoba != null) overProbability -= (pitcherXwoba - 0.315) * 0.35;
    if (opponentAvgXwoba != null) overProbability -= (opponentAvgXwoba - 0.315) * 0.9;
    overProbability += weakCount * 0.006;
    if (parkOverall != null && parkOverall < 100) overProbability += (100 - parkOverall) * 0.002;

    overProbability = shrinkTowardsCoinFlip(overProbability, qualityScore);
    overProbability = clamp(overProbability, 0.38, 0.71);
    const underProbability = clamp(1 - overProbability + 0.03, 0.37, 0.68);

    const candidates = [];
    if (overProbability >= 0.58) {
      candidates.push({
        pick: `${pitcher.fullName} Over ${estimatedLine} Strikeouts`,
        type: 'PlayerProp',
        hit_probability: round(overProbability * 100, 1),
        odds: null,
        market_type: 'playerprop',
        side,
        prop_kind: 'strikeouts',
        reasoning: buildKPropReasoning({
          lang,
          pitcherName: pitcher.fullName,
          line: estimatedLine,
          direction: 'over',
          whiff: round(whiff, 1),
          kRate: round(kRate, 1),
          opponentAvgXwoba: round(opponentAvgXwoba, 3),
          weakCount,
        }),
      });
    }

    if (underProbability >= 0.58) {
      candidates.push({
        pick: `${pitcher.fullName} Under ${estimatedLine} Strikeouts`,
        type: 'PlayerProp',
        hit_probability: round(underProbability * 100, 1),
        odds: null,
        market_type: 'playerprop',
        side,
        prop_kind: 'strikeouts',
        reasoning: buildKPropReasoning({
          lang,
          pitcherName: pitcher.fullName,
          line: estimatedLine,
          direction: 'under',
          whiff: round(whiff, 1),
          kRate: round(kRate, 1),
          opponentAvgXwoba: round(opponentAvgXwoba, 3),
          weakCount,
        }),
      });
    }

    return candidates;
  });
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
      ? 'Top-1 objetivo entre los mercados soportados disponibles para este juego, incluyendo props cuando existan lineas y datos suficientes; esta corrida usa lineas estimadas.'
      : 'Top-1 objetivo entre los mercados soportados disponibles para este juego, incluyendo props cuando existan lineas y datos suficientes.';
  }
  return estimated
    ? 'Objective top-1 across the supported markets available for this game, including props when enough lines and player data exist; this run uses estimated lines.'
    : 'Objective top-1 across the supported markets available for this game, including props when enough lines and player data exist.';
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

  const playerPropCandidates = [
    ...buildBatterPropCandidates({ gameData, features, lang }),
    ...buildPitcherPropCandidates({ features, lang }),
  ];

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
    ...playerPropCandidates,
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

  // Market-family diversity: alternatives should come from different families
  // than the top pick so the user sees genuinely different angles instead of
  // three variations of the same hits prop or both sides of the same total.
  const familyOf = (candidate) => {
    if (candidate?.market_type === 'moneyline' || candidate?.market_type === 'runline') return 'team-outcome';
    if (candidate?.market_type === 'overunder') return 'totals';
    if (candidate?.market_type === 'playerprop') return `prop-${candidate?.prop_kind ?? 'other'}`;
    return candidate?.market_type ?? 'other';
  };

  const topFamily = familyOf(topPick);
  const usedFamilies = new Set([topFamily]);
  const diversifiedAlternatives = [];
  for (const candidate of candidates.slice(1)) {
    if (diversifiedAlternatives.length >= 2) break;
    const family = familyOf(candidate);
    if (usedFamilies.has(family)) continue;
    usedFamilies.add(family);
    diversifiedAlternatives.push(candidate);
  }
  // Backfill up to two alternatives even if families repeat, but keep the
  // diversified ones first so the UX favors genuine variety.
  for (const candidate of candidates.slice(1)) {
    if (diversifiedAlternatives.length >= 2) break;
    if (!diversifiedAlternatives.includes(candidate)) {
      diversifiedAlternatives.push(candidate);
    }
  }

  const alternatives = diversifiedAlternatives.map((candidate) => ({
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

  // No-pick threshold: Safe Pick is a highest-hit-probability mode. If no
  // candidate clears 58%, there is no defensible safe pick for this game.
  const SAFE_PROBABILITY_THRESHOLD = 58;
  const belowThreshold = (topPick?.hit_probability ?? 0) < SAFE_PROBABILITY_THRESHOLD;

  const alertFlags = Array.isArray(llmData?.alert_flags) ? [...llmData.alert_flags] : [];
  const deterministicFlag = lang === 'es'
    ? 'Safe selector: ranking determinista de mercados soportados activo'
    : 'Safe selector: deterministic supported-market ranking active';
  if (!alertFlags.includes(deterministicFlag)) {
    alertFlags.push(deterministicFlag);
  }
  if (belowThreshold) {
    const thresholdFlag = lang === 'es'
      ? `Sin Safe Pick claro: ningun mercado supera ${SAFE_PROBABILITY_THRESHOLD}% de probabilidad`
      : `No clear Safe Pick: no market clears ${SAFE_PROBABILITY_THRESHOLD}% hit probability`;
    if (!alertFlags.includes(thresholdFlag)) {
      alertFlags.push(thresholdFlag);
    }
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
      value_tier: belowThreshold
        ? 'NO VALUE'
        : (topPick.edge != null
          ? (topPick.edge > 5 ? 'PLUS EV' : topPick.edge > 0 ? 'SMALL EDGE' : 'SAFE ONLY')
          : 'SAFE ONLY'),
      below_safe_threshold: belowThreshold,
      safe_threshold: SAFE_PROBABILITY_THRESHOLD,
    },
    probability_model: {
      home_wins: Math.round((mlProbabilities.home / 100) * 10000),
      away_wins: Math.round((mlProbabilities.away / 100) * 10000),
    },
    game_overview: gameOverview,
    alert_flags: alertFlags,
    model_risk: llmData?.model_risk ?? 'medium',
    top_signal: llmData?.top_signal ?? null,
    engine_meta: llmData?.engine_meta ?? null,
    engine_variants: Array.isArray(llmData?.engine_variants) ? llmData.engine_variants : null,
    selection_method: 'deterministic_supported_markets_v2',
    safe_scope: buildSafeScope({ oddsData, lang }),
  };
}
