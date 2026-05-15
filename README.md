# H.E.X.A. v4

**H.E.X.A.** (Heuristic Evaluation & eXpert Analytics) es una plataforma de análisis predictivo de MLB que combina modelos de lenguaje (Claude y Grok/xAI), estadísticas avanzadas (Statcast / Baseball Savant), líneas de casas de apuestas en tiempo real y un validador tabular propio para producir picks, parlays, análisis "safe" y contenido editorial.

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
| `npm run test:parlay` | Tests del Parlay Synergy Engine |

Desde `client/`:

| Script | Descripción |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Build de producción |
| `npm run preview` | Preview del build |

---

## Estructura del repo

```
hexa-v4/
├── client/                 React + Vite SPA (MUI, Framer Motion, Recharts, PWA)
├── server/                 Node 20 ESM + Express
│   ├── index.js            entrypoint (rutas, jobs, rate limits)
│   ├── oracle.js           motor LLM dual (Claude + Grok)
│   ├── context-builder.js  arma payload por partido
│   ├── feature-store.js    persistencia de features para training
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

- **Públicos**: `/games`, `/teams`, `/odds/today`, `/hexa/board`.
- **Auth** (`/auth/*`): register, login, me, verify-email, forgot-password.
- **Análisis** (`/analyze/*`) 🔒: game, parlay, safe, parlay-synergy (👑 beta).
- **Picks** (`/picks/*`) 🔒: CRUD, postmortem, live-progress, clv-stats.
- **Live** (`/games/:gamePk/*`): live, play-by-play, highlights-link.
- **Admin** (`/admin/*`) 👑: grant-credits, run-backtest, shadow-model, feature-store, db/tables, content/queue, parlay-synergy, **ml/status, ml/retrain, ml/retrain/ensemble, ml/retrain-log, ml/ensemble, ml/chat-picks-stats, picks/:id/ensemble-breakdown**.
- **Pagos** (`/nowpayments/*`): checkout, webhook IPN HMAC-SHA512.
- **Content API** (read-only, API key): `/content/v1/games`, `/board`, `/picks`, `/insights`, `/performance`.

Listado exhaustivo: [docs/architecture.md sección 6](docs/architecture.md#6-endpoints--vista-panorámica).

---

## Features destacadas

### Oracle multi-motor
[server/oracle.js](server/oracle.js) soporta tres motores seleccionables por request: `sonnet` (Claude Sonnet 4.6), `grok` (xAI), `dual` (ambos en paralelo con detección de divergencia). Modelos: Opus 4.7 (premium), Sonnet 4.6 (deep), Haiku 4.5 (content drafts). Detalle: [docs/ml-pipeline.md sección 2](docs/ml-pipeline.md#2-oracle--motor-llm-dual).

### Shadow validator + ML sidecar Python
[server/services/xgboostValidator.js](server/services/xgboostValidator.js) corre un validador tabular determinístico (pesos hardcodeados) para observabilidad. En paralelo, [server/services/mlModelClient.js](server/services/mlModelClient.js) consulta al sidecar Python (`ml/`) que corre XGBoost real entrenado con los picks históricos. El sidecar es fire-and-forget: si falla, el circuito se abre y el pick se crea igual. Detalle: [docs/ml-pipeline.md](docs/ml-pipeline.md).

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

### Próximas fases — hardening + expansión NBA

**Sprint 6 — Pre-NBA hardening (Q3 2026, ~6 semanas)** — dos heridas abiertas que rompen la propuesta de valor antes de duplicar superficie con NBA:

- **Sprint 6a — Equity curve + Sharpe + drawdown dashboard** (~2 semanas). Curva de equity por usuario, drawdown peak-to-trough, Sharpe rolling 30d, ROI por mes. Datos ya existen en `picks` + `bankroll`. Sin esto, Hexa parece un juguete de picks sueltos en vez de un sistema de bankroll.
- **Sprint 6b — Persistencia de modelos ML vía Railway Volumes** (~1-2 semanas). Hoy `ml/hexa_ml/config.py` apunta a `artifacts/` (relativo) y Railway tiene filesystem efímero: cada redeploy del sidecar wipea los `.pkl`. Resultado: hasta el siguiente retrain, los picks caen al fallback legacy. Apuntar `artifacts_dir` a `/data` (volume montado) cierra esa ventana.

**Sprint 7 — Expansión NBA (Q4 2026 → Q1 2027, ~10-14 semanas)** — segundo deporte, no más MLB. Target: MVP listo para el **All-Star Break del 15-17 feb 2027**.

Justificación: MLB tiene ~6 meses muertos (nov–mar). NBA es oct–abr ⇒ cobertura year-round. La arquitectura ya es deporte-agnóstica (oracle.js, pick lifecycle, sidecar Python, Parlay Synergy). Lo MLB-específico vive en 4 archivos reemplazables: `mlb-api.js`, `savant-fetcher.js`, `context-builder.js`, `pick-resolver.js`.

Sub-sprints:
- **7a** scaffolding datos (`nba-api.js`, `nba-context-builder.js`, tabla `nba_games`, columna `sport` en `picks`/`pick_features`).
- **7b** Oracle NBA + prompts adaptados (adapter `oracleNba.js`, **sin tocar oracle.js**).
- **7c** pick lifecycle NBA (resolver, tracker, postmortem adaptado).
- **7d** UI con sport switcher (bottom nav MLB/NBA, reutilizar `HexaBoard` / `AnalysisPanel` / `PickCard`).
- **7e** NBA ML sidecar (condicional, post ~500 picks NBA resueltos).

**Sprints 6 y 7 corren en paralelo**, no en serie — Sprint 7a no toca código MLB. Si esperamos a cerrar Sprint 6 antes de empezar NBA, perdemos la ventana de feb 2027.

Backlog priorizado completo + sub-sprint detalle: [docs/roadmap.md](docs/roadmap.md).

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
