# Plan NFL para uso personal en bet365

Revisión: 29 de septiembre de 2026. Alcance: repositorio local, pruebas seleccionadas y documentación pública de proveedores. Objetivo confirmado: rendimiento de picks y control del riesgo, un usuario, sin presupuesto para nuevas suscripciones de datos. No se han consultado resultados actuales de producción.

Estado de implementación: trabajo en curso. Ya hay cambios locales para cotizaciones por línea, NO_BET, exclusión de pushes de etiquetas binarias, bloqueo de calibración sobre test, certificación de modelos por mercado, evaluación de cuota manual bet365, límites de exposición, ledger, resolución determinística y seguimiento automático de tickets pendientes. La interfaz permite consultar tickets, registrar una cuota cercana al kickoff y ver el informe de todas las cuotas evaluadas. El resolver almacena resultados de BET, WATCH y NO_BET por separado de los tickets realmente colocados. Los nuevos registros de features guardan hora de observación, disponibilidad y kickoff; el entrenamiento descarta snapshots en vivo tardíos y repeticiones del mismo partido. El generador de candidatos considera ambos lados con precio disponible; Imperdible exige cuota ejecutable y EV mínimo, y la ruta de combinadas queda marcada como investigación sin recomendación de apuesta. Se generaron informes walk-forward reales por temporada con nflverse 2021–2025 y cuotas de cierre de dos lados; los resultados actuales no justifican promoción. La certificación requiere además evidencia prospectiva de bet365, ausente por ahora. Las migraciones hasta NFL pasaron en Postgres temporal nuevo y al repetirse; una prueba integrada con datos sintéticos verificó almacenamiento, resolución y separación entre ROI real e hipotético. Faltan integración HTTP/ML con servicios reales, enriquecimiento de props y evidencia prospectiva de varias jornadas. Ningún modelo debe considerarse rentable o habilitado para dinero real por la mera existencia de este código.

## Diagnóstico

Actualización de fuentes: la entrada manual de la cuota bet365 es el flujo operativo. Existe una ruta opcional para Odds-API.io, pero su proveedor pausó las claves gratuitas nuevas y no hay clave configurada. Las pruebas de esa ruta usan respuestas simuladas del contrato publicado; no hay verificación de cuotas reales.

Hexa ya integra ESPN, cuotas NFL, nflverse, modelos Python de moneyline/spread/total, props, seguimiento, resolución y persistencia shadow. Rehacer esa infraestructura aportaría poco. La prioridad es convertirla en una cadena verificable: información disponible antes del partido → probabilidad calibrada → precio concreto de bet365 → decisión → exposición → resultado y evaluación.

Las pruebas funcionales no prueban rentabilidad. Tampoco lo hacen el número de variables, el acuerdo entre señales correlacionadas o una explicación convincente del LLM. Los artefactos de modelos no están disponibles en `ml/artifacts` en este checkout; las métricas mencionadas en CLAUDE.md son históricas, no una medición actual.

## Hallazgos comprobados en código

| Prioridad | Hallazgo y evidencia | Efecto y cambio propuesto |
|---|---|---|
| P0 | `server/routes/nfl.js`, `persistNflPick`: escribe `odds_at_pick` e `implied_prob_at_pick` como null. Conserva el objeto de mercado en `odds_details`. | El análisis de partido no deja un precio de entrada directamente utilizable por la evaluación. Guardar selección estructurada, línea, cuota, casa y hora; distinguir precio observado de apuesta realmente ejecutada. No imputar retrospectivamente cuotas como si fueran ejecutadas. |
| P0 | `server/nfl-odds.js`, `normalizeEvent`: toma las primeras tres casas, elige la moda de las líneas y promedia precios sin filtrar por esa línea. | Puede construir una combinación línea/precio inexistente. Mantener cada cotización intacta. Calcular consensos solo con la misma línea; conservarlos como referencia. `nfl-props-odds.js` ya contiene una corrección útil para copiar conceptualmente. |
| P0 | `server/prompts/oracle-nfl-prompts.js`: exige pick incluso con datos limitados; deriva confianza desde 50% con modificadores; usa esa confianza para Kelly con cap de 5% del bankroll. `nflOutputGuard.js` rechaza PASS. | La confianza narrativa decide exposición. Introducir BET / WATCH / NO_BET y cálculo determinístico de EV/stake. Separar análisis informativo de recomendación apostable. El LLM explica o señala inconsistencias, sin inventar probabilidades ni stake. |
| P0 | `ml/hexa_ml/data.py`, filtros NFL y `make_target`: spread/total conservan igualdades y el operador `>` las etiqueta 0. El loader histórico pone `result='resolved'`. | Un push se aprende como fracaso del home/over; invertir con `1-p` lo transforma en éxito del lado contrario. Modelar win/push/loss o distribución de margen/total; si se excluyen pushes temporalmente, declarar probabilidades condicionadas a no push y tratar su masa por separado para EV. Revisar también empates moneyline según contrato del mercado. |
| P0 | `server/services/nflImperdibleEngine.js`, `assessQbConfirmation`: ausencia de lesión genera `confirmed: true` y texto “both starters healthy”. | No demuestra titularidad ni disponibilidad. Usar estados confirmado/probable/desconocido/inactivo, ID y timestamp de la fuente. QB OUT no confirma automáticamente quién juega ni su nivel. |
| P0 | Mismo engine: `modelCertified = model != null` se aplica a todos los candidatos. `predictNflGameModel` permite mercados individuales null; el builder puede usar probabilidad implícita como fallback. | Tener respuesta de un mercado puede “certificar” otro sin modelo. Certificación por mercado, línea, versión, calidad y validación fuera de muestra; distinguir siempre `model` de `market_reference`. |
| P1 | `server/services/nflImperdibleSelector.js`: premia convicción/acuerdo, sin gate de EV positivo. | Un favorito probable puede ser una mala apuesta a su precio. Exigir precio real y EV conservador positivo antes de ordenar por preferencia. No interpretar acuerdo como independencia estadística. |
| P1 | `server/closing-line-capture.js` importa calendario y cuotas MLB. Los otros capturadores encontrados son props MLB y soccer. | Falta captura dedicada y verificable de cierre NFL. Usar último snapshot realmente anterior al kickoff; guardar línea y precio. No mezclar una cuota live con cierre pregame. |
| P1 | `ml/hexa_ml/nflverse_loader.py`: histórico con líneas de cierre; lesiones, QB y viento quedan NaN. `nflMlClient.js` envía la línea disponible bajo nombres `spread_close`/`total_close`. | Evaluar al cierre no demuestra rendimiento apostando horas antes. Crear datasets separados por momento de decisión. Tener campos en inferencia no implica que el modelo haya aprendido sus efectos. |
| P1 | `ml/hexa_ml/train.py`: split temporal único, fallback de calibración sobre test en muestras pequeñas; spread/total usan -110 supuesto para ROI. Ya existen flags de advertencia y comparación contra referencias. | Reutilizar esos controles, pero bloquear promoción con test contaminado o ROI basado en precios supuestos. Hacer walk-forward por temporadas/semanas y separar calibración, selección y evaluación final. |
| P1 | `nflOutputGuard.js`: confianza fuera de rango se degrada pero no se rechaza ni corrige en temporada regular; líneas no verificadas generan avisos. | Un aviso no basta para autorizar exposición. Mantener análisis visible si es útil, pero bloquear la decisión BET cuando falten sus requisitos. |
| P2 | `server/services/parlayEngine/correl.js` contiene reglas y variables MLB; el builder NFL genera una sola selección por mercado según probabilidad >50%. | Correlación NFL y búsqueda de valor incompletas. Evaluar ambos lados a sus precios. Mantener combinadas fuera del primer experimento de rentabilidad; más adelante modelar dependencias NFL y usar la cuota real de la combinada. |

## Producto propuesto: evaluar tu precio

Flujo de uso:

1. Elegir partido y mercado.
2. Pegar desde bet365 selección, línea y cuota decimal; registrar hora. Entrada estructurada manual primero. Si después se incorpora lectura de captura, confirmar la extracción antes de guardar.
3. Hexa verifica identidad, mercado, periodo, línea, frescura y situación de titulares.
4. Devuelve probabilidad estimada y procedencia, incertidumbre, cuota mínima, EV, factores de invalidación y BET / WATCH / NO_BET.
5. Solo al registrar que se realizó la apuesta, guardar cuota aceptada e importe real en un registro independiente e inmutable.

Si ya se dispone de una clave Odds-API.io válida, la integración opcional intenta consultar cuotas indicativas de bet365 y permite seleccionar línea y mercado sin copiarlos. El servidor vuelve a consultar la cuota al evaluar y conserva ID de evento, hora de consulta y hora de último cambio publicada por el proveedor. La cuenta puede mostrar otra cuota o rechazarla: el precio ejecutado solo se confirma al registrar el ticket. Sin esa clave, se usa la entrada manual. Un consenso de otras casas sirve como comparación, no como tu precio de ejecución.

Ejemplo ficticio sin push: si la probabilidad estimada es 55%, a cuota 1.91 el EV es `0.55 * 1.91 - 1 = +5.05%`. A 1.75 pasa a `-3.75%`. Es el mismo pronóstico y otra decisión. El 55% debe proceder de un modelo evaluado; el ejemplo no demuestra que Hexa lo estime correctamente.

Para mercados con devolución: `EV = p_win * (cuota_decimal - 1) - p_loss`, con `p_win + p_push + p_loss = 1`. De-vig se usa para comparar contra el mercado; el cálculo económico usa la cuota efectivamente disponible.

## Datos sin nuevas suscripciones

- Mantener el loader Parquet de nflverse que ya existe. Añadir estadísticas semanales, snaps, targets, acarreos, intentos de pase, participación en zona roja e IDs cuando haya cobertura verificable.
- Mantener ESPN como fuente operativa, con caché, control de frescura y estados desconocidos explícitos. No dar por hecho un SLA.
- Reutilizar clima del kickoff, con hora de emisión del pronóstico. El clima final observado no sustituye el pronóstico que se conocía al apostar.
- Registrar snapshots propios de las cuotas de bet365 de los candidatos que realmente evalúas. Entrada manual de apertura y cercana al kickoff; si falta cierre, CLV queda desconocido.
- Mantener las cuotas de otras casas que ya permita la integración existente, sin ampliar gasto automáticamente.
- No depender de participación completa de nflverse durante la temporada: la documentación indica que los datos de participación de FTN desde 2023 llegan después de la postemporada. Snaps y estadísticas semanales tienen otras cadencias.
- No incorporar `nfl_data_py`: está deprecado a favor de `nflreadpy`. Hexa ya lee Parquet directamente; no necesita migrar para resolver los problemas prioritarios.

Fuentes verificadas:

- [Estado de nfl_data_py](https://github.com/nflverse/nfl_data_py).
- [Disponibilidad y actualización de nflverse](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html).
- [Histórico de The Odds API](https://the-odds-api.com/historical-odds-data/): las cuotas históricas adicionales, incluidos props, requieren plan pagado; no se incluyen en esta fase.

### Fuente de cuotas bet365 NFL

Implementación visual local: `GET /api/nfl/market-reference` permite comparar antes del análisis la cuota manual bet365 con al menos dos casas independientes, frescas y con ambos lados de la misma línea. La tarjeta muestra probabilidad sin margen, cuota justa de referencia, diferencia implícita y procedencia. La pestaña Historial de NFL añade un centro de seguimiento con decisiones BET/WATCH/NO_BET, ROI y P/L solo de tickets liquidados, CLV cuando existe cierre comparable, curva acumulada y calibración por mercado. La pestaña En vivo de NFL muestra ahora todos los partidos de la semana, sus horarios en Lima y resultados, además de los partidos en curso. MLB añade una tira de forma de los 20 picks más recientes; es un conteo de aciertos, no retorno financiero. Estas vistas son diagnósticas y aún no prueban ventaja rentable.

La API que Hexa ya tenía (`the-odds-api.com`, región `us`) **no ofrece bet365 NFL**: su [lista actual de casas](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) solo incluye `bet365_au`, de pago y limitado a AFL/NRL. No debe etiquetarse un consenso de otras casas como bet365. [SportsGameOdds](https://sportsgameodds.com/bookmakers/bet365-odds-api) sí declara cobertura bet365 NFL, pero la sitúa en Pro ([US$299/mes según sus precios actuales](https://sportsgameodds.com/pricing)), incompatible con esta fase personal sin presupuesto.

[Odds-API.io](https://odds-api.io/es/pricing/free) **pausó indefinidamente la emisión de claves gratuitas nuevas**; las claves gratuitas existentes siguen funcionando. Aunque anuncia bet365 y NFL, no es una vía gratuita disponible para esta cuenta sin una clave previa. Su plan de entrada anunciado cuesta £49/mes, por lo que la integración `ODDS_API_IO_KEY` queda opcional y no es una dependencia del flujo personal. Los endpoints públicos confirmaron el slug `american-football` y la casa `Bet365`, pero la cobertura real de cada partido y mercado todavía no pudo verificarse con credenciales. Hexa conserva `GET /api/nfl/bet365-odds?gameId=...` y `source: odds_api_io` solo para el caso de una clave válida. El precio de la API sería indicativo y debe cotejarse con la cuenta personal antes de registrar un ticket.

[ParlayAPI](https://parlay-api.com/nfl-odds-api) anuncia cobertura NFL de bet365 y un [plan gratuito de 1.000 créditos al mes](https://parlay-api.com/pricing), sin tarjeta, con formato compatible con The Odds API. Es una alternativa a investigar, **no una fuente validada para Hexa**: aún no hay clave ni prueba de cobertura, latencia, restricciones por plan o coincidencia con las cuotas visibles de bet365 Perú. La implementación no debe sustituir la cotización manual ni etiquetar como bet365 una cuota de otra casa. Si la prueba real confirma bet365 NFL en el plan gratuito, se puede añadir un adaptador específico y mantener el registro de precio aceptado.

Comprobación de Railway el 30 de septiembre de 2026: el proyecto `Hexa Oracle`, entorno `production`, no expuso `ODDS_API_IO_KEY` al comando local `railway run` ni en el servicio `hexa-v4` ni en `Hexa ML`. El backend sí tiene `ODDS_API_KEY` y `ODDS_API_BACKUP_KEY`, que pertenecen a `the-odds-api.com` y no prueban acceso a Odds-API.io. El calendario ESPN de la semana 4 devolvió 16 partidos y nombres/horarios completos. No se imprimió ni almacenó ninguna clave.

Sondeo real con `ODDS_API_KEY` desde Railway: la clave primaria devolvió `OUT_OF_USAGE_CREDITS`; la de respaldo respondió con 15 eventos NFL del 4 de octubre y nueve casas (`betmgm`, `betonlineag`, `betrivers`, `betus`, `bovada`, `draftkings`, `fanduel`, `lowvig`, `mybookieag`). **No hubo bet365**. Esto confirma que renombrar la variable o reutilizar su valor en otro proveedor no produciría cuotas bet365. El camino disponible hoy sin contratar datos es referencia de mercado con la clave de respaldo más entrada manual del precio bet365; registrar de forma prospectiva todas las oportunidades evaluadas y no activar apuestas hasta acreditar calibración, CLV y retorno neto.

## Modelo y evaluación

Primero construir una referencia sencilla y medirla. Usar la probabilidad de mercado sin margen cuando existan ambos lados comparables; compararla con un modelo regularizado y con el XGBoost existente. No añadir complejidad si no mejora fuera de muestra.

Propuestas de variables, sujetas a pruebas de contribución:

- EPA ofensiva/defensiva ajustada por rival, forma reciente regularizada hacia el historial, con menor peso de temporadas lejanas.
- QB titular identificado y calidad estimada por jugador; evitar descuentos universales de puntos para cualquier suplente.
- Ritmo y volumen esperado, estado del marcador, descanso, localía, viajes y viento, con disponibilidad histórica equivalente a producción.
- Cambios de rol de RB/WR/TE, redistribución de targets/acarreos por ausencias y continuidad de línea ofensiva, cuando la fuente permita medirlos sin inventar datos.

En props, priorizar inicialmente un solo mercado de volumen disponible en bet365, por ejemplo recepciones o intentos de carrera. La elección definitiva depende de cobertura y resultados. Descomponer oportunidades y eficiencia; los promedios de últimas jornadas no bastan para describir incertidumbre. Usar modelos jerárquicos/distribuciones adecuadas antes de intentar un simulador conjunto complejo. Touchdowns y combinadas quedan para una fase posterior por su dispersión y dependencias.

Validación requerida:

1. Features con `observed_at`, `available_at` y corte anterior a cada decisión. Agrupar el mismo partido en una única partición; no contar copias del mismo pick para usuarios/consultas como observaciones independientes.
2. Walk-forward por temporadas y semanas. Calibración separada del test. Elegir umbrales en validación y congelarlos antes de evaluar el test final.
3. Comparar Brier, log loss y calibración con referencias usando el mismo conjunto de partidos. Reportar cobertura, N y calidad de la referencia.
4. ROI a cuota ejecutada y a stake constante; por separado rendimiento de la política de stake. Reportar drawdown, exposición y resultados por mercado, momento de entrada y temporada.
5. Intervalos de incertidumbre con remuestreo por partido/semana, considerando dependencia entre picks. No usar un N fijo como prueba automática de ventaja.
6. CLV a igual línea y mercado. Cuando cambie la línea, registrar movimiento de puntos y precio por separado; no restar probabilidades de eventos distintos como si fueran equivalentes.
7. Guardar todos los candidatos evaluados y razones de rechazo para poder estudiar selección sin ocultar pérdidas. Limitar búsqueda de estrategias para reducir sobreajuste por probar muchas variantes.

Sin cuotas históricas de bet365, el histórico gratuito puede demostrar utilidad predictiva, pero no la rentabilidad ejecutable que habrías tenido en esa cuenta. Esa evidencia debe acumularse prospectivamente.

El informe reproducible por temporada se ejecutó desde la raíz con `PYTHONPATH=ml python -m hexa_ml.nfl_walk_forward --market all --nflverse-years 2021,2022,2023,2024,2025 --out docs/nfl-walk-forward` (en PowerShell, definir `$env:PYTHONPATH='ml'` primero). Puede usarse `--csv` para añadir snapshots exportados del feature store. El informe no promueve modelos ni calcula ROI bet365 sin precios aceptados. La fuente pública de precios de cierre es el [calendario de nflverse](https://nflreadr.nflverse.com/articles/dictionary_schedules.html); no implica que bet365 haya ofrecido esas cuotas al apostar.

Resultados agregados de los cuatro folds de prueba (2022–2025; menor Brier es mejor). Cada fold entrena solo con temporadas anteriores, separa semanas para calibración y otras semanas posteriores para seleccionar el peso de una mezcla modelo/mercado. Los intervalos de cada fold remuestrean jornadas. Los agregados son promedios ponderados descriptivos, sin intervalo conjunto:

| Mercado | N prueba | Brier modelo | Brier mercado de cierre | Brier mezcla elegida antes | Folds con ventaja demostrada |
|---|---:|---:|---:|---:|---:|
| Moneyline | 1084 | 0.2477 | 0.2105 | 0.2119 | 0/4 |
| Spread | 1058 | 0.2517 | 0.2498 | 0.2502 | 0/4 |
| Total | 1079 | 0.2524 | 0.2501 | 0.2493 | 0/4 |

Artefactos completos: `docs/nfl-walk-forward/nfl_moneyline.json`, `nfl_spread.json` y `nfl_total.json`. El fallo más claro es moneyline: el modelo actual no usa la probabilidad de mercado como variable y queda muy por detrás de ella. La mezcla seleccionó 0% del modelo en tres de cuatro temporadas moneyline; el único fold con 25% empeoró frente al mercado. En total, la mejora agregada de 0.0008 de la mezcla viene de un único fold cuyo intervalo incluye cero; no demuestra ventaja. Estos resultados desaconsejan activar picks con dinero real. Próximo experimento: referencia de mercado como pronóstico principal y estimación de residuales NFL, elegida en validación anterior y puntuada en temporadas posteriores. También hace falta evaluar a la hora de la cuota bet365, no solo con cierre retrospectivo.

Ese experimento residual ya se ejecutó con `python -m hexa_ml.nfl_market_residual --market all --nflverse-years 2021,2022,2023,2024,2025 --out docs/nfl-walk-forward`. Ajusta solo la diferencia entre el resultado y la probabilidad de mercado usando cuatro señales prepartido; semanas previas eligen regularización y tamaño de la corrección, y la temporada siguiente queda fuera de selección. Resultados agregados descriptivos de 2022–2025:

| Mercado | N | Brier mercado | Brier residual | Folds con intervalo favorable |
|---|---:|---:|---:|---:|
| Moneyline | 1084 | 0.21045 | 0.21073 | 0/4 |
| Spread | 1058 | 0.24980 | 0.25012 | 0/4 |
| Total | 1079 | 0.25012 | 0.25071 | 1/4 |

En total, la mejora de 2023 no persistió en 2024; seleccionar ahora otras variables sobre las mismas temporadas convertiría 2022–2025 en exploración, no en una nueva prueba final independiente. Los tres informes `*_residual.json` conservan pesos, cobertura y rangos por fold. Tampoco este experimento contiene cuotas aceptadas de bet365.

## Ruta para buscar rentabilidad sin asumir que ya existe

La prioridad cambia de pronosticar todos los partidos a detectar **precios concretos posiblemente atrasados**. Una apuesta solo es candidata cuando la línea exacta de bet365 y su cuota se comparan con una referencia de dos lados observada a la misma hora; si la línea cambió, se informa movimiento de puntos por separado. La referencia sin margen es una hipótesis de probabilidad, no un margen garantizado. Un EV calculado con una fuente incompleta o una cuota que ya desapareció no cuenta como oportunidad.

1. Durante varias jornadas, registrar sistemáticamente también los NO_BET: a una hora fija antes de kickoff y al aparecer noticias verificables de QB, lesiones o cambios de rol. Guardar hora, selección, línea, precio bet365 y precios de referencia con su propia hora. Una muestra formada solo por picks elegidos sesgaría la evaluación.
2. Concentrar el primer estudio en **un mercado** con cobertura de precios y resultados suficiente. Totales no recibe prioridad automática: su mejora histórica fue inestable. Recepciones o volumen de acarreos son hipótesis si se consigue registrar línea y ambos lados de forma consistente; nflverse publica estadísticas de jugador durante la temporada, pero la participación FTN desde 2023 llega después de la postemporada y no sirve como señal contemporánea.
3. Medir por separado calidad de probabilidad (Brier y calibración), precio capturado (CLV con la misma línea cuando exista), y beneficio neto a cuota e importe realmente aceptados. Reportar todos los intentos, tasa de cuota disponible, pushes, límites de exposición, drawdown e intervalos por semana. Si la ventaja desaparece al usar la cuota aceptada o tras cambios de línea, se rechaza la estrategia.
4. Congelar mercado, señales y umbral antes de la próxima ventana prospectiva. Solo promover si esa ventana mantiene EV conservador, precio ejecutable, calibración y resultados compatibles con ventaja después de margen e incertidumbre. No existe un número fijo de picks que convierta una pérdida en rentabilidad demostrada.

Este orden se apoya en que el mercado NFL es un adversario fuerte: el análisis empírico de [Levitt sobre precios y apuestas NFL](https://www.nber.org/papers/w9422) encontró escasa evidencia de apostadores capaces de batir sistemáticamente a la casa en su muestra. La [cadencia oficial de nflverse](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html) define qué datos pueden estar disponibles a tiempo y cuáles no. No se presupone que una fuente gratuita tenga históricos de bet365 a la hora de entrada.

El flujo manual ya captura, si The Odds API tiene datos disponibles, una referencia diagnóstica independiente: exige dos casas distintas de bet365 con ambos lados de la **misma línea**, actualización dentro de cinco minutos y consulta a menos de un minuto de la cuota manual. Guarda probabilidad sin margen, casas y horas junto a la decisión; no la usa para certificar el modelo ni para autorizar BET. Si la referencia no cumple esas condiciones, queda ausente en vez de inventarse. La integración depende de la clave y cuota de consultas existentes de The Odds API.

## Riesgo: política inicial para validar

Primera etapa en simulación, con exposición real recomendada cero hasta cerrar los defectos P0 y disponer de evidencia suficiente. Después, si se habilita dinero real, propuesta conservadora inicial: unidad fija de 0.25% del bankroll, máximo 0.5% por partido y 2% por jornada. Son límites de diseño a revisar, no porcentajes óptimos demostrados. Incluir todas las posiciones correlacionadas del mismo partido en el límite.

Revisar el límite con el usuario antes de activarlo. No subir tamaño tras pérdidas. Cuando la calibración esté suficientemente contrastada, estudiar Kelly fraccionado con probabilidades conservadoras y límites agregados. Un modelo sin validar, cuota obsoleta, identidad ambigua, evento fuera de distribución o dato crítico desconocido produce NO_BET. El acuerdo de varios modelos que usan los mismos datos no aumenta por sí solo la confianza.

## Secuencia de implementación

Estimación orientativa de esfuerzo, no plazo para demostrar rentabilidad. La validación prospectiva necesita jornadas y puede requerir varias temporadas según el volumen y el tamaño de la ventaja.

| Fase | Trabajo | Criterio para avanzar |
|---|---|---|
| 1: integridad, 3–5 días | Cuota/selección/fecha estructuradas; arreglar mezcla de líneas; NO_BET; pushes; QB desconocido; certificación por mercado; sacar stake del LLM. | Pruebas de casos límite; ninguna decisión BET sin identidad, precio y modelo válido; ninguna devolución convertida en victoria del lado contrario. |
| 2: evaluación, 1–2 semanas | Walk-forward, referencia de mercado, particiones por partido, versionado, métricas con incertidumbre y bloqueo de modelos no aptos. | Informe reproducible por mercado; calibrador sin acceso al test; ninguna etiqueta de ROI medido con cuotas supuestas. |
| 3: flujo personal bet365, 3–5 días | Formulario de precio, cuota mínima, estados de decisión, ledger de apuestas ejecutadas, snapshots/cierre y límites agregados. | Se reproduce de extremo a extremo una decisión y su resultado a la cuota aceptada; diferencias entre precio observado y ejecutado visibles. |
| 4: especialización, 2–4 semanas iniciales | Enriquecer rol/QB/volumen; un mercado de props en shadow; pruebas de contribución de variables. | Mejora fuera de muestra y estabilidad suficientes para justificar promoción; si no, mantener el modelo base y NO_BET. |
| 5: investigación posterior | Distribución conjunta de margen/total/volumen, escenarios de titulares, dependencia de props y combinadas. | Solo después de validar la base; simulación no equivale a evidencia y miles de iteraciones no eliminan error del modelo. |

Archivos propuestos para aislar el trabajo NFL: `nflDecisionEngine.js`, `nflQuoteService.js`, `nflRiskPolicy.js`, `closing-line-capture-nfl.js` y un evaluador walk-forward en Python. Reutilizar infraestructura útil existente, incluidas métricas y Bet Card, tras revisar sus supuestos. Cambios en módulos compartidos de Python requieren regresiones de otros deportes.

El primer entregable debe ser una tarjeta capaz de decir: “Esta selección solo tiene sentido a esta línea y desde esta cuota; ahora BET / WATCH / NO_BET; estas son las condiciones que cambian la decisión”. Ese es el punto donde la precisión empieza a traducirse en decisiones económicas medibles.

## Verificación de esta implementación

- 32 pruebas Python de nflverse, referencias y walk-forward pasaron. En la última revisión pasaron 56 pruebas JavaScript NFL; el cliente compiló.
- El informe prospectivo usa la primera cuota registrada por partido y mercado para evitar seleccionar retrospectivamente una cuota posterior tras un push. El ROI liquidado incluye todo el historial de tickets; la lista visual muestra los 200 más recientes.
- La cadena de migraciones hasta NFL se ejecutó en una base Postgres temporal vacía y pasó también al repetirse. `server/scripts/verify-nfl-personal-flow.js` insertó datos sintéticos y verificó tres cuotas resueltas, un ticket liquidado y la separación del ROI. La base temporal se eliminó.
- Los informes históricos usan 2021–2025 y separan entrenamiento, calibración, selección y prueba por semanas/temporadas. Ningún fold demuestra ventaja del modelo o mezcla sobre la referencia de cuotas de cierre.
- El experimento residual también se ejecutó en las tres categorías: su Brier agregado fue peor que el mercado en las tres. La última corrida de pruebas Python seleccionadas pasó 47/47; las pruebas JavaScript de referencia exacta, frescura y decisión pasaron 17/17. El cliente compiló.
- El adaptador opcional Odds-API.io y las rutas nuevas pasaron 26 pruebas JavaScript NFL seleccionadas; el cliente compiló. Se verificaron los identificadores públicos `american-football` y `Bet365`, pero sin `ODDS_API_IO_KEY` configurada no se puede afirmar cobertura ni precio actual de NFL en la cuenta.
- No se ejecutaron apuestas reales, despliegues ni reentrenamientos de modelos en producción. No se afirma rentabilidad actual o futura.
