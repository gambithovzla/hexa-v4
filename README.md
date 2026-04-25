# H.E.X.A. v4

**H.E.X.A.** (Heuristic Evaluation & eXpert Analytics) es una plataforma de análisis predictivo de MLB que combina modelos de lenguaje (Claude y Grok/xAI), estadísticas avanzadas (Statcast / Baseball Savant), líneas de casas de apuestas en tiempo real y un validador tabular propio (XGBoost) para producir picks, parlays, análisis "safe" y contenido editorial.

Este repositorio contiene el monorepo completo: API en Node/Express + Postgres y cliente React/Vite.

---

## Tabla de contenido

- [Arquitectura](#arquitectura)
- [Stack técnico](#stack-técnico)
- [Estructura del repo](#estructura-del-repo)
- [Requisitos previos](#requisitos-previos)
- [Setup local](#setup-local)
- [Variables de entorno](#variables-de-entorno)
- [Scripts disponibles](#scripts-disponibles)
- [Endpoints principales](#endpoints-principales)
- [Features destacadas](#features-destacadas)
- [Base de datos y migraciones](#base-de-datos-y-migraciones)
- [Despliegue](#despliegue)
- [Operación y observabilidad](#operación-y-observabilidad)
- [Convenciones de contribución](#convenciones-de-contribución)

---

## Arquitectura

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

El servidor orquesta cuatro flujos críticos:

1. **Oracle** — construye contexto por partido (Statcast, clima, lineups, odds) y lo manda a Claude y/o Grok.
2. **Pick lifecycle** — parseo, guardado, tracking en vivo, resolución automática al final del juego y postmortem por LLM.
3. **Shadow model** — corre un validador XGBoost en paralelo al LLM para medir divergencias (observabilidad de modelo).
4. **Content pipeline** — genera borradores editoriales en español/inglés, los encola y publica en X (OAuth 1.0a).

---

## Stack técnico

### Backend ([server/](server/))
- **Runtime**: Node.js 20 (ESM, `"type": "module"`)
- **HTTP**: Express 4 + Helmet + CORS + express-rate-limit
- **DB**: PostgreSQL vía `pg` (pool)
- **Auth**: JWT (`jsonwebtoken`) + bcryptjs, middleware en [server/middleware/auth-middleware.js](server/middleware/auth-middleware.js)
- **LLMs**: `@anthropic-ai/sdk` (Claude Opus/Sonnet/Haiku 4.x) + cliente xAI propio en [server/services/xaiClient.js](server/services/xaiClient.js)
- **Email**: Resend
- **Monetización**: webhooks de Buy Me a Coffee ([server/bmc-webhook.js](server/bmc-webhook.js)) y Lemon Squeezy ([server/lemon.js](server/lemon.js))

### Frontend ([client/](client/))
- **Framework**: React 18 + Vite 5
- **UI**: MUI 6, Emotion, Framer Motion, Recharts
- **PWA**: `vite-plugin-pwa`
- Páginas principales: [DevUIShowcase.jsx](client/src/pages/DevUIShowcase.jsx), [PerformanceDashboard.jsx](client/src/pages/PerformanceDashboard.jsx)

---

## Estructura del repo

```
hexa-v4/
├── client/                    React + Vite SPA
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── store/
│   │   ├── i18n/
│   │   ├── palettes/ · themeProvider.jsx · theme.js
│   │   └── App.jsx · main.jsx
│   └── vite.config.js · vercel.json
│
├── server/
│   ├── index.js               entrypoint Express (boot, rate limits, rutas inline)
│   ├── oracle.js              motor de prompts LLM (Claude + Grok + dual)
│   ├── context-builder.js     arma el payload por partido
│   ├── mlb-api.js             wrapper MLB Stats API
│   ├── savant-fetcher.js      cache Statcast
│   ├── odds-api.js            líneas + implied probability
│   ├── weather-api.js         clima de estadio
│   ├── live-feed.js           play-by-play y progress tracking
│   ├── pick-resolver.js       resolución automática post-game
│   ├── pick-postmortem.js     análisis retrospectivo por LLM
│   ├── pick-tracker.js        progreso de picks en vivo
│   ├── closing-line-capture.js captura CLV al cerrar líneas
│   ├── line-movement.js       snapshots de movimiento de odds
│   ├── feature-store.js       persistencia de features por pick
│   ├── shadow-model.js        runner del XGBoost validator
│   ├── market-intelligence.js value breakdown determinístico
│   ├── oracle-memory.js       caché de sesiones Oracle
│   ├── auth.js                signup/login/bankroll
│   ├── migrate.js             migraciones SQL embebidas
│   ├── db.js                  pool Postgres
│   ├── email.js · resend
│   ├── bmc-webhook.js · lemon.js
│   ├── middleware/
│   │   ├── auth-middleware.js (verifyToken · requireVerifiedEmail · isAdmin)
│   │   └── content-api-key.js (API key para consumidores externos read-only)
│   ├── routes/
│   │   ├── picks.js           CRUD picks
│   │   ├── oracle-history.js  sesiones de análisis
│   │   ├── insights.js        stats agregadas
│   │   ├── content.js         Content API pública (read-only)
│   │   ├── content-admin.js   cola editorial interna
│   │   └── content-dto.js     transformaciones
│   ├── services/
│   │   ├── xaiClient.js       cliente xAI/Grok
│   │   ├── xgboostValidator.js validador tabular local
│   │   ├── hexaBoardService.js Hexa Board (tablero diario)
│   │   ├── hexaSmartSignalsService.js señales
│   │   ├── contentDraftService.js · contentQueueService.js · xPublisher.js
│   │   ├── public-stats.js    stats públicos para Content API
│   │   └── hexaThresholds.json umbrales tunables
│   └── prompts/
│       └── x-content-prompts.js
│
├── scripts/
│   ├── system-audit.js        `npm run audit`
│   ├── backup.js
│   └── training/
│       ├── historical-fetcher.js
│       └── run-backtest.js
│
├── .env.example               (ver sección de variables)
├── package.json               scripts raíz (dev, dev:all, audit)
├── railway.json               config Railway (Nixpacks)
└── README.md
```

---

## Requisitos previos

- **Node.js 20+** (el repo usa ESM y `node --watch`)
- **PostgreSQL 14+**
- Cuentas/API keys:
  - Anthropic (`ANTHROPIC_API_KEY`) — obligatoria
  - xAI (`XAI_API_KEY`) — opcional, requerida solo para modo Grok / Dual
  - Resend — si activas email verificado
  - X / Twitter — si activas publicación automática

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
createdb hexadb     # o equivalente en tu setup

# 5. Correr migraciones (automático al iniciar el server)
npm run dev         # arranca API en :3001 y aplica migraciones

# 6. En otra terminal: cliente
npm run client      # Vite dev server

# O todo junto (concurrently)
npm run dev:all
```

---

## Variables de entorno

Ver [.env.example](.env.example) para la lista completa. Resumen:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ANTHROPIC_API_KEY` | Sí | Key de Anthropic para Claude |
| `DATABASE_URL` | Sí | Connection string Postgres |
| `JWT_SECRET` | Sí | Secreto para firmar tokens (cambiar en prod) |
| `ODDS_API_KEY` | Si para cuotas reales | Key de The Odds API para moneyline/runline/totales MLB |
| `ODDS_API_BACKUP_KEY` | No | Key secundaria de The Odds API; se usa si la principal queda sin créditos |
| `PORT` | No | Puerto del server (default `3001`) |
| `NODE_ENV` | No | `development` / `production` |
| `XAI_API_KEY` | No | Key xAI para modos Grok / Dual |
| `XAI_ORACLE_MODEL` | No | Override modelo Grok (default `grok-4-fast-reasoning`) |
| `XAI_SAFE_MODEL` | No | Override modelo Grok para modo safe |
| `CONTENT_DRAFT_MODEL` | No | Modelo usado para borradores de contenido (default Haiku) |
| `CONTENT_API_KEYS` | No | `label:secret,label2:secret2` para Content API pública |
| `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | No | OAuth 1.0a para publicar en X |
| `X_AUTO_PUBLISH_ENABLED` | No | `0`/`1` — habilita worker de publicación |
| `X_AUTO_PUBLISH_INTERVAL_MINUTES` | No | Intervalo del worker (default `5`) |
| `SHADOW_MODE_ENABLED` | No | Activa el shadow validator |
| `SHADOW_MODE_MODEL_KEY` / `SHADOW_MODE_MODEL_VERSION` | No | Metadata del modelo sombra |

---

## Scripts disponibles

Desde la raíz ([package.json](package.json)):

| Script | Descripción |
|---|---|
| `npm run dev` | API con `node --watch` (recarga en cambios) |
| `npm start` | API en modo producción |
| `npm run client` | Dev server de Vite (`client/`) |
| `npm run dev:all` | API + cliente en paralelo (`concurrently`) |
| `npm run audit` | Ejecuta [scripts/system-audit.js](scripts/system-audit.js) |

Desde `client/`:

| Script | Descripción |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Build de producción |
| `npm run preview` | Preview del build |

---

## Endpoints principales

Todos bajo `/api`. Los marcados con 🔒 requieren JWT; los marcados con 👑 requieren rol admin.

### Datos públicos
- `GET /api/games` — partidos del día
- `GET /api/teams` — catálogo de equipos
- `GET /api/odds/today` — odds agregadas
- `GET /api/hexa/board` — tablero Hexa (picks sugeridos del día)
- `GET /api/savant/status` — estado del caché Statcast
- `GET /api/settings/performance-public` — stats públicos de performance

### Análisis (Oracle) 🔒
- `POST /api/analyze/game` — análisis por partido (modes: `deep`, `safe`, `parlay`)
- `POST /api/analyze/parlay` — análisis de parlay
- `POST /api/analyze/safe` — modo conservador
- `POST /api/analyze/chat` 👑 — chat libre con Oracle
- `POST /api/analyze/chat-jornada` 👑 — chat para jornada completa
- `POST /api/analyze/batch` 👑 — batch de partidos
- `GET /api/games/:gameId/context` 🔒 — payload completo de contexto

### Picks 🔒 (ver [server/routes/picks.js](server/routes/picks.js))
- `POST /api/picks` — registrar pick
- `GET /api/picks` — listar
- `DELETE /api/picks/:id`
- `POST /api/picks/:id/postmortem` — genera postmortem por LLM
- `GET /api/picks/resolve` · `POST /api/picks/resolve-game` — resolución
- `POST /api/picks/live-progress` — progreso en vivo
- `GET /api/picks/clv-stats` — closing line value

### Live feed
- `GET /api/games/:gamePk/live`
- `GET /api/games/:gamePk/play-by-play`
- `POST /api/games/live`
- `GET /api/games/:gamePk/highlights-link`

### Admin 👑
- `POST /api/admin/grant-credits`
- `GET /api/admin/backtest-stats` · `GET /api/admin/historical-games` · `POST /api/admin/run-backtest`
- `GET /api/admin/shadow-model` · `GET /api/admin/feature-store` · `POST /api/admin/feature-store/backfill`
- `POST /api/savant/refresh`

### Content API (API key, read-only)
Ver [server/routes/content.js](server/routes/content.js) y [server/middleware/content-api-key.js](server/middleware/content-api-key.js). Pensado para consumidores externos (social media, bots).

### Webhooks
- `POST /api/bmc/webhook` — Buy Me a Coffee
- Rutas de Lemon Squeezy montadas desde [server/lemon.js](server/lemon.js)

---

## Features destacadas

### Oracle multi-motor
[server/oracle.js](server/oracle.js) soporta tres motores seleccionables por request:
- `sonnet` — Claude Sonnet 4.6 (default)
- `grok` — xAI `grok-4-fast-reasoning`
- `dual` — ejecuta ambos en paralelo y mergea

Modelos configurables: Opus 4.7 (premium), Sonnet 4.6 (deep), Haiku 4.5 (content drafts).

### Shadow model
[server/shadow-model.js](server/shadow-model.js) + [server/services/xgboostValidator.js](server/services/xgboostValidator.js) corren un validador tabular en paralelo al LLM para detectar divergencias. Dashboard admin en `/api/admin/shadow-model`.

### Closing Line Value (CLV)
[server/closing-line-capture.js](server/closing-line-capture.js) captura la línea de cierre y permite medir el EV de cada pick vs. mercado. Stats en `/api/picks/clv-stats`.

### Feature store
[server/feature-store.js](server/feature-store.js) persiste el snapshot de features (Statcast, odds, clima, lineups) de cada pick para backtesting y reentrenamiento del modelo sombra.

### Content pipeline para X
- [server/services/contentDraftService.js](server/services/contentDraftService.js) — drafts con Haiku
- [server/services/contentQueueService.js](server/services/contentQueueService.js) — cola editorial
- [server/services/xPublisher.js](server/services/xPublisher.js) — publicación OAuth 1.0a
- Worker opcional (`X_AUTO_PUBLISH_ENABLED=1`)

---

## Base de datos y migraciones

Las migraciones viven en [server/migrate.js](server/migrate.js) y se ejecutan automáticamente al arrancar el server. No hay herramienta externa (knex / prisma) — cada migración es una función SQL idempotente.

Para un reset local:
```bash
dropdb hexadb && createdb hexadb
npm run dev   # reaplica todo
```

---

## Despliegue

### API (Railway)
- Config en [railway.json](railway.json) — builder Nixpacks, start command `node index.js`, restart on failure.
- Variables de entorno: las mismas de `.env.example`.
- Postgres: addon de Railway o externo (Supabase, Neon, etc.) vía `DATABASE_URL`.

### Cliente (Vercel)
- Config en [client/vercel.json](client/vercel.json).
- Build: `npm run build` desde `client/`.
- Asegurar que el cliente apunte a la URL pública de la API.

---

## Operación y observabilidad

- **Rate limiting**: todas las rutas de análisis pasan por `analysisLimiter` (express-rate-limit).
- **Safe errors**: en producción nunca se filtra el stack — helper `safeError()` en [server/index.js](server/index.js).
- **Helmet**: cabeceras de seguridad activas por defecto.
- **Email verification**: `requireVerifiedEmail` en endpoints sensibles (crear pick, etc.).
- **Audit**: `npm run audit` ejecuta un diagnóstico del sistema.
- **Backfill histórico**: [scripts/training/historical-fetcher.js](scripts/training/historical-fetcher.js) + [scripts/training/run-backtest.js](scripts/training/run-backtest.js) para reentrenar / validar.

---

## Convenciones de contribución

- **Branch main protegida** — trabajar siempre en feature branches y abrir PR.
- Mensajes de commit estilo convencional (`feat:`, `fix:`, `chore:`, etc.) — ver `git log`.
- **No commitear `.env`** ni credenciales — solo `.env.example`.
- **ESM únicamente**: imports con extensión `.js` explícita.
- Cambios que tocan prompts del LLM deberían pasar por `npm run audit` y validarse contra backtest antes de merge.

---

## Licencia

Privado. Todos los derechos reservados.
