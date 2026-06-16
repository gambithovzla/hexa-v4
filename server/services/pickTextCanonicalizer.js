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

function formatFromParsed(parsed, originalCore, ctx = {}) {
  if (!parsed?.market_type) return null;

  if (parsed.market_type === 'prop') {
    const label = PROP_KIND_LABEL[parsed.prop_kind];
    const player = parsed.prop_player_name;
    if (!label || !player || parsed.line == null || !parsed.side) return null;
    return `${player} ${formatSideLabel(parsed.side)} ${parsed.line} ${label}`;
  }

  if (parsed.market_type === 'overunder') {
    // The Oracle sometimes emits a bare "Over"/"Under" with no number. The line
    // is the market total at pick time, supplied via ctx.marketTotal — backfill
    // it so the pick is shown in full, auto-resolves, and is kept in over/under
    // training (the loader drops rows with a null line).
    const line = parsed.line ?? ctx.marketTotal ?? null;
    if (line == null || !parsed.side) return null;
    return `${formatSideLabel(parsed.side)} ${line}`;
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
  const formatted = formatFromParsed(parsed, core, ctx);
  if (formatted) {
    return suffix ? `${formatted}${suffix}` : formatted;
  }

  const fallback = applySpanishTokenFallback(core);
  if (fallback !== core && parseResolverPick(fallback)) {
    return suffix ? `${fallback}${suffix}` : fallback;
  }

  return trimmed;
}

export function canonicalizeAnalysisDataPicks(data, gameData = null, extraCtx = {}) {
  if (!data || typeof data !== 'object') return data;

  const ctx = {
    homeAbbr: gameData?.teams?.home?.abbreviation ?? gameData?.teams?.home?.team?.abbreviation ?? null,
    awayAbbr: gameData?.teams?.away?.abbreviation ?? gameData?.teams?.away?.team?.abbreviation ?? null,
    marketTotal: extraCtx.marketTotal ?? null,
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

  // When master_prediction.pick is a bare Over/Under without a line number
  // (e.g. "Under (Total de Carreras)") but best_pick.detail has one
  // (e.g. "Under 8.5 (-110)"), inject the line so the display title shows it.
  // This happens when the LLM omits the number in mp.pick and marketTotal is null.
  if (masterPrediction?.pick && bestPick?.detail) {
    const mpPick = masterPrediction.pick;
    const isOverUnder = /^(over|under)\b/i.test(mpPick.trim());
    const hasLine = /\d/.test(mpPick);
    if (isOverUnder && !hasLine) {
      const lineMatch = bestPick.detail.match(/(\d+(?:\.\d+)?)/);
      if (lineMatch) {
        masterPrediction.pick = mpPick.replace(/^(over|under)/i, `$1 ${lineMatch[1]}`);
      }
    }
  }

  return {
    ...data,
    ...(masterPrediction ? { master_prediction: masterPrediction } : {}),
    ...(bestPick ? { best_pick: bestPick } : {}),
  };
}
