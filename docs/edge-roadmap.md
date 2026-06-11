# HEXA — Edge Roadmap: de máquina de contenido a máquina de dinero

> Brainstorm técnico (2026-06-11). Tesis: HEXA hoy está arquitecturada como **máquina de contenido** (un pick por juego, siempre). Una máquina de dinero apuesta el 5–15% de los juegos, con sizing, y se poda a sí misma. Casi todo lo necesario **ya existe en el código** — está construido pero desconectado del circuito de decisión.

---

## 0. El diagnóstico (evidencia en el código)

| Síntoma | Dónde | Por qué importa |
|---|---|---|
| "**Never output ABSTAIN or PASS**" en los 5 prompts no-MLB | `oracle-{nba,nfl,nhl,soccer,tennis}-prompts.js` | Forzar pick en cada juego garantiza apostar cientos de juegos sin edge. El prompt MLB sí permite "NO VALUE" — los demás no. |
| Calibración calculada pero decorativa | `confidenceCalibrationService.js` → `picks.calibrated_confidence` | El número más honesto del sistema (win rate observado por bucket) se guarda y **no filtra ni dimensiona nada**. |
| Conviction tier decorativo | `convictionService.js` → badge en HistoryPanel | "3/3 modelos de acuerdo" es la mejor señal de selección disponible y solo pinta un chip verde. |
| CLV capturado pero pasivo | `closing-line-capture.js` + reporte admin | La única prueba estadística de edge real existe… como panel colapsable. No pausa mercados negativos. |
| Cero sizing | (no existe) | Sin Kelly fraccional, un 54% hit rate se siente como break-even. El sizing ES la mitad del compounding. |
| MLB entrena con ~600 picks mientras NFL pre-entrenó con 2,622 filas históricas | `train.py`, `nflverse_loader.py` | La brecha ML más absurda: el deporte con mejores datos (Statcast) tiene los modelos más hambrientos. NFL y Soccer ya demostraron el patrón de pre-training; MLB/NBA/NHL no lo tienen. |

**La ecuación**: Ganancia = Volumen × Edge × Sizing − Costos. HEXA optimiza volumen de *contenido*; no optimiza ninguno de los otros tres factores. La buena noticia: las piezas están construidas — falta cablearlas como circuito de decisión.

---

## 1. Palanca #1 — Selectividad: el "Bet Card" diario (máximo impacto, mínimo código nuevo)

**No tocar el "always deliver" de los prompts** — el contenido por juego es el producto de engagement. En cambio, separar dos productos:

- **Contenido** = análisis de cada juego (lo de hoy, sin cambios).
- **Apuestas** = un pipeline nuevo, `betCardService`, que corre el slate COMPLETO de los 5 deportes cada día y emite solo lo que pasa TODOS estos gates:
  1. `edge = prob_ensemble − prob_de-vig ≥ +3%` (la prob viene del modelo, no del LLM — ver §2)
  2. `conviction_tier = 3/3` (ya se computa; hoy es un chip)
  3. CLV histórico del mercado+deporte ≥ 0 sobre rolling 200 picks (ya se computa; hoy es un panel)
  4. Gate de disponibilidad del deporte (lineup MLB / QB NFL / goalie NHL — ya existen)
  5. Veto del árbitro adversarial (§4.3)

El Imperdible **ya es esto** para un juego — generalizar su filosofía (stages, gates duros, PASS como resultado válido y frecuente) a la cartera diaria. Resultado esperado: de ~10 picks/día a **0–4 apuestas/día**. Un día sin apuestas es un output correcto y hay que celebrarlo en la UI, no esconderlo.

## 2. Palanca #2 — La probabilidad la pone el modelo; el LLM interpreta

La confianza del Oracle es una vibra en rango 50–72 que después se encoge. Para decisiones de dinero, la probabilidad debe venir del ensemble calibrado; el LLM aporta lo que los modelos no ven (lesión ambigua, contexto cualitativo, motivación) y actúa de **veto**, no de fuente del número.

**El desbloqueo concreto: pre-training histórico para MLB, NBA y NHL** (replicar el patrón ya probado en NFL 9.3 y Soccer 11.2):
- **MLB**: Retrosheet/Statcast (2015+) + archivos de odds históricos (Kaggle/SBR tienen 2010+) → frame as-of-date sin leakage, ~15,000+ juegos. El deporte insignia dejaría de entrenar con 600 filas.
- **NHL**: MoneyPuck publica CSVs históricos con xG por juego — el más fácil de los tres. Desbloquea el sidecar NHL (10e, hoy diferido).
- **NBA**: archivos Kaggle de odds + box scores históricos.

Con eso, los 3 deportes restantes tienen modelos vivos en semanas, no en "cuando haya 500 picks". Y el gate #1 del Bet Card (edge vs modelo) funciona en los 5 deportes.

## 3. Palanca #3 — Cazar mercados blandos, no líneas principales

Los caps de confianza (62–72%) ya admiten la verdad: el moneyline/spread/total de cierre en books grandes es ~eficiente. El edge sistemático vive en:

1. **Player props** — límites bajos, books lentos en ajustar a lineup/umpire/clima. El enriquecimiento Savant de props es la pieza más diferenciada de HEXA. Mejora clave: **no esperar 50 picks live para el modelo `prop`** — los props de Ks se modelan como proyección distribucional (Poisson/NegBin sobre K-rate del pitcher ajustado por lineup contrario, umpire `k_rate_impact` que YA está en el contexto, y park) vs. la línea → fair prob sin necesitar histórico de odds de props. Eso es un modelo entrenable HOY con Statcast histórico.
2. **Derivados** — F5 (`f5SuggestionService` ya existe — promoverlo de "sugerencia informativa" a mercado de primera clase del Bet Card), team totals, alt lines realistas (caps ya corregidos en 8c).
3. **Timing** — el opener es más blando que el cierre. Ver §5.

## 4. Mejoras de prompt (lo que pediste específicamente)

1. **Inyectar la tabla de calibración en el prompt**: el dato de `confidenceCalibrationService` ("históricamente, cuando dices 65%+ en MLB ML, ganas el 58%") como bloque `YOUR CALIBRATION RECORD` en el contexto. Es el ancla anti-sobreconfianza más barata que existe y cierra el loop calibración→Oracle (hoy solo existe postmortem→Oracle).
2. **Probabilidad explícita por lado, no solo confianza del pick**: exigir en el JSON `prob_home/prob_away` (o over/under) + la implied de mercado citada + el delta justificado, con regla dura: delta > 8% sobre el de-vig requiere flag `extraordinary_evidence` con la evidencia nombrada. El prompt MLB ya tiene la matemática de edge; los otros 4 no la exigen estructuralmente — portarla.
3. **Generalizar el árbitro del Imperdible**: una pasada adversarial barata (Haiku) sobre cada candidato del Bet Card cuyo único trabajo es construir el caso EN CONTRA y vetar. El patrón ya existe (`imperdibleArbiter`); solo se aplica al lock. Aplicarlo a todo lo que vaya a ser apuesta.
4. **Self-consistency en finalistas**: correr el Oracle 2–3 veces (temperatura) solo sobre los finalistas del Bet Card; divergencia entre corridas (pick distinto o ±5 confianza) = señal de incertidumbre = no-bet. Costo acotado porque solo aplica a 3–6 juegos/día.
5. **Lessons learned para los 5 deportes**: el bloque `ORACLE LESSONS LEARNED` (postmortems agregados) solo existe para MLB. Extender `postmortemLessonsService` por deporte y por mercado.
6. **Harness de evaluación de prompts**: tratar cambios de prompt como releases de modelo. `feature-store` ya persiste contextos; `backtest_results` ya existe. Replay de contextos históricos por variante de prompt → Brier vs. resultados + vs. baseline de-vig → gate de merge. Sin esto, cada "mejora" de prompt es fe.

## 5. Palanca #4 — Timing y ejecución (CLV sistemático)

- **Análisis event-driven, no on-demand**: disparar el análisis MLB automáticamente al confirmarse lineups (el status `confirmed/partial` ya se trackea), NHL al confirmarse goalie, NFL al confirmarse QB. Llegar sistemáticamente antes que el movimiento = CLV positivo estructural, independiente del modelo.
- **Reglas de ejecución sobre line movement v2** (ya detecta steam/RLM): nunca apostar contra un `reverse_line_movement` detectado; un `sustained_move_pct` alto a favor después de nuestro análisis = confirmación; en contra = re-evaluar o matar la apuesta.
- **Line shopping**: `perBook` ya se guarda en snapshots — emitir cada apuesta con el mejor precio disponible y el book. 1–2% de ROI viene gratis de ahí.

## 6. Palanca #5 — Sizing (Kelly fraccional)

Cada apuesta del Bet Card sale con `suggested_stake_units`: ¼-Kelly sobre el edge calibrado, cap 2% del bankroll, half-Kelly solo para conviction 3/3 + edge > 5%. El Monte Carlo (`monteCarloBankroll`) y el equity engine ya existen para simular y trackear — falta solo el cálculo del stake y mostrarlo. Medir en paralelo ROI flat-stake vs. ROI Kelly: la diferencia ES el valor del sizing.

## 7. Palanca #6 — El router que se poda solo

Automatizar el reporte CLV: job semanal que pausa (flag por mercado+deporte) toda combinación con CLV negativo sobre rolling 200 picks y la reactiva si el shadow tracking (que sigue corriendo sin apostar) vuelve a positivo. La máquina de dinero no es la que más mercados cubre — es la que corta los brazos perdedores sin emoción.

## 8. Costos (la otra mitad de la ecuación)

- **Triage barato**: para el slate completo diario, primera pasada con Haiku/modelo determinístico que rankea; el Oracle completo (Claude+Grok dual) solo corre sobre el top del ranking. El Imperdible ya hace staged ranking — mismo patrón.
- Medir **costo LLM por apuesta emitida** (no por análisis). Si una apuesta promedio arriesga 1u para ganar ~0.9u con 55%, el EV es ~0.045u — el costo de LLM por apuesta debe ser una fracción trivial de eso a stakes reales.

## 9. Qué medir semanalmente (el tablero de la verdad)

1. **CLV promedio por deporte+mercado** — la métrica #1; todo lo demás es ruido de varianza.
2. **Brier del ensemble vs. Brier del de-vig de cierre** — ¿el modelo sabe algo que el mercado no?
3. **Hit rate por conviction tier y por bucket de edge** — ¿la selectividad selecciona?
4. ROI flat vs. ROI Kelly del Bet Card.
5. % de días con 0 apuestas (sano: 20–40%).

**El veredicto a 300 apuestas del Bet Card**: si el bucket [3/3 + edge ≥3%] no le gana a la línea de cierre, el edge no está ahí — y el negocio es contenido (que es un negocio válido, pero distinto, y conviene saberlo cuanto antes).

## 10. Orden de ejecución (impacto/esfuerzo)

| # | Qué | Esfuerzo | Por qué primero |
|---|---|---|---|
| 1 | Bet Card pipeline (gates sobre lo que ya existe) | 1–2 sem | Convierte señales decorativas en decisiones |
| 2 | Conviction + calibración como gates activos | días | Ya están computados |
| 3 | Pre-training histórico MLB/NHL/NBA | 2–3 sem | El desbloqueo ML más grande disponible; patrón ya probado 2 veces |
| 4 | Kelly sizing + stake en cada apuesta | días | Compounding |
| 5 | Tabla de calibración en el prompt + árbitro generalizado | 1 sem | Mejor prompt-ROI disponible |
| 6 | Análisis event-driven (lineup/QB/goalie confirm) + reglas steam/RLM | 1 sem | CLV estructural |
| 7 | Router CLV auto-pausa | días | La máquina se poda sola |
| 8 | Modelos de proyección de props (Ks primero) | 2–4 sem | La frontera real del edge |
| 9 | Harness de backtest de prompts | 1–2 sem | Deja de cambiar prompts a fe |

**Y una advertencia**: hay archivos de tenis en el repo (`oracle-tennis-prompts.js`, `routes/tennis.js`). Un sexto deporte ancho-pero-raso va exactamente en contra de todo lo anterior — cada hora en tenis es una hora que no profundiza el edge de los 5 que ya existen. La máquina de dinero se construye con profundidad, no con cobertura.
