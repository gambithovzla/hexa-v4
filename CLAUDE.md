# CLAUDE.md — Guía para Claude Code en H.E.X.A. v4

Este archivo se lee automáticamente al inicio de cada sesión. **Antes de tocar código, leelo entero.** Después, abrir el archivo relevante en `docs/` para profundidad.

---

## TL;DR del proyecto

H.E.X.A. v4 es una plataforma de **análisis predictivo de MLB**:

- Motor LLM dual (Claude + Grok) que genera picks con contexto rico (Statcast, weather, park factors, lineups, line movement).
- Pick lifecycle: create → tracking en vivo → resolución automática post-game → postmortem por LLM.
- Pipeline de contenido editorial a X (Twitter) con OAuth 1.0a.
- Monetización con cripto vía NowPayments.
- Frontend React 18 + Vite + MUI con PWA.
- Deploy: Railway (server) + Vercel (client).

Cubertura completa en [docs/architecture.md](docs/architecture.md).

---

## Estructura

```
hexa-v4/
├── server/        # Node 20 ESM, Express 4, Postgres
├── client/        # React 18, Vite, MUI, PWA
├── scripts/       # audit, training, backup
├── ml/            # microservicio Python ML (FastAPI + XGBoost, deploy separado en Railway)
├── docs/          # documentación viva por tema
├── .env.example   # todas las env vars con comentarios
├── railway.json   # config deploy server
└── README.md      # setup + índice a docs/
```

---

## Stack — lo que NO es obvio del package.json

- **No TypeScript.** ES modules puros (`"type": "module"` en `package.json`). Imports siempre con extensión `.js` explícita.
- **No herramienta de migración externa.** Las migraciones viven en [server/migrate.js](server/migrate.js) como funciones SQL idempotentes (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Se ejecutan al arrancar el server.
- **No queue worker.** Background jobs son `setInterval` en [server/index.js](server/index.js) (Statcast warm-up cada 6h, line snapshots, pick resolver, closing line capture, content auto-publish).
- **No feature flag system.** Solo env vars como toggles (`SHADOW_MODE_ENABLED`, `PARLAY_SYNERGY_ENABLED`, `X_AUTO_PUBLISH_ENABLED`).
- **No Sentry / Datadog.** Solo `console.log/warn/error` con prefijos `[module-name]`.
- **Tests con `node:test`** (builtin). Solo `server/services/parlayEngine/__tests__/` tiene cobertura hoy.

---

## Paths críticos por dominio

### LLM / Predicción
- [server/oracle.js](server/oracle.js) — motor LLM dual (Claude + Grok). **FROZEN.**
- [server/context-builder.js](server/context-builder.js) — arma payload por partido. **FROZEN.**
- [server/market-intelligence.js](server/market-intelligence.js) — `buildDeterministicSafePayload`, `buildValueBreakdown`. **FROZEN.**
- [server/services/xgboostValidator.js](server/services/xgboostValidator.js) — validador determinístico (no es XGBoost real, es scoring con pesos hardcodeados). **FROZEN.**
- [server/shadow-model.js](server/shadow-model.js) — runner del validator.
- [server/prompts/x-content-prompts.js](server/prompts/x-content-prompts.js) — prompts de content. **FROZEN** los existentes; añadir nuevos sí se puede.

### Pick lifecycle
- [server/pick-tracker.js](server/pick-tracker.js) — progress tracking en vivo.
- [server/pick-resolver.js](server/pick-resolver.js) — resolución post-game.
- [server/pick-postmortem.js](server/pick-postmortem.js) — análisis retrospectivo por LLM.
- [server/closing-line-capture.js](server/closing-line-capture.js) — CLV.
- [server/feature-store.js](server/feature-store.js) — persistencia de features por pick.

### Datos externos
- [server/mlb-api.js](server/mlb-api.js) — MLB Stats API wrapper.
- [server/savant-fetcher.js](server/savant-fetcher.js) — Baseball Savant leaderboards (cache 6h).
- [server/odds-api.js](server/odds-api.js) — The Odds API (dual key fallback).
- [server/weather-api.js](server/weather-api.js) — Open-Meteo.
- [server/live-feed.js](server/live-feed.js) — play-by-play MLB.

### Auth, payments, comms
- [server/auth.js](server/auth.js) — JWT custom, bcryptjs, email verification, password reset, bankroll.
- [server/middleware/auth-middleware.js](server/middleware/auth-middleware.js) — `verifyToken`, `requireVerifiedEmail`, `isAdmin`.
- [server/nowpayments.js](server/nowpayments.js) + [server/nowpayments-webhook.js](server/nowpayments-webhook.js) — checkout cripto + IPN HMAC-SHA512.
- [server/email.js](server/email.js) — Resend client.

### Content pipeline X
- [server/services/contentDraftService.js](server/services/contentDraftService.js) — drafts con Haiku.
- [server/services/contentQueueService.js](server/services/contentQueueService.js) — cola editorial.
- [server/services/xPublisher.js](server/services/xPublisher.js) — OAuth 1.0a HMAC-SHA1.

### Parlay Synergy (nuevo)
- [server/services/parlayEngine/](server/services/parlayEngine/) — pool, risk, correl, composer, architect.
- Brief técnico maestro: [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md).

### Admin
- [server/admin-db-explorer.js](server/admin-db-explorer.js) — read-only DB browser con whitelist por tabla/columna.
- Endpoints admin viven en [server/index.js](server/index.js) y en rutas específicas (content-admin).

### Routes principales
- [server/routes/picks.js](server/routes/picks.js)
- [server/routes/content.js](server/routes/content.js) — API key, read-only para consumidores externos.
- [server/routes/content-admin.js](server/routes/content-admin.js)
- [server/routes/insights.js](server/routes/insights.js)
- [server/routes/oracle-history.js](server/routes/oracle-history.js)

### Frontend
- [client/src/App.jsx](client/src/App.jsx) — root + routing.
- [client/src/pages/](client/src/pages/) — pages (PerformanceDashboard, ParlayArchitect, DevUIShowcase, MLCalibrationDashboard).
- [client/src/components/](client/src/components/) — componentes (AdminCreditPanel, AdminDbExplorerPanel, AnalysisPanel, OracleChat, BankrollTracker, HexaBoard, LearningCenter, MethodologyPage, etc).

### ML sidecar Python
- [ml/hexa_ml/serve.py](ml/hexa_ml/serve.py) — FastAPI app (endpoints: /health, /predict/\*, /calibration, /retrain, /retrain/ensemble).
- [ml/hexa_ml/train.py](ml/hexa_ml/train.py) — pipeline de entrenamiento XGBoost (temporal split, Brier eval).
- [ml/hexa_ml/models/ensemble.py](ml/hexa_ml/models/ensemble.py) — meta-learner LogReg que combina oracle + legacy + python.
- [ml/hexa_ml/predict.py](ml/hexa_ml/predict.py) — ModelRegistry singleton (thread-safe).
- [ml/hexa_ml/features.py](ml/hexa_ml/features.py) — feature engineering desde pick_features.
- [ml/hexa_ml/calibration.py](ml/hexa_ml/calibration.py) — PlattCalibrator + Brier score.
- [ml/Dockerfile](ml/Dockerfile) — imagen multi-stage Python 3.11.
- [ml/railway.json](ml/railway.json) — config deploy Railway del sidecar.

### Scripts de training / dataset
- [scripts/training/export-dataset.js](scripts/training/export-dataset.js) — exporta pick_features a CSV/Parquet.
- [scripts/training/backfill-pick-features.js](scripts/training/backfill-pick-features.js) — backfill de scores históricos.

### Parsers y enrichers (Sprint 1)
- [server/parsers/pickParser.js](server/parsers/pickParser.js) — parsea "NYY ML" → `{market_type, side, line}`.
- [server/services/pickPostgameEnricher.js](server/services/pickPostgameEnricher.js) — backfill de scores post-game desde MLB API.

---

## Frozen files — NO modificar sin permiso explícito del usuario

Estos archivos están congelados por el brief del Parlay Synergy Engine y por estabilidad del Oracle:

- `server/oracle.js`
- `server/context-builder.js`
- `server/market-intelligence.js`
- `server/services/xgboostValidator.js`
- `server/shadow-model.js` ← ya se modificó en Sprint 3 para inyectar Python score; está estable
- Prompts existentes dentro de `server/oracle.js`
- `server/services/parlayEngine/*` (recién implementado, refactors solo con permiso)
- `server/services/mlModelClient.js` ← cliente del sidecar Python, no tocar flujo del circuit breaker

Para añadir lógica nueva que parezca tocar estos archivos: **crear archivos nuevos** que los **importen** y orquesten, sin modificar el original. Patrón usado en `parlayEngine/llmClient.js` (instancia propia de Anthropic SDK en lugar de tocar `oracle.js`).

---

## Convenciones de código

### Imports ESM
Siempre con extensión `.js` explícita:
```js
import pool from './db.js';
import { buildContext } from './context-builder.js';
import { calculateParallelScore } from './services/xgboostValidator.js';
```

### Comentarios
- Default: **no escribir comentarios.** Identificadores bien nombrados son suficientes.
- Excepción: cuando el "por qué" no es obvio (workaround de bug, invariante oculto, restricción de API externa, decisión de negocio).
- Nunca describir el "qué" si el código ya lo dice.

### Logging
Usar prefijo `[module-name]`:
```js
console.log(`[oracle] dual divergence detected: claude=${claudePick} vs grok=${grokPick}`);
console.warn(`[odds-api] primary key exhausted, falling back to backup`);
console.error(`[nowpayments-webhook] invalid signature: ${err.message}`);
```

### Errores en endpoints
Usar `safeError()` helper en [server/index.js](server/index.js) para nunca filtrar stacks en producción.

### Strings user-facing
Bilingual cuando aplica (es/en). El frontend tiene i18n en [client/src/i18n/](client/src/i18n/).

---

## Cómo hacer cosas comunes

### Añadir un endpoint nuevo
1. Decidir si va en [server/index.js](server/index.js) (cross-cutting, una sola pieza) o en `server/routes/<dominio>.js` (lógica de dominio agrupada).
2. Si requiere auth, usar `verifyToken` middleware. Si es admin: `requireAdmin` (verifica `is_admin` en JWT).
3. Si crea o muta picks: `requireVerifiedEmail` (excepto admin).
4. Si es análisis: añadir al `analysisLimiter` rate limit group.
5. Si es público con API key: usar `verifyContentApiKey` middleware.

### Añadir una columna a una tabla existente
Editar [server/migrate.js](server/migrate.js):
```js
await pool.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS my_new_col VARCHAR(32)`);
```
La migración corre en cada startup, es idempotente, y no requiere downtime.

### Crear una tabla nueva
Mismo patrón:
```js
await pool.query(`CREATE TABLE IF NOT EXISTS my_new_table (
  id BIGSERIAL PRIMARY KEY,
  ...
)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_my_new_table_foo ON my_new_table(foo)`);
```

### Añadir un feature flag
1. Documentarlo en [.env.example](.env.example) con default y descripción.
2. Leerlo con `process.env.MY_FLAG === '1'` o `'true'`.
3. Mencionarlo en la sección "Feature flags activas" de [docs/admin-and-ops.md](docs/admin-and-ops.md).

### Añadir un background job
Patrón en [server/index.js](server/index.js) (al final del archivo):
```js
setInterval(async () => {
  const hourET = nowETHour();
  if (hourET < 19 && hourET >= 6) return;  // solo correr en ventana válida
  try {
    await myJobFn();
  } catch (err) {
    console.error(`[my-job] failed: ${err.message}`);
  }
}, 30 * 60 * 1000);  // cada 30 min
```

Considerar mover a un queue real (BullMQ + Redis) si crece la cantidad de jobs.

### Llamar a un LLM desde código nuevo
**No** importar desde `oracle.js`. Crear cliente propio:
```js
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// usar client.messages.create(...)
```
Patrón existente en [server/services/parlayEngine/llmClient.js](server/services/parlayEngine/llmClient.js).

### Añadir un test
Framework: `node:test` builtin. Archivos en `__tests__/` adyacente al código:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('mi función hace X', () => {
  assert.equal(myFn(input), expected);
});
```
Correr con `node --test server/services/myDir/__tests__/`.

---

## Comandos npm

```bash
# Setup inicial
npm install
cd client && npm install && cd ..
cp .env.example .env  # editar con tus keys

# Desarrollo
npm run dev          # server con --watch en :3001
npm run client       # cliente Vite en :5173
npm run dev:all      # ambos en paralelo (concurrently)

# Operación
npm run audit        # diagnóstico del sistema (system-audit.js)
npm run test:parlay  # tests del Parlay Synergy Engine
npm start            # server en modo producción

# Cliente
cd client
npm run build        # build de producción
npm run preview      # preview del build
```

---

## Variables de entorno críticas

**Obligatorias:**
- `ANTHROPIC_API_KEY` — Claude
- `DATABASE_URL` — Postgres connection
- `JWT_SECRET` — firma de tokens (cambiar en prod)
- `ODDS_API_KEY` — The Odds API

**Opcionales pero activas:**
- `XAI_API_KEY` — Grok / dual mode
- `ODDS_API_BACKUP_KEY` — fallback automático
- `RESEND_API_KEY` + `EMAIL_FROM` — email verification
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` — cripto
- `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` — publicar en X
- `CONTENT_API_KEYS` — `label:secret,label2:secret2` para API pública

**Feature flags:**
- `SHADOW_MODE_ENABLED` — shadow validator activo
- `PARLAY_SYNERGY_ENABLED` — motor parlay nuevo (default `false`)
- `X_AUTO_PUBLISH_ENABLED` — worker publica en X (default `0`)
- `X_AUTO_PUBLISH_INTERVAL_MINUTES` — intervalo (default `5`)

Lista completa en [.env.example](.env.example).

---

## Convenciones de PR / commit

- **Branch main protegida.** Trabajar en feature branches y abrir PR.
- Mensajes de commit estilo convencional: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`. Ver `git log` para ejemplos.
- **Nunca commitear `.env`** ni credenciales — solo `.env.example`.
- Cambios que tocan prompts del LLM: pasar por `npm run audit` y validar contra backtest antes de merge.
- Cambios al schema: documentar en [docs/data-schema.md](docs/data-schema.md).

---

## Roadmap activo

El pipeline de ML propio está completo. Próximo foco: activar el sidecar en Railway y acumular datos para reentrenamiento. Backlog en [docs/roadmap.md](docs/roadmap.md).

Estado del pipeline ML:
- ✅ Sprint 0 — documentación viva (este archivo + `/docs/`).
- ✅ Sprint 1 — gaps del dataset cerrados: 22 columnas nuevas en `pick_features`, pickParser, pickPostgameEnricher, export-dataset.js.
- ✅ Sprint 2 — sidecar Python FastAPI + XGBoost real en `ml/`, Dockerfile, railway.json, retrain-weekly.yml.
- ✅ Sprint 3 — integración Node↔Python (mlModelClient.js, circuit breaker), shadow_model_runs enriquecido, dashboard `/admin/ml-calibration`.
- ✅ Sprint 4 — ensemble meta-learner (LogReg que combina oracle+legacy+python), `/predict/ensemble`, `/admin/ml-ensemble-calibration`.

**Para activar en producción**: ver sección "Activar el sidecar Python" en [docs/ml-pipeline.md](docs/ml-pipeline.md). Las 3 env vars necesarias: `ML_SIDECAR_ENABLED=true`, `HEXA_ML_API_URL`, `HEXA_ML_INTERNAL_TOKEN`.

Próximo paso recomendado (Tier S del backlog): equity curve + Sharpe + drawdown dashboard usando datos que ya existen en `picks`.

---

## Cuando tengas dudas

- Arquitectura: [docs/architecture.md](docs/architecture.md)
- ML / Oracle: [docs/ml-pipeline.md](docs/ml-pipeline.md)
- APIs externas: [docs/integrations.md](docs/integrations.md)
- Pipeline X / content: [docs/content-pipeline.md](docs/content-pipeline.md)
- Admin / ops: [docs/admin-and-ops.md](docs/admin-and-ops.md)
- Schema DB: [docs/data-schema.md](docs/data-schema.md)
- Próximos pasos: [docs/roadmap.md](docs/roadmap.md)
- Parlay Synergy spec: [hexa-parlay-engine-brief.md](hexa-parlay-engine-brief.md)
