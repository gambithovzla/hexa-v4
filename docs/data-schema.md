# Data Schema — H.E.X.A. v4

Catálogo completo de las **16 tablas Postgres** del sistema, con columnas reales (extraídas de [server/migrate.js](../server/migrate.js)), índices, propósito y uso para training.

---

## Tabla de contenido

1. [Convenciones](#1-convenciones)
2. [Tablas core](#2-tablas-core) — users, bankroll, bets, picks
3. [Tablas de odds & resoluciones](#3-tablas-de-odds--resoluciones) — odds_snapshots, backtest_results
4. [Tablas ML / observabilidad](#4-tablas-ml--observabilidad) — pick_features, shadow_model_runs
5. [Tablas de pagos](#5-tablas-de-pagos) — nowpayments_invoices, pending_credits, bmc_processed_purchases
6. [Tablas de contenido](#6-tablas-de-contenido) — content_queue, hexa_insights, oracle_sessions
7. [Tablas Parlay Synergy](#7-tablas-parlay-synergy) — parlay_synergy_runs
8. [Settings](#8-settings) — app_settings
9. [Relaciones FK clave](#9-relaciones-fk-clave)
10. [Estado para training](#10-estado-para-training)
11. [Columnas planificadas (Sprint 1)](#11-columnas-planificadas-sprint-1)

---

## 1. Convenciones

- **PK**: `id TEXT` para users (heredado), `SERIAL` o `BIGSERIAL` para el resto.
- **FK**: `ON DELETE CASCADE` para datos de propiedad del usuario; `ON DELETE SET NULL` para asociaciones débiles.
- **Timestamps**: `created_at`, `updated_at` con default `NOW()` UTC.
- **Timezone-aware**: campos específicos como `pick_time_lima` para auditing local.
- **JSONB**: usado para shape variable (postmortem, oracle_report, posts, messages, feature_snapshot).
- **Migraciones**: idempotentes (`IF NOT EXISTS`), aplicadas en `runMigrations()` + `runParlaySynergyMigrations()` al startup.

---

## 2. Tablas core

### 2.1 `users`

Propósito: cuentas de usuario.

```sql
id                       TEXT        PRIMARY KEY
email                    TEXT        UNIQUE NOT NULL
password_hash            TEXT        NOT NULL
credits                  INTEGER     DEFAULT 0
is_admin                 BOOLEAN     DEFAULT false
email_verified           BOOLEAN     DEFAULT false
verification_code        TEXT        DEFAULT NULL
verification_expires     TIMESTAMP   DEFAULT NULL
password_reset_code_hash TEXT        DEFAULT NULL
password_reset_expires   TIMESTAMP   DEFAULT NULL
password_reset_requested_at TIMESTAMP DEFAULT NULL
password_reset_attempts  INTEGER     DEFAULT 0
created_at               TIMESTAMP   DEFAULT NOW()
```

**Reglas:**
- `id` es TEXT (UUID o nanoid generado en signup).
- `email` UNIQUE — un email = una cuenta.
- `credits` se decrementa en cada análisis pagado, se incrementa en checkout completado.
- `is_admin` se setea manualmente vía DB o `seedAdminUser()`.

**Datos sensibles (nunca exponer en API public):**
- `password_hash`, `verification_code`, `password_reset_code_hash`.

### 2.2 `bankroll`

Propósito: tracking de bankroll por usuario.

```sql
user_id           TEXT          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
initial_bankroll  DECIMAL(12,2)
current_bankroll  DECIMAL(12,2)
updated_at        TIMESTAMP     DEFAULT NOW()
```

**Notas:**
- Solo una fila por usuario (PK es FK).
- Se actualiza manualmente vía `POST /api/bankroll/bet` etc.

### 2.3 `bets`

Propósito: apuestas registradas por el usuario (manual o linked a un pick).

```sql
id             TEXT          PRIMARY KEY
user_id        TEXT          REFERENCES users(id) ON DELETE CASCADE
date           TIMESTAMP     DEFAULT NOW()
matchup        TEXT          NOT NULL
pick           TEXT          NOT NULL
odds           INTEGER       NOT NULL
stake          DECIMAL(12,2) NOT NULL
potential_win  DECIMAL(12,2) NOT NULL
result         TEXT          DEFAULT 'pending'
source         TEXT          DEFAULT 'manual'        -- 'manual' | 'oracle'
notes          TEXT
pick_id        INTEGER       REFERENCES picks(id) ON DELETE SET NULL
created_at     TIMESTAMP     DEFAULT NOW()
```

**Notas:**
- `id` es TEXT (no SERIAL).
- `pick_id` opcional — si la apuesta fue inspirada por un pick del Oracle, lo linkea.

### 2.4 `picks`

Tabla central de picks generados por el Oracle.

```sql
id                       SERIAL        PRIMARY KEY
user_id                  TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE
type                     VARCHAR(20)   NOT NULL     -- 'single' | 'parlay' | 'safe' | etc
matchup                  VARCHAR(200)
pick                     TEXT
oracle_confidence        INTEGER                   -- 0-100
bet_value                VARCHAR(50)               -- 'low' | 'medium' | 'high'
model_risk               VARCHAR(20)               -- 'low' | 'medium' | 'high'
oracle_report            TEXT                      -- texto plano (legacy) o JSONB stringified
hexa_hunch               TEXT
alert_flags              JSONB
probability_model        JSONB
best_pick                JSONB
model                    VARCHAR(50)               -- 'sonnet' | 'opus' | 'grok' | etc
language                 VARCHAR(5)                -- 'es' | 'en'
result                   VARCHAR(10)   DEFAULT 'pending'   -- 'win' | 'loss' | 'push' | 'void' | 'pending'
created_at               TIMESTAMP     DEFAULT NOW()

-- CLV columns
odds_at_pick             INTEGER
implied_prob_at_pick     DECIMAL(5,2)
closing_odds             INTEGER
implied_prob_closing     DECIMAL(5,2)
clv                      DECIMAL(5,2)
odds_details             JSONB
kelly_recommendation     TEXT

-- Game tracking
game_pk                  INTEGER
game_date                DATE

-- Postmortem
postmortem_summary       TEXT
postmortem               JSONB
postmortem_generated_at  TIMESTAMP
postmortem_requested_at  TIMESTAMP

-- Audit
user_email               TEXT
pick_time_lima           TIMESTAMP

-- Soft delete
deleted_at               TIMESTAMP     DEFAULT NULL

-- Safe / market intelligence
value_breakdown          JSONB
safe_candidates          JSONB
safe_scope               TEXT
selection_method         VARCHAR(80)
```

**Índice:** `idx_picks_user_game_pk ON picks(user_id, game_pk)`.

**Notas:**
- `result` normalizado en migración: `'won'` → `'win'`, `'lost'` → `'loss'`.
- `deleted_at` para soft delete (no se borra físicamente).
- `oracle_report` es TEXT (no JSONB consistente). Algunos picks viejos tienen texto, los nuevos tienen JSON stringified.

---

## 3. Tablas de odds & resoluciones

### 3.1 `odds_snapshots`

Propósito: capturar movimiento de líneas para CLV y line movement analysis.

```sql
id                   SERIAL       PRIMARY KEY
game_id              VARCHAR(100) NOT NULL
game_date            DATE         NOT NULL
home_team            VARCHAR(100)
away_team            VARCHAR(100)
moneyline_home       INTEGER
moneyline_away       INTEGER
run_line_home        DECIMAL(3,1)
run_line_home_price  INTEGER
run_line_away        DECIMAL(3,1)
run_line_away_price  INTEGER
total                DECIMAL(4,1)
over_price           INTEGER
under_price          INTEGER
captured_at          TIMESTAMP    DEFAULT NOW()
```

**Índice:** `idx_snapshots_game_date ON odds_snapshots(game_id, game_date)`.

**Cuándo se popula:**
- Cada 6h en horario 9am-7pm ET (background job).
- Permite reconstruir movimiento de líneas para sharp money detection y CLV.

### 3.2 `backtest_results`

Propósito: resultados de backtests offline (no consume créditos en producción).

```sql
id                  SERIAL    PRIMARY KEY
run_id              TEXT      NOT NULL                   -- identifica un batch
historical_date     DATE      NOT NULL
game_pk             INTEGER   NOT NULL
matchup             TEXT      NOT NULL
home_team           TEXT
away_team           TEXT
pick                TEXT
oracle_confidence   INTEGER
bet_value           TEXT
model_risk          TEXT
pick_type           TEXT                                   -- 'single' | 'parlay' | etc
actual_home_score   INTEGER
actual_away_score   INTEGER
actual_result       TEXT
model               TEXT      DEFAULT 'deep'
prompt_version      TEXT      DEFAULT 'v1'
latency_ms          INTEGER
created_at          TIMESTAMP DEFAULT NOW()

-- Añadidos posteriormente
alert_flags         JSONB     DEFAULT '[]'
bet_value_raw       TEXT
has_critical_flags  BOOLEAN   DEFAULT false

UNIQUE(run_id, game_pk, pick_type)
```

**Notas:**
- Useful para evaluar cambios de prompt contra histórico antes de mergearlo.
- `prompt_version` permite trackear qué versión del prompt produjo cada resultado (campo crítico — picks reales no tienen este campo todavía, gap a cerrar en Sprint 1).

---

## 4. Tablas ML / observabilidad

### 4.1 `pick_features`

Propósito: feature store para training de modelo propio.

```sql
id                       SERIAL        PRIMARY KEY
pick_id                  INTEGER                       -- FK informal a picks (sin constraint)
backtest_id              INTEGER                       -- FK informal a backtest_results
game_pk                  INTEGER
game_date                DATE

-- Pitching (Statcast)
home_pitcher_xwoba       DECIMAL(5,3)
away_pitcher_xwoba       DECIMAL(5,3)
home_pitcher_whiff       DECIMAL(5,2)
away_pitcher_whiff       DECIMAL(5,2)
home_pitcher_k_pct       DECIMAL(5,2)
away_pitcher_k_pct       DECIMAL(5,2)
home_pitcher_era         DECIMAL(5,2)
away_pitcher_era         DECIMAL(5,2)

-- Team / lineup
home_team_ops            DECIMAL(5,3)
away_team_ops            DECIMAL(5,3)
home_lineup_avg_xwoba    DECIMAL(5,3)
away_lineup_avg_xwoba    DECIMAL(5,3)

-- Park / weather
park_factor_overall      INTEGER
park_factor_hr           INTEGER
temperature              DECIMAL(5,1)
wind_speed               DECIMAL(5,1)

-- Meta del contexto
data_quality_score       INTEGER
signal_coherence_score   INTEGER

-- Odds del mercado
odds_ml_home             INTEGER
odds_ml_away             INTEGER
odds_ou_total            DECIMAL(4,1)

-- Pick + resultado
pick                     TEXT
result                   TEXT

-- Audit
user_email               TEXT
pick_time_lima           TIMESTAMP

created_at               TIMESTAMP     DEFAULT NOW()
```

**Notas:**
- 19 columnas de features + 4 meta.
- `pick` es texto libre ("NYY ML", "Over 8.5", "Aaron Judge Over 0.5 Hits") — gap a cerrar con `market_type`, `side`, `line`, `prop_kind`, `prop_player_id` en Sprint 1.
- **Sin FK constraint** a picks/backtest_results — links lógicos. Esto es OK porque puede haber pick_features sin pick aún (modo `safe` puro).
- Una fila por pick (UPSERT lookup por `pick_id` o `backtest_id`).

**Estado para training**: ver [sección 10](#10-estado-para-training).

### 4.2 `shadow_model_runs`

Propósito: comparación oracle vs shadow validator vs (próximo) modelo Python.

```sql
id                            SERIAL        PRIMARY KEY
user_id                       TEXT          REFERENCES users(id) ON DELETE SET NULL
pick_id                       INTEGER       REFERENCES picks(id) ON DELETE SET NULL
backtest_id                   INTEGER       REFERENCES backtest_results(id) ON DELETE SET NULL

source_type                   VARCHAR(20)   NOT NULL DEFAULT 'analysis'   -- 'analysis' | 'backtest'
analysis_mode                 VARCHAR(20)   NOT NULL DEFAULT 'single'

model_key                     VARCHAR(80)   NOT NULL                       -- 'hexa_xgb_v1'
model_version                 VARCHAR(40)

game_pk                       INTEGER       NOT NULL
game_date                     DATE
home_team_id                  INTEGER
away_team_id                  INTEGER
home_team_abbr                VARCHAR(10)
away_team_abbr                VARCHAR(10)

-- Predicción del Oracle (LLM)
oracle_pick                   TEXT
oracle_confidence             DECIMAL(5,2)
oracle_home_win_prob          DECIMAL(6,3)
oracle_predicted_winner_id    TEXT
oracle_predicted_winner_abbr  VARCHAR(10)

-- Predicción del shadow validator (determinístico)
shadow_score                  INTEGER
shadow_confidence             INTEGER
shadow_home_win_prob          DECIMAL(6,3)
shadow_predicted_winner_id    TEXT
shadow_predicted_winner_abbr  VARCHAR(10)

agree_with_oracle             BOOLEAN

-- Resultado real (se completa post-game)
actual_winner_id              TEXT
actual_winner_abbr            VARCHAR(10)
actual_home_score             INTEGER
actual_away_score             INTEGER
actual_status                 VARCHAR(20)   NOT NULL DEFAULT 'pending'

-- Snapshot completo de features (para reproducibilidad)
feature_snapshot              JSONB         DEFAULT '{}'

-- Audit
user_email                    TEXT
pick_time_lima                TIMESTAMP

created_at                    TIMESTAMP     DEFAULT NOW()
updated_at                    TIMESTAMP     DEFAULT NOW()
```

**Índices:**
- `idx_shadow_model_runs_game_pk`
- `idx_shadow_model_runs_created_at` (DESC)
- `idx_shadow_model_runs_status`
- `idx_shadow_model_runs_pick_unique` UNIQUE `(pick_id, model_key)` WHERE pick_id IS NOT NULL
- `idx_shadow_model_runs_backtest_unique` UNIQUE `(backtest_id, model_key)` WHERE backtest_id IS NOT NULL

**Notas:**
- El `feature_snapshot` JSONB permite re-evaluar el modelo en el futuro con nuevas versiones sin perder el snapshot temporal.
- En Sprint 3 se añadirán columnas `python_model_score`, `python_model_version`, `python_home_win_prob`, etc.

---

## 5. Tablas de pagos

### 5.1 `nowpayments_invoices`

Propósito: tracking de checkouts cripto (único gateway activo).

```sql
id            SERIAL        PRIMARY KEY
order_id      VARCHAR(100)  UNIQUE NOT NULL          -- hexa-{userId}-{timestamp}
user_id       TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE
invoice_id    VARCHAR(255)                            -- ID de NowPayments
plan_id       VARCHAR(50)   NOT NULL                  -- 'rookie' | 'allstar' | 'mvp'
credits       INTEGER       NOT NULL                  -- créditos a otorgar
price_usd     DECIMAL(10,2) NOT NULL
pay_currency  VARCHAR(20)                             -- 'btc' | 'eth' | etc, set al confirmar
status        VARCHAR(20)   DEFAULT 'new'             -- 'new' | 'waiting' | 'confirming' | 'finished' | 'completed' | 'failed' | 'expired'
created_at    TIMESTAMP     DEFAULT NOW()
completed_at  TIMESTAMP
```

**Índices:**
- `idx_np_invoices_user_id`
- `idx_np_invoices_status`

**Estados internos vs NowPayments:**
- `'new'`: insertado, antes de llamar a NowPayments.
- Estados de NowPayments (waiting / confirming / finished) se reflejan en `status`.
- `'completed'`: estado terminal nuestro — créditos ya acreditados. Se llega a `'completed'` SOLO desde `'finished'`.

### 5.2 `pending_credits`

Propósito: créditos para usuarios que aún no se registraron (legacy Buy Me a Coffee / Lemon Squeezy).

```sql
id           SERIAL        PRIMARY KEY
email        VARCHAR(255)  NOT NULL
credits      INTEGER       NOT NULL
source       VARCHAR(50)   DEFAULT 'buymeacoffee'
purchase_id  VARCHAR(100)
amount       DECIMAL(10,2)
product_name VARCHAR(255)
claimed      BOOLEAN       DEFAULT false
created_at   TIMESTAMP     DEFAULT NOW()
```

**Estado:** solo lectura. Auditoría histórica de gateways previos. NowPayments no escribe aquí.

### 5.3 `bmc_processed_purchases`

Propósito: dedup de webhook BMC + poller (legacy).

```sql
purchase_id  VARCHAR(100)  PRIMARY KEY
source       VARCHAR(20)   NOT NULL                    -- 'webhook' | 'poller' | 'manual'
email        VARCHAR(255)
credits      INTEGER
product_name VARCHAR(255)
amount       DECIMAL(10,2)
processed_at TIMESTAMP     DEFAULT NOW()
```

**Estado:** solo lectura.

---

## 6. Tablas de contenido

### 6.1 `content_queue`

Propósito: cola editorial para publicación automatizada a X (y futuras plataformas).

```sql
id                 SERIAL        PRIMARY KEY
type               VARCHAR(40)   NOT NULL              -- 'pick_of_day' | 'thread_daily' | 'postmortem' | 'weekly_recap'
lang               VARCHAR(5)    NOT NULL DEFAULT 'es'
status             VARCHAR(20)   NOT NULL DEFAULT 'draft'   -- 'draft' | 'approved' | 'rejected' | 'published' | 'failed'
publish_target     VARCHAR(20)   NOT NULL DEFAULT 'x'        -- 'x' | 'telegram' | 'discord' (futuro)
title              TEXT          NOT NULL
format             VARCHAR(20)   NOT NULL DEFAULT 'single_post'   -- 'single_post' | 'thread'
posts              JSONB         NOT NULL DEFAULT '[]'   -- [{ text }, ...]
hashtags           JSONB         NOT NULL DEFAULT '[]'
cta                TEXT
visual_brief       TEXT                                    -- descripción si va con imagen
compliance_notes   JSONB         NOT NULL DEFAULT '[]'
source_refs        JSONB         NOT NULL DEFAULT '[]'   -- referencias a picks / juegos
source_snapshot    JSONB         NOT NULL DEFAULT '{}'   -- snapshot de stats del momento
generated_with     TEXT                                    -- 'claude-haiku-4-5-20251001'
scheduled_for      TIMESTAMP     NULL
approved_at        TIMESTAMP     NULL
approved_by        TEXT          REFERENCES users(id) ON DELETE SET NULL
published_at       TIMESTAMP     NULL
publish_result     JSONB         NULL                    -- response de X API
last_error         TEXT          NULL
created_by         TEXT          REFERENCES users(id) ON DELETE SET NULL
created_at         TIMESTAMP     DEFAULT NOW()
updated_at         TIMESTAMP     DEFAULT NOW()
```

**Índices:**
- `idx_content_queue_status ON content_queue(status, created_at DESC)`
- `idx_content_queue_scheduled ON content_queue(status, scheduled_for)`

### 6.2 `hexa_insights`

Propósito: cuentos curados de wins/misses para el feed público semanal.

```sql
id          SERIAL        PRIMARY KEY
type        VARCHAR(20)   NOT NULL CHECK (type IN ('acierto', 'fallo'))
title       TEXT          NOT NULL
explanation TEXT          NOT NULL
pick_id     INTEGER       REFERENCES picks(id) ON DELETE SET NULL
pick_data   JSONB         DEFAULT '{}'
week_start  DATE          NOT NULL
dedupe_key  TEXT          DEFAULT NULL
created_at  TIMESTAMP     DEFAULT NOW()
deleted_at  TIMESTAMP     DEFAULT NULL
```

**Índices:**
- `idx_insights_week ON hexa_insights(week_start, deleted_at)`
- `idx_insights_dedupe_key UNIQUE ON hexa_insights(dedupe_key)`

### 6.3 `oracle_sessions`

Propósito: history del Oracle Chat (modo admin) agrupado por día y modo.

```sql
id          SERIAL        PRIMARY KEY
user_id     TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE
session_key VARCHAR(100)  UNIQUE NOT NULL                -- `${userId}::${date}::${mode}`
date_et     DATE          NOT NULL
mode        VARCHAR(20)   NOT NULL DEFAULT 'partido'     -- 'partido' | 'jornada'
game_ids    JSONB         DEFAULT '[]'
matchups    TEXT
messages    JSONB         NOT NULL DEFAULT '[]'           -- chat history
created_at  TIMESTAMP     DEFAULT NOW()
updated_at  TIMESTAMP     DEFAULT NOW()
```

**Índices:**
- `idx_oracle_sessions_date ON oracle_sessions(date_et DESC)`
- `idx_oracle_sessions_user ON oracle_sessions(user_id, date_et DESC)`

---

## 7. Tablas Parlay Synergy

### 7.1 `parlay_synergy_runs`

Propósito: tracking del motor Parlay Synergy v1. Creada en migración separada (`runParlaySynergyMigrations`).

```sql
id                BIGSERIAL     PRIMARY KEY
user_id           TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE
user_email        VARCHAR(255)
created_at        TIMESTAMPTZ   DEFAULT NOW()
game_date         DATE          NOT NULL

-- Input
requested_legs    INTEGER       NOT NULL
mode              VARCHAR(32)   NOT NULL              -- 'conservative' | 'balanced' | 'aggressive' | 'dreamer'
game_pks          JSONB         NOT NULL              -- array de gamePks
language          VARCHAR(8)    DEFAULT 'en'
engine            VARCHAR(16)   DEFAULT 'sonnet'
model             VARCHAR(16)   DEFAULT 'fast'        -- 'fast' | 'deep'
bet_type          VARCHAR(32)                          -- filtro de market type
market_focus      VARCHAR(32)                          -- filtro adicional

-- Snapshots
candidate_pool    JSONB         NOT NULL              -- todos los candidatos elegibles
composed_top3     JSONB         NOT NULL              -- las 3 combinaciones del composer
architect_output  JSONB         NOT NULL              -- respuesta del LLM Architect

-- Resultado elegido
chosen_legs       JSONB         NOT NULL              -- patas finales del parlay
combined_prob     NUMERIC(6,4)
combined_dec_odds NUMERIC(10,2)
synergy_type      VARCHAR(64)                          -- 'correlated_pitchers_duel' | etc
warnings          JSONB

-- Performance (se llena al resolver)
resolved          BOOLEAN       DEFAULT false
hit               BOOLEAN                              -- ¿ganó el parlay completo?
legs_hit          INTEGER                              -- cuántas patas individuales acertaron
leg_results       JSONB                                -- detalle por pata
resolved_at       TIMESTAMPTZ

-- Comparativa sombra
shadow_old_parlay JSONB                                -- qué habría dicho el analyzeParlay viejo
shadow_old_hit    BOOLEAN

-- Metadata
timings           JSONB                                -- { composer_ms, llm_ms, total_ms }
credits_charged   INTEGER
is_admin_run      BOOLEAN       DEFAULT false
```

**Índices:**
- `idx_parlay_synergy_runs_user_date ON parlay_synergy_runs(user_id, game_date DESC)`
- `idx_parlay_synergy_runs_resolved ON parlay_synergy_runs(resolved, game_date DESC) WHERE resolved = false` (partial)

---

## 8. Settings

### 8.1 `app_settings`

Propósito: configuración global key-value (JSONB para shape flexible).

```sql
key        VARCHAR(64) PRIMARY KEY
value      JSONB       NOT NULL
updated_at TIMESTAMP   DEFAULT NOW()
```

**Keys actuales:**
- `performance_public` → `false` por default. Si `true`, expone `/api/picks/public-stats` con stats agregadas.

**Cómo se usa:**
```js
const setting = await pool.query("SELECT value FROM app_settings WHERE key = 'performance_public'");
const isPublic = setting.rows[0]?.value === true;
```

---

## 9. Relaciones FK clave

```
users (TEXT id)
  ├── bankroll (PK = FK)
  ├── bets (user_id FK ON DELETE CASCADE)
  ├── picks (user_id FK ON DELETE CASCADE)
  ├── nowpayments_invoices (user_id FK ON DELETE CASCADE)
  ├── oracle_sessions (user_id FK ON DELETE CASCADE)
  ├── parlay_synergy_runs (user_id FK ON DELETE CASCADE)
  └── shadow_model_runs (user_id FK ON DELETE SET NULL)

picks (SERIAL id)
  ├── bets (pick_id FK ON DELETE SET NULL)
  ├── shadow_model_runs (pick_id FK ON DELETE SET NULL)
  ├── hexa_insights (pick_id FK ON DELETE SET NULL)
  └── pick_features (pick_id INTEGER, NO constraint formal)

backtest_results (SERIAL id)
  └── shadow_model_runs (backtest_id FK ON DELETE SET NULL)
```

**Patrón:** datos owned por user se borran en cascada al borrar la cuenta; datos derivados/observabilidad se preservan con SET NULL.

---

## 10. Estado para training

Esta sección responde "¿qué tan listos están los datos para entrenar un modelo propio?".

### 10.1 Lo que tenemos

| Necesidad | Tabla / Campo | Estado |
|---|---|---|
| Pick generado | `picks` | ✅ ~500+ filas |
| Features del juego | `pick_features` | ✅ 19 columnas |
| Resultado del pick | `picks.result` | ✅ 'win' / 'loss' / 'push' / 'void' |
| Odds inicial | `picks.odds_at_pick` | ✅ |
| Odds cierre | `picks.closing_odds` | ✅ (en picks resueltos recientes) |
| CLV | `picks.clv` | ✅ calculado al resolver |
| Kelly recomendado | `picks.kelly_recommendation` | ✅ |
| Confidence del oracle | `picks.oracle_confidence` | ✅ |
| Game ID | `picks.game_pk` | ✅ (algunos NULL en picks viejos, backfill aplicado) |

### 10.2 Lo que falta para entrenar

| Necesidad | Por qué importa | Estado |
|---|---|---|
| `home_score`, `away_score`, `total_runs` | Sin scores no se entrena over/under separado del moneyline | ❌ FALTA |
| `winner_team_id`, `game_status` | Target estructurado para clasificación | ❌ FALTA |
| `market_type`, `side`, `line`, `prop_kind`, `prop_player_id` | El campo `pick` es texto libre, sin parsing estructurado no se separan los modelos por mercado | ❌ FALTA |
| Pitcher fatigue: `days_rest`, `pitches_last_start` | Driver conocido de performance, no captura | ❌ FALTA |
| Bullpen fatigue: `home/away_bullpen_pitches_last_3d` | Importante para overs y late innings | ❌ FALTA |
| Contexto: `is_day_game`, `is_dome`, `game_number_in_series`, `umpire_id` | Variables baratas que afectan totales | ❌ FALTA |
| Versionado prompt: `prompt_version`, `oracle_model` | Sin esto no podemos correlacionar features con la versión del LLM que las produjo | ❌ FALTA |
| Flag de source: `source = 'live' | 'admin_test' | 'backtest'` | Mezclar admin tests con picks reales contamina training | ❌ FALTA |

Estos gaps se cierran en **Sprint 1**, ver [docs/ml-pipeline.md sección 10.2](ml-pipeline.md#102-sprint-1--cerrar-gaps-del-dataset).

### 10.3 Cómo exportar el dataset hoy

Hoy: endpoint admin `GET /api/admin/feature-store?month=YYYY-MM` retorna JSON con 750 records limit.

Sprint 1: añadir `scripts/training/export-dataset.js` que:
- JOIN entre `pick_features` + `picks`.
- Filtros: `--from`, `--to`, `--source`, `--market`.
- Output: `data/picks-dataset-YYYY-MM-DD.parquet` (+ CSV fallback).
- Compatible con `pandas.read_parquet()` desde Python.

---

## 11. Columnas planificadas (Sprint 1)

Para que el dataset esté listo para Python, **migración nueva** (función nueva en `server/migrate.js`, no toca `runMigrations`):

```sql
-- pick_features ampliada
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_score INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_score INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS total_runs INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS winner_team_id INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS game_status VARCHAR(32);

ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS market_type VARCHAR(16);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS side VARCHAR(16);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS line NUMERIC(6,2);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_kind VARCHAR(16);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_id INTEGER;

ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pitcher_days_rest INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pitcher_days_rest INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pitcher_pitches_last_start INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pitcher_pitches_last_start INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_bullpen_pitches_last_3d INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_bullpen_pitches_last_3d INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_day_game BOOLEAN;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_dome BOOLEAN;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS game_number_in_series INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS umpire_id INTEGER;

ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS oracle_model VARCHAR(48);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS oracle_confidence INTEGER;
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS kelly_fraction NUMERIC(6,4);
ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'live';

CREATE INDEX IF NOT EXISTS idx_pick_features_source ON pick_features(source);
CREATE INDEX IF NOT EXISTS idx_pick_features_market_result ON pick_features(market_type, result) WHERE result IS NOT NULL;
```

Backfill via `scripts/training/backfill-pick-features.js` (Sprint 1).

---

## Comandos útiles para inspección

```bash
# Cuántos picks resueltos tengo?
psql $DATABASE_URL -c "SELECT COUNT(*) FROM picks WHERE result IN ('win','loss') AND deleted_at IS NULL;"

# Distribución de result por tipo
psql $DATABASE_URL -c "SELECT type, result, COUNT(*) FROM picks WHERE deleted_at IS NULL GROUP BY 1,2 ORDER BY 1,2;"

# Hay picks sin pick_features?
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM picks p
  LEFT JOIN pick_features pf ON pf.pick_id = p.id
  WHERE pf.id IS NULL AND p.deleted_at IS NULL;
"

# Hay pick_features sin scores reales (tras Sprint 1)?
psql $DATABASE_URL -c "
  SELECT COUNT(*) FROM pick_features
  WHERE result IS NOT NULL AND home_score IS NULL;
"

# CLV promedio del último mes
psql $DATABASE_URL -c "
  SELECT AVG(clv), COUNT(*) FROM picks
  WHERE clv IS NOT NULL AND game_date > NOW() - INTERVAL '30 days';
"
```

---

**Última actualización**: Sprint 0. Cuando entre Sprint 1, este archivo se actualiza con las columnas nuevas marcadas como `[Sprint 1 ✅]`.
