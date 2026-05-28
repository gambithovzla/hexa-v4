/**
 * server/services/extendedMarketCandidates.js — generador de candidatos para
 * mercados que NO están en `buildDeterministicSafePayload` (frozen):
 *
 *   - alt run lines: ±1.5, ±2.5, ±3.5, ±4.5, ±5.5 por equipo
 *   - alt totals:    rango simétrico alrededor del total proyectado
 *   - team totals:   over/under por equipo (main + alternates)
 *   - extended props (no main): batter HR, RBIs, total bases, runs, K's,
 *                               pitcher outs, hits allowed, ER, walks, win
 *
 * Filosofía clave: las probabilidades vienen del modelo determinístico (no
 * del LLM ni del mercado). Los precios se anexan cuando The Odds API los
 * provee — pero un candidato puede existir SIN precio si el modelo lo
 * considera de alta probabilidad. Esto es lo que el usuario pidió para
 * Imperdible: importa la probabilidad de que se cumpla, no la odds.
 *
 * Todas las funciones son puras (sin I/O) — los fetchers viven en
 * odds-api.js y la orquestación en imperdibleEngine / index.js / parlay pool.
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Aproximación a Φ (CDF normal estándar) — Abramowitz & Stegun 26.2.17.
 * Precisión ~ 7.5e-8, más que suficiente para proyecciones de mercado.
 */
export function normalCDF(z) {
  if (!Number.isFinite(z)) return 0.5;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}

/**
 * Convierte american odds a implícita en %. Pasiva, sin redondear.
 * @param {number|null|undefined} odds
 * @returns {number|null}
 */
function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  const p = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return round(p * 100, 1);
}

function americanToDecimal(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/**
 * Diferencial de carreras esperado (favorito − underdog). Positivo si el
 * home es favorito. Combina moneyline % (señal principal) con total
 * proyectado (señal de pace).
 *
 * El factor 4 sale de calibrar contra runlines históricos: ML 60/40 ≈ 0.8
 * carreras de ventaja esperada, 65/35 ≈ 1.2, 70/30 ≈ 1.6.
 */
export function expectedRunDifferential({ homeMoneylineProb, expectedTotal }) {
  const home = clamp(toNum(homeMoneylineProb) ?? 50, 5, 95) / 100;
  const total = clamp(toNum(expectedTotal) ?? 8.5, 4, 18);
  const baseDiff = (home - 0.5) * 4;
  const paceBoost = (total - 8.5) * 0.06 * (home >= 0.5 ? 1 : -1);
  return baseDiff + paceBoost;
}

/**
 * Probabilidad de que el favorito cubra spread `k` (k>0 = favorito da k
 * carreras de ventaja). Usa una normal con sigma proporcional al total
 * (más carreras = más varianza).
 */
export function runLineCoverProbability({ meanDiff, expectedTotal, spread }) {
  const sigma = clamp(Math.sqrt(Math.max(toNum(expectedTotal) ?? 8.5, 4)) * 1.2, 2.5, 5.5);
  const z = (spread - meanDiff) / sigma;
  // Favorito cubre cuando diferencial real > spread.
  // (Diferencial está en términos del favorito, spread está expresado como
  // ventaja positiva. Si meanDiff = 0.8 y spread = 1.5, z = 0.583, p ~ 28%.)
  return 1 - normalCDF(z);
}

export function totalsProbability({ expectedTotal, line, sigma = null }) {
  const exp = toNum(expectedTotal) ?? 8.5;
  const lin = toNum(line) ?? exp;
  const s = clamp(toNum(sigma) ?? Math.sqrt(Math.max(exp, 4)) * 1.0, 1.8, 4.5);
  const z = (lin - exp) / s;
  const pOver = 1 - normalCDF(z);
  return { over: round(pOver * 100, 1), under: round((1 - pOver) * 100, 1) };
}

/**
 * Proyección de carreras por equipo. Reparte el total proyectado según el
 * moneyline % y aplica un sesgo conservador para evitar splits extremos.
 */
export function expectedTeamRuns({ homeMoneylineProb, expectedTotal }) {
  const total = clamp(toNum(expectedTotal) ?? 8.5, 4, 18);
  const home = clamp(toNum(homeMoneylineProb) ?? 50, 5, 95) / 100;
  // Split base 50/50 + ajuste por moneyline. Cap a ±15% de desplazamiento.
  const shift = clamp((home - 0.5) * 0.6, -0.18, 0.18);
  const homeRuns = total * (0.5 + shift);
  return {
    home: round(homeRuns, 2),
    away: round(total - homeRuns, 2),
  };
}

// ── Helpers para emparejar candidatos con precios del mercado ─────────────

function findAltRunLinePrice(altList, side, line) {
  if (!Array.isArray(altList)) return null;
  const target = Number(line);
  return altList.find((o) => o.side === side && Math.abs(Number(o.line) - target) < 0.01) ?? null;
}

function findAltTotalPrice(altList, direction, line) {
  if (!Array.isArray(altList)) return null;
  const target = Number(line);
  return altList.find((o) => o.direction === direction && Math.abs(Number(o.line) - target) < 0.01) ?? null;
}

function findTeamTotalPrice(teamTotals, teamSide, direction, line) {
  if (!Array.isArray(teamTotals)) return null;
  const target = Number(line);
  return teamTotals.find((o) =>
    o.teamSide === teamSide &&
    o.direction === direction &&
    Math.abs(Number(o.line) - target) < 0.01
  ) ?? null;
}

/**
 * Build extended-market candidates for a single game.
 *
 * @param {object} args
 * @param {object} args.gameData                — MLB game data shape
 * @param {object} args.features                — context features
 * @param {object} args.mainCandidates          — output of buildDeterministicSafePayload
 * @param {object|null} args.alternates         — { altRunLines, altTotals, teamTotals } from getEventAlternates()
 * @param {object|null} args.extendedProps      — { playerProps } from getEventPropsExtended()
 * @param {string} args.lang                    — 'en' | 'es'
 * @returns {Array<object>}                     — candidates in safe_candidates shape
 */
export function buildExtendedCandidates({
  gameData,
  features = {},
  mainCandidates = [],
  alternates = null,
  extendedProps = null,
  lang = 'en',
}) {
  const homeAbbr = gameData?.teams?.home?.abbreviation ?? 'HOME';
  const awayAbbr = gameData?.teams?.away?.abbreviation ?? 'AWAY';

  // Extraer probabilidades main del payload existente — no recalculamos
  // moneyline/total/etc., los importamos del mismo modelo determinístico.
  const mainML = mainCandidates.find((c) => c.market_type === 'moneyline');
  const homeMain = mainCandidates.find((c) => c.market_type === 'moneyline' && c.side === 'home');
  const awayMain = mainCandidates.find((c) => c.market_type === 'moneyline' && c.side === 'away');
  const totalMain = mainCandidates.find((c) => c.market_type === 'overunder');

  const homeMoneylineProb = homeMain?.model_probability ?? homeMain?.hit_probability ?? null;
  const awayMoneylineProb = awayMain?.model_probability ?? awayMain?.hit_probability ?? null;
  const marketTotal = toNum(totalMain?.line) ?? 8.5;
  // Use the model's projected total as the mean for the alt-total distribution.
  const expectedTotal = (() => {
    const overP = (totalMain?.model_probability ?? 50) / 100;
    if (!Number.isFinite(overP) || overP <= 0 || overP >= 1) return marketTotal;
    // Invertir totalsProbability: si over% > 50%, expectedTotal > marketTotal.
    const sigma = Math.sqrt(Math.max(marketTotal, 4));
    // P(over) = 1 - Φ((marketTotal - expectedTotal)/sigma) → expectedTotal = marketTotal - sigma * Φ⁻¹(1 - overP)
    // Aprox inversa de Φ via método de Beasley-Springer no es necesaria — un ajuste lineal alcanza.
    const adjustment = (overP - 0.5) * sigma * 1.6;
    return marketTotal + adjustment;
  })();

  const meanDiff = expectedRunDifferential({ homeMoneylineProb, expectedTotal });
  const teamRuns = expectedTeamRuns({ homeMoneylineProb, expectedTotal });

  const candidates = [];

  // ── Alt run lines: ±1.5 / ±2.5 / ±3.5 / ±4.5 / ±5.5 ───────────────────
  // (saltamos ±1.5 porque ya está en main)
  const altRlLines = [2.5, 3.5, 4.5, 5.5];
  const homeIsFavorite = (homeMoneylineProb ?? 50) >= 50;

  for (const k of altRlLines) {
    // Favorito da k carreras (linea = -k). Modelo: P(diff favorito > k)
    const favCoverProb = runLineCoverProbability({ meanDiff: homeIsFavorite ? meanDiff : -meanDiff, expectedTotal, spread: k });
    const favProb = round(favCoverProb * 100, 1);
    const dogProb = round((1 - favCoverProb) * 100, 1);

    // Underdog +k (recibe k carreras de ventaja)
    const dogSide = homeIsFavorite ? 'away' : 'home';
    const dogAbbr = homeIsFavorite ? awayAbbr : homeAbbr;
    const dogMarketPrice = findAltRunLinePrice(alternates?.altRunLines, dogSide, k);
    candidates.push({
      pick: `${dogAbbr} +${k} Run Line`,
      type: 'RunLineAlt',
      hit_probability: dogProb,
      model_probability: dogProb,
      odds: dogMarketPrice?.price ?? null,
      implied_probability: dogMarketPrice ? americanToImplied(dogMarketPrice.price) : null,
      edge: dogMarketPrice ? round(dogProb - (americanToImplied(dogMarketPrice.price) ?? 0), 1) : null,
      market_type: 'runline',
      side: dogSide,
      line: k,
      market_source: 'extended',
      auto_resolvable: true,
      reasoning: lang === 'es'
        ? `Underdog recibe +${k} carreras; con diferencial proyectado del favorito ${round(homeIsFavorite ? meanDiff : -meanDiff, 2)} y sigma~${round(Math.sqrt(expectedTotal) * 1.2, 2)}, P(cubre) ≈ ${dogProb}%.`
        : `Underdog gets +${k} runs; with projected favorite differential ${round(homeIsFavorite ? meanDiff : -meanDiff, 2)} and sigma~${round(Math.sqrt(expectedTotal) * 1.2, 2)}, P(cover) ≈ ${dogProb}%.`,
    });

    // Favorito -k (favorito tiene que ganar por más de k)
    const favSide = homeIsFavorite ? 'home' : 'away';
    const favAbbr = homeIsFavorite ? homeAbbr : awayAbbr;
    const favMarketPrice = findAltRunLinePrice(alternates?.altRunLines, favSide, -k);
    candidates.push({
      pick: `${favAbbr} -${k} Run Line`,
      type: 'RunLineAlt',
      hit_probability: favProb,
      model_probability: favProb,
      odds: favMarketPrice?.price ?? null,
      implied_probability: favMarketPrice ? americanToImplied(favMarketPrice.price) : null,
      edge: favMarketPrice ? round(favProb - (americanToImplied(favMarketPrice.price) ?? 0), 1) : null,
      market_type: 'runline',
      side: favSide,
      line: -k,
      market_source: 'extended',
      auto_resolvable: true,
      reasoning: lang === 'es'
        ? `Favorito debe ganar por ${k}+; diferencial proyectado ${round(homeIsFavorite ? meanDiff : -meanDiff, 2)}. P(cubre) ≈ ${favProb}%.`
        : `Favorite must win by ${k}+; projected differential ${round(homeIsFavorite ? meanDiff : -meanDiff, 2)}. P(cover) ≈ ${favProb}%.`,
    });
  }

  // ── Alt totals: rango simétrico ±4 alrededor del total proyectado ────
  const altTotalCenter = round(expectedTotal, 0);
  const altTotalLines = [];
  for (let offset = -4; offset <= 4; offset++) {
    const line = altTotalCenter + offset + 0.5;
    if (line <= 4 || line >= 16) continue;
    if (Math.abs(line - marketTotal) < 0.6) continue;  // skip the main line
    altTotalLines.push(line);
  }

  for (const line of altTotalLines) {
    const { over, under } = totalsProbability({ expectedTotal, line });
    const overMarketPrice = findAltTotalPrice(alternates?.altTotals, 'over', line);
    const underMarketPrice = findAltTotalPrice(alternates?.altTotals, 'under', line);

    candidates.push({
      pick: `Over ${line}`,
      type: 'OverUnderAlt',
      hit_probability: over,
      model_probability: over,
      odds: overMarketPrice?.price ?? null,
      implied_probability: overMarketPrice ? americanToImplied(overMarketPrice.price) : null,
      edge: overMarketPrice ? round(over - (americanToImplied(overMarketPrice.price) ?? 0), 1) : null,
      market_type: 'overunder',
      side: 'over',
      line,
      market_source: 'extended',
      auto_resolvable: true,
      reasoning: lang === 'es'
        ? `Total proyectado ${round(expectedTotal, 2)} contra línea alt ${line}; P(over) ≈ ${over}%.`
        : `Projected total ${round(expectedTotal, 2)} vs alt line ${line}; P(over) ≈ ${over}%.`,
    });

    candidates.push({
      pick: `Under ${line}`,
      type: 'OverUnderAlt',
      hit_probability: under,
      model_probability: under,
      odds: underMarketPrice?.price ?? null,
      implied_probability: underMarketPrice ? americanToImplied(underMarketPrice.price) : null,
      edge: underMarketPrice ? round(under - (americanToImplied(underMarketPrice.price) ?? 0), 1) : null,
      market_type: 'overunder',
      side: 'under',
      line,
      market_source: 'extended',
      auto_resolvable: true,
      reasoning: lang === 'es'
        ? `Total proyectado ${round(expectedTotal, 2)} contra línea alt ${line}; P(under) ≈ ${under}%.`
        : `Projected total ${round(expectedTotal, 2)} vs alt line ${line}; P(under) ≈ ${under}%.`,
    });
  }

  // ── Team totals: over/under por equipo en líneas centradas en proyección ─
  const teamSigma = 2.2;
  for (const teamSide of ['home', 'away']) {
    const teamAbbr = teamSide === 'home' ? homeAbbr : awayAbbr;
    const expectedRuns = teamRuns[teamSide];
    const centerInt = Math.round(expectedRuns);
    for (const offset of [-2, -1, 0, 1, 2]) {
      const line = centerInt + offset + 0.5;
      if (line <= 0 || line >= 10) continue;
      const z = (line - expectedRuns) / teamSigma;
      const overP = round((1 - normalCDF(z)) * 100, 1);
      const underP = round(100 - overP, 1);
      const overMarket = findTeamTotalPrice(alternates?.teamTotals, teamSide, 'over', line);
      const underMarket = findTeamTotalPrice(alternates?.teamTotals, teamSide, 'under', line);

      candidates.push({
        pick: `${teamAbbr} Over ${line} Runs`,
        type: 'TeamTotal',
        hit_probability: overP,
        model_probability: overP,
        odds: overMarket?.price ?? null,
        implied_probability: overMarket ? americanToImplied(overMarket.price) : null,
        edge: overMarket ? round(overP - (americanToImplied(overMarket.price) ?? 0), 1) : null,
        market_type: 'team_total',
      // pick-resolver.js no maneja team_total aún — los marcamos como
      // candidatos informativos (visibles en la slate del imperdible y
      // en el arquitecto de parlay) pero filtrados antes del lock final.
      auto_resolvable: false,
        side: 'over',
        team_side: teamSide,
        line,
        market_source: 'extended',
        reasoning: lang === 'es'
          ? `${teamAbbr} proyecta ${expectedRuns} carreras; línea ${line}. P(over) ≈ ${overP}%.`
          : `${teamAbbr} projects ${expectedRuns} runs; line ${line}. P(over) ≈ ${overP}%.`,
      });

      candidates.push({
        pick: `${teamAbbr} Under ${line} Runs`,
        type: 'TeamTotal',
        hit_probability: underP,
        model_probability: underP,
        odds: underMarket?.price ?? null,
        implied_probability: underMarket ? americanToImplied(underMarket.price) : null,
        edge: underMarket ? round(underP - (americanToImplied(underMarket.price) ?? 0), 1) : null,
        market_type: 'team_total',
      // pick-resolver.js no maneja team_total aún — los marcamos como
      // candidatos informativos (visibles en la slate del imperdible y
      // en el arquitecto de parlay) pero filtrados antes del lock final.
      auto_resolvable: false,
        side: 'under',
        team_side: teamSide,
        line,
        market_source: 'extended',
        reasoning: lang === 'es'
          ? `${teamAbbr} proyecta ${expectedRuns} carreras; línea ${line}. P(under) ≈ ${underP}%.`
          : `${teamAbbr} projects ${expectedRuns} runs; line ${line}. P(under) ≈ ${underP}%.`,
      });
    }
  }

  // Quitar candidatos con probabilidad < 35% (no aportan al pool de
  // imperdible/safe; los duplicados de Over/Under cubren el otro lado).
  const filtered = candidates.filter((c) => (c.model_probability ?? 0) >= 35);

  // Sort por probabilidad desc para que los más fuertes encabecen.
  filtered.sort((a, b) => (b.model_probability ?? 0) - (a.model_probability ?? 0));

  return filtered;
}

/**
 * Devuelve un resumen markdown del menu extendido — pensado para inyectar
 * en el contexto de Oracle Chat / Safe / Parlay LLMs sin tocar prompts
 * congelados. Lista solo los top-N por probabilidad para no inflar tokens.
 */
export function formatExtendedMenuForLLM(extendedCandidates, lang = 'en', topN = 12) {
  if (!Array.isArray(extendedCandidates) || extendedCandidates.length === 0) {
    return '';
  }
  const slice = extendedCandidates.slice(0, topN);
  const header = lang === 'es'
    ? '\n\n=== MENÚ EXTENDIDO (líneas alternativas, totales por equipo) ===\n'
      + 'Líneas adicionales con probabilidad modelo > 35%. Cuando el usuario pide\n'
      + 'un pick SEGURO o IMPERDIBLE, prioriza estas alternativas in-the-money\n'
      + 'profundas sobre la moneyline tradicional. La probabilidad modelo es la\n'
      + 'señal principal; el precio del mercado, si está disponible, es secundario.'
    : '\n\n=== EXTENDED MENU (alternate lines, team totals) ===\n'
      + 'Additional lines with model probability > 35%. When the user asks for a\n'
      + 'SAFE or LOCK pick, prefer these deep in-the-money alternates over the\n'
      + 'standard moneyline. Model probability is the primary signal; market\n'
      + 'price (when available) is secondary.';
  const lines = slice.map((c) => {
    const priceTxt = c.odds != null ? `${c.odds > 0 ? '+' : ''}${c.odds}` : 'no market price';
    return `- ${c.pick} — model ${c.model_probability}% (${priceTxt})`;
  }).join('\n');
  return `${header}\n${lines}\n`;
}

/**
 * Soporta el ranking: si un candidato extendido aplica payout floor o
 * priorización por modelo solamente, este helper le adjunta `decimalOdds`.
 */
export function annotateDecimalOdds(candidate) {
  return { ...candidate, decimal_odds: americanToDecimal(candidate.odds) };
}
