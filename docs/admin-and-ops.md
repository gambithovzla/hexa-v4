# Admin & Ops — H.E.X.A. v4

Operación, observabilidad, herramientas admin, jobs, deployment, monitoring.

---

## Tabla de contenido

1. [Roles y permisos](#1-roles-y-permisos)
2. [Admin DB Explorer](#2-admin-db-explorer)
3. [Backtest engine](#3-backtest-engine)
4. [Shadow Model dashboard](#4-shadow-model-dashboard)
5. [Feature Store inspection](#5-feature-store-inspection)
6. [Otros endpoints admin](#6-otros-endpoints-admin)
7. [Background jobs (cron)](#7-background-jobs-cron)
8. [Logging](#8-logging)
9. [Rate limiting](#9-rate-limiting)
10. [Deployment](#10-deployment)
11. [Monitoring gaps](#11-monitoring-gaps)
12. [Audit script](#12-audit-script)

---

## 1. Roles y permisos

Hoy solo hay 2 roles:

| Rol | Identificador | Capacidades |
|---|---|---|
| Usuario regular | `users.is_admin = false` | Crear picks (con email verificado), comprar créditos, ver historial |
| Admin | `users.is_admin = true` | Todo lo del usuario + `/api/admin/*`, bypass email_verified, modos chat, batch backtest |

**Sin tiers de pago** (no hay free/premium gates explícitos; gating es por créditos). Plan en backlog: tiers reales con rate limits y features distintas.

### Cómo otorgar admin

Editar directamente en DB:
```sql
UPDATE users SET is_admin = true WHERE email = 'cdrr1992@gmail.com';
```

O usar `seedAdminUser()` en [server/auth.js](../server/auth.js) (corre al startup si env var `SEED_ADMIN_EMAIL` está set).

### Middleware
- `verifyToken` ([server/middleware/auth-middleware.js](../server/middleware/auth-middleware.js)) — verifica JWT.
- `requireAdmin` — verifica `req.user.is_admin === true`.
- `requireVerifiedEmail` — verifica `users.email_verified === true` (admin bypass).
- `verifyContentApiKey` ([server/middleware/content-api-key.js](../server/middleware/content-api-key.js)) — API key para Content API pública.

---

## 2. Admin DB Explorer

**Archivo:** [server/admin-db-explorer.js](../server/admin-db-explorer.js).

Browser read-only para inspeccionar la base. Diseñado para auditoría y debugging sin necesidad de conectarse a Postgres directamente.

### Endpoints
```
GET /api/admin/db/tables           # lista de tablas disponibles
GET /api/admin/db/:table?limit=100&offset=0&col1=val1
```

### Whitelist por tabla

Solo tablas y columnas en `TABLE_CONFIG` son accesibles. Patrón:

```js
const TABLE_CONFIG = {
  users: {
    columns: ['id', 'email', 'credits', 'is_admin', 'email_verified', 'created_at'],
    searchable: ['email'],
    filterable: { id: 'int', email: 'text', is_admin: 'bool' },
  },
  picks: {
    columns: [
      'id', 'user_id', 'user_email', 'type', 'matchup', 'pick',
      'oracle_confidence', 'bet_value', 'model_risk', 'result',
      'odds_at_pick', 'closing_odds', 'clv', 'kelly_recommendation',
      'game_pk', 'game_date', 'postmortem_summary', 'created_at', 'deleted_at'
    ],
    searchable: ['matchup', 'pick', 'postmortem_summary'],
    filterable: { user_id: 'int', type: 'text', result: 'text', game_pk: 'int' },
  },
  // ... bets, bankroll, odds_snapshots, pending_credits, nowpayments_invoices
};
```

### Columnas explícitamente NUNCA expuestas
- `users.password_hash`
- `users.verification_code`, `users.verification_expires`
- `users.reset_code_hash`, `users.reset_code_expires`
- Cualquier campo secreto/cifrado.

### Frontend
- Componente `AdminDbExplorerPanel.jsx` en [client/src/components/](../client/src/components/).
- Tabla con paginación, filtros por columna, búsqueda.

---

## 3. Backtest engine

### Endpoints admin
```
GET  /api/admin/backtest-stats            # agregaciones de runs históricos
GET  /api/admin/historical-games          # juegos para backtest
POST /api/admin/run-backtest              # dispara run desde UI
POST /api/admin/regrade-backtest-props    # re-evalúa props con stats actualizadas
```

### CLI
```bash
node scripts/training/run-backtest.js 2026-04-01                # un día
node scripts/training/run-backtest.js 2026-04-01 --dry-run
node scripts/training/run-backtest.js 2026-04-01 --max=5

node scripts/training/historical-fetcher.js 2026-04-01          # solo trae lista
```

### Tabla `backtest_results`
```
id, run_id, historical_date, game_pk, pick_type,
oracle_pick, predicted_winner, predicted_confidence,
actual_home_score, actual_away_score, actual_winner,
oracle_correct (BOOLEAN), edge_pct,
alert_flags JSONB, has_critical_flags BOOLEAN,
created_at
```

### Costo
- Cada run de backtest llama al LLM en modo `safe` (admin, 0 créditos en producción).
- Tokens: ~1500 input + 500 output → ~$0.01 por juego con Sonnet.
- 30 días × 15 juegos/día = 450 calls = ~$4.50 por mes histórico.

---

## 4. Shadow Model dashboard

### Endpoints
```
GET /api/admin/shadow-model           # últimas N runs
GET /api/admin/shadow-model/stats     # métricas agregadas
```

### Métricas reportadas
- **Total runs**: cantidad de picks con shadow comparison.
- **Agreement rate**: % en que shadow y oracle predicen lo mismo.
- **Cuando divergen**: hit rate del oracle vs del shadow.
- **Confidence distribution**: distribución de `shadow_confidence`.

### Sprint 3 lo amplía con:
- Comparativa contra modelo Python entrenado.
- Calibración por bucket de probabilidad.
- ROI rolling por fuente (oracle / shadow simulado / python model).

Detalle: [docs/ml-pipeline.md](ml-pipeline.md).

---

## 5. Feature Store inspection

### Endpoints
```
GET  /api/admin/feature-store?month=YYYY-MM      # features de picks del mes
POST /api/admin/feature-store/backfill           # rellena features faltantes
```

### Uso típico
- Inspeccionar manualmente qué features fueron persistidas para un pick específico.
- Identificar huecos (features null que deberían tener valor).
- Validar antes de exportar dataset para training.

### Output JSON
- Máximo 750 registros por request (paginación pendiente).
- Incluye JOIN con `picks` para asociar features ↔ resultado.

### Sprint 1 añade
- Endpoint `POST /api/admin/feature-store/export` que dispara `scripts/training/export-dataset.js` y retorna URL de descarga al Parquet.

---

## 6. Otros endpoints admin

### Grant credits
```
POST /api/admin/grant-credits
Body: { userId, credits, reason }
```
Útil para soporte (compensar errores, regalar trial, etc).

### Parlay Synergy admin
```
GET  /api/admin/parlay-synergy/recent             # últimas runs
POST /api/admin/parlay-synergy/auto-resolve-all   # resolver pendientes
GET  /api/admin/parlay-synergy/performance        # métricas (al integrar resolver)
```

### Content queue admin
```
GET    /api/admin/content/queue
POST   /api/admin/content/draft
PATCH  /api/admin/content/:id
POST   /api/admin/content/:id/approve
POST   /api/admin/content/:id/reject
POST   /api/admin/content/:id/publish
DELETE /api/admin/content/:id
```

### Settings públicos
```
GET /api/settings/performance-public          # qué stats están públicas
PUT /api/settings/performance-public          # toggle (admin)
```

### Savant cache
```
GET  /api/savant/status                       # estado del cache
POST /api/savant/refresh                      # invalidar manualmente
```

---

## 7. Background jobs (cron)

**Mecanismo:** `setInterval` en [server/index.js](../server/index.js) al final del archivo. **No hay queue worker** (BullMQ, Agenda, node-cron).

### Jobs activos

| Job | Schedule | Ventana ET | Propósito |
|---|---|---|---|
| Statcast warm-up | una vez | startup +30s | Pre-carga cache Savant |
| Statcast refresh | cada 6h | siempre | Refresca cache Savant |
| Line movement snapshot | cada 6h | 9am-7pm ET | Snapshots de odds |
| Pick resolver | cada 30 min | 7pm-6am ET | Resuelve picks de juegos terminados |
| Closing line capture | cada 2h | 5pm-1am ET | Captura odds de cierre |
| Content auto-publish | cada 5 min | siempre (si flag) | Publica drafts aprobados |

### Detección de horario ET
```js
function nowETHour() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  });
  return parseInt(fmt.format(new Date()), 10);
}
```

### Por qué setInterval en lugar de BullMQ

- **Velocity inicial**: sin Redis dependency, sin worker process separado.
- **Volumen actual**: ~6 jobs, frecuencia baja. Un proceso Node lo maneja sin problema.
- **Tradeoff**: si el server crashea durante un job, no se reintenta. Si escalamos a 2+ instancias del server, los jobs duplican.

### Migración a BullMQ está en backlog Tier B
Cuando ocurra cualquiera de:
- Escalar a 2+ instancias del server.
- Añadir jobs de alta frecuencia (>10/min).
- Necesitar retry/DLQ formal.

Plan: Redis (Railway addon) + BullMQ + worker process aparte.

---

## 8. Logging

### Stack actual
- `console.log/warn/error` solamente.
- Sin Sentry, Datadog, Loki, structured logging.

### Convención de prefijos
```js
console.log(`[odds-api] cache hit for ${date}`);
console.warn(`[odds-api] backup key activated (primary exhausted)`);
console.error(`[pick-resolver] failed to resolve pickId=${id}: ${err.message}`);
console.log(`[shadow] divergence: oracle=${oraclePick} shadow=${shadowPick}`);
console.log(`[parlay-synergy] composed top3 with scores: ${scores.join(', ')}`);
```

### Acceso a logs en Railway
- `railway logs` desde CLI.
- Web UI Railway → service → "Logs" tab.
- Logs retention: 7 días en plan free, más en planes pagados.

### Production safe errors
[server/index.js](../server/index.js) tiene helper `safeError(err)`:
- En `development`: retorna stack completo.
- En `production`: retorna solo `{ error: err.message }` sin stack.

### Gaps conocidos (backlog Tier B)
- Sin structured logging (pino, winston).
- Sin centralización (todos los logs en stdout, mezclados).
- Sin alerting automático (un error 5xx pasa desapercibido hasta que un usuario reporta).
- Sin Sentry (no agrupación, no fingerprinting de errores).

---

## 9. Rate limiting

**Middleware:** `express-rate-limit`.

### Rate limits actuales

```js
// Global, todas las rutas
const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,        // 60 req/min por IP
});

// Análisis (más restrictivo)
const analysisLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,        // 10 req/min por IP
});

// Content API pública
const contentLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,       // 120 req/min por IP
});
```

### Limitaciones conocidas
- **Scope**: por IP, no por user. Un usuario detrás de NAT con varios sharing puede saturarse; un usuario premium no tiene rate limit más alto que un free.
- **Sin escalado por tier**: free / paid / admin tienen mismos límites.
- **Sin penalización progresiva**: si saturas, esperas. No hay ban temporal por abuso.

### Migración planificada (backlog Tier A)
Rate limit per-user con tiers:
- Anonymous (sin login): 30/min.
- Free user: 60/min globally, 10/min analysis.
- Paid user: 120/min globally, 30/min analysis.
- Admin: ilimitado.

Implementación: usar `keyGenerator` custom basado en `req.user?.id || req.ip`.

---

## 10. Deployment

### API (Railway)

**Config:** [railway.json](../railway.json).

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "NIXPACKS" },
  "deploy": {
    "startCommand": "node index.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

- **Builder**: Nixpacks (Nix-based, detecta Node automáticamente).
- **Start**: `node index.js` (no PM2, no cluster).
- **Restart**: ON_FAILURE con max 10 retries.
- **Sin Dockerfile** (Nixpacks lo construye).

### Cliente (Vercel)

**Config:** [client/vercel.json](../client/vercel.json).

- Build: `npm run build` desde `client/`.
- Output: `client/dist/`.
- Auto-deploys de cualquier push a `main`.

### Postgres
- Addon de Railway o externo (Neon, Supabase). Connection string en `DATABASE_URL`.
- Migraciones se aplican al startup del server (idempotentes con `IF NOT EXISTS`).

### Variables de entorno
- Configuradas en Railway dashboard (server) y Vercel dashboard (client).
- **No commitear** `.env` — solo `.env.example` con keys placeholders.

### CI/CD
- **Sin GitHub Actions hoy** (gap conocido).
- Plan: añadir workflow para:
  - Run tests en cada PR (`npm run test:parlay`).
  - Run linter (no configurado tampoco, gap separado).
  - Weekly retrain del modelo Python (Sprint 2).

### Worktrees git
- El proyecto soporta workflow de worktrees en `.claude/worktrees/` para experimentación paralela.

---

## 11. Monitoring gaps

Lista honesta de lo que falta:

| Gap | Impacto | Prioridad |
|---|---|---|
| Sin Sentry / error tracking | Errores 5xx pasan desapercibidos hasta reporte de usuario | Alta |
| Sin uptime monitoring | Si el server cae no nos enteramos | Alta |
| Sin metrics dashboard (req/min, latency p95) | No vemos performance gradual | Media |
| Sin alerts (Slack/email) | Reacción tardía a incidents | Media |
| Sin structured logging | Difícil hacer queries en logs grandes | Media |
| Sin tracing distribuido | OK por ahora (1 servicio); critical cuando entre el sidecar Python | Baja → Alta en Sprint 3 |
| Sin audit log de admin | Quién hizo grant-credits, quién aprobó draft | Baja |
| Sin DB query monitoring | Slow queries no detectadas | Baja |

**Plan para cerrar todos**: Sprint dedicado de observabilidad en Tier B del roadmap. Stack sugerido: Sentry (errors) + Better Stack (uptime + logs) + Slack webhook (alerts).

---

## 12. Audit script

```bash
npm run audit
```

Ejecuta [scripts/system-audit.js](../scripts/system-audit.js).

### Qué chequea
- Variables de entorno críticas (sin filtrar valores).
- Conectividad a Postgres.
- Migrations aplicadas.
- Anthropic API key válida (ping a `/messages` con prompt mínimo).
- Odds API key válida (ping a `/sports`).
- Cache de Savant fresco (no mayor a 12h).
- Cache de Odds fresco (no mayor a 90 min).

### Output
Reporte con verde/amarillo/rojo por componente. Útil antes de un deploy o cuando algo se siente raro.

### Gaps planificados (Sprint 1+)
- Health check del feature store (`pick_features` sin huecos vs picks).
- Health check del Parlay Synergy (resolved vs unresolved ratio).
- Validación de prompt versions persisted.
- Cuando exista sidecar Python: ping a `/health` y check de `last_trained_at`.

---

## Cómo añadir un endpoint admin nuevo

1. Decidir dónde:
   - En [server/index.js](../server/index.js): rutas cross-cutting, configuración global.
   - En `server/routes/<dominio>.js`: lógica de dominio agrupada.
2. Imports:
   ```js
   import { verifyToken, requireAdmin } from './middleware/auth-middleware.js';
   ```
3. Definir:
   ```js
   app.get('/api/admin/my-feature', verifyToken, requireAdmin, async (req, res) => {
     try {
       const result = await pool.query('SELECT ...');
       res.json({ success: true, data: result.rows });
     } catch (err) {
       console.error(`[admin-my-feature] ${err.message}`);
       res.status(500).json(safeError(err));
     }
   });
   ```
4. Documentar en este archivo (sección 6) y en el endpoint global panorámico de [docs/architecture.md](architecture.md).
5. Si tiene UI: añadir componente en `client/src/components/` con guard de admin role.

---

## Cómo hacer un rollback

### Server (Railway)
1. Railway dashboard → service → "Deployments" → seleccionar build anterior → "Redeploy".
2. Si la migración nueva rompió algo: NO se puede hacer rollback de schema (las migraciones son `IF NOT EXISTS`, no destructivas). El código viejo debe ser tolerante a columnas extra (lo es por defecto si se lee con `SELECT specific_columns FROM ...`).

### Cliente (Vercel)
1. Vercel dashboard → project → "Deployments" → "Promote to Production" en una build anterior.

### DB
- **No hay rollback automático** (migraciones idempotentes one-way).
- Backups: configurar en Railway / Neon / Supabase.
- Para restore: parar el server, restore desde snapshot, reiniciar.

---

**Última actualización**: Sprint 0. Se actualiza con cada sprint que añada herramientas admin o jobs nuevos.
