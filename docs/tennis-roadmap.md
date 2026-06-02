# Roadmap Tennis — H.E.X.A. v4

Plan de construcción del **sexto deporte** (Sprint 12) y el **primero individual**. Detalle técnico y de datos en [tennis-architecture.md](tennis-architecture.md). Checklist multi-deporte en [sport-registry.md](sport-registry.md). Espeja la serie Soccer (Sprint 11) que a su vez espejó NFL/NBA, con las adaptaciones de "deporte individual" documentadas en la spec.

**Estado**: 🔄 en build. **12a cerrado en código** (rama `claude/tennis-sprint-12`); 12b–12e pendientes. `tennis` sigue inactivo en el registry (`SPORT_META.tennis.active=false`) hasta el go-public gate.

---

## Por qué Tennis y por qué ahora

- **Año redondo**: es el único deporte que rellena **todos** los huecos del calendario. Con MLB+NBA+NFL+NHL+Soccer ya cubiertos, Tennis tapa enero (Australian Open) y los meses de transición. La plataforma queda con cobertura continua sin estacionalidad muerta.
- **Demanda + producto**: Grand Slams son tentpoles globales; el "lock del día" y los parlays de favoritos en primeras rondas son productos naturales.
- **Arquitectura casi lista**: el pipeline ya es deporte-agnóstico y `league`-aware (gracias a Soccer). Tennis reusa la dimensión `league` para tours (atp/wta) y el esquema home/away mapeando A→home, B→away. Lo único genuinamente nuevo es el **resolver de retiros/walkovers**.

## Regla de seguridad operativa (igual que los demás)

- No tocar lógica MLB/NBA/NFL/NHL/Soccer ni archivos frozen del Oracle. Todo Tennis en archivos/rutas/prompt/UI nuevos o que **importen** los frozen.
- Trabajar en ramas dedicadas `claude/tennis-*`.
- Discriminador `sport='tennis'` + `league IN ('atp','wta')` en toda persistencia. Filtros `COALESCE(sport,'mlb')='mlb'` ya protegen MLB; los demás deportes filtran por su propio sport.

---

## Diferencias estructurales vs Soccer (lo que NO es copy-paste)

1. **Deporte individual.** Player A vs Player B en vez de home/away teams. Se mapea **A→slot home, B→slot away** para reusar `pick_features` y el dataset, pero el resolver y la UI tratan jugadores, no equipos. Sin `team-map` seed (miles de jugadores) → matching por nombre normalizado + `athlete.id` ESPN.
2. **Superficie = park factor.** ELO por superficie (hard/clay/grass) es el predictor #1, por encima del ranking. Es la pieza de datos diferenciadora.
3. **Mercado 2-vías sin empate** (como NHL moneyline) + set handicap (±1.5 sets, análogo puck line) + total games.
4. **Retiros/walkovers → void + refund.** El resolver **no reusa** `resolvePickFromFinalState`; tiene lógica propia que detecta `STATUS_RETIRED`/`STATUS_WALKOVER` y anula con devolución de crédito. Es el punto más delicado del sprint.
5. **Best-of-5** en Grand Slams masculinos cambia varianza y fatiga.
6. **Shape ESPN anidado**: el scoreboard agrupa partidos por torneo (`events[].competitions[]`) — hay que aplanar.
7. **Sackmann permite pre-entrenar el sidecar** con histórico real (>50 años) → modelo útil desde el día 1, sin esperar 500 picks.

---

## Sprints

### Sprint 12a — Scaffolding de datos ✅ (cerrado en código)

Espeja Soccer 11a. Objetivo: leer Tennis de extremo a extremo sin análisis todavía. **Cerrado en código (rama `claude/tennis-sprint-12`)** — pendiente smoke con tráfico real en prod (ESPN/Odds API bloqueados desde el sandbox de dev, igual que NBA/NFL/NHL/Soccer en su momento).

- [x] `server/tennis-tour-map.js` — registro de tours atp/wta (label, oddsApiSlug, género, bestOfMax) + vocabulario de superficies (`normalizeSurface`) y rounds (`roundDepth` 1..7). Helpers `getTennisTour`, `isSupportedTour`, `getTennisTourByOddsSlug`.
- [x] `server/tennis-api.js` — wrapper ESPN tour-aware. `getTennisMatchesForDate(tour, date)` **aplana** `events[].competitions[]` → lista de partidos con superficie/round heredados (salta dobles/malformados); `getTennisTournamentDraw`, `getTennisMatchSummary` (TTL corto para live), `getTennisRankings`. Cache + fallback stale; nunca throwea. Exporta `isVoidStatusName` (retiro/walkover/abandonado) para el resolver de 12c.
- [x] `server/tennis-odds.js` — The Odds API `tennis_atp`/`tennis_wta`, dual key. h2h 2-vías primario; set handicap/total cuando existan. `matchTennisOddsToMatch` por nombre normalizado **con detección de orientación A/B flip**; `buildMarketOddsForMatch` respeta el flip.
- [x] `server/tennis-context-builder.js` — `buildTennisMatchContext` con ranking (ESPN), superficie, round/best-of, market odds, `context_meta` con `staleFlags` honestos. ELO-surface/H2H/forma presentes pero null hasta el fetcher Sackmann (12b).
- [x] Migración `runTennisScaffoldingMigrations()` (tabla `tennis_matches`, reusa `league` como tour) + `runTennisDatasetMigrations()` (columnas tennis en `pick_features`, reusando slots home/away). Cableadas tras las de Soccer en `index.js`.
- [x] Endpoints públicos `GET /api/tennis/matches?tour=&date=`, `/api/tennis/rankings?tour=`.
- [x] Tests: `server/__tests__/tennis-tour-map.test.js` (19 tests, lógica pura) + `tennis-odds.test.js` (11 tests: matching straight/flipped, build, void status).
- **Salida**: `GET /api/tennis/matches?tour=atp&date=` devuelve partidos normalizados; el context builder degrada con `staleFlags` honestos cuando una fuente falla. 30 tests verdes.

### Sprint 12b — Oracle Tennis 📋

Espeja Soccer 11b.

- [ ] `server/tennis-elo-fetcher.js` — baja datasets Sackmann (ELO-surface, H2H, forma), cache 24h. `getSurfaceElo`, `getH2H`, `getRecentForm`. (Puede empezar en 12b y refinarse; el Oracle cae a ranking si ELO falta.)
- [ ] `server/prompts/oracle-tennis-prompts.js` — `TENNIS_SYSTEM_PROMPT` + `TENNIS_CHAT_PROMPT` + `TENNIS_OUTPUT_SCHEMA_VERSION`. Cap 72%, prioridad ELO-surface→H2H→forma→fatiga→ranking, guardrail anti-retiro + anti-hallucination + anti-bias.
- [ ] `server/services/oracleTennis.js` — `analyzeTennisMatch`, `analyzeTennisChat`, `serializeTennisContext` (Anthropic propio, sin Grok; no toca oracle.js).
- [ ] `server/services/tennisOutputGuard.js` — `pick_side` exactamente `player_a|player_b` (sin empate), confianza 50–72, bet_type válido, rechaza props/ABSTAIN/parlay/parse fallido.
- [ ] Tests: `tennisOutputGuard.test.js` + serializer end-to-end con contexto mock.
- **Salida**: motor end-to-end listo; la llamada LLM real se valida cuando 12c exponga el endpoint.

### Sprint 12c — Pick lifecycle Tennis 📋 (el sprint crítico)

Espeja Soccer 11c **+ resolver propio**.

- [ ] `server/routes/tennis.js` — `POST /api/tennis/analyze/match` + `/chat` (admin-only, flag `TENNIS_ANALYSIS_ENABLED` → 503). Valida `tour`. Persiste `sport='tennis'`, `league=tour`. Resuelve odds server-side.
- [ ] `server/pick-resolver-tennis.js` — **lógica propia, NO reusa `resolvePickFromFinalState`**. Match winner / set handicap / total games por score de sets. **`STATUS_RETIRED`/`STATUS_WALKOVER`/`STATUS_ABANDONED` → `result='void'` + refund de crédito.** Job diario gated por flag, pollea solo si hay partidos `in`.
- [ ] Path de refund en void verificado/reusado (mismo que otros voids). Documentar `result='void'` tennis en `docs/data-schema.md`.
- [ ] `chatPickExtractor.js` extendido a `'tennis'` (sport normaliza; market hint moneyline/set_handicap/total; persiste `sport='tennis'` sin contaminar otros).
- [ ] Tests: resolver con casos final / retiro / walkover / set-handicap / total-games (lógica pura, sin red).
- **Salida**: crear → resolver de un pick Tennis contra score final, **con void correcto en retiro**, aislado de jobs de otros deportes.

### Sprint 12.1 — Dataset + shadow 📋

Espeja Soccer 11.1.

- [ ] `server/services/tennisShadowValidator.js` — P(win) desde ELO-surface diff (logística) ajustado por H2H + forma; de-vig odds h2h 2-vías; cap 50–72.
- [ ] `server/services/tennisShadowPersistence.js` — `saveTennisPickFeatures` + `recordTennisShadowRun`, fire-and-forget, `sport='tennis'`, `league=tour`. Columnas tennis en `pick_features` pobladas (A→home, B→away).
- [ ] Disparo fire-and-forget desde `routes/tennis.js`.
- [ ] APIs admin dataset/shadow admiten `?sport=tennis`.
- **Salida**: filas Tennis en `pick_features` + `shadow_model_runs` sin contaminar los otros deportes.

### Sprint 12d — UI 📋

Espeja Soccer 11d.

- [ ] `client/src/config/sports.js` `tennis.active=true` + `ACTIVE_SPORTS` incluye `'tennis'`; `server/sports.js` igual.
- [ ] `client/src/config/sportCapabilities.js` — gameAnalysis/oracleChat habilitados para Tennis; board/live/parlay "fase posterior".
- [ ] `SportSwitcher` livery Tennis (6º botón, `clipFor()` ya adaptativo).
- [ ] `GameSelector` — `normalizeTennisMatch`, dropdown tour ATP/WTA, jugador A vs B + superficie, foto/bandera en vez de logo de equipo.
- [ ] `AnalysisPanel` — endpoint `/api/tennis/analyze/match`, SAFE bloqueado, controles MLB-only gateados.
- [ ] `OracleChat` — games + `/api/tennis/analyze/chat` + selector de tour.
- [ ] `client/src/utils/tennisLogoUrl.js` — foto del jugador / bandera por `athlete.id` ESPN.
- [ ] `HistoryPanel` — matchup jugador A vs B (sin logos de equipo).
- **Salida**: Tennis seleccionable en UI, análisis funcional end-to-end con tour ATP/WTA.

### Sprint 12e — ML sidecar 📋 (puede pre-entrenarse)

Espeja Soccer 11 ML + ventaja nflverse/Sackmann.

- [ ] `ml/hexa_ml/models/tennis.py` — `TennisMoneylineModel` (XGBoost, L2 fuerte). Set handicap/total después.
- [ ] `features.py` TENNIS_BASE_NUMERIC (elo-surface diff, elo-overall diff, rank diff, h2h diff, form diff, fatiga diff, best_of, surface one-hot) + `add_tennis_derived()` (de-vig 2-way).
- [ ] `data.py` columnas tennis + `filter_for_market` + `make_target`; `train.py` TENNIS_MARKETS + `load_dataset(sport="tennis")`; `serve.py` predict routes.
- [ ] `server/services/tennisMlClient.js` — circuit breaker propio (patrón `soccerMlClient.js`).
- [ ] **Pre-entrenamiento con histórico Sackmann** (ELO-surface → resultados) en vez de esperar picks resueltos.
- **Salida**: modelo `tennis_moneyline` útil desde el día 1; ensemble cuando haya picks reales.

### Fase posterior (no MVP Sprint 12)

- `hexaTennisBoardService.js` (pizarra diaria ATP+WTA).
- `pick-tracker-tennis.js` + live tracker UI (progreso por set).
- Parlay Tennis (ajuste de void = pata removida).
- Pick Imperdible Tennis ("lock del día" en Grand Slams).
- Player props / games por set.

---

## Criterio de éxito del Sprint 12

- El Oracle **distingue comportamiento en superficie**: no da el mismo pick en arcilla vs dura para el mismo matchup.
- **Retiro mid-match → pick anulado automáticamente, crédito devuelto.** (Validar con un partido real, idealmente Bo5 de Grand Slam.)
- Selector por tour ATP/WTA + fecha funcional.
- Aislamiento total: `sport='tennis'`, `league=tour`, cero contaminación a los otros 5 deportes.
- Un Grand Slam (Australian Open ene / Roland Garros may) como torneo de validación E2E.

## Esfuerzo estimado

~2–3 semanas. El reaprovechamiento del pipeline league-aware (Soccer) baja mucho el costo; el **resolver de walkover/retiro** es el único componente genuinamente nuevo y el más delicado.
