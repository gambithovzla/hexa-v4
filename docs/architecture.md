# Arquitectura — H.E.X.A. v4

Documento maestro de qué hace H.E.X.A. y cómo está conectado. Para convenciones y patrones de código, ver [CLAUDE.md](../CLAUDE.md).

---

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Diagrama general](#2-diagrama-general)
3. [Subsistemas](#3-subsistemas)
4. [Flujos críticos](#4-flujos-críticos)
5. [Stack técnico](#5-stack-técnico)
6. [Endpoints — vista panorámica](#6-endpoints--vista-panorámica)
7. [Background jobs](#7-background-jobs)
8. [Decisiones arquitectónicas](#8-decisiones-arquitectónicas)

---

## 1. Resumen ejecutivo

**H.E.X.A.** (Heuristic Evaluation & eXpert Analytics) es una plataforma SaaS de análisis predictivo de MLB. Combina:

- **LLM dual** (Claude + Grok) como motor de razonamiento principal.
- **Statcast / Baseball Savant** como fuente de métricas avanzadas (xwOBA, whiff%, active spin, park factors).
- **The Odds API** para líneas de moneyline, run line, totales y player props.
- **MLB Stats API** para schedule, lineups, play-by-play.
- **Open-Meteo** para clima de estadio.
- **Validator tabular** (hoy determinístico, en migración a XGBoost real) que corre en paralelo al LLM para observabilidad.
- **Pipeline de contenido** que genera borradores con Haiku y publica en X via OAuth 1.0a.
- **Monetización cripto** con NowPayments (planes Rookie / All-Star / MVP en créditos).
- **Frontend React** PWA con MUI, Framer Motion, Recharts.

El sistema opera como un **monorepo** (server Node 20 ESM + client React 18 Vite) deployado en Railway (server) y Vercel (client). Postgres es la única base de datos y se ejecuta vía addon de Railway o externo (Neon, Supabase).

---

## 2. Diagrama general

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          USUARIO FINAL (Web / PWA)                       │
│                          React 18 + Vite + MUI                           │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ HTTPS / JSON
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       HEXA SERVER (Node 20 + Express)                    │
│                                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │   Auth      │  │   Oracle     │  │ Pick Lifecycle │  │  Payments    │ │
│  │  JWT 7d     │  │ Claude+Grok  │  │  + Postmortem  │  │ NowPayments  │ │
│  └─────────────┘  └──────┬───────┘  └────────┬───────┘  └──────────────┘ │
│                          │                   │                           │
│  ┌─────────────┐  ┌──────▼───────┐  ┌────────▼───────┐  ┌──────────────┐ │
│  │   Admin     │  │  Context     │  │  Feature Store │  │   Content    │ │
│  │ DB Explorer │  │  Builder     │  │   + CLV        │  │  Pipeline X  │ │
│  └─────────────┘  └──────┬───────┘  └────────────────┘  └──────────────┘ │
│                          │                                               │
│         ┌────────────────┴────────────────────┐                          │
│         │                                     │                          │
│  ┌──────▼─────┐  ┌──────────┐  ┌──────────┐  ┌▼─────────┐  ┌──────────┐  │
│  │  Shadow    │  │  Live    │  │ Parlay   │  │  Market  │  │  Oracle  │  │
│  │  Validator │  │  Feed    │  │ Synergy  │  │   Intel  │  │  Memory  │  │
│  └────────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└──────────┬──────────┬──────────┬────────────┬───────────┬────────┬──────┘
           │          │          │            │           │        │
           ▼          ▼          ▼            ▼           ▼        ▼
      ┌────────┐ ┌────────┐ ┌────────┐  ┌─────────┐ ┌────────┐ ┌────────┐
      │Postgres│ │Anthropic│ │  xAI  │  │MLB Stats│ │ Savant │ │  Odds  │
      │ (pool) │ │ Claude  │ │ Grok  │  │   API   │ │Statcast│ │  API   │
      └────────┘ └────────┘ └────────┘  └─────────┘ └────────┘ └────────┘
           │
           │              ┌─────────┐ ┌────────┐ ┌────────┐
           └──────────────│ Resend  │ │  Open  │ │NowPay- │
                          │  Email  │ │ Meteo  │ │ ments  │
                          └─────────┘ └────────┘ └────────┘

           ┌────────────────────────────────────────────┐
           │  X / Twitter (publishing OAuth 1.0a)       │
           └────────────────────────────────────────────┘
```

---

## 3. Subsistemas

### 3.1 Oracle — motor de razonamiento

**Archivo principal:** [server/oracle.js](../server/oracle.js) (1225 líneas).

Soporta 3 motores seleccionables por request:
- `sonnet` — Claude Sonnet 4.6 (default).
- `grok` — xAI grok-4-fast-reasoning.
- `dual` — ejecuta ambos en paralelo y reporta divergencia.

Modelos Claude configurables:
- **Opus 4.7** (10000 max tokens) — modo `premium`.
- **Sonnet 4.6** (8000 max tokens) — modo `deep`, default.
- **Haiku 4.5** (1000 max tokens) — modo `content drafts`.

**Modos de análisis** (`analyzeGame`):
- `single` — un partido, output completo con tesis y reasoning.
- `fullDay` — slate del día, brief de cada juego.
- `parlay` — N juegos concatenados, output con `parlay.legs[]`.
- `safe` — modo conservador, fast, menor consumo de créditos.
- `chat` (admin) — chat libre con Oracle.
- `chat-jornada` (admin) — chat sobre jornada completa.

**Output JSON estructurado**: `master_prediction`, `oracle_report`, `probability_model`, `alert_flags`, `kelly_recommendation`. Validación manual con `parseResponse()` (limpia markdown, extrae bloque JSON).

**Dual divergence detection**: el modo `dual` ejecuta Claude y Grok en paralelo. Si los picks normalizados difieren, marca `engine_meta.divergence: true` y reporta ambos en `engine_variants[]`. **No es ensemble** — sólo observabilidad.

Detalle profundo en [docs/ml-pipeline.md](ml-pipeline.md).

### 3.2 Context Builder

**Archivo:** [server/context-builder.js](../server/context-builder.js) (1909 líneas, el archivo más grande del repo).

Arma el payload de contexto que se inyecta en el prompt del LLM. Por partido reúne:

- **Pitcher stats** (xwOBA_against, Whiff%, active_spin_pct, xERA, K%, BB%).
- **Rolling windows** del pitcher (7d wOBA against).
- **Lineup**: xwOBA promedio, rolling 7d, splits vs LHP/RHP.
- **Weather**: temperatura, viento (10m), dirección, precipitación.
- **Park factors** (overall, HR) por estadio.
- **Bullpen usage**: IP últimos 3 días, back-to-back flags.
- **Line movement**: snapshots y sharp money detection (±15 cent ML move).
- **Statcast batter splits**: percentiles, exit velocity.
- **Spring training adjustment**: reduce confianza -25% cuando aplica.

**Cache**: in-memory contexto cache (15 min TTL) para evitar reconstrucción redundante en la misma jornada.

Output: `{ context: string, _features: object }`. El `context` es un string formateado en bloques que el LLM ingiere; el `_features` es el objeto numérico equivalente, usado por el validator y el feature store.

### 3.3 Shadow Validator

**Archivos:** [server/shadow-model.js](../server/shadow-model.js) + [server/services/xgboostValidator.js](../server/services/xgboostValidator.js).

**Estado actual: validator determinístico, NO XGBoost real.** Es un ensamble ponderado con pesos hardcodeados:

```
pitcher_xwOBA: 0.30
pitcher_whiff: 0.20
pitcher_activeSpin: 0.10
lineup_xwOBA: 0.25
recent_form: 0.15
```

Normaliza cada feature en `[0, 1]`, computa raw scores defensivo + ofensivo, aplica home field boost `+0.03`, normaliza a `[0, 100]`. Devuelve `{ score, predicted_winner, confidence }`.

Activado con `SHADOW_MODE_ENABLED=true`. Se ejecuta en paralelo al Oracle cuando se hace un pick; guarda run en tabla `shadow_model_runs`.

**Migración planificada:** sidecar Python FastAPI + XGBoost real entrenado con los picks históricos (>500). Detalle en [docs/ml-pipeline.md](ml-pipeline.md).

### 3.4 Pick Lifecycle

Flujo completo de un pick desde creación hasta postmortem:

1. **Create** (`POST /api/picks`): valida JWT + email verified, persiste en tabla `picks` con odds inicial.
2. **Save features**: `feature-store.savePickFeatures()` ([server/feature-store.js](../server/feature-store.js)) escribe row paralela en `pick_features` con Statcast, weather, park, odds.
3. **Tracker** ([server/pick-tracker.js](../server/pick-tracker.js)): durante el juego, polling MLB Stats actualiza progress en vivo.
4. **CLV capture** ([server/closing-line-capture.js](../server/closing-line-capture.js)): job periódico captura odds de cierre y los guarda en `picks.closing_odds`.
5. **Line movement snapshots** ([server/line-movement.js](../server/line-movement.js)): cada 6h en horario ET, snapshot a `odds_snapshots`.
6. **Resolver** ([server/pick-resolver.js](../server/pick-resolver.js)): cada 30 min en horario nocturno ET, evalúa estado del juego, marca `result` (win/loss/push/void) y calcula CLV.
7. **Postmortem** ([server/pick-postmortem.js](../server/pick-postmortem.js)): LLM genera análisis retrospectivo (qué falló / qué funcionó), guardado en `picks.postmortem` (JSONB).

### 3.5 Parlay Synergy Engine

**Carpeta:** [server/services/parlayEngine/](../server/services/parlayEngine/).

Motor nuevo (feature flag `PARLAY_SYNERGY_ENABLED`, default `false`) que reemplaza al parlay legacy (que concatena contextos y pide al LLM "construye un parlay"). El nuevo motor:

1. **Pool builder** (`pool.js`): por cada juego elegido, obtiene candidatos (ML home/away, RL home/away, OU, props) reutilizando `buildDeterministicSafePayload` + `calculateParallelScore`.
2. **Risk enricher** (`risk.js`): a cada candidato le calcula `riskVector` 6D (pitching_dominance, bullpen_exposure, weather_exposure, lineup_variance, umpire_sensitivity, ballpark_bias), `gameScript` y `failureMode`.
3. **Correlation matrix** (`correl.js`): para cada par de candidatos calcula correlación heurística (SGP, narrativa cross-game) y `risk_distance` euclidiana.
4. **Composer** (`composer.js`): greedy + 2-opt local search para maximizar `score_parlay = Σ edge × w_conf + α·corr_pos + β·risk_div − γ·length − δ·neg_corr`. Devuelve top-3.
5. **Architect** (`architect.js`): manda al LLM las 3 combinaciones del composer y le pide validar/ajustar. Output JSON con tesis de sinergia + warnings.
6. **Modos**: `conservative` (2-3 patas, correlación), `balanced` (4-5, híbrido), `aggressive` (6-10, alta varianza), `dreamer` (11-30, para parlays soñadores con warning grande).

Endpoint: `POST /api/analyze/parlay-synergy` (admin-only en beta).

Brief técnico maestro: [hexa-parlay-engine-brief.md](../hexa-parlay-engine-brief.md).

### 3.6 Content Pipeline

**Carpeta:** [server/services/](../server/services/) (`contentDraftService.js`, `contentQueueService.js`, `xPublisher.js`).

Genera contenido editorial automatizado para X (Twitter):

- **Tipos de contenido**: `pick_of_day` (single sharp post), `thread_daily` (4-6 posts sobre el slate), `postmortem` (2-3 posts post-game), `weekly_recap` (4-5 posts).
- **Lenguajes**: español (default) e inglés.
- **Generación**: Claude Haiku 4.5 con prompts en [server/prompts/x-content-prompts.js](../server/prompts/x-content-prompts.js).
- **Cola**: tabla `content_queue` con status `draft` → `approved` → `published`.
- **Publish**: [server/services/xPublisher.js](../server/services/xPublisher.js) con OAuth 1.0a HMAC-SHA1 a `https://api.x.com/2/tweets`.
- **Auto-publish**: worker `setInterval` cada `X_AUTO_PUBLISH_INTERVAL_MINUTES` cuando `X_AUTO_PUBLISH_ENABLED=1`.

**Content API pública** (read-only): [server/routes/content.js](../server/routes/content.js) — endpoints con API key (`CONTENT_API_KEYS`) para consumidores externos (bots, social media tools).

Detalle: [docs/content-pipeline.md](content-pipeline.md).

### 3.7 Admin

- **DB Explorer** ([server/admin-db-explorer.js](../server/admin-db-explorer.js)): browser web read-only con whitelist por tabla/columna. Nunca expone `password_hash`, `verification_code`, ni reset hashes.
- **Backtest runner**: `POST /api/admin/run-backtest` ejecuta análisis sobre juegos históricos sin consumir créditos.
- **Shadow Model dashboard**: `GET /api/admin/shadow-model?sport=mlb|nba` — runs y métricas de divergencia por deporte (MLB: `shadow-model.js`; NBA: `nbaShadowValidator.js`).
- **Feature Store inspection**: `GET /api/admin/feature-store?sport=mlb|nba&month=YYYY-MM` — dataset admin por deporte (coverage y columnas distintas MLB vs NBA).
- **Grant credits**: `POST /api/admin/grant-credits` — manualmente añade créditos a un usuario.
- **Parlay Synergy admin**: `GET /api/admin/parlay-synergy/recent` y `POST /api/admin/parlay-synergy/auto-resolve-all`.
- **Content queue manager**: aprobar / publicar drafts.

Detalle: [docs/admin-and-ops.md](admin-and-ops.md).

### 3.8 Auth & Bankroll

**Archivo:** [server/auth.js](../server/auth.js).

- JWT custom (`jsonwebtoken`), expiración 7 días, payload `{ id, email, is_admin }`.
- bcryptjs para password hashing.
- Email verification: códigos de 6 dígitos, TTL 15 min, enviados con Resend.
- Password reset: cooldown 60s entre requests, máximo 5 intentos por código.
- `requireVerifiedEmail` middleware bloquea crear picks si el email no está verificado (excepto admins).
- Tabla `bankroll`: setup inicial + tracking de current_bankroll por usuario.

### 3.9 Payments — NowPayments

**Archivos:** [server/nowpayments.js](../server/nowpayments.js), [server/nowpayments-webhook.js](../server/nowpayments-webhook.js).

- **Único gateway activo**, cripto (BTC, ETH, USDT, etc.).
- **Checkout**: `POST /api/nowpayments/checkout` con `{ planId }`, verifica email_verified, crea row en `nowpayments_invoices` con status `new`, devuelve `invoice_url`.
- **IPN webhook**: `POST /api/nowpayments/webhook` con HMAC-SHA512 en header `x-nowpayments-sig`. Sólo acredita en estado `finished`. UPDATE atómico con gate `status <> 'completed'` para idempotencia.
- **Planes** ([server/plans.js](../server/plans.js)): Rookie $7.99/15cr, All-Star $19.99/50cr, MVP $39.99/120cr.

### 3.10 Frontend

**Stack:** React 18 + Vite 5 + MUI 6 + Emotion + Framer Motion 12 + Recharts 3 + PWA.

**Páginas principales** ([client/src/pages/](../client/src/pages/)):
- `PerformanceDashboard.jsx` — stats agregadas, equity curve.
- `ParlayArchitect.jsx` — UI del Parlay Synergy Engine (admin).
- `DevUIShowcase.jsx` — paleta visual, design system.

**Componentes clave** ([client/src/components/](../client/src/components/)):
- `AnalysisPanel`, `OracleChat` — UI principal de análisis.
- `BankrollTracker` — gestión bankroll.
- `GameDayDetail`, `LiveTracker` — live feed.
- `HistoryPanel`, `HexaBoard` — historial y board diario.
- `AdminCreditPanel`, `AdminDbExplorerPanel` — admin tools.
- `LearningCenter`, `MethodologyPage` — contenido educativo.

**Estado**: store en [client/src/store/](../client/src/store/), hooks en [client/src/hooks/](../client/src/hooks/).

**Tema**: paletas en [client/src/palettes/](../client/src/palettes/) (dark.js, light.js).

**i18n**: [client/src/i18n/](../client/src/i18n/) (es / en).

---

## 4. Flujos críticos

### 4.1 Crear un pick (single)

```
1. Cliente: POST /api/picks { type, matchup, pick, gameId, ... }
2. Server: verifyToken → requireVerifiedEmail
3. INSERT en picks (id, user_id, type, matchup, pick, odds_at_pick, game_pk, game_date, ...)
4. feature-store.savePickFeatures({ pickId, gamePk, features, ... })
   → INSERT en pick_features
5. Si SHADOW_MODE_ENABLED:
   shadow-model.recordShadowModelRun({ pickId, gamePk, oracle_pick, shadow_score, ... })
   → INSERT en shadow_model_runs
6. Response: { success, pick, pickId }
```

### 4.2 Análisis de un partido

```
1. Cliente: POST /api/analyze/game { gameId, mode, engine, lang }
2. Server: verifyToken + analysisLimiter (10 req/min) + deduct credits
3. mlb-api.getGameById(gameId) → gameData
4. odds-api.getGameOdds(gameId) → oddsData
5. context-builder.buildContext(gameData, oddsData) → { context, _features }
6. Si engine === 'dual': Promise.all([analyzeClaude(...), analyzeGrok(...)])
   Else: analyzeClaude(...) o analyzeGrok(...)
7. xgboostValidator.calculateParallelScore(_features.statcast, gameData)
   → comparar con LLM pick → marcar engine_meta.divergence
8. Response: { success, data: { master_prediction, oracle_report, probability_model, kelly_recommendation, engine_meta }, credits }
```

### 4.3 Resolución de pick (job)

```
setInterval cada 30 min entre 7pm-6am ET:
1. SELECT * FROM picks WHERE result IS NULL AND game_pk IS NOT NULL
2. Por cada pick:
   a. mlb-api.getGameById(game_pk) → gameStatus
   b. Si Final: parsear box score
   c. Determinar resultado del pick (ML/RL/OU/Prop):
      - ML: home_score vs away_score
      - RL: spread cubierto
      - OU: total_runs vs over/under line
      - Props: stats individuales del player
   d. UPDATE picks SET result = '...', closing_odds = ?, clv = ?
   e. feature-store.updatePickFeatureResult({ pickId, result })
   f. Encolar postmortem (opcional)
```

### 4.4 Pipeline de contenido para X

```
1. Admin / cron: POST /api/admin/content/draft { type: 'pick_of_day', lang: 'es' }
2. contentDraftService.buildContentDraft({ type, lang, hexa_data })
   → Claude Haiku con prompt en x-content-prompts.js
3. INSERT en content_queue (status='draft', posts=JSONB, scheduled_for=NULL)
4. Admin aprueba: PATCH /api/admin/content/:id/approve
   → UPDATE content_queue SET status='approved', scheduled_for=NOW()
5. Worker setInterval cada 5 min (si X_AUTO_PUBLISH_ENABLED=1):
   a. SELECT * FROM content_queue WHERE status='approved' AND scheduled_for <= NOW()
   b. xPublisher.publishToX(posts) → OAuth 1.0a signed POST a /2/tweets
   c. UPDATE content_queue SET status='published', published_at=NOW()
```

### 4.5 Compra de créditos

```
1. Cliente: POST /api/nowpayments/checkout { planId: 'allstar' }
2. Server: verifyToken + verifyEmailVerified
3. Generar order_id; INSERT nowpayments_invoices (order_id, user_id, plan_id, credits, status='new')
4. POST a https://api.nowpayments.io/v1/invoice → invoice_url
5. Response: { url: invoice_url }
6. Usuario paga en hosted checkout de NowPayments
7. NowPayments → POST /api/nowpayments/webhook con HMAC-SHA512 en x-nowpayments-sig
8. verifySignature(body, secret) → si OK:
   a. Si status === 'finished':
      - UPDATE nowpayments_invoices SET status='completed' WHERE status<>'completed' (atómico)
      - UPDATE users SET credits = credits + plan.credits
      - Send email confirmación (opcional)
```

---

## 5. Stack técnico

### Backend
| Componente | Tecnología | Versión / nota |
|---|---|---|
| Runtime | Node.js | 20+, ESM (`"type": "module"`) |
| HTTP | Express | 4.21.1 |
| Security headers | Helmet | default config |
| CORS | cors | default config |
| Rate limit | express-rate-limit | global por IP |
| DB | PostgreSQL via `pg` | 8.20.0 pool |
| Auth | jsonwebtoken + bcryptjs | JWT 7d, bcrypt rounds=12 |
| Claude SDK | @anthropic-ai/sdk | 0.36.0 |
| xAI client | propio | [server/services/xaiClient.js](../server/services/xaiClient.js) |
| Email | Resend | 6.10.0 |
| Validation | manual | no zod/joi global |
| Tests | node:test (builtin) | solo parlayEngine cubierto |

### Frontend
| Componente | Tecnología | Versión |
|---|---|---|
| Framework | React + Vite | 18.3 + Vite 5 |
| UI | MUI + Emotion | MUI 6.1.6 |
| Animations | Framer Motion | 12.38.0 |
| Charts | Recharts | 3.8.1 |
| PWA | vite-plugin-pwa | 1.2.0 |
| Routing | react-router-dom | 7.x |
| State | local stores + hooks | sin Redux/Zustand global |

### Infra
| Componente | Tecnología | Notas |
|---|---|---|
| Hosting server | Railway | NixPacks, [railway.json](../railway.json) |
| Hosting client | Vercel | [client/vercel.json](../client/vercel.json) |
| DB | Railway addon o externo (Neon/Supabase) | via `DATABASE_URL` |
| CI/CD | (no configurado) | Railway auto-deploys de `main` |
| Logging | console.log/warn/error | sin Sentry/Datadog |
| Monitoring | (no configurado) | gap conocido |

### Integraciones
Detalle completo en [docs/integrations.md](integrations.md). Resumen:

| Servicio | Uso |
|---|---|
| Anthropic Claude | Oracle (Opus/Sonnet/Haiku) |
| xAI Grok | Oracle dual mode |
| MLB Stats API | Schedule, lineups, play-by-play, standings (gratis) |
| Baseball Savant | Statcast leaderboards CSV (gratis) |
| The Odds API | Líneas ML/RL/OU/props (key required, dual key fallback) |
| Open-Meteo | Weather de estadio (gratis) |
| Resend | Email transactional |
| NowPayments | Checkout cripto + IPN |
| X / Twitter | Publishing OAuth 1.0a |

---

## 6. Endpoints — vista panorámica

48 endpoints directos + 10 routers modulares. Resumen por dominio:

### Públicos
- `GET /api/games`, `GET /api/teams`, `GET /api/odds/today`, `GET /api/hexa/board`, `GET /api/savant/status`, `GET /api/settings/performance-public`, `GET /api/mlb/standings`.

### Auth (`/api/auth`)
- `POST /register`, `POST /login`, `GET /me`, `GET /is-admin`.
- `POST /send-verification`, `POST /verify-email`.
- `POST /forgot-password`, `POST /reset-password`.

### Bankroll (`/api/bankroll`)
- `GET /`, `POST /setup`, `POST /bet`, `PATCH /bet/:id`, `DELETE /bet/:id`.

### Análisis (`/api/analyze`)
- `POST /game` — single, modes `deep`/`safe`/`parlay`.
- `POST /parlay` — parlay legacy.
- `POST /parlay-synergy` — admin-only, feature flag.
- `POST /safe` — modo conservador.
- `POST /chat` (admin), `POST /chat-jornada` (admin), `POST /batch` (admin).
- `GET /api/parlay-architect/history`, `GET /api/parlay-architect/learnings`.

### Picks (`/api/picks`)
- `POST /`, `GET /`, `PATCH /:id`, `DELETE /:id`, `DELETE /` (bulk).
- `POST /live-progress`, `GET /resolve`, `POST /resolve-game`.
- `POST /:id/postmortem`, `GET /clv-stats`.

### Games & live
- `GET /api/games/:gamePk/live`, `GET /api/games/:gamePk/play-by-play`, `GET /api/games/:gamePk/highlights-link`, `GET /api/games/:gameId/context`.

### Payments
- `POST /api/nowpayments/checkout`, `POST /api/nowpayments/webhook`.

### Content API (read-only, API key)
- `GET /api/content/v1/games`, `/board`, `/picks`, `/insights`, `/performance`.

### Admin (`/api/admin`)
- `POST /grant-credits`.
- `GET /backtest-stats`, `POST /run-backtest`, `POST /regrade-backtest-props`, `GET /historical-games`.
- `GET /shadow-model`, `POST /shadow-model/...`.
- `GET /feature-store`, `POST /feature-store/backfill`.
- `GET /db/tables`, `GET /db/:table`.
- `GET /parlay-synergy/recent`, `POST /parlay-synergy/auto-resolve-all`.
- `GET /content/queue`, `POST /content/draft`, `POST /content/approve/:id`, `POST /content/publish/:id`.

### Utility
- `GET /api/savant/status`, `POST /api/savant/refresh`.

Para auth detallada de cada ruta, ver [docs/admin-and-ops.md](admin-and-ops.md).

---

## 7. Background jobs

Todos `setInterval` en [server/index.js](../server/index.js) al final del archivo. **No hay queue worker.**

| Job | Frecuencia | Ventana | Propósito |
|---|---|---|---|
| Statcast warm-up | una vez | startup +30s | Pre-carga Savant leaderboards |
| Statcast refresh | 6h | siempre | Refresca cache Savant |
| Line movement snapshot | 6h | 9am-7pm ET | Snapshot odds para CLV |
| Pick resolver | 30 min | 7pm-6am ET | Resuelve picks de juegos terminados |
| Closing line capture | 2h | 5pm-1am ET | Captura odds de cierre |
| Content auto-publish | 5 min | siempre (si flag on) | Publica drafts aprobados en X |

Decisión sobre por qué `setInterval` y no BullMQ: ver [docs/admin-and-ops.md](admin-and-ops.md).

---

## 8. Decisiones arquitectónicas

### ¿Por qué monorepo?
Server y client están acoplados al mismo dominio, comparten env vars y se deployan juntos. Un monorepo simplifica DX y onboarding sin necesidad de tooling adicional (Nx, Turborepo).

### ¿Por qué JavaScript en lugar de TypeScript?
Velocity inicial del proyecto. Migrar tiene costo no trivial sin beneficio inmediato. Decisión a revisitar cuando el equipo crezca.

### ¿Por qué migraciones embebidas en JS?
Idempotencia + zero-downtime + sin dependencia externa. Tradeoff: sin versioning ni rollback automático. Plan para migrar a `node-pg-migrate` o Drizzle está en backlog Tier A ([docs/roadmap.md](roadmap.md)).

### ¿Por qué LLM dual en lugar de un solo motor?
Observabilidad: cuando Claude y Grok divergen, es señal de baja confianza. Detección barata de "alucinación coherente". El ensemble real (meta-learner) es el próximo paso, dependiente del modelo Python entrenado.

### ¿Por qué Postgres y no Mongo / DynamoDB?
Picks, bankroll, payments, content queue son fundamentalmente relacionales con queries agregadas. JSONB cubre los casos con shape variable (oracle_report, probability_model, postmortem) sin sacrificar consistency.

### ¿Por qué NowPayments y no Stripe?
Mercado objetivo (LatAm + crypto-native). Stripe es opcional para añadir más adelante; el design del módulo de pagos permite añadir nuevos gateways como adapters.

### ¿Por qué OAuth 1.0a para X y no v2 OAuth 2.0?
Twitter requirió OAuth 1.0a para tweet creation cuando se implementó el publisher. Si X lanza un v2 OAuth 2.0 estable con permisos write, vale revisar.

### ¿Por qué Railway en lugar de AWS / GCP?
Velocity. Railway = `git push` + variables = production. AWS/GCP requieren ECS/Cloud Run + Terraform + setup de RDS. No justificable hasta escala >10k MAU.

### ¿Por qué hay un `live-feed.js` con polling y no WebSockets?
MLB Stats API no provee WebSocket público. El polling con cache de 20s es suficiente para refresh de score y play-by-play. Para una experiencia in-play más reactiva, evaluar Sportradar o Genius Sports (caros) — está en [docs/roadmap.md](roadmap.md) Tier B.

### ¿Por qué el "XGBoost validator" no es XGBoost?
Implementación inicial fue scoring determinístico para validar la idea sin invertir en pipeline ML. Con >500 picks resueltos, el siguiente sprint migra a XGBoost real en sidecar Python. Detalle en [docs/ml-pipeline.md](ml-pipeline.md).
