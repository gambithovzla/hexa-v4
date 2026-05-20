import { parsePick as parseTrainingPick } from '../parsers/pickParser.js';
import { parsePick as parseResolverPick } from '../pick-resolver.js';

const SPANISH_PICK_TOKENS = /\b(bajo|alto|ponches|jonrones|menos de|más de|mas de|bases totales|arriba|abajo)\b/i;

const PROP_KIND_LABEL = {
  hits: 'Hits',
  total_bases: 'Total Bases',
  home_runs: 'Home Runs',
  strikeouts: 'Strikeouts',
  rbis: 'RBIs',
  stolen_bases: 'Stolen Bases',
  walks: 'Walks',
  outs_recorded: 'Outs Recorded',
  singles: 'Singles',
  doubles: 'Doubles',
};

function splitOddsSuffix(text) {
  const trimmed = String(text ?? '').trim();
  const match = trimmed.match(/^(.+?)((?:\s*\([^)]*\))+)\s*$/);
  if (!match) return { core: trimmed, suffix: '' };
  return { core: match[1].trim(), suffix: match[2] };
}

function formatSideLabel(side) {
  return side === 'under' ? 'Under' : 'Over';
}

function formatFromParsed(parsed, originalCore) {
  if (!parsed?.market_type) return null;

  if (parsed.market_type === 'prop') {
    const label = PROP_KIND_LABEL[parsed.prop_kind];
    const player = parsed.prop_player_name;
    if (!label || !player || parsed.line == null || !parsed.side) return null;
    return `${player} ${formatSideLabel(parsed.side)} ${parsed.line} ${label}`;
  }

  if (parsed.market_type === 'overunder') {
    if (parsed.line == null || !parsed.side) return null;
    return `${formatSideLabel(parsed.side)} ${parsed.line}`;
  }

  if (parsed.market_type === 'moneyline' || parsed.market_type === 'runline') {
    return originalCore;
  }

  return null;
}

function applySpanishTokenFallback(core) {
  return core
    .replace(/\bBajo\b/gi, 'Under')
    .replace(/\bAlto\b/gi, 'Over')
    .replace(/\bPonches\b/gi, 'Strikeouts')
    .replace(/\bJonrones\b/gi, 'Home Runs')
    .replace(/\bBases totales\b/gi, 'Total Bases');
}

/**
 * Normalizes Oracle / user pick text to strings parseable by pick-resolver.
 * Preserves trailing American-odds parenthetical groups.
 */
export function canonicalizePickTextForResolver(text, ctx = {}) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return trimmed;

  const { core, suffix } = splitOddsSuffix(trimmed);
  const needsSpanishNormalization = SPANISH_PICK_TOKENS.test(core);

  if (!needsSpanishNormalization && parseResolverPick(core)) {
    return suffix ? `${core}${suffix}` : trimmed;
  }

  const parsed = parseTrainingPick(core, ctx);
  const formatted = formatFromParsed(parsed, core);
  if (formatted) {
    return suffix ? `${formatted}${suffix}` : formatted;
  }

  const fallback = applySpanishTokenFallback(core);
  if (fallback !== core && parseResolverPick(fallback)) {
    return suffix ? `${fallback}${suffix}` : fallback;
  }

  return trimmed;
}

export function canonicalizeAnalysisDataPicks(data, gameData = null) {
  if (!data || typeof data !== 'object') return data;

  const ctx = {
    homeAbbr: gameData?.teams?.home?.abbreviation ?? gameData?.teams?.home?.team?.abbreviation ?? null,
    awayAbbr: gameData?.teams?.away?.abbreviation ?? gameData?.teams?.away?.team?.abbreviation ?? null,
  };

  const masterPrediction = data.master_prediction && typeof data.master_prediction === 'object'
    ? { ...data.master_prediction }
    : null;
  const bestPick = data.best_pick && typeof data.best_pick === 'object'
    ? { ...data.best_pick }
    : null;

  if (masterPrediction?.pick) {
    masterPrediction.pick = canonicalizePickTextForResolver(masterPrediction.pick, ctx);
  }
  if (bestPick?.detail) {
    bestPick.detail = canonicalizePickTextForResolver(bestPick.detail, ctx);
  }

  return {
    ...data,
    ...(masterPrediction ? { master_prediction: masterPrediction } : {}),
    ...(bestPick ? { best_pick: bestPick } : {}),
  };
}
