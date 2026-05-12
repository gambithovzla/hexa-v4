# Roadmap — H.E.X.A. v4

Documento vivo. Se actualiza al cierre de cada sprint y cuando entran/salen items del backlog.

**Última actualización**: 2026-05-12 — Sprint 0 (documentación) cerrando.

---

## Tabla de contenido

1. [Foco actual](#1-foco-actual)
2. [Sprints en ejecución](#2-sprints-en-ejecución)
3. [Backlog priorizado](#3-backlog-priorizado)
4. [Items rechazados](#4-items-rechazados)
5. [Cómo se prioriza](#5-cómo-se-prioriza)

---

## 1. Foco actual

**Q2 2026** — Entrenar modelo propio Python con los >500 picks resueltos.

Justificación:
- Es el bloqueador #1 para el ensemble real (Claude + Grok + modelo entrenado).
- El "XGBoost validator" actual no es ML real; reemplazarlo desbloquea probabilidades calibradas, SHAP feature importance, y auto-retraining.
- Una vez en producción, todo el resto del roadmap (NBA, Hexa Live, RAG, FanGraphs) se beneficia de la infra ML.

---

## 2. Sprints en ejecución

### ✅ Sprint 0 — Documentación viva (semana 1)

**Status**: cerrando.

**Entregables**:
- ✅ `CLAUDE.md` en raíz.
- ✅ `docs/architecture.md`, `ml-pipeline.md`, `integrations.md`, `content-pipeline.md`, `admin-and-ops.md`, `data-schema.md`, `roadmap.md`.
- ✅ `README.md` slim down con índice a `/docs/`.

**Criterio de éxito**: un dev nuevo puede levantar entorno local y entender dónde inyectar cambios en <15 min.

---

### 🔄 Sprint 1 — Cerrar gaps del dataset (semanas 2-3)

**Status**: pendiente, próximo.

**Entregables**:
- Migración nueva en [server/migrate.js](../server/migrate.js): añade ~20 columnas a `pick_features` (scores reales, pick estructurado, features temporales, versionado).
- `server/services/pickPostgameEnricher.js`: hook al pick-resolver para rellenar scores.
- `server/parsers/pickParser.js`: parsea texto del pick a `{market_type, side, line, prop_kind, prop_player_id}`. Tests con 30+ casos.
- `scripts/training/backfill-pick-features.js`: rellena histórico.
- `scripts/training/export-dataset.js`: exporta Parquet listo para Python.
- Documentar: añadir columnas en [docs/data-schema.md](data-schema.md).

**Criterio de éxito**:
- `SELECT COUNT(*) FROM pick_features WHERE result IS NOT NULL AND home_score IS NULL` = 0.
- `node scripts/training/export-dataset.js --from 2025-01-01` genera Parquet leíble desde Python.

**Riesgo**: muy bajo. Migraciones idempotentes, backfill solo toca rows sin score, parser tiene tests.

---

### ⏳ Sprint 2 — Sidecar Python FastAPI (semanas 3-4)

**Status**: planificado.

**Entregables**:
- Carpeta `ml/` nueva con FastAPI + XGBoost + scikit-learn.
- Endpoints: `/health`, `/predict/{moneyline,overunder,runline,batch}`, `/calibration`, `/retrain`.
- Training pipeline con split temporal, calibración Platt, evaluación Brier + ROI Kelly-25.
- Deploy en Railway como servicio separado.
- GitHub Actions `retrain-weekly.yml` para retrain automatic cada domingo 06:00 UTC.

**Criterio de éxito**:
- `curl $HEXA_ML_API_URL/health` → 200.
- Latencia `/predict/batch` con 10 juegos < 500ms.
- Brier score moneyline < 0.24 en test set.
- ROI Kelly-25 positivo en test.

**Riesgo**: bajo en lo técnico, medio en performance. Si <500 picks resueltos resultan insuficientes para alguno de los mercados, se ajusta scope (ej. entrenar solo moneyline en v1, OU/RL cuando haya más data).

---

### ⏳ Sprint 3 — Integración Node ↔ Python (semana 5)

**Status**: planificado.

**Entregables**:
- `server/services/mlModelClient.js`: HTTP client con timeout 500ms, retry, circuit breaker.
- `server/services/shadow-model.js` ampliado: guarda **ambos** scores (legacy validator + python model) en `shadow_model_runs`.
- Migración: `ADD COLUMN python_model_score, python_model_version` a `shadow_model_runs`.
- Endpoint admin `GET /api/admin/ml-calibration`.
- Dashboard frontend `client/src/pages/MLCalibrationDashboard.jsx`.

**Criterio de éxito**:
- Cada pick guarda 3 scores en `shadow_model_runs`.
- Si sidecar caído, picks se siguen creando (fallback transparente).
- Dashboard renderiza curva de calibración Recharts.

**Guardrails**: feature flag `ML_SIDECAR_ENABLED=false` por default. El Oracle nunca depende del sidecar.

---

### ⏳ Sprint 4 — Ensemble (semana 6, opcional)

**Status**: condicional al éxito de Sprint 3.

Solo se construye si Brier de calibración indica que el modelo Python aporta señal independiente.

**Entregables**:
- `ml/hexa_ml/models/ensemble.py`: meta-learner LogReg sobre `shadow_model_runs`.
- Endpoint Python `/predict/ensemble`.
- Endpoint Node `/api/analyze/game-ensemble` (no toca `oracle.js`).
- Feature flag `ENSEMBLE_ENABLED=false`.

**Criterio de éxito**: Brier ensemble < Brier de cualquier fuente individual.

---

## 3. Backlog priorizado

Cada tier ordenado por ROI / esfuerzo dentro del tier. Detalle del por qué de la prioridad en cada item.

### Tier S — Alta señal, bajo esfuerzo

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| S1 | **Equity curve + Sharpe + drawdown dashboard** | 2 días | Usa datos que ya existen en `picks` + `bankroll`. Sin backend nuevo. Reusar componentes Recharts. |
| S2 | **Versionado de prompts** (`prompt_hash` + `prompt_version` en pick_features) | 1 día | Trivial, alto valor para auditoría. Sprint 1 ya incluye los campos en pick_features. Falta llenarlos desde oracle.js. |
| S3 | **Audit del feature store** (`npm run audit` reporta huecos) | 1 día | Health check para detectar features faltantes / fecha vieja. Útil pre-training. |
| S4 | **Telegram channel publisher** | 3 días | Reusa `contentDraftService`, añade adapter `telegramPublisher.js`. Mayor engagement por canal. |
| S5 | **Newsletter weekly recap via Resend** | 3 días | Reusa email.js + `weekly_recap` content type que ya existe. Tabla `newsletter_subscribers`. |
| S6 | **Postmortem dashboard cuantitativo** | 2 días | Agregaciones de `picks.postmortem.alert_flags` por hit/miss. Detecta patrones para refinar prompts. |

### Tier A — Alta señal, esfuerzo medio

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| A1 | **F5 (First 5 innings) market** | ~1 semana | Pitcher xwOBA ya está en features. Falta: odds del Odds API (cubierto), resolver lógica de stop-at-5, UI. Alto valor: F5 evita bullpen variance. |
| A2 | **FanGraphs ZiPS scraper** (Python en sidecar ML) | ~1 semana | Inyecta proyecciones rest-of-season como features. Gratis (scraping legal). Mejora calibración del modelo entrenado. |
| A3 | **pgvector + embeddings de oracle_report** | ~1.5 semanas | RAG: antes de analizar un juego, recupera 5 análisis pasados similares (mismos pitchers, mismas condiciones). Necesita pgvector extension. |
| A4 | **Player Props dedicated UI** | ~1 semana | Datos ya están. Falta UI: tabla de props del día por jugador, filtros, edge resaltado. |
| A5 | **Rate limit per-user con tiers** | 3 días | `keyGenerator` custom basado en `req.user?.id`. Tiers: anon / free / paid / admin. |
| A6 | **Migrar a node-pg-migrate o Drizzle** | ~1 semana | Versionado real de schema, rollback, diff. Más limpio que IF NOT EXISTS embebido. |
| A7 | **Backtest con CSV upload** | ~1 semana | Admin sube CSV con picks históricos, el modelo los evalúa. Útil para A/B test de prompts. |
| A8 | **Beat reporters scraper + injury classifier** (Haiku) | ~1 semana | Lista curada de beat reporters X. Cada hora scrapeo tweets + clasifica con Haiku (juega / dudoso / out). Featurea más fino que `injuryStatus` de MLB API. |
| A9 | **Parlay Synergy feature flag → public beta** | 3 días | Hoy admin-only. Validar métricas de Sprint 3 del brief de parlay; si hit rate es bueno, abrir a usuarios paid. |

### Tier B — Alta señal pero esfuerzo alto o dependencia externa

| # | Item | Esfuerzo | Notas |
|---|---|---|---|
| B1 | **Expansión NBA** | 2-3 semanas | Nuevo `context-builder-nba.js`, NBA Stats API (gratis), prompts adaptados, splits por matchup defensivo. **Pre-requisito**: modelo Python en producción para MLB primero. |
| B2 | **Hexa Live (in-play WP + momentum alerts)** | 2-3 semanas | Infra de WebSocket (cliente al server), polling agresivo MLB Stats, WP model, momentum detection (bullpen fatigue + consecutive hard contacts). Alertas push web. |
| B3 | **Discord bot** | 1-2 semanas | discord.js, comandos slash `/today`, `/pick {gameId}`, webhook para auto-post. Server propio HEXA. |
| B4 | **Threads (Meta) publisher** | 1-2 semanas | Depende del Meta API stability. Adapter similar a `xPublisher.js`. |
| B5 | **Feature flags reales** (GrowthBook self-hosted) | 1 semana | Reemplaza env vars como toggles. Permite A/B test de prompts y modelos por % de usuarios. |
| B6 | **Observability (Sentry + structured logging con pino)** | 1 semana | Sentry para errores, pino para JSON logs, Better Stack para uptime + grep en logs. |
| B7 | **Migración a BullMQ + Redis** | 1 semana | Reemplaza `setInterval`. Necesario antes de escalar a 2+ instancias del server. |
| B8 | **Infografías auto-generadas** | 1.5 semanas | Recharts SSR con `react-to-image` o `puppeteer`. CDN en Cloudflare R2. Anexar a posts X / Telegram. |
| B9 | **Hexa Scout (futures + prospect call-ups)** | 1.5 semanas | Odds API soporta futures, plug-and-play. ZiPS / Steamer para context. Alertas de prospect call-ups con call-up tracker. |
| B10 | **Player Props alternate lines + resolver multi-line** | 1.5 semanas | Necesita parsing más complejo del Odds API + UI con dropdown de líneas. |
| B11 | **CI/CD GitHub Actions completa** | 1 semana | Lint (cuando se añada), tests, build verification, retrain weekly del modelo Python. |

### Tier C — Vale la pena pero no ahora

| # | Item | Por qué no ahora |
|---|---|---|
| C1 | **Reinforcement Learning para staking** | Requiere >5k picks resueltos para converger. Hoy 500. Volver a evaluar cuando se acumule. |
| C2 | **Chain-of-Thought validation con 3er modelo** | 3x cost para ganancia marginal sobre el ensemble. Evaluar tras Sprint 4. |
| C3 | **Migración a TypeScript** | El repo está estable. Mover ahora interrumpe velocity sin beneficio inmediato. Revisitar si el equipo crece a >3 devs. |
| C4 | **Expansión Soccer / NHL / Tennis** | Cada deporte requiere context-builder propio. Priorizar NBA primero, evaluar el siguiente después. |

### Tier D — Rechazado o no recomendado

Ver [sección 4](#4-items-rechazados).

---

## 4. Items rechazados

Items que el análisis externo sugirió o que aparecieron en discusiones, y por qué no entran al backlog:

| Item | Razón |
|---|---|
| **Sportradar / Stats Perform** ($$$) | $50k-$200k/año minimum. No justificable hasta tener clientes enterprise. Usar MLB Stats API + Statcast gratis. |
| **Computer Vision para lineups** | MLB API devuelve lineups confirmados con suficiente latencia. ROI marginal vs complejidad de mantener modelo CV. |
| **NLP de injury reports de medios** | Cubierto por el item A8 (beat reporters scraper con Haiku) — mismo fin, menor esfuerzo. |
| **Migrar todo el Oracle a fine-tuning** | Caro, prematuro. El prompt engineering actual funciona, el modelo entrenado va al lado, no reemplaza al LLM. Fine-tuning solo si los modelos tabulares pierden frente al LLM en un mercado específico. |
| **Datadog / New Relic full-stack monitoring** | Overkill para escala actual. Sentry + Better Stack cubren 90% al 10% del costo. |
| **Servicio multi-tenant para revender HEXA white-label** | Producto-business decision, no técnica. Si entra, agrega complejidad (multi-DB / row-level security) que no justifica el ROI hoy. |

---

## 5. Cómo se prioriza

**Criterios** (de mayor a menor peso):

1. **Desbloqueo**: ¿Habilita otras features importantes? El modelo Python entrenado desbloquea ensemble, calibración, todas las expansiones. → Foco.
2. **Riesgo de regresión**: items con guardrails (feature flags, fallbacks) son preferibles a "rip and replace".
3. **ROI / esfuerzo**: Tier S (alta señal, baja inversión) primero cuando hay tiempo entre sprints grandes.
4. **Dependencias externas**: items que dependen de APIs $$$ o lanzamientos de terceros (Meta Threads) van más bajo en lista.
5. **Estratégico vs táctico**: una mejora UX (equity curve) es táctica; expansión a NBA es estratégica. Mezclar 60/40 estratégico-táctico cada trimestre.

**Cuándo se actualiza el roadmap**:
- Al cierre de cada sprint.
- Cuando entra un cliente / requerimiento que cambia prioridad.
- Cuando se descarta un item (mover a sección 4 con razón).
- Trimestralmente, revisión completa: ¿Tier S sigue siendo S? ¿Algo del backlog C ya tiene contexto para subir?

---

## Resumen visual del próximo trimestre

```
W1     Sprint 0 — Docs                ████████████████████████████ ✅
W2-3   Sprint 1 — Dataset gaps        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 🔄
W3-4   Sprint 2 — Sidecar Python      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
W5     Sprint 3 — Integración         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ⏳
W6     Sprint 4 — Ensemble (opcional) ░░░░░░░░░░░░░░░░░░░░░░░░░░░░ ⏳

W7+    Tier S items (1-2 semanas)
W9+    Tier A items según pipeline
```

Para detalle ejecutable de cada sprint, ver [docs/ml-pipeline.md sección 10](ml-pipeline.md#10-plan-modelo-python-entrenado-propio).
