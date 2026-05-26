# Arquitectura NFL — H.E.X.A. v4

Documento maestro del tercer deporte de la plataforma. **Espeja exactamente** el patrón con que se construyó NBA (que a su vez espejó MLB): archivos nuevos aislados que importan/orquestan los frozen, discriminador `sport='nfl'` en todas las tablas, y cero ediciones a los paths frozen del Oracle MLB.

> Antes de tocar nada lee también: [sport-registry.md](sport-registry.md) (checklist multi-deporte), [architecture.md](architecture.md) (arquitectura global), y la sección NBA de [CLAUDE.md](../CLAUDE.md) (el patrón que copiamos).

---

## 0. TL;DR

- **Datos**: ESPN hidden API (gratis, sin key — igual que NBA) para juegos / scores / drives / plays / injuries / rosters; **The Odds API** `americanfootball_nfl` (ya integrada, dual key) para líneas; **nflverse / nfl_data_py** para stats avanzadas (EPA, success rate, PROE) — el análogo a Statcast/Savant.
- **Live mapping (análogo a GUMBO)**: ESPN core API `drives` + `plays` + `summary?event` con `winprobability`. No hay un feed oficial profundo como GUMBO de MLB, pero drives→plays cubre down/distance/clock/scoring play-by-play.
- **Cadencia**: NFL es **semanal**, no diario. Esto es el cambio estructural más grande vs MLB/NBA. El selector de juego trabaja por **semana NFL** (`seasontype` + `week`), no por fecha única. Los background jobs se vuelven game-time-aware.
- **Mercados**: spread es el mercado primario (NFL es spread-driven), luego total, luego moneyline, luego player props. **Key numbers 3 y 7** son ley.
- **Variabilidad**: NFL tiene la varianza por-juego más alta y el mercado **más eficiente** de los tres deportes. El cap de confianza del Oracle es el más bajo (≈72%) y el edge es el más difícil de encontrar.
- **Aislamiento**: archivos `nfl-*` nuevos, `sport='nfl'` en `picks`/`pick_features`/`shadow_model_runs`, feature flag `NFL_ANALYSIS_ENABLED`. Cero ediciones a frozen.

---

## 1. Fuentes de datos (deep research)

### 1.1 ESPN hidden API (primaria — gratis, sin key)

Mismo proveedor que el fallback NBA. Endpoints reverse-engineered, sin auth, sin SLA. Riesgo aceptado: ESPN puede cambiar/quitar endpoints sin aviso → mismo patrón de cache + fallback stale que NBA.

| Necesidad | Endpoint | Notas |
|---|---|---|
| Juegos de la semana | `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYY&seasontype={1\|2\|3}&week={N}` | **Por semana**, no por fecha. `seasontype`: 1=pre, 2=regular, 3=post. `week` 1–18 (regular). También acepta `?dates=YYYYMMDD` para un día puntual. |
| Stats de equipo (temporada) | `sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{YEAR}/types/2/teams/{TEAM_ID}/statistics` | Offensive/defensive splits. |
| Standings | `sports.core.api.espn.com/v2/.../seasons/{YEAR}/types/2/groups/{8\|7}/standings` | AFC=8, NFC=7. |
| Record de equipo | `.../teams/{TEAM_ID}/record` | W-L-T, home/away, div. |
| Game summary | `site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={EVENT_ID}` | Boxscore, leaders, **winprobability**, drives. La pieza más rica para live + resolución. |
| Play-by-play (live) | `sports.core.api.espn.com/v2/.../events/{ID}/competitions/{ID}/plays?limit=400` | down/distance/yardLine/clock/scoringPlay. |
| Drives (live) | `sports.core.api.espn.com/v2/.../events/{ID}/competitions/{ID}/drives` | Drives con start/end/result. |
| Injuries | `sports.core.api.espn.com/v2/.../teams/{TEAM_ID}/injuries?limit=100` | Designaciones Out/Doubtful/Questionable/IR/PUP. **Crítico en NFL.** |
| Roster / depth chart | `site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{TEAM_ID}/roster` y `.../seasons/{YEAR}/teams/{TEAM_ID}/depthcharts` | Para saber QB titular y profundidad. |
| Inactives (game roster) | `sports.core.api.espn.com/v2/.../events/{ID}/competitions/{ID}/competitors/{TEAM_ID}/roster` | Lista de inactivos ~90 min pre-juego (análogo NFL del "lineup confirmado" MLB). |

IDs de equipo ESPN: 1–34 (incluye huecos históricos). Se mapean a abreviaturas vía `nfl-team-map.js` (nuevo), igual que `nba-team-map.js`.

### 1.2 The Odds API `americanfootball_nfl` (líneas — ya integrada)

Reusa el patrón `nba-odds.js` (dual key fallback, aislado del frozen `odds-api.js`).

- Featured (endpoint `/v4/sports/americanfootball_nfl/odds`): `h2h` (moneyline), `spreads`, `totals`.
- Player props (endpoint `/v4/sports/{eventId}/odds`): `player_pass_yds`, `player_pass_tds`, `player_pass_completions`, `player_pass_attempts`, `player_pass_interceptions`, `player_rush_yds`, `player_rush_attempts`, `player_receptions`, `player_reception_yds`, `player_anytime_td`, etc.
- **Key numbers**: el spread NFL se concentra en **3** y **7**. `buildMarketOddsForGame` debe preservar el half-point y el juice por key number (no redondear).

### 1.3 nflverse / nfl_data_py (stats avanzadas — análogo Statcast/Savant)

El análogo NFL de Baseball Savant. Datos derivados de play-by-play, **post-game** (se publican al día siguiente), por eso son **features pregame contextuales**, no live.

- Fuente: releases de GitHub `nflverse/nflverse-data` (CSV/parquet) + Next Gen Stats scrapeados a `nflverse/ngs-data`.
- Acceso desde Node: fetch directo de los parquet/CSV de releases, o desde el sidecar Python con `nfl_data_py` (más natural). Recomendado: un `nfl-advanced-fetcher.js` (análogo `savant-fetcher.js`) con cache 24h que baja el CSV semanal, **o** delegar al sidecar Python en la fase ML.
- Métricas clave que alimentan el contexto y el dataset:
  - **EPA/play** ofensivo y defensivo (la métrica de equipo más predictiva).
  - **Success rate** (off/def).
  - **PROE** (pass rate over expected) — identidad de pase.
  - **Explosive play rate**, **red zone TD%**, **third-down conversion%**.
  - **Pressure rate / sack rate** (trincheras: pass rush vs pass protection).
  - **Pace**: segundos/jugada y plays/game (afecta totales).
  - **QB tier / EPA por dropback**, snap counts.

> **Ventaja única NFL**: nflverse tiene play-by-play histórico de >20 temporadas. A diferencia de NBA (que esperó ~500 picks para entrenar), el sidecar NFL puede **pre-entrenarse con datos históricos reales** (backtest de spreads/totales/ML contra resultados) en lugar de esperar a acumular picks resueltos. Ver Sprint 9e.

### 1.4 Weather (Open-Meteo — ya integrado)

Reusa `weather-api.js`. NFL necesita coordenadas de estadio + flag `dome`. Señales que importan:
- **Viento > 15 mph** → mata pase y field goals largos → baja el total.
- **Frío extremo / nieve / lluvia** → juego de carrera, baja total.
- Domos / techo cerrado → weather neutral (ignorar).

Tabla estática `nfl_stadiums` (coords + dome) o constante en `nfl-team-map.js`.

---

## 2. Mapa de archivos (espejo NBA → NFL)

Patrón de aislamiento: **crear archivos nuevos que importen los frozen, nunca editarlos.** Igual que `oracleNba.js` instancia su propio Anthropic SDK en vez de tocar `oracle.js`.

### Backend nuevo

| Archivo NFL (nuevo) | Espeja a (NBA) | Rol |
|---|---|---|
| `server/nfl-api.js` | `nba-api.js` | Wrapper ESPN NFL. Exports: `getNflGamesForWeek({season,seasonType,week})`, `getNflGamesForDate(date)`, `getNflTeamStats`, `getNflStandings`, `getNflTeamRecentGames`, `getNflLeagueInjuries`, `findTeamInjuries`, `getNflGameSummary(eventId)`. Cache: juegos 5min (30s live), stats 6h, injuries 15min. |
| `server/nfl-odds.js` | `nba-odds.js` | The Odds API `americanfootball_nfl`, dual key. `getNflGameOdds`, `matchNflOddsToGame`, `buildMarketOddsForGame`. Preserva key numbers 3/7. |
| `server/nfl-team-map.js` | `nba-team-map.js` | ESPN team_id ↔ abreviatura ↔ nombre + coords estadio + flag dome. `resolveNflTeamId`, `enrichGameTeamIds`. |
| `server/nfl-context-builder.js` | `nba-context-builder.js` | Arma contexto por partido: EPA off/def, success rate, PROE, pace, red-zone, third-down, pressure, **QB status**, rest/short-week/off-bye, weather, injuries, line. Emite `context_meta` (sources, completeness, staleFlags). |
| `server/nfl-advanced-fetcher.js` | `savant-fetcher.js` | (Opcional fase 9b+) baja stats nflverse semanales, cache 24h. |
| `server/prompts/oracle-nfl-prompts.js` | `oracle-nba-prompts.js` | `NFL_SYSTEM_PROMPT` + `NFL_CHAT_PROMPT`. Guardrail anti-hallucination. Cap confianza ≈72%. Respeta key numbers. |
| `server/services/oracleNfl.js` | `oracleNba.js` | Motor LLM NFL (Anthropic only, sin Grok). `analyzeNflGame`, `analyzeNflChat`. Cliente Anthropic propio. |
| `server/services/nflOutputGuard.js` | `nbaOutputGuard.js` | Valida output antes de persistir: pick no vacío, confianza en rango, no props (en fase 1), no ABSTAIN, rechaza parse fallido. |
| `server/services/nflShadowValidator.js` | `nbaShadowValidator.js` | Validador determinístico (scoring por pesos): EPA diff, QB tier, rest, injuries, weather, home field. |
| `server/services/nflShadowPersistence.js` | `nbaShadowPersistence.js` | Persiste `pick_features` + `shadow_model_runs` con `sport='nfl'`. Fire-and-forget. |
| `server/pick-resolver-nfl.js` | `pick-resolver-nba.js` | Resuelve picks NFL pendientes. **Reusa** `resolvePickFromFinalState` + `tokenMatchesTeam` del frozen `pick-resolver.js`. Maneja push (spreads/totales en número entero — frecuentes en NFL). |
| `server/pick-tracker-nfl.js` | `pick-tracker-nba.js` | Progreso en vivo. Reusa `parseLivePick` + `calculatePickProgress` del frozen `pick-tracker.js`. Usa drives/plays + winprobability. |
| `server/services/hexaNflBoardService.js` | `hexaNbaBoardService.js` | Pizarra semanal NFL. |
| `server/routes/nfl.js` | `routes/nba.js` | Endpoints (ver §3). Feature-flagged `NFL_ANALYSIS_ENABLED`, admin-only durante MVP. |

### Frontend nuevo / modificado

| Archivo | Cambio |
|---|---|
| `client/src/config/sports.js` | `nfl.active = true`; agregar `'nfl'` a `ACTIVE_SPORTS` (al flip público). |
| `server/sports.js` | agregar `'nfl'` a `ACTIVE_SPORTS` (al flip público). |
| `client/src/config/sportCapabilities.js` | reglas NFL por módulo (board/history/oracleChat/parlay) con copy `Coming Soon` es/en. |
| `client/src/components/SportSwitcher.jsx` | agregar pill NFL (color/livery propio, p.ej. `--sport-accent` verde campo). |
| `client/src/components/GameSelector.jsx` | `normalizeNflGame(raw)` + fetch `/api/nfl/games`. **Selector por semana** (no fecha). Oculta sección pitchers; muestra QB titular + spread destacado. |
| `client/src/components/AnalysisPanel.jsx` | cuando `sport='nfl'` → `/api/nfl/analyze/game`. Oculta engine picker (no Grok), webSearch, lineup MLB. |
| `client/src/components/NflContextMetaBadge.jsx` | freshness/completeness (nuevo). |
| `client/src/components/NflLiveTracker.jsx` | tracker live drives/plays (nuevo). |
| `client/src/components/NflStandingsPanel.jsx` | standings por conferencia/división (nuevo). |
| `client/src/utils/nflLogoUrl.js` | logos CDN por abbr (nuevo). |
| `client/src/hooks/useHistory.js` | ya soporta `?sport=` — agregar `'nfl'` a los filtros. |
| `client/src/components/HistoryPanel.jsx` | `MatchupWithLogos` soporta logos NFL. |

### DB (migraciones idempotentes en `server/migrate.js`)

`runNflScaffoldingMigrations()` (espeja `runNbaScaffoldingMigrations`):
- `picks.sport` y `pick_features.sport` ya existen (`DEFAULT 'mlb'`) — reusados.
- Tabla `nfl_games` (cache): `game_id`, `season`, `season_type`, `week`, `game_date`, `home/away_team_id/abbr/name`, `status`, `home/away_score`, `stadium`, `dome BOOLEAN`, `national_tv`, timestamps. Index por `(season, season_type, week)`.
- Tabla `nfl_team_stats` (temporada): PK `(team_id, season)`, `wins/losses/ties`, `epa_off`, `epa_def`, `success_rate_off/def`, `proe`, `pace_sec_play`, `plays_per_game`, `redzone_td_pct`, `third_down_pct`, `pressure_rate`, `updated_at`.

`runNflDatasetMigrations()` (espeja `runNbaDatasetMigrations`): columnas NULL en `pick_features` (filas MLB/NBA quedan NULL):
- `home/away_epa_off`, `home/away_epa_def`, `home/away_success_rate`, `home/away_proe`, `home/away_pace`, `home/away_rest_days`, `home/away_is_short_week BOOLEAN`, `home/away_is_off_bye BOOLEAN`, `qb_home_tier`, `qb_away_tier`, `qb_home_active BOOLEAN`, `qb_away_active BOOLEAN`, `wind_mph`, `is_dome BOOLEAN`, `spread_close`, `total_close`, `injuries_home_severe`, `injuries_away_severe`.
- `shadow_model_runs.sport` ya existe — reusado.

---

## 3. Rutas

Todas feature-flagged `NFL_ANALYSIS_ENABLED=true` (503 si no), admin-only durante MVP (igual que NBA).

| Método + path | Espeja | Notas |
|---|---|---|
| `POST /api/nfl/analyze/game` | `/api/nba/analyze/game` | `{ gameId, season?, week?, lang?, riskProfile?, marketOdds?, bankroll? }`. Flujo: fetch game → resolver odds server-side → build context → `analyzeNflGame` → `nflOutputGuard` → persist (`sport='nfl'`) → shadow/features fire-and-forget. |
| `POST /api/nfl/analyze/chat` | `/api/nba/analyze/chat` | Oracle Chat NFL. `X-Hexa-Skip-Pick-Extract: 1` opt-out. |
| `GET /api/nfl/games?season=&seasonType=&week=` | `/api/nba/games?date=` | **Por semana**. Sin `week` → semana actual calculada. También `?date=YYYYMMDD`. |
| `GET /api/nfl/teams?season=` | `/api/nba/teams` | Stats de equipo. |
| `GET /api/nfl/standings?season=` | `/api/nba/standings` | Por conferencia/división. |
| `GET /api/nfl/board?season=&week=&force=` | `/api/nba/board` | Pizarra semanal. |
| (Historial) `GET /api/picks?sport=nfl` | — | Ya soportado server-side. |

---

## 4. Mapeo del live (análogo a GUMBO de MLB)

MLB usa GUMBO (`live-feed.js`) para play-by-play profundo. NFL no tiene un feed oficial equivalente, así que **componemos** el live desde ESPN:

1. **Fuente**: `summary?event={ID}` (incluye `drives` + `winprobability` + boxscore parcial) + `plays?limit=400` (granular). `summary` es suficiente para el tracker; `plays` para detalle.
2. **Estado de juego**: cuarto, reloj, posesión, down & distance, yardLine, último scoring play, score actual.
3. **Progreso del pick** (`pick-tracker-nfl.js`, reusa `calculatePickProgress`):
   - **Moneyline**: usa `winprobability` de ESPN (lead + tiempo restante). Estado WIN_TRACK / LOSE_TRACK.
   - **Spread**: margen actual del equipo vs línea. Ej. `KC -3.5` con KC arriba por 6 → cubriendo. Mostrar "margen 6, necesita 4+".
   - **Total**: puntos combinados vs línea, contextualizado con tiempo restante (cuartos jugados). Ritmo de anotación proyectado.
4. **Cadencia de polling**: NFL juega en ventanas concentradas. Poll cada ~60–90s **solo** en ventanas de juego:
   - Thu ~20:15 ET (TNF), Sun 13:00 / 16:05 / 16:25 / 20:20 ET, Mon 20:15 ET (MNF), + Sat tardíos fin de temporada + juegos internacionales (Sun 09:30 ET).
   - Fuera de ventana, no pollear (a diferencia de MLB diario). El job revisa el calendario semanal antes de pollear.
5. **Resolución** (`pick-resolver-nfl.js`): cuando `summary.status` = final, extrae score final → `resolvePickFromFinalState`. Maneja **push** explícito (spread/total en entero) — más común en NFL que en MLB/NBA.

---

## 5. Oracle NFL — diseño del prompt

`oracle-nfl-prompts.js` (nuevo, no toca `oracle.js`). Modelo: `claude-opus-4-7` premium / `claude-sonnet-4-6` deep / `claude-haiku-4-5` para chat ligero. **Sin Grok** (igual que NBA).

### Cap de confianza
**≈72%** — el más bajo de los tres deportes. Justificación que va en el prompt: NFL es 1 juego/semana (muestra mínima), alta varianza por turnovers/lesiones/refs, y el mercado NFL es **el más eficiente** de los deportes US. El Oracle debe ser explícitamente humilde: el edge real es escaso y la mayoría de spreads son justos.

### Prioridad de métricas (orden en el prompt)
1. **QB status & tier** — la variable más predictiva. Un QB titular fuera (backup) mueve la línea 4–7 pts. Si hay duda sobre el QB → degradar confianza fuerte o PASS.
2. **EPA/play diff** = (EPA off propio) − (EPA def rival). La métrica de equipo más predictiva.
3. **Success rate + explosive play rate** (consistencia vs upside).
4. **Trincheras**: pressure rate / sack rate (pass rush vs pass protection).
5. **Rest / travel**: off-bye (+ventaja), short week (TNF, −), viaje costa-a-costa / body clock (juegos 13:00 ET para equipos del oeste).
6. **Weather**: viento >15mph y frío extremo → bajan total y fiabilidad del pase.
7. **Situacional**: divisional (más cerrados, "any given Sunday"), home field, primetime, must-win/tanking late season.
8. **Pace / plays-per-game** → para totales.

### Reglas duras
- **Key numbers 3 y 7**: nunca recomendar cruzar de `-2.5` a `-3.5` sin justificar; preferir el lado correcto del 3/7. Documentar el margen al key number.
- **Mercado primario**: spread. ML solo en favoritos claros o dogs con valor; total cuando weather/pace lo sustenten.
- **Player props NFL**: deshabilitados en fase 1 (guardrail server-side, igual que NBA props), hasta tener resolver dedicado + dataset.
- **Guardrail anti-hallucination**: prohíbe explícitamente simular tool calls / web search / inventar inactivos o stats. Solo razona sobre el contexto provisto. Si falta el QB confirmado → lo dice y baja confianza.

### Output
JSON schema espejo del NBA (`NFL_OUTPUT_SCHEMA_VERSION`): `pick`, `bet_type` (spread|total|moneyline), `confidence` (50–72), `oracle_report`, `key_factors[]`, `risk_flags[]`. `nflOutputGuard` rechaza ABSTAIN/PASS-vacío, props, parse fallido.

---

## 6. Parlay Architect NFL

El motor (`parlayEngine/*`) es deporte-agnóstico → se reusa. Lo que cambia es la **matriz de correlación** y la cadencia.

- **Correlaciones NFL fuertes** (alimentan `correl.js` / `composer.js` con reglas NFL):
  - **Same-game positivas**: QB pass yds ↔ su WR1 receptions/yds ↔ team total over (un QB que lanza para 300 implica WR productivo + más puntos).
  - **Game script**: favorito grande → más carrera (RB rush att over, menos pass att); underdog → garbage time pass (QB/WR over, RB under).
  - **Stacking**: QB + WR del mismo equipo = correlación positiva (premiar en SGP). QB de un equipo + DEF rival = negativa (penalizar).
- **Same-Game Parlay (SGP)**: enorme en NFL. El composer debe soportar piernas correlacionadas dentro de un mismo juego con el ajuste de probabilidad conjunta correcto (no tratar como independientes).
- **Cadencia**: parlays por **semana**, menos juegos que el slate diario MLB/NBA. Pool más chico → seeds más selectivas.
- **hitMath.js** (Poisson-binomial) es agnóstico → se reusa tal cual para `hit_distribution` + warning honesto N≥6.
- **Modos** (`safe`/`conservative`/`balanced`/`aggressive`/`dreamer`) se reusan; `safe` (Máx. Acierto) optimiza por probabilidad conjunta — ideal para parlays de favoritos NFL eficientes.

---

## 7. Pick Imperdible NFL ("Lock of the Week")

NFL es el hogar natural del "lock of the week" — el público apuesta semanalmente. Reusa la lógica de convicción invertida del MLB (`imperdibleSelector.js` + `imperdibleArbiter.js`): premia el **acuerdo** modelo↔mercado↔sidecar, penaliza varianza de mercado, exige certeza de disponibilidad.

Adaptaciones NFL:
- **Análogo del "lineup confirmado"**: la lista de **inactivos** (publicada ~90 min pre-juego) + el **final injury report** del viernes. Gate duro: QB titular confirmado activo. Si el QB es Questionable sin resolver → no elegible como imperdible.
- **Gate de spread**: evitar favoritos enormes sin valor (−14+) y coinflips (±1). El imperdible vive en la zona de convicción con margen al key number.
- **Weather gate**: clima extremo (viento >20mph, nieve) → degradar o excluir.
- **Persistencia**: reusa `imperdible_runs` con `sport='nfl'` (agregar columna si no existe vía `COALESCE`). Un solo lock por semana (o PASS). Árbitro Opus audita finalistas.
- **Cadencia**: 1 análisis por semana (no por día). El selector corre sobre los juegos de la semana con inactivos publicados.

---

## 8. Dataset + ML sidecar NFL

- **Aislamiento**: `sport='nfl'` en `pick_features` / `shadow_model_runs`; el sidecar Python filtra por sport (igual que NBA). APIs admin admiten `?sport=nfl`.
- **Volumen**: ~16 juegos/semana × 18 semanas ≈ **272 juegos/temporada** + playoffs. Llegar a ~500 picks resueltos por mercado toma **más de una temporada**. Por eso fase 1 se apoya fuerte en LLM + validador determinístico.
- **Ventaja nflverse**: a diferencia de NBA, el sidecar NFL puede **pre-entrenarse con play-by-play histórico real** (>20 temporadas de spreads/totales/ML con resultados) vía `nfl_data_py`. Esto permite un modelo XGBoost útil **desde el día 1** sin esperar picks acumulados. Es el camino recomendado (Sprint 9e).
- **Mercados**: `spread`, `total`, `moneyline` primero; player props después (cuando exista resolver dedicado).

---

## 9. Calendario / estacionalidad

- **Regular season**: ~early Sept → early Jan (18 semanas, ~17 juegos/equipo + 1 bye). **Playoffs**: mediados enero → Super Bowl (≈ primera semana de feb).
- **Complemento perfecto**: MLB (abr–oct) + NBA (oct–abr) + NFL (sep–feb) = cobertura tentpole de fin de semana **todo el año**, con el evento de mayor audiencia (Super Bowl) cerrando el ciclo.
- `seasontype`: 1=preseason (ignorar para picks), 2=regular, 3=postseason.

---

## 10. Matriz de release gate NFL (objetivo)

Misma rúbrica que [CLAUDE.md](../CLAUDE.md). Umbral de release ≥ 8.0 por criterio crítico.

| Criterio | NFL (objetivo MVP) | Gate min | Cómo se logra |
|---|---:|---:|---|
| Data depth pregame | 8.5 | 8.0 | nflverse EPA/success/PROE + ESPN stats. |
| Data quality live | 8.0 | 8.0 | ESPN drives/plays + winprobability, polling game-time-aware. |
| Lineup/Injury verificación | 8.5 | 8.0 | ESPN injuries + inactivos pre-juego + QB confirmado. |
| Market coverage por data | 8.5 | 8.0 | Odds API spreads/totals/ML; key numbers preservados. |
| Guardrails LLM | 8.0 | 8.0 | `nflOutputGuard` + anti-hallucination + cap 72%. |
| Pick lifecycle | 8.0 | 8.0 | resolver/tracker reusan frozen; push handling. |
| Calibration/ROI | 7.5 | 8.0 | sidecar pre-entrenado con histórico nflverse. |
| Isolation por deporte | 8.5 | 8.5 | `sport='nfl'`, archivos nuevos, cero edición frozen. |

### Criterios "go public" NFL
- SAFE PICK NFL aislado de endpoints MLB/NBA con política propia.
- Player Props NFL desactivado hasta resolver dedicado + dataset.
- Historial, logos, resolver, jobs, dataset admin y shadow runs aislados por `sport`.
- Contexto NFL con injuries + QB confirmado + odds server-side + weather + `context_meta`.
- Selector **por semana** funcional; tracker live validado en una ventana de juego real.
