const STATS_ID_BY_ABBR = {
  ATL: 1610612737,
  BOS: 1610612738,
  BKN: 1610612751,
  BRK: 1610612751,
  CHA: 1610612766,
  CHI: 1610612741,
  CLE: 1610612739,
  DAL: 1610612742,
  DEN: 1610612743,
  DET: 1610612765,
  GSW: 1610612744,
  GS:  1610612744,
  HOU: 1610612745,
  IND: 1610612754,
  LAC: 1610612746,
  LAL: 1610612747,
  MEM: 1610612763,
  MIA: 1610612748,
  MIL: 1610612749,
  MIN: 1610612750,
  NOP: 1610612740,
  NO:  1610612740,
  NYK: 1610612752,
  NY:  1610612752,
  OKC: 1610612760,
  ORL: 1610612753,
  PHI: 1610612755,
  PHX: 1610612756,
  POR: 1610612757,
  SAC: 1610612758,
  SAS: 1610612759,
  SA:  1610612759,
  TOR: 1610612761,
  UTA: 1610612762,
  UTAH: 1610612762,
  WAS: 1610612764,
  WSH: 1610612764,
};

const ESPN_ID_TO_STATS = {
  1: 1610612737,
  2: 1610612738,
  3: 1610612751,
  4: 1610612766,
  5: 1610612741,
  6: 1610612739,
  7: 1610612742,
  8: 1610612743,
  9: 1610612765,
  10: 1610612744,
  11: 1610612745,
  12: 1610612754,
  13: 1610612746,
  14: 1610612747,
  15: 1610612763,
  16: 1610612748,
  17: 1610612749,
  18: 1610612750,
  19: 1610612740,
  20: 1610612752,
  21: 1610612760,
  22: 1610612753,
  23: 1610612755,
  24: 1610612756,
  25: 1610612757,
  26: 1610612758,
  27: 1610612759,
  28: 1610612761,
  29: 1610612762,
  30: 1610612764,
};

function normalizeAbbr(abbr) {
  if (!abbr) return null;
  return String(abbr).trim().toUpperCase();
}

export function isNbaStatsTeamId(teamId) {
  const n = Number(teamId);
  return Number.isFinite(n) && n >= 1610612730 && n <= 1610612766;
}

export function resolveNbaStatsTeamId({ teamId = null, teamAbbr = null } = {}) {
  if (isNbaStatsTeamId(teamId)) return Number(teamId);

  const abbr = normalizeAbbr(teamAbbr);
  if (abbr && STATS_ID_BY_ABBR[abbr]) return STATS_ID_BY_ABBR[abbr];

  const espnKey = teamId != null ? String(teamId) : null;
  if (espnKey && ESPN_ID_TO_STATS[espnKey]) return ESPN_ID_TO_STATS[espnKey];

  const n = Number(teamId);
  return Number.isFinite(n) ? n : null;
}

export function enrichGameTeamIds(game) {
  if (!game || typeof game !== 'object') return game;

  const homeEspn = game.espn_home_team_id ?? game.home_team_id ?? null;
  const awayEspn = game.espn_away_team_id ?? game.away_team_id ?? null;
  const homeStats = resolveNbaStatsTeamId({
    teamId: homeEspn,
    teamAbbr: game.home_team_abbr,
  });
  const awayStats = resolveNbaStatsTeamId({
    teamId: awayEspn,
    teamAbbr: game.away_team_abbr,
  });

  return {
    ...game,
    espn_home_team_id: homeEspn != null ? Number(homeEspn) : null,
    espn_away_team_id: awayEspn != null ? Number(awayEspn) : null,
    home_team_id: homeStats,
    away_team_id: awayStats,
    team_id_mapped: !!(homeStats && homeEspn && homeStats !== Number(homeEspn))
      || !!(awayStats && awayEspn && awayStats !== Number(awayEspn)),
  };
}
