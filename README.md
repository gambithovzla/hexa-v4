# H.E.X.A. v4

**H.E.X.A.** (Heuristic Evaluation & eXpert Analytics) es una plataforma de análisis predictivo de **MLB, NBA y NFL** que combina modelos de lenguaje (Claude y Grok/xAI), estadísticas avanzadas (Statcast/Savant para MLB; ratings avanzados + pace + rest para NBA; EPA, success rate, PROE para NFL), líneas en tiempo real y un pipeline ML propio (XGBoost + ensemble) para producir picks, parlays, análisis "safe", contenido editorial y el modo "Pick Imperdible".

Monorepo: API Node/Express + Postgres · cliente React/Vite · sidecar Python FastAPI+XGBoost.

```
┌────────────────────────┐        ┌─────────────────────────┐        ┌─────────────────────────┐
│  client/  (React+Vite) │◄──────►│  server/  (Express API) │◄──────►│  ml/  (FastAPI+XGBoost) │
│  MUI · Recharts · PWA  │  HTTP  │  Node 20 · ESM modules  │  HTTP  │  Python 3.11 · Railway  │
└────────────────────────┘        └───────────┬─────────────┘        └─────────────────────────┘
                                              │
        ┌──────────────┬──────────┬───────────┼────────────┬──────────────┬──────────┐
        ▼              ▼          ▼           ▼            ▼              ▼          ▼
   PostgreSQL    Anthropic API  xAI (Grok)  MLB Stats    NBA/NFL       Odds API   Resend
   (pg pool)     (Claude 4.x)  grok-4-fast  + Savant     ESPN API      dual-key   (email)
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
| [docs/nfl-roadmap.md](docs/nfl-roadmap.md) | Roadmap Sprint 9 por sub-sprint (9a–9e completados) |
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

- **Públicos**: `/games`, `/teams`, `/odds/today`, `/hexa/board`, `/nba/games`, `/nba/teams`, `/nfl/games`, `/nfl/teams`, `/nfl/standings`.
- **Auth** (`/auth/*`): register, login, me, verify-email, forgot-password.
- **Análisis MLB** (`/analyze/*`) 🔒: game, parlay, safe, parlay-synergy (👑 beta).
- **Análisis NBA** (`/nba/analyze/*`) 👑 (feature-flagged): game, chat.
- **Análisis NFL** (`/nfl/analyze/*`) 👑 (feature-flagged `NFL_ANALYSIS_ENABLED`): game, chat.
- **Picks** (`/picks/*`) 🔒: CRUD, postmortem, live-progress, clv-stats.
- **MLB Player Props** (`/mlb/props/board`) 🔒: Odds API + Savant + ML scores admin.
- **Admin** (`/admin/*`) 👑: shadow-model (`?sport=mlb|nba|nfl`), feature-store, ml/status, ml/retrain, ml/ensemble, db/tables, content/queue, imperdible.
- **Pagos** (`/nowpayments/*`): checkout + IPN HMAC-SHA512.
- **Content API** (API key pública): `/content/v1/games`, `/board`, `/picks`, `/performance`.

---

## Features destacadas

### Oracle multi-motor (MLB/NBA/NFL)
- **MLB**: [oracle.js](server/oracle.js) — dual Claude + Grok, contexto rico con Statcast/Savant (rolling wOBA, CSW%, bat speed, umpire, bullpen ERA/WHIP individual, schedule fatigue). FROZEN.
- **NBA**: [services/oracleNba.js](server/services/oracleNba.js) — Anthropic-only, net/off/def rating, pace, TS%, rest, injuries ESPN. Cap 68%.
- **NFL**: [services/oracleNfl.js](server/services/oracleNfl.js) — Anthropic-only, EPA, success rate, PROE, QB status, rest/short-week/off-bye, weather (no-dome), spread primario con key numbers 3/7. Cap 72%.

### Pipeline ML propio (XGBoost + ensemble)
Sidecar Python en `ml/` — desplegado en Railway como servicio independiente.
- **Mercados MLB activos**: moneyline (Brier 0.205, ROI +18.3%), overunder (Brier 0.138, ROI +8.5%), runline, prop.
- **Mercados NFL scaffoldeados**: `nfl_moneyline`, `nfl_spread`, `nfl_total` — modelos listos para entrenar cuando haya picks resueltos (temporada sept 2026).
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

### MLB Player Props (`/props`)
Líneas Odds API + enriquecimiento Savant + edge vs implied. Picks Oracle guardados antes de que existan líneas en el mercado. Parser en español (`Bajo 4.5 Ponches`). ML scores gateados por `MLB_PROPS_ML_PUBLIC_ENABLED`.

### Oracle Chat → Training pipeline
Picks recomendados en chat se persisten con `source='oracle_chat'` (aislados del training default `source='live'`). JSON tail + Haiku fallback. Panel "Chat-sourced picks" en `/admin/ml-control`. Opt-out: header `X-HEXA-Skip-Pick-Extract: 1`.

### Content pipeline X
Drafts editoriales con Claude Haiku, cola editorial, publicación vía OAuth 1.0a HMAC-SHA1. Detalle: [docs/content-pipeline.md](docs/content-pipeline.md).

---

## Estado del proyecto (2026-05-30)

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
- ✅ **Sprint 9 NFL completo** (PRs #373–#378, 2026-05-30):
  - **9a**: `nfl-api.js`, `nfl-team-map.js`, `nfl-context-builder.js`, `nfl-odds.js`, migraciones DB, endpoints `GET /api/nfl/games|teams|standings`.
  - **9b**: `oracleNfl.js` + `oracle-nfl-prompts.js` + `nflOutputGuard.js`. Cap 72%, key numbers 3/7, QB gate, guardrail anti-hallucination.
  - **9c**: `routes/nfl.js` (`POST /api/nfl/analyze/game|chat`), `pick-resolver-nfl.js`, job game-time-aware Thu/Sun/Mon.
  - **9.1**: `nflShadowValidator.js` + `nflShadowPersistence.js` — dataset/shadow con `sport='nfl'`.
  - **9.2**: `pick-tracker-nfl.js` + `NflLiveTracker.jsx` — SSE per-game, drives + plays + win probability.
  - **9d**: `GameSelector` + `AnalysisPanel` + `HexaBoard` extendidos a NFL; `nflLogoUrl.js`; `sports.js` con `ACTIVE_SPORTS=['mlb','nba','nfl']`.
  - **9e**: `nflMlClient.js` (circuit breaker propio) + modelos `nfl_moneyline`/`nfl_spread`/`nfl_total` en sidecar Python.

### Estado en producción

- Sidecar ML: `https://hexa-ml-production.up.railway.app`
- Modelos activos MLB: **moneyline** (Brier 0.205) · **overunder** (Brier 0.138) · **runline** (early model) · **prop** (gateado)
- Modelos NFL: scaffolded — entrenan con temporada real sept 2026
- Reentrenamiento automático: `.github/workflows/retrain-weekly.yml` (domingos 06:00 UTC)
- Variables Railway hexa-v4: `NIXPACKS_NODE_VERSION=20` · `ML_SIDECAR_ENABLED=true` · `NFL_ANALYSIS_ENABLED=true`

### Pendiente operacional (no requiere sprint de código)

- Props ML gate: ≥50 props resueltos → retrain `prop` model → `MLB_PROPS_ML_PUBLIC_ENABLED=1`.
- NBA validación E2E en prod con tráfico real.
- Parlay beta pública: `PARLAY_SYNERGY_ENABLED=true` cuando hit rate validado.
- NFL sept 2026: `hexaNflBoardService`, picks reales → entrenar modelos NFL.

### Matriz de calidad por deporte

| Criterio | MLB | NBA | NFL | Gate |
|---|---:|---:|---:|---:|
| Data depth pregame | 9.5 | 6.5 | 6.0 | 8.0 |
| Data quality live | 8.5 | 7.0 | 6.5 | 8.0 |
| Lineup/Injury verification | 9.0 | 7.0 | 7.0 | 8.0 |
| Market coverage | 9.0 | 6.0 | 7.0 | 8.0 |
| Guardrails LLM | 8.5 | 7.5 | 8.0 | 8.0 |
| Pick lifecycle | 9.0 | 7.5 | 7.0 | 8.0 |
| Calibration/ROI observables | 8.5 | 6.0 | n/a | 8.0 |
| Isolation por deporte | 8.5 | 8.0 | 8.0 | 8.5 |

NFL: código completo, datos y calibración pendientes de temporada real.

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
