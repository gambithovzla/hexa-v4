# Integraciones externas — H.E.X.A. v4

Catálogo de todas las APIs externas que consume H.E.X.A.: qué se llama, cómo se autentica, qué se cachea, qué env vars usa.

---

## Tabla de contenido

1. [Anthropic Claude](#1-anthropic-claude)
2. [xAI Grok](#2-xai-grok)
3. [MLB Stats API](#3-mlb-stats-api)
4. [Baseball Savant (Statcast)](#4-baseball-savant-statcast)
5. [The Odds API](#5-the-odds-api)
6. [Open-Meteo (Weather)](#6-open-meteo-weather)
7. [Resend (Email)](#7-resend-email)
8. [NowPayments (Crypto)](#8-nowpayments-crypto)
9. [X / Twitter (Publishing)](#9-x--twitter-publishing)
10. [Resumen de env vars](#10-resumen-de-env-vars)

---

## 1. Anthropic Claude

**Wrapper:** `@anthropic-ai/sdk` 0.36.0, instanciado en [server/oracle.js](../server/oracle.js) (e instancias propias en `parlayEngine/llmClient.js` y `contentDraftService.js` para no acoplar al Oracle).

### Modelos usados

| Modelo | Alias en código | Uso | Max tokens |
|---|---|---|---|
| `claude-opus-4-7` | `premium` | Análisis premium (admin / planes top) | 10000 |
| `claude-sonnet-4-6` | `deep` | Default Oracle | 8000 |
| `claude-haiku-4-5-20251001` | `haiku` | Content drafts, postmortem | 1000 |

### Endpoints consumidos
- `POST https://api.anthropic.com/v1/messages` — único endpoint usado.

### Autenticación
- Header `x-api-key: $ANTHROPIC_API_KEY` (manejado por el SDK).

### Caching / rate limit
- **Sin caching de responses** (cada análisis es único por contexto).
- **Sin retry interno** explícito — el SDK maneja transients.
- Timeout configurable por request (default 120s para análisis profundo).

### Env vars
- `ANTHROPIC_API_KEY` (obligatoria).
- `CONTENT_DRAFT_MODEL` (opcional, default `claude-haiku-4-5-20251001`).

### Costo aproximado por modo
- `single (deep)`: ~$0.10 USD por análisis.
- `parlay-synergy`: ~$0.15-0.25 USD (LLM Architect con ~12k tokens input).
- `content draft`: ~$0.002 USD (Haiku).

---

## 2. xAI Grok

**Wrapper:** [server/services/xaiClient.js](../server/services/xaiClient.js) — cliente custom, **no SDK oficial**.

### Modelo usado
- `grok-4-fast-reasoning` (default, override con `XAI_ORACLE_MODEL`).
- `grok-4-fast-non-reasoning` (modo safe rápido, override con `XAI_SAFE_MODEL`).

### Endpoint consumido
- `POST https://api.x.ai/v1/chat/completions` (compatible con interfaz OpenAI).

### Autenticación
- Header `Authorization: Bearer $XAI_API_KEY`.

### Uso
- Modo `engine='grok'` o `engine='dual'` en `analyzeGame`.
- Chat admin (`/api/analyze/chat`, `/api/analyze/chat-jornada`) puede usar Grok.

### Env vars
- `XAI_API_KEY` (opcional, requerida solo para modos Grok / Dual).
- `XAI_ORACLE_MODEL` (override modelo).
- `XAI_SAFE_MODEL` (override modelo safe).

---

## 3. MLB Stats API

**Wrapper:** [server/mlb-api.js](../server/mlb-api.js).

### Base URL
- `https://statsapi.mlb.com/api/v1`

### Endpoints consumidos
- `/schedule?sportId=1&date={YYYY-MM-DD}` — juegos del día.
- `/teams` — catálogo de equipos.
- `/teams/{teamId}/stats?stats=season` — stats agregados.
- `/people/{playerId}/stats?stats=season&group=pitching` — pitcher stats.
- `/people/{playerId}/stats?stats=season&group=hitting` — batter stats.
- `/people/{playerId}/stats?stats=statsSingleSeason,gameLog` — gameLog para rolling.
- `/game/{gamePk}/boxscore` — boxscore final.
- `/game/{gamePk}/feed/live` (via `live-feed.js`) — play-by-play en vivo.
- `/standings?leagueId=103,104&season={YYYY}` — standings.
- `/game/{gamePk}/content` — highlights.

### Autenticación
- **Ninguna** — API pública gratuita.

### Caching
- `getTodayGames`: 10 min TTL en memoria.
- `getStandings`: 15 min TTL.
- `getLiveFeed`: 20 seg TTL.

### Fallback histórico
Cuando no hay datos en una temporada nueva (ej. inicio de season), busca en 3 temporadas anteriores (`HISTORICAL_SEASONS` constante).

### Timeout
- 10s con `AbortController`.

### Env vars
- Ninguna.

---

## 4. Baseball Savant (Statcast)

**Wrapper:** [server/savant-fetcher.js](../server/savant-fetcher.js).

### Base URL
- `https://baseballsavant.mlb.com/leaderboard/*` (CSV export endpoints)

### Endpoints consumidos
- `/leaderboard/expected_statistics` — xBA, xSLG, xwOBA (batter + pitcher).
- `/leaderboard/statcast` — exit velocity, hard hit %, barrel %.
- `/leaderboard/pitch-arsenal` — repertorio del pitcher.
- `/leaderboard/active-spin` — active spin %.
- `/leaderboard/percentiles` — percentiles globales.
- `/leaderboard/park_factors` — park factors por season.
- `/leaderboard/catcher-framing` — framing.
- `/leaderboard/fielding-oaa` — Outs Above Average.

### Autenticación
- **Ninguna** — público.

### Caching
- **6 horas TTL en memoria.**
- **Warm-up al startup** (delay 30s, `server/index.js`).
- **Refresh periódico cada 6h** (setInterval).
- Endpoint admin: `POST /api/savant/refresh` para invalidar manualmente.

### Season window
- 5 años históricos hacia atrás (`getSeasonWindow`).

### Env vars
- Ninguna.

---

## 5. The Odds API

**Wrapper:** [server/odds-api.js](../server/odds-api.js).

### Base URL
- `https://api.the-odds-api.com/v4`

### Endpoints consumidos
- `/sports/baseball_mlb/odds?regions=us&markets=h2h,spreads,totals` — moneyline, run line, totals.
- `/sports/baseball_mlb/events/{eventId}/odds?markets=batter_hits,pitcher_strikeouts` — player props específicos por evento.

### Autenticación
- Query param `apiKey=$ODDS_API_KEY`.

### Dual key fallback
- Si `ODDS_API_KEY` agota créditos (header `X-Requests-Remaining: 0`), salta automáticamente a `ODDS_API_BACKUP_KEY`.
- Switching logic en `getGameOdds()`.

### Caching
- **60 min TTL en memoria** para `full markets` y `prop markets` (`CACHE_TTL_MS = 60 * 60 * 1000`).
- Key: `${date}::${sportKey}::${eventId?}`.

### Sport key
- Solo `baseball_mlb`. **Sin NBA/NFL/Soccer/NHL hoy** (expansión está en backlog Tier B).

### Player props
- `normalizePlayerProps()`: consenso de top-3 books, descarta outliers.
- Mercados soportados: `batter_hits`, `pitcher_strikeouts`, otros opcionales.
- **No alternate lines, no F5.**

### Spring training fallback
- `isSpringTraining()`: si la fecha está antes del Opening Day, retorna mock odds estimados basados en stats de temporada anterior.

### Costo
- The Odds API tiene tiers: free (500 req/mes), starter ($9/mes 20k req), plus, premium.
- Una request a `/odds` cuesta 1 crédito por mercado regional consultado.

### Env vars
- `ODDS_API_KEY` (obligatoria para datos reales).
- `ODDS_API_BACKUP_KEY` (opcional, fallback automático).

---

## 6. Open-Meteo (Weather)

**Wrapper:** [server/weather-api.js](../server/weather-api.js).

### Base URL
- `https://api.open-meteo.com/v1/forecast`

### Endpoints consumidos
- `/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,relativehumidity_2m&start_date={date}&end_date={date}&timezone=auto`

### Autenticación
- **Ninguna** — API pública gratuita.

### Datos extraídos
- Temperatura (°F convertida desde °C).
- Wind speed (mph) y dirección (grados → categoría compass).
- Precipitación %.
- Humedad relativa.
- Weather code (mapeado a "soleado", "nublado", "lluvia", etc).

### Indoor stadiums detection
- 8 estadios cubiertos en `STADIUM_COORDS` hardcoded (con techos retráctiles o domos).
- Si el juego es indoor: weather flags se ignoran en el análisis.

### Stadium coords
- 30 equipos MLB con `{lat, lon, indoor}` hardcoded.
- Aliases para franquicias renombradas / mudadas (ej. Cleveland Indians → Guardians).

### Caching
- 60 min TTL en memoria por `gamePk`.

### Env vars
- Ninguna.

---

## 7. Resend (Email)

**Wrapper:** [server/email.js](../server/email.js).

### Base URL
- (manejado por SDK `resend` 6.10.0)

### Emails enviados

| Trigger | Template | Asunto |
|---|---|---|
| Signup | Verification code | "H.E.X.A. — Confirma tu email" |
| Password reset request | Reset code | "H.E.X.A. — Código para restablecer contraseña" |
| Pago confirmado (planeado, no activo aún) | Confirmation | "H.E.X.A. — Créditos acreditados" |

### Templates
- HTML inline en `email.js` con branding HEXA (colors `#0a0e1a`, `#00D9FF`, `#FF6600`).
- Sin templates externos por ahora.

### From address
- `EMAIL_FROM` env var, default `H.E.X.A. Oracle <noreply@hexaoracle.lat>`.

### Caching / rate limit
- Cooldown 60s entre password reset requests por user (anti-abuse).

### Env vars
- `RESEND_API_KEY` (obligatoria si email verification activa).
- `EMAIL_FROM` (opcional).

---

## 8. NowPayments (Crypto)

**Wrappers:** [server/nowpayments.js](../server/nowpayments.js), [server/nowpayments-webhook.js](../server/nowpayments-webhook.js).

### Base URL
- Production: `https://api.nowpayments.io`
- Sandbox: `https://api-sandbox.nowpayments.io` (configurable con `NOWPAYMENTS_API_BASE`).

### Endpoints consumidos
- `POST /v1/invoice` — crea invoice hosted para checkout cripto.

### Autenticación
- Header `x-api-key: $NOWPAYMENTS_API_KEY`.

### Flujo checkout
1. Cliente: `POST /api/nowpayments/checkout` con `{ planId }`.
2. Server: verifica email_verified, genera `order_id`, INSERT en `nowpayments_invoices` con `status='new'`.
3. Server llama a NowPayments con:
   ```json
   {
     "price_amount": 19.99,
     "price_currency": "usd",
     "order_id": "hexa-{userId}-{timestamp}",
     "order_description": "H.E.X.A. - All-Star plan (50 credits)",
     "ipn_callback_url": "https://<host>/api/nowpayments/webhook",
     "success_url": "<FRONTEND_URL>/payment/success",
     "cancel_url": "<FRONTEND_URL>/payment/cancel"
   }
   ```
4. Response incluye `invoice_url` que se devuelve al cliente para redirigir.

### IPN webhook (HMAC-SHA512)
- NowPayments envía `POST /api/nowpayments/webhook` cuando cambia el estado.
- Signature en header `x-nowpayments-sig`, computada como `HMAC-SHA512(body_sorted_alphabetically_by_keys, $NOWPAYMENTS_IPN_SECRET)`.
- Verificación: `verifySignature()` reconstruye el HMAC y compara.

### Estados
- `waiting` — esperando pago.
- `confirming` — pago detectado, confirmando blockchain.
- `confirmed` — confirmado on-chain.
- `sending` — convirtiendo cripto a fiat (si aplica).
- `partially_paid` — usuario pagó menos.
- `finished` — completado, **único estado que acredita**.
- `failed`, `refunded`, `expired` — fail states.

### Idempotencia
- Acreditación con `UPDATE ... WHERE status <> 'completed'` (gate atómico).
- Doble webhook genera 0 acreditaciones extra.

### Planes
- Definidos en [server/plans.js](../server/plans.js): Rookie $7.99/15cr, All-Star $19.99/50cr, MVP $39.99/120cr.

### Env vars
- `NOWPAYMENTS_API_KEY` (obligatoria).
- `NOWPAYMENTS_IPN_SECRET` (obligatoria).
- `NOWPAYMENTS_API_BASE` (opcional, para sandbox).

---

## 9. X / Twitter (Publishing)

**Wrapper:** [server/services/xPublisher.js](../server/services/xPublisher.js).

### Base URL
- `https://api.x.com` (override con `X_API_BASE_URL`).

### Endpoints consumidos
- `POST /2/tweets` — publicar un tweet (single o como reply para threads).

### Autenticación: OAuth 1.0a HMAC-SHA1

Genera header `Authorization: OAuth ...` con:
- `oauth_consumer_key=$X_CONSUMER_KEY`
- `oauth_nonce` (random hex 16 bytes)
- `oauth_signature` (HMAC-SHA1 de signature base string)
- `oauth_signature_method=HMAC-SHA1`
- `oauth_timestamp` (unix seconds)
- `oauth_token=$X_ACCESS_TOKEN`
- `oauth_version=1.0`

Signature base: `POST&{encoded_url}&{encoded_params}` firmado con clave `{encodedConsumerSecret}&{encodedAccessSecret}`.

### Threads
- Posts secuenciales con `reply.in_reply_to_tweet_id` apuntando al tweet anterior.
- Soporte máximo: 5-6 posts por thread.

### Auto-publish worker
- `setInterval` cada `X_AUTO_PUBLISH_INTERVAL_MINUTES` (default 5 min) cuando `X_AUTO_PUBLISH_ENABLED=1`.
- Query: `SELECT * FROM content_queue WHERE status='approved' AND scheduled_for <= NOW()`.
- Publica + UPDATE status to `published`.

### Rate limits de X
- API v2 standard: 300 tweets / 3h por user. Más que suficiente para el caso de uso (1-5 posts/día).

### No soportado hoy
- Imágenes (`media.media_ids`).
- Video.
- OAuth 2.0 PKCE.

### Env vars
- `X_CONSUMER_KEY`
- `X_CONSUMER_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`
- `X_AUTO_PUBLISH_ENABLED` (`0`/`1`)
- `X_AUTO_PUBLISH_INTERVAL_MINUTES` (default 5)
- `X_API_BASE_URL` (override)

---

## 10. Resumen de env vars

Lista completa en [.env.example](../.env.example). Agrupadas aquí por dominio:

### Core (obligatorias)
```
ANTHROPIC_API_KEY=
DATABASE_URL=
JWT_SECRET=
ODDS_API_KEY=
```

### LLM extra
```
XAI_API_KEY=
XAI_ORACLE_MODEL=grok-4-fast-reasoning
XAI_SAFE_MODEL=grok-4-fast-non-reasoning
CONTENT_DRAFT_MODEL=claude-haiku-4-5-20251001
```

### Odds backup
```
ODDS_API_BACKUP_KEY=
```

### Email
```
RESEND_API_KEY=
EMAIL_FROM=H.E.X.A. Oracle <noreply@hexaoracle.lat>
```

### Payments
```
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=
NOWPAYMENTS_API_BASE=https://api.nowpayments.io
```

### X publishing
```
X_CONSUMER_KEY=
X_CONSUMER_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=
X_AUTO_PUBLISH_ENABLED=0
X_AUTO_PUBLISH_INTERVAL_MINUTES=5
```

### Content API pública
```
CONTENT_API_KEYS=socialmedia:replace_me,bot:replace_me
```

### Feature flags
```
SHADOW_MODE_ENABLED=true
SHADOW_MODE_MODEL_KEY=hexa_xgb_v1
SHADOW_MODE_MODEL_VERSION=1.0.0
PARLAY_SYNERGY_ENABLED=false
```

### Server config
```
PORT=3001
NODE_ENV=development
FRONTEND_URL=https://hexa-v4.vercel.app
```

### Futuras (Sprint 2+)
```
HEXA_ML_API_URL=
HEXA_ML_INTERNAL_TOKEN=
ML_SIDECAR_ENABLED=false
ENSEMBLE_ENABLED=false
```

---

## Cómo añadir una nueva integración

1. Crear archivo wrapper en `server/<service-name>-api.js` o `server/services/<serviceName>Client.js`.
2. Implementar:
   - Constructor con baseURL desde env var.
   - Función `fetch` interna con `AbortController` + timeout.
   - Caching en memoria si aplica (TTL configurable).
   - Error handling con `console.error('[service-name] ...')`.
3. Documentar env vars en `.env.example` con comentario explicando uso.
4. Añadir sección en este documento.
5. Si requiere webhook: crear ruta + middleware de verificación de signature.
6. Test manual con `curl` antes de merge.

---

**Última actualización**: Sprint 0. Próxima revisión cuando entre el sidecar Python como nueva integración (Sprint 2).
