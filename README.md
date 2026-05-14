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
├── scripts/
│   ├── system-audit.js
│   └── training/           run-backtest, historical-fetcher
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
- **Admin** (`/admin/*`) 👑: grant-credits, run-backtest, shadow-model, feature-store, db/tables, content/queue, parlay-synergy.
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

**Pipeline ML propio completado** (Q2 2026): XGBoost entrenado con picks históricos + ensemble meta-learner que combina Claude + validador + Python. Probabilidades calibradas (Platt), auto-retraining semanal vía GitHub Actions, dashboard de calibración en `/admin/ml-calibration`.

Estado:
- ✅ **Sprint 0**: Documentación viva (este README + `/docs/` + CLAUDE.md).
- ✅ **Sprint 1**: Dataset completo — 22 columnas nuevas en `pick_features`, pickParser, pickPostgameEnricher, export-dataset.js.
- ✅ **Sprint 2**: Sidecar Python FastAPI + XGBoost real en `ml/`. Pendiente de deploy en Railway.
- ✅ **Sprint 3**: Integración Node↔Python (circuit breaker, mlModelClient), dashboard `/admin/ml-calibration`.
- ✅ **Sprint 4**: Ensemble meta-learner (LogReg oracle+legacy+python), `/admin/ml-ensemble-calibration`.

**Para activar**: crear servicio Railway apuntando a `ml/`, setear `ML_SIDECAR_ENABLED=true` + `HEXA_ML_API_URL` + `HEXA_ML_INTERNAL_TOKEN` en el server Node, correr `POST /retrain`.

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
