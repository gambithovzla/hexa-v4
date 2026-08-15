/**
 * nflLineProvenance.js — is the number in an NFL pick a line a book actually posted?
 *
 * The Oracle is forbidden from inventing PRICES (oracle-nfl-prompts.js:280), but
 * nothing ever constrained the LINE. A spread pick must carry a numeric line, so
 * when the MARKET ODDS block is missing — no odds for the slate, no name match,
 * or a preseason slate under a sport key we did not query — the model supplies
 * the number from its own read and it reaches the user looking exactly like a
 * quoted market line. A model-authored "-1.5" and a book's "-1.5" are
 * indistinguishable downstream: same text, same persistence, same resolver.
 *
 * This module answers that question explicitly, so the pick can be labelled
 * rather than silently trusted. Pure functions — no I/O, no throwing.
 */

/**
 * Half a point of drift between context build and output is normal book
 * movement. A full point is not: it crosses key numbers (3, 7) and is the
 * signature of a number that was reasoned rather than read.
 */
export const NFL_LINE_TOLERANCE = 0.5;

const SPREAD_TYPES = new Set(['spread', 'pointspread', 'spreads']);
const TOTAL_TYPES  = new Set(['total', 'totals', 'overunder', 'ou']);

function normalizeType(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

/** Which market a pick belongs to: 'spread' | 'total' | 'moneyline' | null. */
export function classifyNflMarket(betType, pickText = '') {
  const t = normalizeType(betType);
  if (SPREAD_TYPES.has(t)) return 'spread';
  if (TOTAL_TYPES.has(t)) return 'total';
  if (t === 'moneyline' || t === 'ml') return 'moneyline';

  const text = String(pickText ?? '').toLowerCase();
  if (/\b(over|under|o\/u)\b/.test(text)) return 'total';
  if (/[+-]\d+(\.\d+)?/.test(text)) return 'spread';
  if (/\bml\b|\bmoneyline\b/.test(text)) return 'moneyline';
  return null;
}

/**
 * The numeric line a pick claims. Spreads are returned as magnitude: home and
 * away spreads mirror each other, so |line| compares correctly without having
 * to resolve which side the text names.
 */
export function extractNflPickLine(text, market) {
  const s = String(text ?? '');
  if (market === 'total') {
    const m = s.match(/\b(?:over|under|o|u)\s*[:\s]?\s*(\d+(?:\.\d+)?)/i);
    return m ? Number(m[1]) : null;
  }
  if (market === 'spread') {
    // Skip American prices in parentheses — "(-110)" is not the line.
    const m = s.replace(/\([^)]*\)/g, '').match(/([+-]\d+(?:\.\d+)?)/);
    return m ? Math.abs(Number(m[1])) : null;
  }
  return null;
}

/** The market's own number for that market, or null when the block is absent. */
export function marketLineFor(marketOdds, market) {
  if (!marketOdds) return null;
  // Number(null) is 0, so an absent side has to be rejected before coercion —
  // otherwise an empty spread block reads as a real line of 0.
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  if (market === 'spread') {
    const home = num(marketOdds.spread?.home);
    if (home != null) return Math.abs(home);
    const away = num(marketOdds.spread?.away);
    return away != null ? Math.abs(away) : null;
  }
  if (market === 'total') return num(marketOdds.total?.line);
  return null;
}

/**
 * Classify a pick's line against the market it claims to quote.
 *
 * status:
 *   'not_applicable' — moneyline, or no line to check
 *   'verified'       — market line present and the pick matches it
 *   'unverified'     — no market line existed; the number is the model's own
 *   'mismatch'       — market line existed and the pick disagrees materially
 */
export function evaluateNflLineProvenance({ betType, pickText, detail, marketOdds } = {}) {
  const text = [detail, pickText].filter(Boolean).join(' ');
  const market = classifyNflMarket(betType, text);

  if (market == null || market === 'moneyline') {
    return { market, status: 'not_applicable', pickLine: null, marketLine: null, flag: null };
  }

  const pickLine = extractNflPickLine(text, market);
  if (pickLine == null) {
    return { market, status: 'not_applicable', pickLine: null, marketLine: null, flag: null };
  }

  const marketLine = marketLineFor(marketOdds, market);

  if (marketLine == null) {
    return {
      market,
      status: 'unverified',
      pickLine,
      marketLine: null,
      flag:
        `UNVERIFIED_LINE: the ${market} number ${pickLine} is the model's own — no market ` +
        `${market} was available for this game (MARKET ODDS not provided). It is not a quoted ` +
        `line; confirm the real number at your book before betting.`,
    };
  }

  const diff = Math.round(Math.abs(pickLine - marketLine) * 10) / 10;
  if (diff > NFL_LINE_TOLERANCE) {
    return {
      market,
      status: 'mismatch',
      pickLine,
      marketLine,
      flag:
        `LINE_MISMATCH: pick ${market} ${pickLine} vs market ${marketLine} (off by ${diff}). ` +
        `Bet the market number, not the pick's — and re-check which side of key numbers 3 and 7 it lands on.`,
    };
  }

  return { market, status: 'verified', pickLine, marketLine, flag: null };
}
