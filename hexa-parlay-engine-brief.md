# H.E.X.A. Parlay Synergy Engine — Brief de Implementación para Claude Code

> **Objetivo:** Crear un motor de parlays nuevo y paralelo al sistema actual de HEXA v4 que construya parlays correlacionados, con ortogonalidad de riesgo y coherencia de "game script", sin tocar una sola línea de la lógica existente de `single`, `deep`, `safe` ni `premium`.

> **Repo:** `https://github.com/gambithovzla/hexa-v4` — este brief asume que trabajas en la rama `main`, creando todo el código nuevo en una feature branch `feat/parlay-synergy-engine`.

---

## Tabla de contenido

1. [TL;DR](#1-tldr)
2. [Diagnóstico del sistema actual](#2-diagnóstico-del-sistema-actual)
3. [Principios de diseño destilados](#3-principios-de-diseño-destilados-5-expertos)
4. [Restricciones duras — qué NO tocar](#4-restricciones-duras--qué-no-tocar)
5. [Arquitectura propuesta](#5-arquitectura-propuesta)
6. [Recursos existentes a reutilizar](#6-recursos-existentes-a-reutilizar)
7. [Fases de implementación](#7-fases-de-implementación)
8. [Especificación detallada por módulo](#8-especificación-detallada-por-módulo)
9. [Endpoints nuevos](#9-endpoints-nuevos)
10. [Base de datos — migraciones nuevas](#10-base-de-datos--migraciones-nuevas)
11. [Frontend — integración mínima](#11-frontend--integración-mínima)
12. [Observabilidad, backtesting y guardrails](#12-observabilidad-backtesting-y-guardrails)
13. [Criterios de aceptación](#13-criterios-de-aceptación-por-fase)
14. [Apéndice A — Prompts del LLM](#14-apéndice-a--prompts-del-llm)
15. [Apéndice B — Esquemas de datos](#15-apéndice-b--esquemas-de-datos)

---

## 1. TL;DR

El endpoint actual `POST /api/analyze/parlay` es una caja negra: concatena contextos de N partidos, se los pasa al LLM y le pide "construye un parlay de N patas". No hay scoring, ni correlación, ni ortogonalidad de riesgo, ni penalización por longitud.

Los 5 expertos consultados coinciden:

- **NO** apilar los top-N picks individuales. Es el error más común y matemáticamente destructivo.
- La "sinergia" real vive en tres ejes:
  1. **Correlación positiva** (same-game-parlay o narrativa cross-game) — A y B ocurren juntos más de lo que el book cotiza.
  2. **Ortogonalidad de riesgo** — A y B fallan por razones diferentes, nunca mueren juntos.
  3. **Coherencia de game script** — todas las patas cuentan la misma historia (noche de pitchers, día de bullpens quemados, clima ventoso, etc.).
- Adaptar la estrategia al N pedido: 3 patas ≠ 5 patas ≠ 7+ patas.
- El LLM debe ser **arquitecto/validador**, no selector ciego desde cero.
- Scoring a nivel de **parlay completo**, no de pick individual.

**Lo que vamos a construir:** un motor nuevo, `server/services/parlayEngine/`, que:

1. Genera un **pool de candidatos enriquecidos** por juego, reutilizando `buildDeterministicSafePayload` (que ya da edge, implied probability, hit_probability por mercado).
2. Enriquece cada candidato con un **vector de riesgo** (5-7 dimensiones) y etiquetas de **game_script**.
3. Calcula una **matriz de correlación/ortogonalidad** entre todos los pares candidatos.
4. Resuelve una **optimización combinatoria** (greedy + local search) que maximiza EV ajustado por sinergia y minimiza correlación de riesgo, dado N.
5. Envía 3 combinaciones candidatas al LLM como **arquitecto validador** con prompt nuevo (no se toca `oracle.js`).
6. Devuelve el parlay ganador + 2 alternativas + explicación de sinergia + warnings si N≥6.

**Nuevo endpoint:** `POST /api/analyze/parlay-synergy` (admin-only al inicio, con feature flag).

---

## 2. Diagnóstico del sistema actual

### 2.1 Flujo actual de `/api/analyze/parlay`

**Archivo:** `server/index.js:845-935`

```
1. Usuario manda gameIds (hasta 10)
2. Server llama a getTodayGames + getGameOdds
3. Para cada gameId: buildContext(gameData, odds) → {context, _features}
4. Concatena los N contexts con "\n\n---\n\n"
5. Llama a analyzeParlay(contexts, lang, opts)
6. analyzeParlay → analyzeGame({mode: 'parlay', ...})
7. buildUserMessage construye:
   "Build N-leg parlay from: [Game 1, Game 2, ...]
    Risk: medium
    CONTEXT: {concatenated contexts}"
8. LLM devuelve: {parlay: {legs: [...], combined_confidence, risk_level, strategy_note}}
9. Server responde con data + legOdds + engineMeta
```

**Archivo del prompt:** `server/oracle.js:301-314` (modo `parlay` en `buildUserMessage`).

### 2.2 Lo que NO hace hoy

- No calcula edge individual por pata (aunque podría, `buildDeterministicSafePayload` ya lo tiene por juego).
- No detecta correlación entre patas.
- No penaliza por exceso de legs.
- No valida que el "game script" sea coherente.
- No ofrece modos (conservative/balanced/aggressive).
- No usa `calculateParallelScore` (XGBoost validator) para validar cada pata.
- No retorna alternativas ni métricas de sinergia.
- No explica por qué las patas elegidas tienen sinergia (el LLM puede improvisar una explicación, pero no hay un score cuantitativo que la respalde).

### 2.3 Por qué esto importa

Los usuarios con parlays de 5-7-10+ patas ("parlays soñadores") queman bankroll a velocidad industrial porque:

- Cada pata añade ~4-5% de juice de la casa → 5 patas ≈ 20-25% de juice efectivo.
- Si dos patas tienen correlación negativa oculta (ej. equipo A ML + under en el total, cuando A es favorito fuerte), ambas mueren juntas.
- Si 3 patas dependen de la misma variable (ej. tres overs en días ventosos), no son 3 eventos independientes: es 1 con apalancamiento.

---

## 3. Principios de diseño destilados (5 expertos)

| # | Principio | Fuente (experto) |
|---|-----------|------------------|
| 1 | No seleccionar top-N por edge individual — optimizar a nivel de parlay | Todos |
| 2 | Buscar **ortogonalidad de riesgo** (fallan por razones distintas) | Experto 1, 5 |
| 3 | Explotar **correlación positiva** que el book subprecia (SGP o narrativa cross-game) | Experto 3, 4 |
| 4 | Mantener un **game script coherente** entre patas (pitcher's duel, slugfest, wind-out, etc.) | Experto 4 |
| 5 | Adaptar estrategia al N: corto (2-3) = correlación, medio (4-5) = híbrido, largo (6+) = máxima estabilidad + warning | Experto 2, 3, 4 |
| 6 | LLM como arquitecto/validador, no selector ciego | Experto 1, 5 |
| 7 | Penalizar parlays largos sin edge suficiente (varianza exponencial) | Experto 2 |
| 8 | Modos explícitos: Conservative / Balanced / Aggressive | Experto 2 |
| 9 | Filtros no-go: correlación negativa detectada, contradicción de game script, exceso de mismo juego | Experto 4 |
| 10 | Integrar shadow model (XGBoost) para calibración de probabilidades por pata | Experto 5 |

---

## 4. Restricciones duras — qué NO tocar

El objetivo explícito del usuario es **no romper** los flujos actuales. Estos archivos/funciones están congelados:

### 🚫 NO MODIFICAR

- `server/oracle.js` — todas las funciones existentes: `analyzeGame`, `analyzeParlay`, `analyzeSafe`, `analyzeChat`, `analyzeChatJornada`, `analyzeFullDay`, `summarizeGameBrief`, `buildUserMessage`. El prompt de parlay actual (líneas 301-314) **NO** se toca.
- `server/market-intelligence.js` — NO cambiar la firma ni el comportamiento de `buildDeterministicSafePayload` ni de `buildValueBreakdown`. Solo se pueden **llamar** desde código nuevo.
- `server/services/xgboostValidator.js` — `calculateParallelScore` queda intacta. Se **consume** desde el nuevo motor, no se modifica.
- `server/shadow-model.js` — intacto.
- `server/context-builder.js` — `buildContext` intacto. Se llama igual que hoy.
- `POST /api/analyze/game`, `POST /api/analyze/parlay` (el viejo), `POST /api/analyze/safe` — siguen funcionando exactamente igual.
- Todas las columnas actuales de tablas Postgres existentes — no se alteran.
- Frontend: los flujos de single, deep, safe, premium y el parlay viejo siguen operativos sin cambios.

### ✅ SE PUEDE

- Crear archivos nuevos en `server/services/parlayEngine/` (carpeta nueva).
- Añadir endpoint nuevo en `server/index.js` (función nueva, registrada como otra ruta).
- Crear migraciones nuevas en `server/migrate.js` (solo `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS` sobre tablas nuevas, nunca sobre las existentes).
- Añadir prompt nuevo en `server/services/parlayEngine/prompts.js` (archivo nuevo).
- Crear página nueva en `client/src/pages/ParlayArchitect.jsx` o similar.
- Añadir endpoint de admin/observabilidad nuevo.

---

## 5. Arquitectura propuesta

```
┌────────────────────────────────────────────────────────────────────┐
│  POST /api/analyze/parlay-synergy  (endpoint NUEVO)                │
│  Body: { gameIds[], requestedLegs, mode, minEdge, minConfidence,   │
│          allowSGP, lang, engine }                                   │
└────────────────────────┬───────────────────────────────────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ 1. Candidate Pool Builder    │   ← reutiliza buildContext +
          │    parlayEngine/pool.js      │     buildDeterministicSafePayload
          │                              │     + calculateParallelScore
          │ Para cada gameId:            │
          │  - buildContext(gameData)    │
          │  - buildDeterministicSafe…   │ → hit_prob, edge, implied_prob
          │  - calculateParallelScore    │ → xgb_score, xgb_confidence
          │  - expand to N candidates    │   por juego (ML x2, RL x2, O/U x2, props)
          │                              │
          │ Output: ParlayCandidate[]    │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ 2. Risk Vector Enricher      │   ← nuevo, determinístico
          │    parlayEngine/risk.js      │
          │                              │
          │ Para cada candidato:         │
          │  riskVector = {              │
          │    pitching_dominance,       │
          │    bullpen_exposure,         │
          │    weather_exposure,         │
          │    lineup_variance,          │
          │    umpire_sensitivity,       │
          │    ballpark_bias,            │
          │    chalk_vs_dog              │
          │  }                           │
          │  gameScript = 'pitchers_duel'│
          │             | 'slugfest'     │
          │             | 'wind_out'     │
          │             | 'bullpen_fade' │
          │             | 'neutral'      │
          │  failureMode = '...'         │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ 3. Correlation Matrix        │   ← nuevo, reglas heurísticas
          │    parlayEngine/correl.js    │     (opcionalmente con datos históricos)
          │                              │
          │ Para cada par (A, B):        │
          │  corr(A, B) ∈ [-1, +1]       │
          │  - same game + same side → + │
          │  - same game + opposite → −  │
          │  - cross game + same script →│
          │    +0.2..+0.4                │
          │  - cross game + opposite    →│
          │    -0.2..-0.4                │
          │ risk_distance(A,B) =         │
          │  euclidean(riskVecA, riskVecB)│
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ 4. Composer (Optimizer)      │   ← nuevo, combinatorial
          │    parlayEngine/composer.js  │
          │                              │
          │ Dado N, mode, candidatos:    │
          │  - filtrar por minEdge/conf  │
          │  - aplicar reglas no-go      │
          │    (negative corr, etc.)     │
          │  - generar 3 combinaciones  │
          │    top candidatas vía greedy │
          │    + 2-opt local search      │
          │  - score cada combinación:   │
          │    score = Σ(edge_i × w_conf_i)│
          │          + α·Σ corr_positiva │
          │          + β·Σ risk_distance │
          │          − γ·penalty_length  │
          │          − δ·penalty_neg_corr│
          │  - retornar top-3            │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ 5. LLM Architect (Validator) │   ← llamada nueva a Claude/Grok
          │    parlayEngine/architect.js │     usando Anthropic SDK existente
          │                              │     + prompt nuevo (NO toca oracle.js)
          │ Prompt:                      │
          │  - Pool completo de candidatos│
          │  - Top 3 combinaciones del   │
          │    composer con sus scores   │
          │  - Pide: validar sinergia,   │
          │    detectar correlaciones    │
          │    ocultas, confirmar o      │
          │    proponer ajustes          │
          │                              │
          │ Output JSON:                 │
          │  {                           │
          │    chosen_parlay,            │
          │    alternatives,             │
          │    synergy_thesis,           │
          │    hidden_correlations,      │
          │    combined_ev,              │
          │    combined_probability,     │
          │    warnings                  │
          │  }                           │
          └──────────────┬───────────────┘
                         │
          ┌──────────────▼──────────────┐
          │ 6. Response Assembler        │
          │    + persistencia opcional   │
          └──────────────────────────────┘
```

### 5.1 Modos de operación

| Modo | N recomendado | Prioridad | Descripción |
|------|---------------|-----------|-------------|
| `conservative` | 2–3 | Floor alto, EV compuesto | Busca correlación positiva fuerte (SGP o narrativa). Rechaza patas con model_risk=high. minEdge=3%. |
| `balanced` | 4–5 | EV + diversificación | Mezcla cluster correlacionado de 2-3 patas + satélites ortogonales. minEdge=2%. |
| `aggressive` | 6–10+ | Alta varianza controlada | Solo picks con xgb_confidence ≥ 65%, obliga a un cluster correlacionado + warning visible de varianza. minEdge=2%. |
| `dreamer` | 11–30 | "Parlays soñadores" | Solo para usuarios que lo piden explícitamente. Aplica el filtro de "máxima estabilidad": solo favoritos fuertes, pitchers élite confirmados, sin juegos en Coors/GABP/wind-out. Warning grande. minEdge=1.5%. |

---

## 6. Recursos existentes a reutilizar

**NO reescribas. Solo importa y usa.**

### 6.1 Pool de candidatos por juego — ya existe

**Archivo:** `server/market-intelligence.js`

```js
import { buildDeterministicSafePayload } from '../../market-intelligence.js';

const safePayload = buildDeterministicSafePayload({
  gameData,
  features,         // viene de buildContext → _features
  oddsData,
  xgboostResult,    // de calculateParallelScore
  lang,
  llmData: null,    // no lo necesitamos para parlay
});

// safePayload.safe_candidates → array completo de candidatos con:
//   pick, type, hit_probability, odds, market_type, side,
//   model_probability, implied_probability, edge, rank, reasoning
```

Esto ya incluye ML home/away, RL home/away, Over/Under y player props (hits) filtrados por probabilidad > 55%. Es nuestra materia prima.

### 6.2 XGBoost validator — ya existe

**Archivo:** `server/services/xgboostValidator.js`

```js
import { calculateParallelScore } from './xgboostValidator.js';

const xgb = calculateParallelScore(statcastData, gameData);
// → { score, predicted_winner, predicted_winner_abbr, confidence }
```

Usalo para validar la probabilidad del ganador que estima el LLM de `buildDeterministicSafePayload`, y para detectar divergencias grandes (→ reducir confianza de esa pata).

### 6.3 Context builder — ya existe

**Archivo:** `server/context-builder.js`

```js
import { buildContext } from '../../context-builder.js';

const { context, _features } = await buildContext(gameData, oddsData);
// _features: homePitcher, awayPitcher, homePitcherSavant, awayPitcherSavant,
//            homeHitting, awayHitting, savantBatters, batterSplitsMap,
//            parkFactorData, weatherData, dataQuality, signalCoherence, oddsData
```

Tiene caché de 10 min — llamarlo en loop para los N juegos es barato si ya fue analizado hoy.

### 6.4 Odds & games — ya existen

```js
import { getTodayGames } from '../../mlb-api.js';
import { getGameOdds, matchOddsToGame } from '../../odds-api.js';
```

### 6.5 LLM client — ya existe (NO toca oracle.js)

El SDK de Anthropic ya está instanciado en `oracle.js`. Para evitar tocar ese archivo, haz tu propia instancia en `parlayEngine/llmClient.js`:

```js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function callArchitect({ systemPrompt, userPrompt, model, timeoutMs }) {
  // implementación minimal, no toca nada de oracle.js
}
```

Si en el futuro se decide consolidar, es fácil.

### 6.6 Shadow model runner — ya existe (opcional)

**Archivo:** `server/shadow-model.js` — función `recordShadowModelRun`.

Para el parlay synergy, al persistir, guardar también una entrada sombra por parlay para trackear performance vs el modelo viejo.

---

## 7. Fases de implementación

Cada fase es un PR separado y merge-able. Claude Code debe implementarlas en este orden.

### Fase 0 — Setup (1 PR, mínimo riesgo)

- Crear rama `feat/parlay-synergy-engine`.
- Crear directorio `server/services/parlayEngine/`.
- Añadir `server/services/parlayEngine/index.js` (barrel export).
- Añadir feature flag `PARLAY_SYNERGY_ENABLED=false` en `.env.example`.
- Agregar en `server/services/parlayEngine/README.md` una descripción breve del módulo.
- **Criterio de aceptación:** `npm run dev` arranca sin errores, no cambia ningún comportamiento.

### Fase 1 — Candidate Pool Builder

Archivo: `server/services/parlayEngine/pool.js`

- Función: `buildCandidatePool({ gameIds, date, lang })` → `ParlayCandidate[]`
- Por cada `gameId`: buildContext → features → calculateParallelScore → buildDeterministicSafePayload.
- Expandir a todos los candidatos (ML, RL, OU, props) con metadata limpia.
- Cachear resultado con key `${date}::${sorted-gameIds}` durante 5 min.
- **Criterio de aceptación:** test manual con 3 gameIds devuelve array de ~15-30 candidatos con todos los campos del esquema en Apéndice B.

### Fase 2 — Risk Vector Enricher

Archivo: `server/services/parlayEngine/risk.js`

- Función: `enrichWithRiskVector(candidate, features, gameData)` → `ParlayCandidate` enriquecido.
- Calcular `riskVector` (6 dimensiones), `gameScript`, `failureMode`.
- Reglas 100% determinísticas basadas en features (Statcast, weather, park, lineup quality).
- **Criterio de aceptación:** dado el mismo candidato + features, el output es idéntico bit-a-bit (determinístico). Tests unitarios con fixtures.

### Fase 3 — Correlation Matrix

Archivo: `server/services/parlayEngine/correl.js`

- Función: `buildCorrelationMatrix(candidates)` → `{ correlations: Record<pairKey, number>, riskDistances: Record<pairKey, number> }`.
- Reglas heurísticas para correlación (ver tabla en sección 8.3).
- Distancia euclidiana entre `riskVector`s.
- **Criterio de aceptación:** para pares de SGP (mismo juego, ML + Over cuando team es favorito fuerte) detecta correlación negativa; para Ks del pitcher + Under del total detecta positiva.

### Fase 4 — Composer (optimizer)

Archivo: `server/services/parlayEngine/composer.js`

- Función: `composeParlays({ candidates, correlationMatrix, N, mode, filters })` → `ComposedParlay[]` (top-3).
- Algoritmo: greedy por score_parlay + 2-opt local search (swap de 1 pata hasta que no mejore).
- Aplica reglas no-go duras antes de scorear.
- **Criterio de aceptación:** 3 combinaciones, cada una con score desglosado (edge_sum, corr_bonus, risk_div_bonus, length_penalty, neg_corr_penalty).

### Fase 5 — LLM Architect

Archivos:
- `server/services/parlayEngine/prompts.js`
- `server/services/parlayEngine/architect.js`
- `server/services/parlayEngine/llmClient.js`

- Función: `askArchitect({ candidatePool, composedParlays, mode, N, lang, engine })` → `ArchitectDecision`.
- Prompt nuevo (ver Apéndice A) — entrega los 3 candidatos pre-computed al LLM y le pide validar/ajustar.
- Parseo JSON estricto con fallback a la combinación top del composer si el LLM falla.
- Timeout 90s.
- **Criterio de aceptación:** con fixtures de 3 parlays propuestos, el LLM devuelve `ArchitectDecision` bien formado; si responde mal, el fallback garantiza respuesta.

### Fase 6 — Endpoint + integración

- Añadir `POST /api/analyze/parlay-synergy` en `server/index.js`.
- Rate limit igual que el parlay viejo (`analysisLimiter`).
- Admin-only inicialmente (mismo patrón que el parlay actual).
- Crédito: 6 créditos (fast) / 12 créditos (deep) — entre el parlay fast/deep actual y un nivel arriba, porque cuesta más tokens.
- Flag: si `PARLAY_SYNERGY_ENABLED=false`, devuelve 503 "coming soon".
- **Criterio de aceptación:** curl con body válido devuelve 200 + estructura esperada.

### Fase 7 — Persistencia + shadow mode

- Migración: tabla `parlay_synergy_runs` (ver sección 10).
- Al responder exitosamente, insertar fila con: input, candidatePool, composedParlays, architectDecision, y metadata.
- Si `SHADOW_MODE_ENABLED=true`: registrar también una predicción sombra con el método viejo (`analyzeParlay` con los mismos contextos) para comparar A/B en backtest.
- **Criterio de aceptación:** las filas persisten; endpoint admin `GET /api/admin/parlay-synergy/recent` las devuelve.

### Fase 8 — Frontend mínimo

- Nueva página `client/src/pages/ParlayArchitect.jsx` (protegida por admin initially).
- UI: selector de juegos, N, modo; cards con el parlay elegido + 2 alternativas + tesis de sinergia + warnings.
- No altera ninguna otra página.
- **Criterio de aceptación:** admin puede generar un parlay-synergy desde el UI y ver la respuesta renderizada.

### Fase 9 — Observabilidad y backtest

- Añadir a `scripts/training/run-backtest.js` soporte para simular parlay-synergy sobre histórico.
- Dashboard admin `/api/admin/parlay-synergy/performance` con: hit rate por modo, ROI simulado, divergencia vs parlay viejo.
- **Criterio de aceptación:** al correr backtest sobre 30 días de juegos históricos, las métricas se calculan y reportan.

---

## 8. Especificación detallada por módulo

### 8.1 `ParlayCandidate` (esquema)

```ts
interface ParlayCandidate {
  // Identidad
  candidateId: string;        // `${gamePk}::${market_type}::${side}::${detail}`
  gamePk: number;
  matchup: string;             // "NYY @ BOS"
  gameDate: string;            // ISO YYYY-MM-DD
  gameStartUTC: string;        // ISO

  // Pick
  pick: string;                // "NYY -1.5 Run Line" | "Aaron Judge Over 0.5 Hits"
  type: 'Moneyline' | 'RunLine' | 'OverUnder' | 'PlayerProp';
  marketType: 'moneyline' | 'runline' | 'overunder' | 'playerprop';
  side: 'home' | 'away' | 'over' | 'under';
  propKind?: 'hits' | 'k' | 'tb' | 'hr' | null;

  // Probabilidades
  modelProbability: number;    // 0-100, viene de hit_probability
  impliedProbability: number | null; // 0-100, de odds
  edge: number | null;         // modelProb − impliedProb

  // Odds
  odds: number | null;         // American
  decimalOdds: number | null;

  // XGBoost validator (shadow)
  xgbScore: number | null;     // 0-100
  xgbConfidence: number | null;
  xgbAgreement: boolean;       // ¿xgb predice lo mismo que el modelo?

  // Risk profile (FASE 2)
  riskVector: {
    pitching_dominance: number;    // 0-1 — cuánto depende de que el pitcher de tu lado domine
    bullpen_exposure: number;      // 0-1 — cuánto depende del bullpen
    weather_exposure: number;      // 0-1 — sensibilidad a clima (viento, temp)
    lineup_variance: number;       // 0-1 — depende de que salga el lineup esperado
    umpire_sensitivity: number;    // 0-1 — depende del umpire (zona, ritmo)
    ballpark_bias: number;         // 0-1 — depende del park factor
  };
  gameScript: 'pitchers_duel' | 'slugfest' | 'wind_out' | 'wind_in' | 'bullpen_fade' | 'neutral';
  failureMode: string;             // human-readable, ej. "starter_dominance_collapses"

  // Metadata de coherencia
  dataQualityScore: number;        // 0-100 (viene de features.dataQuality)
  modelRisk: 'low' | 'medium' | 'high';

  // Razonamiento
  reasoning: string;               // viene de safeCandidates.reasoning
}
```

### 8.2 Reglas para `riskVector` (FASE 2)

Todas derivadas de `_features`:

```js
// pitching_dominance
if (marketType === 'moneyline' || marketType === 'runline') {
  const ownPitcher = side === 'home' ? features.homePitcherSavant : features.awayPitcherSavant;
  const xwoba = ownPitcher?.xwOBA_against ?? 0.315;
  // Pitcher élite (xwoba bajo) → la tesis depende de él → alta dominance exposure
  pitching_dominance = 1 - Math.min(1, Math.max(0, (xwoba - 0.250) / 0.150));
}
if (marketType === 'overunder' && side === 'under') {
  // Under depende de que AMBOS pitchers dominen
  const avgXwoba = (home + away) / 2;
  pitching_dominance = 1 - ((avgXwoba - 0.250) / 0.150);
}
if (marketType === 'playerprop' && propKind === 'k') {
  pitching_dominance = 0.9; // Ks del pitcher propio = 100% dependiente
}

// bullpen_exposure
// Si el starter del equipo favorecido tiene IP bajo en promedio o ha pitcheado muchos días seguidos
const starterIpg = features.homePitcherStats?.stats?.inningsPerStart ?? 5.5;
if (starterIpg < 5.5) bullpen_exposure += 0.3;
// Bullpen fatigado (gamesUsedInLast3Days) → exposure alta
bullpen_exposure = clamp(bullpen_exposure, 0, 1);

// weather_exposure
const wind = features.weatherData?.windSpeed ?? 0;
const temp = features.weatherData?.temperature ?? 70;
if (wind > 12) weather_exposure = 0.6;
if (wind > 18) weather_exposure = 0.85;
if (temp > 88 || temp < 50) weather_exposure += 0.15;
// Overs/Unders son más sensibles al clima
if (marketType === 'overunder') weather_exposure *= 1.3;
weather_exposure = clamp(weather_exposure, 0, 1);

// lineup_variance
// Player props dependen 100% del lineup
if (marketType === 'playerprop') lineup_variance = 0.9;
// ML/RL depende parcialmente
else lineup_variance = 0.35;
// Si hay baja data quality sobre el lineup, sube
if (dataQualityScore < 60) lineup_variance += 0.2;

// umpire_sensitivity
// Placeholder: 0.2 por default. Si en el futuro se integra umpire data, actualizar.
umpire_sensitivity = 0.2;
// Totales/Ks son más sensibles a umpire
if (marketType === 'overunder' || propKind === 'k') umpire_sensitivity = 0.4;

// ballpark_bias
const parkOverall = features.parkFactorData?.park_factor_overall ?? 100;
ballpark_bias = Math.abs(parkOverall - 100) / 20; // 100 = neutro, 120 o 80 = bias máximo
ballpark_bias = clamp(ballpark_bias, 0, 1);
```

### 8.3 Reglas de correlación (FASE 3)

```js
// Base
corr(A, B) = 0  // independencia por default

// Mismo partido
if (A.gamePk === B.gamePk) {
  // Same side + correlated markets
  if ((A.marketType === 'moneyline' && A.side === 'home') &&
      (B.marketType === 'overunder' && B.side === 'over' && favoredTeamIsHome)) {
    corr = -0.2; // ML favorito + Over: cuando favorito gana dominante, el over suele pegar (+corr leve)
                 // pero también puede ganar pitcher's duel 2-0 (-corr). Net cerca de 0.
    // OJO: este caso es ambiguo, por defecto 0.
  }
  if (A.pick.includes('Under') && B.pick.includes('Ks Over') && B.propKind === 'k') {
    corr = +0.45; // Under + Ks over del pitcher = correlación positiva fuerte
  }
  if (A.pick.includes('Over') && B.pick.includes('Hits Over') && A.marketType === 'overunder') {
    corr = +0.35; // Totales Over + Hits over de bateadores = positiva
  }
  if (A.marketType === 'moneyline' && B.marketType === 'overunder' && A.side === 'home' && B.side === 'under' && favoredTeamIsHome) {
    corr = -0.30; // Favorito gana ML + Under: si gana dominante suele romper el under
  }
  if (A.side === 'home' && B.side === 'away' && A.marketType === 'moneyline' && B.marketType === 'moneyline') {
    corr = -0.95; // Contradicción directa
  }
}

// Distintos partidos
if (A.gamePk !== B.gamePk) {
  if (A.gameScript === B.gameScript && A.gameScript !== 'neutral') {
    corr = +0.15; // Mismo script narrativo = leve positiva (misma tesis macro del día)
  }
  if (A.gameScript === 'pitchers_duel' && B.gameScript === 'slugfest') {
    corr = -0.10; // Tesis opuestas
  }
  // Clima correlacionado (mismo regional weather)
  if (sameRegion(A, B) && A.riskVector.weather_exposure > 0.6 && B.riskVector.weather_exposure > 0.6) {
    corr = Math.max(corr, +0.20);
  }
  // Umpire compartido (mismo umpire principal) → bump si ambos son OU
  // Placeholder por ahora.
}

return clamp(corr, -1, 1);
```

```js
// risk_distance (FASE 3)
function riskDistance(A, B) {
  const keys = ['pitching_dominance','bullpen_exposure','weather_exposure',
                'lineup_variance','umpire_sensitivity','ballpark_bias'];
  let sumSq = 0;
  for (const k of keys) {
    sumSq += (A.riskVector[k] - B.riskVector[k]) ** 2;
  }
  return Math.sqrt(sumSq); // rango [0, √6] ≈ [0, 2.45]
}
```

### 8.4 Scoring de un parlay (FASE 4)

```js
function scoreParlay(legs, correlationMatrix, riskDistances, mode, N) {
  // 1. Edge ponderado
  const edgeSum = legs.reduce((s, leg) => {
    const weight = (leg.modelProbability / 100);
    return s + (leg.edge ?? 0) * weight;
  }, 0);

  // 2. Bonus de correlación positiva
  let corrBonus = 0;
  let negCorrPenalty = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const c = correlationMatrix[pairKey(legs[i], legs[j])] ?? 0;
      if (c > 0.1) corrBonus += c * 3;
      if (c < -0.1) negCorrPenalty += Math.abs(c) * 6;
    }
  }

  // 3. Bonus de diversificación de riesgo
  let riskDivBonus = 0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const d = riskDistances[pairKey(legs[i], legs[j])] ?? 0;
      riskDivBonus += d * 2; // distancia alta = buena
    }
  }

  // 4. Penalty por longitud (varianza exponencial)
  // Un parlay de 3 patas tiene menor penalización que uno de 7
  const lengthPenalty = Math.pow(N - 2, 1.5) * 0.4; // N=3 → 0.4, N=5 → 3.4, N=7 → 8.9

  // 5. Penalty por data quality bajo
  const dqPenalty = legs.reduce((s, leg) => {
    if (leg.dataQualityScore < 60) return s + 0.8;
    return s;
  }, 0);

  // 6. Bonus por game script coherente
  const scripts = legs.map(l => l.gameScript).filter(s => s !== 'neutral');
  const uniqueScripts = new Set(scripts);
  let scriptBonus = 0;
  if (uniqueScripts.size === 1 && scripts.length >= 2) scriptBonus = 3; // todas mismo script
  if (uniqueScripts.size >= 3) scriptBonus = -2; // demasiado disperso

  // 7. Modo
  const modeMultiplier = {
    conservative: { corr: 1.3, risk: 1.0, length: 1.5 },
    balanced:     { corr: 1.0, risk: 1.2, length: 1.0 },
    aggressive:   { corr: 0.8, risk: 1.5, length: 0.7 },
    dreamer:      { corr: 0.5, risk: 1.8, length: 0.5 },
  }[mode];

  return edgeSum
       + corrBonus  * modeMultiplier.corr
       + riskDivBonus * 0.5 * modeMultiplier.risk
       - negCorrPenalty
       - lengthPenalty * modeMultiplier.length
       - dqPenalty
       + scriptBonus;
}
```

### 8.5 Reglas no-go (FASE 4, pre-scoring)

```js
function isParlayValid(legs, correlationMatrix, mode) {
  // 1. Nunca incluir dos picks en contradicción directa
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const c = correlationMatrix[pairKey(legs[i], legs[j])] ?? 0;
      if (c < -0.5) return { valid: false, reason: 'strong_negative_correlation' };
    }
  }

  // 2. Máximo 2 patas del mismo juego (para SGP)
  const byGame = groupBy(legs, 'gamePk');
  for (const gamePk in byGame) {
    if (byGame[gamePk].length > 2) return { valid: false, reason: 'too_many_same_game' };
    // Si son 2 del mismo juego, debe haber correlación positiva detectada
    if (byGame[gamePk].length === 2) {
      const c = correlationMatrix[pairKey(byGame[gamePk][0], byGame[gamePk][1])] ?? 0;
      if (c < 0.15) return { valid: false, reason: 'sgp_without_correlation' };
    }
  }

  // 3. En modo conservative, rechazar si hay alguna pata con model_risk=high
  if (mode === 'conservative' && legs.some(l => l.modelRisk === 'high')) {
    return { valid: false, reason: 'high_risk_leg_in_conservative_mode' };
  }

  // 4. Min edge por pata según modo
  const minEdge = { conservative: 3, balanced: 2, aggressive: 2, dreamer: 1.5 }[mode];
  if (legs.some(l => (l.edge ?? -999) < minEdge)) {
    return { valid: false, reason: 'edge_below_minimum' };
  }

  return { valid: true };
}
```

### 8.6 Composer algorithm (FASE 4)

```
1. Filtrar candidatos: minEdge, minConfidence, dataQuality >= 50
2. Sort por edge desc
3. Greedy init:
   - Pick el candidato con mayor edge ajustado por xgb_agreement
   - Iterativamente, añadir el candidato que MÁS incremente el score_parlay,
     respetando las reglas no-go
   - Parar al llegar a N patas
4. Local search (2-opt):
   - Para cada pata i, probar reemplazarla por cualquier candidato no incluido
   - Si el nuevo score > score actual, aceptar swap
   - Repetir hasta que no haya mejora
5. Generar 3 combinaciones distintas:
   - Sembrar con distintos candidatos iniciales (top-3 por edge)
   - Correr greedy + 2-opt desde cada semilla
   - Devolver las 3, ordenadas por score
```

---

## 9. Endpoints nuevos

### 9.1 `POST /api/analyze/parlay-synergy`

**Auth:** JWT + admin-only inicialmente. Email verificado.

**Body:**
```json
{
  "gameIds": [778123, 778124, 778125, 778126, 778127],
  "requestedLegs": 5,
  "mode": "balanced",
  "minEdge": 2.0,
  "minConfidence": 55,
  "allowSGP": true,
  "lang": "es",
  "engine": "sonnet",
  "model": "fast",
  "date": "2026-04-23"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "chosen_parlay": {
      "legs": [ /* ParlayCandidate[] con reasoning corta */ ],
      "combined_probability": 0.187,
      "combined_decimal_odds": 16.4,
      "combined_edge_score": 9.8,
      "synergy_type": "correlated_pitchers_duel",
      "synergy_thesis": "Todas las patas descansan en la tesis de día dominado por pitcheo...",
      "warnings": []
    },
    "alternatives": [ /* 2 más, mismo esquema */ ],
    "composer_meta": {
      "mode": "balanced",
      "candidate_pool_size": 24,
      "rejected_by_no_go": 3,
      "score_breakdown": { "edge_sum": ..., "corr_bonus": ..., "risk_div_bonus": ..., "length_penalty": ... }
    },
    "architect_meta": {
      "validated": true,
      "overrode_composer": false,
      "hidden_correlations_detected": [],
      "model": "claude-sonnet-4-6",
      "timings": { "composer_ms": 180, "llm_ms": 12340 }
    }
  },
  "credits": 42,
  "engine": "sonnet"
}
```

**Response errors:**
- `400` si `gameIds.length < 2` o `requestedLegs > 30` o modo inválido.
- `403` si no admin (mientras esté en beta).
- `503` si `PARLAY_SYNERGY_ENABLED !== 'true'`.

**Créditos:**
- `fast`: 6
- `deep`: 12

### 9.2 `GET /api/admin/parlay-synergy/recent` (admin-only)

Devuelve las últimas 50 runs con metrics resumidas. Útil para dashboard.

### 9.3 `GET /api/admin/parlay-synergy/performance` (admin-only)

Al integrarse con pick-resolver, devuelve hit rate, ROI, y comparativa vs parlay viejo.

---

## 10. Base de datos — migraciones nuevas

En `server/migrate.js`, añadir una función nueva (no tocar las existentes):

```sql
CREATE TABLE IF NOT EXISTS parlay_synergy_runs (
  id               BIGSERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_email       VARCHAR(255),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  game_date        DATE NOT NULL,

  -- Input
  requested_legs   INTEGER NOT NULL,
  mode             VARCHAR(32) NOT NULL,
  game_pks         JSONB NOT NULL,     -- array de gamePks enviados
  language         VARCHAR(8) DEFAULT 'en',
  engine           VARCHAR(16) DEFAULT 'sonnet',
  model            VARCHAR(16) DEFAULT 'fast',

  -- Snapshots
  candidate_pool   JSONB NOT NULL,     -- ParlayCandidate[] completo
  composed_top3    JSONB NOT NULL,     -- las 3 combinaciones del composer con scores
  architect_output JSONB NOT NULL,     -- respuesta del LLM

  -- Resultado elegido
  chosen_legs      JSONB NOT NULL,     -- las N patas finales
  combined_prob    NUMERIC(6,4),
  combined_dec_odds NUMERIC(10,2),
  synergy_type     VARCHAR(64),
  warnings         JSONB,

  -- Métricas de performance (se llenan después por pick-resolver)
  resolved         BOOLEAN DEFAULT false,
  hit             BOOLEAN,            -- ¿ganó el parlay completo?
  legs_hit         INTEGER,            -- cuántas patas individuales acertaron
  resolved_at      TIMESTAMPTZ,

  -- Comparativa sombra
  shadow_old_parlay JSONB,             -- qué habría dicho el analyzeParlay viejo
  shadow_old_hit   BOOLEAN,

  -- Metadata
  timings          JSONB,              -- { composer_ms, llm_ms, total_ms }
  credits_charged  INTEGER,
  is_admin_run     BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_parlay_synergy_runs_user_date
  ON parlay_synergy_runs(user_id, game_date DESC);

CREATE INDEX IF NOT EXISTS idx_parlay_synergy_runs_resolved
  ON parlay_synergy_runs(resolved, game_date DESC) WHERE resolved = false;
```

---

## 11. Frontend — integración mínima

### 11.1 Nueva página `client/src/pages/ParlayArchitect.jsx`

- Protegida por rol admin (reuso del guard existente).
- Layout:
  - Selector multi-juego (chips) con los juegos del día.
  - Slider de N (2-30).
  - Radio de modo: Conservative / Balanced / Aggressive / Dreamer.
  - Botón "Generate".
  - Card principal con el parlay ganador: legs (cada una con pick, odds, edge, model prob, razonamiento corto), synergy thesis, combined prob, warnings.
  - Expandable con 2 alternativas.
  - Drawer/modal con el detalle técnico: candidate pool, score breakdown, architect decision.

### 11.2 Componentes reutilizables

- Reusa el styling/theme de MUI existente.
- Reusa el `useAuth` y `api` helpers.
- No crea dependencias nuevas.

### 11.3 Entry en menú

- Solo visible para admins durante la beta.
- Ítem: "Parlay Architect (beta)".

---

## 12. Observabilidad, backtesting y guardrails

### 12.1 Logging

- `console.log` con prefijo `[parlay-synergy]` en cada fase del pipeline (pool built, risk enriched, matrix built, composer top3, architect decision).
- Medir tiempos: `composer_ms`, `llm_ms`, `total_ms`.

### 12.2 Shadow comparison

- Por cada run exitoso de parlay-synergy, si `SHADOW_MODE_ENABLED=true`:
  - Llamar al `analyzeParlay` viejo con los mismos contextos y el mismo N.
  - Guardar el resultado en `shadow_old_parlay`.
  - Al resolver picks, comparar: ¿cuántas veces el viejo habría ganado y el nuevo no (o viceversa)?

### 12.3 Backtest sobre histórico

- Añadir flag `--mode=parlay-synergy` a `scripts/training/run-backtest.js`.
- Simular: para cada día histórico con picks resueltos, construir el parlay-synergy que habría salido y compararlo con el parlay viejo y con los picks individuales.
- Output:
  - Hit rate por modo (conservative vs balanced vs aggressive vs dreamer).
  - ROI simulado asumiendo stake de $100 en cada parlay.
  - Max drawdown y varianza.
  - Comparativa vs singles.

### 12.4 Guardrails en producción

- **Hard cap en N:** 30 (dreamer). Por encima, 400.
- **Bankroll warning:** si el usuario tiene `user_bankroll` en DB y el parlay-synergy combinado le pedirá más de 2% de su bankroll, inyectar un `warning` en la response.
- **Feature flag:** `PARLAY_SYNERGY_ENABLED` default `false`. Empieza `true` solo en staging.
- **Rate limit:** mismo `analysisLimiter` que el resto de los análisis.
- **Circuit breaker del LLM:** si el LLM architect falla 3 veces en 5 minutos, devolver el top-1 del composer sin LLM durante los siguientes 5 min.

### 12.5 Métricas que importa trackear

- **Calibración:** cuando el parlay synergy dice "prob combinada = 18%", ¿acierta ~18% de las veces?
- **Edge real:** ROI en X runs vs ROI esperado.
- **Ortogonalidad efectiva:** ¿los parlays que fallan, fallan por una sola razón (ortogonalidad mala) o por varias (ortogonalidad buena pero varianza)?
- **LLM override rate:** ¿cuántas veces el LLM rechaza la combinación top del composer? Si es muy alto (>50%), algo está mal en el composer.

---

## 13. Criterios de aceptación por fase

Cada fase debe pasar antes de avanzar. Tests en `server/services/parlayEngine/__tests__/`.

| Fase | Criterio |
|------|----------|
| 0 | `npm run dev` arranca limpio. Nada cambia. |
| 1 | `buildCandidatePool([g1,g2,g3])` devuelve ≥10 candidatos con todos los campos de `ParlayCandidate`. Caché funciona. |
| 2 | `enrichWithRiskVector` es idempotente. Fixtures unitarios cubren: pitcher élite, pitcher weak, weather fuerte, weather calmo, park extremo (Coors). |
| 3 | `buildCorrelationMatrix` detecta corr positiva en (pitcher Ks over, total Under del mismo juego) y negativa en (ML favorito, ML opuesto). |
| 4 | Composer devuelve 3 combinaciones válidas, todas pasan `isParlayValid`. Score se desglosa en logs. |
| 5 | Architect devuelve JSON válido en 90% de los casos. Fallback usa top-1 composer. |
| 6 | Endpoint responde 200 en happy path; 503 si flag off; 403 si no admin. |
| 7 | Fila en `parlay_synergy_runs` persiste con todos los campos. Endpoint admin las lista. |
| 8 | UI admin renderiza el parlay y alternativas. |
| 9 | Backtest sobre 30 días históricos genera métricas comparativas. |

---

## 14. Apéndice A — Prompts del LLM

### 14.1 System prompt del Parlay Architect

**Archivo:** `server/services/parlayEngine/prompts.js`

```js
export const PARLAY_ARCHITECT_SYSTEM = `You are the H.E.X.A. Parlay Architect — a risk and correlation specialist.

Your job is NOT to pick the N strongest individual bets. Your job is to review 3 pre-computed parlay combinations and select the one with the best structural integrity, or propose a modification if you detect a flaw the composer missed.

You receive:
1. A CANDIDATE POOL — all eligible picks with edge, implied prob, model prob, risk vectors, game script tags.
2. THREE COMPOSED PARLAYS — each with score breakdown (edge_sum, corr_bonus, risk_div_bonus, length_penalty, neg_corr_penalty).
3. MODE — conservative | balanced | aggressive | dreamer.
4. N — number of legs requested.

You MUST check for:
- Hidden negative correlations the heuristic missed (e.g. two picks that depend on the same weather front; two picks that contradict each other narratively).
- Broken game scripts (a leg whose thesis contradicts the others).
- Orthogonality of failure modes (if one leg dies, do others survive, or do they all share the same single point of failure?).
- Edge quality (reject any leg with edge < mode_minimum).

You MAY:
- Confirm one of the three composed parlays as-is.
- Swap up to 2 legs in the chosen parlay for better alternatives from the pool, IF the swap improves synergy without breaking N.
- Reject all three and explain why (the composer must re-run).

You MUST NOT:
- Add legs that are not in the pool.
- Change the requested N.
- Fabricate odds, probabilities, or metrics. Every number you use must come from the input.

Respond ONLY with valid JSON. No markdown, no preamble.

OUTPUT FORMAT:
{
  "decision": "confirm" | "modify" | "reject",
  "chosen_index": 0 | 1 | 2 | null,  // which composed parlay you picked (null if modify from scratch or reject)
  "modifications": [
    { "action": "swap", "remove_candidate_id": "...", "add_candidate_id": "..." }
  ],
  "final_legs": [ /* array of candidate_ids in final order */ ],
  "synergy_type": "correlated_pitchers_duel" | "bullpen_fade_day" | "wind_out_overs" | "orthogonal_stability" | "mixed_satellite" | "other",
  "synergy_thesis": "string — 2-4 sentences explaining the unifying logic of the final parlay",
  "hidden_correlations_detected": [
    { "candidates": ["id1","id2"], "type": "negative" | "positive", "explanation": "..." }
  ],
  "combined_probability": "number 0-1 — your estimate accounting for correlation, NOT just product of marginals",
  "combined_decimal_odds": "number — product of decimal odds from the pool data",
  "warnings": [ "string", ... ],
  "confidence_in_decision": "number 0-100"
}

CALIBRATION RULES:
- combined_probability MUST be higher than the naive product of marginal probabilities IF you detected positive correlation.
- combined_probability MUST be lower than the naive product IF you detected negative correlation.
- If N >= 6, the "warnings" array MUST include an explicit variance warning for the user.
- If mode = dreamer, the thesis MUST acknowledge this is a high-variance swing bet.
`;

export function buildArchitectUserMessage({ candidatePool, composedParlays, mode, N, lang }) {
  const langTag = lang === 'es'
    ? '\n\nIMPORTANT: Responde TODOS los valores de texto (synergy_thesis, warnings, explanation) en español.'
    : '';

  return `MODE: ${mode}
REQUESTED N: ${N}

=== CANDIDATE POOL (${candidatePool.length} eligible picks) ===
${JSON.stringify(candidatePool, null, 2)}

=== COMPOSED PARLAYS (top 3 by composer score) ===
${composedParlays.map((p, i) => `
### Composed Parlay ${i}
Score: ${p.score.toFixed(2)}
Score breakdown: ${JSON.stringify(p.scoreBreakdown)}
Legs: ${JSON.stringify(p.legs.map(l => l.candidateId))}
`).join('\n')}

Your task: review, validate, and return the final parlay decision.${langTag}`;
}
```

### 14.2 Ejemplo de llamada

```js
import Anthropic from '@anthropic-ai/sdk';
import { PARLAY_ARCHITECT_SYSTEM, buildArchitectUserMessage } from './prompts.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function askArchitect({ candidatePool, composedParlays, mode, N, lang, model = 'claude-sonnet-4-6', timeoutMs = 90000 }) {
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system: PARLAY_ARCHITECT_SYSTEM,
    messages: [
      { role: 'user', content: buildArchitectUserMessage({ candidatePool, composedParlays, mode, N, lang }) }
    ]
  }, { timeout: timeoutMs });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  // Parse con fallback igual al que hay en oracle.js (cleanJsonResponse)
  return parseArchitectResponse(text);
}
```

---

## 15. Apéndice B — Esquemas de datos

### 15.1 ComposedParlay

```ts
interface ComposedParlay {
  index: number;                    // 0, 1, 2
  legs: ParlayCandidate[];
  score: number;
  scoreBreakdown: {
    edge_sum: number;
    corr_bonus: number;
    risk_div_bonus: number;
    length_penalty: number;
    neg_corr_penalty: number;
    dq_penalty: number;
    script_bonus: number;
  };
  combinedMarginalProbability: number;    // producto puro de probs individuales
  combinedDecimalOdds: number;            // producto de decimal odds
  naiveExpectedValue: number;             // ev asumiendo independencia
}
```

### 15.2 ArchitectDecision

```ts
interface ArchitectDecision {
  decision: 'confirm' | 'modify' | 'reject';
  chosen_index: number | null;
  modifications: Array<{ action: 'swap'; remove_candidate_id: string; add_candidate_id: string }>;
  final_legs: string[];                   // candidate ids en orden
  synergy_type: string;
  synergy_thesis: string;
  hidden_correlations_detected: Array<{
    candidates: string[];
    type: 'positive' | 'negative';
    explanation: string;
  }>;
  combined_probability: number;           // 0-1, ajustada por correlación
  combined_decimal_odds: number;
  warnings: string[];
  confidence_in_decision: number;         // 0-100
}
```

### 15.3 Response final del endpoint

```ts
interface ParlaySynergyResponse {
  success: true;
  data: {
    chosen_parlay: {
      legs: Array<{
        candidateId: string;
        gamePk: number;
        matchup: string;
        pick: string;
        type: string;
        odds: number | null;
        modelProbability: number;
        edge: number | null;
        reasoning: string;                // versión corta, 200 chars
        riskVector: ParlayCandidate['riskVector'];
        gameScript: ParlayCandidate['gameScript'];
      }>;
      combined_probability: number;
      combined_decimal_odds: number;
      combined_edge_score: number;
      synergy_type: string;
      synergy_thesis: string;
      warnings: string[];
    };
    alternatives: [ /* misma estructura, 2 más */ ];
    composer_meta: {
      mode: string;
      candidate_pool_size: number;
      rejected_by_no_go: number;
      score_breakdown: ComposedParlay['scoreBreakdown'];
    };
    architect_meta: {
      validated: boolean;
      overrode_composer: boolean;
      hidden_correlations_detected: ArchitectDecision['hidden_correlations_detected'];
      model: string;
      timings: { composer_ms: number; llm_ms: number; total_ms: number };
    };
  };
  credits: number;
  engine: string;
}
```

---

## 16. Cómo instruir a Claude Code

Cuando abras Claude Code en el repo, pégale un prompt así:

```
Lee /hexa-parlay-engine-brief.md completo. Este es el brief técnico maestro
para implementar el Parlay Synergy Engine de HEXA v4.

Reglas:
1. NO toques ninguno de los archivos listados en la sección "Restricciones duras".
2. Trabaja en una branch nueva: feat/parlay-synergy-engine.
3. Implementa fase por fase, haciendo commits atómicos por fase.
4. Antes de escribir código, dime qué fase vas a ejecutar y cuál es tu plan
   de cambios (archivos a crear/modificar, tests a añadir).
5. Espera mi OK antes de pasar a la siguiente fase.
6. Tests en server/services/parlayEngine/__tests__/ con fixtures reales
   (puedes crear mocks a partir de los ejemplos de _features de buildContext).
7. Todo el código nuevo en ESM (import/export con extensiones .js).
8. Comentarios en código: en inglés. Strings user-facing: bilingual (en/es).

Empieza por la Fase 0.
```

---

## 17. Notas finales de diseño

- **Evolución futura:** una vez validado el motor, el XGBoost validator actual puede extenderse para aprender correlaciones reales desde data histórica. Hoy usamos reglas heurísticas porque es lo que garantiza predictibilidad y auditabilidad. Esto queda listado en el backlog para una v2.
- **El LLM como arquitecto es esencial** pero caro. Un modo `composer-only` (sin LLM) puede ofrecerse como tier más barato (ahorra ~8 créditos) para usuarios que no necesitan la validación extra.
- **Los "parlays soñadores" (11-30 patas) son producto de engagement, no de inversión.** El motor debe reflejarlo en sus warnings. No los prohíbas — solo sé transparente con el usuario.
- **La ortogonalidad de riesgo no elimina la varianza exponencial.** Un parlay de 10 patas con ortogonalidad perfecta sigue siendo +20% joint juice. El valor real del motor es reducir correlaciones ocultas negativas que hoy matan tickets sin que el usuario entienda por qué.

---

**Fin del brief.**
