import { parsePick } from '../parsers/pickParser.js';
import {
  buildMLFeaturePayload,
  buildPropMLFeaturePayload,
  isEnabled as isMlSidecarEnabled,
  predictMoneyline,
  predictOverUnder,
  predictProp,
  predictRunLine,
} from './mlModelClient.js';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampProb(value) {
  const n = toNumber(value);
  if (n == null) return null;
  if (n > 1) return Math.min(1, n / 100);
  return Math.max(0, Math.min(1, n));
}

function extractPickText(analysisData) {
  return (
    analysisData?.master_prediction?.pick ??
    analysisData?.best_pick?.pick ??
    analysisData?.safe_pick?.pick ??
    null
  );
}

function extractOraclePickProb(analysisData) {
  const fromMaster = clampProb(analysisData?.master_prediction?.oracle_confidence);
  if (fromMaster != null) return fromMaster;
  const fromBest = clampProb(analysisData?.best_pick?.hit_probability);
  if (fromBest != null) return fromBest;
  const fromSafe = clampProb(analysisData?.safe_pick?.hit_probability);
  if (fromSafe != null) return fromSafe;
  return null;
}

function deriveOracleHomeWinProb(analysisData) {
  const homeWins = toNumber(analysisData?.probability_model?.home_wins);
  const awayWins = toNumber(analysisData?.probability_model?.away_wins);
  if (homeWins == null || awayWins == null) return null;
  const total = homeWins + awayWins;
  if (total <= 0) return null;
  return homeWins / total;
}

function inferSideFromProb(marketType, prob, parsedSide) {
  if (prob == null) return parsedSide ?? null;
  const p = prob >= 0.5;
  if (marketType === 'overunder' || marketType === 'prop') {
    return p ? 'over' : 'under';
  }
  if (marketType === 'moneyline' || marketType === 'runline') {
    return p ? 'home' : 'away';
  }
  return parsedSide ?? null;
}

function sidesAgree(a, b) {
  if (!a || !b) return null;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function formatSideLabel(side, marketType, line) {
  if (!side) return '—';
  const s = String(side).toLowerCase();
  if (marketType === 'overunder' || marketType === 'prop') {
    const dir = s === 'over' ? 'Over' : 'Under';
    return line != null ? `${dir} ${line}` : dir;
  }
  if (marketType === 'runline' && line != null) {
    return `${s === 'home' ? 'Home' : 'Away'} ${line > 0 ? `+${line}` : line}`;
  }
  return s === 'home' ? 'Home ML' : s === 'away' ? 'Away ML' : s.toUpperCase();
}

function formatProbLabel(sideLabel, prob) {
  if (prob == null) return sideLabel;
  return `${sideLabel} (${(prob * 100).toFixed(0)}%)`;
}

function buildFeaturePayloadForMarket({ marketType, parsed, statcastData, features }) {
  const base = buildMLFeaturePayload(statcastData, features);
  if (marketType === 'prop') {
    return buildPropMLFeaturePayload({
      ...base,
      line: parsed.line,
      side: parsed.side,
    });
  }
  if (marketType === 'overunder' && parsed.line != null) {
    return { ...base, line: parsed.line };
  }
  return base;
}

async function predictPythonForMarket(marketType, parsed, statcastData, features, { admin = false } = {}) {
  if (!isMlSidecarEnabled()) {
    return { prediction: null, status: 'disabled', market: null };
  }

  const payload = buildFeaturePayloadForMarket({ marketType, parsed, statcastData, features });
  const opts = { admin };

  let prediction = null;
  let market = marketType;

  if (marketType === 'moneyline') {
    prediction = await predictMoneyline(payload, opts);
    market = 'moneyline';
  } else if (marketType === 'overunder') {
    prediction = await predictOverUnder(payload, opts);
    market = 'overunder';
  } else if (marketType === 'runline') {
    prediction = await predictRunLine(payload, opts);
    market = 'runline';
  } else if (marketType === 'prop' && parsed.prop_kind) {
    prediction = await predictProp(parsed.prop_kind, payload, opts);
    market = `prop_${parsed.prop_kind}`;
  } else {
    return { prediction: null, status: 'unsupported_market', market: marketType };
  }

  if (!prediction) {
    return { prediction: null, status: 'unavailable', market };
  }

  return { prediction, status: 'ok', market: prediction.market ?? market };
}

function buildLegacyOpinion(marketType, xgboostResult, gameData, parsed) {
  if (marketType !== 'moneyline' || !xgboostResult) {
    return {
      prob: null,
      side: null,
      label: 'N/A (solo moneyline)',
      available: false,
      agree: null,
    };
  }

  const homeId = String(gameData?.teams?.home?.id ?? '');
  const legacyProb = clampProb(xgboostResult.score);
  const legacySide = xgboostResult.predicted_winner != null
    ? (String(xgboostResult.predicted_winner) === homeId ? 'home' : 'away')
    : (legacyProb != null ? (legacyProb >= 0.5 ? 'home' : 'away') : null);

  const sideLabel = formatSideLabel(legacySide, 'moneyline', null);
  return {
    prob: legacyProb,
    side: legacySide,
    label: formatProbLabel(sideLabel, legacyProb),
    available: true,
    agree: null,
  };
}

export async function buildPickAlignedMlOpinion({
  analysisData,
  gameData,
  statcastData = null,
  features = {},
  xgboostResult = null,
  admin = false,
} = {}) {
  const pickText = extractPickText(analysisData);
  const homeAbbr = gameData?.teams?.home?.abbreviation ?? null;
  const awayAbbr = gameData?.teams?.away?.abbreviation ?? null;
  const parsed = parsePick(pickText, { homeAbbr, awayAbbr });
  const marketType = parsed.market_type ?? 'moneyline';

  const oracleProb = extractOraclePickProb(analysisData);
  const oracleSide = parsed.side ?? (marketType === 'moneyline' || marketType === 'runline'
    ? inferSideFromProb(marketType, oracleProb, null)
    : parsed.side);

  const legacy = buildLegacyOpinion(marketType, xgboostResult, gameData, parsed);
  legacy.agree = sidesAgree(oracleSide, legacy.side);

  const pythonRun = await predictPythonForMarket(
    marketType,
    parsed,
    statcastData,
    features,
    { admin },
  );
  const pythonProb = clampProb(pythonRun.prediction?.probability);
  const pythonSide = inferSideFromProb(marketType, pythonProb, parsed.side);
  const pythonSideLabel = formatSideLabel(pythonSide, marketType, parsed.line);

  const oracleSideLabel = formatSideLabel(oracleSide, marketType, parsed.line);

  const mlOpinion = {
    pickText,
    market_type: marketType,
    side: oracleSide,
    line: parsed.line,
    prop_kind: parsed.prop_kind,
    oracle: {
      prob: oracleProb,
      side: oracleSide,
      label: formatProbLabel(oracleSideLabel, oracleProb),
    },
    legacy: {
      prob: legacy.prob,
      side: legacy.side,
      label: legacy.label,
      available: legacy.available,
    },
    python: {
      prob: pythonProb,
      side: pythonSide,
      market: pythonRun.market,
      model_version: pythonRun.prediction?.model_version ?? null,
      status: pythonRun.status,
      label: pythonProb != null
        ? formatProbLabel(pythonSideLabel, pythonProb)
        : (pythonRun.status === 'disabled' ? 'Sidecar deshabilitado' : 'No disponible'),
    },
    agree: {
      legacy: legacy.agree,
      python: sidesAgree(oracleSide, pythonSide),
    },
    gameMl: {
      oracle_home_win_prob: deriveOracleHomeWinProb(analysisData),
      legacy_home_win_prob: legacy.prob,
      python_home_win_prob: marketType === 'moneyline' ? pythonProb : null,
    },
  };

  const shadowFields = {
    pick_market_type: marketType,
    pick_side: oracleSide,
    pick_line: parsed.line,
    prop_kind: parsed.prop_kind,
    oracle_pick_prob: oracleProb,
    legacy_pick_prob: legacy.prob,
    python_pick_prob: pythonProb,
    python_pick_market: pythonRun.market,
    pick_agree_legacy: legacy.agree,
    pick_agree_python: mlOpinion.agree.python,
    python_model_score: pythonProb,
    python_model_version: pythonRun.prediction?.model_version ?? null,
    python_model_status: pythonRun.status,
  };

  return { mlOpinion, shadowFields };
}

export function buildPickAlignedMlOpinionSyncFields(mlOpinion, shadowFields) {
  return shadowFields ?? null;
}
