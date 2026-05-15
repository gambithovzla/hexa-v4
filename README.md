# H.E.X.A. v4

**H.E.X.A.** (Heuristic Evaluation & eXpert Analytics) es una plataforma de análisis predictivo de **MLB y NBA** que combina modelos de lenguaje (Claude y Grok/xAI), estadísticas avanzadas (Statcast / Baseball Savant para MLB; advanced team ratings, pace y rest analysis para NBA), líneas de casas de apuestas en tiempo real y un validador tabular propio para producir picks, parlays, análisis "safe" y contenido editorial.

Monorepo: API en Node/Express + Postgres y cliente React/Vite.

```
┌────────────────────────┐        ┌─────────────────────────┐
│  client/  (React+Vite) │◄──────►│  server/  (Express API) │
│  MUI · Framer · Recharts│  HTTP  │  Node 20 · ESM modules  │
└────────────────────────┘        └───────────┬─────────────┘
                                              │
        ┌──────────────┬──────────────┬───────┴───────┬──────────────┬──────────────┐
        ▼              ▼              ▼               ▼              ▼              ▼
   PostgreSQL     Anthropic API    xAI (Grok)     MLB Stats API   Odds API       Resend
   (pg pool)      (Claude 4.x)     grok-4-fast    + Savant        (líneas)       (email)
                                                  (Statcast)
```

---

## 📚 Documentación

Para profundidad técnica completa, ver carpeta [`docs/`](docs/):

| Doc | Cubre |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Subsistemas, diagrama, flujos críticos, decisiones arquitectónicas |
| [docs/ml-pipeline.md](docs/ml-pipeline.md) | Oracle dual LLM, shadow validator, feature store, CLV, plan modelo Python |
| [docs/integrations.md](docs/integrations.md) | APIs externas (Claude, xAI, MLB, Savant, Odds, Weather, Resend, NowPayments, X) |
| [docs/content-pipeline.md](docs/content-pipeline.md) | Generación de drafts, cola editorial, OAuth 1.0a publisher para X |
| [docs/admin-and-ops.md](docs/admin-and-ops.md) | DB explorer, backtest, jobs, logging, deployment, monitoring gaps |
| [docs/data-schema.md](docs/data-schema.md) | 16 tablas Postgres — columnas, índices, FKs, estado para training |
| [docs/roadmap.md](docs/roadmap.md) | Sprints en ejecución y backlog priorizado por tier |
| [docs/sport-registry.md](docs/sport-registry.md) | Sport Shell, capability matrix y checklist para escalar a nuevos deportes |

Para Claude Code (convenciones, frozen files, patrones): ver [CLAUDE.md](CLAUDE.md).

Para el motor Parlay Synergy: ver [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md).

---

## Requisitos previos

- **Node.js 20+** (usa ESM y `node --watch`)
- **PostgreSQL 14+**
- API keys (mínimo): Anthropic (Claude). Opcionales: xAI, The Odds API, Resend, NowPayments, X.

---

## Setup local

```bash
# 1. Clonar e instalar raíz
git clone <repo-url> hexa-v4
cd hexa-v4
npm install

# 2. Instalar cliente
cd client && npm install && cd ..

# 3. Configurar entorno
cp .env.example .env
# editar .env con tus keys y DATABASE_URL

# 4. Crear DB Postgres (una vez)
createdb hexadb

# 5. Correr migraciones (automático al iniciar el server)
npm run dev         # arranca API en :3001 y aplica migraciones

# 6. En otra terminal: cliente
npm run client      # Vite dev server

# O todo junto (concurrently)
npm run dev:all
```

---

## Variables de entorno (resumen)

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí | Key de Anthropic para Claude |
| `DATABASE_URL` | Sí | Connection string Postgres |
| `JWT_SECRET` | Sí | Secreto para firmar tokens (cambiar en prod) |
| `ODDS_API_KEY` | Si para cuotas reales | Key de The Odds API para moneyline/runline/totales MLB |
| `XAI_API_KEY` | No | Key xAI para modos Grok / Dual |
| `RESEND_API_KEY` | No | Si activas email verificado |
| `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` | No | Pagos cripto |
| `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | No | OAuth 1.0a para publicar en X |
| `SHADOW_MODE_ENABLED` | No | Activa el shadow validator |
| `PARLAY_SYNERGY_ENABLED` | No | Motor parlay nuevo (default `false`) |
| `NBA_ANALYSIS_ENABLED` | No | `true` para habilitar Oracle NBA y resolver automático (default `false`) |
| `X_AUTO_PUBLISH_ENABLED` | No | `0`/`1` — habilita worker de publicación X |
| `ML_SIDECAR_ENABLED` | No | `true` para activar llamadas al sidecar Python XGBoost |
| `ENSEMBLE_ENABLED` | No | `true` para habilitar el meta-learner ensemble |
| `HEXA_ML_API_URL` | No (con sidecar) | URL base del sidecar Python Railway |
| `HEXA_ML_INTERNAL_TOKEN` | No (con sidecar) | Token de autenticación Node→Python |
| `CHAT_EXTRACTOR_HAIKU_FALLBACK` | No | `0` para deshabilitar fallback Haiku del extractor de chat (default `1`) |
| `CHAT_EXTRACTOR_HAIKU_MODEL` | No | Override del modelo Haiku usado (default `claude-haiku-4-5-20251001`) |

Lista completa con descripciones en [.env.example](.env.example) y [docs/integrations.md](docs/integrations.md).

---

## Scripts disponibles

Desde la raíz ([package.json](package.json)):

| Script | Descripción |
|---|---|
| `npm run dev` | API con `node --watch` (recarga en cambios) |
| `npm start` | API en modo producción |
| `npm run client` | Dev server de Vite (`client/`) |
| `npm run dev:all` | API + cliente en paralelo (`concurrently`) |
| `npm run audit` | Diagnóstico del sistema ([scripts/system-audit.js](scripts/system-audit.js)) |
| `npm run smoke:mlb` | Smoke test de release MLB (endpoints críticos `/api/games`, `/api/teams`, `/api/hexa/board`) |
| `npm run smoke:nba` | Smoke test de release NBA (`/api/nba/games`, `/api/nba/teams`; con `SMOKE_ADMIN_TOKEN`+`SMOKE_NBA_GAME_ID` valida también `/api/nba/analyze/game` con `context_meta`) |
| `npm run test:mlb:critical` | Suite anti-regresión MLB (resolver, closing-line, guardrails `/api/picks`, admin equity) |
| `npm run verify:ml:persistence` | Post-deploy: valida `/health` del sidecar ML (volume + modelos cargados) |
| `npm run test:parlay` | Tests del Parlay Synergy Engine |

Desde `client/`:

| Script | Descripción |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Build de producción |
| `npm run preview` | Preview del build |

---

## Gate de release MLB (smoke)

Antes de dar luz verde a producción, ejecutar desde la raíz:

```bash
npm run smoke:mlb
```

Configurable por env vars:

- `SMOKE_BASE_URL` (default `http://127.0.0.1:3001`)
- `SMOKE_WAIT_FOR_SERVER` (`1` por default, usa espera activa antes de probar)
- `SMOKE_TIMEOUT_MS` (default `20000`)
- `SMOKE_RETRIES` (default `3`)
- `SMOKE_RETRY_DELAY_MS` (default `1000`)
- `SMOKE_ADMIN_TOKEN` (opcional; si existe valida también `/api/admin/ml/equity?sport=mlb`)

CI/CD:
- Workflow automático: `.github/workflows/mlb-smoke.yml`
- Corre en PRs y pushes a `main` cuando cambian archivos de `server/`, `scripts/smoke/` o `package.json`
- Corre además en schedule diario (10:30 UTC) como early warning de integraciones externas
- Pipeline en tres fases: build client (`client npm run build`), tests críticos (`npm run test:mlb:critical`) y luego smoke HTTP de release
- Siempre sube artifact `server.log` en CI para diagnóstico rápido cuando hay fallas intermitentes

## Estructura del repo

```
hexa-v4/
├── client/                 React + Vite SPA (MUI, Framer Motion, Recharts, PWA)
├── server/                 Node 20 ESM + Express
│   ├── index.js            entrypoint (rutas, jobs, rate limits)
│   ├── oracle.js           motor LLM dual (Claude + Grok)
│   ├── context-builder.js  arma payload por partido
│   ├── feature-store.js    persistencia de features MLB para training
│   ├── services/nbaShadow*.js  feature store + shadow NBA (sport='nba')
│   ├── migrate.js          migraciones SQL embebidas
│   ├── services/           xPublisher, contentDraftService, parlayEngine, etc.
│   ├── routes/             picks, content, insights, oracle-history
│   ├── middleware/         auth, content-api-key
│   └── prompts/            x-content-prompts
├── ml/                     sidecar Python FastAPI + XGBoost (desplegado en Railway)
│   ├── hexa_ml/            módulo principal (serve, train, predict, features, models)
│   └── Dockerfile
├── scripts/
│   ├── system-audit.js
│   └── training/           backfill-pick-features, export-dataset, run-backtest
├── docs/                   documentación viva por tema
├── CLAUDE.md               convenciones para Claude Code
├── .env.example
├── railway.json            config Railway (Nixpacks)
└── README.md               (este archivo)
```

Estructura completa con descripciones: [docs/architecture.md](docs/architecture.md#3-subsistemas).

---

## Endpoints principales (resumen)

Todos bajo `/api`. Los protegidos requieren JWT (`🔒`); los admin requieren rol admin (`👑`).

- **Públicos**: `/games`, `/teams`, `/odds/today`, `/hexa/board`, `/nba/games`, `/nba/teams`.
- **Auth** (`/auth/*`): register, login, me, verify-email, forgot-password.
- **Análisis MLB** (`/analyze/*`) 🔒: game, parlay, safe, parlay-synergy (👑 beta).
- **Análisis NBA** (`/nba/analyze/*`) 👑 (feature-flagged): game, chat.
- **Picks** (`/picks/*`) 🔒: CRUD, postmortem, live-progress, clv-stats.
- **Live** (`/games/:gamePk/*`): live, play-by-play, highlights-link.
- **Admin** (`/admin/*`) 👑: grant-credits, run-backtest, **shadow-model** (`?sport=mlb|nba`), **feature-store** (`?sport=mlb|nba&month=YYYY-MM`), db/tables, content/queue, parlay-synergy, **ml/status, ml/retrain, ml/retrain/ensemble, ml/retrain-log, ml/ensemble, ml/equity, ml/chat-picks-stats, picks/:id/ensemble-breakdown**.
- **Pagos** (`/nowpayments/*`): checkout, webhook IPN HMAC-SHA512.
- **Content API** (read-only, API key): `/content/v1/games`, `/board`, `/picks`, `/insights`, `/performance`.

Listado exhaustivo: [docs/architecture.md sección 6](docs/architecture.md#6-endpoints--vista-panorámica).

---

## Features destacadas

### Oracle multi-motor
[server/oracle.js](server/oracle.js) soporta tres motores seleccionables por request: `sonnet` (Claude Sonnet 4.6), `grok` (xAI), `dual` (ambos en paralelo con detección de divergencia). Modelos: Opus 4.7 (premium), Sonnet 4.6 (deep), Haiku 4.5 (content drafts). Detalle: [docs/ml-pipeline.md sección 2](docs/ml-pipeline.md#2-oracle--motor-llm-dual).

### Shadow validator + ML sidecar Python
[server/services/xgboostValidator.js](server/services/xgboostValidator.js) corre el validador MLB (pesos hardcodeados). NBA usa módulo aparte [server/services/nbaShadowValidator.js](server/services/nbaShadowValidator.js) — misma idea, features de basketball. Runs en `shadow_model_runs` con `sport`. Admin: `ShadowModeDashboard` con toggle MLB/NBA. En paralelo, [server/services/mlModelClient.js](server/services/mlModelClient.js) consulta al sidecar Python (`ml/`) con XGBoost entrenado solo en MLB por default (`ml/hexa_ml/data.py` filtra `sport='mlb'`). Detalle: [docs/ml-pipeline.md](docs/ml-pipeline.md).

### Closing Line Value (CLV)
Captura líneas iniciales y de cierre por pick. Stats en `/api/picks/clv-stats`.

### Feature store
Cada pick persiste sus features (Statcast, odds, clima, lineups) en tabla `pick_features` para backtesting y reentrenamiento.

### Parlay Synergy Engine
Motor combinatorial para parlays (correlación, ortogonalidad de riesgo, coherencia de game script). LLM como arquitecto-validador, no selector ciego. Admin-only en beta. Brief técnico: [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md).

### Content pipeline X
Genera drafts editoriales con Claude Haiku, los encola, y los publica en X (Twitter) vía OAuth 1.0a HMAC-SHA1. Detalle: [docs/content-pipeline.md](docs/content-pipeline.md).

### Admin ML Control Center (`/admin/ml-control`)
Dashboard único admin-only para operar el pipeline ML. Muestra el estado del sidecar Python en vivo (circuit breaker, latencia, ensemble), Brier/ROI/n_train por mercado, reliability diagrams, rolling 30d de accuracy legacy-vs-python, pesos aprendidos del ensemble meta-learner, y un audit log de retrains manuales. Permite disparar retrains por mercado o globales con un click — cada disparo se registra en `ml_retrain_log` con duración y métricas. Por cada pick de la historia, el admin ve un chip expandible (`AdminEnsembleBadge`) con la prob de Oracle/Legacy/Python/Ensemble + correctness ✓/✗ cuando el partido resolvió.

### Oracle Chat → Training pipeline
Los picks que el Oracle recomienda durante una sesión de chat se persisten automáticamente para alimentar el entrenamiento futuro. El extractor inyecta una instrucción interna que pide al Oracle terminar con `<<<HEXA_PICK_JSON>>>{...}<<<END>>>` cuando hay un pick concreto; si no aparece y la pregunta lo amerita, un Haiku fallback parsea la respuesta. Los picks se guardan con `source='oracle_chat'` y `chat_session_id` linkeado a `oracle_sessions` — están aislados del training default (`source='live'`) y son visibles en la sección "Chat-sourced picks" del Control Center. Opt-out por chat: checkbox "NO GUARDAR PARA ENTRENAMIENTO" o header `X-HEXA-Skip-Pick-Extract: 1`.

---

## Base de datos y migraciones

Las migraciones viven en [server/migrate.js](server/migrate.js) y se ejecutan automáticamente al arrancar el server. No hay herramienta externa (Knex / Prisma) — cada migración es una función SQL idempotente con `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE ADD COLUMN IF NOT EXISTS`.

Para un reset local:
```bash
dropdb hexadb && createdb hexadb
npm run dev   # reaplica todo
```

Schema completo: [docs/data-schema.md](docs/data-schema.md).

---

## Despliegue

- **API**: Railway con Nixpacks ([railway.json](railway.json)). Variables en Railway dashboard.
- **Cliente**: Vercel ([client/vercel.json](client/vercel.json)). Build de `client/`.
- **Postgres**: Railway addon o externo (Neon, Supabase) vía `DATABASE_URL`.

Detalle de deploy + rollback: [docs/admin-and-ops.md sección 10](docs/admin-and-ops.md#10-deployment).

---

## Estado del proyecto y próximos pasos

**Pipeline ML propio en producción** (Q2 2026): XGBoost entrenado con picks históricos resueltos, probabilidades calibradas con Platt, auto-retraining disponible vía `POST /retrain`, dashboard de calibración en `/admin/ml-calibration`.

Estado:
- ✅ **Sprint 0**: Documentación viva (este README + `/docs/` + CLAUDE.md).
- ✅ **Sprint 1**: Dataset completo — 22 columnas nuevas en `pick_features`, pickParser, pickPostgameEnricher, export-dataset.js, backfill de 620+ picks históricos.
- ✅ **Sprint 2**: Sidecar Python FastAPI + XGBoost real en `ml/`, desplegado en Railway como servicio separado (`hexa-ml`). Modelos activos: moneyline (Brier 0.205, ROI +18.3%), overunder (Brier 0.138, ROI +8.5%). URL: `https://hexa-ml-production.up.railway.app`.
- ✅ **Sprint 3**: Integración Node↔Python activa (`ML_SIDECAR_ENABLED=true` en prod) con circuit breaker y fallback al validator legacy. Dashboard `/admin/ml-calibration` operativo.
- ✅ **Sprint 4**: Ensemble meta-learner (LogReg sobre Oracle+Legacy+Python en logit space). Endpoints `/predict/ensemble` y `/calibration/ensemble`. Sólo se guarda artifact cuando supera a la mejor fuente individual.
- ✅ **Sprint 5 UI**: Admin ML Control Center en `/admin/ml-control` — HUD live, retrain on-demand por mercado/ensemble/all, per-pick ensemble breakdown badge, chat-picks bucket dashboard, retrain audit log (`ml_retrain_log`). Runline desbloqueado (`min_train_size=25`). Oracle Chat → Training pipeline (JSON tail + Haiku fallback, bucket `source='oracle_chat'`).
- ⏳ **Sprint 5 Player Props** (pendiente): training para hits / total_bases / strikeouts — requiere features per-batter en `savant-fetcher.js`. Banner "coming soon" en el Control Center.
- ✅ **Sprint 7 NBA (7a–7d)**: Oracle NBA, endpoints `/api/nba/*`, resolver automático post-game, sport switcher en UI. Feature-flagged `NBA_ANALYSIS_ENABLED`. MVP funcional, pendiente apertura pública (Sprint 6 hardening primero).

### Estado NBA MVP (2026-05-15)

Sprint 7 completado en su mayor parte:

- ✅ **7a** — `nba-api.js`, `nba-context-builder.js`, columna `sport` en `picks`/`pick_features`, endpoints públicos `/api/nba/games` y `/api/nba/teams`.
- ✅ **7b** — Oracle NBA (`oracleNba.js` + `oracle-nba-prompts.js`). Guardrail anti-hallucination. Validado end-to-end.
- ✅ **7c** — `POST /api/nba/analyze/game` (admin, feature-flagged). Pick persistence con `sport='nba'`.
- ✅ **7c2** — `pick-resolver-nba.js`: resolución automática post-game cada 30 min.
- ✅ **7d** — UI sport switcher: `SportSwitcher.jsx`, `GameSelector` y `AnalysisPanel` con prop `sport`. Fetch y normalización de juegos NBA. Controles MLB-específicos ocultos en modo NBA.
- ✅ **7.0 hotfix (aislamiento)** — historial y lifecycle separados por `sport`:
  - `GET /api/picks?sport=mlb|nba` para historial/stats aislados
  - `HistoryPanel` + `useHistory` filtrados por deporte
  - resolver/tracking MLB ignora picks NBA pendientes
- ✅ **7.0 hotfix (SAFE/props)** — SAFE bloqueado en NBA y Player Props NBA rechazado server-side.
- ✅ **Sprint 7.0 hardening** — injuries/status + odds server-side + context_meta:
  - `nba-api.js`: `getNbaLeagueInjuries()` vía ESPN con stale-cache fallback
  - `nba-odds.js`: módulo NBA aislado (nunca toca frozen `odds-api.js`), dual-key fallback, fuzzy team matching
  - `nba-context-builder.js`: bloque de injuries por equipo, `context_meta` (completeness, staleFlags, sources)
  - `oracleNba.js`: `describeInjuriesBlock` en el contexto serializado, `DATA QUALITY` footer
  - `routes/nba.js`: `resolveMarketOdds` client→server fallback, `meta.oddsSource` + `meta.context_meta` en respuesta
  - `NbaContextMetaBadge.jsx`: panel admin-only (completeness%, oddsSource, injuries, stale flags)
  - `scripts/smoke/nba-release-smoke.js` + `npm run smoke:nba`
- ✅ **7.1 dataset + shadow aislados** (2026-05-15):
  - APIs admin `?sport=mlb|nba` en feature-store y shadow-model
  - `nbaShadowValidator.js` + `nbaShadowPersistence.js` en flujo analyze NBA
  - Migración 7.1: `shadow_model_runs.sport` + columnas NBA en `pick_features`
  - UI admin: toggles MLB/NBA en `DatasetDashboardV2` y `ShadowModeDashboard`
- ⏳ **7e** — NBA ML sidecar: condicional, post ~500 picks NBA resueltos.

### Próximas fases — hardening

**Sprint 6 — Pre-lanzamiento público NBA (Q3 2026)**:

- **Sprint 6a — Equity curve + Sharpe + drawdown dashboard**: curva de equity por usuario, drawdown, Sharpe rolling 30d. Datos ya existen en `picks` + `bankroll`. Sin esto Hexa no demuestra valor como sistema de bankroll, solo como generador de picks sueltos.
- **Sprint 6b — Persistencia de modelos ML vía Railway Volumes**: `ml/hexa_ml/config.py` usa `artifacts/` relativo → efímero en Railway. Cada redeploy borra los `.pkl`. Apuntar a `/data` (volume montado) cierra esa ventana.

### Matriz de calidad por deporte (operativa)

Escala de referencia: 0-10 por criterio. Para apertura publica de un deporte: score global >= 8.5 y ningun criterio critico < 8.

| Criterio | MLB (actual) | NBA (actual) | Gate minimo |
|---|---:|---:|---:|
| Data depth pregame (features contextuales) | 9.5 | 6.5 | 8.0 |
| Data quality live (latencia + disponibilidad) | 8.5 | 7.0 | 8.0 |
| Lineup/Injury verification estructurada | 9.0 | 7.0 | 8.0 |
| Market coverage soportada por data real | 9.0 | 6.0 | 8.0 |
| Guardrails LLM (schema + fallbacks + policy) | 8.5 | 7.5 | 8.0 |
| Pick lifecycle (tracking -> resolver -> postmortem) | 9.0 | 7.5 | 8.0 |
| Calibration/ROI observables por mercado | 8.5 | 6.0 | 8.0 |
| Isolation por deporte (sin contaminacion cruzada) | 8.5 | 8.0 | 8.5 |

#### Criterios de go-live NBA

- SAFE PICK NBA aislado de endpoints MLB. ✅
- Player Props NBA deshabilitado hasta tener dataset y resolver dedicados. ✅
- Historial/jobs/resolver/UX/dataset/shadow aislados por `sport`. ✅ en código (Sprint 7.0 + 7.1)
- Contexto NBA con injuries/status + odds server-side + metadata de completitud. ✅

Backlog priorizado completo: [docs/roadmap.md](docs/roadmap.md).

---

## Convenciones de contribución

- **Branch main protegida** — trabajar siempre en feature branches y abrir PR.
- Mensajes de commit estilo convencional (`feat:`, `fix:`, `chore:`, etc.).
- **No commitear `.env`** ni credenciales — solo `.env.example`.
- **ESM únicamente**: imports con extensión `.js` explícita.
- Cambios que tocan prompts del LLM deberían pasar por `npm run audit` y validarse contra backtest antes de merge.
- **Frozen files** (no modificar sin permiso explícito): `oracle.js`, `context-builder.js`, `market-intelligence.js`, `xgboostValidator.js`, `parlayEngine/*`. Ver [CLAUDE.md](CLAUDE.md) para lista completa y patrones para extender sin tocar.

---

## Licencia

Privado. Todos los derechos reservados.
