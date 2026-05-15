# CLAUDE.md — Guía para Claude Code en H.E.X.A. v4

Este archivo se lee automáticamente al inicio de cada sesión. **Antes de tocar código, leelo entero.** Después, abrir el archivo relevante en `docs/` para profundidad.

---

## TL;DR del proyecto

H.E.X.A. v4 es una plataforma de **análisis predictivo de MLB y NBA**:

- Motor LLM dual (Claude + Grok) que genera picks con contexto rico (Statcast, weather, park factors, lineups, line movement para MLB; advanced team stats + rest/pace/net-rating para NBA).
- Pick lifecycle: create → tracking en vivo → resolución automática post-game → postmortem por LLM.
- Pipeline de contenido editorial a X (Twitter) con OAuth 1.0a.
- Monetización con cripto vía NowPayments.
- Frontend React 18 + Vite + MUI con PWA. Sport switcher MLB/NBA en la tab de juego.
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
- [server/pick-tracker.js](server/pick-tracker.js) — progress tracking en vivo (MLB).
- [server/pick-resolver.js](server/pick-resolver.js) — resolución post-game (MLB). Exporta `resolvePickFromFinalState` + `tokenMatchesTeam`, reutilizados por el resolver NBA.
- [server/pick-resolver-nba.js](server/pick-resolver-nba.js) — resolución post-game NBA. Se ejecuta cada 30 min junto al resolver MLB cuando `NBA_ANALYSIS_ENABLED=true`.
- [server/pick-postmortem.js](server/pick-postmortem.js) — análisis retrospectivo por LLM.
- [server/closing-line-capture.js](server/closing-line-capture.js) — CLV.
- [server/feature-store.js](server/feature-store.js) — persistencia de features por pick.

### Datos externos
- [server/mlb-api.js](server/mlb-api.js) — MLB Stats API wrapper.
- [server/nba-api.js](server/nba-api.js) — NBA Stats API wrapper (`stats.nba.com/stats/`). Endpoints: scoreboardv2 (juegos del día), leaguedashteamstats (season stats), teamgamelog (últimos 10 juegos). **Nota**: `teamgamelog` no devuelve `PLUS_MINUS` — usa `normalisePlusMinus()` con búsqueda dinámica de headers.
- [server/nba-context-builder.js](server/nba-context-builder.js) — arma contexto NBA por partido (net/off/def rating, pace, TS%, REB%, AST%, rest days, last-10 form).
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
- Endpoints admin viven en [server/index.js](server/index.js) y en rutas específicas (content-admin, admin-ml).

### NBA Oracle
- [server/services/oracleNba.js](server/services/oracleNba.js) — Motor LLM NBA (Anthropic only, sin Grok). Exporta `analyzeNbaGame` y `analyzeNbaChat`. **No toca oracle.js.**
- [server/prompts/oracle-nba-prompts.js](server/prompts/oracle-nba-prompts.js) — Prompts NBA: `NBA_SYSTEM_PROMPT` (pick + JSON output) y `NBA_CHAT_PROMPT` (chat libre). Guardrail anti-hallucination: prohíbe explícitamente simular tool calls o web search.
- [server/routes/nba.js](server/routes/nba.js) — `POST /api/nba/analyze/game` y `POST /api/nba/analyze/chat`. Feature-flagged por `NBA_ANALYSIS_ENABLED`. Admin-only.

### Routes principales
- [server/routes/picks.js](server/routes/picks.js)
- [server/routes/content.js](server/routes/content.js) — API key, read-only para consumidores externos.
- [server/routes/content-admin.js](server/routes/content-admin.js)
- [server/routes/insights.js](server/routes/insights.js)
- [server/routes/oracle-history.js](server/routes/oracle-history.js)
- [server/routes/admin-ml.js](server/routes/admin-ml.js) — Admin ML Control Center (status, retrain proxy con audit log, ensemble breakdown por pick, chat-picks stats).

### Frontend
- [client/src/App.jsx](client/src/App.jsx) — root + routing. Tiene estado `sport` ('mlb'|'nba') que se pasa a GameSelector y AnalysisPanel en la tab de juego.
- [client/src/components/SportSwitcher.jsx](client/src/components/SportSwitcher.jsx) — pill toggle MLB/NBA. Se renderiza dentro del header de GameSelector (modo single).
- [client/src/components/GameSelector.jsx](client/src/components/GameSelector.jsx) — acepta `sport` prop. Cuando `sport='nba'` fetcha `/api/nba/games` y normaliza al shape MLB-compatible. Oculta la sección de pitchers para NBA.
- [client/src/components/AnalysisPanel.jsx](client/src/components/AnalysisPanel.jsx) — acepta `sport` prop. Cuando `sport='nba'` usa `/api/nba/analyze/game`. Oculta betType, engine picker (grok/dual), webSearch toggle y lineup badges para NBA.
- [client/src/pages/](client/src/pages/) — pages (PerformanceDashboard, ParlayArchitect, DevUIShowcase, MLCalibrationDashboard, AdminMLControlCenter).
- [client/src/components/](client/src/components/) — componentes (AdminCreditPanel, AdminDbExplorerPanel, AdminEnsembleBadge, OracleChat, BankrollTracker, HexaBoard, LearningCenter, MethodologyPage, etc).

### Admin ML Control Center (Sprint 5 UI)
- [client/src/pages/AdminMLControlCenter.jsx](client/src/pages/AdminMLControlCenter.jsx) — página `/admin/ml-control` con HUD de circuit breaker, cards por mercado, retrain on-demand, ensemble panel, chat-picks bucket stats, retrain audit log.
- [client/src/components/AdminEnsembleBadge.jsx](client/src/components/AdminEnsembleBadge.jsx) — chip lazy-loaded que aparece bajo cada PickCard (admin-only) y muestra Oracle/Legacy/Python/Ensemble probs por pick.
- [server/services/chatPickExtractor.js](server/services/chatPickExtractor.js) — captura picks de Oracle Chat con JSON tail + Haiku fallback, persiste en `picks` con `source='oracle_chat'`.

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
- `NBA_ANALYSIS_ENABLED` — habilita Oracle NBA y resolver NBA (default `false`; `true` en local y en Railway cuando se lance el MVP)

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

El pipeline de ML propio está **completo y en producción**. Los modelos XGBoost están entrenados y sirviendo predicciones en tiempo real. Backlog en [docs/roadmap.md](docs/roadmap.md).

Estado del pipeline ML:
- ✅ Sprint 0 — documentación viva (este archivo + `/docs/`).
- ✅ Sprint 1 — gaps del dataset cerrados: 22 columnas nuevas en `pick_features`, pickParser, pickPostgameEnricher, export-dataset.js.
- ✅ Sprint 2 — sidecar Python FastAPI + XGBoost real en `ml/`, desplegado en Railway como servicio separado.
- ✅ Sprint 3 — integración Node↔Python (mlModelClient.js, circuit breaker), shadow_model_runs enriquecido, dashboard `/admin/ml-calibration`.
- ✅ Sprint 4 — ensemble meta-learner (LogReg oracle+legacy+python), `/predict/ensemble`, `/admin/ml-ensemble-calibration`.
- ✅ Sprint 5 UI — Admin ML Control Center (`/admin/ml-control`): HUD live, retrain on-demand por mercado + ensemble + RETRAIN ALL, per-pick ensemble breakdown badge en HistoryPanel, chat-picks bucket dashboard, retrain audit log (`ml_retrain_log`). Runline desbloqueado (`min_train_size=25`). Chat→Training pipeline con `source='oracle_chat'` aislado del training default. Sprint 5 Player Props pendiente (banner "coming soon" visible).

**Estado en producción (2026-05-14)**:
- Hexa ML corriendo en: `https://hexa-ml-production.up.railway.app`
- Modelos entrenados: **moneyline** (Brier 0.205, ROI +18.3%) y **overunder** (Brier 0.138, ROI +8.5%)
- Runline: floor bajado a 25 (de 100). Modelo se entrena con regularización L2 fuerte; n_train se muestra en el dashboard como flag "EARLY MODEL".
- Backfill ejecutado: 583/635 filas de `pick_features` tienen `market_type` parseado
- Reentrenamiento automático: `.github/workflows/retrain-weekly.yml` (domingos 06:00 UTC)

**Variables en Railway Hexa ML**: `DATABASE_URL` (public URL), `HEXA_ML_INTERNAL_TOKEN=hexa-ml-secret-2026`, `MIN_TRAIN_SIZE=60`, `RUNLINE_MIN_TRAIN_SIZE=25` (override), `TEST_DAYS=7`

**Variables en Railway hexa-v4**: `ML_SIDECAR_ENABLED=true`, `HEXA_ML_API_URL=https://hexa-ml-production.up.railway.app`, `HEXA_ML_INTERNAL_TOKEN=hexa-ml-secret-2026`, `CHAT_EXTRACTOR_HAIKU_FALLBACK=1` (default), `CHAT_EXTRACTOR_HAIKU_MODEL=claude-haiku-4-5-20251001` (default)

**Para reentrenar manualmente (CLI)**:
```bash
curl -X POST https://hexa-ml-production.up.railway.app/retrain \
  -H "Authorization: Bearer hexa-ml-secret-2026" \
  -H "Content-Type: application/json" -d '{"market":"all"}'
```

**Para reentrenar desde la UI**: ir a `/admin/ml-control` → click en `▶ RETRAIN` por mercado o `▶▶ RETRAIN ALL MARKETS`. Cada disparo escribe una fila en `ml_retrain_log` (admin, market, brier, n_train, duration, error). Cooldown anti-doble-click: 5 minutos por scope.

**Si pick_features necesita backfill** (añadir DATABASE_URL público al .env local primero):
```bash
node --env-file=.env scripts/training/backfill-pick-features.js --batch=500
```

**Picks desde Oracle Chat**: cuando el Oracle recomienda un pick durante una sesión de chat, el extractor (JSON tail + Haiku fallback) lo persiste en `picks` con `source='oracle_chat'` y `chat_session_id` apuntando a `oracle_sessions`. Estos picks **no entran al training default** (el sidecar Python filtra por `source = 'live'`). Para inspeccionarlos: panel "Chat-sourced picks" en `/admin/ml-control`. Para suprimir extracción en un chat exploratorio: header `X-HEXA-Skip-Pick-Extract: 1` (o el checkbox "NO GUARDAR PARA ENTRENAMIENTO" en OracleChat).

**NBA MVP — Estado actual (2026-05-15)**:

- ✅ **7a scaffolding datos**: `nba-api.js`, `nba-context-builder.js`. Columna `sport VARCHAR(10) DEFAULT 'mlb'` en `picks` y `pick_features`. GET `/api/nba/games` y `/api/nba/teams` operativos.
- ✅ **7b Oracle NBA**: `server/prompts/oracle-nba-prompts.js` + `server/services/oracleNba.js`. Guardrail anti-hallucination activo (prohíbe web search simulado). Validado end-to-end: pick DET ML 63% conf, JSON parse limpio, sin fabricaciones.
- ✅ **7c pick lifecycle NBA**: `POST /api/nba/analyze/game` (admin-only, feature-flagged `NBA_ANALYSIS_ENABLED`). Persistencia con `sport='nba'`, `game_pk=parseInt(gameId)`.
- ✅ **7c2 resolver NBA**: `pick-resolver-nba.js` — resuelve picks NBA pendientes contra scores finales. Reutiliza `resolvePickFromFinalState` de `pick-resolver.js`. Background job cada 30 min junto al MLB.
- ✅ **7d UI**: `SportSwitcher.jsx` (pill MLB/NBA), `GameSelector` con `sport` prop (fetch `/api/nba/games`, normalización a shape MLB-compatible, oculta pitcher section), `AnalysisPanel` con `sport` prop (endpoint NBA, oculta betType/engine/webSearch/lineup gates).
- ⏳ **7e NBA ML sidecar** — condicional, post ~500 picks NBA resueltos. No urgente.

**NBA hardening obligatorio antes de público (2026-05-15)**:

0) **Regla de seguridad operativa**
- No tocar lógica MLB ni archivos frozen de Oracle MLB. Todo NBA en rutas/servicios/prompt/UI NBA o archivos nuevos.
- Trabajar en ramas dedicadas `fix/nba-*` o `feat/nba-*` (no mezclar con tareas MLB).

1) **Separación MLB/NBA en historial y lifecycle (HOTFIX crítico)**
- `client/src/hooks/useHistory.js`: propagar `sport` desde filas DB (`dbRowToEntry`).
- `client/src/components/HistoryPanel.jsx`: render condicional por `sport`; no usar resolver/logos MLB para picks NBA.
- Revisar flows que insertan picks para asegurar que NBA siempre persiste `sport='nba'` (evitar fallback al default `'mlb'` en inserts genéricos).
- Criterio de salida: pick NBA nunca se visualiza como MLB en History, Dashboard, ni cards de detalle.

2) **SAFE PICK en NBA (HOTFIX crítico)**
- Hoy SAFE puede rutear al endpoint MLB (`/api/analyze/safe`) cuando `sport='nba'`; bloquear ese path en UI NBA.
- Política vigente: **deshabilitar Player Props en NBA** hasta contar con dataset robusto y resolver dedicado.
- Criterio de salida: en NBA solo permitir modos soportados; cero errores "Game not found" por cruce de endpoints MLB.

3) **Fuente de datos y consistencia de IDs**
- Priorizar ESPN para disponibilidad (Railway) y mantener fallback controlado.
- Introducir mapping estable `espnTeamId <-> nbaStatsTeamId` para evitar contextos vacíos/inconsistentes en stats avanzadas.
- Criterio de salida: contexto NBA sin bloques `data unavailable` por mismatch de IDs.

4) **Calidad de contexto NBA (paridad de profesionalismo)**
- Añadir bloque estructurado de injuries/status (fuente confiable) al contexto NBA.
- Integrar market odds server-side para NBA cuando el cliente no envía líneas.
- Exponer `context_meta` (freshness, completeness, stale flags) para observabilidad admin.

5) **Guardrails de salida LLM NBA**
- Validar schema de respuesta NBA server-side y aplicar fallback seguro cuando falten campos críticos.
- Restringir picks a mercados soportados por la data disponible; evitar props sin sustento.
- Criterio de salida: no persistir picks NBA ambiguos o con parse defectuoso sin marca explícita.

6) **Resolución y tracking NBA**
- Endurecer resolver/tracker NBA por mercado soportado (moneyline/spread/total primero).
- Evitar que jobs MLB procesen picks NBA y viceversa.
- Criterio de salida: lifecycle NBA cerrado end-to-end sin contaminación cruzada.

7) **ML NBA (fase posterior)**
- Iniciar sidecar NBA cuando exista volumen mínimo de picks resueltos con calidad.
- Mantener dataset NBA aislado de MLB en entrenamiento y calibración.

**Matriz de calidad por deporte (release gate)**

Usar esta matriz antes de abrir/expandir un deporte. Escala sugerida: 0-10 por criterio, con umbral de release >= 8.5 global y ningun criterio critico < 8.

| Criterio | MLB (actual) | NBA (actual) | Gate minimo |
|---|---:|---:|---:|
| Data depth pregame (features contextuales) | 9.5 | 6.5 | 8.0 |
| Data quality live (latencia + disponibilidad) | 8.5 | 7.0 | 8.0 |
| Lineup/Injury verification estructurada | 9.0 | 5.5 | 8.0 |
| Market coverage soportada por data real | 9.0 | 6.0 | 8.0 |
| Guardrails LLM (schema + fallbacks + policy) | 8.5 | 7.0 | 8.0 |
| Pick lifecycle (tracking -> resolver -> postmortem) | 9.0 | 7.5 | 8.0 |
| Calibration/ROI observables por mercado | 8.5 | 6.0 | 8.0 |
| Isolation por deporte (sin contaminacion cruzada) | 8.5 | 6.5 | 8.5 |

**Criterios de "go public" para NBA**
- SAFE PICK NBA aislado de endpoints MLB y con politica propia.
- Player Props NBA desactivado (o habilitado solo con dataset robusto + resolver dedicado).
- Historial, logos, resolver y jobs aislados por `sport`.
- Contexto NBA con injuries/status + odds server-side + metadata de completitud.

**Próximo prioritario: Sprint 6 — hardening antes de abrir NBA al público**
- **Sprint 6a — Equity curve + Sharpe + drawdown dashboard**: curva de equity, drawdown peak-to-trough, Sharpe rolling 30d. Datos ya existen en `picks` + `bankroll`. Sin esto el usuario no puede evaluar Hexa como sistema de bankroll.
- **Sprint 6b — Persistencia de modelos ML vía Railway Volumes**: `ml/hexa_ml/config.py` apunta a `artifacts/` (relativo, efímero en Railway). Cada redeploy del sidecar borra los `.pkl`. Apuntar a `/data` (volume montado en Railway) cierra esa ventana.

**Pendiente del bloque ML**:
- Sprint 5 Player Props MLB (training para hits / total_bases / strikeouts) — requiere features per-batter (xBA, xSLG, splits vs handedness) que aún no están en `savant-fetcher.js`.

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
