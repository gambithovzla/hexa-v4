# Arquitectura Tennis — H.E.X.A. v4

Documento maestro del **sexto deporte** de la plataforma (Sprint 12) y el **primero individual** (jugador vs jugador, no equipo vs equipo). Espeja el patrón con que se construyeron NBA/NFL/NHL/Soccer — archivos nuevos aislados que importan/orquestan los frozen, discriminador `sport='tennis'` en toda persistencia, cero ediciones a los paths frozen del Oracle MLB — pero con una **adaptación de impedancia** clave: el modelo de datos team-based (home/away) se reutiliza mapeando `player_a → slot home` y `player_b → slot away`.

> Antes de tocar nada lee también: [sport-registry.md](sport-registry.md) (checklist multi-deporte), [architecture.md](architecture.md) (arquitectura global), la sección Soccer de [CLAUDE.md](../CLAUDE.md) (el patrón league-aware que reutilizamos para tours), y [nfl-architecture.md](nfl-architecture.md) (la plantilla de esta doc).

---

## 0. TL;DR

- **Deporte individual**: no hay equipo. El contexto es **jugador A vs jugador B**: ranking, ELO por superficie, H2H, forma reciente, fatiga de torneo (rounds jugados, minutos en cancha), y disponibilidad (retiros/lesiones). Para reutilizar el esquema team-based existente, **`player_a` ocupa el slot "home"** y **`player_b` el slot "away"** en `pick_features` y en el resolver.
- **Tour = segunda dimensión** (`league`): `atp` (masculino) y `wta` (femenino), reusando la columna `league VARCHAR(32)` que ya añadió Soccer. Un solo wrapper con `tour` como parámetro (patrón Soccer multi-liga), no dos wrappers.
- **Superficie = park factor**: arcilla (Roland Garros) ↔ hierba (Wimbledon) ↔ dura (AO/USO) cambian radicalmente los matchups. El **ELO por superficie** es más predictivo que el ranking oficial. Es la pieza de datos diferenciadora de Tennis (análogo a Statcast/EPA/xG).
- **Mercados**: match winner (2-vías, **sin empate** — análogo a NHL moneyline), set handicap (±1.5 sets, análogo al puck line/runline), total de games over/under.
- **Datos**: ESPN hidden API tennis (gratis, sin key) para partidos del día / scores live / draw del torneo; **The Odds API** `tennis_atp` / `tennis_wta` (dual key) para líneas; **Tennis Abstract (Jeff Sackmann)** — repos GitHub gratuitos — para ELO por superficie + H2H histórico + stats de juego.
- **Cadencia**: **diaria por fecha** (como NHL/Soccer/MLB), no semanal. Durante un Grand Slam o un combinado ATP+WTA hay decenas de partidos/día; fuera de torneos grandes, pocos.
- **El reto único — retiros y walkovers**: un jugador puede retirarse mid-match por lesión, o no presentarse (walkover). El resolver **no puede** reusar tal cual `resolvePickFromFinalState` (es team-based y asume juego completado). Tennis necesita lógica propia que detecte `retired`/`walkover`/`canceled` y marque `result='void'` con **devolución de crédito** (política de la casa = no acción). Este es el punto más delicado del sprint.
- **Aislamiento**: archivos `tennis-*` nuevos, `sport='tennis'` + `league IN ('atp','wta')` en toda persistencia, feature flag `TENNIS_ANALYSIS_ENABLED`. Cero ediciones a frozen.

---

## 1. Fuentes de datos (deep research)

### 1.1 ESPN hidden API tennis (primaria — gratis, sin key)

Mismo proveedor que NBA/NFL/NHL/Soccer. Endpoints reverse-engineered, sin auth, sin SLA. Riesgo aceptado: ESPN puede cambiar/quitar endpoints → mismo patrón de cache + fallback stale que el resto.

| Necesidad | Endpoint | Notas |
|---|---|---|
| Partidos del día | `site.api.espn.com/apis/site/v2/sports/tennis/{tour}/scoreboard?dates=YYYYMMDD` | `{tour}` = `atp` o `wta`. Devuelve eventos (torneos) con sus competencias (partidos). **Estructura anidada distinta a los deportes de equipo**: un "event" es un torneo, dentro hay `competitions[]` que son los partidos individuales. |
| Draw / bracket del torneo | `site.api.espn.com/apis/site/v2/sports/tennis/{tour}/tournaments/{id}` | Cuadro del torneo, rounds, superficie. |
| Resumen de partido (live + final) | `site.api.espn.com/apis/site/v2/sports/tennis/{tour}/summary?event={competitionId}` | Score por set, estado del partido (`in`/`post`/`status.type.detail`), **flag de retiro/walkover** en `status.type.name` (`STATUS_RETIRED`, `STATUS_WALKOVER`, `STATUS_ABANDONED`). La pieza crítica para el resolver. |
| Rankings | `site.api.espn.com/apis/site/v2/sports/tennis/{tour}/rankings` | Ranking ATP/WTA oficial (cache 24h). |
| Atleta | `site.api.espn.com/apis/site/v2/sports/tennis/{tour}/athletes/{id}` | Perfil, país, mano (diestro/zurdo). |

**Identidad de jugadores**: ESPN entrega `athlete.id` (numérico) + `displayName` por competidor. No hay un `tennis-player-map.js` seed (son miles de jugadores y rotan); en su lugar **keyeamos por `displayName` normalizado** (accent-strip, igual que `findSoccerTeam`) y guardamos el `athlete.id` ESPN cuando viene, para logos y H2H. El nombre canónico es la fuente de verdad para el matching de odds y del resolver.

**Mapeo del shape anidado**: el scoreboard ESPN tennis agrupa partidos por torneo. `getTennisMatchesForDate(tour, date)` debe **aplanar** `events[].competitions[]` a una lista de partidos con la superficie y el round heredados del torneo padre.

### 1.2 The Odds API `tennis_atp` / `tennis_wta` (líneas)

Reusa el patrón `soccer-odds.js` (dual key fallback, aislado del frozen `odds-api.js`).

- Sports keys: `tennis_atp`, `tennis_wta` (y variantes por Grand Slam, p.ej. `tennis_atp_wimbledon` — el wrapper debe probar el genérico + el específico del torneo activo).
- Mercados: `h2h` (match winner, 2-vías). Set handicap (`spreads`) y total games (`totals`) tienen **cobertura irregular** en The Odds API para tennis — el wrapper los expone cuando existen y degrada a solo-moneyline cuando no.
- Matching: por **nombre de jugador** (no team_id). `matchTennisOddsToMatch` normaliza nombres "Apellido, Nombre" ↔ "Nombre Apellido" antes de comparar.

### 1.3 Tennis Abstract / Jeff Sackmann (ELO superficie + H2H — el "Savant" del tennis)

El análogo de Baseball Savant / nflverse / Understat. Datos gratuitos, GitHub, actualizados frecuentemente.

- Repos: `tennis_atp` y `tennis_wta` (resultados partido-a-partido desde los 60s), `tennis_MatchChartingProject` (stats de juego detalladas). CSV descargables.
- **ELO por superficie**: se calcula a partir del histórico de partidos (no viene precomputado en todos los casos; Sackmann publica ELO general + por superficie en releases periódicos). Un `tennis-elo-fetcher.js` (análogo `savant-fetcher.js` / `soccer-xg-fetcher.js`) baja y cachea (24h) el dataset y expone `getSurfaceElo(playerName, surface)` + `getH2H(playerA, playerB, surface)`.
- Métricas clave que alimentan contexto y dataset:
  - **ELO general** y **ELO por superficie** (hard/clay/grass) — el predictor #1.
  - **H2H** total y por superficie (últimos N enfrentamientos).
  - **% de puntos ganados al servicio / al resto**, % de break points salvados/convertidos (cuando el Match Charting Project los cubre).
  - **Forma reciente**: W-L últimos 10, racha en superficie actual.
- **Ventaja tipo nflverse**: Sackmann tiene >50 años de histórico → el sidecar ML puede **pre-entrenarse con resultados reales** (ELO-surface → P(win)) en vez de esperar ~500 picks. Es el camino recomendado (Sprint 12e).

### 1.4 Fatiga de torneo (derivada, sin fuente externa)

No requiere API: se deriva del propio draw + scores ESPN.
- **Rounds jugados** en el torneo actual (R128 → final).
- **Sets/games jugados acumulados** y **minutos en cancha** (cuando ESPN los da) — un jugador que viene de un 5-set de 4h tiene desventaja física.
- **Días de descanso** desde el último partido.
- Best-of-3 vs **best-of-5** (Grand Slams masculinos) cambia la varianza y la fatiga.

---

## 2. Mapa de archivos (espejo Soccer → Tennis)

Patrón de aislamiento: **crear archivos nuevos que importen los frozen, nunca editarlos.** Igual que `oracleSoccer.js` instancia su propio Anthropic SDK en vez de tocar `oracle.js`.

### Backend nuevo

| Archivo Tennis (nuevo) | Espeja a | Rol |
|---|---|---|
| `server/tennis-tour-map.js` | `soccer-league-map.js` | Registro de tours: `atp` / `wta` (label, oddsApiSlug, género). Helpers `getTennisTour`, `isSupportedTour`. Constantes de superficies y de rounds. |
| `server/tennis-api.js` | `soccer-api.js` | Wrapper ESPN tennis tour-aware. `getTennisMatchesForDate(tour, date)` (aplana torneo→partidos), `getTennisTournamentDraw`, `getTennisMatchSummary(tour, eventId)`, `getTennisRankings(tour)`. Cache 5min (30s live) + fallback stale; nunca throwea. |
| `server/tennis-odds.js` | `soccer-odds.js` | The Odds API `tennis_atp`/`tennis_wta`, dual key. `getTennisMatchOdds`, `matchTennisOddsToMatch` (match por nombre normalizado), `buildMarketOddsForMatch` (h2h primario; set handicap/total si existen). |
| `server/tennis-elo-fetcher.js` | `soccer-xg-fetcher.js` / `savant-fetcher.js` | Baja datasets Sackmann, cache 24h. `getSurfaceElo(name, surface)`, `getH2H(a, b, surface)`, `getRecentForm(name)`. |
| `server/tennis-context-builder.js` | `soccer-context-builder.js` | `buildTennisMatchContext`: ranking, ELO superficie A/B, H2H (últimos 5 + por superficie), forma reciente, round + fatiga (rounds jugados, sets acumulados, días de descanso), superficie del torneo, best-of, market odds, `context_meta` (sources, completeness, staleFlags). |
| `server/prompts/oracle-tennis-prompts.js` | `oracle-soccer-prompts.js` | `TENNIS_SYSTEM_PROMPT` + `TENNIS_CHAT_PROMPT`. Cap 72%, prioridad ELO-surface→H2H→forma→fatiga→ranking, **guardrail anti-retiro** (no asumir que el partido se completa), guardrail anti-hallucination. |
| `server/services/oracleTennis.js` | `oracleSoccer.js` | Motor LLM Tennis (Anthropic only, sin Grok). `analyzeTennisMatch`, `analyzeTennisChat`, `serializeTennisContext`. Cliente Anthropic propio. **No toca oracle.js.** |
| `server/services/tennisOutputGuard.js` | `soccerOutputGuard.js` | Valida output: `pick_side` exactamente `player_a|player_b` (nunca empate), confianza 50–72, bet_type ∈ `moneyline|set_handicap|total_games`, rechaza props/ABSTAIN/parse fallido/parlay. |
| `server/services/tennisShadowValidator.js` | `soccerShadowValidator.js` | Validador determinístico: P(win) desde ELO-surface diff (logística), ajustado por H2H y forma; de-vig de odds h2h 2-vías. Cap 50–72. |
| `server/services/tennisShadowPersistence.js` | `soccerShadowPersistence.js` | Persiste `pick_features` + `shadow_model_runs` con `sport='tennis'`, `league=tour`. Fire-and-forget. |
| `server/pick-resolver-tennis.js` | `pick-resolver-soccer.js` | **Lógica propia (NO reusa `resolvePickFromFinalState`)**: lee score por set + estado del partido. Match winner → ganador. Set handicap / total games → cuenta sets/games. **Retiro/walkover/abandonado → `result='void'` + refund.** Ver §4. |
| `server/pick-tracker-tennis.js` | `pick-tracker-soccer.js` | Progreso en vivo: set actual, games, quién saca, sets ganados. |
| `server/services/hexaTennisBoardService.js` | `hexaSoccerBoardService.js` | Pizarra diaria: torneos activos ATP+WTA, partidos destacados del día. (Fase posterior.) |
| `server/routes/tennis.js` | `routes/soccer.js` | Endpoints (ver §3). Feature-flagged `TENNIS_ANALYSIS_ENABLED`, admin-only durante MVP. |

### Frontend nuevo / modificado

| Archivo | Cambio |
|---|---|
| `client/src/config/sports.js` | `tennis.active = true`; agregar `'tennis'` a `ACTIVE_SPORTS` (al flip público). Ya está en `ALL_SPORTS`. |
| `server/sports.js` | agregar `'tennis'` a `ACTIVE_SPORTS` (al flip público). Ya está en `KNOWN_SPORTS`. |
| `client/src/config/sportCapabilities.js` | reglas Tennis por módulo (gameAnalysis/oracleChat habilitados; board/live/parlay "fase posterior" con copy es/en). |
| `client/src/components/SportSwitcher.jsx` | agregar pill Tennis (livery propio, p.ej. verde-cancha/amarillo-pelota). `clipFor()` ya soporta layout adaptativo de 6 botones. |
| `client/src/components/GameSelector.jsx` | `normalizeTennisMatch(raw, tour)` + fetch `/api/tennis/matches`. **Selector tour ATP/WTA** (dropdown, análogo al de ligas Soccer). Muestra jugador A vs jugador B + superficie; oculta pitchers/logos de equipo (usa foto/bandera del jugador). |
| `client/src/components/AnalysisPanel.jsx` | cuando `sport='tennis'` → `/api/tennis/analyze/match`. SAFE bloqueado; oculta engine picker, webSearch, lineup MLB. |
| `client/src/utils/tennisLogoUrl.js` | foto del jugador / bandera del país por `athlete.id` ESPN (nuevo). |
| `client/src/components/OracleChat.jsx` | games + `/api/tennis/analyze/chat` + selector de tour. |
| `client/src/hooks/useHistory.js` | ya soporta `?sport=` — agregar `'tennis'` a los filtros. |
| `client/src/components/HistoryPanel.jsx` | render del matchup jugador A vs B (no logos de equipo). |

### DB (migraciones idempotentes en `server/migrate.js`)

`runTennisScaffoldingMigrations()` (espeja `runSoccerScaffoldingMigrations`):
- `picks.sport` y `pick_features.sport` ya existen (`DEFAULT 'mlb'`) — reusados.
- `picks.league` / `pick_features.league` ya existen (añadidos por Soccer) — reusados para `atp`/`wta`.
- Tabla `tennis_matches` (cache): `match_id`, `tour`, `tournament_id`, `tournament_name`, `surface`, `round`, `best_of`, `match_date`, `player_a_id/name`, `player_b_id/name`, `status`, `score_json`, `winner`, timestamps. Index por `(tour, match_date)`.

`runTennisDatasetMigrations()` (espeja `runSoccerDatasetMigrations`): columnas NULL en `pick_features` (filas de otros deportes quedan NULL). **Reusa los slots home/away** mapeando A→home, B→away:
- `home_elo_surface`, `away_elo_surface` (ELO por superficie del jugador A/B).
- `home_elo_overall`, `away_elo_overall`.
- `home_rank`, `away_rank` (ranking ATP/WTA).
- `h2h_surface_wins_home`, `h2h_surface_wins_away` (H2H por superficie).
- `h2h_total_wins_home`, `h2h_total_wins_away`.
- `tournament_round` (numérico: 1=R128 … 7=final), `best_of` (3|5).
- `home_rest_days`, `away_rest_days`, `home_sets_played_tourney`, `away_sets_played_tourney` (fatiga).
- `surface VARCHAR(10)` (hard|clay|grass|carpet), `set_handicap_close`, `total_games_close`.
- `shadow_model_runs.sport` / `.league` ya existen — reusados.

---

## 3. Rutas

Todas feature-flagged `TENNIS_ANALYSIS_ENABLED=true` (503 si no), admin-only durante MVP (igual que NBA/NFL/NHL/Soccer).

| Método + path | Espeja | Notas |
|---|---|---|
| `POST /api/tennis/analyze/match` | `/api/soccer/analyze/game` | `{ matchId, tour, lang?, riskProfile?, marketOdds?, bankroll? }`. Valida `tour` contra `tennis-tour-map.js`. Flujo: fetch match → resolver odds server-side → build context → `analyzeTennisMatch` → `tennisOutputGuard` → persist (`sport='tennis'`, `league=tour`) → shadow/features fire-and-forget. |
| `POST /api/tennis/analyze/chat` | `/api/soccer/analyze/chat` | Oracle Chat Tennis. `X-Hexa-Skip-Pick-Extract: 1` opt-out. |
| `GET /api/tennis/matches?tour=&date=` | `/api/soccer/games?league=&date=` | Partidos del día por tour. Sin `date` → hoy ET. |
| `GET /api/tennis/rankings?tour=` | `/api/soccer/standings` | Ranking ATP/WTA. |
| `GET /api/tennis/board?date=&force=` | `/api/soccer/board` | Pizarra diaria (fase posterior). |
| (Historial) `GET /api/picks?sport=tennis` | — | Ya soportado server-side. |

---

## 4. Resolución — el corazón del sprint (retiros, walkovers, voids)

A diferencia de los cinco deportes anteriores, Tennis **no puede reusar** el frozen `resolvePickFromFinalState`/`tokenMatchesTeam` (asumen equipos y juego completado). `pick-resolver-tennis.js` implementa lógica propia:

1. **Fuente**: `getTennisMatchSummary(tour, eventId)` → `status.type.name` + score por set + ganador.
2. **Estados terminales** y su política:
   - `STATUS_FINAL` (partido completo) → resolución normal.
   - `STATUS_RETIRED` (un jugador se retiró mid-match) → **`result='void'`**, crédito devuelto. Política de la casa estándar: la mayoría de books anulan apuestas de match winner si no se completó al menos 1 set (algunos liquidan si el primer set terminó). **Decisión H.E.X.A. v1: void siempre que haya retiro/walkover** — la opción más conservadora y la que no requiere replicar la regla específica de cada book.
   - `STATUS_WALKOVER` (un jugador no se presentó) → **`result='void'`**, refund.
   - `STATUS_ABANDONED` / `STATUS_CANCELED` / `STATUS_POSTPONED` → pendiente (re-chequear) o void si pasa demasiado tiempo.
3. **Resolución normal por mercado**:
   - **Match winner (moneyline)**: ganador del partido vs `pick_side` (`player_a`|`player_b`). Sin empate posible.
   - **Set handicap (±1.5 sets)**: diferencia de sets ganados vs la línea. Ej. `player_a -1.5` gana si A ganó por 2+ sets (2-0 en Bo3, o 3-0/3-1 en Bo5).
   - **Total games**: suma de todos los games de todos los sets vs la línea over/under.
4. **Idempotencia + aislamiento**: solo procesa `sport='tennis'` pendientes; filtros `COALESCE(sport,'mlb')` protegen los otros deportes. Job diario en `index.js`, gated por `TENNIS_ANALYSIS_ENABLED`. Cadencia: pollear durante ventanas de torneo activo (hay tennis casi todo el año, pero no 24/7 — el job revisa si hay partidos `in` antes de pollear summaries).
5. **Crédito devuelto en void**: reusar el path de refund existente (el mismo que usan otros voids/cancelaciones). Documentar en `docs/data-schema.md` el valor `result='void'` para tennis.

> **Por qué void y no half-win/half-loss**: replicar la regla exacta de cada casa (algunas liquidan ML si terminó el set 1, otras anulan todo) añade complejidad y ambigüedad para el usuario. `void` + refund es inequívoco, conservador, y consistente con "no acción". Si más adelante se quiere granularidad por book, se añade como configuración — no es MVP.

---

## 5. Oracle Tennis — diseño del prompt

`oracle-tennis-prompts.js` (nuevo, no toca `oracle.js`). Modelo: `claude-opus-4-8` premium / `claude-sonnet-4-6` deep / `claude-haiku-4-5` chat. **Sin Grok** (igual que NBA/NFL/NHL/Soccer).

### Cap de confianza
**≈72%** — el mercado ATP/WTA top-10 es muy eficiente; el edge real vive en torneos menores, qualies, primeras rondas y matchups con fuerte sesgo de superficie que el ranking oficial no captura. El Oracle debe ser explícitamente humilde con favoritos top y buscar valor en el read de superficie/fatiga.

### Prioridad de métricas (orden en el prompt)
1. **ELO por superficie** — el predictor dominante. Un jugador #15 especialista en arcilla puede ser favorito real sobre un #8 que sufre en tierra batida, aunque el ranking diga lo contrario.
2. **H2H por superficie** — algunos matchups son "kryptonita" estilística (un gran sacador vs un gran restador en superficie lenta/rápida).
3. **Forma reciente** — racha en la superficie actual, confianza, resultados recientes vs top-50.
4. **Fatiga / física** — rounds jugados, 5-setters recientes, días de descanso, body clock (sesión de noche → día siguiente temprano).
5. **Ranking oficial** — contexto, pero subordinado al ELO-surface.
6. **Situacional** — best-of-5 (favorece al físicamente superior y al de mejor fondo), condiciones (indoor/outdoor, altura, bolas), mano (zurdo vs ciertos reveses).

### Reglas duras
- **Guardrail anti-retiro**: el prompt prohíbe asumir que el partido se completa. Si hay señal de lesión reciente en el contexto, el Oracle debe **degradar confianza o PASS**, y nunca recomendar como si el riesgo de retiro no existiera. (El resolver maneja el void, pero el Oracle no debe ignorar el riesgo en su lectura.)
- **Mercado primario**: match winner. Set handicap solo con favorito claro y forma dominante; total games cuando el estilo de ambos (sacadores → más games/tiebreaks; restadores en superficie lenta → menos) lo sustente.
- **Player props / games por set**: deshabilitados en fase 1 (guardrail server-side, igual que NBA/NFL props).
- **Guardrail anti-hallucination**: prohíbe simular tool calls / web search / inventar rankings, ELO o H2H. Solo razona sobre el contexto provisto. Si falta el ELO-surface → lo dice y baja confianza.
- **Anti-bias**: no default al mejor ranking ni al favorito de mercado; el pick debe salir del read de superficie/H2H/forma.

### Output
JSON schema espejo de Soccer/NHL (`TENNIS_OUTPUT_SCHEMA_VERSION`): `pick`, `pick_side` (`player_a`|`player_b`), `bet_type` (`moneyline`|`set_handicap`|`total_games`), `confidence` (50–72), `oracle_report`, `key_factors[]`, `risk_flags[]`. `tennisOutputGuard` rechaza ABSTAIN/empate/props/parse fallido.

---

## 6. Parlay Architect Tennis

El motor (`parlayEngine/*`) es deporte-agnóstico → se reusa. Lo que cambia es la matriz de correlación y el manejo del riesgo de retiro.

- **Correlaciones**: los partidos de tennis distintos son **mayormente independientes** (no hay game-script compartido como en NFL SGP). La correlación relevante es negativa y obvia: no combinar ambos lados de un mismo partido.
- **Riesgo de retiro en parlays**: una pata que termina en `void` por retiro **colapsa el parlay a las patas restantes** (re-cálculo de cuota), no lo pierde. El `parlayResolver` debe tratar el void como "pata removida", no como pérdida. Verificar que la lógica existente de void haga esto (probablemente requiera un ajuste menor, no frozen).
- **hitMath.js** (Poisson-binomial) es agnóstico → se reusa tal cual.
- **Modos** (`safe`/.../`dreamer`) se reusan; `safe` (Máx. Acierto) — combinar favoritos ELO-surface dominantes en primeras rondas es un parlay natural de alta probabilidad.
- **Fase posterior**: el parlay Tennis no es MVP del Sprint 12 (igual que en NHL/Soccer iniciales). Se habilita tras validar el lifecycle básico.

---

## 7. Pick Imperdible Tennis (fase posterior)

El "lock del día" tiene sentido en Grand Slams. Reusa la convicción invertida del MLB (acuerdo modelo↔mercado↔sidecar, penaliza varianza). Adaptaciones:
- **Gate de disponibilidad**: sin "lineup", el análogo es **sin señal de lesión/duda física** en el jugador favorito. Un jugador con retiro reciente o lesión reportada no es elegible como imperdible.
- **Gate de superficie**: el imperdible vive donde el ELO-surface y el H2H coinciden fuertemente con el mercado (favorito dominante en su superficie vs rival débil en ella).
- **Cadencia**: 1 lock/día durante torneos grandes (o PASS).
- Diferido — no MVP. Requiere `auto_resolvable` + el resolver de void integrado primero.

---

## 8. Dataset + ML sidecar Tennis

- **Aislamiento**: `sport='tennis'`, `league IN ('atp','wta')` en `pick_features`/`shadow_model_runs`; el sidecar Python filtra por sport (igual que los demás). APIs admin admiten `?sport=tennis`.
- **Ventaja Sackmann (tipo nflverse)**: el sidecar puede **pre-entrenarse con histórico real** (ELO-surface diff + H2H + ranking → P(win) contra resultados de décadas) en vez de esperar ~500 picks resueltos. Es el camino recomendado (Sprint 12e). Modelos: `tennis_moneyline` primero; `tennis_set_handicap` y `tennis_total_games` después (cobertura de líneas más irregular).
- **Modelos Python**: `ml/hexa_ml/models/tennis.py` con `TennisMoneylineModel` (XGBoost, L2 fuerte para empezar). `features.py` TENNIS_BASE_NUMERIC (elo-surface diff, elo-overall diff, rank diff, h2h-surface diff, form diff, fatiga diff, best_of, surface one-hot) + `add_tennis_derived()` (de-vig 2-way odds). `data.py` columnas tennis + `filter_for_market` + `make_target` (moneyline/set_handicap/total_games). `serve.py` predict routes tennis. `train.py` TENNIS_MARKETS + `load_dataset(sport="tennis")`.
- **Cliente Node**: `server/services/tennisMlClient.js` con circuit breaker propio (patrón `soccerMlClient.js`).

---

## 9. Calendario / estacionalidad

- **Año redondo** — la razón estratégica de Tennis. Temporada ATP/WTA: enero (United Cup, **Australian Open**) → febrero-abril (gira dura + arcilla sudamericana) → abril-junio (gira de arcilla europea, **Roland Garros**) → junio-julio (gira de hierba, **Wimbledon**) → julio-septiembre (gira dura norteamericana, **US Open**) → septiembre-noviembre (gira asiática + indoor europeo, **ATP Finals**). Diciembre: descanso/exhibiciones.
- **Complemento perfecto**: rellena **todos los huecos** del calendario que MLB (abr–oct) + NBA (oct–abr) + NFL (sep–feb) + NHL (oct–abr) + Soccer (ago–may por liga) no cubren — sobre todo enero (Australian Open) y los meses de transición.
- **Hito de validación**: un Grand Slam (Australian Open en enero o Roland Garros en mayo) — máximo volumen de partidos/día y la mejor prueba del read de superficie + del resolver de retiros (los Bo5 tienen más retiros).

---

## 10. Matriz de release gate Tennis (objetivo)

Misma rúbrica que [CLAUDE.md](../CLAUDE.md). Umbral de release ≥ 8.0 por criterio crítico.

| Criterio | Tennis (objetivo MVP) | Gate min | Cómo se logra |
|---|---:|---:|---|
| Data depth pregame | 8.5 | 8.0 | ELO-surface + H2H + forma + fatiga (Sackmann + ESPN). |
| Data quality live | 7.5 | 8.0 | ESPN summary por set; sin feed profundo (riesgo aceptado, igual que otros). |
| Disponibilidad (lesión/retiro) | 8.0 | 8.0 | Señal de lesión en contexto + guardrail anti-retiro + resolver de void. |
| Market coverage por data | 8.0 | 8.0 | Odds API h2h sólido; set handicap/total degradados cuando faltan. |
| Guardrails LLM | 8.5 | 8.0 | `tennisOutputGuard` (2-vías estricto) + anti-hallucination + cap 72%. |
| Pick lifecycle | 8.5 | 8.0 | **resolver propio con void/walkover** + tracker por set. |
| Calibration/ROI | 8.0 | 8.0 | sidecar pre-entrenado con histórico Sackmann. |
| Isolation por deporte | 8.5 | 8.5 | `sport='tennis'`, `league=tour`, archivos nuevos, cero edición frozen. |

### Criterios "go public" Tennis
- SAFE PICK Tennis aislado de endpoints de otros deportes con política propia (o bloqueado, como en NHL/Soccer).
- Player Props / games-por-set desactivados hasta resolver dedicado + dataset.
- Historial, fotos de jugador, resolver, jobs, dataset admin y shadow runs aislados por `sport` + `league`.
- Contexto Tennis con ELO-surface + H2H + forma + fatiga + odds server-side + `context_meta`.
- **Resolver de retiro/walkover validado** con un partido real (un Grand Slam Bo5 es la mejor prueba).
- Selector por **tour ATP/WTA** + fecha funcional.
