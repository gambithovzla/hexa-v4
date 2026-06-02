/**
 * tennis-resolution.js — pure tennis pick resolution logic.
 *
 * Extracted from pick-resolver-tennis.js so it can be unit-tested without
 * pulling in db.js (and therefore `pg`). No I/O, no side effects: given a pick
 * text and a normalized match (from getTennisMatchesForDate), returns the
 * outcome. Mirrors the tennisContextSerializer extraction pattern.
 *
 * Markets:
 *   - Match Winner  — picked player must win the match.
 *   - Set Handicap (±1.5 sets) — adjusted set margin vs the line (half-point,
 *     never a push). "-1.5 sets" needs a 2+ set margin (2-0 in Bo3, 3-0/3-1 Bo5).
 *   - Total Games  — sum of all games across all sets vs the line.
 *
 * Retirement / walkover (match.isVoidStatus) → 'void' (no action), excluded
 * from every ROI/equity/win-rate aggregation by virtue of not being a
 * win/loss/push value.
 */

export function words(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/,/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 1);
}

export function overlap(pickWords, name) {
  const wn = new Set(words(name));
  return pickWords.filter(w => wn.has(w)).length;
}

/** Which player ('a'|'b') the pick text names. Null if neither/both match. */
export function pickedSide(pickText, match) {
  const pw = words(pickText);
  if (!pw.length) return null;
  const a = overlap(pw, match?.players?.a?.name ?? '');
  const b = overlap(pw, match?.players?.b?.name ?? '');
  if (a === 0 && b === 0) return null;
  if (a === b) return null; // ambiguous
  return a > b ? 'a' : 'b';
}

function sumGames(player) {
  const arr = Array.isArray(player?.gamesPerSet) ? player.gamesPerSet : [];
  const nums = arr.filter(v => v != null && Number.isFinite(Number(v))).map(Number);
  return nums.length ? nums.reduce((s, v) => s + v, 0) : null;
}

/**
 * Resolve a single tennis pick against a finished match.
 * @param {string} pickText  e.g. "Carlos Alcaraz to win", "Swiatek -1.5 sets", "Over 22.5 games"
 * @param {object} match     normalized match from getTennisMatchesForDate
 * @returns {{ result: 'win'|'loss'|'push'|'void'|null, market: string }}
 */
export function resolveTennisPick(pickText, match) {
  if (!match) return { result: null, market: 'unknown' };

  // Retirement / walkover / abandoned → void (no action), regardless of market.
  if (match.isVoidStatus) return { result: 'void', market: 'void' };

  const text = String(pickText ?? '').toLowerCase();

  // ── Total Games (over/under) ──────────────────────────────────────────────
  const totalMatch = text.match(/\b(over|under)\b[^0-9]*([0-9]+(?:\.[0-9]+)?)/);
  if (totalMatch) {
    const side = totalMatch[1];
    const line = Number(totalMatch[2]);
    const ga = sumGames(match.players?.a);
    const gb = sumGames(match.players?.b);
    if (ga == null || gb == null) return { result: null, market: 'total_games' };
    const total = ga + gb;
    if (total === line) return { result: 'push', market: 'total_games' };
    const isOver = total > line;
    const win = (side === 'over') ? isOver : !isOver;
    return { result: win ? 'win' : 'loss', market: 'total_games' };
  }

  // ── Set Handicap (±1.5 sets) ──────────────────────────────────────────────
  const handicapMatch = text.match(/([+-]\s?[0-9]+(?:\.[0-9]+)?)\s*set/);
  if (handicapMatch || /\bset handicap\b/.test(text)) {
    const side = pickedSide(pickText, match);
    if (!side) return { result: null, market: 'set_handicap' };
    const setsA = Number(match.players?.a?.setsWon);
    const setsB = Number(match.players?.b?.setsWon);
    if (!Number.isFinite(setsA) || !Number.isFinite(setsB)) return { result: null, market: 'set_handicap' };
    const h = handicapMatch ? Number(handicapMatch[1].replace(/\s/g, '')) : -1.5;
    const pickedSets = side === 'a' ? setsA : setsB;
    const oppSets    = side === 'a' ? setsB : setsA;
    const adjusted = pickedSets + h;
    if (adjusted === oppSets) return { result: 'push', market: 'set_handicap' };
    return { result: adjusted > oppSets ? 'win' : 'loss', market: 'set_handicap' };
  }

  // ── Match Winner (default) ────────────────────────────────────────────────
  const side = pickedSide(pickText, match);
  if (!side) return { result: null, market: 'match_winner' };
  if (!match.winner) return { result: null, market: 'match_winner' };
  return { result: side === match.winner ? 'win' : 'loss', market: 'match_winner' };
}

export default { resolveTennisPick, pickedSide, words, overlap };
