# Content Pipeline — H.E.X.A. v4

Pipeline editorial automatizado: genera borradores con Claude Haiku, los encola, y los publica en X (Twitter) vía OAuth 1.0a.

---

## Tabla de contenido

1. [Vista general](#1-vista-general)
2. [Tipos de contenido](#2-tipos-de-contenido)
3. [Flujo end-to-end](#3-flujo-end-to-end)
4. [Generación de drafts](#4-generación-de-drafts)
5. [Queue editorial](#5-queue-editorial)
6. [Publisher X (OAuth 1.0a)](#6-publisher-x-oauth-10a)
7. [Content API pública (read-only)](#7-content-api-pública-read-only)
8. [Configuración](#8-configuración)
9. [Roadmap multi-plataforma](#9-roadmap-multi-plataforma)

---

## 1. Vista general

```
┌──────────────────────────────────────────────────────────────────┐
│  Trigger: admin manual o cron diario                             │
│  (ej. cada mañana 6am ET: generar "pick_of_day" + "thread_daily")│
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  contentDraftService.buildContentDraft({ type, lang })           │
│  ├─ Recupera datos de Hexa (board, picks recientes, postmortems) │
│  ├─ Llama a Claude Haiku con prompt específico                   │
│  └─ Output: { posts: [{ text }, ...] }                           │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  contentQueueService.queueDraft(...)                             │
│  └─ INSERT en content_queue (status='draft', posts JSONB, ...)   │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Admin revisa en /admin/content/queue                            │
│  Aprueba: POST /api/admin/content/approve/:id                    │
│  └─ UPDATE status='approved', scheduled_for=NOW() (o futuro)     │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Worker setInterval cada 5 min (X_AUTO_PUBLISH_ENABLED=1):       │
│  ├─ SELECT * FROM content_queue WHERE status='approved'          │
│  │   AND scheduled_for <= NOW()                                  │
│  ├─ xPublisher.publishToX(posts)                                 │
│  │   OAuth 1.0a signed POST a /2/tweets                          │
│  └─ UPDATE status='published', published_at=NOW()                │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                       X / Twitter                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Tipos de contenido

Definidos en `contentDraftService.js` (`SUPPORTED_TYPES`):

| Tipo | Formato | Frecuencia ideal | Datos que ingiere |
|---|---|---|---|
| `pick_of_day` | Single post (≤280 chars) | 1/día (mañana) | Pick destacado del día con mayor edge / xgb_agreement |
| `thread_daily` | Thread 4-6 posts | 1/día (~10am ET) | Todo el slate del día con tesis macro |
| `postmortem` | Thread 2-3 posts | Por juego ganado relevante | Resultado + análisis retrospectivo |
| `weekly_recap` | Thread 4-5 posts | 1/semana (lunes) | Win rate, ROI, top hits/misses |

### Lenguajes
- `es` (español, default).
- `en` (inglés, opcional).
- Cada tipo se puede generar en cualquiera de los 2.

### Prompts
Todos en [server/prompts/x-content-prompts.js](../server/prompts/x-content-prompts.js):
- `SYSTEM_PICK_OF_DAY`
- `SYSTEM_THREAD_DAILY`
- `SYSTEM_POSTMORTEM`
- `SYSTEM_WEEKLY_RECAP`

Cada uno define tono, restricciones (charcount, no spoilers, no consejos financieros explícitos), y formato JSON esperado:
```json
{
  "posts": [
    { "text": "..." },
    { "text": "..." }
  ]
}
```

---

## 3. Flujo end-to-end

### 3.1 Generación

```js
import { buildContentDraft } from './services/contentDraftService.js';

const draft = await buildContentDraft({
  type: 'pick_of_day',
  lang: 'es',
  context: {
    board: hexaBoardData,         // del hexaBoardService
    recentPicks: lastNPicks,
    insights: hexaInsightsData,
  },
});

// draft = {
//   type: 'pick_of_day',
//   lang: 'es',
//   posts: [{ text: 'Pick del día: ...' }],
//   model: 'claude-haiku-4-5-20251001',
//   generated_at: '2026-05-12T...'
// }
```

### 3.2 Encolar

```js
import { queueDraft } from './services/contentQueueService.js';

const queueId = await queueDraft({
  type: draft.type,
  lang: draft.lang,
  posts: draft.posts,
  model: draft.model,
  status: 'draft',
  scheduled_for: null,  // se llena al aprobar
});
```

### 3.3 Revisar y aprobar (admin)

UI admin lista filas con `status='draft'`. Admin puede editar el texto antes de aprobar.

```
POST /api/admin/content/approve/:id
Body: { scheduled_for: '2026-05-12T14:00:00Z' }  // opcional, default NOW()
```

### 3.4 Publicar (worker)

Worker corre cada `X_AUTO_PUBLISH_INTERVAL_MINUTES` (default 5).

```js
// pseudocódigo del worker
async function publishQueueTick() {
  if (!process.env.X_AUTO_PUBLISH_ENABLED) return;

  const due = await pool.query(`
    SELECT * FROM content_queue
    WHERE status = 'approved' AND scheduled_for <= NOW()
    ORDER BY scheduled_for ASC
    LIMIT 5
  `);

  for (const row of due.rows) {
    try {
      await xPublisher.publishToX(row.posts);
      await pool.query(
        `UPDATE content_queue SET status='published', published_at=NOW() WHERE id = $1`,
        [row.id]
      );
    } catch (err) {
      console.error(`[content-publisher] failed for queue.id=${row.id}: ${err.message}`);
      await pool.query(
        `UPDATE content_queue SET status='failed', error_message=$2 WHERE id=$1`,
        [row.id, err.message]
      );
    }
  }
}
```

---

## 4. Generación de drafts

**Archivo:** [server/services/contentDraftService.js](../server/services/contentDraftService.js).

### 4.1 API

```js
export async function buildContentDraft({
  type,        // 'pick_of_day' | 'thread_daily' | 'postmortem' | 'weekly_recap'
  lang,        // 'es' | 'en'
  context,     // object con datos del board, picks, insights
}) { /* ... */ }
```

### 4.2 Modelo usado
- Default: `claude-haiku-4-5-20251001` (override con `CONTENT_DRAFT_MODEL`).
- Max tokens: 1000.
- Temperature: ligeramente alta (~0.7) para variedad.

### 4.3 Validación de output

Manual:
1. Parse JSON.
2. Validar shape (`posts` es array, cada uno tiene `text` string).
3. Validar charcount por post (≤280 para X, dejar buffer de 10 chars).
4. Detectar y rechazar si Claude se sale del personaje (ej. "como modelo de IA...").

Si falla validación: retry una vez con prompt más estricto, sino marca el draft como `status='failed'`.

### 4.4 Anti-duplicate

- Hash del primer post: si existe en `content_queue` con `published_at` reciente (<24h), descartar.
- Logging del hash para detectar patrones repetitivos.

---

## 5. Queue editorial

**Archivo:** [server/services/contentQueueService.js](../server/services/contentQueueService.js).

### 5.1 Tabla `content_queue`

```sql
CREATE TABLE content_queue (
  id              BIGSERIAL PRIMARY KEY,
  type            VARCHAR(32) NOT NULL,
  lang            VARCHAR(8) DEFAULT 'es',
  status          VARCHAR(16) DEFAULT 'draft',
  posts           JSONB NOT NULL,
  model           VARCHAR(48),
  scheduled_for   TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      VARCHAR(64)
);

CREATE INDEX idx_content_queue_status ON content_queue(status);
CREATE INDEX idx_content_queue_scheduled ON content_queue(scheduled_for) WHERE status='approved';
```

### 5.2 Estados

| Estado | Significado | Transitable a |
|---|---|---|
| `draft` | Recién generado, pendiente de revisión | `approved`, `rejected` |
| `approved` | Aprobado por admin, listo para publicar | `published`, `failed` |
| `rejected` | Admin descartó el draft | (terminal) |
| `published` | Posteado en X exitosamente | (terminal) |
| `failed` | Error al publicar | `approved` (retry manual) |

### 5.3 Operaciones admin

```
GET    /api/admin/content/queue           # listar drafts pendientes
POST   /api/admin/content/draft           # generar nuevo draft
PATCH  /api/admin/content/:id             # editar texto del draft
POST   /api/admin/content/:id/approve     # marcar approved
POST   /api/admin/content/:id/reject      # marcar rejected
POST   /api/admin/content/:id/publish     # publicar inmediato (skip queue)
DELETE /api/admin/content/:id             # eliminar
```

---

## 6. Publisher X (OAuth 1.0a)

**Archivo:** [server/services/xPublisher.js](../server/services/xPublisher.js).

### 6.1 OAuth 1.0a — por qué

Twitter API v2 requirió OAuth 1.0a para tweet creation cuando se implementó. (OAuth 2.0 PKCE estuvo limitado a algunos endpoints.) El módulo está diseñado para reemplazar fácilmente si X habilita v2 OAuth 2.0 estable con permisos write.

### 6.2 Implementación de signature

```js
function buildOAuth1Header({ method, url, params, consumerKey, consumerSecret, accessToken, accessSecret }) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  // Signature base string
  const allParams = { ...oauthParams, ...params };
  const sortedParamString = Object.keys(allParams).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');
  const baseString = [method, encodeURIComponent(url), encodeURIComponent(sortedParamString)].join('&');

  // Signing key
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(accessSecret)}`;

  // HMAC-SHA1
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  // Build header
  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
}
```

### 6.3 Threads

Posts secuenciales con `reply.in_reply_to_tweet_id`:

```js
async function publishToX(posts) {
  const tweetIds = [];
  let inReplyTo = null;

  for (const post of posts) {
    const body = inReplyTo
      ? { text: post.text, reply: { in_reply_to_tweet_id: inReplyTo } }
      : { text: post.text };

    const res = await postTweet(body);
    tweetIds.push(res.data.id);
    inReplyTo = res.data.id;

    // Pausa entre posts (anti rate limit)
    await sleep(1000);
  }

  return tweetIds;
}
```

### 6.4 Error handling

- HTTP 401 → credenciales inválidas (logging + alerta admin).
- HTTP 403 → permisos insuficientes en la app de X.
- HTTP 429 → rate limited. Retry con backoff exponencial (max 3 intentos).
- HTTP 5xx → retry con backoff.

---

## 7. Content API pública (read-only)

**Archivo:** [server/routes/content.js](../server/routes/content.js).

API para consumidores externos (bots de Telegram, integraciones de social media, alertas).

### Autenticación
- Header `x-api-key: <token>` o query param `?api_key=<token>`.
- Tokens definidos en env var `CONTENT_API_KEYS` formato `label:secret,label2:secret2`.
- Middleware: [server/middleware/content-api-key.js](../server/middleware/content-api-key.js).

### Endpoints

| Endpoint | Devuelve |
|---|---|
| `GET /api/content/v1/games?date=YYYY-MM-DD` | Juegos del día con metadata pública |
| `GET /api/content/v1/board` | Hexa Board del día |
| `GET /api/content/v1/picks?date=YYYY-MM-DD` | Picks públicos resueltos |
| `GET /api/content/v1/insights` | Top insights / wins de la semana |
| `GET /api/content/v1/performance` | Stats agregadas públicas |

### Rate limiting
- `contentLimiter`: 120 req/min por IP (más alto que el rate limit general porque consumidores autorizados son bots).

### Gating de stats
- `GET /api/picks/public-stats` (endpoint legacy en [server/routes/picks.js](../server/routes/picks.js)) usa `gatePublicStats()` que verifica si las stats están habilitadas en `app_settings.performance_public`.

---

## 8. Configuración

### Env vars relevantes

```
# Modelo para drafts (default Haiku)
CONTENT_DRAFT_MODEL=claude-haiku-4-5-20251001

# X / Twitter OAuth 1.0a credentials
X_CONSUMER_KEY=
X_CONSUMER_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=

# X API base URL (override para staging si necesitas)
X_API_BASE_URL=https://api.x.com

# Auto-publish worker
X_AUTO_PUBLISH_ENABLED=0     # 0 = off, 1 = on
X_AUTO_PUBLISH_INTERVAL_MINUTES=5

# Content API pública
CONTENT_API_KEYS=socialmedia:secret_xxx,telegram_bot:secret_yyy
```

### Setup inicial de X app

1. Crear app en https://developer.x.com.
2. Configurar permisos `Read + Write`.
3. Generar Consumer Keys + Access Tokens & Secrets.
4. Pegar las 4 keys en `.env`.
5. **Importante**: si regeneras Access Tokens, el contenido publicado previamente sigue activo pero el worker dejará de poder postear hasta que actualices la env var.

### Setup de Content API consumers

1. Generar token aleatorio: `openssl rand -hex 32`.
2. Añadir a `CONTENT_API_KEYS=label:token`.
3. Documentar el token con el consumidor.
4. Si se compromete: regenerar y revocar el viejo.

---

## 9. Roadmap multi-plataforma

Hoy solo X. En backlog Tier S/A ([docs/roadmap.md](roadmap.md)):

### 9.1 Telegram channel publisher

**Esfuerzo**: ~3 días.

Reusar `contentDraftService` (mismos drafts) + nuevo adapter `telegramPublisher.js`:
- Bot token de @BotFather.
- Endpoint: `https://api.telegram.org/bot{token}/sendMessage`.
- Para threads: enviar mensajes consecutivos con `reply_to_message_id`.
- Markdown / HTML formatting permitido (más rico que X).

Drafts pueden requerir variante (`type: 'pick_of_day_telegram'`) para aprovechar el espacio extra (Telegram no tiene límite 280).

### 9.2 Newsletter weekly recap

**Esfuerzo**: ~3 días.

Reusar `weekly_recap` content type + Resend para email:
- Tabla `newsletter_subscribers` con email, opted_in_at, unsubscribed_at.
- Template HTML con CSS inline (mismo branding HEXA).
- Endpoint `POST /api/newsletter/subscribe` (público con captcha).
- Worker semanal (lunes 10am ET) que itera suscriptores y envía con Resend.

### 9.3 Discord bot

**Esfuerzo**: ~1 semana.

Crear bot Discord con discord.js:
- Servidor Discord propio HEXA + invites para usuarios premium.
- Comandos slash: `/today`, `/pick {gameId}`, `/board`, `/leaders`.
- Webhook para auto-post drafts en canal específico.

### 9.4 Threads (Meta)

**Esfuerzo**: ~1 semana (depende del API release).

Meta lanzó Threads API mid-2024. Investigar permisos y limits. Si es viable, adapter `threadsPublisher.js` similar a `xPublisher.js`.

### 9.5 Infografías auto-generadas

**Esfuerzo**: ~1.5 semanas.

Generar imágenes de stats / picks para acompañar posts:
- Recharts → render server-side con `react-to-image` o `puppeteer`.
- Upload a S3-compatible (Cloudflare R2).
- Anexar URL al post X / Telegram.

Mucho impacto visual pero costo de complejidad: hay que mantener templates de imagen y CDN.

---

## Métricas que vale trackear

Para evaluar el pipeline:

- **Throughput**: drafts generados / día por tipo.
- **Approval rate**: % de drafts aprobados vs rechazados (si es bajo, el prompt necesita ajuste).
- **Time to publish**: promedio entre `created_at` y `published_at`.
- **Engagement** (manual o vía X API): replies, retweets, impressions.
- **Failure rate**: % de drafts con status `failed` (target < 1%).
- **Spend**: cost de tokens Haiku × volumen.

---

**Última actualización**: Sprint 0. Multi-plataforma queda en backlog.
