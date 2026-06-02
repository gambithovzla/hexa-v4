# Sport Registry y escalabilidad multi-deporte

Documento operativo para escalar H.E.X.A. desde MLB/NBA hacia NFL, Soccer, NHL y Tennis sin mezclar datos ni flujos.

## Objetivo

Mantener una sola app con separacion estricta por `sport`:
- estado global `currentSport` en frontend,
- contract `sport` en endpoints,
- aislamiento en tablas/queries de analytics y training.

## Registro de deportes (fuente de verdad)

Frontend: [client/src/config/sports.js](../client/src/config/sports.js)  
Backend: [server/sports.js](../server/sports.js)

Deportes conocidos:
- `mlb`
- `nba`
- `nfl`
- `soccer`
- `nhl`
- `tennis`

Deportes activos hoy en UI:
- `mlb`
- `nba`

## Matriz de capacidades por modulo

Archivo: [client/src/config/sportCapabilities.js](../client/src/config/sportCapabilities.js)

Cada modulo declara por deporte:
- `enabled`
- `requiresAdmin`
- `message` (copy de bloqueo `Coming Soon`)

Ejemplos actuales:
- `board`: MLB enabled, NBA locked
- `history`: MLB+NBA enabled
- `oracleChat`: MLB enabled, NBA locked
- `parlayArchitect`: MLB enabled, NBA locked

## Reglas anti-mezcla

1. Ninguna vista deportiva debe leer datos sin `sport`.
2. En backend, usar filtros `COALESCE(sport,'mlb')` para retrocompatibilidad.
3. Evitar `all` en UX usuario final; reservar para admin/analitica.
4. Modulos no soportados no deben fallar: siempre `Coming Soon` explicito.

## Checklist para agregar un deporte nuevo

1) **Registro**
- Agregar clave en `client/src/config/sports.js` y `server/sports.js`.
- Definir si entra a `ACTIVE_SPORTS`.

2) **Capacidades**
- Añadir reglas en `client/src/config/sportCapabilities.js` por modulo.
- Definir mensajes de bloqueo en `es/en`.

3) **Data/API**
- Confirmar endpoints de juegos, contexto y odds para el deporte.
- Agregar/ajustar filtros `sport` en rutas de historial/performance/admin.

4) **UI**
- Validar `SportSwitcher` y estado global (`SportContext`).
- Revisar vistas clave: board, game, history, live, chat, parlay.

5) **Observabilidad**
- Asegurar que `pick_features` y `shadow_model_runs` persistan `sport`.
- Verificar dashboards admin por deporte (`feature-store`, `shadow-model`).

6) **Calidad**
- Pruebas de no mezcla (filtros y capability gates).
- Smoke del flujo create -> resolve -> history para el nuevo deporte.

## Estado actual (2026-05-26)

- Base multi-deporte implementada con Sport Shell global.
- Historial y performance filtrables por deporte.
- Módulos no soportados usan bloqueo consistente (`Coming Soon`).
- MLB y NBA aislados en dataset/shadow/training default MLB-first.
- **NFL** registrado como deporte conocido (`SPORT_META.nfl.active=false`), 📋 en planning. Spec en [nfl-architecture.md](nfl-architecture.md), roadmap en [nfl-roadmap.md](nfl-roadmap.md).
- **Tennis** registrado como deporte conocido (`SPORT_META.tennis.active=false`), 📋 en planning (Sprint 12). Primer deporte **individual**: jugador A vs B mapeado a slots home/away; tours `atp`/`wta` reusan la dimensión `league`. Spec en [tennis-architecture.md](tennis-architecture.md), roadmap en [tennis-roadmap.md](tennis-roadmap.md).
