# Roadmap — H.E.X.A. v4

Documento vivo. Se actualiza al cierre de cada sprint y cuando entran/salen items del backlog.

**Última actualización**: 2026-05-15 — Sprint 6 cerrado (6a equity compare en bankroll, 6b prod); post-6 hardening (parlay resolve, ML observability, NBA team-map + output guard). **Player Props ML MLB diferido** a bloque posterior. Rama activa de trabajo: `feat/nba-go-live-gate`.

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

### Foco inmediato (rama `feat/nba-go-live-gate`)

1. **Validación E2E NBA en producción** — analyze → persist → historial → resolver post-game con tráfico real (`npm run smoke:nba` + token admin).
2. ~~**6a menor** — equity en bankroll + performance~~ ✅ panel reutilizable `EquityComparePanel` en tab Bankroll (dashboard) y Oracle Performance (logueado).
3. **Parlay Architect** — smoke post-deploy de AUTO (`db_*`) y `leg_results` (`npm run smoke:parlay`).
4. **NBA live tracker** (opcional en esta rama) — `pick-tracker-nba.js` quarter-by-quarter.

**Explícitamente fuera de esta fase**: Sprint 5 **Player Props ML** (hits / total_bases / strikeouts) — requiere pipeline Savant per-batter + training sidecar; ver [backlog](#3-backlog-priorizado).

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

**Pendiente del bloque ML (diferido)**:
- ⏸️ **Sprint 5 Player Props MLB** — **no en curso**. Training para hits / total_bases / strikeouts. Bloqueado hasta extender [savant-fetcher.js](../server/savant-fetcher.js) con leaderboards per-batter (xBA, xSLG, splits vs handedness, forma 7d/14d) + pipeline de labels/resolver por `prop_kind`. Banner "coming soon" en `/admin/ml-control`.

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

**Status**: ✅ **resolver**; ⏳ live tracker NBA dedicado.

**Entregables**:
- ✅ `server/pick-resolver-nba.js`: moneyline/spread/total; job cada 30 min; actualiza shadow runs NBA.
- ⏳ `server/pick-tracker-nba.js`: tracking en vivo quarter-by-quarter.
- Reutilizar [server/pick-postmortem.js](../server/pick-postmortem.js) con prompt NBA-adapted.
- Cron job para auto-resolver picks NBA con games del día.

**Criterio de éxito**:
- Pick NBA creado → tracked en vivo → resuelto automáticamente post-game → postmortem generado. Zero intervención manual.

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

## 3. Backlog priorizado

Cada tier ordenado por ROI / esfuerzo dentro del tier. Detalle del por qué de la prioridad en cada item.

### Tier S — Alta señal, bajo esfuerzo

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| S1 | **Equity curve + Sharpe + drawdown dashboard** | ~2 semanas | ✅ Cerrado — **Sprint 6a** (2026-05-15). Comparativa bankroll OK; pendiente: bottom nav. |
| S2 | **Versionado de prompts** (`prompt_hash` + `prompt_version` en pick_features) | 1 día | Trivial, alto valor para auditoría. Sprint 1 ya incluye los campos en pick_features. Falta llenarlos desde oracle.js. |
| S3 | **Audit del feature store** (`npm run audit` reporta huecos) | 1 día | Health check para detectar features faltantes / fecha vieja. Útil pre-training. |
| S4 | **Telegram channel publisher** | 3 días | Reusa `contentDraftService`, añade adapter `telegramPublisher.js`. Mayor engagement por canal. |
| S5 | **Newsletter weekly recap via Resend** | 3 días | Reusa email.js + `weekly_recap` content type que ya existe. Tabla `newsletter_subscribers`. |
| S6 | **Postmortem dashboard cuantitativo** | 2 días | Agregaciones de `picks.postmortem.alert_flags` por hit/miss. Detecta patrones para refinar prompts. |
| S7 | **Persistencia de modelos ML (Railway Volumes)** | ~1-2 semanas | ✅ Cerrado — **Sprint 6b** (2026-05-15). Runbook post-deploy en [admin-and-ops.md](admin-and-ops.md#11-ml-sidecar--persistencia-de-modelos-sprint-6b). |
| S8 | **NBA sport isolation hotfix** | ~1-2 semanas | ⬆️ Promovido a **Sprint 7.0**. Separación historial/persistencia por `sport`, SAFE NBA aislado de MLB, props NBA temporalmente desactivados. |

### Tier A — Alta señal, esfuerzo medio

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| A1 | **F5 (First 5 innings) market** | ~1 semana | Pitcher xwOBA ya está en features. Falta: odds del Odds API (cubierto), resolver lógica de stop-at-5, UI. Alto valor: F5 evita bullpen variance. |
| A2 | **FanGraphs ZiPS scraper** (Python en sidecar ML) | ~1 semana | Inyecta proyecciones rest-of-season como features. Gratis (scraping legal). Mejora calibración del modelo entrenado. |
| A3 | **pgvector + embeddings de oracle_report** | ~1.5 semanas | RAG: antes de analizar un juego, recupera 5 análisis pasados similares (mismos pitchers, mismas condiciones). Necesita pgvector extension. |
| A4 | **Player Props dedicated UI** | ~1 semana | Datos ya están. Falta UI: tabla de props del día por jugador, filtros, edge resaltado. |
| A5 | **Rate limit per-user con tiers** | 3 días | `keyGenerator` custom basado en `req.user?.id`. Tiers: anon / free / paid / admin. |
| A6 | **Migrar a node-pg-migrate o Drizzle** | ~1 semana | Versionado real de schema, rollback, diff. Más limpio que IF NOT EXISTS embebido. |
| A7 | **Backtest con CSV upload** | ~1 semana | Admin sube CSV con picks históricos, el modelo los evalúa. Útil para A/B test de prompts. |
| A8 | **Beat reporters scraper + injury classifier** (Haiku) | ~1 semana | Lista curada de beat reporters X. Cada hora scrapeo tweets + clasifica con Haiku (juega / dudoso / out). Featurea más fino que `injuryStatus` de MLB API. |
| A9 | **Parlay Synergy feature flag → public beta** | 3 días | Hoy admin-only. Validar métricas de Sprint 3 del brief de parlay; si hit rate es bueno, abrir a usuarios paid. |

### Tier B — Alta señal pero esfuerzo alto o dependencia externa

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| B1 | **Expansión NBA** | 10-14 semanas | ⬆️ Promovido a **Sprint 7** (a-e). Ver [sección 2](#-sprint-7--expansión-nba-scaffolding--mvp-q4-2026--q1-2027-10-14-semanas). Pre-requisito MLB ML ya está en producción. |
| B2 | **Hexa Live (in-play WP + momentum alerts)** | 2-3 semanas | Infra de WebSocket (cliente al server), polling agresivo MLB Stats, WP model, momentum detection (bullpen fatigue + consecutive hard contacts). Alertas push web. |
| B3 | **Discord bot** | 1-2 semanas | discord.js, comandos slash `/today`, `/pick {gameId}`, webhook para auto-post. Server propio HEXA. |
| B4 | **Threads (Meta) publisher** | 1-2 semanas | Depende del Meta API stability. Adapter similar a `xPublisher.js`. |
| B5 | **Feature flags reales** (GrowthBook self-hosted) | 1 semana | Reemplaza env vars como toggles. Permite A/B test de prompts y modelos por % de usuarios. |
| B6 | **Observability (Sentry + structured logging con pino)** | 1 semana | Sentry para errores, pino para JSON logs, Better Stack para uptime + grep en logs. |
| B7 | **Migración a BullMQ + Redis** | 1 semana | Reemplaza `setInterval`. Necesario antes de escalar a 2+ instancias del server. |
| B8 | **Infografías auto-generadas** | 1.5 semanas | Recharts SSR con `react-to-image` o `puppeteer`. CDN en Cloudflare R2. Anexar a posts X / Telegram. |
| B9 | **Hexa Scout (futures + prospect call-ups)** | 1.5 semanas | Odds API soporta futures, plug-and-play. ZiPS / Steamer para context. Alertas de prospect call-ups con call-up tracker. |
| B10 | **Player Props alternate lines + resolver multi-line** | 1.5 semanas | Necesita parsing más complejo del Odds API + UI con dropdown de líneas. |
| B11 | **CI/CD GitHub Actions completa** | 1 semana | Lint (cuando se añada), tests, build verification, retrain weekly del modelo Python, + smoke gate MLB (`.github/workflows/mlb-smoke.yml`) en PR/main. |

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
2026 Q2  Sprints 0-5   — Pipeline ML completo            ████████████████████████ ✅
2026 Q3  Sprint 6a     — Equity curve dashboard          ████████████████████████ ✅
2026 Q3  Sprint 6b     — Persistencia ML (Volumes)       ████████████████████████ ✅
2026 Q3-4 Sprint 7.0   — NBA hardening gate              ████████████░░░░░░░░░░░░ 🔄
2026 Q3-4 Sprint 7a    — Scaffolding NBA (datos)         ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
2026 Q4  Sprint 7b     — Oracle NBA + prompts            ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
2026 Q4  Sprint 7c     — NBA pick lifecycle              ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
2027 Q1  Sprint 7d     — UI NBA + frontend               ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
2027 Feb  🎯 MVP NBA listo para All-Star Break
2027 Q1-2 Sprint 7e    — NBA ML sidecar (condicional)    ░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
```

**Después del MVP NBA**:
- Sprint 5 Player Props MLB (si no se cerró antes).
- Tier A items: F5 market, FanGraphs ZiPS scraper, pgvector + RAG, Player Props UI.
- Re-evaluar NHL como siguiente deporte (timing similar a NBA, oct-jun).

Para detalle ejecutable de cada sprint, ver [docs/ml-pipeline.md sección 10](ml-pipeline.md#10-plan-modelo-python-entrenado-propio).
