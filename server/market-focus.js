function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeMarketFocus(value) {
  const text = normalizeText(value);
  if (!text || text === 'all' || text === 'general' || text === 'all types' || text === 'todos los tipos') {
    return 'all';
  }
  if (text === 'props' || text === 'player props' || text === 'player prop' || text === 'playerprops') {
    return 'playerprops';
  }
  if (text.includes('pitcher') && text.includes('prop')) {
    return 'pitcherprops';
  }
  if ((text.includes('batter') || text.includes('bateador')) && text.includes('prop')) {
    return 'batterprops';
  }
  if (text === 'moneyline') return 'moneyline';
  if (text === 'runline' || text === 'run line') return 'runline';
  if (text === 'totals' || text === 'total' || text === 'over under' || text === 'overunder') return 'totals';
  if (text === 'fade hits') return 'fade_hits';
  return text.replace(/\s+/g, '_');
}

export function marketFocusInstruction(value, { parlay = false } = {}) {
  const focus = normalizeMarketFocus(value);
  const target = parlay ? 'Every leg MUST be' : 'You MUST deliver your pick as';

  if (focus === 'playerprops') {
    return `${target} a PLAYER PROP. Evaluate all available player props from both families, including pitcher strikeouts and batter props such as hits, total bases, HR, RBI or stolen bases when data and lines are available. Choose the strongest player prop regardless of whether it belongs to a pitcher or a batter. Do not switch to moneyline, run line, or game total markets.`;
  }
  if (focus === 'pitcherprops') {
    return `${target} a PITCHER PROP, prioritizing strikeouts when lines and pitcher data are available. Do not switch to batter props, moneyline, run line, or game total markets.`;
  }
  if (focus === 'batterprops') {
    return `${target} a BATTER PROP, using hits, total bases, HR, RBI or stolen bases when data and lines are available. Do not switch to pitcher props, moneyline, run line, or game total markets.`;
  }
  if (focus === 'moneyline') return `${target} a MONEYLINE bet.`;
  if (focus === 'runline') return `${target} a RUN LINE bet.`;
  if (focus === 'totals') return `${target} an OVER/UNDER bet.`;
  return null;
}

export function candidateMatchesMarketFocus(candidate, value) {
  const focus = normalizeMarketFocus(value);
  if (focus === 'all' || focus === 'general') return true;
  if (focus === 'playerprops') return candidate?.market_type === 'playerprop' || candidate?.marketType === 'playerprop';
  if (focus === 'pitcherprops') {
    const propKind = candidate?.prop_kind ?? candidate?.propKind;
    const marketKey = candidate?.prop_market_key ?? candidate?.propMarketKey;
    return (candidate?.market_type === 'playerprop' || candidate?.marketType === 'playerprop') &&
      (propKind === 'strikeouts' || propKind === 'k' || String(marketKey ?? '').startsWith('pitcher_'));
  }
  if (focus === 'batterprops') {
    const propKind = candidate?.prop_kind ?? candidate?.propKind;
    const marketKey = candidate?.prop_market_key ?? candidate?.propMarketKey;
    return (candidate?.market_type === 'playerprop' || candidate?.marketType === 'playerprop') &&
      (propKind !== 'strikeouts' && propKind !== 'k') &&
      (String(marketKey ?? '').startsWith('batter_') || propKind != null);
  }
  if (focus === 'moneyline') return candidate?.market_type === 'moneyline' || candidate?.marketType === 'moneyline';
  if (focus === 'runline') return candidate?.market_type === 'runline' || candidate?.marketType === 'runline';
  if (focus === 'totals') return candidate?.market_type === 'overunder' || candidate?.marketType === 'overunder';
  return true;
}

export function filterCandidatesByMarketFocus(candidates, value) {
  const focus = normalizeMarketFocus(value);
  if (focus === 'all') return [...(candidates ?? [])];
  return (candidates ?? []).filter(candidate => candidateMatchesMarketFocus(candidate, focus));
}
