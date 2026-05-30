# CLAUDE.md — Guía para Claude Code en H.E.X.A. v4

Este archivo se lee automáticamente al inicio de cada sesión. **Antes de tocar código, leelo entero.** Después, abrir el archivo relevante en `docs/` para profundidad.

---

## TL;DR del proyecto

H.E.X.A. v4 es una plataforma de **análisis predictivo de MLB, NBA y NFL**:

- Motor LLM dual (Claude + Grok) que genera picks con contexto rico (Statcast, weather, park factors, lineups, line movement para MLB; advanced team stats + rest/pace/net-rating para NBA; EPA, success rate, QB status, weather para NFL).
- Pick lifecycle: create → tracking en vivo → resolución automática post-game → postmortem por LLM.
- Pipeline de contenido editorial a X (Twitter) con OAuth 1.0a.
- Monetización con cripto vía NowPayments.
- Frontend React 18 + Vite + MUI con PWA. Sport switcher MLB/NBA/NFL en la tab de juego.
- Deploy: Railway (server) + Vercel (client).

Cubertura completa en [docs/architecture.md](docs/architecture.md).

---

## Estructura

```
hexa-v4/
├── server/        # Node 20 ESM, Express 4, Postgres
├── client/        # React 18, Vite, MUI, PWA
├── scripts/       # audit, training, backup
├── ml/            # microservicio Python ML (FastAPI + XGBoost, deploy separado en Railway)
├── docs/          # documentación viva por tema
├── .env.example   # todas las env vars con comentarios
├── railway.json   # config deploy server
└── README.md      # setup + índice a docs/
```

---

## Stack — lo que NO es obvio del package.json

- **No TypeScript.** ES modules puros (`"type": "module"` en `package.json`). Imports siempre con extensión `.js` explícita.
- **No herramienta de migración externa.** Las migraciones viven en [server/migrate.js](server/migrate.js) como funciones SQL idempotentes (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Se ejecutan al arrancar el server.
- **No queue worker.** Background jobs son `setInterval` en [server/index.js](server/index.js) (Statcast warm-up cada 6h, line snapshots, pick resolver, closing line capture, content auto-publish).
- **No feature flag system.** Solo env vars como toggles (`SHADOW_MODE_ENABLED`, `PARLAY_SYNERGY_ENABLED`, `X_AUTO_PUBLISH_ENABLED`).
- **Sentry opcional via lazy import.** `server/observability.js` carga `@sentry/node` dinámicamente al iniciar solo si `SENTRY_DSN` está definido; si falta el paquete o la variable, el servidor arranca igual y loguea `[observability] SENTRY_DSN not set — Sentry disabled`. Logging base sigue siendo `console.log/warn/error` con prefijos `[module-name]`.
- **Tests con `node:test`** (builtin). Cobertura en `server/services/parlayEngine/__tests__/`, `server/services/__tests__/pickAlignedMl.test.js`, `server/parsers/__tests__/pickParser.test.js`.

---

## Paths críticos por dominio

### LLM / Predicción
- [server/oracle.js](server/oracle.js) — motor LLM dual (Claude + Grok). **FROZEN.**
- [server/context-builder.js](server/context-builder.js) — arma payload por partido. Descongelado en Sprint 8d para enriquecimiento Savant: rolling wOBA, CSW%, active spin, attack angle, bat speed, sprint speed, HR/FB en bloques pitcher/batter; avgIP/start del starter; ERA/WHIP por relevista; LHP/RHP handedness; `buildTeamFormBlock`, `buildUmpireBlock`, `buildScheduleFatigueBlock`.
- [server/market-intelligence.js](server/market-intelligence.js) — `buildDeterministicSafePayload`, `buildValueBreakdown`. **FROZEN.**
- [server/services/xgboostValidator.js](server/services/xgboostValidator.js) — validador determinístico (no es XGBoost real, es scoring con pesos hardcodeados). **FROZEN.**
- [server/shadow-model.js](server/shadow-model.js) — runner del validator + persistencia pick-aligned (`pick_market_type`, `python_pick_prob`, `pick_agree_python`, etc.). Bug fix 2026-05-29: `_enrichWithPythonScore` ya no tiene el guard `python_pick_prob == null` que impedía guardar `python_model_score` cuando el sidecar respondía bien — esto causaba que el ensemble tuviera 0 filas elegibles.
- [server/services/pickAlignedMl.js](server/services/pickAlignedMl.js) — parsea el pick Oracle, predice el **mismo mercado** en legacy/Python, expone `mlOpinion` (admin) y `shadowFields`. Usa [pickParser.js](server/parsers/pickParser.js) (incl. español: `Bajo 4.5 Ponches`).
- [server/prompts/x-content-prompts.js](server/prompts/x-content-prompts.js) — prompts de content. **FROZEN** los existentes; añadir nuevos sí se puede.

### Pick lifecycle
- [server/pick-tracker.js](server/pick-tracker.js) — progress tracking en vivo (MLB).
- [server/pick-resolver.js](server/pick-resolver.js) — resolución post-game (MLB). Exporta `resolvePickFromFinalState` + `tokenMatchesTeam`, reutilizados por el resolver NBA.
- [server/props-resolver.js](server/props-resolver.js) — resolución player props MLB vía boxscore GUMBO (`resolvePlayerProp`, `getGameBoxscore`).
- [server/pick-resolver-nba.js](server/pick-resolver-nba.js) — resolución post-game NBA. Se ejecuta cada 30 min junto al resolver MLB cuando `NBA_ANALYSIS_ENABLED=true`.
- [server/pick-postmortem.js](server/pick-postmortem.js) — análisis retrospectivo por LLM.
- [server/closing-line-capture.js](server/closing-line-capture.js) — CLV.
- [server/feature-store.js](server/feature-store.js) — persistencia de features por pick.

### Datos externos
- [server/mlb-api.js](server/mlb-api.js) — MLB Stats API wrapper. Sprint 8d: `getBullpenUsage` ahora incluye `throwingHand` por relevista; nueva `getUmpireForGame(gamePk)` → HP umpire `{id, name}` desde boxscore; nueva `getTeamScheduleFatigue(teamId)` → `{gamesLast7d, consecutiveDaysPlayed, roadGamesLast7d}` desde schedule API.
- [server/nba-api.js](server/nba-api.js) — NBA Stats API wrapper (`stats.nba.com/stats/`) + ESPN fallback (Railway-friendly). Endpoints: scoreboardv2 (juegos del día), leaguedashteamstats (season stats), teamgamelog (últimos 10 juegos). Exporta también `getNbaLeagueInjuries` + `findTeamInjuries` (ESPN league injury feed, cache 15min, fallback stale). **Nota**: `teamgamelog` no devuelve `PLUS_MINUS` — usa `normalisePlusMinus()` con búsqueda dinámica de headers.
- [server/nba-odds.js](server/nba-odds.js) — The Odds API `basketball_nba` con dual key fallback. Exporta `getNbaGameOdds`, `matchNbaOddsToGame`, `buildMarketOddsForGame`. Aislado del MLB `odds-api.js` por convención (frozen).
- [server/nba-context-builder.js](server/nba-context-builder.js) — arma contexto NBA por partido (net/off/def rating, pace, TS%, REB%, AST%, rest days, last-10 form, injuries) y emite `context_meta` (sources, completeness, staleFlags). Lookup por `team_id` con fallback a `team_abbr` para tolerar mismatch ESPN ↔ stats.nba.com.
- [server/savant-fetcher.js](server/savant-fetcher.js) — Baseball Savant leaderboards (cache 6h). ~33 leaderboards: batting/pitching rolling stats, active spin, attack angle, bat speed, sprint speed, HR/FB, OAA, catcher framing, park factors. Sprint 8d: `umpireScorecard` leaderboard añadido; nueva export `getUmpireStats(name)` — match por apellido → `{accuracy_pct, favor, extra_calls_per_game, k_rate_impact}`.
- [server/odds-api.js](server/odds-api.js) — The Odds API MLB (dual key fallback).
- [server/weather-api.js](server/weather-api.js) — Open-Meteo.
- [server/live-feed.js](server/live-feed.js) — play-by-play MLB.

### Auth, payments, comms
- [server/auth.js](server/auth.js) — JWT custom, bcryptjs, email verification, password reset, bankroll. `bankrollRouter` incluye `GET /api/bankroll/equity-stats` (auth.js:851) — equity curve + Sharpe + drawdown por usuario.
- [server/middleware/auth-middleware.js](server/middleware/auth-middleware.js) — `verifyToken`, `requireVerifiedEmail`, `isAdmin`.
- [server/nowpayments.js](server/nowpayments.js) + [server/nowpayments-webhook.js](server/nowpayments-webhook.js) — checkout cripto + IPN HMAC-SHA512.
- [server/plans.js](server/plans.js) — fuente de verdad de credit packs vendidos vía NowPayments (planId, precio, créditos a otorgar).
- [server/email.js](server/email.js) — Resend client. Import lazy: `getResendClient()` carga `resend` dinámicamente; si el paquete no está disponible o `RESEND_API_KEY` falta, retorna `null` y las funciones de email son no-ops silenciosos.

### Content pipeline X
- [server/services/contentDraftService.js](server/services/contentDraftService.js) — drafts con Haiku.
- [server/services/contentQueueService.js](server/services/contentQueueService.js) — cola editorial.
- [server/services/xPublisher.js](server/services/xPublisher.js) — OAuth 1.0a HMAC-SHA1.

### Parlay Synergy (nuevo)
- [server/services/parlayEngine/](server/services/parlayEngine/) — pool, risk, correl, composer, architect.
- Brief técnico maestro: [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md).
- **Modos**: `safe`, `conservative`, `balanced`, `aggressive`, `dreamer`. Los modos value (conservative→dreamer) optimizan por **edge** (valor vs mercado). El modo **`safe` (Máx. Acierto)** optimiza por **probabilidad de que peguen las patas**, no por edge: `composer.js` usa scoring por probabilidad conjunta (`Σ log(modelProbability)`), ordena semillas por probabilidad cruda, usa el acuerdo del XGBoost como desempate, **elimina el piso de edge** (admite favoritos eficientes con edge ≤ 0) y sube el piso de confianza a 62% y data-quality a 60%. El override de safe vive en `prompts.js` (`SAFE MODE OVERRIDE`, condicional a `MODE=safe` en el user message — no reescribe el prompt de los modos value).
- [server/services/parlayEngine/hitMath.js](server/services/parlayEngine/hitMath.js) — distribución Poisson-binomial (`computeHitDistribution`): patas esperadas, P(pegan todas), P(≥N-1). Expuesta en `chosen_parlay.hit_distribution` y como warning honesto para N≥6 (la matemática que ningún prompt vence).
- [server/services/extendedMarketCandidates.js](server/services/extendedMarketCandidates.js) — genera candidatos de alt lines matemáticamente. **Caps actuales (2026-05-29)**: alt totals ±2 del proyectado (era ±4 — generaba Under 13.5 al ~95% que bet365 no ofrece); alt runlines máximo ±3.5 (era ±5.5). Solo rangos que aparecen en libros mainstream como bet365.

### Pick Imperdible (admin-only, MLB)
"Lock of the slate": analiza 1..N juegos con lineup confirmado y devuelve **un solo** pick de máxima convicción (o PASS). **Invierte la lógica de value/edge a propósito**: la convicción premia el ACUERDO entre el modelo determinístico, el mercado y el sidecar ML, penaliza varianza de mercado y exige lineup confirmado — el edge nunca es input positivo. Un gate duro fuerza PASS si ningún candidato es near-certain; un árbitro Opus audita los finalistas y confirma o vetea.
- [server/services/imperdibleSelector.js](server/services/imperdibleSelector.js) — scorer puro de convicción + gate + ranking (unit-tested). `MARKET_VARIANCE` + `DEFAULT_THRESHOLDS`.
- [server/services/imperdibleArbiter.js](server/services/imperdibleArbiter.js) + [server/prompts/imperdible-prompts.js](server/prompts/imperdible-prompts.js) — auditor LLM de riesgo (modelo override `IMPERDIBLE_ARBITER_MODEL`).
- [server/services/imperdibleEngine.js](server/services/imperdibleEngine.js) — orquestación: reusa el pipeline frozen (Oracle/market/sidecar) **solo por import**, persiste el lock en `picks` (`type='imperdible'`, `source='imperdible'`) — reusa resolver + equity pero aislado del training default — y una fila completa en `imperdible_runs` (dataset de slate para un futuro modelo).
- [server/routes/imperdible.js](server/routes/imperdible.js) — `POST /api/imperdible/analyze`, `GET /api/imperdible/games`, `GET /api/imperdible/history`. Admin + feature-flag `IMPERDIBLE_ENABLED`.
- [client/src/pages/ImperdiblePage.jsx](client/src/pages/ImperdiblePage.jsx) — ruta `/admin/imperdible` + link en sidebar.

### Admin
- [server/admin-db-explorer.js](server/admin-db-explorer.js) — read-only DB browser con whitelist por tabla/columna.
- Endpoints admin viven en [server/index.js](server/index.js) y en rutas específicas (content-admin, admin-ml).
- [server/services/mlModelHealth.js](server/services/mlModelHealth.js) — observabilidad del sidecar ML: estado por mercado, modelos cargados, runline early-model flag, ensemble disponibilidad. Usado en HUD de `/admin/ml-control`.
- [server/services/backtestRegrader.js](server/services/backtestRegrader.js) — lógica de re-grading de props en `backtest_results`. Compartida entre el script CLI (`scripts/regrade-backtest-props.js`) y el endpoint admin del dashboard.
- [server/services/public-stats.js](server/services/public-stats.js) — cálculo puro de ROI/performance summary público. Reutilizado por `GET /api/picks/public-stats` y el Content API (`/api/content/v1/performance/summary`).

### Servicios de datos adicionales
- [server/services/hexaSmartSignalsService.js](server/services/hexaSmartSignalsService.js) — generadores de señales rule-based para la Pizarra del Día (MLB). Sin ML ni LLM: funciones determinísticas sobre datos MLB API.
- [server/services/hexaNbaBoardService.js](server/services/hexaNbaBoardService.js) — NBA "pizarra del día" (lightweight board). Misma forma de respuesta que `buildHexaBoard()` para que `HexaBoard` pueda renderizar con `sport=nba`.
- [server/services/mlbPropShadow.js](server/services/mlbPropShadow.js) — shadow model para MLB props. Usa `mlModelClient.js` para predicciones `prop_hits`, `prop_strikeouts`, etc.; alimenta el feature store de props.
- [server/services/xaiClient.js](server/services/xaiClient.js) — cliente HTTP para la API de xAI (Grok). Usado por `oracle.js` en modo dual-engine. **No tocar**: frozen junto al oracle.
- [server/services/nbaOutputGuard.js](server/services/nbaOutputGuard.js) — validación de salida Oracle NBA antes de persistir: rechaza picks ambiguos, player props, ABSTAIN; degrada con `alert_flags` si faltan campos secundarios. (También documentado en sección NBA Oracle.)

### NBA Oracle
- [server/services/oracleNba.js](server/services/oracleNba.js) — Motor LLM NBA (Anthropic only, sin Grok). Exporta `analyzeNbaGame` y `analyzeNbaChat`. **No toca oracle.js.** `serializeNbaContext` renderiza injuries por equipo y un bloque `DATA QUALITY` cuando `context_meta` reporta `staleFlags`/completeness < 100%.
- [server/services/nbaShadowValidator.js](server/services/nbaShadowValidator.js) — Validador determinístico NBA (shadow). **No toca xgboostValidator.js.**
- [server/services/nbaShadowPersistence.js](server/services/nbaShadowPersistence.js) — Persiste `pick_features` + `shadow_model_runs` con `sport='nba'` en analyze NBA.
- [server/prompts/oracle-nba-prompts.js](server/prompts/oracle-nba-prompts.js) — Prompts NBA: `NBA_SYSTEM_PROMPT` (pick + JSON output) y `NBA_CHAT_PROMPT` (chat libre). Guardrail anti-hallucination: prohíbe explícitamente simular tool calls o web search.
- [server/routes/nba.js](server/routes/nba.js) — `POST /api/nba/analyze/game` y `POST /api/nba/analyze/chat`. Feature-flagged por `NBA_ANALYSIS_ENABLED`. Admin-only. Resuelve `marketOdds` server-side vía [nba-odds.js](server/nba-odds.js) cuando el cliente no las envía y propaga `context_meta` + `oddsSource` en `meta` de la respuesta.

### NFL (✅ Sprint 9 completo — tercer deporte activo)
Espeja **exactamente** el patrón NBA (que espeja MLB): archivos `nfl-*` nuevos que importan los frozen, `sport='nfl'` en toda persistencia, cero ediciones a frozen. `nfl` está **activo** en el registry (`SPORT_META.nfl.active=true`, `ACTIVE_SPORTS=['mlb','nba','nfl']` en [client/src/config/sports.js](client/src/config/sports.js)). **Sprints 9a–9e mergeados** (PRs #373–#377 + #378); selector NFL visible en UI; pizarra muestra placeholder hasta temporada sept 2026.
- **Spec maestra**: [docs/nfl-architecture.md](docs/nfl-architecture.md) — data sources, mapeo live tipo GUMBO, diseño del Oracle prompt, parlay, imperdible, ML sidecar.
- **Roadmap por sprints**: [docs/nfl-roadmap.md](docs/nfl-roadmap.md) (serie Sprint 9, espejo de la serie 7 NBA).
- **Datos** (decidido): ESPN hidden API (gratis, sin key — como NBA) para juegos/scores/drives/plays/injuries/rosters; The Odds API `americanfootball_nfl` (dual key) para líneas; **nflverse / nfl_data_py** para stats avanzadas (EPA, success rate, PROE) — el análogo a Statcast/Savant.
- **Diferencias estructurales clave vs NBA** (NO es copy-paste): cadencia **semanal** (selector por `seasontype`+`week`, no por fecha); **spread es el mercado primario** con **key numbers 3 y 7**; cap de confianza **≈72%** (mercado más eficiente + varianza más alta de los tres deportes); **QB titular confirmado** = el gate de disponibilidad (análogo del "lineup confirmado" MLB); jobs **game-time-aware** (solo pollean ventanas Thu/Sun/Mon); **push** frecuente en resolución (spread/total en entero); weather pesa (viento/frío); el sidecar ML puede **pre-entrenarse con histórico nflverse** (>20 temporadas) en vez de esperar 500 picks resueltos.
- **Live mapping (análogo GUMBO)**: ESPN core API `drives` + `plays` + `summary?event` con `winprobability`. No hay feed oficial profundo como GUMBO; se compone desde ESPN con polling game-time-aware.
- **Ya en código (9a + 9b)**:
  - [server/nfl-team-map.js](server/nfl-team-map.js) — 32 equipos ESPN id↔abbr↔nombre + conf/división + coords estadio + flag `dome` (11 domos) + aliases.
  - [server/nfl-api.js](server/nfl-api.js) — wrapper ESPN. Games **por semana** (`getNflGamesForWeek`, `getCurrentNflWeek`), standings/team stats, recent form, injuries, `getNflGameSummary`. Cache + fallback stale.
  - [server/nfl-context-builder.js](server/nfl-context-builder.js) — `buildNflGameContext`: records/PF-PA, recent form, rest/short-week/off-bye, QB status, weather (solo no-domo) + `context_meta`. EPA/PROE null hasta nflverse.
  - [server/prompts/oracle-nfl-prompts.js](server/prompts/oracle-nfl-prompts.js) — `NFL_SYSTEM_PROMPT` + `NFL_CHAT_PROMPT` + `NFL_OUTPUT_SCHEMA_VERSION`. Cap 72%, key numbers 3/7, prioridad QB→EPA, guardrail anti-hallucination.
  - [server/services/oracleNfl.js](server/services/oracleNfl.js) — `analyzeNflGame`, `analyzeNflChat`, `serializeNflContext` (Anthropic propio, sin Grok). **No toca oracle.js.**
  - [server/services/nflOutputGuard.js](server/services/nflOutputGuard.js) — `validateNflAnalysisOutput`: rechaza props/ABSTAIN/parse fallido, confianza 50–72, degrada con `alert_flags`.
  - Migraciones `runNflScaffoldingMigrations()` + `runNflDatasetMigrations()` en [server/migrate.js](server/migrate.js); endpoints `GET /api/nfl/games|teams|standings` en [server/index.js](server/index.js).
  - [server/routes/nfl.js](server/routes/nfl.js) — `POST /api/nfl/analyze/game` + `/chat` (admin-only, flag `NFL_ANALYSIS_ENABLED`). Lookup **por semana** (season/seasonType/week, default actual) con fallback date. Persiste `sport='nfl'`, resuelve odds server-side. (pick_features/shadow → 9.1.)
  - [server/nfl-odds.js](server/nfl-odds.js) — The Odds API `americanfootball_nfl`, dual key. **Preserva key numbers** vía MODA de spread/total (no promedio). `getNflGameOdds`, `matchNflOddsToGame`, `buildMarketOddsForGame`.
  - [server/pick-resolver-nfl.js](server/pick-resolver-nfl.js) — resuelve pendientes `sport='nfl'` (reusa `resolvePickFromFinalState`/`tokenMatchesTeam`), maneja push. Job game-time-aware en index.js: Thu/Sun/Mon ET 16:00–05:59.
  - `chatPickExtractor.js` extendido a `'nfl'` (normalización sport nba/nfl/mlb; market hints spread/total/moneyline).
- **Completo (9.1)**: `server/services/nflShadowValidator.js` + `nflShadowPersistence.js` — dataset/shadow para NFL; columnas NFL en `pick_features`/`shadow_model_runs` (`sport='nfl'`).
- **Completo (9.2)**: `server/pick-tracker-nfl.js` + `client/src/components/NflLiveTracker.jsx` — live tracker game-time-aware (Thu/Sun/Mon ET), drives + plays + win probability desde ESPN.
- **Completo (9d)**: `GameSelector` + `AnalysisPanel` extendidos a NFL; `client/src/utils/nflLogoUrl.js`; `HexaBoard` muestra placeholder NFL hasta temporada sept 2026.
- **Completo (9e)**: `server/services/nflMlClient.js` + modelos `nfl_moneyline`/`nfl_spread`/`nfl_total` en sidecar Python — scaffolding completo; entrena cuando haya picks resueltos en temporada real.
- **Pendiente operacional**: `hexaNflBoardService.js` (sept 2026), entrenamiento real de modelos NFL, `NFL_LIVE_TRACKER_ENABLED` / `NFL_PROPS_ENABLED`.

### MLB Player Props (Sprint 5)
- [server/routes/mlb-props.js](server/routes/mlb-props.js) — `GET /api/mlb/props/board` (auth). Odds API + Savant + ML batch; `oraclePropPicks` desde tabla `picks` por `game_date` / `game_pk`.
- [server/services/propFeatureEnricher.js](server/services/propFeatureEnricher.js) — features Savant por jugador para props.
- [client/src/pages/PlayerPropsPage.jsx](client/src/pages/PlayerPropsPage.jsx) — ruta `/props`.

### Routes principales
- [server/routes/picks.js](server/routes/picks.js)
- [server/routes/content.js](server/routes/content.js) — API key, read-only para consumidores externos.
- [server/routes/content-admin.js](server/routes/content-admin.js)
- [server/routes/insights.js](server/routes/insights.js)
- [server/routes/oracle-history.js](server/routes/oracle-history.js)
- [server/routes/admin-ml.js](server/routes/admin-ml.js) — Admin ML Control Center (status, retrain proxy con audit log, ensemble breakdown por pick, chat-picks stats). **Fix 2026-05-30**: el endpoint `POST /retrain/ensemble` ahora cuenta filas elegibles con `GROUP BY pick_market_type` (antes era COUNT(*) global sin filtrar por mercado, lo que mostraba un total ≥50 aunque ningún mercado individual lo alcanzara). Devuelve `eligible_by_market` en la respuesta; la UI muestra desglose `moneyline: N/50 · overunder: N/50 · …` en lugar del total engañoso.

### Frontend
- [client/src/App.jsx](client/src/App.jsx) — root + routing. Tiene estado `sport` ('mlb'|'nba') que se pasa a GameSelector y AnalysisPanel en la tab de juego.
- [client/src/components/SportSwitcher.jsx](client/src/components/SportSwitcher.jsx) — pill toggle MLB/NBA. Se renderiza dentro del header de GameSelector (modo single).
- [client/src/components/GameSelector.jsx](client/src/components/GameSelector.jsx) — acepta `sport` prop. Cuando `sport='nba'` fetcha `/api/nba/games` y normaliza al shape MLB-compatible. Oculta la sección de pitchers para NBA.
- [client/src/components/AnalysisPanel.jsx](client/src/components/AnalysisPanel.jsx) — acepta `sport` prop. Cuando `sport='nba'` usa `/api/nba/analyze/game`. Oculta betType, engine picker (grok/dual), webSearch toggle y lineup badges para NBA. Admin MLB: muestra [AdminMlOpinionCard.jsx](client/src/components/AdminMlOpinionCard.jsx) con `mlOpinion` del analyze.
- [client/src/theme/outcomeStyles.js](client/src/theme/outcomeStyles.js) — helpers W/L/P usando tokens CSS `--outcome-win|loss|pending` (League + Classic).
- [client/src/pages/](client/src/pages/) — pages (PerformanceDashboard, ParlayArchitect, DevUIShowcase, MLCalibrationDashboard, AdminMLControlCenter).
- [client/src/components/](client/src/components/) — componentes (AdminCreditPanel, AdminDbExplorerPanel, AdminEnsembleBadge, OracleChat, BankrollTracker, HexaBoard, LearningCenter, MethodologyPage, etc).

### Admin ML Control Center (Sprint 5 UI)
- [client/src/pages/AdminMLControlCenter.jsx](client/src/pages/AdminMLControlCenter.jsx) — página `/admin/ml-control` con HUD de circuit breaker, cards por mercado, retrain on-demand, ensemble panel, chat-picks bucket stats, retrain audit log.
- [client/src/components/AdminEnsembleBadge.jsx](client/src/components/AdminEnsembleBadge.jsx) — chip lazy-loaded que aparece bajo cada PickCard (admin-only) y muestra Oracle/Legacy/Python/Ensemble probs por pick.
- [server/services/chatPickExtractor.js](server/services/chatPickExtractor.js) — captura picks de Oracle Chat con JSON tail + Haiku fallback, persiste en `picks` con `source='oracle_chat'`. Guard 2026-05-29: si el mercado es `overunder`, `runline` o `prop` y `line == null`, `normalizeExtracted()` devuelve `null` y descarta el pick en lugar de guardar el string del matchup ("ATL @ BOS") como texto del pick.

### ML sidecar Python
- [ml/hexa_ml/serve.py](ml/hexa_ml/serve.py) — FastAPI app (endpoints: /health, /predict/\*, /calibration, /retrain, /retrain/ensemble).
- [ml/hexa_ml/train.py](ml/hexa_ml/train.py) — pipeline de entrenamiento XGBoost (temporal split, Brier eval).
- [ml/hexa_ml/models/ensemble.py](ml/hexa_ml/models/ensemble.py) — meta-learner LogReg que combina oracle + legacy + python.
- [ml/hexa_ml/predict.py](ml/hexa_ml/predict.py) — ModelRegistry singleton (thread-safe). `ENSEMBLE_MARKETS = ("moneyline", "overunder", "runline", "prop")`.
- [ml/hexa_ml/features.py](ml/hexa_ml/features.py) — feature engineering desde pick_features.
- [ml/hexa_ml/calibration.py](ml/hexa_ml/calibration.py) — PlattCalibrator + Brier score.
- [ml/Dockerfile](ml/Dockerfile) — imagen multi-stage Python 3.11.
- [ml/railway.json](ml/railway.json) — config deploy Railway del sidecar.

**Ensemble markets (2026-05-29)**: `moneyline`, `overunder`, `runline`, `prop`. Todos usan el frame pick-aligned (`oracle_pick_prob` / `legacy_pick_prob` / `python_pick_prob`) — P(pick gana) independiente del mercado. Props necesita `JOIN picks ON pick_id` para `y_true` (no se puede derivar de scores del partido). El ensemble `prop` agrupa todos los prop kinds (hits, strikeouts, total_bases, home_runs, rbis) en un solo modelo — suficientes datos por separado hay ~10-20 filas por kind, insuficiente; pooled llega antes al mínimo de 50.

### Scripts de training / dataset
- [scripts/training/export-dataset.js](scripts/training/export-dataset.js) — exporta pick_features a CSV/Parquet.
- [scripts/training/backfill-pick-features.js](scripts/training/backfill-pick-features.js) — backfill de scores históricos.

### Parsers y enrichers (Sprint 1)
- [server/parsers/pickParser.js](server/parsers/pickParser.js) — parsea "NYY ML" → `{market_type, side, line}`.
- [server/services/pickPostgameEnricher.js](server/services/pickPostgameEnricher.js) — backfill de scores post-game desde MLB API.

---

## Frozen files — NO modificar sin permiso explícito del usuario

Estos archivos están congelados por el brief del Parlay Synergy Engine y por estabilidad del Oracle:

- `server/oracle.js`
- `server/context-builder.js` ← descongelado en Sprint 8d para enriquecimiento de contexto Savant; **NO tocar el prompt Oracle en oracle.js ni la lógica de market-intelligence**
- `server/market-intelligence.js`
- `server/services/xgboostValidator.js`
- `server/shadow-model.js` ← modificado para Python score (Sprint 3) y pick-aligned (2026-05); estable salvo bugs explícitos
- Prompts existentes dentro de `server/oracle.js`
- `server/services/parlayEngine/*` (recién implementado, refactors solo con permiso)
- `server/services/mlModelClient.js` ← cliente del sidecar Python, no tocar flujo del circuit breaker

Para añadir lógica nueva que parezca tocar estos archivos: **crear archivos nuevos** que los **importen** y orquesten, sin modificar el original. Patrón usado en `parlayEngine/llmClient.js` (instancia propia de Anthropic SDK en lugar de tocar `oracle.js`).

---

## Convenciones de código

### Imports ESM
Siempre con extensión `.js` explícita:
```js
import pool from './db.js';
import { buildContext } from './context-builder.js';
import { calculateParallelScore } from './services/xgboostValidator.js';
```

### Comentarios
- Default: **no escribir comentarios.** Identificadores bien nombrados son suficientes.
- Excepción: cuando el "por qué" no es obvio (workaround de bug, invariante oculto, restricción de API externa, decisión de negocio).
- Nunca describir el "qué" si el código ya lo dice.

### Logging
Usar prefijo `[module-name]`:
```js
console.log(`[oracle] dual divergence detected: claude=${claudePick} vs grok=${grokPick}`);
console.warn(`[odds-api] primary key exhausted, falling back to backup`);
console.error(`[nowpayments-webhook] invalid signature: ${err.message}`);
```

### Errores en endpoints
Usar `safeError()` helper en [server/index.js](server/index.js) para nunca filtrar stacks en producción.

### Strings user-facing
Bilingual cuando aplica (es/en). El frontend tiene i18n en [client/src/i18n/](client/src/i18n/).

---

## Cómo hacer cosas comunes

### Añadir un endpoint nuevo
1. Decidir si va en [server/index.js](server/index.js) (cross-cutting, una sola pieza) o en `server/routes/<dominio>.js` (lógica de dominio agrupada).
2. Si requiere auth, usar `verifyToken` middleware. Si es admin: `requireAdmin` (verifica `is_admin` en JWT).
3. Si crea o muta picks: `requireVerifiedEmail` (excepto admin).
4. Si es análisis: añadir al `analysisLimiter` rate limit group.
5. Si es público con API key: usar `verifyContentApiKey` middleware.

### Añadir una columna a una tabla existente
Editar [server/migrate.js](server/migrate.js):
```js
await pool.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS my_new_col VARCHAR(32)`);
```
La migración corre en cada startup, es idempotente, y no requiere downtime.

### Crear una tabla nueva
Mismo patrón:
```js
await pool.query(`CREATE TABLE IF NOT EXISTS my_new_table (
  id BIGSERIAL PRIMARY KEY,
  ...
)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_my_new_table_foo ON my_new_table(foo)`);
```

### Añadir un feature flag
1. Documentarlo en [.env.example](.env.example) con default y descripción.
2. Leerlo con `process.env.MY_FLAG === '1'` o `'true'`.
3. Mencionarlo en la sección "Feature flags activas" de [docs/admin-and-ops.md](docs/admin-and-ops.md).

### Añadir un background job
Patrón en [server/index.js](server/index.js) (al final del archivo):
```js
setInterval(async () => {
  const hourET = nowETHour();
  if (hourET < 19 && hourET >= 6) return;  // solo correr en ventana válida
  try {
    await myJobFn();
  } catch (err) {
    console.error(`[my-job] failed: ${err.message}`);
  }
}, 30 * 60 * 1000);  // cada 30 min
```

Considerar mover a un queue real (BullMQ + Redis) si crece la cantidad de jobs.

### Llamar a un LLM desde código nuevo
**No** importar desde `oracle.js`. Crear cliente propio:
```js
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// usar client.messages.create(...)
```
Patrón existente en [server/services/parlayEngine/llmClient.js](server/services/parlayEngine/llmClient.js).

### Añadir un test
Framework: `node:test` builtin. Archivos en `__tests__/` adyacente al código:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('mi función hace X', () => {
  assert.equal(myFn(input), expected);
});
```
Correr con `node --test server/services/myDir/__tests__/`.

---

## Comandos npm

```bash
# Setup inicial
npm install
cd client && npm install && cd ..
cp .env.example .env  # editar con tus keys

# Desarrollo
npm run dev          # server con --watch en :3001
npm run client       # cliente Vite en :5173
npm run dev:all      # ambos en paralelo (concurrently)

# Operación
npm run audit        # diagnóstico del sistema (system-audit.js)
npm run smoke:mlb    # release smoke MLB (games/teams/hexa-board)
npm run test:parlay  # tests del Parlay Synergy Engine
node --test server/services/__tests__/pickAlignedMl.test.js server/parsers/__tests__/pickParser.test.js
npm start            # server en modo producción

# Cliente
cd client
npm run build        # build de producción
npm run preview      # preview del build
```

---

## Variables de entorno críticas

**Obligatorias:**
- `ANTHROPIC_API_KEY` — Claude
- `DATABASE_URL` — Postgres connection
- `JWT_SECRET` — firma de tokens (cambiar en prod)
- `ODDS_API_KEY` — The Odds API

**Opcionales pero activas:**
- `XAI_API_KEY` — Grok / dual mode
- `ODDS_API_BACKUP_KEY` — fallback automático
- `RESEND_API_KEY` + `EMAIL_FROM` — email verification
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` — cripto
- `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` — publicar en X
- `CONTENT_API_KEYS` — `label:secret,label2:secret2` para API pública

**Feature flags:**
- `SHADOW_MODE_ENABLED` — shadow validator activo
- `PARLAY_SYNERGY_ENABLED` — motor parlay nuevo (default `false`)
- `X_AUTO_PUBLISH_ENABLED` — worker publica en X (default `0`)
- `X_AUTO_PUBLISH_INTERVAL_MINUTES` — intervalo (default `5`)
- `NBA_ANALYSIS_ENABLED` — habilita Oracle NBA y resolver NBA (default `false`; `true` en local y en Railway cuando se lance el MVP)
- `NFL_ANALYSIS_ENABLED` — habilita endpoints Oracle NFL + resolver NFL (default `false`; activo en Railway con `=true`). Opcionales planificados: `NFL_LIVE_TRACKER_ENABLED`, `NFL_PROPS_ENABLED`, `IMPERDIBLE_NFL_ENABLED`. Ver [docs/nfl-roadmap.md](docs/nfl-roadmap.md).
- `ML_ADMIN_TIMEOUT_MS` — timeout sidecar en analyze admin para pick-aligned (default `2500`)
- `MLB_PROPS_SAVANT_ENRICH_ENABLED` / `MLB_PROPS_ML_PUBLIC_ENABLED` / `MLB_PROPS_ML_MIN_RESOLVED` — tablero `/props`
- `IMPERDIBLE_ENABLED` — habilita Pick Imperdible (admin-only, MLB; default `false`). Opcionales: `IMPERDIBLE_ARBITER_MODEL` (default Opus), `IMPERDIBLE_TOP_K` (default `5`)

Lista completa en [.env.example](.env.example).

---

## Convenciones de PR / commit

- **Branch main protegida.** Trabajar en feature branches y abrir PR.
- Mensajes de commit estilo convencional: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`. Ver `git log` para ejemplos.
- **Nunca commitear `.env`** ni credenciales — solo `.env.example`.
- Cambios que tocan prompts del LLM: pasar por `npm run audit` y validar contra backtest antes de merge.
- Cambios al schema: documentar en [docs/data-schema.md](docs/data-schema.md).

---

## Roadmap activo

El pipeline de ML propio está **completo y en producción**. Los modelos XGBoost están entrenados y sirviendo predicciones en tiempo real. Backlog en [docs/roadmap.md](docs/roadmap.md).

**NFL — ✅ Sprint 9 completo (2026-05-30, PRs #373–#378)**: tercer deporte operativo. Spec en [docs/nfl-architecture.md](docs/nfl-architecture.md), roadmap en [docs/nfl-roadmap.md](docs/nfl-roadmap.md). Todo el código está mergeado: Oracle, lifecycle, shadow/dataset, live tracker, UI (selector + AnalysisPanel + GameSelector), ML scaffolding. Pendiente operacional: temporada NFL arranca sept 2026 → `hexaNflBoardService`, picks reales → entrenar modelos.

Estado del pipeline ML:
- ✅ Sprint 0 — documentación viva (este archivo + `/docs/`).
- ✅ Sprint 1 — gaps del dataset cerrados: 22 columnas nuevas en `pick_features`, pickParser, pickPostgameEnricher, export-dataset.js.
- ✅ Sprint 2 — sidecar Python FastAPI + XGBoost real en `ml/`, desplegado en Railway como servicio separado.
- ✅ Sprint 3 — integración Node↔Python (mlModelClient.js, circuit breaker), shadow_model_runs enriquecido, dashboard `/admin/ml-calibration`.
- ✅ Sprint 4 — ensemble meta-learner (LogReg oracle+legacy+python), `/predict/ensemble`, `/admin/ml-ensemble-calibration`.
- ✅ Sprint 5 UI — Admin ML Control Center (`/admin/ml-control`): HUD live, retrain on-demand por mercado + ensemble + RETRAIN ALL, per-pick ensemble breakdown badge en HistoryPanel, chat-picks bucket dashboard, retrain audit log (`ml_retrain_log`). Runline desbloqueado (`min_train_size=25`). Chat→Training pipeline con `source='oracle_chat'` aislado del training default. Observability runline/ensemble en HUD (`mlModelHealth.js`).
- ✅ Sprint 5 Player Props MLB — código completo (audit 2026-05-29). Resolver automático integrado en `resolvePendingPicks()`. ML scores gateados por admin + `MLB_PROPS_ML_PUBLIC_ENABLED`. Pendiente solo: acumular ≥50 props resueltos en prod para retrain `prop` model + flip flag público.
- ✅ Sprint 5b — Pick-aligned shadow + `mlOpinion` admin + tokens `--outcome-*` League (merge main 2026-05-17, PRs #345–#347).
- ✅ Sprint 6 — equity/Sharpe/drawdown + comparativa bankroll (`userEquityCompare.js`, `GET /api/bankroll/equity-stats`); persistencia ML prod (6b).
- ✅ Post-6 — parlay resolve/AUTO (`parlayResolver.js`, `parlayRunOutcome.js`); NBA team-map + output guard (`nba-team-map.js`, `nbaOutputGuard.js`).
- ✅ Sprint 8a — Monte Carlo bankroll (`monteCarloBankroll.js`). ✅ Brand League × Kinetic v2.6 (skin alternable, dark-only).
- ✅ Sprint 8b — **Pick Imperdible** (PR #355, 2026-05-26): lock-of-the-slate mode, admin-only, MLB. Pipeline de 7 fases: context + features → convicción Stage-1 (model + market + variance + data quality) → top-K candidates → ML sidecar alineado al pick → hard gate → LLM arbiter → persistencia `type='imperdible'` + tabla `imperdible_runs`. Feature-flagged por `IMPERDIBLE_ENABLED`. Equity summary en `/api/imperdible/history`. Herramientas: `server/routes/imperdible.js`, `server/services/imperdibleEngine.js`, `server/services/imperdibleArbiter.js`, `server/services/imperdibleSelector.js`.
- ✅ Sprint 8c — **Ensemble multi-mercado + props + hotfixes UX** (2026-05-29):
  - **Ensemble gap fix**: `shadow-model.js` corregido — `_enrichWithPythonScore` ya no tiene guard `python_pick_prob == null`; ahora siempre guarda `python_model_score`. Migración de backfill en `migrate.js` (`runEnsembleBackfillMigration`) para backfill de filas históricas existentes.
  - **Ensemble multi-mercado**: expandido de solo moneyline a `moneyline + overunder + runline + prop` usando frame pick-aligned. `data.py`, `train_ensemble.py`, `predict.py`, `serve.py` actualizados en consecuencia. El endpoint `/api/analyze/game-ensemble` en Node también actualizado para leer columnas pick-aligned por mercado.
  - **Props ensemble**: `data.py` rama especial para `market='prop'` — JOIN con `picks` para `y_true` desde `picks.result`; props pooled (todos los kinds juntos, ~50 filas mínimo para entrenar).
  - **Parlay alt lines**: `extendedMarketCandidates.js` — alt totals capeados a ±2 (era ±4); alt runlines máx ±3.5 (era ±5.5). Rangos realistas para bet365.
  - **Oracle Chat pick null-line**: `chatPickExtractor.js` `normalizeExtracted()` descarta picks `overunder/runline/prop` con `line == null` en vez de guardar el matchup string como texto de pick.
- ✅ Sprint 8d — **Oracle context enrichment MLB** (2026-05-29):
  - **Rich Savant pitcher metrics**: rolling wOBA against 7d/14d/21d, CSW% + chase rate, active spin + vertical/horizontal break, HR/FB allowed — surface los datos que el prompt Oracle ya referenciaba por nombre pero nunca recibía.
  - **Rich Savant batter metrics**: rolling wOBA 7d/14d/21d, attack angle + bat speed + sprint speed, HR/FB + pull% — multi-line por batter en `batterSavantLine()`.
  - **Starter depth**: `avgIP/start = ip/gamesStarted` en línea ERA del starter — el Oracle ya puede diferenciar entre un ace de 7 innings y un opener.
  - **Bullpen calidad individual**: top 6 relievers muestran ERA/WHIP en brackets (e.g. `Clase [ERA 1.23 / WHIP 0.89]`) via parallel `getPitcherStats`. ORACLE INSTRUCTION actualizado: bullpen fresco-pero-malo = riesgo OVER.
  - **Bullpen handedness**: LHP/RHP breakdown en `buildBullpenBlock` — `Hand composition: N RHP / N LHP in bullpen`.
  - **Umpire integration**: `getUmpireForGame(gamePk)` desde MLB boxscore API; `getUmpireStats(name)` desde Baseball Savant umpire-scorecard leaderboard; `buildUmpireBlock` renderiza nombre + accuracy_pct + favor (pitcher-friendly vs batter-friendly) + extra_calls_per_game.
  - **Team rolling wOBA**: `buildTeamFormBlock` — lineup avg rolling wOBA 7d/14d/21d por equipo desde Savant batters.
  - **Schedule fatigue**: `getTeamScheduleFatigue(teamId)` desde schedule API (gamesLast7d, consecutiveDaysPlayed, roadGamesLast7d); `buildScheduleFatigueBlock` advierte al Oracle sobre carga reciente.
  - **Fetch paralelo**: umpire + home/away fatigue se resuelven en un único `Promise.all` antes del ensamblado del contexto.
  - **_features exporta campos 8d**: `umpireData`, `umpireStats`, `homeFatigue`, `awayFatigue` para observabilidad en `annotateAnalysisData`.
- ✅ Sprint 8e — **Bullpen attribution guardrail** (2026-05-29):
  - `buildBullpenBlock` incluye `[TeamName]` en línea CRITICAL/MODERATE/LOW para prevenir confusión LLM.
  - `annotateAnalysisData` detecta mismatch entre `alert_flags` (equipo correcto) y `oracle_report` (equipo incorrecto); añade `⚠ DATA CHECK (server)` si se detecta inversión.
  - `buildAnalysisMeta` + trace flag extendidos: `RollingW N/2`, `BatRolling N/2`, `Umpire ✓/✗`, `Fatigue N/2`.
- ✅ Sprint 8f — **Railway hardening + Node 20** (2026-05-29):
  - **Tres crashes de startup corregidos** antes de merge: `requireAdmin` faltaba en el import de `auth-middleware.js`; `express-rate-limit v8` requería `ipKeyGenerator` explícito en el keyGenerator; `newsletterService.js` importaba `generateDraftForType` (renombrada a `generateContentDraft`).
  - **`server/observability.js` refactorizado**: carga `@sentry/node` con `await import()` dinámico dentro de `initSentry()`; sin `SENTRY_DSN` o sin el paquete instalado, el servidor arranca igual — no más `ERR_MODULE_NOT_FOUND` en Railway.
  - **`server/email.js` refactorizado**: `getResendClient()` carga `resend` dinámicamente; sin `RESEND_API_KEY` o con Node < 20, retorna `null` y los emails son no-ops silenciosos.
  - **Discord lazy**: `startDiscordBot` se carga con `import()` dinámico en `index.js`; si `DISCORD_ENABLED` no está activo o el paquete falla, el servidor arranca igual.
  - **`server/.nvmrc`** creado con `20` — pin de Node en el service root que Railway lee para Nixpacks. La variable `NIXPACKS_NODE_VERSION=20` en Railway es el override definitivo.
  - **`ml/requirements.txt` + `ml/pyproject.toml`**: `httpx` y `beautifulsoup4` promovidos de dev-only a runtime. El sidecar Python crasheaba al importar `fangraphs_scraper` porque `httpx` no estaba en las deps de producción.
  - **`ml/hexa_ml/serve.py`**: import de `fangraphs_scraper` envuelto en `try/except ImportError`; si falla, los endpoints `/fangraphs/*` devuelven HTTP 503 en vez de hundir todo el servicio al arrancar.
  - Resultado: los tres servicios Railway (Postgres, hexa-v4, Hexa ML) en **Online** tras el deploy; `NIXPACKS_NODE_VERSION=20` confirmado activo — emails de verificación operativos.

- ✅ **Sprint 9 — NFL completo** (2026-05-30, PRs #373–#378):
  - **9a scaffolding**: `nfl-api.js`, `nfl-team-map.js`, `nfl-context-builder.js`, `nfl-odds.js`, migraciones DB, endpoints `GET /api/nfl/games|teams|standings`.
  - **9b Oracle NFL**: `oracle-nfl-prompts.js` + `oracleNfl.js` + `nflOutputGuard.js`. Cap 72%, key numbers 3/7, QB gate, guardrail anti-hallucination.
  - **9c lifecycle**: `routes/nfl.js` (`POST /api/nfl/analyze/game|chat`), `pick-resolver-nfl.js`, job game-time-aware Thu/Sun/Mon.
  - **9.1 dataset/shadow**: `nflShadowValidator.js` + `nflShadowPersistence.js`; columnas NFL en `pick_features` / `shadow_model_runs`.
  - **9.2 live tracker**: `pick-tracker-nfl.js` + `NflLiveTracker.jsx` — SSE per-game, drives + plays + win probability desde ESPN.
  - **9d UI**: `GameSelector` + `AnalysisPanel` extendidos a NFL; `nflLogoUrl.js`; `HexaBoard` placeholder NFL; `sports.js` `ACTIVE_SPORTS` incluye `'nfl'`.
  - **9e ML scaffolding**: `nflMlClient.js` (circuit breaker propio); modelos `nfl_moneyline`/`nfl_spread`/`nfl_total` en Python; endpoints `/predict/nfl_*` en sidecar.
  - **post-9 fix**: `HexaBoard` early-return NFL (PR #378, 2026-05-30) — evita que pizarra muestre datos MLB cuando `sport='nfl'`.

**Estado en producción (2026-05-30, post-Sprint 9)**:
- Hexa ML corriendo en: `https://hexa-ml-production.up.railway.app`
- Modelos entrenados: **moneyline** (Brier 0.205, ROI +18.3%) y **overunder** (Brier 0.138, ROI +8.5%)
- Runline: floor bajado a 25 (de 100). Modelo se entrena con regularización L2 fuerte; n_train se muestra en el dashboard como flag "EARLY MODEL".
- Backfill ejecutado: 583/635 filas de `pick_features` tienen `market_type` parseado
- Reentrenamiento automático: `.github/workflows/retrain-weekly.yml` (domingos 06:00 UTC)

**Variables en Railway Hexa ML**: `DATABASE_URL` (public URL), `HEXA_ML_INTERNAL_TOKEN=hexa-ml-secret-2026`, `MIN_TRAIN_SIZE=60`, `RUNLINE_MIN_TRAIN_SIZE=25` (override), `TEST_DAYS=7`

**Variables en Railway hexa-v4**: `NIXPACKS_NODE_VERSION=20` (pin Node 20 para Nixpacks — sin esto Railway usa Node 18 y `resend@6` / `node-pg-migrate@8` no arrancan), `ML_SIDECAR_ENABLED=true`, `HEXA_ML_API_URL=https://hexa-ml-production.up.railway.app`, `HEXA_ML_INTERNAL_TOKEN=hexa-ml-secret-2026`, `CHAT_EXTRACTOR_HAIKU_FALLBACK=1` (default), `CHAT_EXTRACTOR_HAIKU_MODEL=claude-haiku-4-5-20251001` (default)

**Nota Railway — Node version**: el service root de hexa-v4 en Railway es `server/`, por eso el `.nvmrc` y `engines` en la raíz del repo son **invisibles** para Nixpacks. La variable `NIXPACKS_NODE_VERSION=20` es el override correcto. Adicionalmente existe `server/.nvmrc` con `20` como fallback para herramientas que leen el service root.

**Para reentrenar manualmente (CLI)**:
```bash
curl -X POST https://hexa-ml-production.up.railway.app/retrain \
  -H "Authorization: Bearer hexa-ml-secret-2026" \
  -H "Content-Type: application/json" -d '{"market":"all"}'
```

**Para reentrenar desde la UI**: ir a `/admin/ml-control` → click en `▶ RETRAIN` por mercado o `▶▶ RETRAIN ALL MARKETS`. Cada disparo escribe una fila en `ml_retrain_log` (admin, market, brier, n_train, duration, error). Cooldown anti-doble-click: 5 minutos por scope.

**Si pick_features necesita backfill** (añadir DATABASE_URL público al .env local primero):
```bash
node --env-file=.env scripts/training/backfill-pick-features.js --batch=500
```

**Picks desde Oracle Chat**: cuando el Oracle recomienda un pick durante una sesión de chat, el extractor (JSON tail + Haiku fallback) lo persiste en `picks` con `source='oracle_chat'` y `chat_session_id` apuntando a `oracle_sessions`. Estos picks **no entran al training default** (el sidecar Python filtra por `source = 'live'`). Para inspeccionarlos: panel "Chat-sourced picks" en `/admin/ml-control`. Para suprimir extracción en un chat exploratorio: header `X-HEXA-Skip-Pick-Extract: 1` (o el checkbox "NO GUARDAR PARA ENTRENAMIENTO" en OracleChat).

**NBA MVP — Estado actual (2026-05-15)**:

- ✅ **7a scaffolding datos**: `nba-api.js`, `nba-context-builder.js`. Columna `sport VARCHAR(10) DEFAULT 'mlb'` en `picks` y `pick_features`. GET `/api/nba/games` y `/api/nba/teams` operativos.
- ✅ **7b Oracle NBA**: `server/prompts/oracle-nba-prompts.js` + `server/services/oracleNba.js`. Guardrail anti-hallucination activo (prohíbe web search simulado). Validado end-to-end: pick DET ML 63% conf, JSON parse limpio, sin fabricaciones.
- ✅ **7c pick lifecycle NBA**: `POST /api/nba/analyze/game` (admin-only, feature-flagged `NBA_ANALYSIS_ENABLED`). Persistencia con `sport='nba'`, `game_pk=parseInt(gameId)`.
- ✅ **7c2 resolver NBA**: `pick-resolver-nba.js` — resuelve picks NBA pendientes contra scores finales. Reutiliza `resolvePickFromFinalState` de `pick-resolver.js`. Background job cada 30 min junto al MLB.
- ✅ **7d UI**: `SportSwitcher.jsx` (pill MLB/NBA), `GameSelector` con `sport` prop (fetch `/api/nba/games`, normalización a shape MLB-compatible, oculta pitcher section), `AnalysisPanel` con `sport` prop (endpoint NBA, oculta betType/engine/webSearch/lineup gates).
- ✅ **7.1 dataset + shadow aislados** — `?sport` en admin APIs, `nbaShadowValidator`/`nbaShadowPersistence`, migración columnas NBA, `data.py` filtra por sport, toggles en `DatasetDashboardV2` + `ShadowModeDashboard`.
- ⏳ **7e NBA ML sidecar** — condicional, post ~500 picks NBA resueltos. No urgente.

**NBA hardening — Sprint 7.0 + 7.1 cerrados en código (2026-05-15)**:

7.0: injuries/status ESPN, odds server-side ([server/nba-odds.js](server/nba-odds.js)), `context_meta` en analyze game/chat. 7.1: aislamiento dataset/shadow/training por `sport`; filas NBA en `pick_features` y runs en `shadow_model_runs` sin contaminar MLB. Falta validación con tráfico real antes del flip público.

**Checklist original** (preservado como referencia histórica):

0) **Regla de seguridad operativa**
- No tocar lógica MLB ni archivos frozen de Oracle MLB. Todo NBA en rutas/servicios/prompt/UI NBA o archivos nuevos.
- Trabajar en ramas dedicadas `fix/nba-*` o `feat/nba-*` (no mezclar con tareas MLB).

1) **Separación MLB/NBA en historial y lifecycle (HOTFIX crítico)**
- ✅ `client/src/hooks/useHistory.js`: propaga `sport` desde filas DB y acepta filtro por deporte.
- ✅ `client/src/components/HistoryPanel.jsx`: render condicional por `sport`; logos NBA/MLB separados.
- ✅ `server/index.js` `GET /api/picks`: soporta `?sport=mlb|nba` para historial/summary aislados.
- ✅ Resolver/tracking MLB endurecido para ignorar picks NBA pendientes (`COALESCE(sport,'mlb')='mlb'`).
- Estado: **cerrado en código** (pendiente verificación en producción tras deploy).

2) **SAFE PICK en NBA (HOTFIX crítico)**
- ✅ SAFE bloqueado en NBA en `AnalysisPanel.jsx` (no llama `/api/analyze/safe` cuando `sport='nba'`).
- ✅ Política vigente: **Player Props NBA deshabilitado** (guardrail server-side en `server/routes/nba.js`).
- Estado: **cerrado en código**.

3) **Fuente de datos y consistencia de IDs**
- ✅ Priorizar ESPN para disponibilidad (Railway) y mantener fallback controlado.
- ✅ Mapping estable `espnTeamId <-> nbaStatsTeamId` en [server/nba-team-map.js](server/nba-team-map.js); `context_meta.teamIds` en context builder.
- Criterio de salida: contexto NBA sin bloques `data unavailable` por mismatch de IDs — validar en prod con `smoke:nba`.

4) **Calidad de contexto NBA (paridad de profesionalismo)**
- Añadir bloque estructurado de injuries/status (fuente confiable) al contexto NBA.
- Integrar market odds server-side para NBA cuando el cliente no envía líneas.
- Exponer `context_meta` (freshness, completeness, stale flags) para observabilidad admin.

5) **Guardrails de salida LLM NBA**
- ✅ [server/services/nbaOutputGuard.js](server/services/nbaOutputGuard.js) — valida antes de persistir; rechaza parse/props/ABSTAIN; degrada con `alert_flags` si faltan campos secundarios.
- Criterio de salida: no persistir picks NBA ambiguos — validar en prod.

6) **Resolución y tracking NBA**
- Endurecer resolver/tracker NBA por mercado soportado (moneyline/spread/total primero).
- Evitar que jobs MLB procesen picks NBA y viceversa.
- ✅ `pick-resolver-nba.js` procesa solo `sport='nba'`.
- ✅ `pick-resolver.js`, `/api/picks/live-progress` y `/api/picks/resolve-game` filtran MLB explícitamente.
- Estado: lifecycle aislado en código; queda validar run post-deploy.

7) **ML NBA (fase posterior)**
- Iniciar sidecar NBA cuando exista volumen mínimo de picks resueltos con calidad.
- Mantener dataset NBA aislado de MLB en entrenamiento y calibración.

**Matriz de calidad por deporte (release gate)**

Usar esta matriz antes de abrir/expandir un deporte. Escala sugerida: 0-10 por criterio, con umbral de release >= 8.5 global y ningun criterio critico < 8.

| Criterio | MLB (actual) | NBA (actual) | Gate minimo |
|---|---:|---:|---:|
| Data depth pregame (features contextuales) | 9.5 | 6.5 | 8.0 |
| Data quality live (latencia + disponibilidad) | 8.5 | 7.0 | 8.0 |
| Lineup/Injury verification estructurada | 9.0 | 5.5 | 8.0 |
| Market coverage soportada por data real | 9.0 | 6.0 | 8.0 |
| Guardrails LLM (schema + fallbacks + policy) | 8.5 | 7.0 | 8.0 |
| Pick lifecycle (tracking -> resolver -> postmortem) | 9.0 | 7.5 | 8.0 |
| Calibration/ROI observables por mercado | 8.5 | 6.0 | 8.0 |
| Isolation por deporte (sin contaminacion cruzada) | 8.5 | 8.0 | 8.5 |

**Criterios de "go public" para NBA**
- SAFE PICK NBA aislado de endpoints MLB y con politica propia. ✅
- Player Props NBA desactivado (o habilitado solo con dataset robusto + resolver dedicado). ✅
- Historial, logos, resolver, jobs, dataset admin y shadow runs aislados por `sport`. ✅
- Contexto NBA con injuries/status + odds server-side + metadata de completitud. ✅

**Foco docs / ops (2026-05-29, post-B2/B10)**:
- **B2 Hexa Live SSE** ✅: `LiveTracker.jsx` migrado a SSE per-game. Descubrimiento cada 3 min + EventSource por gamePk (evento `message` default, cadencia 15s). `HexaLiveStream.jsx` eliminado. Lag real ~1-2s vs 30s anterior.
- **B10 Alt lines UI** ✅: `AltLinesModal.jsx` + botón en `PlayerPropsPage.jsx` ya estaban completos; roadmap sincronizado.
- **Ensemble**: deploy ML sidecar con los cambios de 8c → reentrenar `all` desde `/admin/ml-control` → verificar que `ensembles_available` en `/health` muestre los 4 mercados cuando haya datos suficientes.
- **Props ensemble**: el modelo `prop` entrena cuando `shadow_model_runs` tenga ≥50 filas `pick_market_type='prop'` resueltas con los 3 probs. Monitorear en panel "Chat-sourced picks" de `/admin/ml-control`.
- **Context enrichment (8d)**: deploy hexa-v4 con los cambios de 8d → verificar en análisis real que los bloques UMPIRE, TEAM FORM y SCHEDULE FATIGUE aparecen en el contexto; si Savant umpire-scorecard cambia el CSV header, actualizar `getUmpireStats` en `savant-fetcher.js`.
- Completar Sprint 5 props: resolver lifecycle + validación Brier; `MLB_PROPS_ML_PUBLIC_ENABLED` cuando pase el gate.
- NBA: validación E2E en prod con `NBA_ANALYSIS_ENABLED`; equity en bottom nav (menor).
- ✅ **NFL Sprint 9 completo** (PRs #373–#378, 2026-05-30): Oracle, lifecycle, shadow/dataset, live tracker, UI selector activo, ML scaffolding. Sin pendientes de código — solo operacionales (temporada sept 2026).

**Shadow dashboard — lectura de fechas**:
- Columna **Hora Lima** = `pick_time_lima` / `created_at` (cuándo se corrió el análisis).
- Sufijo `· juego DD mon` = `game_date` del partido cuando difiere del día del run.

---

## Cuando tengas dudas

- Arquitectura: [docs/architecture.md](docs/architecture.md)
- ML / Oracle: [docs/ml-pipeline.md](docs/ml-pipeline.md)
- APIs externas: [docs/integrations.md](docs/integrations.md)
- Pipeline X / content: [docs/content-pipeline.md](docs/content-pipeline.md)
- Admin / ops: [docs/admin-and-ops.md](docs/admin-and-ops.md)
- Schema DB: [docs/data-schema.md](docs/data-schema.md)
- Próximos pasos: [docs/roadmap.md](docs/roadmap.md)
- Parlay Synergy spec: [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md)
