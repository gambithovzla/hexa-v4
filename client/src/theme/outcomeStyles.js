export function normalizeOutcomeResult(result) {
  const value = String(result ?? 'pending').toLowerCase();
  if (value === 'won' || value === 'win') return 'win';
  if (value === 'lost' || value === 'loss') return 'loss';
  if (value === 'push') return 'push';
  return value;
}

export function getOutcomePalette(palette = {}) {
  return {
    win: palette.outcomeWin ?? palette.green,
    winDim: palette.outcomeWinDim ?? palette.greenDim,
    winLine: palette.outcomeWinLine ?? palette.greenLine,
    loss: palette.outcomeLoss ?? palette.red ?? palette.pink,
    lossDim: palette.outcomeLossDim ?? palette.redDim ?? palette.pinkDim,
    lossLine: palette.outcomeLossLine ?? palette.redLine ?? palette.pinkLine,
    push: palette.outcomePush ?? palette.cyan,
    pushDim: palette.outcomePushDim ?? palette.cyanDim,
    pushLine: palette.outcomePushLine ?? palette.cyanLine,
    pending: palette.amber,
    pendingDim: palette.amberDim,
    pendingLine: palette.amberLine,
    border: palette.border,
  };
}

export function outcomeTextColor(palette, result) {
  const o = getOutcomePalette(palette);
  const normalized = normalizeOutcomeResult(result);
  if (normalized === 'win') return o.win;
  if (normalized === 'loss') return o.loss;
  if (normalized === 'push') return o.push;
  return palette.textMuted ?? palette.textDim;
}

export function outcomeBorderColor(palette, result) {
  const o = getOutcomePalette(palette);
  const normalized = normalizeOutcomeResult(result);
  if (normalized === 'win') return o.win;
  if (normalized === 'loss') return o.loss;
  if (normalized === 'push') return o.push;
  return o.border;
}

export function outcomeBadgeSx(palette, result, { isLeague = false } = {}) {
  const o = getOutcomePalette(palette);
  const normalized = normalizeOutcomeResult(result);
  const base = {
    fontWeight: isLeague ? 700 : 600,
    letterSpacing: isLeague ? '0.12em' : '2px',
  };
  if (normalized === 'win') {
    return { ...base, bgcolor: o.winDim, border: `1px solid ${o.winLine}`, color: o.win };
  }
  if (normalized === 'loss') {
    return { ...base, bgcolor: o.lossDim, border: `1px solid ${o.lossLine}`, color: o.loss };
  }
  if (normalized === 'push') {
    return { ...base, bgcolor: o.pushDim, border: `1px solid ${o.pushLine}`, color: o.push };
  }
  return { ...base, bgcolor: o.pendingDim, border: `1px solid ${o.pendingLine}`, color: o.pending };
}

export function outcomeCardBorderSx(palette, result, { isLeague = false } = {}) {
  return {
    borderLeft: `${isLeague ? 4 : 2}px solid ${outcomeBorderColor(palette, result)}`,
  };
}

export function outcomeBadgeClassName(result) {
  const normalized = normalizeOutcomeResult(result);
  if (normalized === 'win' || normalized === 'loss' || normalized === 'push') {
    return `hexa-outcome-badge hexa-outcome-badge--${normalized}`;
  }
  return 'hexa-outcome-badge hexa-outcome-badge--pending';
}
