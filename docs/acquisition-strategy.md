# H.E.X.A. — Estrategia de adquisición: cómo construir algo que bet365/FanDuel quieran comprar

> Brainstorm estratégico (2026-06-11). Perspectiva: ingeniero senior + operador que ha visto due diligence de M&A en sports betting tech. Este documento es deliberadamente honesto — primero la verdad incómoda, después el plan.

---

## 1. La verdad incómoda: qué compran realmente los acquirers

bet365, FanDuel, DraftKings **no compran "apps de picks"**. Tienen miles de ingenieros y sus propios equipos de trading cuantitativo que fijan las líneas que nosotros intentamos batir. Lo que sí compran (con precedentes reales):

| Lo que compran | Precedente | Por qué |
|---|---|---|
| **Audiencia + contenido** | Better Collective compró Action Network por **$240M** (2021) | Adquisición de usuarios cuesta $300–500/depositante; comprar media es más barato |
| **Datos/tech de trading** | DraftKings ↔ SBTech ($3.3B merger), Fanatics compró PointsBet US | Stack tecnológico + licencias |
| **Affiliate/SEO con revenue** | Catena, Gambling.com compran sitios de picks constantemente ($5–50M) | Cash flow predecible, múltiplos 4–8x EBITDA |
| **Herramientas para apostadores** | OddsJam → adquirida por Gambling.com Group (**$80M + earnout**, 2024) | SaaS con ARR real y retención |
| **Talento/acquihire** | Decenas de casos pequeños ($1–10M) | Equipo que demostró ejecutar |

**Conclusión #1**: el comprador de HEXA no compra "un LLM que hace picks". Compra **una de estas cuatro cosas**: (a) un track record de edge verificable, (b) un dataset propietario que mejora con el uso, (c) una audiencia/ARR con métricas de retención, o (d) un equipo probado. El plan debe maximizar las cuatro a la vez, porque no sabemos cuál valorará el comprador específico.

---

## 2. El activo #1: un track record verificable e inauditable

En esta industria, **la confianza es el producto**. Mil servicios de picks afirman ganar; ninguno lo puede probar. El que lo pruebe criptográficamente vale órdenes de magnitud más.

HEXA ya tiene la infraestructura que el 99% de los picks services no tiene:
- `closing-line-capture.js` + CLV por pick (la métrica que los traders profesionales respetan — ganar al cierre es la única prueba estadística de edge real, independiente de la varianza de resultados)
- Resolución automática post-game (sin "borrar los picks perdedores", el pecado capital del sector)
- `pick_features` + postmortems = trazabilidad completa de cada decisión

**Lo que falta para que sea un activo vendible:**

1. **Timestamps inmutables**: hash-chain de cada pick al momento de creación (pick + línea + odds + timestamp → SHA-256 encadenado, ancla diaria publicada en X o en un tercero). Costo: ~2 días de ingeniería. Valor: convierte "confía en mí" en "verifícalo tú mismo".
2. **Dashboard público de CLV** (no solo W/L): CLV promedio por deporte/mercado, distribución completa, n de picks. `public-stats.js` ya existe — extenderlo.
3. **Auditoría de terceros**: integración con un tracker independiente (estilo Pikkit/BetStamp) o un auditor que firme el track record trimestralmente.
4. **Volumen**: 583 filas de `pick_features` no es un track record, es una anécdota. Se necesitan **3,000–5,000 picks resueltos con CLV capturado** para que un equipo cuantitativo de un acquirer no lo descarte en la primera reunión. Con 5 deportes activos, eso es alcanzable en 12–18 meses si se industrializa la generación diaria (batch de slate completo, no solo análisis on-demand).

**Bifurcación honesta**: si tras 3,000 picks el CLV es positivo y sostenido → el activo vale millones por sí solo (camino C, abajo). Si es negativo → el negocio es media/entertainment, no edge, y el plan pivota a audiencia (camino A). **Construir la verificabilidad ahora es lo que permite saber cuál de los dos negocios tenemos.** No hay escenario donde no convenga.

---

## 3. Inventario honesto: qué tiene HEXA hoy

### Vale de verdad
- **El pipeline de lifecycle completo** (create → track → resolve → postmortem → lessons → calibración): esto es lo difícil de construir y lo que casi nadie tiene. El feedback loop postmortem→Oracle (Sprint 8g) es genuinamente diferenciado.
- **Context engineering multi-deporte**: 5 deportes con profundidad real (Statcast/Savant, nflverse EPA, xG Understat, de-vig, line movement v2 con steam/RLM detection). El "context builder" es el verdadero IP — el LLM es commodity, el contexto no.
- **El dataset `pick_features` + `shadow_model_runs`**: crece con cada pick, alimenta modelos propios, y es 100% propietario. Es el único activo con flywheel.
- **Arquitectura de aislamiento por deporte** demostrada 4 veces (NBA→NFL→NHL→Soccer sin tocar frozen): evidencia de que el equipo sabe escalar — esto importa en un acquihire.
- **Disciplina anti-hype**: hit distribution honesta en parlays, gates de PASS en Imperdible, output guards. Es cultura de producto que un comprador regulado valora.

### No vale lo que parece
- **"Tenemos un LLM que analiza juegos"**: no es moat. Cualquier equipo replica el prompt en semanas. El moat es el contexto + el dataset + el track record, no el modelo.
- **El validador "XGBoost" legacy** (pesos hardcodeados): un quant de FanDuel lo desmonta en la primera llamada técnica. Está bien como señal interna, pero no venderlo como ML.
- **Modelos con Brier ~0.234 en NFL moneyline**: el baseline de mercado (de-vig de closing lines) ronda 0.21–0.22. Estar *peor que el mercado* es lo esperado al inicio, pero hay que medirlo y decirlo así — la métrica vendible es **Brier vs. baseline de mercado**, no Brier absoluto.

### Pasivos que matan el deal en due diligence (arreglar ANTES de hablar con nadie)
1. **Data licensing** 🔴 el más grave: ESPN hidden APIs, scraping de Understat, FBref, Baseball Savant leaderboards, football-data.co.uk — casi todo el data layer viola ToS de alguien. Un acquirer regulado (FanDuel reporta a reguladores estatales) no puede tocar un asset construido sobre datos sin licencia. **Mitigación**: abstraer cada fetcher detrás de una interfaz (ya casi lo están) y tener cotizado/piloteado el swap a fuentes licenciadas (Sportradar, Genius Sports, SportsDataIO — esta última tiene tiers desde ~$500/mes). No hace falta pagar licencias hoy; hace falta **demostrar que el swap es un mes de trabajo, no una reescritura**.
2. **NowPayments/cripto** 🔴: pagos cripto sin KYC en un producto gambling-adjacent es radioactivo para cualquier comprador con licencias. **Mitigación**: añadir Stripe como rail principal, geo-fencing básico, página de juego responsable, y términos de servicio claros ("información/entertainment, no bookmaker"). Cripto puede quedarse como rail secundario para mercados no regulados, pero el revenue "limpio" debe dominar.
3. **Key-man risk**: un solo cerebro con todo el contexto. **Mitigación**: la documentación viva (`docs/`, CLAUDE.md) ya es inusualmente buena — formalizarla es barato y sube la valuación de un acquihire.
4. **Dependencia de Anthropic/xAI**: el costo por análisis y el riesgo de vendor. Tener números de unit economics (costo LLM por pick, por usuario activo) listos para la diligencia.

---

## 4. Los cuatro caminos de exit (no excluyentes — secuenciables)

### Camino A — Media/SaaS B2C: "el Action Network hispano" (más probable, 12–24 meses)
El mercado hispanohablante de sports betting (LatAm + US Hispanic) está explotando (Brasil legalizó 2025, México/Perú/Colombia crecen 30%+ anual) y **no tiene un Action Network**. HEXA ya es bilingüe, ya tiene pipeline de contenido a X, ya cubre soccer (el deporte que importa en LatAm) incluyendo el Mundial 2026 — que es **este mes**.
- Producto: suscripción mensual (cambiar credit packs de $8–40 por MRR — los compradores pagan múltiplos de **revenue recurrente**, no de ventas one-shot), tiers free/premium, picks + pizarra + tracker en vivo.
- Métricas objetivo para ser comprable: **$1–3M ARR, churn <5% mensual, 50K+ MAU**. A múltiplos del sector (3–6x ARR para media con crecimiento) eso es un exit de **$5–15M** con Better Collective, Catena, Gambling.com o un operador LatAm (Betano, Caliente) como compradores.
- El Mundial 2026 es la ventana de adquisición de usuarios más barata de la década para un producto de soccer en español. **Ya está implementado** (`fifa.world`). Capitalizarlo es ejecución de growth, no de ingeniería.

### Camino B — B2B API: "el intelligence layer" (mayor múltiplo, más lento)
Vender el context engine + señales + CLV analytics como API a: operadores tier-2/3 (que no tienen equipos cuantitativos), media deportiva, otros picks services, affiliates. `routes/content.js` con API keys ya es el embrión.
- Productos API: contexto enriquecido por juego (el bloque que hoy se le da al Oracle, como JSON), señales smart (steam/RLM, fatiga, umpire), probabilidades calibradas, board diario white-label.
- B2B SaaS con $1M ARR se vende a 6–10x. Y un operador que ya es **cliente** de la API es el comprador natural de la empresa (el patrón clásico: integrar → depender → adquirir).

### Camino C — El fondo: si el CLV es real, no vendas picks (mayor upside, mayor riesgo)
Si los 3,000 picks verificados muestran CLV +2% o mejor sostenido: el negocio óptimo no es vender suscripciones de $20 — es **apostar el propio bankroll** (o gestionar el de otros como syndicate). Un edge real de 2% CLV sobre volumen institucional vale más que cualquier SaaS. Aquí es donde la fantasía "un gran apostador compra HEXA" se vuelve literal: los syndicates (Billy Walters-style, Ranogajec-style) **sí compran modelos y datos**, y pagan por edge demostrado, no por UI.
- Realismo: el cap de confianza honesto de HEXA (62–72%) y los Brier actuales sugieren que hoy NO hay edge probado. Este camino se gana o se descarta con los datos del punto 2.

### Camino D — Acquihire/tech sale (el piso, $1–5M)
Si A/B/C no maduran: el pipeline multi-deporte + LLM orchestration + lifecycle es una demo de capacidad de equipo. Compradores: operadores construyendo equipos de AI, media companies, incluso los propios labs. Es el piso de valuación, no la meta — pero todo lo que sube el piso (docs, tests, arquitectura limpia, demo pulida) cuesta poco.

**Secuencia recomendada**: A es el vehículo (genera métricas y revenue ya), B se construye encima del mismo código (la API expone lo que A ya computa), C se decide con los datos a los 12 meses, D es el seguro.

---

## 5. Sobre Jordan, Judge y Ohtani — el realismo

Atletas activos **no pueden** tener equity en productos de apuestas (reglas de MLB/NBA/NFL; tras el escándalo Mizuhara-Ohtani de 2024, esa zona es radioactiva específicamente para Ohtani). Jordan, retirado, fue inversor de DraftKings y asesor especial — ese es el patrón real: **family offices de atletas retirados como inversores estratégicos para distribución**, no como compradores.

La versión alcanzable de esta fantasía: una ronda con un family office de atleta retirado o celebrity LatAm (futbolista retirado para el ángulo Mundial/soccer) que aporta **distribución** (su audiencia) a cambio de equity. Eso acelera el Camino A. El target de "compra" sigue siendo corporativo: Better Collective, Catena, Gambling.com, operadores LatAm, o un syndicate (Camino C).

---

## 6. Roadmap de 18 meses para maximizar valuación

### Fase 0 — Verificabilidad + limpieza (mes 0–3, el fundamento de TODO)
1. Hash-chain de picks con ancla pública diaria (~2 días).
2. Dashboard público de CLV por deporte/mercado sobre `public-stats.js`.
3. Stripe como rail de pago + modelo de suscripción MRR (mantener credit packs como upsell).
4. Términos de servicio + responsible gambling + geo-disclaimer.
5. Batch diario industrializado: analizar el slate completo de los 5 deportes automáticamente (no on-demand) → multiplica el ritmo de acumulación del track record y del dataset.
6. Documento de "data source swap plan" con costos de Sportradar/SportsDataIO (papel, no código).

### Fase 1 — Mundial 2026 como motor de growth (mes 0–2, EN CURSO — el torneo es ahora)
7. Producto free agresivo alrededor del Mundial: pizarra pública, un pick gratis diario, contenido automatizado a X en español. Objetivo: lista de emails/usuarios de 6 cifras durante el torneo.
8. Funnel free→paid medido (LTV/CAC desde el día uno).

### Fase 2 — Métricas de negocio (mes 3–9)
9. Mobile-first real (la PWA ya existe — pulir retención: notificaciones de resolución de picks, streaks, bankroll Kelly-aware sobre el equity engine que ya existe).
10. B2B API v1: contexto por juego + señales + probabilidades calibradas, 2–3 clientes piloto (affiliates LatAm).
11. Brier vs. market-baseline como métrica pública por mercado; matar (pausar) todo mercado con CLV negativo sistemático — el reporte CLV de admin (Sprint 8g) ya lo permite.

### Fase 3 — La decisión (mes 9–18)
12. Con 3,000+ picks verificados: leer el CLV. Positivo → levantar para Camino C o vender el edge. Plano/negativo → doblar en A/B con las métricas de media.
13. Data room permanente: métricas, unit economics, docs de arquitectura, cap table limpio, compliance memo. Estar "siempre listo para diligencia" cuesta poco y permite responder a inbound interest en días.

### Lo que NO hacer
- **No añadir el sexto deporte.** Cinco deportes sin track record profundo vale menos que tres con CLV verificado. La anchura ya está demostrada; ahora gana la profundidad.
- No perseguir features de "wow" (más modos de parlay, más LLMs) antes de tener MRR y CLV públicos.
- No tocar mercados US regulados como operador — HEXA es información/analytics, esa línea es la que lo mantiene vendible.

---

## 7. Matemática de valuación (para calibrar expectativas)

| Escenario a 18 meses | Activo demostrado | Comprador | Rango realista |
|---|---|---|---|
| Solo el código de hoy | Tech + equipo | Acquihire | $1–3M |
| $1M ARR media B2C, churn sano | Revenue + audiencia | Affiliate/media group | $4–8M |
| $3M ARR + Mundial audience + B2B pilotos | Revenue + flywheel | Better Collective-class | $12–25M |
| CLV +2% verificado sobre 5,000 picks | **Edge probado** | Syndicate / operador / fondo | $20M+ o no vender |

La "suma millonaria" no sale de mejorar el producto — sale de **convertir lo que el producto ya hace en evidencia verificable y revenue recurrente**. HEXA tiene una rareza genuina: la infraestructura de honestidad (CLV, resolución automática, postmortems, hit math) ya está construida. Lo que falta es volumen, verificabilidad pública y un modelo de revenue que los compradores sepan valorar.
