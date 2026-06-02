/**
 * tennisContextSerializer.js — pure serialisation of the tennis match context
 * into the deterministic text block the Oracle prompt consumes.
 *
 * Extracted from oracleTennis.js so it can be unit-tested without pulling in the
 * Anthropic SDK. No side effects, no I/O — given a context object (from
 * buildTennisMatchContext) plus optional marketOdds, returns a string.
 */

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return 'n/a';
  return Number(n).toFixed(digits);
}

function playerLabel(side, fallback) {
  const name = side?.playerName;
  if (name && name !== 'null') return String(name);
  return fallback;
}

function describeEloLine(side) {
  if (side?.eloSurface != null || side?.eloOverall != null) {
    const surf = side.eloSurface != null ? `surface ELO ${fmt(side.eloSurface)}` : 'surface ELO n/a';
    const overall = side.eloOverall != null ? ` | overall ELO ${fmt(side.eloOverall)}` : '';
    return `  ELO: ${surf}${overall}`;
  }
  return '  ELO: unavailable — using ranking + surface form as proxy';
}

function describeFormLine(side) {
  const f = side?.recentForm;
  if (!f) return '  Recent form: data unavailable';
  const surf = f.surfaceRecord ? ` | on surface ${f.surfaceRecord}` : '';
  const streak = f.recent ? ` [${f.recent}]` : '';
  return `  Recent form: ${f.record ?? 'n/a'}${streak}${surf}`;
}

function describePlayerBlock(label, side, fallback) {
  if (!side) return `${label}: data unavailable.`;
  return [
    `${label} — ${playerLabel(side, fallback)}${side.seed != null ? ` (seed ${side.seed})` : ''}`,
    `  Rank: ${side.rank ?? 'n/a'}${side.country ? ` | ${side.country}` : ''}`,
    describeEloLine(side),
    describeFormLine(side),
  ].join('\n');
}

function describeEloDelta(a, b, surface) {
  const ea = a?.eloSurface, eb = b?.eloSurface;
  if (ea == null || eb == null) return 'Surface-ELO gap: not computable (ELO unavailable this match).';
  const gap = Math.round(ea - eb);
  const fav = gap > 0 ? (a?.playerName ?? 'Player A') : (b?.playerName ?? 'Player B');
  return `Surface-ELO gap (${surface ?? 'surface n/a'}): ${fav} +${Math.abs(gap)} (A ${fmt(ea)} vs B ${fmt(eb)}).`;
}

function describeH2H(h2h, a, b) {
  if (!h2h || (h2h.aWins + h2h.bWins) === 0) return 'H2H: no matchup history in context.';
  const an = a?.playerName ?? 'Player A';
  const bn = b?.playerName ?? 'Player B';
  const surf = (h2h.aWinsSurface + h2h.bWinsSurface) > 0
    ? ` | on surface ${h2h.aWinsSurface}-${h2h.bWinsSurface}`
    : '';
  return `H2H: ${an} ${h2h.aWins}-${h2h.bWins} ${bn}${surf}.`;
}

function describeMatchHeader(context) {
  const parts = [`SURFACE: ${context.surface ?? 'unknown'}`];
  if (context.round) parts.push(`ROUND: ${context.round}`);
  if (context.bestOf) parts.push(`BEST OF: ${context.bestOf}`);
  return parts.join(' | ');
}

function describeMarketOdds(marketOdds) {
  if (!marketOdds) return 'MARKET ODDS: not provided.';
  const parts = ['MARKET ODDS (Match Winner + Set Handicap + Total Games):'];
  if (marketOdds.moneyline) {
    const ml = marketOdds.moneyline;
    const aImp = ml.aImplied != null ? ` (Implied: ${fmt(ml.aImplied, 1)}%)` : '';
    const bImp = ml.bImplied != null ? ` (Implied: ${fmt(ml.bImplied, 1)}%)` : '';
    parts.push(`  Match Winner A ${ml.a ?? 'n/a'}${aImp}`);
    parts.push(`  Match Winner B ${ml.b ?? 'n/a'}${bImp}`);
  }
  if (marketOdds.setHandicap && marketOdds.setHandicap.line != null) {
    const sh = marketOdds.setHandicap;
    parts.push(`  Set Handicap ${sh.line} — A ${sh.aPrice ?? 'n/a'} / B ${sh.bPrice ?? 'n/a'}`);
  }
  if (marketOdds.totalGames && marketOdds.totalGames.line != null) {
    const t = marketOdds.totalGames;
    const over  = t.overPrice  != null ? ` (Over ${t.overPrice})`  : '';
    const under = t.underPrice != null ? ` / Under ${t.underPrice}` : '';
    parts.push(`  Total Games ${t.line}${over}${under}`);
  }
  return parts.join('\n');
}

function describeDataQuality(context_meta) {
  if (!context_meta) return null;
  const flags = Array.isArray(context_meta.staleFlags) ? context_meta.staleFlags : [];
  if (!flags.length && context_meta.overallCompleteness === 1) return null;
  const pct = Math.round((context_meta.overallCompleteness ?? 0) * 100);
  const flagsLine = flags.length ? ` Flags: ${flags.join(', ')}.` : '';
  return `DATA QUALITY: completeness ${pct}%.${flagsLine}`;
}

/**
 * Serialise the tennis context into a deterministic text block.
 */
export function serializeTennisContext({ context, marketOdds }) {
  if (!context) return 'No tennis context provided.';
  const { tour, matchDate, surface, playerA, playerB, h2h, context_meta } = context;
  const dataQualityLine = describeDataQuality(context_meta);
  return [
    `H.E.X.A. TENNIS CONTEXT — ${matchDate} (${(tour ?? 'unknown').toUpperCase()})`,
    describeMatchHeader(context),
    '',
    describeEloDelta(playerA, playerB, surface),
    describeH2H(h2h, playerA, playerB),
    '',
    describePlayerBlock('PLAYER A', playerA, 'Player A'),
    '',
    describePlayerBlock('PLAYER B', playerB, 'Player B'),
    '',
    describeMarketOdds(marketOdds),
    ...(dataQualityLine ? ['', dataQualityLine] : []),
  ].join('\n');
}

export default { serializeTennisContext };
