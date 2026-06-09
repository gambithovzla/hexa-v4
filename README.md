# H.E.X.A. v4

**H.E.X.A.** (Heuristic Evaluation & eXpert Analytics) es una plataforma de análisis predictivo de **MLB, NBA, NFL, NHL y Soccer** (5 deportes activos) que combina modelos de lenguaje (Claude y Grok/xAI), estadísticas avanzadas (Statcast/Savant para MLB; ratings avanzados + pace + rest para NBA; EPA, success rate, PROE para NFL; goal diff + special teams + goalie para NHL; xG + perfil de liga + mercado 3-vías para Soccer), líneas en tiempo real y un pipeline ML propio (XGBoost + ensemble) para producir picks, parlays, análisis "safe", contenido editorial y el modo "Pick Imperdible".

Monorepo: API Node/Express + Postgres · cliente React/Vite · sidecar Python FastAPI+XGBoost.

```
┌────────────────────────┐        ┌─────────────────────────┐        ┌─────────────────────────┐
│  client/  (React+Vite) │◄──────►│  server/  (Express API) │◄──────►│  ml/  (FastAPI+XGBoost) │
│  MUI · Recharts · PWA  │  HTTP  │  Node 20 · ESM modules  │  HTTP  │  Python 3.11 · Railway  │
└────────────────────────┘        └───────────┬─────────────┘        └─────────────────────────┘
                                              │
        ┌──────────────┬──────────┬───────────┼────────────┬──────────────┬──────────┐
        ▼              ▼          ▼           ▼            ▼              ▼          ▼
   PostgreSQL    Anthropic API  xAI (Grok)  MLB Stats   NBA/NFL/NHL   Odds API   Resend
   (pg pool)     (Claude 4.x)  grok-4-fast  + Savant   Soccer ESPN    dual-key   (email)
```

---

## 📚 Documentación

| Doc | Cubre |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Subsistemas, diagrama, flujos críticos, decisiones arquitectónicas |
| [docs/ml-pipeline.md](docs/ml-pipeline.md) | Oracle dual LLM, shadow validator, feature store, CLV, pipeline XGBoost |
| [docs/integrations.md](docs/integrations.md) | APIs externas (Claude, xAI, MLB, Savant, NBA/NFL ESPN, Odds, Weather, Resend, NowPayments, X) |
| [docs/content-pipeline.md](docs/content-pipeline.md) | Generación de drafts, cola editorial, OAuth 1.0a publisher para X |
| [docs/admin-and-ops.md](docs/admin-and-ops.md) | DB explorer, backtest, jobs, logging, deployment, monitoring |
| [docs/data-schema.md](docs/data-schema.md) | Tablas Postgres — columnas, índices, FKs, estado para training |
| [docs/roadmap.md](docs/roadmap.md) | Estado de sprints y backlog priorizado |
| [docs/nfl-architecture.md](docs/nfl-architecture.md) | Spec técnica NFL — data sources, Oracle, ML sidecar, live mapping |
| [docs/nfl-roadmap.md](docs/nfl-roadmap.md) | Roadmap Sprint 9 por sub-sprint (9a–9j + 9.3 completos: Oracle, lifecycle, ML, props, board, parlay) |
| [docs/tennis-architecture.md](docs/tennis-architecture.md) | Spec técnica Tennis (Sprint 12) — deporte individual, ELO-surface, resolver de retiros |
| [docs/tennis-roadmap.md](docs/tennis-roadmap.md) | Roadmap Sprint 12 por sub-sprint (12a–12e, 📋 planning) |
| [docs/sport-registry.md](docs/sport-registry.md) | Sport shell, capability matrix y checklist para escalar a nuevos deportes |

Para Claude Code (convenciones, frozen files, patrones): ver [CLAUDE.md](CLAUDE.md).  
Para el motor Parlay Synergy: ver [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md).

---

## Requisitos previos

- **Node.js 20+** (ESM, `node --watch`)
- **PostgreSQL 14+**
- **Python 3.11+** (solo para el sidecar ML local; en prod corre en Railway separado)
- API keys mínimas: Anthropic (Claude). Opcionales: xAI, The Odds API, Resend, NowPayments, X.

---

## Setup local

```bash
# 1. Clonar e instalar
git clone <repo-url> hexa-v4 && cd hexa-v4
npm install
cd client && npm install && cd ..

# 2. Configurar entorno
cp .env.example .env
# editar .env con tus keys y DATABASE_URL

# 3. Crear DB Postgres (una vez)
createdb hexadb

# 4. Iniciar (migraciones corren automáticamente)
npm run dev:all   # API :3001 + Vite :5173 en paralelo
```

Sidecar ML (opcional local):
```bash
cd ml && pip install -e ".[dev]" && uvicorn hexa_ml.serve:app --port 8000
```

---

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí | Claude |
| `DATABASE_URL` | Sí | Connection string Postgres |
| `JWT_SECRET` | Sí | Firma de tokens (cambiar en prod) |
| `ODDS_API_KEY` | Para cuotas reales | The Odds API — MLB, NBA y NFL |
| `XAI_API_KEY` | No | Grok / modo dual |
| `RESEND_API_KEY` | No | Email verificado |
| `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` | No | Pagos cripto |
| `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | No | OAuth 1.0a para publicar en X |
| `SHADOW_MODE_ENABLED` | No | Shadow validator activo |
| `PARLAY_SYNERGY_ENABLED` | No | Motor parlay (default `false`) |
| `NBA_ANALYSIS_ENABLED` | No | Oracle NBA + resolver (default `false`) |
| `NFL_ANALYSIS_ENABLED` | No | Oracle NFL + resolver (default `false`; activo en Railway con `=true`) |
| `IMPERDIBLE_ENABLED` | No | Pick Imperdible admin-only MLB (default `false`) |
| `IMPERDIBLE_NFL_ENABLED` | No | NFL Pick Imperdible admin-only (default `false`; gate QB confirmado) |
| `VITE_NFL_LIVE_TRACKER_ENABLED` | No | (cliente) toggle del tab Live NFL (default ENABLED) |
| `ML_SIDECAR_ENABLED` | No | Llamadas al sidecar Python XGBoost |
| `HEXA_ML_API_URL` | Con sidecar | URL base del sidecar Railway |
| `HEXA_ML_INTERNAL_TOKEN` | Con sidecar | Token auth Node→Python |
| `X_AUTO_PUBLISH_ENABLED` | No | Worker publicación X (`0`/`1`) |
| `MLB_PROPS_ML_PUBLIC_ENABLED` | No | Scores ML visibles en `/props` para no-admin |
| `CHAT_EXTRACTOR_HAIKU_FALLBACK` | No | Fallback Haiku extractor de chat (default `1`) |
| `ML_ADMIN_TIMEOUT_MS` | No | Timeout sidecar en analyze admin (default `2500`) |

Lista completa en [.env.example](.env.example) y [docs/integrations.md](docs/integrations.md).

---

## Scripts disponibles

Desde la raíz:

| Script | Descripción |
|---|---|
| `npm run dev` | API con `node --watch` |
| `npm start` | API producción |
| `npm run client` | Vite dev server |
| `npm run dev:all` | API + cliente en paralelo |
| `npm run audit` | Diagnóstico del sistema |
| `npm run smoke:mlb` | Smoke test release MLB |
| `npm run smoke:nba` | Smoke test release NBA |
| `npm run test:mlb:critical` | Suite anti-regresión MLB |
| `npm run verify:ml:persistence` | Valida `/health` del sidecar ML en prod |
| `npm run test:parlay` | Tests Parlay Synergy Engine |

---

## Estructura del repo

```
hexa-v4/
├── client/                 React 18 + Vite SPA (MUI, Recharts, PWA)
├── server/
│   ├── index.js            entrypoint (rutas, jobs, rate limits)
│   ├── oracle.js           motor LLM dual MLB (Claude + Grok) — FROZEN
│   ├── context-builder.js  payload de contexto MLB — FROZEN
│   ├── migrate.js          migraciones SQL embebidas (idempotentes)
│   ├── nba-api.js / nba-context-builder.js / nba-odds.js
│   ├── nfl-api.js / nfl-context-builder.js / nfl-odds.js / nfl-team-map.js
│   ├── pick-resolver.js / pick-resolver-nba.js / pick-resolver-nfl.js
│   ├── pick-tracker.js / pick-tracker-nfl.js
│   ├── services/           oracleNba, oracleNfl, shadow*, imperdible*, parlay*, ML clients
│   ├── routes/             picks, nba, nfl, mlb-props, content, imperdible, admin-ml
│   └── prompts/            oracle-nba-prompts, oracle-nfl-prompts, x-content-prompts
├── ml/                     sidecar Python FastAPI + XGBoost (Railway separado)
│   ├── hexa_ml/            serve, train, predict, features, models (MLB+NBA+NFL)
│   └── Dockerfile
├── scripts/
│   ├── system-audit.js
│   └── training/           backfill-pick-features, export-dataset, run-backtest
├── docs/                   documentación viva por tema
├── CLAUDE.md               convenciones para Claude Code
├── .env.example
├── railway.json
└── README.md
```

---

## Endpoints principales

Todos bajo `/api`. Protegidos con JWT (`🔒`); admin requieren rol admin (`👑`).

- **Públicos**: `/games`, `/teams`, `/odds/today`, `/hexa/board`, `/nba/games`, `/nba/teams`, `/nba/board`, `/nfl/games`, `/nfl/teams`, `/nfl/standings`, `/nfl/board`, `/soccer/board`.
- **Auth** (`/auth/*`): register, login, me, verify-email, forgot-password.
- **Análisis MLB** (`/analyze/*`) 🔒: game, parlay, safe, parlay-synergy (👑 beta).
- **Análisis NBA** (`/nba/analyze/*`) 👑 (feature-flagged): game, chat.
- **Análisis NFL** (`/nfl/analyze/*`) 👑 (feature-flagged `NFL_ANALYSIS_ENABLED`): game, chat. Parlay NFL: `/nfl/parlay` 👑 (`PARLAY_SYNERGY_NFL_ENABLED`).
- **Picks** (`/picks/*`) 🔒: CRUD, postmortem, live-progress, clv-stats.
- **Player Props** — MLB (`/mlb/props/board`) 🔒: Odds API + Savant + ML scores admin. NFL (`/nfl/props/board`) 👑 (`NFL_PROPS_ENABLED`): Odds API event endpoint + Fair % de-vig + modelo `nfl_prop`.
- **Admin** (`/admin/*`) 👑: shadow-model (`?sport=mlb|nba|nfl`), feature-store, ml/status, ml/retrain, ml/ensemble, db/tables, content/queue, imperdible.
- **Pagos** (`/nowpayments/*`): checkout + IPN HMAC-SHA512.
- **Content API** (API key pública): `/content/v1/games`, `/board`, `/picks`, `/performance`.

---

## Features destacadas

### Oracle multi-motor (MLB/NBA/NFL/NHL/Soccer)
- **MLB**: [oracle.js](server/oracle.js) — dual Claude + Grok, contexto rico con Statcast/Savant (rolling wOBA, CSW%, bat speed, umpire, bullpen ERA/WHIP individual, schedule fatigue, starts trend del pitcher, lessons learned de postmortems, line movement con steam/RLM, lineup proyectado cuando no hay confirmado). FROZEN.
- **NBA**: [services/oracleNba.js](server/services/oracleNba.js) — Anthropic-only, net/off/def rating, pace, TS%, rest, injuries ESPN. Cap 68%.
- **NFL**: [services/oracleNfl.js](server/services/oracleNfl.js) — Anthropic-only, EPA, success rate, PROE, **red zone TD%**, **3rd-down conv%**, **sack rate off/def**, QB status + backup QB, rest/short-week/off-bye + fatiga acumulativa, surface (turf/grass) + altitude (Denver 5,280ft), weather (no-dome), spread primario con key numbers 3/7, **8-signal coherence voting**. Cap 72%.
- **NHL**: [services/oracleNhl.js](server/services/oracleNhl.js) — Anthropic-only, moneyline primario + puck line ±1.5, goal diff, special teams (PP%/PK%), goalie confirmado, rest/B2B. Cap 70%.
- **Soccer**: [services/oracleSoccer.js](server/services/oracleSoccer.js) — Anthropic-only, mercado **3-vías** (1X2 + OU 2.5 + BTTS), form, goal diff, perfil de liga (avgGoals/drawPct/style), xG Understat (Big 5). Cap 62% (el más bajo — mercado más eficiente). 6 ligas (EPL, La Liga, Serie A, Bundesliga, Ligue 1, MLS).

### Soccer — parity roadmap (Sprint 11.2–11.9, planificado)
Soccer pasó el MVP (Oracle 3-vías, lifecycle, UI 5-deportes, board, live tracker, xG, sidecar scaffolded) pero le faltan los pilares de profundidad de MLB. Plan para cerrar la brecha (ver [docs/roadmap.md](docs/roadmap.md) y [CLAUDE.md](CLAUDE.md)):
- **11.2** ✅ ML pre-training histórico ([soccer_history_loader.py](ml/hexa_ml/soccer_history_loader.py)): football-data.co.uk (resultados + closing odds 1X2, 5 ligas europeas) → modelos `soccer_*` entrenables sin esperar temporada, análogo nflverse. Flags `SOCCER_PRETRAIN_*`.
- **11.3** profundidad de contexto pregame: 🟢 **lineups/injuries/suspensiones + weather + H2H/árbitro + congestión/rotación + splits local/visitante** ✅ ([soccer-lineups-api.js](server/soccer-lineups-api.js) vía API-Football api-sports.io, `API_FOOTBALL_KEY`; [soccer-weather-api.js](server/soccer-weather-api.js) vía Open-Meteo sin key). Pendiente: árbitro con tendencias de tarjetas, FBref (PPDA/pases progresivos), xG rolling 7d/14d, motivación/stakes.
- **11.4** ✅ xG cableado: `soccerShadowPersistence` persiste xG/xGA reales de Understat (era null) → dataset con xG; `soccerShadowValidator` suma señal `xgAdvantage` con re-weighting sobre señales presentes.
- **11.5** 🟡 player props — fundación (parser + resolver de boxscore ESPN) en [soccer-props-resolver.js](server/soccer-props-resolver.js); pendiente in-season: odds/board/modelo/UI. **11.6** ✅ parlay (`soccerParlayCandidates.js` → motor frozen; `POST /api/soccer/parlay`, flag `PARLAY_SYNERGY_SOCCER_ENABLED`). **11.7** ✅ Imperdible Soccer (lock-of-the-slate; `soccerImperdible{Selector,Engine,Arbiter}.js` + `routes/soccer-imperdible.js`, flag `IMPERDIBLE_SOCCER_ENABLED`). **11.8** 🟡 CLV ([closing-line-capture-soccer.js](server/closing-line-capture-soccer.js)) + postmortem sport-aware; ensemble pendiente. **11.9** 🟡 smart signals ([hexaSoccerSignalsService.js](server/services/hexaSoccerSignalsService.js), en `meta.signals` de analyze) + ascensos/descensos pendientes.

### Pipeline ML propio (XGBoost + ensemble)
Sidecar Python en `ml/` — desplegado en Railway como servicio independiente.
- **Mercados MLB activos**: moneyline (Brier 0.205, ROI +18.3%), overunder (Brier 0.138, ROI +8.5%), runline, prop.
- **Mercados NFL activos**: `nfl_moneyline` (Brier ~0.234), `nfl_spread` (~0.25), `nfl_total` (~0.25) — pre-entrenados con 8 temporadas nflverse (2,622 filas) vía `pyarrow`; se refinan con picks reales en temporada. `nfl_prop` (pooled, pick-aligned) con features player-level nflverse — entrena con picks live resueltos en temporada.
- **Ensemble**: meta-learner LogReg (Oracle + Legacy + Python) en logit space.
- **Admin ML Control Center** (`/admin/ml-control`): HUD live (circuit breaker, latencia, modelos cargados), retrain on-demand por mercado/ensemble/all, per-pick ensemble breakdown badge, retrain audit log.

### Shadow validator (MLB/NBA/NFL)
Validator determinístico por deporte — corre en paralelo al Oracle, persiste `shadow_model_runs` con `sport='mlb|nba|nfl'`. Cada pick almacena también `python_pick_prob` del sidecar (pick-aligned al mismo mercado). Dashboard en `/admin/shadow`.

### Pizarra del día — tres deportes
- **MLB** (`/hexa/board`): señales rule-based sobre datos MLB API, 15+ juegos, 29 tipos de señal.
- **NBA**: board lightweight con ratings, form y resto por equipo.
- **NFL**: placeholder hasta temporada sept 2026 — UI activa con selector, board real pendiente.

### Pick Imperdible (`/admin/imperdible`)
Modo admin-only "lock of the slate" (MLB): analiza N juegos y devuelve **un solo** pick de máxima convicción (o PASS). Premia el acuerdo modelo+mercado+ML, penaliza varianza, exige lineup confirmado. Gate duro + árbitro Opus. Feature-flag `IMPERDIBLE_ENABLED`.

### Parlay Synergy Engine
Motor combinatorial para parlays con 5 modos (safe → dreamer). Correlación entre patas, game-script coherence, hit distribution Poisson-binomial. Admin beta. Brief: [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md).

### Admin ML Control Center (`/admin/ml-control`)
Dashboard único admin-only para operar el pipeline ML. Muestra el estado del sidecar Python en vivo (circuit breaker, latencia, **models loaded X/Y**, estado ensemble LIVE/READY/OFF), panel de **inferencia en vivo** por mercado (artefacto en disco, modelo en RAM, runline skipped/early), Brier/ROI/n_train por mercado, reliability diagrams, rolling 30d legacy-vs-python, pesos del ensemble meta-learner, audit log de retrains, y panel **CLV — Closing Line Value** por mercado y bucket de confianza (CLV positivo sostenido = edge real; negativo sistemático = matar ese mercado). El toast "ENSEMBLE OMITIDO" muestra desglose por mercado (`moneyline: N/50 · overunder: N/50 · …`) — el sidecar entrena por mercado individualmente, no sobre el total.

### MLB Player Props (`/props`)
Líneas Odds API + enriquecimiento Savant + edge vs implied. Picks Oracle guardados antes de que existan líneas en el mercado. Parser en español (`Bajo 4.5 Ponches`). ML scores gateados por `MLB_PROPS_ML_PUBLIC_ENABLED`.

### Oracle Chat → Training pipeline
Picks recomendados en chat se persisten con `source='oracle_chat'` (aislados del training default `source='live'`). JSON tail + Haiku fallback. Panel "Chat-sourced picks" en `/admin/ml-control`. Opt-out: header `X-HEXA-Skip-Pick-Extract: 1`.

### Content pipeline X
Drafts editoriales con Claude Haiku, cola editorial, publicación vía OAuth 1.0a HMAC-SHA1. Detalle: [docs/content-pipeline.md](docs/content-pipeline.md).

---

## Estado del proyecto (2026-06-09)

### Pipeline ML y sprints completados

- ✅ **Sprint 0–4**: Documentación → Dataset → Sidecar Python → Integración Node↔Python → Ensemble meta-learner.
- ✅ **Sprint 5**: Admin ML Control Center, Player Props MLB, pick-aligned shadow, `mlOpinion` admin.
- ✅ **Sprint 6**: Equity/Sharpe/drawdown, comparativa bankroll, persistencia ML Railway Volumes.
- ✅ **Sprint 8a**: Monte Carlo bankroll. Brand League × Kinetic v2.6.
- ✅ **Sprint 8b**: Pick Imperdible (PR #355) — scorer de convicción, gate, árbitro Opus, tabla `imperdible_runs`.
- ✅ **Sprint 8c**: Ensemble multi-mercado (moneyline+overunder+runline+prop pick-aligned). Parlay alt lines realistas (±2/±3.5). Oracle Chat pick null-line fix.
- ✅ **Sprint 8d**: Oracle context enrichment MLB — Savant pitcher/batter rolling, umpire, bullpen ERA/WHIP individual + handedness, team form block, schedule fatigue.
- ✅ **Sprint 8e**: Bullpen attribution guardrail — `[TeamName]` en línea crítica, mismatch detection server-side.
- ✅ **Sprint 8f**: Railway hardening — Node 20, Sentry/email/Discord lazy import, tres servicios Online.
- ✅ **Sprint 8g — MLB effectiveness layer** (2026-06-09): lineup `partial` status (un solo lineup publicado ya no marca "confirmado"; chip `½ FALTA <ABBR>` por juego) + **lineup proyectado fallback** (batting order del último juego cuando no hay lineup, etiquetado PROJECTED); **ORACLE LESSONS LEARNED** (postmortems agregados al contexto — feedback loop); **calibración de confianza** (`picks.calibrated_confidence`, shrinkage hacia win rate real por mercado+bucket); **reporte CLV** admin por mercado y bucket (`GET /api/admin/ml/clv-report` + panel); **conviction tier** (`picks.conviction_tier` — acuerdo Oracle+validador+sidecar, badge `⬢ 3/3` en historial); **line movement v2** (per-book, steam `sustained_move_pct`, reverse line movement); **starts trend** del pitcher (últimas 5 salidas). Fix latente: el bloque RAG `SIMILAR PAST ANALYSES` nunca llegaba al Oracle (`contextString` const + TypeError silencioso) — activado.
- ✅ **Sprint 9 NFL completo** (PRs #373–#378, 2026-05-30):
  - **9a**: `nfl-api.js`, `nfl-team-map.js`, `nfl-context-builder.js`, `nfl-odds.js`, migraciones DB, endpoints `GET /api/nfl/games|teams|standings`.
  - **9b**: `oracleNfl.js` + `oracle-nfl-prompts.js` + `nflOutputGuard.js`. Cap 72%, key numbers 3/7, QB gate, guardrail anti-hallucination.
  - **9c**: `routes/nfl.js` (`POST /api/nfl/analyze/game|chat`), `pick-resolver-nfl.js`, job game-time-aware Thu/Sun/Mon.
  - **9.1**: `nflShadowValidator.js` + `nflShadowPersistence.js` — dataset/shadow con `sport='nfl'`.
  - **9.2**: `pick-tracker-nfl.js` + `NflLiveTracker.jsx` — SSE per-game, drives + plays + win probability.
  - **9d**: `GameSelector` + `AnalysisPanel` + `HexaBoard` extendidos a NFL; `nflLogoUrl.js`; `sports.js` con `ACTIVE_SPORTS=['mlb','nba','nfl']`.
  - **9e**: `nflMlClient.js` (circuit breaker propio) + modelos `nfl_moneyline`/`nfl_spread`/`nfl_total` en sidecar Python.
- ✅ **Sprint 9.3 — nflverse pre-training** (2026-06-06): cierra la brecha #1 de calidad NFL (EPA = el Statcast del fútbol americano).
  - `ml/hexa_ml/nflverse_loader.py` (NEW): descarga parquet pbp de nflverse via `pyarrow` (NO `nfl_data_py`), computa EPA off/def, success rate, PROE por equipo; dataset histórico sin leakage (as-of-week); 8 temporadas, 2,622 filas.
  - `ml/hexa_ml/serve.py`: `GET /nfl/team-stats?season=` + `POST /nfl/refresh`.
  - `ml/hexa_ml/train.py`: concatena picks live + historia nflverse por mercado; `NFL_PRETRAIN_ENABLED`/`NFL_PRETRAIN_SEASONS`.
  - `server/nfl-advanced-fetcher.js` (NEW): análogo NFL de `savant-fetcher.js` — EPA/PROE desde el sidecar, re-keyed a abbr ESPN (WAS→WSH, LA→LAR), cache 6h, stale fallback.
  - `server/nfl-context-builder.js`: EPA/success/PROE ya NO son null; `context_meta.sources.advancedStats` expone freshness.
  - **Resultado**: 3 modelos NFL vivos en producción (nfl_moneyline Brier ~0.234, nfl_spread ~0.25, nfl_total ~0.25). Dep nueva: `pyarrow==18.1.0`.
- ✅ **Sprint 9.4 — NFL precision parity** (2026-06-07): cierra las brechas de situacional, trenches, superficie/altitud y coherencia de señales.
  - `ml/hexa_ml/nflverse_loader.py`: 6 nuevos campos desde play-by-play — `red_zone_td_pct_off/def` (% jugadas RZ → TD), `third_down_conv_off/def` (tasa conversión 3er down), `sack_rate_off/def` (sacks por dropback). Helpers `_red_zone_stats`, `_third_down_stats`, `_trench_stats`.
  - `server/nfl-team-map.js`: todos los 32 estadios con `surface` (turf/grass) y `altitude` (ft ASL). `getNflStadium` expone ambos. Denver 5,280ft marcado.
  - `server/nfl-context-builder.js`: `buildTeamBlock` incluye los 6 nuevos campos nflverse; `buildFatigueBlock` (fatiga acumulativa — games/14d, road games, días consecutivos, espejo MLB `buildScheduleFatigueBlock`); `detectBackupQb` (detecta QB de respaldo cuando el titular está en duda); weather block lleva surface + altitude; completeness reformulado con `situationalStats` (12%) + `trenchStats` (10%).
  - `server/services/nflShadowValidator.js`: `situationalAdvantage` (RZ TD% + 3rd-down) al 14%; `trenchesAdvantage` (sack rate diff) al 10%. Pesos rebalanceados. Breakdown expone `sitAdv` + `trAdv`.
  - `server/services/oracleNfl.js`: `describeEfficiencyDeltas` — bloque comparativo con dirección HOME/AWAY; `describeBackupQb`; venue block incluye surface + altitude.
  - `server/prompts/oracle-nfl-prompts.js`: umbrales calibrados RZ/3rd-down/sack rate; **Signal Coherence** (8 señales votando, modifica confianza ±1→+6%); 5 nuevos alert flags (altitud, trench mismatch, RZ gap, baja coherencia, fatiga); oracle_report requiere "N/8 signals aligned" en EDGE MATH.
- ✅ **Sprint 9.5 — NFL ops gaps off-season** (2026-06-07): cierra las brechas operacionales NFL que no requerían temporada. Cero ediciones a frozen.
  - **Parlay model enrichment**: `POST /api/nfl/parlay` conecta los 3 modelos pre-entrenados nflverse vía el nuevo `predictNflGameModel(context, gameMeta, marketOdds)` (`server/services/nflMlClient.js`) — fin del `model:null`; per-leg cae al de-vig cuando el sidecar está caído. Respuesta expone `modelEnriched`. Fix: `buildNflFeaturePayload` lee `qbStatus.statusKey` (antes `String(obj)` marcaba todo QB lesionado como activo).
  - **Live tracker flag**: `VITE_NFL_LIVE_TRACKER_ENABLED` (default ENABLED) controla el tab Live NFL en `sportCapabilities.js`.
  - **Imperdible NFL** (`IMPERDIBLE_NFL_ENABLED`, admin-only): lock-of-the-slate NFL. Gate **QB confirmado** (no lineup); convicción = modelo sidecar (0.45) + mercado de-vig (0.30) + shadow validator independiente (0.25, moneyline). `requireModelCertified` (sin modelo sidecar → no hay lock). Arbiter Opus con prompt NFL. Archivos `nflImperdible{Selector,Engine,Arbiter}.js` + `nfl-imperdible-prompts.js` + `routes/nfl-imperdible.js`. Persiste `picks` (`sport='nfl'`) + `imperdible_runs` (`sport='nfl'`). +15 tests. Thresholds necesitan calibración in-season.
- ✅ **Sprint 9.6 — NFL off-season precision fixes** (2026-06-07): tres mejoras de calidad que no requieren temporada. Cero ediciones a frozen.
  - **Advanced-stats season fallback** (`nfl-advanced-fetcher.js`): `getNflAdvancedTeamStats(season, { maxLookback })` camina un año atrás cuando la temporada pedida no tiene PBP nflverse aún (off-season / pre-Week 2) — usa los agregados de la última temporada completa en vez de dejar EPA/success/PROE en null. `isFallback`/`requestedSeason` en `context_meta.sources.advancedStats` + stale flag `advanced_stats_prior_season`.
  - **Fix bug de fatiga** (`nfl-context-builder.js`): `consecutiveDaysPlayed` marcaba todo partido como fatiga (contaba gaps Thu/Sun/Mon ≤4d como racha; la NFL nunca juega días consecutivos). Reemplazado por `shortRestGames` (≤6 días de descanso en ventana 14d); `oracleNfl.js` muestra tag `SHORT REST`.
  - **Shadow validator re-weighting** (`nflShadowValidator.js`): señales ausentes retornan null y su peso se redistribuye sobre las presentes en vez de inyectar un 0.5 neutro que aplanaba off-season a coin-flip (situational+trenches = 24% colapsaban). Nuevo `breakdown.signalCoverage`. +7 tests.

### Estado en producción

- Sidecar ML: `https://hexa-ml-production.up.railway.app`
- Modelos activos **MLB**: **moneyline** (Brier 0.205) · **overunder** (Brier 0.138) · **runline** (early model) · **prop** (gateado)
- Modelos activos **NFL** (nflverse pre-training, 2,622 filas): **nfl_moneyline** (Brier ~0.234) · **nfl_spread** (~0.25) · **nfl_total** (~0.25) — vivos desde 2026-06-06
- Reentrenamiento automático: `.github/workflows/retrain-weekly.yml` (domingos 06:00 UTC; requiere secrets `HEXA_ML_API_URL` + `HEXA_ML_INTERNAL_TOKEN`)
- Variables Railway hexa-v4: `NIXPACKS_NODE_VERSION=20` · `ML_SIDECAR_ENABLED=true` · `NFL_ANALYSIS_ENABLED=true`
- Variables Railway Hexa ML: `NFL_PRETRAIN_ENABLED=true` · `NFL_PRETRAIN_SEASONS=` (default últimas 8)

### Pendiente operacional (no requiere sprint de código)

- Props ML gate: ≥50 props resueltos → retrain `prop` model → `MLB_PROPS_ML_PUBLIC_ENABLED=1`.
- Sprint 8g: lessons/calibración/CLV/conviction se activan solos al acumular datos (postmortems, ≥15 picks resueltos por bucket, CLV capturado, shadow runs).
- NBA validación E2E en prod con tráfico real.
- Parlay beta pública: `PARLAY_SYNERGY_ENABLED=true` cuando hit rate validado.
- NFL sept 2026: `hexaNflBoardService` (pizarra del día), picks reales de la temporada → refinar modelos NFL (ya pre-entrenados con nflverse).

### Matriz de calidad por deporte

| Criterio | MLB | NBA | NFL | Gate |
|---|---:|---:|---:|---:|
| Data depth pregame | 9.5 | 6.5 | 8.5 | 8.0 |
| Data quality live | 8.5 | 7.0 | 6.5 | 8.0 |
| Lineup/Injury verification | 9.0 | 7.0 | 7.5 | 8.0 |
| Market coverage | 9.0 | 6.0 | 8.0 | 8.0 |
| Guardrails LLM | 8.5 | 7.5 | 8.5 | 8.0 |
| Pick lifecycle | 9.0 | 7.5 | 7.0 | 8.0 |
| Calibration/ROI observables | 8.5 | 6.0 | 6.5 | 8.0 |
| Isolation por deporte | 8.5 | 8.0 | 8.0 | 8.5 |

NFL post-9.6: EPA/PROE + red zone + 3rd-down + trenches + surface/altitude + signal coherence (9.4); parlay model-driven (3 modelos pre-entrenados), Imperdible NFL (lock-of-the-slate, gate QB) y toggle live tracker (9.5); advanced-stats season fallback + fix bug de fatiga + shadow validator re-ponderado sobre señales presentes (9.6 — el contexto NFL ya es robusto en off-season, no degrada a coin-flip). Data depth alcanza paridad MLB (8.5); market coverage sube a 8.0 (parlay con modelos reales). Calibración del Imperdible y lifecycle mejorarán con picks reales en temporada (sept 2026).

---

## Base de datos y migraciones

Migraciones en [server/migrate.js](server/migrate.js) — corren automáticamente al iniciar el server. SQL idempotente (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Sin herramienta externa.

```bash
# Reset local
dropdb hexadb && createdb hexadb && npm run dev
```

Schema completo: [docs/data-schema.md](docs/data-schema.md).

---

## Despliegue

- **API**: Railway con Nixpacks ([railway.json](railway.json)). `NIXPACKS_NODE_VERSION=20` obligatorio.
- **Cliente**: Vercel ([client/vercel.json](client/vercel.json)).
- **Sidecar ML**: Railway servicio separado ([ml/railway.json](ml/railway.json)).
- **Postgres**: Railway addon o externo (Neon, Supabase) vía `DATABASE_URL`.

Detalle: [docs/admin-and-ops.md](docs/admin-and-ops.md).

---

## Convenciones de contribución

- **Branch main protegida** — siempre en feature branches + PR.
- Commits estilo convencional (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
- **No commitear `.env`** — solo `.env.example`.
- **ESM únicamente**: imports con extensión `.js` explícita.
- **Frozen files** (no modificar sin permiso): `oracle.js`, `context-builder.js`, `market-intelligence.js`, `xgboostValidator.js`, `shadow-model.js`, `parlayEngine/*`, `mlModelClient.js`. Ver [CLAUDE.md](CLAUDE.md).

---

## Licencia

Privado. Todos los derechos reservados.
