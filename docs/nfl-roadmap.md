# Roadmap NFL — H.E.X.A. v4

Plan de construcción del **tercer deporte**, espejo exacto de la serie NBA (Sprint 7). Detalle técnico y de datos en [nfl-architecture.md](nfl-architecture.md). Checklist multi-deporte en [sport-registry.md](sport-registry.md).

**Estado**: 📋 planning. `nfl` ya está registrado como deporte **conocido pero inactivo** en `server/sports.js` y `client/src/config/sports.js` (`SPORT_META.nfl.active = false`). Falta todo el build.

---

## Por qué NFL y por qué ahora

- **Estacionalidad**: NFL es sep–feb. Con MLB (abr–oct) + NBA (oct–abr) la plataforma queda **year-round** con el evento de mayor audiencia (Super Bowl) cerrando el ciclo.
- **Demanda**: NFL es el deporte #1 de apuestas en EE.UU. El "lock of the week" (Imperdible) y los SGP (Parlay) son productos nativos de la cultura NFL.
- **Arquitectura lista**: el pipeline ya es deporte-agnóstico (lifecycle, parlay engine, sidecar por mercado, discriminador `sport`). NBA probó el patrón; NFL lo repite.

## Regla de seguridad operativa (igual que NBA)

- No tocar lógica MLB/NBA ni archivos frozen del Oracle. Todo NFL en archivos/rutas/prompt/UI nuevos o que **importen** los frozen.
- Trabajar en ramas dedicadas `feat/nfl-*` / `fix/nfl-*`.
- Discriminador `sport='nfl'` en toda persistencia. Filtros `COALESCE(sport,'mlb')='mlb'` ya protegen MLB.

---

## Diferencias estructurales vs NBA (lo que NO es copy-paste)

1. **Cadencia semanal, no diaria.** El selector trabaja por **semana NFL** (`seasontype`+`week`), no por fecha. Los background jobs son **game-time-aware** (solo pollean en ventanas Thu/Sun/Mon).
2. **Spread es el mercado primario** (no moneyline). **Key numbers 3 y 7** son ley en value/imperdible.
3. **Cap de confianza más bajo (≈72%)**: mercado más eficiente + varianza más alta de los tres deportes.
4. **QB = variable dominante.** El gate de disponibilidad gira alrededor del QB titular confirmado (análogo del "lineup confirmado" MLB).
5. **nflverse permite pre-entrenar el sidecar con histórico real** (>20 temporadas) → modelo útil desde el día 1, sin esperar 500 picks.
6. **Push frecuente** (spread/total en número entero) → el resolver debe manejarlo explícitamente.
7. **Weather pesa** (viento/frío en estadios abiertos).

---

## Sprints

### Sprint 9a — Scaffolding de datos 📋

Espeja NBA 7a. Objetivo: leer NFL de extremo a extremo sin análisis todavía.

- [ ] `server/nfl-api.js` — wrapper ESPN (games por semana, stats, standings, injuries, summary, recent games). Cache + fallback stale.
- [ ] `server/nfl-team-map.js` — ESPN id ↔ abbr ↔ nombre + coords estadio + flag `dome`.
- [ ] `server/nfl-context-builder.js` — contexto por partido (EPA, success, PROE, pace, QB status, rest/short-week/off-bye, weather, injuries, line) + `context_meta`.
- [ ] Migración `runNflScaffoldingMigrations()` — tablas `nfl_games`, `nfl_team_stats`; reusa `picks.sport` / `pick_features.sport`.
- [ ] Endpoints públicos `GET /api/nfl/games` (por semana), `/api/nfl/teams`, `/api/nfl/standings`.
- **Salida**: `GET /api/nfl/games?week=N` devuelve juegos normalizados; contexto sin bloques "data unavailable".

### Sprint 9b — Oracle NFL 📋

Espeja NBA 7b.

- [ ] `server/prompts/oracle-nfl-prompts.js` — `NFL_SYSTEM_PROMPT` + `NFL_CHAT_PROMPT`. Cap 72%, key numbers, guardrail anti-hallucination, prioridad QB→EPA.
- [ ] `server/services/oracleNfl.js` — `analyzeNflGame`, `analyzeNflChat` (Anthropic propio, sin Grok).
- [ ] `server/services/nflOutputGuard.js` — validación (no props, no ABSTAIN, rango confianza, parse).
- [ ] (Opcional) `server/nfl-advanced-fetcher.js` — stats nflverse semanales.
- **Salida**: análisis end-to-end de un juego con pick válido, JSON limpio, sin fabricaciones.

### Sprint 9c — Pick lifecycle NFL 📋

Espeja NBA 7c + 7c2.

- [ ] `server/routes/nfl.js` — `POST /api/nfl/analyze/game` + `/chat` (admin-only, flag `NFL_ANALYSIS_ENABLED`). Persiste `sport='nfl'`. Resuelve odds server-side vía `nfl-odds.js`.
- [ ] `server/nfl-odds.js` — The Odds API `americanfootball_nfl`, dual key, preserva key numbers.
- [ ] `server/pick-resolver-nfl.js` — resuelve pendientes NFL (reusa `resolvePickFromFinalState`/`tokenMatchesTeam`). **Maneja push.**
- [ ] Background job game-time-aware en `index.js` (solo ventanas Thu/Sun/Mon).
- **Salida**: crear → resolver de un pick NFL contra score final, aislado de jobs MLB/NBA.

### Sprint 9d — UI 📋

Espeja NBA 7d.

- [ ] `SportSwitcher` agrega pill NFL (livery propio).
- [ ] `GameSelector` — `normalizeNflGame` + **selector por semana** + fetch `/api/nfl/games`; muestra QB titular + spread, oculta pitchers.
- [ ] `AnalysisPanel` — endpoint NFL; oculta engine/webSearch/lineup MLB.
- [ ] `NflContextMetaBadge`, `NflStandingsPanel`, `client/src/utils/nflLogoUrl.js`.
- [ ] `HistoryPanel` + `useHistory` — logos y filtro `?sport=nfl`.
- **Salida**: flujo visual completo MLB/NBA/NFL en la tab de juego (admin).

### Sprint 9.1 — Dataset + shadow aislados 📋

Espeja NBA 7.1.

- [ ] `server/services/nflShadowValidator.js` — scoring determinístico (EPA diff, QB tier, rest, injuries, weather, HFA).
- [ ] `server/services/nflShadowPersistence.js` — `pick_features` + `shadow_model_runs` con `sport='nfl'`.
- [ ] Migración `runNflDatasetMigrations()` — columnas NFL en `pick_features`.
- [ ] `?sport=nfl` en APIs admin de dataset/shadow; toggles en `DatasetDashboardV2` + `ShadowModeDashboard`.
- **Salida**: filas NFL en `pick_features`/`shadow_model_runs` sin contaminar MLB/NBA.

### Sprint 9.2 — Live tracker NFL 📋

Sin equivalente directo NBA (NBA no pollea live). NFL sí, vía ESPN drives/plays.

- [ ] `server/pick-tracker-nfl.js` — progreso live (ML via winprobability, spread via margen, total via puntos+tiempo). Reusa `calculatePickProgress`.
- [ ] `client/src/components/NflLiveTracker.jsx`.
- [ ] Polling game-time-aware (60–90s solo en ventanas de juego).
- **Salida**: tracker live validado en una ventana de juego real.

### Sprint 9e — ML sidecar NFL (pre-entrenado) 📋

Espeja NBA 7e pero **adelantado** gracias a nflverse.

- [ ] Pre-entrenar XGBoost con play-by-play histórico nflverse (`nfl_data_py`): spread/total/ML, temporal split, Brier eval.
- [ ] Endpoints `/predict/nfl_*` en el sidecar Python; `data.py` filtra `sport='nfl'`.
- [ ] Integrar al pick-aligned shadow + ensemble cuando haya volumen.
- **Salida**: opinión ML NFL desde el día 1, calibrada contra histórico real.

---

## Producto: Parlay + Imperdible NFL

Reusan el motor existente con reglas NFL (detalle en [nfl-architecture.md](nfl-architecture.md) §6–§7).

- **Parlay Architect NFL**: matriz de correlación NFL (QB↔WR stacking, game script), soporte SGP, cadencia semanal. `hitMath.js` y modos se reusan tal cual.
- **Pick Imperdible NFL ("Lock of the Week")**: convicción invertida; gate = QB confirmado activo + margen a key number + weather OK. 1 lock/semana o PASS. Reusa `imperdibleSelector`/`imperdibleArbiter` + `imperdible_runs` con `sport='nfl'`.

---

## Feature flags NFL

| Flag | Default | Rol |
|---|---|---|
| `NFL_ANALYSIS_ENABLED` | `false` | Habilita endpoints Oracle NFL + resolver. `true` en local / Railway al lanzar MVP. |
| `NFL_LIVE_TRACKER_ENABLED` | `false` | Activa polling live game-time-aware (Sprint 9.2). |
| `NFL_PROPS_ENABLED` | `false` | Player props NFL (fase posterior, requiere resolver dedicado). |
| `IMPERDIBLE_NFL_ENABLED` | `false` | Lock of the week NFL. |

---

## Cronograma sugerido

NFL arranca en septiembre. Para llegar con MVP a **kickoff (early Sept 2026)** o, más realista, al tramo medio de temporada:

- **Verano 2026** (jun–ago, off-season NFL): Sprints 9a→9e en seco, validando contra juegos de temporadas pasadas (nflverse) y preseason (seasontype=1) para smoke.
- **Sept 2026**: flip `NFL_ANALYSIS_ENABLED` admin-only, validación E2E semana 1–3.
- **Oct 2026**: go-public gate (matriz §10 de architecture) → `nfl` a `ACTIVE_SPORTS`.
- **Playoffs / Super Bowl 2027**: Imperdible "Lock of the Week" + SGP como features estrella.

---

## Estado de release gate

Ver matriz completa en [nfl-architecture.md](nfl-architecture.md) §10. Umbral: ≥8.0 por criterio crítico, ≥8.5 en aislamiento por deporte.
