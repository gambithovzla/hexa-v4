/**
 * pickLineDisplay.js
 *
 * When an Over/Under pick has no sportsbook line (odds weren't available), the
 * Oracle emits a bare "Over/Under (Total de Carreras)" with no number. The
 * server attaches a display-only projected total (value_breakdown.projected_total)
 * so we can show the user a reference figure. This helper renders that into a
 * clean label like "Under 8.7 (proy.)".
 *
 * It NEVER fabricates a line when one is already present, and leaves any
 * non-over/under pick untouched.
 */

const BARE_OU_RE = /^\s*(over|under|bajo|alto|más de|mas de|menos de)\b/i;

function isUnderSide(raw) {
  return /under|bajo|menos/i.test(raw);
}

/**
 * @param {string} pickText        — raw pick label (e.g. "Under (Total de Carreras)")
 * @param {number|null} projectedTotal — display-only model projection
 * @param {{ lang?: string }} [opts]
 * @returns {string} the original text, or "Under 8.7 (proy.)" when applicable
 */
export function applyProjectedLine(pickText, projectedTotal, { lang = 'es' } = {}) {
  if (!pickText) return pickText;
  if (projectedTotal == null) return pickText;
  const total = Number(projectedTotal);
  if (!Number.isFinite(total) || total <= 0) return pickText;

  const text = String(pickText);
  const sideMatch = text.match(BARE_OU_RE);
  if (!sideMatch) return pickText;        // not an over/under
  if (/\d/.test(text)) return pickText;   // already has a numeric line

  const side = isUnderSide(sideMatch[1]) ? 'Under' : 'Over';
  const tag = lang === 'en' ? 'proj.' : 'proy.';
  return `${side} ${total} (${tag})`;
}

/**
 * Convenience for components that hold the full pick/history data object.
 * Reads the projected total from value_breakdown (or a top-level field).
 */
export function pickLabelWithProjection(pickText, data, opts = {}) {
  const projected =
    data?.value_breakdown?.projected_total ??
    data?.projected_total ??
    null;
  return applyProjectedLine(pickText, projected, opts);
}
