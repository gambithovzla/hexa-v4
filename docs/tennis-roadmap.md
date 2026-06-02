# Roadmap Tennis — H.E.X.A. v4

Plan de construcción del **sexto deporte** (Sprint 12) y el **primero individual**. Detalle técnico y de datos en [tennis-architecture.md](tennis-architecture.md). Checklist multi-deporte en [sport-registry.md](sport-registry.md). Espeja la serie Soccer (Sprint 11) que a su vez espejó NFL/NBA, con las adaptaciones de "deporte individual" documentadas en la spec.

**Estado**: 🔄 en build. **12a + 12b + 12c cerrados en código** (rama `claude/tennis-sprint-12`); 12.1, 12d, 12e pendientes. `tennis` sigue inactivo en el registry (`SPORT_META.tennis.active=false`) hasta el go-public gate.

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

### Sprint 12b — Oracle Tennis ✅ (cerrado en código)

Espeja Soccer 11b. **Cerrado en código (rama `claude/tennis-sprint-12`)** — la llamada LLM real se valida cuando 12c exponga el endpoint (requiere `ANTHROPIC_API_KEY` + red).

- [x] `server/tennis-elo-fetcher.js` — baja los CSV de partidos de Jeff Sackmann (GitHub, temporada actual + previa), corre un **único pase cronológico de ELO** (overall + por superficie, K=32) y construye índices H2H + forma reciente. Cache 24h, stale fallback, **nunca throwea** (cae a null → el Oracle usa ranking). `getSurfaceElo`, `getH2H`, `getRecentForm`, `getTennisEloStatus`.
- [x] Context builder cableado al fetcher: `buildTennisMatchContext` ahora puebla ELO-surface/overall, forma y un bloque `h2h` vía `Promise.all`; `staleFlags` y `completeness` reflejan presencia real de ELO/H2H.
- [x] `server/prompts/oracle-tennis-prompts.js` — `TENNIS_SYSTEM_PROMPT` + `TENNIS_CHAT_PROMPT` + `TENNIS_OUTPUT_SCHEMA_VERSION`. Cap **72%**, mercado 2-vías (sin empate), prioridad surface-ELO→H2H→forma→fatiga→ranking, **guardrail anti-retiro** + anti-hallucination + anti-bias. Output JSON con `pick_side` y `probability_model` de 2 claves (sin draw).
- [x] `server/services/oracleTennis.js` — `analyzeTennisMatch`, `analyzeTennisChat` (Anthropic propio, sin Grok; **no toca oracle.js**). Modelos: sonnet deep / opus-4-8 premium / haiku chat.
- [x] `server/services/tennisContextSerializer.js` — serializador puro extraído (testeable sin el SDK); re-exportado desde `oracleTennis.js`.
- [x] `server/services/tennisOutputGuard.js` — `pick_side` exactamente `player_a|player_b` (sin empate, fatal si falta/ inválido), confianza 50–72, bet_type ∈ Match Winner/Set Handicap/Total Games, `probability_model` de 2 claves (flag si trae draw), rechaza props/ABSTAIN/parlay/parse fallido.
- [x] Tests: `tennisOutputGuard.test.js` (16 tests: guard + serializer end-to-end con contexto mock, incl. degradación sin ELO/H2H/odds).
- **Salida**: motor end-to-end listo; 35 tests tennis verdes. La llamada LLM real se valida cuando 12c exponga el endpoint.

### Sprint 12c — Pick lifecycle Tennis ✅ (cerrado en código — el sprint crítico)

Espeja Soccer 11c **+ resolver propio**. **Cerrado en código (rama `claude/tennis-sprint-12`)** — la llamada LLM/Odds real se valida en prod (keys + red).

- [x] `server/routes/tennis.js` — `POST /api/tennis/analyze/match` + `/chat` (admin-only, flag `TENNIS_ANALYSIS_ENABLED` → 503). Valida `tour`. Persiste `sport='tennis'`, `league=tour`, `game_pk=parseInt(matchId)`. Resuelve odds server-side. Montado en `index.js` (`app.use('/api/tennis')`). (pick_features/shadow → 12.1.)
- [x] `server/pick-resolver-tennis.js` + `server/tennis-resolution.js` — **lógica propia, NO reusa `resolvePickFromFinalState`**. Match winner / set handicap (±1.5, half-point, sin push) / total games por score de sets. **`STATUS_RETIRED`/`STATUS_WALKOVER`/`STATUS_ABANDONED`/`STATUS_CANCELED` → `result='void'`.** Lógica pura extraída a `tennis-resolution.js` (testeable sin `pg`). Job diario en `index.js` gated por `TENNIS_ANALYSIS_ENABLED` (ventana 19:00–05:59 ET; el resolver salta fechas sin pendientes).
- [x] **Política de void = no acción**: `result='void'` queda fuera de `IN ('won','lost','push','win','loss')`, así que se **excluye automáticamente** de todo ROI/equity/win-rate. Tennis es admin-only sin descuento de créditos en esta fase, por lo que no hay refund explícito que invocar.
- [x] `chatPickExtractor.js` extendido a `'tennis'` (sport normaliza a `'tennis'` en `saveExtractedChatPick` — sin contaminar otros; market hint match winner/set handicap/total games en `augmentChatQuestion`).
- [x] Tests: `pick-resolver-tennis.test.js` (16 tests: match winner win/loss/ambiguo, set handicap -1.5 Bo3/Bo5 + +1.5, total over/under/push, **retiro→void, walkover→void**).
- **Salida**: crear → resolver de un pick Tennis contra score final, **con void correcto en retiro/walkover**, aislado de jobs de otros deportes. 51 tests tennis verdes en total.

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
