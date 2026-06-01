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

const CAPABILITY_MAP = {
  board: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: true },
    soccer: { enabled: true },
  },
  history: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: true },
    soccer: { enabled: true },
  },
  gameAnalysis: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true, requiresAdmin: true },
    nhl: { enabled: true, requiresAdmin: true },
    soccer: { enabled: true, requiresAdmin: true },
  },
  standings: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: false, message: { es: 'Tabla de posiciones NHL llega en una fase posterior.', en: 'NHL standings ship in a later phase.' } },
    soccer: { enabled: false, message: { es: 'Tabla de posiciones Soccer llega en una fase posterior.', en: 'Soccer standings ship in a later phase.' } },
  },
  liveTracker: {
    mlb: { enabled: true },
    nba: { enabled: true },
    nfl: { enabled: true },
    nhl: { enabled: false, message: { es: 'Live tracker NHL llega en una fase posterior.', en: 'NHL live tracker ships in a later phase.' } },
    soccer: { enabled: true },
  },
  gameDetail: {
    mlb: { enabled: true },
    nba: { enabled: false, message: { es: 'Detalles NBA (box score + play-by-play) llegan en el proximo sprint.', en: 'NBA details (box score + play-by-play) ship in the next sprint.' } },
    nfl: { enabled: false, message: { es: 'Detalles NFL (drives + play-by-play) llegan en una fase posterior.', en: 'NFL details (drives + play-by-play) ship in a later phase.' } },
    nhl: { enabled: false, message: { es: 'Detalles NHL (play-by-play) llegan en una fase posterior.', en: 'NHL details (play-by-play) ship in a later phase.' } },
    soccer: { enabled: false, message: SOCCER_SOON_MSG },
  },
  oracleChat: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: true, requiresAdmin: true },
    nfl: { enabled: true, requiresAdmin: true },
    nhl: { enabled: true, requiresAdmin: true },
    soccer: { enabled: true, requiresAdmin: true },
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
  },
  parlayArchitect: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: true, requiresAdmin: true },
    nfl: { enabled: false, requiresAdmin: true, message: NFL_PARLAY_MSG },
    nhl: { enabled: false, requiresAdmin: true, message: NHL_PARLAY_MSG },
    soccer: { enabled: false, requiresAdmin: true, message: SOCCER_PARLAY_MSG },
  },
  batchScan: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: false, requiresAdmin: true, message: { es: 'Batch scan NBA llegara en una fase posterior.', en: 'NBA batch scan will arrive in a later phase.' } },
    nfl: { enabled: false, requiresAdmin: true, message: { es: 'Batch scan NFL llegara en una fase posterior.', en: 'NFL batch scan will arrive in a later phase.' } },
    nhl: { enabled: false, requiresAdmin: true, message: NHL_SOON_MSG },
    soccer: { enabled: false, requiresAdmin: true, message: SOCCER_SOON_MSG },
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
