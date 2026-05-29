# Roadmap — H.E.X.A. v4

Documento vivo. Se actualiza al cierre de cada sprint y cuando entran/salen items del backlog.

**Última actualización**: 2026-05-29 — B2 + B10 frontend cerrados: `LiveTracker` migrado de batch poll 30s a SSE per-game (`/api/games/:gamePk/live/stream`); `AltLinesModal` + `PlayerPropsPage` ya completos (estaban cerrados en código, roadmap desactualizado). `HexaLiveStream.jsx` (roto/huérfano) eliminado. Sprint 8f anterior: Railway hardening + Node 20.

---

## Tabla de contenido

1. [Foco actual](#1-foco-actual)
2. [Sprints en ejecución](#2-sprints-en-ejecución)
3. [Backlog priorizado](#3-backlog-priorizado)
4. [Items rechazados](#4-items-rechazados)
5. [Cómo se prioriza](#5-cómo-se-prioriza)

---

## 1. Foco actual

**Q3 2026 → Q1 2027** — Hardening de MLB + scaffolding NBA en paralelo, con objetivo de MVP NBA listo para el All-Star Break de febrero 2027.

### Por qué este foco

MLB tiene ~6 meses muertos (nov–mar). Sin un segundo deporte, la base de usuarios se vacía cada off-season y vuelve cada abril. NBA es oct–abr: cobertura **year-round** sin pelearse por la misma noche.

La arquitectura ya está hecha para ser deporte-agnóstica:
- `oracle.js` recibe payload genérico; los prompts varían, no la estructura.
- El pick lifecycle (creation → tracking → resolution → postmortem) es deporte-agnóstico.
- El sidecar Python entrena por mercado; los mercados NBA (puntos, rebotes, asistencias, spread, total) entran como mercados nuevos sin reescribir nada.
- El Parlay Synergy Engine no asume MLB.

Lo MLB-específico vive en 4 archivos: [server/mlb-api.js](../server/mlb-api.js), [server/savant-fetcher.js](../server/savant-fetcher.js), [server/context-builder.js](../server/context-builder.js), [server/pick-resolver.js](../server/pick-resolver.js). Eso es **reemplazable, no reescritura total**.

### Pre-requisitos NBA (cerrados 2026-05-15)

1. **Equity curve + Sharpe + drawdown** — ✅ Sprint 6a cerrado ([PerformanceDashboard](../client/src/pages/PerformanceDashboard.jsx), [EquityDashboard](../client/src/pages/EquityDashboard.jsx)). Comparativa **tú vs Hexa baseline** en tab Oracle Stats del bankroll (`GET /api/bankroll/equity-stats`). Pendiente menor: acceso desde bottom nav / página dedicada para todos los usuarios.
2. **Persistencia de modelos ML** — ✅ Sprint 6b cerrado en prod (`hexa-ml-production`: Volume `/data`, `HEXA_ML_ARTIFACTS_DIR=/data/artifacts`, `artifacts_persistent: true`, redeploy verificado + `npm run verify:ml:persistence` OK).

### Foco inmediato (main, mayo 2026)

1. **Sprint 5 Player Props MLB** — 🔄 **en progreso**. Savant snapshots ✅; `prop_*` en sidecar ✅; tablero `/props` + `GET /api/mlb/props/board` ✅; picks Oracle en board cuando Odds API aún no tiene líneas ✅; `props-resolver.js` (GUMBO) ✅; parser ES (`Bajo/Ariba Ponches`) ✅. Pendiente: resolver props integrado en pick lifecycle a escala, Brier ≥100 picks/mercado, `MLB_PROPS_ML_PUBLIC_ENABLED=1`.
2. **Sprint 5b — Pick-aligned shadow + admin ML** — ✅ cerrado (PRs #345–#347, merge 2026-05-17). [pickAlignedMl.js](../server/services/pickAlignedMl.js): Oracle/legacy/Python en el mismo mercado del pick; columnas en `shadow_model_runs`; `mlOpinion` en analyze game/safe (admin); tokens `--outcome-*` para W/L/P en League; Shadow UI muestra `game_date` del partido junto a hora Lima.
3. **Brand restructure (League × Kinetic v.2.6)** — ✅ completa. Skin alternable Classic ⇄ League; **dark-only**. Admin ML + ParlayArchitect re-skinned con brand-clip-bevel + Oswald.
4. **NBA hardening live** — go-live gate mergeado. Live tracker, Oracle Chat NBA, sport-aware postmortem ✅. Pendiente: flip público `NBA_ANALYSIS_ENABLED` tras validación E2E en prod.
5. **Sprint 8a Monte Carlo bankroll** — ✅ cerrado.
6. **Oracle Chat multi-pick stats** — ✅ jornada multi-pick + stats en Admin ML Control Center.

**Explícitamente fuera de esta fase**: Sprint 7e NBA ML sidecar (waiting for ~500 NBA picks resolved); Sprint 7a basketball-reference scraper + tablas dedicadas NBA.

**Siguiente deporte — NFL (📋 planning, serie Sprint 9)**: tercer deporte, espejo del patrón NBA. Datos ESPN + The Odds API + nflverse. Spec maestra en [nfl-architecture.md](nfl-architecture.md) y roadmap por sprints en [nfl-roadmap.md](nfl-roadmap.md). Arranque sugerido: verano 2026 (off-season NFL) → MVP admin-only en kickoff de septiembre.

### El trade-off explícito

Si se queda solo en MLB y se profundiza (player props, equity, mobile), crece LTV por usuario pero no resuelve la estacionalidad — y un competidor cross-sport come el flanco. Si se salta a NBA sin la equity dashboard, los usuarios nuevos no van a entender por qué Hexa es distinto a 50 servicios de picks de NBA.

Solución aplicada: **scaffolding NBA en paralelo con equity + persistencia ML**, no en serie.

---

## 2. Sprints en ejecución

### ✅ Sprints 0-5 — Cerrados (Q2 2026)

| Sprint | Entregable | Estado |
|---|---|---|
| Sprint 0 | Documentación viva (CLAUDE.md + docs/) | ✅ |
| Sprint 1 | Gaps del dataset cerrados — 22 columnas en `pick_features`, pickParser, pickPostgameEnricher, export-dataset.js | ✅ |
| Sprint 2 | Sidecar Python FastAPI + XGBoost en `ml/`, deploy Railway (`hexa-ml-production.up.railway.app`). Moneyline (Brier 0.205, ROI +18.3%), overunder (Brier 0.138, ROI +8.5%) | ✅ |
| Sprint 3 | Integración Node↔Python con circuit breaker. Dashboard `/admin/ml-calibration` | ✅ |
| Sprint 4 | Ensemble meta-learner (LogReg sobre oracle+legacy+python en logit space). `/predict/ensemble`, `/calibration/ensemble` | ✅ |
| Sprint 5 UI | Admin ML Control Center (`/admin/ml-control`) — HUD live, retrain on-demand, audit log, chat-picks dashboard, AdminEnsembleBadge per-pick. Oracle Chat → Training pipeline con bucket `source='oracle_chat'` aislado | ✅ |

**Sprint 5 Player Props MLB** — ✅ **código completo** (audit 2026-05-29; pendiente solo acumulación de datos):
- ✅ Savant snapshots estructurados en `pick_features`.
- ✅ Prop-kind markets en sidecar training + inference (`prop_hits`, `prop_strikeouts`, etc.).
- ✅ Tablero UI `/props` + API `GET /api/mlb/props/board` ([mlb-props.js](../server/routes/mlb-props.js), [PlayerPropsPage.jsx](../client/src/pages/PlayerPropsPage.jsx)).
- ✅ Bloque **Picks Oracle (guardados)** en board (desde `picks` por `game_date` / `game_pk`).
- ✅ [props-resolver.js](../server/props-resolver.js) — boxscore GUMBO para K/H/TB/HR/RBI.
- ✅ Parser español en [pickParser.js](../server/parsers/pickParser.js).
- ✅ Resolver automático integrado en `resolvePendingPicks()` vía `resolvePickFromFinalState` — props se resuelven en el job de 30 min junto a moneyline/runline/OvUn. Escribe `result` + `propResult` al DB.
- ✅ ML scores en board gateados por `is_admin` (admin los ve siempre) o `MLB_PROPS_ML_PUBLIC_ENABLED=1` (público). Flag listo en código.
- ✅ `mlModelHealth.js` trackea `prop_hits`, `prop_strikeouts`, `prop_total_bases`, `prop_home_runs`, `prop_rbis` — visibles en HUD de `/admin/ml-control`.
- ⏳ **Ops**: acumular ≥50 picks props resueltos con los 3 scores (oracle/legacy/python) para que el sidecar entrene el modelo `prop`. El HUD muestra n_train por mercado — cuando llegue a 50+, hacer retrain desde `/admin/ml-control` y verificar Brier.
- ⏳ **Ops**: flippear `MLB_PROPS_ML_PUBLIC_ENABLED=1` en Railway cuando pase el gate Brier.

**Sprint 5b — Pick-aligned shadow + admin ML** — ✅ **cerrado** (2026-05-17):
- [pickAlignedMl.js](../server/services/pickAlignedMl.js) + migración columnas `shadow_model_runs`.
- `mlOpinion` en `POST /api/analyze/game` y `/api/analyze/safe` (admin).
- [AdminMlOpinionCard.jsx](../client/src/components/AdminMlOpinionCard.jsx) en AnalysisPanel.
- Tokens `--outcome-win|loss|pending` + [outcomeStyles.js](../client/src/theme/outcomeStyles.js) en History/Dataset/Equity/Shadow.
- Tests: `pickAlignedMl.test.js`, `pickParser.test.js`.

---

### ✅ Sprint 6 — Pre-NBA hardening (Q3 2026, ~6 semanas)

**Status**: ✅ **cerrado** (2026-05-15). 6a + 6b completos; comparativa bankroll entregada. Pendiente menor: equity en bottom nav.

Corre en paralelo con Sprint 7; ya no bloquea hardening NBA en código.

#### Sprint 6a — Equity curve + Sharpe + drawdown dashboard (~2 semanas)

**Status**: ✅ **cerrado** (2026-05-15). Comparativa tú vs Hexa en `GET /api/bankroll/equity-stats` + panel en [BankrollTracker](../client/src/components/BankrollTracker.jsx) (tab Oracle Stats, ventana 90d). Pendiente menor: `GET /api/users/:id/equity-stats` y enlace en bottom nav.

Tier S1 del backlog. Sin esto, el usuario serio no entiende qué hace Hexa.

**Entregables**:
- `client/src/pages/PerformanceDashboard.jsx` ampliado (o nueva página `EquityDashboard.jsx`): curva de equity por usuario (USD acumulados o unidades), drawdown (peak-to-trough), Sharpe ratio rolling 30d, win rate por mercado, ROI por mes.
- Endpoint nuevo `GET /api/users/:id/equity-stats` (o ampliar `/api/picks/clv-stats`): agrega desde `picks` + `bankroll_transactions`.
- Comparativa "tú vs. Hexa baseline" si el usuario siguió otros picks vs. solo Hexa.
- Configurable: ventanas de 7d / 30d / 90d / YTD / all-time.

**Criterio de éxito**:
- Un usuario nuevo entiende su P&L y volatilidad en <10s viendo la página.
- Datos vienen de las tablas que ya existen — sin migraciones de schema.
- Página accesible desde el bottom nav del frontend.

**Riesgo**: bajo. Sin LLM, sin backend nuevo crítico — son agregaciones SQL + Recharts.

---

#### Sprint 6b — Persistencia de modelos ML (~1-2 semanas)

**Status**: ✅ **cerrado en prod** (2026-05-15). Volume en `/data`, `HEXA_ML_ARTIFACTS_DIR=/data/artifacts`, `artifacts_persistent: true` en `/health`, modelos `moneyline` + `overunder` cargados. Redeploy del servicio `hexa-ml` verificado sin retrain; `npm run verify:ml:persistence` → OK. Runbook de mantenimiento: [admin-and-ops.md](admin-and-ops.md#11-ml-sidecar--persistencia-de-modelos-sprint-6b).

**Problema que resolvía**: el sidecar Python guardaba los `.pkl` en `artifacts/` efímero. Cada redeploy wipeaba modelos y los picks nuevos caían al validator legacy hasta retrain manual.

**Opciones evaluadas**:

| Opción | Pro | Contra | Recomendación |
|---|---|---|---|
| **Railway Volumes** (persistent disk) | Cambio mínimo: solo apuntar `artifacts_dir` a `/data`. Sigue siendo un filesystem normal. | Vendor lock-in suave a Railway. Requiere configurar el volume en el dashboard del sidecar. | ✅ **Esta**. |
| Guardar `.pkl` en Postgres como `BYTEA` | Portable, sobrevive a cambio de hosting. | Reescribe `ModelRegistry`. Latencia de carga (~50ms extra). Limita tamaño de modelo (Postgres prefiere <1MB blobs). | No, salvo que se cambie de Railway. |
| Object storage externo (R2 / S3) | Más limpio que Postgres BYTEA. | Añade dependencia + IAM + costo (mínimo pero existe). | Considerar si se rompe el lock-in a Railway. |

**Entregables (opción Railway Volumes)**:
- Volume montado en `/data` en el servicio `hexa-ml` de Railway.
- Env var `HEXA_ML_ARTIFACTS_DIR=/data/artifacts` (override del default).
- [ml/hexa_ml/config.py](../ml/hexa_ml/config.py): leer `artifacts_dir` desde env si está definido.
- Migración del primer retrain post-volume: forzar retrain manual de todos los mercados desde `/admin/ml-control` para poblar el volume.
- Documentar en [docs/admin-and-ops.md](admin-and-ops.md) que el volume es crítico y no debe borrarse.

**Criterio de éxito** (cumplido):
- Redeploy manual del sidecar en Railway sin perder `.pkl` en disco.
- `GET /health` → `artifacts_persistent: true`, `artifacts_dir=/data/artifacts`.
- `GET /api/admin/ml/status` muestra Brier/n_train sin retrain post-redeploy.
- Pick nuevo post-redeploy llega al Python sidecar (circuit cerrado).

**Verificación prod (2026-05-15)**: `GET https://hexa-ml-production.up.railway.app/health` → `artifacts_persistent=true`, `models_loaded=["moneyline","overunder"]`; redeploy verificado; `HEXA_ML_API_URL=... npm run verify:ml:persistence` → OK.

**Riesgo residual**: bajo. Si se borra el Volume o se cambia `HEXA_ML_ARTIFACTS_DIR` a ruta bajo `/app`, vuelve el comportamiento efímero. El fallback de `/api/admin/ml-calibration` (lee `ml_retrain_log`) protege la UI pero no las predicciones en vivo.

---

#### Post-6 — Hardening plataforma (2026-05-15, cerrado en código)

**Status**: ✅ **cerrado en código**. Pendiente: smoke en producción tras deploy.

| Área | Entregable | Archivos clave |
|---|---|---|
| Parlay Architect | Hidratación de legs desde `candidate_pool`; fechas ±1 día; legs no resueltos → loss cuando el parlay ya perdió; AUTO habilitado en runs `db_*` con `run_id` persistido | [parlayResolver.js](../server/services/parlayResolver.js), [parlayRunOutcome.js](../server/services/parlayRunOutcome.js), [ParlayArchitect.jsx](../client/src/pages/ParlayArchitect.jsx) |
| ML observability | HUD Models/Ensemble + panel inferencia por mercado (artefacto, RAM, runline skipped/early) | [mlModelHealth.js](../server/services/mlModelHealth.js), [AdminMLControlCenter.jsx](../client/src/pages/AdminMLControlCenter.jsx) |
| NBA datos | Mapeo estable ESPN ↔ stats.nba.com para `teamgamelog` y contexto | [nba-team-map.js](../server/nba-team-map.js), [nba-context-builder.js](../server/nba-context-builder.js) |
| NBA guardrails | Validación de salida LLM antes de persistir pick (`outputQuality`, rechazo de props/parse defectuoso) | [nbaOutputGuard.js](../server/services/nbaOutputGuard.js), [routes/nba.js](../server/routes/nba.js) |

---

### ⏳ Sprint 7 — Expansión NBA, scaffolding + MVP (Q4 2026 → Q1 2027, ~10-14 semanas)

**Status**: 🔄 en ejecución. 7a–7d + hardening 7.0–7.1 entregados en código. Pendiente: go-live público y 7e (ML NBA).

**Target**: MVP NBA listo para el **All-Star Break (15-17 feb 2027)** o antes. Es la ventana donde MLB está dormido y NBA está en pico de interés (playoffs approach).

#### Sprint 7.0 — NBA hardening gate (hotfix obligatorio antes de abrir) (~1-2 semanas)

Estado: ✅ cerrado en código (2026-05-15). Añadido 2026-05-15: mapeo `nba-team-map.js`, guardrails `nbaOutputGuard.js`. **Gate restante**: validación end-to-end con tráfico real antes del flip público (rama `feat/nba-go-live-gate`).

Objetivo: eliminar contaminación MLB↔NBA en flujo de picks y cerrar errores de modo SAFE en NBA antes de crecer features.

Entregables:
- Separación estricta de historial por `sport`:
  - ✅ `client/src/hooks/useHistory.js` preserva `sport` y soporta filtro por deporte.
  - ✅ `client/src/components/HistoryPanel.jsx` renderiza matchup/logos por deporte.
  - ✅ `GET /api/picks?sport=mlb|nba` retorna historial/summary aislados.
- SAFE PICK en NBA:
  - ✅ bloqueada ruta MLB `/api/analyze/safe` cuando `sport='nba'`.
  - ✅ mercados no soportados restringidos; Player Props NBA deshabilitado.
- Política temporal de producto:
  - ✅ **Player Props NBA deshabilitado** hasta contar con dataset/featurización de nivel producción.
- Persistencia y consultas:
  - ✅ inserts NBA persisten `sport='nba'` explícitamente.
  - ✅ listados/filtros base aislados por `sport` en historial/lifecycle.
  - ✅ resolver/tracking MLB ignora picks NBA pendientes.
- Calidad de contexto NBA:
  - ✅ Injuries/status estructurados desde ESPN league-feed ([server/nba-api.js](../server/nba-api.js): `getNbaLeagueInjuries`, `findTeamInjuries`) integrados en `buildNbaGameContext` y render en bloque por equipo.
  - ✅ Market odds server-side vía The Odds API `basketball_nba` ([server/nba-odds.js](../server/nba-odds.js)). Routes resuelven odds si el cliente no las envía; persistencia y prompt usan la misma fuente.
  - ✅ `context_meta` expuesto en `meta` de `/api/nba/analyze/game` y `/analyze/chat`: `sources`, `completeness`, `overallCompleteness`, `staleFlags`. Lookup `team_id ↔ team_abbr` con fallback para evitar bloques "data unavailable" cuando la fuente es ESPN.
  - ✅ Mapeo ESPN → NBA Stats team id ([nba-team-map.js](../server/nba-team-map.js)); `context_meta.teamIds` documenta remapeo.
  - ✅ Validación de salida Oracle NBA server-side ([nbaOutputGuard.js](../server/services/nbaOutputGuard.js)) — no persiste picks ambiguos o player props.

Criterio de éxito:
- ✅ Un análisis NBA guardado aparece como NBA en historial, breakdown y cards.
- ✅ Cero errores tipo "Game not found" por cruce de SAFE MLB en flujo NBA.
- ✅ Ninguna regresión detectada en suite MLB crítica.
- ✅ Contexto NBA incluye injuries y odds server-side; `context_meta` permite a la UI admin filtrar/anotar picks con `staleFlags`.

#### Sprint 7.1 — Dataset + shadow model aislados por deporte (~3-5 días)

Estado: ✅ **cerrado en código** (2026-05-15). PR de implementación mergeado o en review; docs en rama `docs/sprint7-1-nba-isolation`.

Objetivo: que picks NBA no contaminen métricas MLB ni entrenamiento XGBoost default, y que admin pueda inspeccionar dataset/shadow por deporte.

Entregables:
- **Admin APIs con `?sport=mlb|nba`**:
  - `GET /api/admin/feature-store` — summary, coverage, calendario y registros filtrados por `COALESCE(sport,'mlb')`. NBA usa columnas de ratings/pace/rest/injuries; MLB conserva Statcast/temperature.
  - `GET /api/admin/shadow-model` — dashboard de runs filtrado por `sport` ([server/shadow-model.js](../server/shadow-model.js)).
- **NBA shadow validator** (módulo aparte, sin tocar frozen MLB):
  - [server/services/nbaShadowValidator.js](../server/services/nbaShadowValidator.js) — scoring determinístico NBA (net/off/def, pace, rest, injuries, form).
  - [server/services/nbaShadowPersistence.js](../server/services/nbaShadowPersistence.js) — persiste `pick_features` + `shadow_model_runs` con `sport='nba'` en analyze NBA.
  - Wire en [server/routes/nba.js](../server/routes/nba.js); resolución de shadow runs en [server/pick-resolver-nba.js](../server/pick-resolver-nba.js).
- **Migración Sprint 7.1** ([server/migrate.js](../server/migrate.js) `runNbaDatasetMigrations`):
  - `shadow_model_runs.sport` + índice.
  - Columnas NBA en `pick_features` (team ids/abbrs, ratings, pace, TS%, rest, B2B, injuries, last10, `context_completeness`).
- **Training Python aislado**: [ml/hexa_ml/data.py](../ml/hexa_ml/data.py) — `load_from_postgres(..., sport='mlb')` por default; filtra `source='live'` y `COALESCE(sport,'mlb')`.
- **Chat picks**: [server/services/chatPickExtractor.js](../server/services/chatPickExtractor.js) acepta `sport` en `saveExtractedChatPick` / `processChatAnswer`.
- **Admin UI**:
  - [client/src/components/ShadowModeDashboard.jsx](../client/src/components/ShadowModeDashboard.jsx) — toggle MLB/NBA.
  - [client/src/components/DatasetDashboardV2.jsx](../client/src/components/DatasetDashboardV2.jsx) — toggle MLB/NBA, coverage/tabla NBA, backfill MLB-only deshabilitado en vista NBA.

Criterio de éxito:
- Admin puede ver dataset y shadow runs de NBA sin mezclar filas MLB.
- Cada analyze NBA genera fila en `pick_features` y run en `shadow_model_runs` con `sport='nba'`.
- Retrain XGBoost default sigue usando solo MLB salvo override explícito de `sport`.

#### Sprint 7a — Scaffolding de datos NBA (~3 semanas)

**Status**: ✅ **parcial** — core entregado; tablas dedicadas `nba_games` / scrapers avanzados siguen en backlog.

**Entregables**:
- ✅ `server/nba-api.js`: wrapper NBA Stats + ESPN fallback (injuries).
- ✅ `server/nba-context-builder.js`: ratings, pace, rest, form, injuries, `context_meta`.
- ⏳ `server/nba-savant-equivalent.js`: scraper basketball-reference / cleaningtheglass.
- ⏳ Tablas dedicadas `nba_games`, `nba_player_stats`, `nba_team_stats` (hoy se usa `pick_features` compartida con `sport` + columnas NBA — ver Sprint 7.1).
- ✅ `picks.sport` y `pick_features.sport` (`VARCHAR`, default `'mlb'`).
- ✅ Columnas NBA en `pick_features` (ratings, pace, rest, injuries, etc.) — Sprint 7.1.

**Criterio de éxito**:
- `node scripts/test-nba-context.js --game=<id>` imprime payload completo en <2s.
- Tabla `nba_games` se llena con games del día via cron job.

---

#### Sprint 7b — Oracle NBA + prompts adaptados (~3 semanas)

**Status**: ✅ **cerrado** (Anthropic-only; sin Grok dual en NBA).

**Entregables**:
- ✅ `server/prompts/oracle-nba-prompts.js` + `server/services/oracleNba.js` (no toca [oracle.js](../server/oracle.js)).
- ✅ Endpoints: `POST /api/nba/analyze/game`, `POST /api/nba/analyze/chat` (admin, `NBA_ANALYSIS_ENABLED`).
- ⏳ Parlay / player-props NBA — fuera de MVP.
- Mercados v1: moneyline, spread, total, player points (más altos volumen NBA).
- Mercados v2 (post-MVP): rebounds, assists, threes, double-double.

**Criterio de éxito**:
- Análisis NBA real corre en producción, admin-only feature flag (`NBA_ANALYSIS_ENABLED`).
- 50+ picks NBA creados en periodo de testing antes de abrir a usuarios.

---

#### Sprint 7c — NBA pick lifecycle (~2 semanas)

**Status**: ✅ **cerrado** (resolver + live tracker en producción, 2026-05-15).

**Entregables**:
- ✅ `server/pick-resolver-nba.js`: moneyline/spread/total; job cada 30 min; actualiza shadow runs NBA.
- ✅ `server/pick-tracker-nba.js` + `NBALiveTracker.jsx`: tracking en vivo quarter-by-quarter con period/clock + per-quarter scores + team stats (`feat(nba): real Live tracker`).
- ✅ `nba-api.js` enriquece `getNbaGamesForDate` con `live_period`, `live_clock`, `home_qtrs/away_qtrs`, FG%/3P%/FT%/AST/REB/TOV desde LineScore.
- ✅ Adaptive cache TTL (30s live / 5min off-days) para `stats.nba.com`.
- ✅ [pick-postmortem.js](../server/pick-postmortem.js) sport-aware (`feat(nba): Oracle Chat, lightweight board, sport-aware postmortem`).

**Criterio de éxito**:
- ✅ Pick NBA creado → tracked en vivo → resuelto automáticamente post-game → postmortem generado. Zero intervención manual.

---

#### Sprint 7d — UI NBA + integración con frontend (~2 semanas)

**Status**: ✅ **cerrado** en tab de juego; admin dataset/shadow con toggle en 7.1.

**Entregables**:
- ✅ Sport switcher en tab de juego (`SportSwitcher.jsx`).
- Reutilizar [HexaBoard](../client/src/components/HexaBoard.jsx), [AnalysisPanel](../client/src/components/AnalysisPanel.jsx), [PickCard](../client/src/components/PickCard.jsx) con prop `sport`.
- Vistas NBA-específicas: matchup card con def-rating, pace, B2B indicator.
- ML Calibration y Control Center: tabs separados MLB / NBA o columnas con badge `sport`.

**Criterio de éxito**:
- Usuario puede cambiar entre MLB y NBA con un toggle, sin perder estado de su pick history.
- No hay regresión en flows MLB existentes.

---

#### Sprint 7e — NBA ML sidecar (~3 semanas, condicional)

Solo se construye **después** de acumular ~500 picks NBA resueltos. Probablemente Q1 2027.

**Entregables**:
- Modelo XGBoost NBA por mercado (moneyline, spread, total, player_points).
- Reusa la infra del sidecar Python actual — solo añade nuevos endpoints `/predict/nba/*` y configs por sport.
- Ensemble meta-learner NBA (oracle_nba + python_nba; legacy validator NBA opcional).

**Criterio de éxito**: Brier moneyline NBA < 0.22 en test set.

---

### ✅ Parlay Architect — modo Safe (Máx. Acierto) (Q2 2026)

**Status**: ✅ **cerrado** (2026-05-26).

**Problema que resolvía**: el arquitecto optimizaba por **edge** (valor vs mercado), no por **probabilidad de que las patas peguen**. Resultado: seleccionaba sistemáticamente underdogs/posiciones contrarias (edge alto, ~55% prob) y rechazaba favoritos eficientes (edge ≈ 0 porque el mercado los precia bien). Filosofía value-betting de alta varianza — opuesta a "que peguen la mayoría de las patas". Eso explica el swing de 15/16 (suerte) a ~2/10 (regresión de la estrategia contraria).

**Entregables**:
- Modo `safe` en [composer.js](../server/services/parlayEngine/composer.js): scoring por probabilidad conjunta (`Σ log(modelProbability)`), semillas ordenadas por probabilidad cruda, acuerdo XGBoost como desempate, **sin piso de edge** (admite favoritos con edge ≤ 0), piso de confianza 62% + data-quality 60%.
- `SAFE MODE OVERRIDE` en [prompts.js](../server/services/parlayEngine/prompts.js) — condicional a `MODE=safe`, no toca el prompt de los modos value.
- [hitMath.js](../server/services/parlayEngine/hitMath.js) — distribución Poisson-binomial: patas esperadas, P(pegan todas), P(≥N-1). Expuesta en la respuesta + warning honesto para N≥6.
- UI: opción "Seguro (Máx. Acierto)" + panel "Aciertos Esperados" en [ParlayArchitect.jsx](../client/src/pages/ParlayArchitect.jsx).
- Tests: `composer.test.js` (selección safe) + `hitMath.test.js` (Poisson-binomial).

**Realidad estadística asumida**: aun con favoritos del 65%, un parlay de 10 patas pega entero ~1.3% de las veces (esperas ~6.5/10). El modo no vence esa matemática — pero elige las patas correctas y muestra la expectativa real para que el usuario calibre (sugiere 4-6 patas).

**Refactor autorizado** del parlayEngine (normalmente frozen).

---

### ✅ Sprint 8a — Monte Carlo forward bankroll simulation (Q3 2026)

**Status**: ✅ **cerrado** (2026-05-15) — commit `27a9ee0`.

Bootstrappea unit returns desde picks históricos resueltos (mismos filtros sport/fecha que la equity dashboard) y proyecta N futuros alternativos sobre un horizonte configurable. Reporta fan chart P10/P50/P90 de equity, histograma de bankroll terminal, P(profit), P(ruin), expected max drawdown.

**Entregables**:
- Pure Node, zero deps. ~5k sims × 162 picks corre en <500ms locally.
- Seedable RNG (Mulberry32) para tests deterministas.
- 17 tests cubriendo validación, determinismo, correctness empírica (mean terminal vs analytic expectation), output shape, drawdown invariants.
- Dos staking strategies v1: `flat` (USD fijo por pick, matches equity histórica), `percent` (% de bankroll actual, compounding, puede ruin).

---

### ✅ Brand Restructure — League × Kinetic v.2.6 (Q3 2026)

**Status**: ✅ **shippeada** en PR #337 (rama `feat/league-kinetic-skin`, branch al closing).

Diseñada por claude.ai/design. Brand book broadcast (navy uniform + lava/volt sport liveries, Oswald + Barlow + JetBrains Mono + Helvetica, clip-path angular, escudo H). Implementada como **skin alternable** sin tocar la UI cyber-neon clásica.

**Arquitectura — 3 capas**:
- **Tokens**: nuevas paletas `palettes/leagueKinetic.js` + `leagueKineticLight.js` espejo de `dark.js`/`light.js`. El factory `buildMuiTheme` se las traga sin cambios.
- **CSS layer**: `styles/leagueKineticOverrides.css` bajo `:root[data-brand='league-kinetic']` reescribe `--neon-*` vars, apaga CRT scanlines + glows, carga utility classes (`.brand-clip-bevel`, `.brand-skew`, `.brand-broadcast-strip`, `.brand-ticker`, `.brand-shield`, `.brand-pin`).
- **Componentes paralelos `*League.jsx`**: `HexaBoardLeague`, `GameSelectorLeague`, `AnalysisPanelLeague`, `HistoryPanelLeague`. `App.jsx` hace `isLeague ? HexaBoardLeague : HexaBoard` — los demás surfaces caen a la versión clásica.

**Toggle UI**:
- `components/shell/BrandToggle.jsx` — pill segmented `[CLÁSICO | LEAGUE]`.
- Visible en Topbar (desktop md+) y en el pie del Sidebar (drawer en mobile).
- Persistido en `localStorage.hexa.theme.brand`.

**Mode**: hardcodeado a `dark` (2026-05-16). El ThemeToggle fue eliminado del Topbar y Sidebar. Las paletas light y bloques `[data-theme='light']` siguen en el código pero quedaron inactivas — fáciles de reactivar si la toggle vuelve.

**PWA**:
- Manifest: name "Hexa Oracle · League", theme_color + background_color `#0B2540`.
- `public/icon-brand.svg` — escudo H nuevo como favicon SVG + manifest icon primario.
- Script inline pre-paint en `index.html` ajusta `<meta theme-color>` según brand antes del mount.

**Scope re-skineado**: Shell (Topbar + Sidebar + BottomNav + SportSwitcher con livery dual) + Pizarra del día + Tab Juego (GameSelector + AnalysisPanel) + Historial + OracleChat/Dataset/Live con pass League-aware.

**Pendiente**:
- ✅ Re-skin `AdminMLControlCenter` + `ParlayArchitect` — brand-clip-bevel + Oswald/volt en League mode (Sprint 8e).

---

### ✅ Sprint 8f — Railway hardening + Node 20 (Q3 2026)

**Status**: ✅ **cerrado** (2026-05-29) — PRs #368, #369, #370.

**Problema que resolvía**: merge del roadmap PR (#368) produjo tres crashes de startup en CI y dos crashes en Railway en producción: el server Node y el sidecar Python caían antes de aceptar tráfico.

**Crashes corregidos**:

| Crash | Causa | Fix |
|---|---|---|
| `ReferenceError: requireAdmin is not defined` | Faltaba en el import de `auth-middleware.js` | Añadido al import destructuring |
| `ValidationError: Custom keyGenerator…ipKeyGenerator` | `express-rate-limit v8` requiere `ipKeyGenerator` helper explícito | Importado + usado en keyGenerator |
| `SyntaxError: 'generateDraftForType' not exported` | `newsletterService.js` usaba nombre viejo (renombrado a `generateContentDraft`) | Corregido el import |
| `ERR_MODULE_NOT_FOUND: @sentry/node` (Railway, Node 18) | `observability.js` importaba Sentry estáticamente; Railway usaba Node 18 (service root `server/` hace invisible el `.nvmrc` raíz) | `observability.js` refactorizado a import dinámico; `server/.nvmrc` creado; `NIXPACKS_NODE_VERSION=20` en Railway |
| `ModuleNotFoundError: No module named 'httpx'` (Hexa ML) | `fangraphs_scraper.py` usa httpx + bs4; solo estaban en dev deps; `serve.py` los importaba a nivel de módulo | httpx + bs4 promovidos a runtime deps; import defensivo con `try/except` en `serve.py` |

**Entregables**:
- `server/observability.js` — lazy Sentry: `_Sentry = await import('@sentry/node')` dentro de `initSentry()`. Sin paquete o sin `SENTRY_DSN`, el servidor arranca igual.
- `server/email.js` — lazy Resend: `getResendClient()` con `await import('resend')`; sin `RESEND_API_KEY` o Node < 20, las funciones de email son no-ops.
- `server/index.js` — discord lazy: `import('./services/discordBot.js').then(...)`. `initSentry(app).catch(() => {})`.
- `server/.nvmrc` — contiene `20`; pin de Node en el service root que Nixpacks lee.
- `package.json` — `"engines": { "node": "20.x" }`.
- `ml/requirements.txt` + `ml/pyproject.toml` — `httpx==0.27.2` + `beautifulsoup4==4.12.3` en runtime.
- `ml/hexa_ml/serve.py` — `_FANGRAPHS_AVAILABLE` flag; endpoints `/fangraphs/*` devuelven HTTP 503 si el scraper no cargó.
- Railway: `NIXPACKS_NODE_VERSION=20` confirmado activo → Node 20 en builds → emails de verificación operativos.

---

## 3. Backlog priorizado

Cada tier ordenado por ROI / esfuerzo dentro del tier. Detalle del por qué de la prioridad en cada item.

### Tier S — Alta señal, bajo esfuerzo

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| S1 | **Equity curve + Sharpe + drawdown dashboard** | ~2 semanas | ✅ Cerrado — **Sprint 6a** (2026-05-15). `EquityDashboard.jsx` + `GET /api/bankroll/equity-stats` (auth.js:851) + `userEquityCompare.js`. Bottom nav: tab "bankroll" cubre equity; enlace directo pendiente en mobile. |
| S2 | **Versionado de prompts** (`prompt_hash` + `prompt_version` en pick_features) | 1 día | ✅ **Cerrado (2026-05-29 audit)** — campo `prompt_version VARCHAR(32)` ya existe en `pick_features` (migrate.js). Llenar el hash desde oracle.js sería mejora opcional, no bloqueante. |
| S3 | **Audit del feature store** (`npm run audit` reporta huecos) | 1 día | ✅ Check 5 en `system-audit.js`: cobertura (resolved vs con features), market_type gaps, stale rows 60d, sport breakdown. |
| S4 | **Telegram channel publisher** | 3 días | ✅ `telegramPublisher.js` (Bot API, threads encadenados). `contentQueueService` enruta por `publish_target`. Job Telegram independiente en `index.js`. Env: `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`. |
| S5 | **Newsletter weekly recap via Resend** | 3 días | ✅ `newsletter_subscribers` table + `newsletterService.js` (subscribe/unsubscribe/send). Endpoints: `POST /api/newsletter/subscribe`, `GET /api/newsletter/unsubscribe`, `GET /api/admin/newsletter/subscribers`, `POST /api/admin/newsletter/send-weekly`. Job semanal domingos 09:00 ET. Env: `NEWSLETTER_ENABLED`. |
| S6 | **Postmortem dashboard cuantitativo** | 2 días | ✅ Agregaciones de signals/misses/hits/factors desde `picks.postmortem` JSONB. Endpoint `GET /api/admin/postmortem-stats` + página `/admin/postmortem` + sidebar link. |
| S7 | **Persistencia de modelos ML (Railway Volumes)** | ~1-2 semanas | ✅ Cerrado — **Sprint 6b** (2026-05-15). Runbook post-deploy en [admin-and-ops.md](admin-and-ops.md#11-ml-sidecar--persistencia-de-modelos-sprint-6b). |
| S8 | **NBA sport isolation hotfix** | ~1-2 semanas | ✅ Promovido y cerrado en **Sprint 7.0**. |

### Tier A — Alta señal, esfuerzo medio

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| A1 | **F5 (First 5 innings) market** | ~1 semana | ✅ Parser reconoce `F5` en texto (f5_moneyline, f5_over, f5_under). Resolver calcula scores inning 1-5 con `computeF5Scores(innings)`. UI: opciones `⚾ F5 Moneyline` y `⚾ F5 Over/Under` en BetTypeSelect. |
| A2 | **FanGraphs ZiPS scraper** (Python en sidecar ML) | ~1 semana | ✅ `ml/hexa_ml/fangraphs_scraper.py` (httpx + BeautifulSoup, 4 endpoints: zips/dc × bat/pit, 6h cache). Integrado en `serve.py`: `POST /fangraphs/refresh`, `GET /fangraphs/pitcher/{name}`, `GET /fangraphs/batter/{name}`. |
| A3 | **pgvector + embeddings de oracle_report** | ~1.5 semanas | ✅ `oracleEmbeddingsService.js` (OpenAI text-embedding-3-small, `OPENAI_EMBED_API_KEY`); tabla `pick_embeddings (vector(1536))`; background job 15min; `buildSimilarAnalysesBlock` inyectado en `context-builder.js`; admin endpoints `GET /api/admin/embeddings/stats` + `POST /api/admin/embeddings/backfill`. Degrada gracefully si pgvector no disponible. |
| A4 | **Player Props dedicated UI** | ~1 semana | ✅ `PlayerPropsPage.jsx` — player name search filter, Savant stats toggle (xBA/xSLG/wOBA 7d columns), ML model% coloreado. |
| A5 | **Rate limit per-user con tiers** | 3 días | ✅ `peekJwtPayload` (jwt.decode sin verificar, solo bucketing). Tiers: admin=1000/min, paid=20/min, free=8/min, anon=4/min. `keyGenerator` usa `user:${id}` o `ip:${req.ip}`. |
| A6 | **Migrar a node-pg-migrate o Drizzle** | ~1 semana | ✅ `node-pg-migrate` instalado; `database/migrations/` directorio con `001_baseline.sql` + `002_job_queue.sql`. Scripts: `npm run migrate:up/down/create`. `database/database.json` con `DATABASE_URL`. Migrations históricas siguen en `server/migrate.js` (idempotentes, backward compat); nuevas migrations van a `database/migrations/`. |
| A7 | **Backtest con CSV upload** | ~1 semana | ✅ `backtestCsvImporter.js`: parseo CSV (sin deps externas), resolución por `resolvePickFromFinalState`, persiste en `csv_backtest_runs`. Endpoints: `POST /api/admin/backtest/import-csv` + `GET /api/admin/backtest/csv-runs`. dryRun mode para preview. |
| A8 | **Beat reporters scraper + injury classifier** (Haiku) | ~1 semana | ✅ `beatReporterService.js`: 11 beat reporters curados, `classifyInjurySignal` con Haiku, `runBeatReporterScan` persiste en `beat_injury_signals`. Job horario con `BEAT_REPORTER_ENABLED=1`. Requiere `X_BEARER_TOKEN` para X API v2 search. Endpoints: `GET /api/admin/injury-signals`, `POST /api/admin/injury-signals/scan`. |
| A9 | **Parlay Synergy feature flag → public beta** | 3 días | ✅ Abierto a usuarios con email verificado. Endpoint cambiado de `isAdmin` → `requireVerifiedEmail`. `adminOnlyTabs` ya no incluye `'parlay'`. Sidebar parlay visible para todos. Falta: flip `PARLAY_SYNERGY_ENABLED=true` en Railway cuando hit rate sea validado. |

### Tier B — Alta señal pero esfuerzo alto o dependencia externa

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| B1 | **Expansión NBA** | 10-14 semanas | ⬆️ Promovido a **Sprint 7** (a-e). Ver [sección 2](#-sprint-7--expansión-nba-scaffolding--mvp-q4-2026--q1-2027-10-14-semanas). Pre-requisito MLB ML ya está en producción. |
| B2 | **Hexa Live (in-play WP + momentum alerts)** | 2-3 semanas | ✅ **Frontend cerrado (2026-05-29)**. SSE endpoint `GET /api/games/:gamePk/live/stream`. `LiveTracker.jsx` migrado: descubrimiento de juegos cada 3 min + EventSource individual por gamePk (evento `message` default, cadencia ~15s). `HexaLiveStream.jsx` (roto/huérfano) eliminado. |
| B3 | **Discord bot** | 1-2 semanas | ✅ `discordBot.js` (discord.js v14). Slash commands: `/today` (slate picks), `/pick`, `/futures`, `/injuries`. Auto-post via `publish_target='discord'` en content queue. `startDiscordBot()` on startup cuando `DISCORD_ENABLED=1`. Env: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`. |
| B4 | **Threads (Meta) publisher** | 1-2 semanas | ✅ `threadsPublisher.js` (Graph API v1.0). 2-step create container → publish. `processScheduledThreadsQueue()` en contentQueueService, job cadenciado como X/Telegram. Env: `THREADS_ENABLED`, `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`. |
| B5 | **Feature flags reales** (GrowthBook self-hosted) | 1 semana | ✅ `featureFlagsService.js` — DB-backed flags en tabla `feature_flags` (key, enabled, rollout_pct, metadata). Cache 60s. Rollout % hash-estable por userId. Admin CRUD: `GET/PUT/DELETE /api/admin/feature-flags/:key`. No requiere servicio externo. |
| B6 | **Observability (Sentry + structured logging con pino)** | 1 semana | ✅ `server/logger.js` (pino, pretty en dev / NDJSON en prod). `server/observability.js` (Sentry init + error handler, feature-flagged por `SENTRY_DSN`). Global Express error handler + `sentryErrorHandler()` en index.js. Env: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `LOG_LEVEL`. |
| B7 | **Migración a BullMQ + Redis** | 1 semana | ✅ `jobQueueService.js` — Postgres-backed job queue (no Redis). `job_queue` table: type/payload/status/priority/attempts/scheduled_at/error. `enqueueJob` (dedupe), `dequeueJob` (FOR UPDATE SKIP LOCKED), `markJobDone/Failed`, `purgeOldJobs`. Admin endpoints: `GET /api/admin/jobs`, `POST /api/admin/jobs/purge`. Weekly purge job en index.js. Escala a múltiples workers via SKIP LOCKED. |
| B8 | **Infografías auto-generadas** | 1.5 semanas | ✅ `infographicsService.js`: SVG puro (sin puppeteer). `generatePickCardSvg` (400×220) + `generateSlateSvg` (slate multi-pick). Endpoints: `GET /api/picks/:id/infographic` + `GET /api/mlb/slate-infographic?date=`. Devuelve `image/svg+xml` cacheable. |
| B9 | **Hexa Scout (futures + prospect call-ups)** | 1.5 semanas | ✅ `hexaScoutService.js`: `getMlbFutures` (WS/AL/NL winner desde Odds API outrights), `getMlbTransactions` (call-ups, IL, DFA desde MLB Stats API). Endpoints: `GET /api/mlb/futures`, `GET /api/mlb/transactions`. |
| B10 | **Player Props alternate lines + resolver multi-line** | 1.5 semanas | ✅ **Completo (2026-05-29 audit)**. `GET /api/mlb/props/alt-lines?eventId=&player=`, `AltLinesModal.jsx` (modal por player+propKind con todas las líneas main+alt), montado en `PlayerPropsPage.jsx`. El roadmap lo listaba como "UI pendiente" pero ya estaba cerrado en código. |
| B11 | **CI/CD GitHub Actions completa** | 1 semana | ✅ `.github/workflows/ci.yml`: unit tests (`node --test` todos los `__tests__/*.test.js`) + client build en PRs y push a main. Combina con el existing `mlb-smoke.yml` + `retrain-weekly.yml`. |

### Tier C — Vale la pena pero no ahora

| # | Item | Por qué no ahora |
|---|---|---|
| C1 | **Reinforcement Learning para staking** | Requiere >5k picks resueltos para converger. Hoy 500. Volver a evaluar cuando se acumule. |
| C2 | **Chain-of-Thought validation con 3er modelo** | 3x cost para ganancia marginal sobre el ensemble. Evaluar tras Sprint 4. |
| C3 | **Migración a TypeScript** | El repo está estable. Mover ahora interrumpe velocity sin beneficio inmediato. Revisitar si el equipo crece a >3 devs. |
| C4 | **Expansión Soccer / NHL / Tennis** | Cada deporte requiere context-builder propio. NBA va primero (Sprint 7). Después de NBA, revisitar — NHL tiene timing similar a NBA (oct-jun) y podría ser el siguiente. Soccer es mercado masivo pero fragmentado (50+ ligas, cada una con su data API). |

### Tier D — Rechazado o no recomendado

Ver [sección 4](#4-items-rechazados).

---

## 4. Items rechazados

Items que el análisis externo sugirió o que aparecieron en discusiones, y por qué no entran al backlog:

| Item | Razón |
|---|---|
| **Sportradar / Stats Perform** ($$$) | $50k-$200k/año minimum. No justificable hasta tener clientes enterprise. Usar MLB Stats API + Statcast gratis. |
| **Computer Vision para lineups** | MLB API devuelve lineups confirmados con suficiente latencia. ROI marginal vs complejidad de mantener modelo CV. |
| **NLP de injury reports de medios** | Cubierto por el item A8 (beat reporters scraper con Haiku) — mismo fin, menor esfuerzo. |
| **Migrar todo el Oracle a fine-tuning** | Caro, prematuro. El prompt engineering actual funciona, el modelo entrenado va al lado, no reemplaza al LLM. Fine-tuning solo si los modelos tabulares pierden frente al LLM en un mercado específico. |
| **Datadog / New Relic full-stack monitoring** | Overkill para escala actual. Sentry + Better Stack cubren 90% al 10% del costo. |
| **Servicio multi-tenant para revender HEXA white-label** | Producto-business decision, no técnica. Si entra, agrega complejidad (multi-DB / row-level security) que no justifica el ROI hoy. |

---

## 5. Cómo se prioriza

**Criterios** (de mayor a menor peso):

1. **Desbloqueo**: ¿Habilita otras features importantes? El modelo Python entrenado desbloquea ensemble, calibración, todas las expansiones. → Foco.
2. **Riesgo de regresión**: items con guardrails (feature flags, fallbacks) son preferibles a "rip and replace".
3. **ROI / esfuerzo**: Tier S (alta señal, baja inversión) primero cuando hay tiempo entre sprints grandes.
4. **Dependencias externas**: items que dependen de APIs $$$ o lanzamientos de terceros (Meta Threads) van más bajo en lista.
5. **Estratégico vs táctico**: una mejora UX (equity curve) es táctica; expansión a NBA es estratégica. Mezclar 60/40 estratégico-táctico cada trimestre.

**Cuándo se actualiza el roadmap**:
- Al cierre de cada sprint.
- Cuando entra un cliente / requerimiento que cambia prioridad.
- Cuando se descarta un item (mover a sección 4 con razón).
- Trimestralmente, revisión completa: ¿Tier S sigue siendo S? ¿Algo del backlog C ya tiene contexto para subir?

---

## Resumen visual del próximo año

```
2026 Q2  Sprints 0-5   — Pipeline ML completo             ████████████████████████ ✅
2026 Q3  Sprint 6a     — Equity curve dashboard           ████████████████████████ ✅
2026 Q3  Sprint 6b     — Persistencia ML (Volumes)        ████████████████████████ ✅
2026 Q3  S2            — Prompt versioning (pick_features) ████████████████████████ ✅
2026 Q3  Sprint 7.0    — NBA hardening gate               ████████████████████████ ✅
2026 Q3  Sprint 7.1    — Dataset + shadow aislados        ████████████████████████ ✅
2026 Q3  Sprint 7a     — Scaffolding NBA (datos core)     ████████████████████████ ✅ (nba_games + nba_team_stats + nba_player_stats)
2026 Q3  Sprint 7b     — Oracle NBA + prompts             ████████████████████████ ✅
2026 Q3  Sprint 7c     — NBA pick lifecycle + tracker     ████████████████████████ ✅
2026 Q3  Sprint 7d     — UI NBA + sport shell             ████████████████████████ ✅
2026 Q3  Sprint 8a     — Monte Carlo bankroll sim         ████████████████████████ ✅
2026 Q3  Brand v.2.6   — League × Kinetic skin            ████████████████████████ ✅ (PWA icons ✅; Admin re-skin ✅)
2026 Q3  Sprint 5b     — Pick-aligned shadow + mlOpinion  ████████████████████████ ✅
2026 Q3  Sprint 8b     — Pick Imperdible (lock-of-slate)  ████████████████████████ ✅
2026 Q3  Sprint 8c     — Ensemble multi-mkt + props fix   ████████████████████████ ✅
2026 Q3  Sprint 8d     — Oracle context enrichment MLB    ████████████████████████ ✅
2026 Q3  Sprint 8e     — Bullpen attribution guardrail    ████████████████████████ ✅
2026 Q3  Sprint 8f     — Railway hardening + Node 20      ████████████████████████ ✅
2026 Q3  B2            — Hexa Live SSE (LiveTracker)      ████████████████████████ ✅
2026 Q3  B10           — Alt lines UI (AltLinesModal)     ████████████████████████ ✅
2026 Q3-4 Sprint 5     — Player Props MLB                 ██████████████░░░░░░░░░░ 🔄 (board + resolver; lifecycle ⏳)
2026 Q3-4              — NBA go-live público              ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳ (validación E2E pendiente)
2026 Q3-4              — Tier S: S3/S4/S5/S6             ████████████████████████ ✅
2027 Feb  🎯 MVP NBA público listo para All-Star Break
2027 Q1-2 Sprint 7e    — NBA ML sidecar (condicional)     ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳ (~500 picks NBA resueltos)
```

**Próximo en cola** (actualizado 2026-05-29, post-B2/B10 frontend):
- ✅ Sprint 8f Railway hardening — tres servicios Online, Node 20 activo, emails operativos.
- ✅ A1–A9, B2–B11 completados. Todos los Tier A y Tier B cerrados en código y en frontend.
- ✅ B2 Hexa Live UI — `LiveTracker` SSE per-game (2026-05-29). Lag real ~1-2s vs 30s antes.
- ✅ B10 Alt lines UI — `AltLinesModal` + botón en `PlayerPropsPage` (ya estaba cerrado en código; roadmap sincronizado).
- **Pendiente ops**:
  - Props ML gate: acumular ≥50 props resueltos → retrain `prop` model → `MLB_PROPS_ML_PUBLIC_ENABLED=1`.
  - NBA validación E2E en prod con tráfico real → flip `NBA_ANALYSIS_ENABLED=true`.
  - Parlay beta pública: `PARLAY_SYNERGY_ENABLED=true` cuando hit rate validado.
  - `OPENAI_EMBED_API_KEY` → activa RAG (pgvector embeddings de oracle_report en contexto).
- **Próximo deporte**: NFL (Sprint 9) — spec en [docs/nfl-architecture.md](nfl-architecture.md), roadmap en [docs/nfl-roadmap.md](nfl-roadmap.md). Arranque verano 2026.

Para detalle ejecutable de cada sprint, ver [docs/ml-pipeline.md sección 10](ml-pipeline.md#10-plan-modelo-python-entrenado-propio).
