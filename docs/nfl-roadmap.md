# Roadmap NFL — H.E.X.A. v4

Plan de construcción del **tercer deporte**, espejo exacto de la serie NBA (Sprint 7). Detalle técnico y de datos en [nfl-architecture.md](nfl-architecture.md). Checklist multi-deporte en [sport-registry.md](sport-registry.md).

**Estado**: 🔄 en build. **9a (scaffolding)** y **9b (Oracle NFL)** mergeados (PRs #373, #374); **9c (pick lifecycle: rutas + odds + resolver)** cerrado en código (rama `feat/nfl-lifecycle-9c`). `nfl` sigue **inactivo** en el registry (`SPORT_META.nfl.active = false`); las rutas `POST /api/nfl/analyze/*` existen pero gateadas por `NFL_ANALYSIS_ENABLED=false`. Falta: dataset/shadow aislados (9.1), UI (9d), live tracker (9.2), ML sidecar (9e).

---

## Por qué NFL y por qué ahora

- **Estacionalidad**: NFL es sep–feb. Con MLB (abr–oct) + NBA (oct–abr) la plataforma queda **year-round** con el evento de mayor audiencia (Super Bowl) cerrando el ciclo.
- **Demanda**: NFL es el deporte #1 de apuestas en EE.UU. El "lock of the week" (Imperdible) y los SGP (Parlay) son productos nativos de la cultura NFL.
- **Arquitectura lista**: el pipeline ya es deporte-agnóstico (lifecycle, parlay engine, sidecar por mercado, discriminador `sport`). NBA probó el patrón; NFL lo repite.

## Regla de seguridad operativa (igual que NBA)

- No tocar lógica MLB/NBA ni archivos frozen del Oracle. Todo NFL en archivos/rutas/prompt/UI nuevos o que **importen** los frozen.
- Trabajar en ramas dedicadas `feat/nfl-*` / `fix/nfl-*`.
- Discriminador `sport='nfl'` en toda persistencia. Filtros `COALESCE(sport,'mlb')='mlb'` ya protegen MLB.

---

## Diferencias estructurales vs NBA (lo que NO es copy-paste)

1. **Cadencia semanal, no diaria.** El selector trabaja por **semana NFL** (`seasontype`+`week`), no por fecha. Los background jobs son **game-time-aware** (solo pollean en ventanas Thu/Sun/Mon).
2. **Spread es el mercado primario** (no moneyline). **Key numbers 3 y 7** son ley en value/imperdible.
3. **Cap de confianza más bajo (≈72%)**: mercado más eficiente + varianza más alta de los tres deportes.
4. **QB = variable dominante.** El gate de disponibilidad gira alrededor del QB titular confirmado (análogo del "lineup confirmado" MLB).
5. **nflverse permite pre-entrenar el sidecar con histórico real** (>20 temporadas) → modelo útil desde el día 1, sin esperar 500 picks.
6. **Push frecuente** (spread/total en número entero) → el resolver debe manejarlo explícitamente.
7. **Weather pesa** (viento/frío en estadios abiertos).

---

## Sprints

### Sprint 9a — Scaffolding de datos ✅

Espeja NBA 7a. Objetivo: leer NFL de extremo a extremo sin análisis todavía. **Cerrado en código (2026-05-29)** — pendiente smoke con tráfico real en prod (ESPN bloquea la IP del sandbox de dev con 403; el NBA equivalente también, así que se valida en Railway).

- [x] `server/nfl-api.js` — wrapper ESPN (games **por semana** vía `seasontype`+`week`, `getCurrentNflWeek`, stats/standings, injuries, recent games, `getNflGameSummary`). Cache TTL (5min/30s live, 6h/15min) + fallback stale; nunca throwea.
- [x] `server/nfl-team-map.js` — ESPN id ↔ abbr ↔ nombre + conf/división + coords estadio + flag `dome` (11 domos). Aliases (WAS→WSH, JAC→JAX, OAK→LV, SD→LAC). `resolveNflTeamId`, `getNflTeam`, `getNflStadium`, `enrichGameTeamIds`.
- [x] `server/nfl-context-builder.js` — `buildNflGameContext`: records/PF-PA, recent form, rest/short-week/off-bye, QB status desde injuries, weather (Open-Meteo, solo no-domo) + `context_meta` (sources, completeness, staleFlags). EPA/success/PROE presentes pero null hasta nflverse (9b+).
- [x] Migración `runNflScaffoldingMigrations()` (tablas `nfl_games` por semana, `nfl_team_stats`) + `runNflDatasetMigrations()` (columnas NFL en `pick_features`). Cableadas en la cadena de startup de `index.js` tras las NBA.
- [x] Endpoints públicos `GET /api/nfl/games?season=&seasonType=&week=` (sin params → semana actual), `/api/nfl/teams`, `/api/nfl/standings`.
- [x] Tests: `server/__tests__/nfl-team-map.test.js` (10 tests, lógica pura).
- **Salida**: `GET /api/nfl/games?week=N` devuelve juegos normalizados; el context builder degrada con `staleFlags` honestos cuando una fuente falla (verificado: 403 → vacío sin crash). Contexto sin bloques "data unavailable" cuando ESPN responde.

### Sprint 9b — Oracle NFL ✅

Espeja NBA 7b. **Cerrado en código (2026-05-29, rama `feat/nfl-oracle-9b`)** — el motor + prompts + guard listos; el endpoint que los expone es 9c.

- [x] `server/prompts/oracle-nfl-prompts.js` — `NFL_SYSTEM_PROMPT` + `NFL_CHAT_PROMPT` + `NFL_OUTPUT_SCHEMA_VERSION`. Cap **72%** (el más bajo de los 3 deportes), **key numbers 3/7** como ley de spread, prioridad QB→EPA(→point-diff proxy)→success→trincheras→rest→weather→situacional, guardrail anti-hallucination (sin web search/tool calls simulados, sin inventar inactivos), player props deshabilitados, anti-bias (no default favorito/OVER/home). Output JSON idéntico al schema NBA/MLB.
- [x] `server/services/oracleNfl.js` — `analyzeNflGame`, `analyzeNflChat`, `serializeNflContext` (Anthropic propio, sin Grok; **no toca oracle.js**). El serializer usa EPA cuando está, y cae a point-differential/PF-PA per game como proxy hasta nflverse; renderiza QB status, weather (dome-aware), rest/short-week/off-bye, market odds y DATA QUALITY.
- [x] `server/services/nflOutputGuard.js` — `validateNflAnalysisOutput`: rechaza parse fallido/empty/parlay/missing-pick/ABSTAIN/player-prop; degrada (no fatal) confianza fuera de rango 50–72 y reporte corto, surfacing en `alert_flags`. Espeja `nbaOutputGuard`.
- [x] Tests: `server/services/__tests__/nflOutputGuard.test.js` (11 tests). `serializeNflContext` validado end-to-end con contexto mock.
- [ ] (Opcional) `server/nfl-advanced-fetcher.js` — stats nflverse semanales (diferido; el Oracle ya funciona con el proxy point-diff).
- **Salida**: motor end-to-end listo. Verificado: prompt determinístico bien formado, guard correcto, 324 tests verdes. La llamada LLM real se valida cuando 9c exponga el endpoint (requiere `ANTHROPIC_API_KEY`).

### Sprint 9c — Pick lifecycle NFL ✅

Espeja NBA 7c + 7c2. **Cerrado en código (rama `feat/nfl-lifecycle-9c`)** — pendiente smoke con tráfico real (ESPN/Odds API bloqueados desde el sandbox de dev).

- [x] `server/routes/nfl.js` — `POST /api/nfl/analyze/game` + `/chat` (admin-only, flag `NFL_ANALYSIS_ENABLED` → 503). Lookup **por semana** (`season`/`seasonType`/`week`, default semana actual) con fallback `date`. Persiste `sport='nfl'`. Resuelve odds server-side vía `nfl-odds.js`. (pick_features/shadow → 9.1.)
- [x] `server/nfl-odds.js` — The Odds API `americanfootball_nfl`, dual key fallback. **Preserva key numbers** usando la MODA de spread/total entre books (no promedio — evita half-points falsos fuera del 3/7). `getNflGameOdds`, `matchNflOddsToGame`, `buildMarketOddsForGame` (spread-first).
- [x] `server/pick-resolver-nfl.js` — resuelve pendientes `sport='nfl'` reusando `resolvePickFromFinalState`/`tokenMatchesTeam`. **Maneja push** (cuenta wins/losses/pushes). Sin shadow back-fill (9.1).
- [x] Background job **game-time-aware** en `index.js`: corre cada 30 min solo Thu/Sun/Mon ET entre 16:00 y 05:59 (los días MLB/NBA-only no pollean ESPN NFL).
- [x] `chatPickExtractor.js` extendido a `'nfl'` (sport normaliza nba/nfl/mlb; market hint spread/total/moneyline para deportes de spread).
- [x] Tests: `server/__tests__/nfl-odds.test.js` (7 tests).
- **Salida**: crear → resolver de un pick NFL contra score final, aislado de jobs MLB/NBA. Verificado: módulos cargan, router con 2 rutas, odds match/build correcto, 331 tests verdes. La llamada LLM/Odds reales se validan en prod (requieren keys + red).

### Sprint 9d — UI 📋

Espeja NBA 7d.

- [ ] `SportSwitcher` agrega pill NFL (livery propio).
- [ ] `GameSelector` — `normalizeNflGame` + **selector por semana** + fetch `/api/nfl/games`; muestra QB titular + spread, oculta pitchers.
- [ ] `AnalysisPanel` — endpoint NFL; oculta engine/webSearch/lineup MLB.
- [ ] `NflContextMetaBadge`, `NflStandingsPanel`, `client/src/utils/nflLogoUrl.js`.
- [ ] `HistoryPanel` + `useHistory` — logos y filtro `?sport=nfl`.
- **Salida**: flujo visual completo MLB/NBA/NFL en la tab de juego (admin).

### Sprint 9.1 — Dataset + shadow aislados ✅ (backend)

Espeja NBA 7.1. **Backend cerrado en código** (rama `feat/nfl-completion`). Toggles de frontend en `DatasetDashboardV2`/`ShadowModeDashboard` → 9d.

- [x] `server/services/nflShadowValidator.js` — `calculateNflShadowScore`: scoring determinístico (fuerza EPA-diff o point-diff proxy, QB availability, rest/short-week/off-bye, injuries, recent form, home-field boost). Confianza 50–72 (cap NFL). 9 tests.
- [x] `server/services/nflShadowPersistence.js` — `saveNflPickFeatures` (columnas NFL: epa, rest, short-week/off-bye, qb_active, wind, is_dome, spread/total close, severe injuries) + `recordNflShadowRun`, ambos `sport='nfl'`, fire-and-forget. Cableados en `routes/nfl.js` tras persistir el pick.
- [x] Migración `runNflDatasetMigrations()` — ya entregada en 9a (columnas NFL en `pick_features`).
- [x] Back-fill de shadow runs en `pick-resolver-nfl.js` (`updateShadowModelRunsForGame`).
- [x] `?sport=nfl` en APIs admin: `GET /api/admin/shadow-model` + `getShadowModeDashboard` (whitelist mlb|nba|nfl); `GET /api/admin/feature-store` con branch NFL en el summary (counts + EPA/wind averages). Filas NFL aisladas vía `COALESCE(sport,'mlb')='nfl'`.
- [ ] Toggles UI NFL en `DatasetDashboardV2` + `ShadowModeDashboard`, y columnas NFL-específicas en la vista detallada del dataset → **9d**.
- **Salida**: filas NFL en `pick_features`/`shadow_model_runs` sin contaminar MLB/NBA; admin puede consultar dataset/shadow NFL por `?sport=nfl`.

### Sprint 9.2 — Live tracker NFL 📋

Sin equivalente directo NBA (NBA no pollea live). NFL sí, vía ESPN drives/plays.

- [ ] `server/pick-tracker-nfl.js` — progreso live (ML via winprobability, spread via margen, total via puntos+tiempo). Reusa `calculatePickProgress`.
- [ ] `client/src/components/NflLiveTracker.jsx`.
- [ ] Polling game-time-aware (60–90s solo en ventanas de juego).
- **Salida**: tracker live validado en una ventana de juego real.

### Sprint 9e — ML sidecar NFL (pre-entrenado) 📋

Espeja NBA 7e pero **adelantado** gracias a nflverse.

- [ ] Pre-entrenar XGBoost con play-by-play histórico nflverse (`nfl_data_py`): spread/total/ML, temporal split, Brier eval.
- [ ] Endpoints `/predict/nfl_*` en el sidecar Python; `data.py` filtra `sport='nfl'`.
- [ ] Integrar al pick-aligned shadow + ensemble cuando haya volumen.
- **Salida**: opinión ML NFL desde el día 1, calibrada contra histórico real.

---

## Producto: Parlay + Imperdible NFL

Reusan el motor existente con reglas NFL (detalle en [nfl-architecture.md](nfl-architecture.md) §6–§7).

- **Parlay Architect NFL**: matriz de correlación NFL (QB↔WR stacking, game script), soporte SGP, cadencia semanal. `hitMath.js` y modos se reusan tal cual.
- **Pick Imperdible NFL ("Lock of the Week")**: convicción invertida; gate = QB confirmado activo + margen a key number + weather OK. 1 lock/semana o PASS. Reusa `imperdibleSelector`/`imperdibleArbiter` + `imperdible_runs` con `sport='nfl'`.

---

## Feature flags NFL

| Flag | Default | Rol |
|---|---|---|
| `NFL_ANALYSIS_ENABLED` | `false` | Habilita endpoints Oracle NFL + resolver. `true` en local / Railway al lanzar MVP. |
| `NFL_LIVE_TRACKER_ENABLED` | `false` | Activa polling live game-time-aware (Sprint 9.2). |
| `NFL_PROPS_ENABLED` | `false` | Player props NFL (fase posterior, requiere resolver dedicado). |
| `IMPERDIBLE_NFL_ENABLED` | `false` | Lock of the week NFL. |

---

## Cronograma sugerido

NFL arranca en septiembre. Para llegar con MVP a **kickoff (early Sept 2026)** o, más realista, al tramo medio de temporada:

- **Verano 2026** (jun–ago, off-season NFL): Sprints 9a→9e en seco, validando contra juegos de temporadas pasadas (nflverse) y preseason (seasontype=1) para smoke.
- **Sept 2026**: flip `NFL_ANALYSIS_ENABLED` admin-only, validación E2E semana 1–3.
- **Oct 2026**: go-public gate (matriz §10 de architecture) → `nfl` a `ACTIVE_SPORTS`.
- **Playoffs / Super Bowl 2027**: Imperdible "Lock of the Week" + SGP como features estrella.

---

## Estado de release gate

Ver matriz completa en [nfl-architecture.md](nfl-architecture.md) §10. Umbral: ≥8.0 por criterio crítico, ≥8.5 en aislamiento por deporte.
