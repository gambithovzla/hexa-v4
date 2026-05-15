import { normalizeSport } from './sports.js';

const DEFAULT_LOCKED_MSG = {
  es: 'Este modulo estara disponible para este deporte en un proximo sprint.',
  en: 'This module will be available for this sport in a future sprint.',
};

const CAPABILITY_MAP = {
  board: {
    mlb: { enabled: true },
    nba: { enabled: false, message: { es: 'La pizarra NBA estara disponible pronto.', en: 'NBA board will be available soon.' } },
  },
  history: {
    mlb: { enabled: true },
    nba: { enabled: true },
  },
  gameAnalysis: {
    mlb: { enabled: true },
    nba: { enabled: true },
  },
  standings: {
    mlb: { enabled: true },
    nba: { enabled: true },
  },
  liveTracker: {
    mlb: { enabled: true },
    nba: { enabled: true },
  },
  gameDetail: {
    mlb: { enabled: true },
    nba: { enabled: false, message: { es: 'Detalles NBA (box score + play-by-play) llegan en el proximo sprint.', en: 'NBA details (box score + play-by-play) ship in the next sprint.' } },
  },
  oracleChat: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: false, requiresAdmin: true, message: { es: 'Oracle Chat NBA queda para la siguiente fase (actualmente MLB-only).', en: 'NBA Oracle Chat is scheduled for the next phase (currently MLB-only).' } },
  },
  parlayBuilder: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: false, requiresAdmin: true, message: { es: 'Parlay en NBA aun no esta habilitado.', en: 'NBA parlay is not enabled yet.' } },
  },
  parlayArchitect: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: false, requiresAdmin: true, message: { es: 'Parlay Architect para NBA se habilitara despues del hardening.', en: 'NBA Parlay Architect will be enabled after hardening.' } },
  },
  batchScan: {
    mlb: { enabled: true, requiresAdmin: true },
    nba: { enabled: false, requiresAdmin: true, message: { es: 'Batch scan NBA llegara en una fase posterior.', en: 'NBA batch scan will arrive in a later phase.' } },
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
