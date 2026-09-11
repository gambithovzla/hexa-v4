# NFL: calendario y calidad de predicción

Revisión del 11 de septiembre de 2026. Rama `codex/nfl-reliability-and-prediction-quality`.

## Correcciones

- **Juegos:** un fallo de ESPN ya no equivale a una semana vacía exitosa. La ruta devuelve HTTP 503 con código estable y `Retry-After`; una semana confirmada sin eventos sigue devolviendo 200.
- **Recuperación:** respaldo del mismo año, fase y semana ante errores o respuestas vacías. Antigüedad máxima de 15 minutos, fecha de captura conservada y aviso cuando el respaldo podría ser parcial. Las llamadas simultáneas comparten consultas. Un calendario vacío en caché no oculta un respaldo poblado de la semana actual.
- **Interfaz:** cancelación al cambiar de vista, timeout, error visible, reintento manual y automático tras errores NFL, botón Actualizar y número de semana. La PWA deja de reutilizar silenciosamente respuestas guardadas para `/api/nfl/games`.
- **Ganador:** EPA defensiva interpretada como EPA permitida, por lo que una defensa mejor favorece a su propio equipo. Misma corrección en el contexto del Oracle y el validador; conversión defensiva en zona roja y tercer down corregidas. Los valores ausentes no se convierten en ceros. Versión del validador determinístico: 2.
- **Variables ML:** descanso, semana corta, bye, lesiones, domo y completitud llegan desde la estructura real del contexto. Spread y total anidados se convierten en números para el sidecar.
- **Comparación del pick:** el registro shadow usa el modelo del mercado correcto, invierte la probabilidad para visitante/under y exige coincidencia exacta de la línea. Picks ambiguos o líneas diferentes quedan sin probabilidad alineada.
- **Props:** el precio de consenso utiliza exclusivamente cotizaciones en la línea elegida. La probabilidad sin margen se calcula con pares Over/Under de la misma casa y línea. Líneas, lados y precios inválidos se descartan.
- **Clima:** selección por fecha y hora UTC del kickoff, con horizonte de 16 días; fuera de cobertura queda ausente. Se verificó el contrato de fechas en la [documentación de Open-Meteo](https://open-meteo.com/en/docs).
- **Datos de entrenamiento:** valores ausentes de EPA, cuotas, QB y lesiones permanecen desconocidos en nuevas filas; no se reescriben registros históricos.

## Verificación

- 154 pruebas NFL existentes y de regresión pasaron en la suite completa; 4 pruebas adicionales verifican alineación de probabilidad por equipo, mercado y línea.
- `npm run smoke:nfl`: prueba HTTP real de la ruta local contra ESPN, sin arrancar base de datos, jobs ni llamadas LLM. Resultado: 16 partidos, temporada 2026, fase regular, semana 1, datos frescos; validación de ids, fechas, pertenencia a semana y rechazo de semana inválida.
- `npm --prefix client run build`: compila cliente y PWA.
- Sintaxis de rutas/servicios y `git diff --check` comprobados.
- La auditoría general detectó una consulta ambigua en su propia medición de cobertura (`result` sin tabla). Se corrigió para contar picks únicos y comparar solo picks resueltos con y sin variables.
- `npm run audit` después de corregirla: **0 fallos**; conserva avisos por caché Statcast vacía en el proceso independiente y variables históricas sin resultado.
- La revisión visual no pudo ejecutarse: el navegador integrado falló al iniciar con `missing field sandboxPolicy`. No se declara verificado el flujo visual ni la generación autenticada en producción. Las pruebas de persistencia utilizan una base de datos simulada.

## Qué falta para demostrar paridad predictiva con MLB

Estas correcciones verifican lógica y disponibilidad; no demuestran una tasa de acierto o rentabilidad futura. No se reentrenaron modelos, no se ejecutó un nuevo backtest y no se desplegaron los cambios.

La consulta de solo lectura al historial el 11 de septiembre encontró **2 picks NFL no eliminados: 2 pendientes, 0 ganados y 0 perdidos**. Eso describe el historial live de la aplicación, no el conjunto histórico utilizado para preentrenar el sidecar; todavía no permite medir acierto o rentabilidad live.

La aceptación predictiva requiere, por separado para ganador y cada tipo de prop:

1. Evaluación cronológica fuera de muestra, con variables disponibles antes del kickoff y cuotas históricas de la misma línea y momento.
2. Comparación contra probabilidades de mercado sin margen mediante Brier, log loss y calibración; reportar tamaño de muestra e incertidumbre.
3. ROI, CLV y tasa de abstención a precios ejecutables, separando regular, playoffs y pretemporada. No interpretar un precio de consenso como una oferta ejecutable.
4. Cobertura y frescura verificadas de titulares, inactivos, volumen de snaps/rutas/targets y lesiones. La ausencia de una lesión reportada no confirma al QB titular.
5. Supervisión en producción del calendario y del modelo de props; no presentar probabilidades de mercado como predicciones ML cuando no exista un modelo validado.

MLB ofrece una referencia funcional; la paridad estadística debe establecerse con esas mediciones, sin promesas de picks infalibles.
