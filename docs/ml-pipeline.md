# ML Pipeline — H.E.X.A. v4

Documento vivo sobre toda la capa de razonamiento, predicción y aprendizaje de H.E.X.A.: Oracle dual LLM, validator paralelo, feature store, CLV tracking, y el plan en curso para entrenar un modelo propio.

---

## Tabla de contenido

1. [Estado actual de la pila ML](#1-estado-actual-de-la-pila-ml)
2. [Oracle — motor LLM dual](#2-oracle--motor-llm-dual)
3. [Shadow Validator (no es XGBoost real)](#3-shadow-validator-no-es-xgboost-real)
4. [Context Builder](#4-context-builder)
5. [Feature Store](#5-feature-store)
6. [CLV — Closing Line Value](#6-clv--closing-line-value)
7. [Oracle Memory](#7-oracle-memory)
8. [Backtest engine](#8-backtest-engine)
9. [Player props resolver](#9-player-props-resolver)
10. [Plan: modelo Python entrenado propio](#10-plan-modelo-python-entrenado-propio)
11. [Métricas que importa trackear](#11-métricas-que-importa-trackear)

---

## 1. Estado actual de la pila ML

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORACLE (LLM)                             │
│   ┌──────────────┐         ┌──────────────┐                     │
│   │   Claude     │◄────────│ Context      │◄── Statcast         │
│   │   Sonnet 4.6 │         │ Builder      │◄── Weather          │
│   └──────┬───────┘         └──────────────┘◄── Park factors     │
│          │                                 ◄── Lineups          │
│   ┌──────▼───────┐  (dual)                 ◄── Odds API         │
│   │   Grok 4     │                         ◄── Line movement    │
│   │ (fast-reason)│                                              │
│   └──────┬───────┘                                              │
│          │                                                      │
│          ▼  (divergence detection, NOT ensemble)                │
│   ┌──────────────┐                                              │
│   │ engine_meta  │                                              │
│   └──────────────┘                                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼ (paralelo, observabilidad)
┌─────────────────────────────────────────────────────────────────┐
│             SHADOW VALIDATOR (determinístico)                   │
│             5 pesos hardcoded, sin training                     │
│             ⚠ NO es XGBoost real                                │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              PERSISTENCIA / OBSERVABILIDAD                      │
│   pick_features  shadow_model_runs  picks  oracle_sessions      │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼ (post-game)
┌─────────────────────────────────────────────────────────────────┐
│                  RESOLVER + POSTMORTEM                          │
│   resultado del pick → CLV → postmortem por LLM                 │
└─────────────────────────────────────────────────────────────────┘
```

**Estado en una línea**: el "razonamiento" lo hace LLM dual. El "validator" no entrena, solo aplica heurística. Toda la data está persistida pero **no hay un modelo aprendiendo de ella**.

Lo que viene en la sección 10: migrar el validator a un **microservicio Python con XGBoost real**, entrenado con los >500 picks históricos, retrainning semanal automático.

---

## 2. Oracle — motor LLM dual

**Archivo:** [server/oracle.js](../server/oracle.js) (1225 líneas).

### 2.1 Motores soportados

```js
const SUPPORTED_ENGINES = new Set(['sonnet', 'grok', 'dual']);
```

- `sonnet` → Claude Sonnet 4.6 (default).
- `grok` → xAI grok-4-fast-reasoning.
- `dual` → ejecuta ambos en paralelo, normaliza picks, reporta divergencia.

### 2.2 Modelos Claude configurables

```js
const MODELS = {
  premium: 'claude-opus-4-7',           // 10000 max tokens
  deep:    'claude-sonnet-4-6',         // 8000 max tokens (default)
  haiku:   'claude-haiku-4-5-20251001', // 1000 max tokens (content)
};
```

### 2.3 Modos de análisis

| Modo | Endpoint | Créditos | Output |
|---|---|---|---|
| `single` | `POST /api/analyze/game` | 2 fast / 4 deep | Análisis completo de un partido |
| `safe` | `POST /api/analyze/safe` | 1 | Modo conservador, determinístico |
| `parlay` | `POST /api/analyze/parlay` | 4 / 8 | Parlay legacy (N juegos concatenados) |
| `parlay-synergy` | `POST /api/analyze/parlay-synergy` | 6 / 12 | **Nuevo**, admin-only, engine combinatorial |
| `fullDay` | `POST /api/analyze/game` con `mode=fullDay` | 6 / 12 | Brief del slate |
| `chat` | `POST /api/analyze/chat` | 0 | Admin, chat libre |
| `chat-jornada` | `POST /api/analyze/chat-jornada` | 0 | Admin, chat sobre jornada |
| `batch` | `POST /api/analyze/batch` | 0 | Admin, backtesting |

### 2.4 Flujo interno (`analyzeGame`)

```js
async function analyzeGame({ matchup, betType, context, riskProfile, mode, lang, engine, timeoutMs }) {
  // 1. Build user message según mode
  const userMessage = buildUserMessage({ matchup, betType, context, mode, lang });

  // 2. Engine routing
  if (engine === 'dual') {
    const [claudeRes, grokRes] = await Promise.all([
      runAnthropicOracleRequest(userMessage, { timeoutMs }),
      runGrokOracleRequest(userMessage, { timeoutMs }),
    ]);
    return mergeEngineVariants(claudeRes, grokRes);  // detección de divergencia
  }
  if (engine === 'grok') return runGrokOracleRequest(userMessage, { timeoutMs });
  return runAnthropicOracleRequest(userMessage, { timeoutMs });
}
```

### 2.5 Output JSON estructurado

```json
{
  "master_prediction": {
    "pick": "NYY ML",
    "type": "moneyline",
    "side": "home",
    "confidence": 67,
    "bet_value": "medium",
    "model_risk": "medium"
  },
  "oracle_report": {
    "thesis": "...",
    "key_factors": ["..."],
    "alert_flags": ["bullpen_fatigue"],
    "hidden_correlations": []
  },
  "probability_model": {
    "model_prob": 0.62,
    "implied_prob": 0.55,
    "edge_pct": 7.0
  },
  "kelly_recommendation": {
    "kelly_fraction": 0.045,
    "conservative_kelly_pct": 1.1,
    "suggested_units": 0.5
  },
  "engine_meta": {
    "engine": "dual",
    "engine_variants": [
      { "engine": "sonnet", "pick": "NYY ML", "confidence": 67 },
      { "engine": "grok",   "pick": "NYY ML", "confidence": 63 }
    ],
    "divergence": false
  }
}
```

### 2.6 Validación de salida

Sin Zod/Joi. Parsing manual en `parseResponse()`:
1. Intenta `JSON.parse(rawText)`.
2. Si falla, limpia markdown (`` ``` ``, `` ```json ``).
3. Si falla, extrae primer bloque `{...}`.
4. Si todo falla, retorna error con texto crudo en logs.

**Gap conocido:** sin validación de schema estricta, cambios en el prompt pueden romper el parsing silenciosamente. Plan en backlog Tier A.

### 2.7 Kelly Criterion

Calculado en `analyzeGame` cuando hay bankroll:
```js
// p = model_prob, b = decimal_odds - 1
const f = (b * p - (1 - p)) / b;
const conservativeKelly = Math.max(0, Math.min(0.05, f * 0.25));
```
Persistido en `picks.kelly_recommendation`.

---

## 3. Shadow Validator (no es XGBoost real)

**Archivos:** [server/shadow-model.js](../server/shadow-model.js), [server/services/xgboostValidator.js](../server/services/xgboostValidator.js).

### 3.1 Qué es realmente

```js
// xgboostValidator.js:8 (literal del repo)
// Validador de ensamble tipo XGBoost para el Oracle H.E.X.A. V4.
// Exporta: calculateParallelScore(statcastData, mlbApiData)
//   — Simula un modelo de ensamble con métricas clave de Statcast...
```

**No es XGBoost.** Es scoring determinístico con pesos hardcodeados:

```js
const FEATURE_WEIGHTS = {
  pitcher_xwOBA:     0.30,
  pitcher_whiff:     0.20,
  pitcher_activeSpin: 0.10,
  lineup_xwOBA:      0.25,
  recent_form:       0.15,
};
```

Para cada equipo: normaliza features → calcula `defensive_score` (pitcher propio contra lineup rival) + `offensive_score` (lineup propio contra pitcher rival) → aplica home field boost `+0.03` → normaliza a `[0, 100]`. Devuelve `{ score, predicted_winner, confidence }`.

### 3.2 Quién lo llama

Activado por `SHADOW_MODE_ENABLED=true`:
- En `analyzeGame` (oracle.js), después del LLM.
- En `parlayEngine/pool.js`, para enriquecer candidatos con `xgbScore`.
- En `shadow-model.js`, para persistir runs en `shadow_model_runs`.

### 3.3 Tabla `shadow_model_runs`

```
id (BIGSERIAL PK)
user_id (FK users)
pick_id (FK picks)
game_pk
oracle_pick           — pick del LLM normalizado
shadow_score          — 0-100, score del validator
shadow_confidence     — 0-100
agree_with_oracle     — boolean
actual_home_score     — null hasta resolver
actual_away_score
actual_status         — 'Final', etc.
created_at
```

### 3.4 Dashboard admin

`GET /api/admin/shadow-model` retorna últimas N runs con stats:
- Agreement rate (% de veces que shadow ≠ oracle).
- Cuando divergen: ¿quién acierta más?
- Distribución de confidence buckets.

### 3.5 Limitaciones (por qué hay que reemplazarlo)

- **No aprende.** Pesos hardcodeados, no se actualizan con datos.
- **No captura interacciones no-lineales** (ej. pitcher élite × park alto × wind out).
- **No genera probabilidad calibrada** — el `confidence` es heurístico.
- **No produce SHAP** — no podemos saber qué feature drivers fueron decisivos.
- **No soporta over/under, run line, props específicos** — solo predice "winner" del juego.

Reemplazo: ver [sección 10](#10-plan-modelo-python-entrenado-propio).

---

## 4. Context Builder

**Archivo:** [server/context-builder.js](../server/context-builder.js) (1909 líneas).

### 4.1 Datos que arma

Por `gameData` (de MLB Stats) + `oddsData` (de Odds API), construye:

| Sección | Fuente | Datos |
|---|---|---|
| Pitching | Savant + MLB Stats | xwOBA_against, Whiff%, K%, BB%, xERA, ERA, IP, active_spin_pct |
| Pitcher rolling | Savant | woba_against_7d, woba_against_14d |
| Lineup | MLB Stats + Savant | xwOBA promedio, OPS, splits vs LHP/RHP |
| Batter splits | Savant | Career H2H vs pitcher (cuando hay sample size) |
| Weather | Open-Meteo | Temp, wind speed, dirección, humedad, precipitación |
| Park factors | hardcoded `HISTORICAL_MLB_CONTEXT` (líneas 39-70) | overall, HR, R |
| Bullpen | MLB Stats | IP últimos 3 días, back-to-back flag |
| Line movement | `line-movement.js` | Sharp money (±15 cent ML move) |
| Game context | MLB Stats | Series record, day/night, dome |

### 4.2 Output

```js
const { context, _features } = await buildContext(gameData, oddsData);
// context: string formateado para inyectar en prompt LLM
// _features: objeto con todos los campos numéricos para el validator
```

### 4.3 Cache

In-memory cache con TTL 15 min, key por `gamePk`. Evita reconstrucción redundante en una misma sesión / jornada.

### 4.4 Spring training adjustment

`isSpringTraining(gameDate)` → si true, marca contexto con flag y el prompt baja confianza -25%.

---

## 5. Feature Store

**Archivo:** [server/feature-store.js](../server/feature-store.js).

### 5.1 Función principal

```js
export async function savePickFeatures({
  pickId, backtestId, gamePk, gameDate,
  homePitcherSavant, awayPitcherSavant,
  homePitcherStats, awayPitcherStats,
  homeHitting, awayHitting, savantBatters,
  parkFactorData, weatherData,
  dataQuality, signalCoherence, oddsData,
  pick, result, userEmail,
}) { /* INSERT o UPDATE en pick_features */ }
```

Llamada después de cada análisis exitoso (sobre todo si se persiste un pick).

### 5.2 Columnas actuales (19 features + 4 meta)

```
-- features
home_pitcher_xwoba, away_pitcher_xwoba
home_pitcher_whiff, away_pitcher_whiff
home_pitcher_k_pct, away_pitcher_k_pct
home_pitcher_era, away_pitcher_era
home_team_ops, away_team_ops
home_lineup_avg_xwoba, away_lineup_avg_xwoba
park_factor_overall, park_factor_hr
temperature, wind_speed
data_quality_score, signal_coherence_score
odds_ml_home, odds_ml_away, odds_ou_total

-- meta
pick (text, no estructurado), result, user_email, pick_time_lima
```

### 5.3 Gaps actuales (a cerrar en Sprint 1)

- **Sin scores reales**: falta `home_score`, `away_score`, `total_runs`, `winner_team_id`. Sin esto no se puede entrenar over/under separadamente del moneyline del pick.
- **Pick es texto libre**: "NYY ML", "Over 8.5", "Aaron Judge Over 0.5 Hits". Para training necesita columnas estructuradas: `market_type`, `side`, `line`, `prop_kind`, `prop_player_id`.
- **Sin features temporales del pitcher**: `days_rest`, `pitches_last_start`, `bullpen_pitches_last_3d`.
- **Sin features de contexto del juego**: `umpire_id`, `game_number_in_series`, `is_day_game`, `is_dome`.
- **Sin versionado del prompt usado**: cambios al SYSTEM_PROMPT mutan histórico sin trail.
- **Sin flag de source**: live vs admin_test vs backtest se mezclan.

Plan para cerrar todos estos gaps: [sección 10.2](#102-sprint-1--cerrar-gaps-del-dataset).

---

## 6. CLV — Closing Line Value

**Archivos:** [server/closing-line-capture.js](../server/closing-line-capture.js), [server/line-movement.js](../server/line-movement.js).

### 6.1 Qué captura

- **Odds inicial**: guardado en `picks.odds_at_pick` al crear el pick.
- **Odds de cierre**: capturado por job periódico (cada 2h entre 5pm-1am ET) en `picks.closing_odds` cuando el juego está por empezar.
- **CLV**: calculado al resolver el pick como diferencia entre implied probability inicial y de cierre.

### 6.2 Por qué importa

CLV positivo persistente = el modelo "ve" antes que el mercado. Es la métrica más robusta de edge a largo plazo (independiente de varianza de outcomes).

### 6.3 Dashboard

`GET /api/picks/clv-stats` → CLV promedio, distribución, % de picks con CLV positivo, ROI esperado por CLV.

### 6.4 Tabla `odds_snapshots`

```
id, game_id, game_date
moneyline_home, moneyline_away
run_line_home, run_line_away, run_line_home_price, run_line_away_price
total, over_price, under_price
captured_at (TIMESTAMP)
```

Indexed por `(game_id, game_date)`. Permite reconstruir line movement histórico.

---

## 7. Oracle Memory

**Archivo:** [server/oracle-memory.js](../server/oracle-memory.js).

### 7.1 Qué hace

- Mantiene tabla `oracle_sessions` con history del chat (admin endpoints `chat` / `chat-jornada`).
- Computa **calibración**: para los últimos 20 picks del usuario, compara `oracle_confidence` con `actual_hit_rate` en buckets (50-54%, 55-59%, 60-70%).
- Inyecta resumen de calibración en el system prompt como "aprender de la historia reciente".

### 7.2 No es RAG

No hay embeddings ni vector DB. La "memoria" es texto plano injectado en el prompt. Plan para implementar RAG real (pgvector + embeddings de oracle_reports) está en backlog Tier A.

---

## 8. Backtest engine

**Archivos:** [scripts/training/run-backtest.js](../scripts/training/run-backtest.js), [scripts/training/historical-fetcher.js](../scripts/training/historical-fetcher.js).

### 8.1 Uso

```bash
node scripts/training/run-backtest.js 2026-04-01           # un día
node scripts/training/run-backtest.js 2026-04-01 --dry-run # sin DB writes
node scripts/training/run-backtest.js 2026-04-01 --max=5   # primeros 5 juegos
```

### 8.2 Flujo

1. `historical-fetcher.js` trae lista de juegos para la fecha.
2. Por cada juego: construye contexto histórico (con resultados ya conocidos blanqueados), llama a `POST /api/analyze/safe` con `mode=batch` (admin, 0 créditos).
3. Compara la predicción con el resultado real.
4. Guarda fila en `backtest_results` con: pick_type, model_prediction, actual_outcome, alert_flags, has_critical_flags.

### 8.3 Modos soportados hoy

Solo `safe` (determinístico). Plan: añadir `--mode=parlay-synergy` para evaluar el motor nuevo, y `--mode=python-model` cuando esté el sidecar.

### 8.4 Endpoints admin

- `GET /api/admin/backtest-stats` — agregaciones (hit rate, ROI).
- `POST /api/admin/run-backtest` — dispara backtest desde UI.
- `POST /api/admin/regrade-backtest-props` — re-evalúa props con stats actualizadas.

---

## 9. Player props resolver

**Archivo:** [server/props-resolver.js](../server/props-resolver.js).

### 9.1 Mercados soportados

| Prop | Cómo se resuelve |
|---|---|
| Hits (batter) | Parsea boxscore play-by-play, cuenta 1B+2B+3B+HR |
| Total Bases | 1B*1 + 2B*2 + 3B*3 + HR*4 |
| HR | Cuenta HR del player en el juego |
| Pitcher K's | Cuenta strikeouts del pitcher |
| RBI | Cuenta RBI del player |
| SB | Cuenta stolen bases |

### 9.2 Líneas

Vienen de The Odds API event-specific endpoint (`/v4/sports/baseball_mlb/events/{eventId}/odds?markets=batter_hits,pitcher_strikeouts`). Consenso de top-3 books.

### 9.3 Limitaciones

- No soporta F5 (First 5 innings) — ni odds ni resolver.
- No soporta alternate lines (ej. "Aaron Judge Over 1.5 Hits"). Solo la línea principal.
- Cobertura de props varía por book y día.

Plan: añadir F5 + alternates en backlog Tier A.

---

## 10. Plan: modelo Python entrenado propio

**Foco actual del roadmap.** Detalle en [docs/roadmap.md](roadmap.md) y plan completo en [.claude/plans/quiero-que-analices-todo-cuddly-tome.md](../.claude/plans/quiero-que-analices-todo-cuddly-tome.md) (plan vivo, evoluciona).

### 10.1 Por qué

- Tenemos >500 picks resueltos con features persistidos. Dataset listo.
- El "XGBoost validator" actual no es ML real — es heurística.
- Un modelo entrenado:
  - Captura interacciones no-lineales que un peso hardcoded no.
  - Produce probabilidad calibrada (Platt + isotonic).
  - Provee SHAP feature importance — explicable.
  - Permite ensemble real (Claude + Grok + modelo entrenado pesados por mercado).
  - Se reentrena automáticamente con nueva data.

### 10.2 Sprint 1 — cerrar gaps del dataset

**Migración** (función nueva en [server/migrate.js](../server/migrate.js)):

```sql
-- Scores reales del juego
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_score INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_score INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS total_runs INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS winner_team_id INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS game_status VARCHAR(32);

-- Pick estructurado
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS market_type VARCHAR(16);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS side VARCHAR(16);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS line NUMERIC(6,2);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_kind VARCHAR(16);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_id INTEGER;

-- Features temporales/contextuales
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pitcher_days_rest INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pitcher_days_rest INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pitcher_pitches_last_start INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pitcher_pitches_last_start INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_bullpen_pitches_last_3d INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_bullpen_pitches_last_3d INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_day_game BOOLEAN;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_dome BOOLEAN;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS game_number_in_series INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS umpire_id INTEGER;

-- Versionado y source
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS oracle_model VARCHAR(48);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS oracle_confidence INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS kelly_fraction NUMERIC(6,4);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'live';
```

**Código nuevo (ESM Node)**:
- `server/services/pickPostgameEnricher.js` — hook al resolver: para cada pick resuelto sin scores, fetch MLB API y rellena.
- `server/parsers/pickParser.js` — parsea texto del pick a `{market_type, side, line, prop_kind, prop_player_id}`. Con tests unitarios cubriendo ML/RL/OU/props (30+ casos).
- `scripts/training/backfill-pick-features.js` — recorre histórico y rellena columnas nuevas.
- `scripts/training/export-dataset.js` — exporta JOIN de `pick_features` + `picks` a `data/picks-dataset-YYYY-MM-DD.parquet` (+ CSV fallback).

**Criterio de éxito**: `SELECT COUNT(*) FROM pick_features WHERE result IS NOT NULL AND home_score IS NULL` = 0.

### 10.3 Sprint 2 — sidecar Python

**Estructura nueva**:

```
hexa-v4/
├── ml/                              ← carpeta nueva
│   ├── pyproject.toml               poetry, Python 3.11+
│   ├── Dockerfile                   multi-stage, python:3.11-slim
│   ├── railway.json                 servicio separado en Railway
│   ├── hexa_ml/
│   │   ├── serve.py                 FastAPI app
│   │   ├── train.py                 training entrypoint (cron)
│   │   ├── predict.py               inference logic
│   │   ├── features.py              feature engineering
│   │   ├── data.py                  Postgres/Parquet loader
│   │   ├── models/
│   │   │   ├── moneyline.py         XGBClassifier ML
│   │   │   ├── overunder.py         XGBClassifier OU
│   │   │   ├── runline.py           XGBClassifier RL
│   │   │   └── ensemble.py          LogReg meta-learner
│   │   └── calibration.py           Platt + isotonic + Brier
│   ├── tests/
│   │   ├── test_features.py
│   │   ├── test_predict.py
│   │   └── test_calibration.py
│   └── README.md
```

**Endpoints FastAPI**:

| Endpoint | Propósito |
|---|---|
| `GET /health` | `{status, model_version, last_trained_at}` |
| `POST /predict/moneyline` | `{prob_home_win, confidence, shap_top5}` |
| `POST /predict/overunder` | `{prob_over, prob_under, expected_total, confidence}` |
| `POST /predict/runline` | `{prob_home_covers, prob_away_covers, confidence}` |
| `POST /predict/batch` | array de games → array de predicciones |
| `GET /calibration` | curva de calibración del último mes |
| `POST /retrain` | admin, dispara training fresh (también vía cron) |

**Training pipeline** (`train.py`):
1. Cargar dataset (Postgres SQLAlchemy o último Parquet).
2. Filtrar `source = 'live'`, descartar push/void, solo picks resueltos.
3. Split temporal (no random): train = picks anteriores a `today - 30d`, test = últimos 30 días.
4. Feature engineering: encoding de categóricas, interacciones (pitcher_xwoba × park_factor), rolling aggregates.
5. Train 3 modelos separados (ML, OU, RL) con XGBClassifier + GridSearch reducido.
6. Calibración Platt scaling.
7. Evaluación: Brier score, log loss, ROI Kelly-25 simulado, |predicted − actual| por bucket.
8. Smoke test antes de promover modelo nuevo.

**Deploy Railway**:
- Servicio `hexa-ml`, mismo `DATABASE_URL` (read-only).
- Variables Node: `HEXA_ML_API_URL`, `HEXA_ML_INTERNAL_TOKEN`.

**Cron retrain**: GitHub Actions `retrain-weekly.yml` cada domingo 06:00 UTC.

**Criterios de éxito**:
- Brier score moneyline < 0.24 en test set.
- ROI simulado positivo con Kelly-25 fraccional.
- Latencia `POST /predict/batch` con 10 juegos < 500ms.

### 10.4 Sprint 3 — integración Node ↔ Python

- `server/services/mlModelClient.js` (nuevo): HTTP client con timeout 500ms, retry simple, circuit breaker (3 fallos en 5min → marca down → fallback al validator legacy).
- `server/services/shadow-model.js`: extender para guardar **ambos** scores (validator simulado + python model) en `shadow_model_runs`. Migración: `ADD COLUMN python_model_score, python_model_version`.
- Endpoint admin `GET /api/admin/ml-calibration` (proxy del `/calibration`).
- Dashboard frontend `client/src/pages/MLCalibrationDashboard.jsx`: scatter plot Recharts predicted vs actual, ROI rolling 30d, comparación LLM vs Python model.

**Guardrail**: feature flag `ML_SIDECAR_ENABLED=false` por default. El Oracle nunca depende del sidecar — sólo se anota como observabilidad.

### 10.5 Sprint 4 (opcional) — ensemble real

Solo si la calibración del Sprint 3 confirma que el modelo Python aporta señal independiente.

- `ml/hexa_ml/models/ensemble.py`: LogisticRegression entrenado sobre `shadow_model_runs` con las 3 fuentes (claude, grok, python).
- Output: peso por (mercado, fuente).
- Endpoint `POST /predict/ensemble`.
- Node: nuevo endpoint `/api/analyze/game-ensemble`, no toca `oracle.js`. Feature flag `ENSEMBLE_ENABLED=false`.

**Criterio**: Brier ensemble < Brier de cualquier fuente individual.

### 10.6 Roadmap más allá

Para cuando el modelo entrenado esté en producción:

- **FanGraphs ZiPS scraper** (Python en sidecar): proyecciones rest-of-season como features adicionales.
- **pgvector + embeddings de oracle_report**: RAG sobre análisis pasados similares antes de inyectar en prompt.
- **F5 (First 5 innings) market**: odds + resolver.
- **Player Props dedicated UI** + alternate lines.
- **Expansión NBA**: replicar pipeline en NBA con `context-builder-nba.js`. Pre-requisito: validar arquitectura en MLB primero.

Lista completa priorizada por ROI en [docs/roadmap.md](roadmap.md).

---

## 11. Métricas que importa trackear

Para evaluar la pila ML como un todo:

### 11.1 Calibración
Cuando el modelo dice "prob = 60%", ¿acierta ~60% de las veces?
- Bucketizar predicciones en 10 buckets de 10%.
- `|predicted − actual| < 5%` en cada bucket con ≥20 picks = bien calibrado.
- Visualizar curva en `MLCalibrationDashboard`.

### 11.2 Brier Score
Mean squared error de probabilidad. Más bajo = mejor.
- Baseline (predecir 50% siempre): 0.25.
- Bueno para sports betting MLB: < 0.22.

### 11.3 Log Loss
Penaliza más fuerte predicciones confiadas y equivocadas. Útil para detectar overconfidence.

### 11.4 ROI Kelly-25 simulado
Para cada pick: `stake = max(0, kelly * 0.25 * bankroll)`. Si gana, suma `stake × (decimal_odds - 1)`. Si pierde, resta `stake`. Reportado por semana, mes, total.

### 11.5 CLV positive rate
% de picks con CLV positivo. Métrica más robusta de edge.

### 11.6 Divergence rate (Claude vs Grok)
Cuando divergen: ¿quién acierta más? Indica cuál de los dos es más confiable para cada tipo de mercado.

### 11.7 LLM override rate (Parlay Synergy)
% de veces que el LLM Architect modifica la propuesta del composer. Si > 50%, el composer está mal calibrado.

### 11.8 Postmortem signal
Patrones en `picks.postmortem` (JSONB): qué alert_flags aparecen en picks perdedores más que en ganadores. Input para refinar el SYSTEM_PROMPT.

---

**Última actualización del documento**: con Sprint 0 completado. Próximas secciones (Python sidecar, ensemble) se actualizan al cierre de cada sprint correspondiente.
