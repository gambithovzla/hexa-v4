import { normalizeSport } from './sports.js';

const DEFAULT_LOCKED_MSG = {
  es: 'Este modulo estara disponible para este deporte en un proximo sprint.',
  en: 'This module will be available for this sport in a future sprint.',
};

const NFL_PARLAY_MSG = {
  es: 'Parlay/SGP NFL llega en una fase posterior. Para NFL usa Analisis de juego u Oracle Chat.',
  en: 'NFL parlay/SGP arrives in a later phase. For NFL use Game Analysis or Oracle Chat.',
};

const NHL_PARLAY_MSG = {
  es: 'Parlay/SGP NHL llega en una fase posterior. Para NHL usa Analisis de juego u Oracle Chat.',
  en: 'NHL parlay/SGP arrives in a later phase. For NHL use Game Analysis or Oracle Chat.',
};

const NHL_SOON_MSG = {
  es: 'Este modulo NHL llega en una fase posterior. Usa Analisis de juego u Oracle Chat.',
  en: 'This NHL module ships in a later phase. Use Game Analysis or Oracle Chat.',
};

const SOCCER_SOON_MSG = {
  es: 'Este modulo Soccer llega en una fase posterior. Usa Analisis de juego u Oracle Chat.',
  en: 'This Soccer module ships in a later phase. Use Game Analysis or Oracle Chat.',
};

const SOCCER_PARLAY_MSG = {
  es: 'Parlay Soccer llega en una fase posterior. Para Soccer usa Analisis de juego u Oracle Chat.',
  en: 'Soccer parlay arrives in a later phase. For Soccer use Game Analysis or Oracle Chat.',
};

const TENNIS_SOON_MSG = {
  es: 'Este modulo de Tenis llega en una fase posterior. Usa Analisis de partido u Oracle Chat.',
  en: 'This Tennis module ships in a later phase. Use Match Analysis or Oracle Chat.',
};

const TENNIS_PARLAY_MSG = {
  es: 'Parlay de Tenis llega en una fase posterior. Para Tenis usa Analisis de partido u Oracle Chat.',
  en: 'Tennis parlay arrives in a later phase. For Tennis use Match Analysis or Oracle Chat.',
};

const CAPABILITY_MAP = {
  board: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: true },
    soccer: { enabled: true },
    tennis: { enabled: false, message: TENNIS_SOON_MSG },
  },
  history: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: true },
    soccer: { enabled: true },
    tennis: { enabled: true },
  },
  gameAnalysis: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true, requiresAdmin: true },
    nhl: { enabled: true, requiresAdmin: true },
    soccer: { enabled: true, requiresAdmin: true },
    tennis: { enabled: true, requiresAdmin: true },
  },
  standings: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: false, message: { es: 'Tabla de posiciones NHL llega en una fase posterior.', en: 'NHL standings ship in a later phase.' } },
    soccer: { enabled: false, message: { es: 'Tabla de posiciones Soccer llega en una fase posterior.', en: 'Soccer standings ship in a later phase.' } },
    tennis: { enabled: false, message: { es: 'Ranking ATP/WTA llega en una fase posterior.', en: 'ATP/WTA rankings ship in a later phase.' } },
  },
  liveTracker: {
    mlb: { enabled: true },
    nba: { enabled: true },
    // Operational toggle: NFL live tracker is fully built (Sprint 9.2). Defaults
    // ENABLED; set VITE_NFL_LIVE_TRACKER_ENABLED=false to hide the tab (e.g. to
    // suppress game-time polling during a deploy or a quiet stretch).
    nfl: {
      enabled: import.meta.env.VITE_NFL_LIVE_TRACKER_ENABLED !== 'false',
      message: { es: 'Live tracker NFL deshabilitado temporalmente.', en: 'NFL live tracker is temporarily disabled.' },
    },
    nhl: { enabled: false, message: { es: 'Live tracker NHL llega en una fase posterior.', en: 'NHL live tracker ships in a later phase.' } },
    soccer: { enabled: true },
    tennis: { enabled: false, message: { es: 'Live tracker de Tenis llega en una fase posterior.', en: 'Tennis live tracker ships in a later phase.' } },
  },
  gameDetail: {
    mlb: { enabled: true },
    nba: { enabled: false, message: { es: 'Detalles NBA (box score + play-by-play) llegan en el proximo sprint.', en: 'NBA details (box score + play-by-play) ship in the next sprint.' } },
    nfl: { enabled: false, message: { es: 'Detalles NFL (drives + play-by-play) llegan en una fase posterior.', en: 'NFL details (drives + play-by-play) ship in a later phase.' } },
    nhl: { enabled: false, message: { es: 'Detalles NHL (play-by-play) llegan en una fase posterior.', en: 'NHL details (play-by-play) ship in a later phase.' } },
    soccer: { enabled: false, message: SOCCER_SOON_MSG },
    tennis: { enabled: false, message: { es: 'Detalles de Tenis (por set) llegan en una fase posterior.', en: 'Tennis details (per-set) ship in a later phase.' } },
  },
  oracleChat: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: true, requiresAdmin: true },
    nfl: { enabled: true, requiresAdmin: true },
    nhl: { enabled: true, requiresAdmin: true },
    soccer: { enabled: true, requiresAdmin: true },
    tennis: { enabled: true, requiresAdmin: true },
  },
  parlayBuilder: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: {
      enabled: false,
      requiresAdmin: true,
      message: {
        es: 'Parlay Synergy usa el pool MLB. Para NBA usa Analisis de juego o Oracle Chat.',
        en: 'Parlay Synergy uses the MLB candidate pool. For NBA use Game Analysis or Oracle Chat.',
      },
    },
    nfl: { enabled: false, requiresAdmin: true, message: NFL_PARLAY_MSG },
    nhl: { enabled: false, requiresAdmin: true, message: NHL_PARLAY_MSG },
    soccer: { enabled: false, requiresAdmin: true, message: SOCCER_PARLAY_MSG },
    tennis: { enabled: false, requiresAdmin: true, message: TENNIS_PARLAY_MSG },
  },
  parlayArchitect: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: true, requiresAdmin: true },
    nfl: { enabled: false, requiresAdmin: true, message: NFL_PARLAY_MSG },
    nhl: { enabled: false, requiresAdmin: true, message: NHL_PARLAY_MSG },
    soccer: { enabled: false, requiresAdmin: true, message: SOCCER_PARLAY_MSG },
    tennis: { enabled: false, requiresAdmin: true, message: TENNIS_PARLAY_MSG },
  },
  batchScan: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: false, requiresAdmin: true, message: { es: 'Batch scan NBA llegara en una fase posterior.', en: 'NBA batch scan will arrive in a later phase.' } },
    nfl: { enabled: false, requiresAdmin: true, message: { es: 'Batch scan NFL llegara en una fase posterior.', en: 'NFL batch scan will arrive in a later phase.' } },
    nhl: { enabled: false, requiresAdmin: true, message: NHL_SOON_MSG },
    soccer: { enabled: false, requiresAdmin: true, message: SOCCER_SOON_MSG },
    tennis: { enabled: false, requiresAdmin: true, message: TENNIS_SOON_MSG },
  },
};

export function getSportCapability(moduleKey, sport, lang = 'es') {
  const sportKey = normalizeSport(sport);
  const moduleMap = CAPABILITY_MAP[moduleKey] ?? {};
  const specific = moduleMap[sportKey];

  if (specific) {
    return {
      enabled: Boolean(specific.enabled),
      requiresAdmin: Boolean(specific.requiresAdmin),
      message: specific.message?.[lang] ?? specific.message?.en ?? DEFAULT_LOCKED_MSG[lang] ?? DEFAULT_LOCKED_MSG.en,
    };
  }

  return {
    enabled: false,
    requiresAdmin: false,
    message: DEFAULT_LOCKED_MSG[lang] ?? DEFAULT_LOCKED_MSG.en,
  };
}
