/**
 * server/services/xgboostValidator.js
 *
 * Validador de ensamble tipo XGBoost para el Oracle H.E.X.A. V4.
 *
 * Exporta:
 *   calculateParallelScore(statcastData, mlbApiData)
 *     — Simula un modelo de ensamble con métricas clave de Statcast y devuelve
 *       { score: 0-100, predicted_winner: 'team_id', confidence: 0-100 }
 */

// ---------------------------------------------------------------------------
// Constantes del modelo simulado
// ---------------------------------------------------------------------------

// Pesos para cada feature del modelo (suma = 1.0)
const FEATURE_WEIGHTS = {
  pitcher_xwOBA:     0.30,   // xwOBA_against es el predictor más fuerte
  pitcher_whiff:     0.20,   // Whiff% — capacidad de ponchar
  pitcher_activeSpin: 0.10,  // Active spin — movimiento del pitcheo
  lineup_xwOBA:      0.25,   // Calidad de la ofensiva
  recent_form:       0.15,   // Rolling wOBA últimos 7 días
};

// Thresholds de calibración del modelo
const THRESHOLDS = {
  elite_pitcher_xwOBA:   0.290,
  weak_pitcher_xwOBA:    0.360,
  high_whiff:            30.0,
  low_whiff:             20.0,
  elite_spin:            95.0,
  elite_batter_xwOBA:    0.370,
  weak_batter_xwOBA:     0.280,
  hot_form_threshold:    0.400,
  cold_form_threshold:   0.250,
};

// ---------------------------------------------------------------------------
// Helpers de normalización
// ---------------------------------------------------------------------------

/**
 * Normaliza xwOBA del pitcher a un score de calidad del lanzador (0-1).
 * xwOBA_against bajo = lanzador dominante = score alto.
 * Rango realista: [0.240, 0.420]
 */
function normalizePitcherXwOBA(xwOBA) {
  if (xwOBA == null || isNaN(xwOBA)) return 0.5;
  const clamped = Math.max(0.240, Math.min(0.420, xwOBA));
  // Invertir: menor xwOBA_against → mayor score
  return 1 - (clamped - 0.240) / (0.420 - 0.240);
}

/**
 * Normaliza Whiff% a score de dominio (0-1).
 * Rango realista: [10, 45]
 */
function normalizeWhiff(whiffPct) {
  if (whiffPct == null || isNaN(whiffPct)) return 0.5;
  const clamped = Math.max(10, Math.min(45, whiffPct));
  return (clamped - 10) / (45 - 10);
}

/**
 * Normaliza active_spin_pct a score de movimiento (0-1).
 * Rango realista: [80, 100]
 */
function normalizeActiveSpin(spinPct) {
  if (spinPct == null || isNaN(spinPct)) return 0.5;
  const clamped = Math.max(80, Math.min(100, spinPct));
  return (clamped - 80) / (100 - 80);
}

/**
 * Normaliza xwOBA de la alineación (promedio) a score ofensivo (0-1).
 * xwOBA alto de la ofensiva = score alto para ese equipo.
 * Rango realista: [0.260, 0.400]
 */
function normalizeLineupXwOBA(xwOBA) {
  if (xwOBA == null || isNaN(xwOBA)) return 0.5;
  const clamped = Math.max(0.260, Math.min(0.400, xwOBA));
  return (clamped - 0.260) / (0.400 - 0.260);
}

/**
 * Normaliza el rolling wOBA (7d) como señal de forma reciente (0-1).
 * Rango realista: [0.200, 0.450]
 */
function normalizeRecentForm(woba7d) {
  if (woba7d == null || isNaN(woba7d)) return 0.5;
  const clamped = Math.max(0.200, Math.min(0.450, woba7d));
  return (clamped - 0.200) / (0.450 - 0.200);
}

// ---------------------------------------------------------------------------
// Motor de scoring por equipo
// ---------------------------------------------------------------------------

/**
 * Calcula el raw score (0-1) para UN equipo dado que ataca al lanzador rival
 * y defiende con su propio pitcher.
 *
 * @param {object} ownPitcher    — métricas del pitcher de este equipo
 * @param {object} rivalLineup   — ofensiva del equipo rival (ataca a ownPitcher)
 * @param {object} ownLineup     — ofensiva propia (ataca al pitcher rival)
 * @param {object} rivalPitcher  — métricas del pitcher rival
 * @returns {number} score 0-1
 */
function computeTeamRawScore(ownPitcher, rivalLineup, ownLineup, rivalPitcher) {
  // --- Score defensivo: qué tan bien el pitcher propio suprime al rival ---
  const pitcherQuality     = normalizePitcherXwOBA(ownPitcher?.xwOBA_against);
  const pitcherWhiff       = normalizeWhiff(ownPitcher?.whiff_percent);
  const pitcherSpin        = normalizeActiveSpin(ownPitcher?.active_spin_pct);

  // La ofensiva RIVAL ataca al pitcher propio: menor xwOBA_against del pitcher =
  // más difícil de atacar → ventaja para el equipo que lanza
  const rivalOffenseScore  = normalizeLineupXwOBA(rivalLineup?.avg_xwOBA);
  const rivalFormScore     = normalizeRecentForm(rivalLineup?.avg_woba_7d);

  // Score defensivo: pitcher fuerte (alto) contra ofensiva rival (baja = ventaja)
  const defensiveRaw =
    FEATURE_WEIGHTS.pitcher_xwOBA * pitcherQuality +
    FEATURE_WEIGHTS.pitcher_whiff  * pitcherWhiff  +
    FEATURE_WEIGHTS.pitcher_activeSpin * pitcherSpin;

  // Penalización si la ofensiva rival es élite
  const rivalThreathPenalty = rivalOffenseScore > 0.7 ? 0.05 : 0;
  const recentFormRivalPenalty = rivalFormScore > 0.75 ? 0.03 : 0;

  const defensiveScore =
    defensiveRaw - rivalThreathPenalty - recentFormRivalPenalty;

  // --- Score ofensivo: qué tan bien la ofensiva propia ataca al pitcher rival ---
  const ownOffenseScore  = normalizeLineupXwOBA(ownLineup?.avg_xwOBA);
  const ownFormScore     = normalizeRecentForm(ownLineup?.avg_woba_7d);
  const rivalPitcherStr  = normalizePitcherXwOBA(rivalPitcher?.xwOBA_against);

  // Ofensiva score = lineup calidad + forma reciente, penalizada por pitcher rival fuerte
  const offensiveRaw =
    FEATURE_WEIGHTS.lineup_xwOBA  * ownOffenseScore  +
    FEATURE_WEIGHTS.recent_form   * ownFormScore;

  // Si el pitcher rival es élite (alto normalizado = bajo xwOBA = difícil atacar)
  const pitcherPenalty = rivalPitcherStr > 0.7 ? 0.04 : 0;

  const offensiveScore = offensiveRaw - pitcherPenalty;

  // Score final del equipo: combinación de rol defensivo y ofensivo
  const rawScore = defensiveScore + offensiveScore;

  return Math.max(0, Math.min(1, rawScore));
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

/**
 * Simula un modelo de ensamble XGBoost para predecir el ganador de un partido.
 *
 * @param {object|null} statcastData
 *   {
 *     homePitcher: {
 *       xwOBA_against: number,
 *       whiff_percent:  number,
 *       active_spin_pct: number,
 *       rolling_windows_against: { woba_against_7d: number }
 *     },
 *     awayPitcher: { … mismo esquema … },
 *     homeLineup: { avg_xwOBA: number, avg_woba_7d: number },
 *     awayLineup: { avg_xwOBA: number, avg_woba_7d: number },
 *   }
 *
 * @param {object|null} mlbApiData
 *   {
 *     teams: {
 *       home: { id: number|string, abbreviation: string },
 *       away: { id: number|string, abbreviation: string },
 *     }
 *   }
 *
 * @returns {{ score: number, predicted_winner: string, confidence: number }}
 *   score           — 0-100, representando la ventaja del equipo local
 *   predicted_winner — team id (string) del equipo predicho como ganador
 *   confidence      — 0-100, nivel de certeza del modelo
 */
export function calculateParallelScore(statcastData, mlbApiData) {
  // IDs de los equipos
  const homeId = String(mlbApiData?.teams?.home?.id ?? 'home');
  const awayId = String(mlbApiData?.teams?.away?.id ?? 'away');
  const homeAbbr = mlbApiData?.teams?.home?.abbreviation ?? 'HOME';
  const awayAbbr = mlbApiData?.teams?.away?.abbreviation ?? 'AWAY';

  // Extraer datos de statcast con defaults seguros
  const homePitcher = statcastData?.homePitcher ?? {};
  const awayPitcher = statcastData?.awayPitcher ?? {};
  const homeLineup  = statcastData?.homeLineup  ?? {};
  const awayLineup  = statcastData?.awayLineup  ?? {};

  // Enriquecer objeto pitcher con rolling window (alias de conveniencia)
  const homePitcherEnriched = {
    ...homePitcher,
    xwOBA_against:   homePitcher.xwOBA_against,
    whiff_percent:    homePitcher.whiff_percent,
    active_spin_pct:  homePitcher.active_spin_pct,
  };
  const awayPitcherEnriched = {
    ...awayPitcher,
    xwOBA_against:   awayPitcher.xwOBA_against,
    whiff_percent:    awayPitcher.whiff_percent,
    active_spin_pct:  awayPitcher.active_spin_pct,
  };

  // Calcular score bruto para cada equipo
  const homeRaw = computeTeamRawScore(
    homePitcherEnriched,  // pitcher local defiende vs ofensiva rival
    awayLineup,           // ofensiva rival ataca al pitcher local
    homeLineup,           // ofensiva local ataca al pitcher rival
    awayPitcherEnriched,  // pitcher rival defiende contra la ofensiva local
  );

  const awayRaw = computeTeamRawScore(
    awayPitcherEnriched,
    homeLineup,
    awayLineup,
    homePitcherEnriched,
  );

  // Aplicar ventaja de campo local (+3 puntos porcentuales, efecto moderado)
  const HOME_FIELD_BOOST = 0.03;
  const homeScore = homeRaw + HOME_FIELD_BOOST;
  const awayScore = awayRaw;

  // Normalizar a escala 0-100 (el score final representa la ventaja del local)
  const total = homeScore + awayScore;
  const homeScoreNorm = total > 0 ? (homeScore / total) * 100 : 50;

  // Determinar ganador predicho
  const homeWins       = homeScoreNorm >= 50;
  const predictedWinnerId   = homeWins ? homeId   : awayId;
  const predictedWinnerAbbr = homeWins ? homeAbbr : awayAbbr;

  // Calcular confianza: cuanto mayor la diferencia de scores, más confianza
  // Diferencia máxima esperada ≈ 15 puntos → mapear a 50-80% confianza
  const scoreDiff   = Math.abs(homeScoreNorm - 50);
  const rawConf     = 50 + Math.min(scoreDiff * 2.0, 30);
  const confidence  = Math.round(Math.min(80, Math.max(50, rawConf)));

  const score = Math.round(Math.min(100, Math.max(0, homeScoreNorm)));

  console.log(
    `[xgboostValidator] ${homeAbbr} vs ${awayAbbr} → ` +
    `homeScore=${homeScoreNorm.toFixed(1)} | winner=${predictedWinnerAbbr} | conf=${confidence}`
  );

  return {
    score,
    predicted_winner: predictedWinnerId,
    predicted_winner_abbr: predictedWinnerAbbr,
    confidence,
  };
}
