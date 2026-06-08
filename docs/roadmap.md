# Roadmap — H.E.X.A. v4

Documento vivo. Se actualiza al cierre de cada sprint y cuando entran/salen items del backlog.

**Última actualización**: 2026-06-08 — **Soccer parity Sprint 11.3 (lineups/injuries/suspensiones) implementado**: `soccer-lineups-api.js` — cliente API-Football (api-sports.io) dual-proveedor; resuelve fixture por liga+fecha+nombres → `/fixtures/lineups` (confirmado XI≥11) + `/injuries` (separa lesiones de suspensiones por amarillas/roja, únicas del fútbol). Cableado en `soccer-context-builder.js` (lineupStatus/formation/injuries/suspensions + completeness.lineups + sources + staleFlags); `oracleSoccer` lo renderiza; **activa el gate de lineup del Imperdible 11.7**. No-op sin `API_FOOTBALL_KEY`. +8 tests. — **Sprint 11.7 Imperdible implementado**: lock-of-the-slate soccer (espeja NFL 9.5), desbloqueado porque los modelos soccer ya están vivos (11.2 deployado). `soccerImperdibleSelector.js` (scorer puro convicción + gate + ranking, cap 62%, gate de lineup soft hasta 11.3, +12 tests) + `soccerImperdibleEngine.js` (orquesta context/modelo/shadow/candidatos → árbitro → persiste picks+imperdible_runs, texto resolver-compatible) + `soccerImperdibleArbiter.js` + `soccer-imperdible-prompts.js` (Opus, disqualifiers de fútbol incl. el Draw) + `routes/soccer-imperdible.js` (flag `IMPERDIBLE_SOCCER_ENABLED`). Drive-by: HUD `/admin/ml-control` ahora muestra mercados NFL+Soccer (panel de estado + tarjetas Brier) y `ALLOWED_MARKETS` los acepta para reentrenar. — **Sprint 11.2 + 11.4 + 11.5-fundación + 11.6 + 11.8 (CLV+postmortem) + 11.9-signals**: (11.8 postmortem) pick-postmortem.js SOCCER_SYSTEM_PROMPT 3-vías + ruteo soccer-aware (antes caía al prompt MLB de pitchers); postmortemContext.js branch soccer; +2 tests. (11.9) hexaSoccerSignalsService.js — señales rule-based puras (racha form, divergencia xG vs goles, mismatch de tabla, forma de mercado de-viggada, perfil de liga); expuestas en `meta.signals` de analyze/game; +8 tests; drive-by fix `toNum` (Number(null)===0). — (11.8) closing-line-capture-soccer.js — CLV league-aware (apertura desde `odds_details`, cierre en vivo cerca del kick-off; `extractSoccerPickOdds`/`computeSoccerClv` puros); job cada 2h gated por `SOCCER_ANALYSIS_ENABLED`; +6 tests. — **11.2 + 11.4 + 11.5-fundación + 11.6**: (11.6) Parlay Synergy Soccer — `soccerParlayCandidates.js` (builder puro 1X2/total/btts) + `predictSoccerGameModel` + `POST /api/soccer/parlay` (flag `PARLAY_SYNERGY_SOCCER_ENABLED`) alimentando el motor frozen sport-agnóstico; +7 tests (incl. E2E). — **11.2 + 11.4 + 11.5-fundación**: (11.5) Player props soccer — fundación pura `soccer-props-resolver.js` (`parseSoccerProp` bilingüe + `parseSoccerBoxscorePlayers` ESPN + `resolveSoccerPlayerProp`; kinds tiros/goles/asistencias/pases/entradas/faltas/atajadas/anytime_goal) cableada en `pick-resolver-soccer.js` (rama props → boxscore); pendiente in-season odds/board/modelo/UI. +11 tests Node. — **Sprint 11.2 + 11.4 implementados**: (11.2) ML pre-training histórico — `soccer_history_loader.py` lee football-data.co.uk (resultados + closing odds 1X2, 5 ligas europeas), `build_soccer_training_frame` con features as-of cada partido (cero leakage) + decimal→American; los 3 modelos soccer entrenables sin esperar temporada (flags `SOCCER_PRETRAIN_*`); drive-by fix de dedup en `build_X` (bug latente de `soccer_total`). (11.4) xG cableado — `soccerShadowPersistence` ahora persiste xG/xGA reales de Understat (era null hardcodeado) → el dataset de training lleva xG; `soccerShadowValidator` suma señal `xgAdvantage` con re-weighting sobre señales presentes. Tests: +9 Python (loader) +8 Node (validator). **Plan completo (Sprint 11.2–11.9)**: llevar Soccer de funcionalmente completo a robusto como MLB. Brechas rojas vs release-gate: data depth pregame (4.5), lineups/injuries/suspensiones (2.0), market coverage/props (5.5), calibración ML (3.0). Sub-sprints: **11.2** ML pre-training histórico (football-data.co.uk + Understat, análogo nflverse → modelos vivos sin esperar temporada); **11.3** profundidad de contexto pregame (lineups/injuries/suspensiones vía API-Football, árbitro, congestión de calendario, weather, FBref, xG rolling, motivación); **11.4** xG cableado a features + shadow validator; **11.5** player props (tiros/goles/tarjetas, espeja NFL 9f–9i); **11.6** parlay (motor frozen, correlación Over+BTTS); **11.7** Imperdible Soccer (gate lineup confirmado); **11.8** lifecycle (CLV + postmortem + ensemble); **11.9** smart signals + ascensos/descensos. Ver bloque completo en sección 2. — **Sprint 9.6 NFL off-season precision fixes**: (1) `nfl-advanced-fetcher.js` season fallback — cuando la temporada pedida no tiene PBP nflverse (off-season / pre-Week 2), camina un año atrás a la última temporada completa en vez de dejar EPA/success/PROE en null (`isFallback`/`requestedSeason` en `context_meta` + stale flag `advanced_stats_prior_season`); (2) fix del bug de fatiga en `buildFatigueBlock` (`consecutiveDaysPlayed` marcaba todo partido como fatiga; reemplazado por `shortRestGames` ≤6d en ventana 14d); (3) `nflShadowValidator.js` re-ponderación sobre señales presentes (las ausentes retornan null y redistribuyen su peso en vez de inyectar 0.5 neutro que aplanaba off-season a coin-flip; nuevo `breakdown.signalCoverage`). +7 tests. **Sprint 9.5 NFL ops gaps**: parlay model enrichment (conecta los 3 modelos pre-entrenados al `POST /api/nfl/parlay` vía `predictNflGameModel`, fin del `model:null`; fix `qbStatus.statusKey`), toggle `VITE_NFL_LIVE_TRACKER_ENABLED`, y **Imperdible NFL** (lock-of-the-slate NFL: gate QB confirmado, convicción modelo+mercado+shadow validator, arbiter Opus, flag `IMPERDIBLE_NFL_ENABLED`; `nflImperdible{Selector,Engine,Arbiter}.js` + `routes/nfl-imperdible.js`). +15 tests. Calibración fina de thresholds requiere temporada. **Sprint 9.4** cerró las brechas situacional + trenches + superficie/altitud + coherencia de señales. `nflverse_loader.py` añade `red_zone_td_pct_off/def`, `third_down_conv_off/def`, `sack_rate_off/def` desde play-by-play. `nfl-team-map.js` añade `surface`/`altitude` a los 32 estadios. `nfl-context-builder.js` añade `buildFatigueBlock` (fatiga acumulativa, espejo MLB) + `detectBackupQb`. `nflShadowValidator.js` suma `situationalAdvantage` (14%) + `trenchesAdvantage` (10%). `oracleNfl.js` serializa `EFFICIENCY DELTAS` + backup QB + VENUE block. `oracle-nfl-prompts.js` añade umbrales calibrados para RZ/3rd-down/sack-rate + **Signal Coherence** (8-signal voting, confianza ±1→+6%) + 5 nuevos alert flags. NFL data depth alcanza paridad con MLB (8.5/10 en pregame). **Sprint 9.3** EPA/PROE reales + 3 modelos de juego vivos. Sprints 9a–9j + 9.3 completos. Soccer Sprint 11 completo en prod. Sprint 10 NHL completo.

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

**NFL (✅ Sprint 9 completo — serie 9a–9j + 9.3 + 9.4 + 9.5 + 9.6)**: tercer deporte activo, espejo del patrón NBA. Datos ESPN + The Odds API + nflverse. Spec maestra en [nfl-architecture.md](nfl-architecture.md) y roadmap por sprints en [nfl-roadmap.md](nfl-roadmap.md). **Todo mergeado**: 9a–9e (scaffolding → Oracle → lifecycle → dataset/shadow → live tracker → UI → ML scaffolding), 9.3 (pre-training nflverse, 3 modelos de juego vivos), 9f–9h (player props: fundación+board → modelo `nfl_prop` pooled → enriquecimiento player-level + persistencia live), 9i (pizarra `hexaNflBoardService` + UI props parametrizada por sport), 9j (Parlay Synergy NFL MVP vía motor frozen), **9.4 (precision parity: red zone + 3rd-down + trenches + surface/altitude + signal coherence)**, **9.5 (parlay model enrichment + live tracker flag + Imperdible NFL)**, **9.6 (off-season precision: advanced-stats season fallback + fix bug de fatiga + shadow validator re-ponderado sobre señales presentes)**. **Imperdible NFL** ahora scaffolded (gate QB confirmado, convicción modelo+mercado+shadow, arbiter Opus, flag `IMPERDIBLE_NFL_ENABLED`); calibración fina de thresholds + validación E2E + entrenamiento real requieren temporada (kickoff sept 2026).

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
| C4 | **Expansión deportiva — NHL, Soccer, Tennis, Caballos** | Orden de ataque: **NHL primero** (Sprint 10, ESPN API ya funciona, patrón NFL/NBA directo, llena el hueco ene–mar); **Soccer** segundo (Sprint 11, mercado 3-vías, empezar con una sola liga); **Tennis** tercero (Sprint 12, deporte individual, ATP/WTA, año redondo); **Caballos** cuarto (Sprint 13, modelo de contexto distinto — form/going/jockey/draw, mercado muy eficiente). Promovidos a sprints planificados — ver sección 2. |

---

### 🟢 Sprint 10 — NHL (Hockey sobre hielo)

**Status**: 🟢 backend (10a–10c + shadow/dataset) **+ UI (10d) completos**; NHL es el cuarto deporte **activo**. Flag `NHL_ANALYSIS_ENABLED` (default `true`); selector NHL activo en `client/src/config/sports.js`. ML sidecar (10e) pendiente (diferido como NBA 7e). Archivos backend: `nhl-team-map.js`, `nhl-api.js`, `nhl-context-builder.js`, `nhl-odds.js`, `oracle-nhl-prompts.js`, `oracleNhl.js`, `nhlOutputGuard.js`, `routes/nhl.js`, `pick-resolver-nhl.js`, `nhlShadowValidator.js` + `nhlShadowPersistence.js`, migraciones `runNhlScaffoldingMigrations`/`runNhlDatasetMigrations`. UI: `sports.js`, `sportCapabilities.js`, `SportSwitcher`, `GameSelector` (`normalizeNhlGame`), `AnalysisPanel`, `OracleChat`, `HistoryPanel`, `HexaBoard`/`HexaBoardLeague` (placeholder), `App.jsx` (guards standings/live), `nhlLogoUrl.js`. Decisiones vs el plan original: identidad keyed por **abbr** (ids ESPN numéricos NHL no confiables); **sin weather** (todo indoor); ML sidecar diferido. **Pendiente operacional**: 10e ML, pizarra NHL (`hexaNhlBoardService`), live tracker, validación E2E.

**Por qué NHL primero**: ESPN API ya está integrada (mismo wrapper que NBA y NFL). The Odds API ya tiene `icehockey_nhl`. El patrón de código existe tres veces — es un espejo, no arquitectura nueva. Llena el hueco de invierno que NFL deja (ene–mar).

**Temporada**: octubre–junio. Complementa MLB (abr–oct) sin solapar peak NFL.

**Diferencias estructurales vs NBA/NFL**:
- Mercado primario: **moneyline** (como NBA). Puck line = ±1.5 goles (análogo al runline MLB, no spread).
- **Key numbers**: 0, 1, 2, 3 goles — juego de baja anotación, el total importa mucho.
- **Cap de confianza**: ~70% (mercado algo más eficiente que MLB, menos que NBA).
- **Goalie confirmado** = el gate de disponibilidad (análogo al "starter confirmado" MLB / "QB titular" NFL). Si el goalie de inicio no está confirmado → PASS o confianza degradada.
- **Shootout**: posible resultado después del OT → resolver debe manejar win by SO vs regulation/OT.
- **Power play %** y **penalty kill %**: las métricas equivalentes a ERA/WHIP en pitch. Son el principal predictor de ventaja situacional.
- **Back-to-back y road trip fatigue**: calendario NHL es denso (82 partidos), el fatigue block importa como en NBA.

**Fuentes de datos**:
- ESPN hidden API (juegos, scores, injuries, standings) — mismo endpoint pattern que NFL/NBA.
- NHL Stats API (`api.nhle.com`) — gratuito, sin key. Endpoints: `/schedule`, `/standings`, `/teams/{id}/stats`, `/game/{id}/feed/live`.
- The Odds API `icehockey_nhl` — dual key fallback ya existe en el patrón.
- Hockey Reference (scraping opcional, stats históricos avanzados).

**Archivos a crear (patrón espejo)**:
- `server/nhl-team-map.js` — 32 equipos ESPN id↔abbr↔nombre + conf/división + coords estadio + `arena_type`.
- `server/nhl-api.js` — wrapper ESPN + NHL Stats API. `getNhlGamesForDate`, `getNhlGameSummary`, `getNhlTeamStats`, `getNhlInjuries`.
- `server/nhl-context-builder.js` — `buildNhlGameContext`: records, GF/GA, PP%, PK%, recent form, goalie confirmado, rest/B2B, `context_meta`.
- `server/nhl-odds.js` — The Odds API `icehockey_nhl`, dual key. **Preserva puck line** vía MODA (no promedio). `getNhlGameOdds`, `matchNhlOddsToGame`, `buildMarketOddsForGame`.
- `server/prompts/oracle-nhl-prompts.js` — `NHL_SYSTEM_PROMPT` + `NHL_CHAT_PROMPT`. Cap 70%, key numbers 0/1/2/3, prioridad goalie→PP%→PK%, guardrail anti-hallucination.
- `server/services/oracleNhl.js` — `analyzeNhlGame`, `analyzeNhlChat` (Anthropic propio, sin Grok). No toca `oracle.js`.
- `server/services/nhlOutputGuard.js` — rechaza props/ABSTAIN/parse fallido, confianza 50–70, degrada con `alert_flags`.
- `server/routes/nhl.js` — `POST /api/nhl/analyze/game|chat` (admin-only, flag `NHL_ANALYSIS_ENABLED`).
- `server/pick-resolver-nhl.js` — resuelve `sport='nhl'`, maneja regulation/OT/SO win, puck line, over/under.
- `server/services/nhlShadowValidator.js` + `nhlShadowPersistence.js` — dataset/shadow para NHL.
- `client/src/utils/nhlLogoUrl.js` — `https://cdn.nhl.com/images/upload/team/primary/en/${teamAbbr}`.
- Migraciones en `server/migrate.js`: `runNhlScaffoldingMigrations()`.

**Esfuerzo estimado**: ~2–3 semanas (Sprint 10a scaffolding + 10b Oracle + 10c lifecycle + 10d UI).

**Criterio de éxito**:
- Pick NHL admin-only: creado → tracked en vivo → resuelto → postmortem.
- `sport='nhl'` aislado en historial, dataset, shadow — sin contaminar MLB/NBA/NFL.
- Goalie no confirmado → Oracle emite alerta en `alert_flags`.

---

### ✅ Sprint 11 — Soccer (Fútbol) — Big 5 + MLS

**Status**: ✅ **completo + en prod** (2026-06-02). Rama `claude/soccer-sprint-11c`. `SOCCER_ANALYSIS_ENABLED=true` en Railway; selector Soccer activo en UI con logos ESPN CDN. Board + live tracker + xG + ML sidecar completos. Pendiente: ML training cuando haya ≥25 picks resueltos; xG MLS (Understat no cubre).

**Progreso completo — todos los sub-sprints cerrados**:

**11a — scaffolding de datos** ✅
- ✅ `server/soccer-league-map.js` — registro de las 6 ligas (`slug`, `oddsApiSlug`, `country`, `name`, `season`, `avgGoals`, `drawPct`, `style`). Helpers: `getSoccerLeague`, `isSupportedLeague`, `getSoccerLeagueByOddsSlug`, `SOCCER_LEAGUE_SLUGS`.
- ✅ `server/soccer-team-map.js` — 88 clubes seed across las 6 ligas, keyed por nombre canónico + `short` + `aliases`. Sin ids ESPN numéricos (patrón NHL). `findSoccerTeam(name, league)` con normalización (accent-strip + drop sufijos FC/CF/etc) y fallback graceful al nombre crudo.
- ✅ `server/soccer-api.js` — wrapper ESPN league-aware (`getSoccerGamesForDate(league, date)`, `getSoccerStandings`, `getSoccerGameSummary`, `getSoccerTeams`). Cache 5min + stale fallback. Status `pre/in/post` → `scheduled/live/final`.
- ✅ `server/soccer-odds.js` — The Odds API multi-liga, dual key. **Mercado 3-vías 1X2** (`threeWay: {home, draw, away}` — Draw es outcome real, nunca push) + totals (MODA) + **BTTS**. `getSoccerGameOdds`, `matchSoccerOddsToGame`, `buildMarketOddsForGame`.
- ✅ `server/soccer-context-builder.js` — `buildSoccerGameContext`: form, goals for/against, goal diff, points, league profile (avgGoals, drawPct, style), market odds wiring, `context_meta` (completeness, sources, staleFlags).
- ✅ Migraciones: `runSoccerScaffoldingMigrations()` + `runSoccerDatasetMigrations()` en `server/migrate.js`. Columna `league VARCHAR(32)` en `picks` y `pick_features`. Columnas soccer en `pick_features`: `home_goals_for`, `home_goals_against`, `home_goal_diff`, `home_points`, `home_xg` (null hasta FBref), `draw_price`, `btts_yes_price`.
- ✅ Endpoints: `GET /api/soccer/games`, `GET /api/soccer/teams`, `GET /api/soccer/standings` en `server/index.js`.

**11b — Oracle Soccer** ✅
- ✅ `server/prompts/oracle-soccer-prompts.js` — `SOCCER_SYSTEM_PROMPT` + `SOCCER_CHAT_PROMPT`. Cap 62%, mercado 3-vías explícito (Home/Draw/Away o PASS), prioridad form→goal diff→odds→perfil-liga, guardrail anti-hallucination.
- ✅ `server/services/oracleSoccer.js` — `analyzeSoccerGame`, `analyzeSoccerChat`, `serializeSoccerContext`. Anthropic propio, sin Grok. **No toca oracle.js.**
- ✅ `server/services/soccerOutputGuard.js` — valida `pick_side` exactamente `home|draw|away`, confianza 50–62, liga válida, rechaza props/ABSTAIN/parlay.

**11c — Lifecycle** ✅
- ✅ `server/routes/soccer.js` — `POST /api/soccer/analyze/game|chat` (admin-only, flag `SOCCER_ANALYSIS_ENABLED`). Valida `leagueSlug` contra `soccer-league-map.js`. Persiste `sport='soccer'`, `league=leagueSlug`. Resuelve odds server-side.
- ✅ `server/pick-resolver-soccer.js` — resuelve `sport='soccer'` por score final: home_goals vs away_goals → 1X2 + over/under + BTTS. Sin push (90 min → siempre hay resultado). Job diario en `server/index.js`, ventana 19:00–05:59 ET, gated por `SOCCER_ANALYSIS_ENABLED`.

**11d — UI** ✅
- ✅ `client/src/utils/soccerLogoUrl.js` — `getSoccerLogoUrl(teamId, abbr, size)` desde ESPN CDN.
- ✅ `client/src/config/sports.js` — `ACTIVE_SPORTS` incluye `'soccer'`; `SPORT_META.soccer = { shortLabel: 'SOC', displayName: 'Soccer', active: true }`.
- ✅ `client/src/config/sportCapabilities.js` — soccer: gameAnalysis+requiresAdmin ✅, oracleChat+requiresAdmin ✅, todo lo demás disabled con mensajes "fase posterior".
- ✅ `client/src/components/SportSwitcher.jsx` — livery soccer grass-green (`var(--brand-grass, #388e3c)`); `clipFor()` helper para 5-button adaptive layout.
- ✅ `client/src/components/GameSelector.jsx` — `normalizeSoccerGame(g, leagueSlug)`; `selectedLeague` state; league dropdown (6 ligas); fetch `/api/soccer/games?league=&date=`; logos por `getSoccerLogoUrl`; pitchers ocultos.
- ✅ `client/src/components/AnalysisPanel.jsx` — soccer endpoint `/api/soccer/analyze/game`; SAFE bloqueado; reset useEffect incluye soccer.
- ✅ `client/src/components/HexaBoard.jsx` + `HexaBoardLeague.jsx` — usan `/api/soccer/board` cuando `sport='soccer'`; eliminado early-return placeholder.
- ✅ `client/src/components/OracleChat.jsx` — `isSoccer`; `soccerLeague` state; fetch games + chat `/api/soccer/analyze/chat`; league dropdown en partido picker.

**11.1 — Shadow/Dataset isolation** ✅
- ✅ `server/services/soccerShadowValidator.js` — validador determinístico 3-vías. De-vig de odds 1X2 (home+draw+away normalizado). Pesos: `W_WITH_ODDS={strength:0.25, form:0.20, odds:0.55}`, `W_WITHOUT_ODDS={strength:0.50, form:0.50}`. Confianza capped 50–62%. `agree=null` para picks Draw.
- ✅ `server/services/soccerShadowPersistence.js` — `saveSoccerPickFeatures` + `recordSoccerShadowRun`. Fire-and-forget. `sport='soccer'`, `league=leagueSlug`. `draw_price`, `btts_yes_price`, `home/away_goals_for/against/goal_diff/points`, `xg` desde Understat.
- ✅ `server/routes/soccer.js` — wired en `/analyze/game`: extrae `gameMeta` del juego ESPN, llama ambas funciones con `.catch()` tras `persistSoccerPick`.

**Post-11d — Board + Live Tracker + xG + ML sidecar** ✅
- ✅ `server/services/hexaSoccerBoardService.js` — pizarra diaria soccer: itera las 6 ligas en paralelo; insights de juegos live+upcoming + top-2 standings por liga; cache hasta 04:00 ET.
- ✅ `server/pick-tracker-soccer.js` — `buildSoccerPickLiveProgressEntry`: lookup league-aware (`leagueSlug:date`); `findSoccerGameForPick`; `formatSoccerDetails` (score + período).
- ✅ `server/services/soccerMlClient.js` — circuit breaker propio (3f→open 2min); `buildSoccerFeaturePayload` (17 features); `predictSoccerMoneyline|Total|Btts`.
- ✅ `server/soccer-xg-fetcher.js` — scraper Understat; regex extrae `teamsData` JSON del HTML; Big 5 leagues soportadas, MLS=null; cache 6h; `getSoccerTeamXg` + `getSoccerGameXg`.
- ✅ `server/soccer-context-builder.js` — integra xG via Promise.all; enriquece `home.xG/xGA`, `away.xG/xGA`; actualiza `context_meta.completeness.xG` y `staleFlags`.
- ✅ `ml/hexa_ml/models/soccer.py` — `SoccerMoneylineModel`, `SoccerTotalModel`, `SoccerBttsModel` (reg_lambda=3.0).
- ✅ `ml/hexa_ml/features.py` — `SOCCER_BASE_NUMERIC` (17 cols) + `SOCCER_DERIVED_FEATURES` (7) + `add_soccer_derived()` con de-vig 3-way odds.
- ✅ `ml/hexa_ml/data.py` — soccer columns en OPTIONAL_FEATURE_COLUMNS; `filter_for_market` para soccer markets; `make_target` soccer (btts/total/moneyline).
- ✅ `ml/hexa_ml/train.py` — `SOCCER_MARKETS` + `load_dataset(sport="soccer")` isolado de MLB/NFL.
- ✅ `ml/hexa_ml/serve.py` — FeaturePayload con 18 campos soccer; 3 predict routes; retrain incluye soccer markets.
- ✅ `client/src/components/SoccerLiveTracker.jsx` — 6 ligas en paralelo (Promise.allSettled), 60s poll, grass-green livery, `SoccerPickProgressPanel`.
- ✅ `client/src/config/sportCapabilities.js` — liveTracker + board habilitados para soccer.
- ✅ `server/routes/soccer.js` — `GET /api/soccer/board` → `buildHexaSoccerBoard`.
- ✅ `server/index.js` — import `buildSoccerPickLiveProgressEntry`; SQL filter `IN ('mlb','nba','nfl','soccer')`; rama soccer en live-progress loop.
- ✅ `client/src/App.jsx` — `SoccerLiveTracker` importado y enrutado en Live tab.

**Alcance**: las **6 ligas principales** desde el día 1. La arquitectura es league-aware desde la base — un solo `soccer-api.js` con `leagueSlug` como parámetro, no 6 wrappers separados.

| Liga | País | ESPN slug | Odds API slug | Temporada |
|------|------|-----------|---------------|-----------|
| **Premier League** | Inglaterra | `eng.1` | `soccer_epl` | ago–may |
| **La Liga** | España | `esp.1` | `soccer_spain_la_liga` | ago–may |
| **Serie A** | Italia | `ita.1` | `soccer_italy_serie_a` | ago–may |
| **Bundesliga** | Alemania | `ger.1` | `soccer_germany_bundesliga` | ago–may |
| **Ligue 1** | Francia | `fra.1` | `soccer_france_ligue_1` | ago–may |
| **MLS** | USA/CAN | `usa.1` | `soccer_usa_mls` | mar–nov |

**Por qué las 6 juntas y no una por vez**: ESPN API y The Odds API usan el mismo endpoint shape para todas — solo cambia el slug. `soccer-team-map.js` se construye una vez con todos los equipos. El Oracle prompt es el mismo para todas las ligas (1X2 + xG + form), solo varía el bloque de contexto de liga. Construir la arquitectura multi-liga desde el inicio cuesta ~10% más que una sola liga y evita reescribir después.

**Diferencias estructurales críticas vs otros deportes**:
- **Mercado de 3 vías**: Home / Draw / Away (1X2). El Draw es resultado válido con probabilidad real (~25–30%). El Oracle y el resolver lo tratan explícitamente — no hay push accidental, hay tres outcomes.
- **Baja anotación**: 0–0 es posible. Key numbers: 0, 1, 2, 3 goles. Over/Under más común en 2.5.
- **BTTS** (Both Teams to Score): mercado popular, binario, no requiere predecir ganador.
- **Mercado muy eficiente**: casas tienen bots dedicados. Cap de confianza Oracle: **~62%** (el más bajo de todos los deportes — honestidad con el usuario es crítica).
- **Sin "starter confirmado"**: alineaciones ~1h antes del kick-off (team sheet oficial). Oracle advierte si analiza sin lineup confirmado.
- **xG (Expected Goals)**: el Statcast del fútbol. Predice con más precisión que goles reales.
- **Estilos de liga diferentes**: la Bundesliga es la liga más alta en anotación (Over es más viable), la Serie A históricamente baja en goles (Under + Draw frecuente), la Premier League es la más equilibrada. El Oracle prompt incluye un bloque de perfil de liga.

**Perfiles de liga para el Oracle**:
| Liga | Goles/partido promedio | Draw% | Estilo |
|------|----------------------|-------|--------|
| Bundesliga | ~3.1 | ~23% | Alta anotación, presión alta |
| Premier League | ~2.8 | ~25% | Físico, equilibrado |
| La Liga | ~2.6 | ~26% | Técnico, posesión |
| Ligue 1 | ~2.5 | ~27% | Variable, PSG-dominado |
| Serie A | ~2.4 | ~29% | Defensivo, estructura |
| MLS | ~2.9 | ~22% | Atlético, menos táctico |

**Fuentes de datos**:
- ESPN hidden API (`site.api.espn.com/apis/site/v2/sports/soccer/{leagueSlug}/`) — juegos, scores, standings, injuries, lineups parciales. Misma estructura para las 6 ligas.
- The Odds API — slug por liga (tabla arriba), dual key fallback.
- **FBref** (scraping, cache 6h) — xG, xGA, progressive passes, PPDA por equipo y partido. Soporta las 5 ligas europeas y MLS.
- **Understat** (scraping alternativo, solo Big 5) — xG por partido histórico, más fácil de parsear que FBref.
- **API-Football** (freemium, 100 calls/día gratis) — alineaciones confirmadas ~60 min pre-kick para las 6 ligas.

**Pendiente operacional** (no código — solo datos):
- Entrenamiento ML: soccer_moneyline/total/btts entrenan automáticamente vía `/retrain` cuando haya picks resueltos en prod. Usar `/admin/ml-control` cuando haya ≥25 picks resueltos por mercado. **Mejor**: ver Sprint 11.2 (pre-training histórico football-data.co.uk) para tener modelos vivos sin esperar la temporada.
- xG MLS: Understat no cubre la MLS — `getSoccerGameXg` devuelve null para `usa.1`. Considerar API-Football como fuente alternativa en una fase posterior (Sprint 11.9).
- Pick Imperdible Soccer — diferido; requiere `auto_resolvable` check + resolver integrado (Sprint 11.7).

**Parity con MLB (planificado, Sprint 11.2–11.9)**: Soccer pasó el MVP pero le faltan los pilares de profundidad de MLB (context enrichment 8d, props, ensemble, pretraining). Ver bloque **🔵 Sprint 11.2–11.9** más abajo — brechas rojas: data depth pregame, lineups/injuries/suspensiones, player props, calibración ML.

**Feature flag**: `SOCCER_ANALYSIS_ENABLED` global. Opcional: `SOCCER_LEAGUES_ENABLED=epl,laliga,seriea,bundesliga,ligue1,mls` — lista las ligas activas (default todas).

**Esfuerzo estimado**: ~4–5 semanas. El mercado 3-vías más el soporte multi-liga añaden complejidad real, pero construir las 6 ligas a la vez es ~20% más trabajo que solo una — vale la pena.

**Criterio de éxito**:
- Oracle puede analizar un partido de cualquiera de las 6 ligas y emite Home/Draw/Away con confianza calibrada.
- El contexto para un partido del Bundesliga menciona explícitamente el perfil de alta anotación; para Serie A, el perfil defensivo.
- Resolver maneja 1X2 + BTTS + over/under para las 6 ligas desde score final ESPN.
- `sport='soccer'`, `league='eng.1'` (etc.) aislados en historial, dataset y shadow sin contaminar otros deportes.

---

### 🔵 Sprint 11.2–11.9 — Soccer parity con MLB (planificado)

**Objetivo**: llevar Soccer de **funcionalmente completo** a **robusto como MLB**. Soccer pasó el MVP (Oracle 3-vías, lifecycle, UI, board, live tracker, xG, sidecar scaffolded) pero le faltan los pilares de profundidad que hicieron robusto a MLB (Sprint 8d context enrichment + props + ensemble + pretraining). Cero ediciones a frozen; mismo patrón espejo de NFL 9.x.

**Scorecard vs release-gate** (brechas rojas que estos sub-sprints cierran):

| Criterio | MLB | Soccer hoy | Gate | Sub-sprint |
|---|---:|---:|---:|---|
| Data depth pregame | 9.5 | 8.0 🟢 | 8.0 | 11.3 ✅ (núcleo; falta FBref/xG-rolling) |
| Lineup/Injury/Suspensión | 9.0 | 8.5 🟢 | 8.0 | 11.3 ✅ (API-Football) |
| Market coverage real | 9.0 | 5.5 🔴 | 8.0 | 11.4 + 11.5 |
| Calibration/ROI | 8.5 | 3.0 🔴 | 8.0 | 11.2 |

**Orden de ataque** (11.2 + 11.3 + 11.4 mueven la aguja y son off-season-friendly):

#### Sprint 11.2 — ML pre-training histórico (el "nflverse del fútbol") — ✅ implementado en código (2026-06-07)
Mayor lift de robustez, sin esperar temporada. Soccer tenía **0 modelos vivos** (esperaba ≥25 picks resueltos). NFL resolvió esto exacto leyendo nflverse; ahora soccer hace lo mismo con football-data.co.uk.
- ✅ [ml/hexa_ml/soccer_history_loader.py](../ml/hexa_ml/soccer_history_loader.py) — análogo de `nflverse_loader.py`. **football-data.co.uk** (CSVs gratis sin key, 20+ años de resultados + closing odds 1X2). `build_soccer_training_frame(market, years)` itera las 5 ligas europeas (E0/SP1/I1/D1/F1; MLS no está en la fuente), computa features **as-of cada partido** (acumulados temporada-a-fecha *antes* del kick-off — misma semántica que el standings ESPN en vivo, cero leakage), convierte odds decimal→American para alinear con `soccer-odds.js`. xG queda NaN (football-data no lo trae; Understat histórico = follow-up). Sin deps nuevas (CSV vía pandas+urllib).
- ✅ Flags `SOCCER_PRETRAIN_ENABLED` (default true) + `SOCCER_PRETRAIN_SEASONS` en [config.py](../ml/hexa_ml/config.py) + `.env.example`.
- ✅ [train.py](../ml/hexa_ml/train.py) — `train_all` concatena picks live (vacíos en off-season) con la historia football-data por mercado → los 3 modelos soccer **se entrenan ya**. Reusa `filter_for_market`/`make_target`/`build_X` sin cambios.
- ✅ **Drive-by fixes**: (1) `build_X` ahora dedupe columnas (bug latente: `soccer_total` re-listaba `odds_ou_total`, que rompía la coerción numérica — nunca se había disparado porque soccer_total jamás se entrenó); (2) `nflverse_loader.py` nombres distintos off/def en las Series vacías de RZ/3rd-down/sack (bug pre-existente que rompía un test con frames sintéticos).
- ✅ Tests: [test_soccer_history_loader.py](../ml/tests/test_soccer_history_loader.py) (9: parse_seasons, season_code, decimal→American, leakage-free primera jornada, acumulados as-of, market_type, unsupported, empty-when-no-CSV). Validado E2E: los 3 mercados entrenan+predicen sobre frame sintético. Suite ML completa verde (72).
- **Pendiente operacional**: deploy del sidecar + `POST /retrain {"market":"all"}` → verificar `soccer_*` cargados en `/health`. **Understat histórico** (xG por partido Big 5) como follow-up para enriquecer el frame.

#### Sprint 11.3 — Profundidad de contexto pregame (el "Statcast del fútbol") — 🟢 lineups + weather + H2H/árbitro + congestión + splits implementados (2026-06-08)
La brecha #1. El context-builder solo derivaba de standings + form-string `WDLWW`. Enriquecido al nivel del Sprint 8d MLB:
- ✅ **Lineups + injuries + suspensiones** vía **API-Football** (api-sports.io, freemium 100/día). [soccer-lineups-api.js](../server/soccer-lineups-api.js) — cliente dual-proveedor (directo `x-apisports-key` o RapidAPI), resuelve fixture por liga+fecha+nombres, fetchea `/fixtures/lineups` (confirmado con XI≥11) + `/injuries` (separa lesiones de **suspensiones** por amarillas/roja — únicas del fútbol e invisibles a ESPN). No-op sin `API_FOOTBALL_KEY`. Cableado en `soccer-context-builder.js`: `lineupStatus`/`formation`/`injuries`/`suspensions` por equipo + `completeness.lineups` (0.15) + `sources.availability` + staleFlags. **Activa el gate de lineup del Imperdible Soccer (11.7)**. Tests: `soccerLineups.test.js`.
- ✅ **Weather** — [soccer-weather-api.js](../server/soccer-weather-api.js), Open-Meteo (sin key, análogo MLB/NFL). Mapa de coords de estadio por nombre canónico (clubes seed de las 6 ligas), unidades métricas (°C/km/h). `getSoccerStadium` (resuelve vía `findSoccerTeam`; flag `roof` para Bernabéu/Pierre-Mauroy/Mercedes-Benz → weather-neutral), `soccerWeatherFlags` (viento >45km/h disrupta pases/centros/balón parado; calor >30°C; helada <0°C; lluvia >60% → sesgo UNDER suave), `getSoccerWeather` (never-throws, null si venue no mapeado). Cableado en el context builder (Promise.all, param `gameTime` → hora de kickoff): `weather` block + `completeness.weather` (0.05, rebalancea `teamStats` 0.35→0.30) + `sources.weather` + staleFlag `weather_unavailable`. Prompt: modificador secundario de Total/BTTS (nunca 1X2, ≤0.2 goles). Tests: `soccerWeather.test.js` (9).
- ✅ **H2H + árbitro** — `getSoccerMatchAvailability` reusa el fixture ya resuelto para el **árbitro** (gratis, `fixture.fixture.referee`) y fetchea el **head-to-head** (`/fixtures/headtohead`, +1 call). `normalizeH2H` agrega las últimas reuniones desde la perspectiva del local/visitante del próximo partido (orienta por nombre de club): record, `avgTotalGoals`, `bttsPct`, últimas 5. Context builder expone `referee` + `h2h` + `sources.referee`/`sources.h2h` + staleFlags. Prompt: H2H como prior secundario de Total/BTTS/empate (#9, nunca sobre la forma de temporada); árbitro solo contexto (#10, prohíbe asumir sesgo sin data). Tests: `soccerLineups.test.js` (+2 `normalizeH2H`).
- ✅ **Congestión de calendario / rotación** — `getSoccerMatchAvailability` fetchea las últimas 6 fixtures de cada equipo (`/fixtures?team&last=6`, +2 calls) → `normalizeCongestion`: `matchesLast14d`, `daysSinceLast`, `otherCompMatches` (copa/UCL = competición ≠ liga doméstica), `lastCompetition`, `shortRest` (≤3d), `midweekCongestion`. `home.congestion`/`away.congestion` + `sources.congestion` + staleFlag. `oracleSoccer` añade línea `Schedule:` con tags SHORT REST / MIDWEEK CONGESTION. Prompt: señal #6b (favorecer al equipo más fresco, Under suave para ataque fatigado; nunca sobre la fuerza). Tests: `soccerLineups.test.js` (+3 `normalizeCongestion`).
- ✅ **Splits local/visitante** — `/teams/statistics?league&season&team` por equipo (+2 calls) → `normalizeTeamSplits`: por condición (`home`/`away`) record W-D-L (`loses`→`losses`), GF/GA promedio, clean sheets, failed-to-score. `home.venueSplits`/`away.venueSplits` + `sources.venueSplits` + staleFlag. `oracleSoccer` renderiza el split RELEVANTE por equipo (local del host, visitante del visitante). Prompt: señal #3b de **primer orden** para el 1X2 (fortaleza-en-casa vs mal-viajero = uno de los edges 1X2 más fiables; récord por condición sobre la tabla general cuando divergen). Tests: `soccerLineups.test.js` (+2 `normalizeTeamSplits`).
- **Pendiente del resto de 11.3** ↓:
- **Árbitro con tendencias** — tarjetas/penaltis por réferi (el nombre ya fluye; faltan stats agregados por árbitro como fuente). Análogo a `getUmpireStats`.
- **Métricas FBref** (PPDA, pases progresivos, xG de balón parado, calidad de tiro) + **xG rolling** (ventanas 7d/14d, como rolling wOBA MLB).
- **Motivación/stakes** — descenso, título, plazas europeas, dead rubber, prioridad de copa.
- **Criterio de éxito**: ✅ contexto soccer con bloques LINEUP/INJURIES, VENUE/WEATHER, HEAD-TO-HEAD + REFEREE, SCHEDULE/CONGESTION y HOME/AWAY SPLIT; `context_meta.completeness` rebalanceada; data depth ≥8.0 (núcleo cubierto, queda profundidad estadística avanzada FBref/xG-rolling).

#### Sprint 11.4 — xG cableado a features + shadow validator — ✅ implementado en código (2026-06-07)
Hasta ahora xG **solo se mostraba en el contexto**: `soccerShadowPersistence.saveSoccerPickFeatures` hardcodeaba `home_xg/away_xg = null` (aunque el context builder ya enriquece `home.xG/xGA` desde Understat), así que el dataset de training no tenía xG; y el `soccerShadowValidator` no lo usaba.
- ✅ [soccerShadowPersistence.js](../server/services/soccerShadowPersistence.js) — persiste `home.xG/away.xG/home.xGA/away.xGA` reales (no null) en `pick_features` → el dataset del modelo live ahora lleva xG (Big 5; null para MLS). El payload ML (`soccerMlClient.buildSoccerFeaturePayload`) **ya** enviaba xG — el bug estaba solo en la persistencia.
- ✅ [soccerShadowValidator.js](../server/services/soccerShadowValidator.js) — nueva señal `xgAdvantage` (net xG = xG−xGA, home vs away, scale 12). Pesos rebalanceados: `W_WITH_ODDS={strength:0.20, form:0.15, xg:0.10, odds:0.55}`, `W_WITHOUT_ODDS={strength:0.35, form:0.30, xg:0.35}`. Re-weighting estilo NFL 9.6: señales ausentes (xG en MLS, o strength/form sin datos) retornan `null` y su peso se redistribuye sobre las presentes; nuevo `breakdown.signalCoverage`.
- ✅ Tests: [soccerShadowValidator.test.js](../server/services/__tests__/soccerShadowValidator.test.js) (8 casos). `node --check` OK.
- **Pendiente**: Understat histórico para cablear xG también al frame de pre-training (11.2 lo deja NaN); FBref (xG de balón parado, PPDA) llega en 11.3.

#### Sprint 11.5 — Player Props Soccer (espeja NFL 9f–9i) — 🟡 fundación implementada (2026-06-07)
Cero props hasta ahora. Mercados: tiros a puerta, tiros, goles de jugador, asistencias, pases, entradas, faltas, atajadas, **anytime goalscorer** (yes-market).
- ✅ **Fundación (parser + resolver, lógica pura)**: [soccer-props-resolver.js](../server/soccer-props-resolver.js) — `parseSoccerProp` (bilingüe en/es, tolera ambos órdenes player↔kind y el yes-market line-less de anytime goal), `parseSoccerBoxscorePlayers` (lee `boxscore.players[].statistics[]` de ESPN `/summary` por `keys`/`names`/`labels` defensivo), `getSoccerGameBoxscore(leagueSlug, eventId)`, `resolveSoccerPlayerProp` + `resolveSoccerPropFromActual` (puro). Kinds: `shots_on_target`/`shots`/`goals`/`assists`/`passes`/`tackles`/`fouls`/`saves`/`anytime_goal`.
- ✅ Cableado en [pick-resolver-soccer.js](../server/pick-resolver-soccer.js): si `parseSoccerProp(pick)` matchea, resuelve contra el boxscore ESPN en vez del score final (espejo de la rama NFL). Corre siempre dentro del resolver soccer.
- ✅ Tests: [soccerProps.test.js](../server/__tests__/soccerProps.test.js) (11: parser ambos órdenes/anytime/bilingüe/rechazo de picks 1X2-total-BTTS, boxscore + derivación anytime_goal, resolución win/loss/push, player/stat not found).
- **Pendiente (in-season)**: `soccer-props-odds.js` (endpoint event-específico Odds API), `soccerPropFeatureEnricher.js` (de-vig), `GET /api/soccer/props/board`, modelo `soccer_prop` pooled pick-aligned, UI parametrizada (patrón `PlayerPropsPage`). Flag `SOCCER_PROPS_ENABLED`. **Nota**: la forma exacta del boxscore ESPN soccer se valida contra datos reales en temporada (el parser es defensivo por keys/labels).

#### Sprint 11.6 — Parlay Synergy Soccer (espeja NFL 9j) — ✅ implementado en código (2026-06-07)
- ✅ [soccerParlayCandidates.js](../server/services/parlayEngine/soccerParlayCandidates.js) — builder puro: `buildSoccerGameCandidates`/`buildSoccerParlayCandidates`. Mercados: **moneyline 1X2** (de-vig de los 3 outcomes → emite la pata del resultado más probable; el modelo `soccer_moneyline` (P home win) sobrescribe la pata home y rescala draw/away), **total** (over/under 2.5) y **btts** (yes/no). NO toca frozen.
- ✅ [soccerMlClient.js](../server/services/soccerMlClient.js) — `predictSoccerGameModel(context, gameMeta, marketOdds)` predice los 3 mercados en paralelo desde el sidecar pre-entrenado (11.2); null por mercado cae al de-vig.
- ✅ `POST /api/soccer/parlay` en [routes/soccer.js](../server/routes/soccer.js) (admin, flag `PARLAY_SYNERGY_SOCCER_ENABLED`): arma candidatos del slate de una liga + alimenta el motor **frozen sport-agnóstico** (`buildCorrelationMatrix` → `composeParlays` → `computeHitDistribution`). `modelEnriched` en la respuesta.
- ✅ Tests: [soccerParlayCandidates.test.js](../server/services/parlayEngine/__tests__/soccerParlayCandidates.test.js) (7: shape del builder, 1X2 argmax, override del modelo, de-vig fallback, under-cuando-over-dog, sin-odds, integración E2E con el motor). Los 127 del motor intactos.
- **Nota / pendiente**: la correlación same-game **Over 2.5 + BTTS** NO está modelada — `correl.js` (frozen) devuelve 0 para ese par (sus reglas son MLB-centric). Refinarla requiere tocar frozen (diferido); el MVP compone igual que el parlay NFL (también genérico same-game). `mode=safe` (siembra por probabilidad, ignora edge) es el útil hasta el enriquecimiento real in-season.

#### Sprint 11.7 — Pick Imperdible Soccer (espeja NFL 9.5) — ✅ implementado en código (2026-06-08)
Lock-of-the-slate soccer. Cero ediciones a frozen; desbloqueado por 11.2 (modelos soccer ya entrenados/vivos).
- ✅ [soccerImperdibleSelector.js](../server/services/soccerImperdibleSelector.js) — scorer puro de convicción (modelo 0.45 + mercado de-vig 0.30 + shadow validator 0.25, re-normalizado sobre señales presentes) + gate + ranking. Calibración soccer: cap 62% → `minConviction:60`, varianza por mercado (1X2=0, total=4, btts=5). Gate duro `requireModelCertified` (sin sidecar → no lock); gate de lineup **soft** (`requireLineupConfirmed` default `false` — sin fuente de alineaciones hasta 11.3). Unit-tested (12).
- ✅ [soccerImperdibleEngine.js](../server/services/soccerImperdibleEngine.js) — orquesta: context + odds + `predictSoccerGameModel` + `calculateSoccerShadowScore` + `buildSoccerGameCandidates` → score → gate → top-K → árbitro → persiste `picks` (`source='imperdible'`, `sport='soccer'`, `league=…`, resuelto por el resolver soccer) + `imperdible_runs`. Genera texto resolver-compatible (`<Team> Home Win`) + guarda `odds_details` (para CLV 11.8). Half-Kelly cap 3%.
- ✅ [soccerImperdibleArbiter.js](../server/services/soccerImperdibleArbiter.js) + [prompts/soccer-imperdible-prompts.js](../server/prompts/soccer-imperdible-prompts.js) — árbitro Opus; disqualifiers de fútbol (rotación/lineup ~1h pre-kick, **el Draw que hunde un lock 1X2**, congestión de calendario, perfil de liga para over/under). Sesgo fuerte a PASS.
- ✅ [routes/soccer-imperdible.js](../server/routes/soccer-imperdible.js) — `GET /games|history`, `POST /analyze` (admin, flag `IMPERDIBLE_SOCCER_ENABLED`, league-aware). Montada en index.js antes de `/api/soccer`.
- **Pendiente**: calibración de thresholds (4-6 semanas in-season) + gate de lineup real (requiere 11.3/API-Football) + UI dedicada.

#### Sprint 11.8 — Lifecycle completeness — 🟡 CLV implementado (2026-06-07)
- ✅ **CLV / closing line capture**: [closing-line-capture-soccer.js](../server/closing-line-capture-soccer.js) — análogo league-aware de `closing-line-capture.js` (MLB). La apertura se lee del snapshot `odds_details` persistido en el pick (sin tocar el path de creación); la línea de cierre se captura en vivo cerca del kick-off (ventana 30 min). `extractSoccerPickOdds` (1X2/total/btts, bilingüe, puro), `impliedProbPct`, `computeSoccerClv` (CLV = implied cierre − implied apertura). Persiste `odds_at_pick`/`implied_prob_at_pick` (backfill) + `closing_odds`/`implied_prob_closing`/`clv` en `picks` (columnas existentes). Job en `index.js` cada 2h gated por `SOCCER_ANALYSIS_ENABLED`. Tests: [soccerClosingLine.test.js](../server/__tests__/soccerClosingLine.test.js) (6 puros).
- ✅ **Postmortem sport-aware**: [pick-postmortem.js](../server/pick-postmortem.js) — `SOCCER_SYSTEM_PROMPT` (3-vías, Draw nunca push, xG vs goles, BTTS) + ruteo `resolvePostmortemSport`/`getSystemPrompt` para soccer (antes caían al prompt MLB de pitchers/innings). [postmortemContext.js](../server/services/postmortemContext.js) branch soccer en `buildPostmortemFeatureSnapshot` (goles/goal-diff/points/xG/xGA/draw_price/odds) + `buildPostmortemGameSummary` (mínimo, sin red — 1X2 no tiene push). `index.js` caller reconoce `sport='soccer'`. Tests: `postmortemSport.test.js` (+2).
- **Pendiente**: ensemble de mercados soccer (requiere picks resueltos).

#### Sprint 11.9 — Pizarra smart signals + mantenimiento — 🟡 smart signals implementados (2026-06-07)
- ✅ **Señales rule-based**: [hexaSoccerSignalsService.js](../server/services/hexaSoccerSignalsService.js) — análogo de `hexaSmartSignalsService` (MLB). Detectores puros determinísticos sobre el contexto soccer: racha de form (W/L run), **divergencia xG vs goles** (over/under-performing → riesgo/valor por regresión), mismatch de tabla (points/goal-diff gap), forma de mercado de-viggada (favorito claro / 3-vías parejo / empate elevado), perfil de liga (alta anotación → Over / defensiva → empates). Misma forma de señal que MLB (`{type, icon, text:{es,en}, priority, meta}`) + `rankAndTrim`. Expuesto en `meta.signals` de `POST /api/soccer/analyze/game`. Drive-by fix: `toNum` guarda null/undefined (Number(null)===0 marcaba falso overperforming en MLS sin xG). Tests: [hexaSoccerSignals.test.js](../server/services/__tests__/hexaSoccerSignals.test.js) (8).
- **Pendiente**: **ascensos/descensos** — `soccer-team-map.js` (88 clubes seed) se desactualiza cada temporada (3 suben/bajan por liga); mecanismo de refresh. **xG MLS** — Understat no cubre MLS; evaluar API-Football/FBref.

---

### 📋 Sprint 12 — Tennis

**Spec maestra**: [tennis-architecture.md](tennis-architecture.md) · **Roadmap por sub-sprints (12a–12e)**: [tennis-roadmap.md](tennis-roadmap.md). El resumen de abajo se conserva; el detalle vive en esos dos documentos.

**Status**: 📋 planning (docs completas, sin código). Inicio recomendado: tras Sprint 11; torneos Grand Slam como hito de validación. `tennis` ya está en el registry como deporte conocido (`SPORT_META.tennis.active=false`). **Primer deporte individual**: jugador A vs B mapeado a slots home/away; tours `atp`/`wta` reusan la dimensión `league` de Soccer. El componente genuinamente nuevo es el **resolver de retiros/walkovers** (void + refund).

**Por qué Tennis**: único deporte **año redondo** (Australian Open ene, Roland Garros may, Wimbledon jun, US Open ago + ATP/WTA tours continuos). Llena todos los huecos de calendario que los otros deportes no cubren.

**Diferencias estructurales**:
- **Deporte individual**: no hay "equipo". El contexto es jugador A vs jugador B — H2H, ranking, forma en surface, fatiga de torneo (rounds jugados, minutos en cancha).
- **Surface importa como park factors en MLB**: arcilla (Roland Garros) ↔ hierba (Wimbledon) ↔ dura (AO/USO) cambian radicalmente los matchups. Un jugador top en dura puede ser mediocre en arcilla.
- **Retiros y walkovers**: un jugador puede retirarse mid-match por lesión. El resolver debe marcar como `void` o `walkover` si el partido no se completó (política de la casa = no acción).
- **Mercados**: match winner (2-vías, no hay empate), set handicap (ej. +1.5 sets), over/under games totales.
- **Cap de confianza Oracle**: ~72% (el mercado ATP top-10 es muy eficiente; torneos menores/qualies tienen más edge).
- **Ranking ATP/WTA + ELO superficial**: más predictivo que el ranking oficial en superficies específicas.

**Fuentes de datos**:
- ESPN API soccer-style para Tennis (`/apis/site/v2/sports/tennis/`) — juegos del día, scores en vivo, draw del torneo.
- The Odds API `tennis` — dual key fallback.
- Tennis Abstract (Jeff Sackmann, GitHub gratuito) — ELO por superficie, H2H histórico, stats de juego. Scraping o descarga CSV.
- ATP/WTA sitios oficiales — rankings oficiales (scraping con cache 24h).

**Archivos a crear**:
- `server/tennis-api.js` — wrapper ESPN tennis. `getTennisMatchesForDate`, `getTennisTournamentDraw`, `getTennisLiveScore`.
- `server/tennis-context-builder.js` — `buildTennisMatchContext`: ranking, ELO superficie, H2H (últimos 5), rounds jugados en torneo actual, injury flags, `context_meta`.
- `server/tennis-odds.js` — The Odds API `tennis`, dual key.
- `server/prompts/oracle-tennis-prompts.js` — `TENNIS_SYSTEM_PROMPT`. Cap 72%, prioridad ELO-surface→H2H→fatigue, guardrail anti-retiro.
- `server/services/oracleTennis.js` — `analyzeTennisMatch`, `analyzeTennisChat`. No toca `oracle.js`.
- `server/services/tennisOutputGuard.js` — valida `pick_side` sea `player_a|player_b`, maneja set handicap.
- `server/routes/tennis.js` — `POST /api/tennis/analyze/match|chat` (admin-only, flag `TENNIS_ANALYSIS_ENABLED`).
- `server/pick-resolver-tennis.js` — resuelve por score final sets. Walkover/retiro → `result='void'`, créditos devueltos.
- `server/services/tennisShadowValidator.js` + `tennisShadowPersistence.js`.
- Migraciones: columnas tennis en `pick_features` (elo_surface_home/away, h2h_surface_wins, tournament_round, fatigue_minutes).

**Esfuerzo estimado**: ~2–3 semanas. El resolver de walkover/retiro es el punto más delicado.

**Criterio de éxito**:
- Oracle distingue comportamiento en superficie (no da el mismo pick en arcilla vs dura para el mismo matchup).
- Retiro mid-match → pick anulado automáticamente, crédito devuelto.
- Grand Slam como torneo de validación (Australian Open o Roland Garros).

---

### ⏳ Sprint 13 — Carreras de Caballos

**Status**: ⏳ planificado. Inicio recomendado: tras Sprint 12. Foco inicial en US (Triple Corona + Breeders' Cup) o UK/IRE (Cheltenham + Royal Ascot).

**Diferencias estructurales — el más distinto de todos**:
- **Múltiples participantes por evento**: no es A vs B sino 8–20 caballos por carrera. El Oracle analiza un campo completo, no un matchup.
- **Mercados únicos**: Win (ganador), Place (top 2-3), Each-Way (Win + Place combinado), Exacta (1°+2° en orden), Trifecta.
- **Contexto de forma** ("form"): los últimos 5–10 carreras del caballo, distancia preferida, going (track condition: firm/good/soft/heavy), jockey actual, entrenador, peso asignado, posición de cajón (draw).
- **Going es crítico**: un caballo que gana en "good" puede correr mal en "soft". Equivalente al viento en NFL.
- **Mercado extremadamente eficiente** en UK/IRE: las casas tienen décadas de data y modelos propios. El edge real existe principalmente en **value en cada-vías de favoritos de mercado medio** (no el favorito absoluto, no el outsider).
- **Cap de confianza Oracle**: ~65% (único deporte donde el LLM puede razonar sobre forma individual de cada competidor — pero el mercado también lo hace).
- **Resolución**: múltiples outcomes posibles. El resolver necesita parsear el resultado final (1°, 2°, 3°) y determinar Win/Place por separado.

**Fuentes de datos**:
- The Odds API `horse_racing` — dual key fallback. Odds pre-carrera y SP (Starting Price).
- **Equibase** (US) — data oficial de carreras US, gratuito para datos básicos (`equibase.com/stats/`).
- **Racing Post** (UK/IRE) — la fuente más completa para caballos europeos. Scraping con cache o API de pago.
- **Racing API** (UK, freemium) — form, going, jockeys, resultados. 100 calls/día gratis.
- ESPN no cubre caballos — fuente de datos completamente diferente a los otros deportes.

**Archivos a crear**:
- `server/horse-racing-api.js` — wrapper Equibase (US) + Racing API (UK). `getRacesForDate`, `getRaceCard`, `getHorseForm`, `getTrackCondition`.
- `server/horse-racing-context-builder.js` — `buildRaceContext`: card completo (nombre, jockey, entrenador, peso, draw, form últimas 5 carreras, going preference, `context_meta`).
- `server/horse-racing-odds.js` — The Odds API `horse_racing`. Múltiples runners → estructura diferente a los otros deportes (objeto por runner, no por equipo).
- `server/prompts/oracle-horse-prompts.js` — `HORSE_RACING_SYSTEM_PROMPT`. Cap 65%, análisis de campo completo, prioridad form→going→jockey→draw. El Oracle elige **un runner** como pick o PASS si el campo es demasiado abierto.
- `server/services/oracleHorse.js` — `analyzeRace`, `analyzeRaceChat`. Sin Grok. No toca `oracle.js`.
- `server/services/horseOutputGuard.js` — valida que el pick identifique un runner válido del card, market_type `win|place|each_way`.
- `server/routes/horse-racing.js` — `POST /api/horse/analyze/race|chat` (admin-only, flag `HORSE_RACING_ENABLED`).
- `server/pick-resolver-horse.js` — resuelve Win/Place desde resultado oficial. Each-Way = Win resuelve si ganó, Place resuelve si terminó en los puestos pagados (varía por número de runners).
- `server/services/horseShadowValidator.js` + `horseShadowPersistence.js`.
- Migraciones: columnas horse en `pick_features` (going, draw_position, field_size, jockey_wins_pct, trainer_wins_pct, horse_form_string).

**Esfuerzo estimado**: ~4–5 semanas. La fuente de datos (Equibase/Racing API) y el resolver de each-way son la mayor complejidad.

**Criterio de éxito**:
- Oracle analiza un card completo y produce pick con runner identificado, market Win/Place/EW, y justificación basada en form/going.
- Resolver distingue Win vs Place vs EW y determina resultado correcto desde el resultado oficial.
- Triple Corona (Kentucky Derby, Preakness, Belmont) como hito de validación US; Cheltenham para UK.

---

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

2026 Q3-4 Sprint 10    — NHL Hockey                        ████████████████████████ ✅ (backend + UI; ML sidecar diferido)
2026 Q4-1 Sprint 11    — Soccer (Big 5 + MLS)              ████████████████████████ ✅ (completo + en prod; SOCCER_ANALYSIS_ENABLED=true; logos ESPN CDN)
2026 Q4   Sprint 9.3   — NFL nflverse pre-training         ████████████████████████ ✅ (EPA/PROE real; 3 modelos NFL en prod; pyarrow; 2026-06-06)
2027 Q1-2 Sprint 12    — Tennis (ATP/WTA)                  ████████████████████████ ✅ (completo en código; rama claude/tennis-sprint-12; gated TENNIS_ANALYSIS_ENABLED)
2027 Q2-3 Sprint 13    — Carreras de Caballos              ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳ (US+UK/IRE, tras Sprint 12)
```

**Estado al cierre de Sprint 9 + 9.3 (2026-06-06)**:
- ✅ Sprint 8f Railway hardening — tres servicios Online, Node 20 activo, emails operativos.
- ✅ A1–A9, B2–B11 completados. Todos los Tier A y Tier B cerrados en código y en frontend.
- ✅ B2 Hexa Live UI — `LiveTracker` SSE per-game (2026-05-29). Lag real ~1-2s vs 30s antes.
- ✅ B10 Alt lines UI — `AltLinesModal` + botón en `PlayerPropsPage` cerrado.
- ✅ **NFL Sprint 9 completo** (PRs #373–#378, 2026-05-30): Oracle + lifecycle + shadow/dataset + live tracker + UI (selector activo, pizarra placeholder) + ML scaffolding. Tres deportes operativos: MLB, NBA, NFL.
- ✅ **Hotfix ensemble skip UX (2026-05-30)**: `POST /retrain/ensemble` en `admin-ml.js` — la query de filas elegibles ahora usa `GROUP BY pick_market_type` con `actual_status='resolved'`; devuelve `eligible_by_market`. Toast "ENSEMBLE OMITIDO" muestra desglose por mercado (`moneyline: N/50 · overunder: N/50 · …`) en vez del total global engañoso.
- ✅ **Sprint 9.3 — nflverse pre-training (2026-06-06)**: cierra la brecha #1 de calidad NFL (EPA = el Statcast del fútbol americano), sin depender de `nfl_data_py` (que clava `pandas<2.0`). Dep nueva: `pyarrow==18.1.0`.
  - `ml/hexa_ml/nflverse_loader.py` (NEW): descarga parquet pbp de nflverse desde GitHub release assets; `build_team_stats(season)` (EPA off/def, success rate, PROE por equipo, cache 6h); `build_nfl_training_frame(market, years)` (dataset sin leakage as-of-week, `spread_close = -spread_line` para igualar `nfl-odds.js`). 2,622 filas de historia, 8 temporadas.
  - `ml/hexa_ml/serve.py`: `GET /nfl/team-stats?season=` + `POST /nfl/refresh` (503 defensivo si falta pyarrow).
  - `ml/hexa_ml/train.py`: concatena picks live (vacíos en offseason) + historia nflverse; `NFL_PRETRAIN_ENABLED` (default `true`) + `NFL_PRETRAIN_SEASONS`; fix latente: `train_one_market` tolera columna de odds ausente.
  - `ml/hexa_ml/config.py`: `nfl_pretrain_enabled` + `nfl_pretrain_seasons`.
  - `server/nfl-advanced-fetcher.js` (NEW): análogo NFL de `savant-fetcher.js`; EPA/PROE desde sidecar, re-keyed a abbr ESPN canónico (WAS→WSH, LA→LAR), cache 6h, stale fallback, no-op si sidecar off.
  - `server/nfl-context-builder.js`: EPA/success/PROE ya NO son null; `successRate` aliasado para payload ML; `context_meta.sources.advancedStats` + `completeness.advancedStats` (peso 20%).
  - Tests: `ml/tests/test_nflverse_loader.py` (6 unit tests sin red) + `server/__tests__/nfl-advanced-fetcher.test.js` (4 Node tests).
  - GitHub Actions: secrets `HEXA_ML_API_URL` + `HEXA_ML_INTERNAL_TOKEN` configurados en el repo; retrain semanal (`retrain-weekly.yml`) incluye los 3 modelos NFL.
  - **Modelos NFL en producción**: nfl_moneyline (Brier ~0.234), nfl_spread (~0.25), nfl_total (~0.25). Retrain run #5 exitoso el 2026-06-06.

**Pendiente operacional (no requiere nuevo sprint de código)**:
- Props ML gate: acumular ≥50 props resueltos → retrain `prop` model → `MLB_PROPS_ML_PUBLIC_ENABLED=1`.
- NBA validación E2E en prod con tráfico real.
- Parlay beta pública: `PARLAY_SYNERGY_ENABLED=true` cuando hit rate validado.
- NFL sept 2026: activar `hexaNflBoardService` (pizarra del día), picks reales de temporada → refinar modelos NFL (ya pre-entrenados con nflverse).
- `OPENAI_EMBED_API_KEY` → activa RAG (pgvector embeddings de oracle_report en contexto).

Para detalle ejecutable de cada sprint, ver [docs/ml-pipeline.md sección 10](ml-pipeline.md#10-plan-modelo-python-entrenado-propio).
