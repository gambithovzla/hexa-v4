# Roadmap — H.E.X.A. v4

Documento vivo. Se actualiza al cierre de cada sprint y cuando entran/salen items del backlog.

**Última actualización**: 2026-05-15 — Sprints 0-5 cerrados; Sprint 6a/6b en cierre operativo; NBA hardening (7.0) cerrado en código (injuries + odds server-side + context_meta).

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

### Por qué cerrar 2 cosas antes de tocar NBA

1. **Equity curve + Sharpe + drawdown dashboard** (Tier S1 del backlog). Los datos ya están en `picks` y `bankroll`. Sin esto, Hexa parece un juguete de picks sueltos en vez de un sistema de bankroll — y un usuario serio mira eso antes de pagar.
2. **Persistencia de modelos ML** (Railway Volumes o snapshot a Postgres). Hoy cada redeploy de Railway borra los `.pkl` y el ensemble vuelve a "OFFLINE" hasta el siguiente retrain. Es deuda silenciosa que rompe la propuesta de valor del Python XGBoost — los picks nuevos caen al validator legacy hasta que alguien dispare retrain manual.

### El trade-off explícito

Si se queda solo en MLB y se profundiza (player props, equity, mobile), crece LTV por usuario pero no resuelve la estacionalidad — y un competidor cross-sport come el flanco. Si se salta a NBA sin la equity dashboard, los usuarios nuevos no van a entender por qué Hexa es distinto a 50 servicios de picks de NBA.

Solución: **scaffolding NBA en paralelo con equity + persistencia**, no en serie.

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

**Pendiente del bloque ML**:
- ⏳ **Sprint 5 Player Props** — training para hits / total_bases / strikeouts. Requiere features per-batter (xBA, xSLG, splits vs handedness) que aún no están en [savant-fetcher.js](../server/savant-fetcher.js). Banner "coming soon" visible en el Control Center.

---

### 🔄 Sprint 6 — Pre-NBA hardening (Q3 2026, ~6 semanas)

**Status**: en cierre. Bloqueante implícito para abrir NBA al público — corre en paralelo con Sprint 7.0.

Justificación: dos heridas abiertas que rompen la propuesta de valor antes de duplicar superficie de producto con NBA.

#### Sprint 6a — Equity curve + Sharpe + drawdown dashboard (~2 semanas)

**Status**: ✅ **cerrado en código** (2026-05-15). Pendiente menor: comparativa "tú vs Hexa baseline" y endpoint dedicado por usuario si se quiere bankroll USD.

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

**Status**: ✅ **código listo** — `HEXA_ML_ARTIFACTS_DIR`, `/health` con `artifacts_persistent`, HUD en Control Center. ⏳ **ops en Railway**: montar Volume + checklist post-redeploy ([docs/admin-and-ops.md](admin-and-ops.md#11-ml-sidecar--persistencia-de-modelos-sprint-6b), `npm run verify:ml:persistence`).

**Problema que resuelve**: el sidecar Python guardaba los `.pkl` en `artifacts/` efímero. Cada redeploy wipeaba modelos y los picks nuevos caían al validator legacy hasta retrain manual.

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

**Criterio de éxito**:
- Trigger un redeploy manual del sidecar en Railway.
- `GET /api/admin/ml/status` sigue mostrando Brier/n_train/trained_at sin necesidad de retrain.
- Un pick nuevo creado post-redeploy llega al Python sidecar (no cae al fallback legacy).

**Riesgo**: bajo. Cambio aislado al sidecar. Si falla el volume, el fallback del `/api/admin/ml-calibration` (PR #286 — lee de `ml_retrain_log`) sigue protegiendo la UI.

**Nota**: el fallback del calibration endpoint mitiga el problema en la UI pero no en las **predicciones** — sigue habiendo una ventana post-redeploy donde los picks no tienen Python score hasta el siguiente retrain. Sprint 6b cierra esa ventana.

---

### ⏳ Sprint 7 — Expansión NBA, scaffolding + MVP (Q4 2026 → Q1 2027, ~10-14 semanas)

**Status**: 🔄 en ejecución. 7a-7d entregados + hardening 7.0 parcial.

**Target**: MVP NBA listo para el **All-Star Break (15-17 feb 2027)** o antes. Es la ventana donde MLB está dormido y NBA está en pico de interés (playoffs approach).

#### Sprint 7.0 — NBA hardening gate (hotfix obligatorio antes de abrir) (~1-2 semanas)

Estado: ✅ cerrado en código (2026-05-15). Falta solo validación end-to-end con tráfico real antes del flip público.

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

Criterio de éxito:
- ✅ Un análisis NBA guardado aparece como NBA en historial, breakdown y cards.
- ✅ Cero errores tipo "Game not found" por cruce de SAFE MLB en flujo NBA.
- ✅ Ninguna regresión detectada en suite MLB crítica.
- ✅ Contexto NBA incluye injuries y odds server-side; `context_meta` permite a la UI admin filtrar/anotar picks con `staleFlags`.

#### Sprint 7a — Scaffolding de datos NBA (~3 semanas)

**Entregables**:
- `server/nba-api.js`: wrapper de NBA Stats API (gratis, [stats.nba.com](https://stats.nba.com)) + fallback a [nba_api Python lib](https://github.com/swar/nba_api) si necesitamos features no expuestas.
- `server/nba-context-builder.js`: arma payload por partido — rosters, splits jugador-vs-defensa, pace, lineup confirmation, rest days, B2B status, injury status.
- `server/nba-savant-equivalent.js`: scraper / API de basketball-reference + cleaningtheglass (off-rating, def-rating ajustados por pace).
- Migración: tabla `nba_games`, `nba_player_stats`, `nba_team_stats` (separadas de las MLB para evitar contaminación).
- Migración a `picks`: añadir `sport ENUM('mlb', 'nba')` con default `'mlb'` para retrocompatibilidad.
- Migración a `pick_features`: misma columna `sport` + nuevas columnas NBA-específicas (`player_id`, `opponent_def_rating`, etc.).

**Criterio de éxito**:
- `node scripts/test-nba-context.js --game=<id>` imprime payload completo en <2s.
- Tabla `nba_games` se llena con games del día via cron job.

---

#### Sprint 7b — Oracle NBA + prompts adaptados (~3 semanas)

**Entregables**:
- `server/prompts/oracle-nba-prompts.js`: nuevos prompts (no tocar oracle.js). Mismos motores (Claude / Grok / Dual) — solo cambia el prompt y el payload.
- Adapter `server/services/oracleNba.js` que orquesta sin tocar [oracle.js](../server/oracle.js). Patrón ya usado en `parlayEngine/llmClient.js`.
- Endpoints: `/api/analyze/nba/game`, `/api/analyze/nba/parlay`, `/api/analyze/nba/player-props`.
- Mercados v1: moneyline, spread, total, player points (más altos volumen NBA).
- Mercados v2 (post-MVP): rebounds, assists, threes, double-double.

**Criterio de éxito**:
- Análisis NBA real corre en producción, admin-only feature flag (`NBA_ANALYSIS_ENABLED`).
- 50+ picks NBA creados en periodo de testing antes de abrir a usuarios.

---

#### Sprint 7c — NBA pick lifecycle (~2 semanas)

**Entregables**:
- `server/pick-resolver-nba.js`: resuelve picks NBA post-game (score, player stats, market-specific resolution para props).
- `server/pick-tracker-nba.js`: tracking en vivo durante el game (quarter-by-quarter, player progress).
- Reutilizar [server/pick-postmortem.js](../server/pick-postmortem.js) con prompt NBA-adapted.
- Cron job para auto-resolver picks NBA con games del día.

**Criterio de éxito**:
- Pick NBA creado → tracked en vivo → resuelto automáticamente post-game → postmortem generado. Zero intervención manual.

---

#### Sprint 7d — UI NBA + integración con frontend (~2 semanas)

**Entregables**:
- Sport switcher en bottom nav (MLB / NBA).
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
| S1 | **Equity curve + Sharpe + drawdown dashboard** | ~2 semanas | ⬆️ Promovido a **Sprint 6a**. Ver [sección 2](#-sprint-6--pre-nba-hardening-q3-2026-6-semanas). |
| S2 | **Versionado de prompts** (`prompt_hash` + `prompt_version` en pick_features) | 1 día | Trivial, alto valor para auditoría. Sprint 1 ya incluye los campos en pick_features. Falta llenarlos desde oracle.js. |
| S3 | **Audit del feature store** (`npm run audit` reporta huecos) | 1 día | Health check para detectar features faltantes / fecha vieja. Útil pre-training. |
| S4 | **Telegram channel publisher** | 3 días | Reusa `contentDraftService`, añade adapter `telegramPublisher.js`. Mayor engagement por canal. |
| S5 | **Newsletter weekly recap via Resend** | 3 días | Reusa email.js + `weekly_recap` content type que ya existe. Tabla `newsletter_subscribers`. |
| S6 | **Postmortem dashboard cuantitativo** | 2 días | Agregaciones de `picks.postmortem.alert_flags` por hit/miss. Detecta patrones para refinar prompts. |
| S7 | **Persistencia de modelos ML (Railway Volumes)** | ~1-2 semanas | ⬆️ Promovido a **Sprint 6b**. Ver [sección 2](#sprint-6b--persistencia-de-modelos-ml-1-2-semanas). |
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
2026 Q3  Sprint 6b     — Persistencia ML (Volumes)       ████████████████░░░░░░░░ 🔄 ops
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
