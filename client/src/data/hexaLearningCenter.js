/**
 * hexaLearningCenter.js
 *
 * Static content for the "Guía H.E.X.A." / "Aprende MLB con H.E.X.A." section.
 * Pure data — no backend, no DB. Add entries freely, the UI picks them up.
 *
 * Shape:
 *   {
 *     id:        unique slug
 *     category:  'statistics' | 'strategy' | 'bankroll' | 'game-context'
 *     title:     { es, en }
 *     body:      { es, en }           — short, didactic, bettor-oriented
 *     tags:      string[]             — used by the search box
 *   }
 */

export const CATEGORIES = [
  { id: 'statistics',   es: 'Estadística',       en: 'Statistics'      },
  { id: 'strategy',     es: 'Estrategia',        en: 'Strategy'        },
  { id: 'bankroll',     es: 'Bankroll',          en: 'Bankroll'        },
  { id: 'game-context', es: 'Contexto del juego', en: 'Game Context'   },
];

export const LEARNING_ENTRIES = [
  // ── Game Context ──────────────────────────────────────────────────────────
  {
    id: 'bullpen-exhausted',
    category: 'game-context',
    title: {
      es: 'Bullpen agotado',
      en: 'Exhausted bullpen',
    },
    body: {
      es: 'Cuando un equipo usa muchos relevistas (6+) o acumula muchas entradas de bullpen el día anterior, los pitchers más confiables suelen no estar disponibles al día siguiente. Esto abre ventanas de valor en mercados de carreras totales (Over) o en la segunda mitad del juego.',
      en: 'When a team burns through 6+ relievers or piles up bullpen innings the day before, its most reliable arms are usually unavailable the next day. That opens edges in totals (Over) and second-half game markets.',
    },
    tags: ['bullpen', 'fatiga', 'relief', 'totals'],
  },
  {
    id: 'hot-cold-offense',
    category: 'game-context',
    title: {
      es: 'Racha ofensiva (hot / cold)',
      en: 'Hot / cold offense',
    },
    body: {
      es: 'Una ofensiva "caliente" anota muy por encima de su media en los últimos 3-5 juegos; una "fría" lo contrario. No predice el resultado por sí sola, pero sí ajusta la línea total esperada cuando se combina con matchups favorables de pitcheo.',
      en: 'A "hot" offense is scoring well above its seasonal average over the last 3-5 games; "cold" is the opposite. It does not forecast results on its own, but combined with favorable pitching matchups it moves expected totals.',
    },
    tags: ['ofensiva', 'offense', 'carreras', 'streak'],
  },
  {
    id: 'hot-cold-player',
    category: 'game-context',
    title: {
      es: 'Jugador caliente vs frío',
      en: 'Hot vs cold player',
    },
    body: {
      es: 'Un bateador "caliente" conecta hits en varios juegos consecutivos (3+). Un "frío" acumula juegos sin hit con al menos 2 turnos por juego. Útil para props de Over/Under hits + singles, pero siempre hay que contrastar contra el pitcher abridor y su handedness.',
      en: 'A "hot" batter has hits in 3+ consecutive games. A "cold" one has gone multiple games hitless with at least 2 at-bats each. Useful for Over/Under hits props, but always cross-check against the starter and handedness.',
    },
    tags: ['batter', 'hit streak', 'props', 'jugador'],
  },

  // ── Statistics ────────────────────────────────────────────────────────────
  {
    id: 'xera',
    category: 'statistics',
    title: {
      es: '¿Qué es xERA?',
      en: 'What is xERA?',
    },
    body: {
      es: 'xERA (Expected ERA) estima la efectividad "merecida" de un pitcher a partir de la calidad de contacto que permite (velocidad de salida y ángulo de lanzamiento), en vez de los resultados reales. Filtra la suerte y la defensa. Si ERA = 4.50 pero xERA = 3.10, suele ser señal de que mejorará.',
      en: 'xERA (Expected ERA) estimates a pitcher\'s "deserved" ERA from the quality of contact allowed (exit velocity and launch angle) rather than actual results. It filters out luck and defense. If ERA = 4.50 but xERA = 3.10, regression to the mean typically favors the pitcher.',
    },
    tags: ['xERA', 'pitcher', 'statcast'],
  },
  {
    id: 'ops',
    category: 'statistics',
    title: {
      es: '¿Qué es OPS?',
      en: 'What is OPS?',
    },
    body: {
      es: 'OPS = OBP (on-base %) + SLG (slugging %). Resume en una sola cifra la capacidad de embasarse y la de producir bases extra. Referencias MLB: .900+ élite, .800 bueno, .700 promedio, .650 débil.',
      en: 'OPS = OBP (on-base %) + SLG (slugging %). Single number that captures both getting on base and hitting for power. MLB benchmarks: .900+ elite, .800 strong, .700 average, .650 weak.',
    },
    tags: ['OPS', 'slugging', 'obp', 'batter'],
  },
  {
    id: 'whip',
    category: 'statistics',
    title: {
      es: '¿Qué es WHIP?',
      en: 'What is WHIP?',
    },
    body: {
      es: 'WHIP = (Hits + Bases por bolas) / Entradas lanzadas. Mide cuántos baserunners permite un pitcher por inning. Referencias: <1.00 dominante, 1.10 muy bueno, 1.30 promedio, 1.50+ preocupante.',
      en: 'WHIP = (Hits + Walks) / Innings pitched. Measures how many baserunners a pitcher allows per inning. Benchmarks: <1.00 dominant, 1.10 very good, 1.30 average, 1.50+ concerning.',
    },
    tags: ['WHIP', 'pitcher', 'control'],
  },

  // ── Strategy ──────────────────────────────────────────────────────────────
  {
    id: 'value-line',
    category: 'strategy',
    title: {
      es: '¿Qué es una línea de valor?',
      en: 'What is a value line?',
    },
    body: {
      es: 'Una línea tiene valor cuando la probabilidad real de que ocurra el resultado es mayor que la probabilidad implícita en el momio. Ejemplo: si el momio ofrece +150 (40% implícito) y tu modelo dice que la probabilidad real es 50%, hay valor esperado positivo (+EV).',
      en: 'A line has value when the real probability of the outcome exceeds the implied probability of the odds. Example: odds of +150 imply 40%; if your model says true probability is 50%, you have positive expected value (+EV).',
    },
    tags: ['value', 'EV', 'edge', 'probability'],
  },
  {
    id: 'kelly',
    category: 'bankroll',
    title: {
      es: '¿Qué es el criterio de Kelly?',
      en: 'What is the Kelly criterion?',
    },
    body: {
      es: 'Fórmula para dimensionar apuestas: f = (b·p − q) / b, donde b = momio decimal − 1, p = probabilidad real de ganar, q = 1 − p. Kelly completo es agresivo; la mayoría de profesionales usa Kelly fraccionario (½ o ¼) para reducir varianza.',
      en: 'Bet-sizing formula: f = (b·p − q) / b, where b = decimal odds − 1, p = true win probability, q = 1 − p. Full Kelly is aggressive; most pros use fractional Kelly (½ or ¼) to tame variance.',
    },
    tags: ['Kelly', 'bankroll', 'staking', 'size'],
  },
  {
    id: 'bankroll-tracker',
    category: 'bankroll',
    title: {
      es: 'Cómo usar el Bankroll Tracker',
      en: 'How to use the Bankroll Tracker',
    },
    body: {
      es: 'Registra cada apuesta con monto, momio y resultado. Observa tu ROI y yield a lo largo de 100+ apuestas — muestras pequeñas no dicen nada. Define un tamaño de unidad (1-2% del bankroll) y no lo subas después de una mala racha.',
      en: 'Log every bet with stake, odds and result. Track ROI and yield across 100+ bets — small samples lie. Set a unit size (1-2% of bankroll) and never increase it to "chase" after a losing streak.',
    },
    tags: ['bankroll', 'ROI', 'unit', 'tracking'],
  },
  {
    id: 'hexa-confidence',
    category: 'strategy',
    title: {
      es: 'Niveles de confianza H.E.X.A.',
      en: 'H.E.X.A. confidence levels',
    },
    body: {
      es: 'HIGH VALUE: edge >5% sobre la línea — pick prioritario. MODERATE VALUE: 2-5% — apuesta con unidad estándar. MARGINAL VALUE: 0-2% — sólo si encaja en parlay. NO VALUE: no apostar. El nivel se calcula contra el momio actual del mercado.',
      en: 'HIGH VALUE: edge >5% over the line — priority pick. MODERATE VALUE: 2-5% — standard-unit bet. MARGINAL VALUE: 0-2% — parlay filler only. NO VALUE: pass. The tier is computed against the current market odds.',
    },
    tags: ['confidence', 'value', 'tier', 'HEXA'],
  },
];

export default LEARNING_ENTRIES;
