/**
 * nfl-team-map.js — NFL team identity + stadium metadata.
 *
 * Mirrors nba-team-map.js, but ESPN is the *canonical* ID source for NFL
 * (there is no second provider like stats.nba.com to reconcile against), so
 * the map is simpler: ESPN team_id (1–34, with historical gaps) ↔ abbreviation
 * ↔ display name, plus conference/division and stadium coords + `dome` flag.
 *
 * The stadium coords feed the weather integration (Open-Meteo). `dome=true`
 * means weather-neutral (fixed or retractable-typically-closed roof) — the
 * Oracle ignores wind/cold for those venues.
 */

// ESPN NFL team_id → identity + venue.
// surface: 'turf' (artificial) | 'grass'. Turf teams run faster and score more;
//   visiting grass teams on turf may underperform their stats (speed adjustment).
// altitude: feet above sea level. Denver (5280ft) gives a ~0.5-1 pt advantage
//   per game to the home team due to thinner air (kicking range, stamina).
const TEAM_BY_ID = {
  1:  { abbr: 'ATL', name: 'Atlanta Falcons',        conference: 'NFC', division: 'South', stadium: 'Mercedes-Benz Stadium',      dome: true,  surface: 'turf',  altitude: 1050, lat: 33.7554, lon: -84.4008 },
  2:  { abbr: 'BUF', name: 'Buffalo Bills',          conference: 'AFC', division: 'East',  stadium: 'Highmark Stadium',           dome: false, surface: 'turf',  altitude: 600,  lat: 42.7738, lon: -78.7870 },
  3:  { abbr: 'CHI', name: 'Chicago Bears',          conference: 'NFC', division: 'North', stadium: 'Soldier Field',              dome: false, surface: 'grass', altitude: 580,  lat: 41.8623, lon: -87.6167 },
  4:  { abbr: 'CIN', name: 'Cincinnati Bengals',     conference: 'AFC', division: 'North', stadium: 'Paycor Stadium',             dome: false, surface: 'turf',  altitude: 489,  lat: 39.0954, lon: -84.5160 },
  5:  { abbr: 'CLE', name: 'Cleveland Browns',       conference: 'AFC', division: 'North', stadium: 'Huntington Bank Field',      dome: false, surface: 'grass', altitude: 653,  lat: 41.5061, lon: -81.6995 },
  6:  { abbr: 'DAL', name: 'Dallas Cowboys',         conference: 'NFC', division: 'East',  stadium: 'AT&T Stadium',               dome: true,  surface: 'turf',  altitude: 650,  lat: 32.7473, lon: -97.0945 },
  7:  { abbr: 'DEN', name: 'Denver Broncos',         conference: 'AFC', division: 'West',  stadium: 'Empower Field at Mile High', dome: false, surface: 'grass', altitude: 5280, lat: 39.7439, lon: -105.0201 },
  8:  { abbr: 'DET', name: 'Detroit Lions',          conference: 'NFC', division: 'North', stadium: 'Ford Field',                 dome: true,  surface: 'turf',  altitude: 600,  lat: 42.3400, lon: -83.0456 },
  9:  { abbr: 'GB',  name: 'Green Bay Packers',      conference: 'NFC', division: 'North', stadium: 'Lambeau Field',              dome: false, surface: 'grass', altitude: 739,  lat: 44.5013, lon: -88.0622 },
  10: { abbr: 'TEN', name: 'Tennessee Titans',       conference: 'AFC', division: 'South', stadium: 'Nissan Stadium',             dome: false, surface: 'turf',  altitude: 440,  lat: 36.1665, lon: -86.7713 },
  11: { abbr: 'IND', name: 'Indianapolis Colts',     conference: 'AFC', division: 'South', stadium: 'Lucas Oil Stadium',          dome: true,  surface: 'turf',  altitude: 715,  lat: 39.7601, lon: -86.1639 },
  12: { abbr: 'KC',  name: 'Kansas City Chiefs',     conference: 'AFC', division: 'West',  stadium: 'GEHA Field at Arrowhead',    dome: false, surface: 'grass', altitude: 1100, lat: 39.0489, lon: -94.4839 },
  13: { abbr: 'LV',  name: 'Las Vegas Raiders',      conference: 'AFC', division: 'West',  stadium: 'Allegiant Stadium',          dome: true,  surface: 'turf',  altitude: 2030, lat: 36.0909, lon: -115.1833 },
  14: { abbr: 'LAR', name: 'Los Angeles Rams',       conference: 'NFC', division: 'West',  stadium: 'SoFi Stadium',               dome: true,  surface: 'turf',  altitude: 100,  lat: 33.9535, lon: -118.3392 },
  15: { abbr: 'MIA', name: 'Miami Dolphins',         conference: 'AFC', division: 'East',  stadium: 'Hard Rock Stadium',          dome: false, surface: 'grass', altitude: 10,   lat: 25.9580, lon: -80.2389 },
  16: { abbr: 'MIN', name: 'Minnesota Vikings',      conference: 'NFC', division: 'North', stadium: 'U.S. Bank Stadium',          dome: true,  surface: 'turf',  altitude: 830,  lat: 44.9737, lon: -93.2575 },
  17: { abbr: 'NE',  name: 'New England Patriots',   conference: 'AFC', division: 'East',  stadium: 'Gillette Stadium',           dome: false, surface: 'turf',  altitude: 22,   lat: 42.0909, lon: -71.2643 },
  18: { abbr: 'NO',  name: 'New Orleans Saints',     conference: 'NFC', division: 'South', stadium: 'Caesars Superdome',          dome: true,  surface: 'turf',  altitude: 6,    lat: 29.9511, lon: -90.0812 },
  19: { abbr: 'NYG', name: 'New York Giants',        conference: 'NFC', division: 'East',  stadium: 'MetLife Stadium',            dome: false, surface: 'turf',  altitude: 10,   lat: 40.8135, lon: -74.0745 },
  20: { abbr: 'NYJ', name: 'New York Jets',          conference: 'AFC', division: 'East',  stadium: 'MetLife Stadium',            dome: false, surface: 'turf',  altitude: 10,   lat: 40.8135, lon: -74.0745 },
  21: { abbr: 'PHI', name: 'Philadelphia Eagles',    conference: 'NFC', division: 'East',  stadium: 'Lincoln Financial Field',    dome: false, surface: 'grass', altitude: 20,   lat: 39.9008, lon: -75.1675 },
  22: { abbr: 'ARI', name: 'Arizona Cardinals',      conference: 'NFC', division: 'West',  stadium: 'State Farm Stadium',         dome: true,  surface: 'turf',  altitude: 1082, lat: 33.5276, lon: -112.2626 },
  23: { abbr: 'PIT', name: 'Pittsburgh Steelers',    conference: 'AFC', division: 'North', stadium: 'Acrisure Stadium',           dome: false, surface: 'grass', altitude: 730,  lat: 40.4468, lon: -80.0158 },
  24: { abbr: 'LAC', name: 'Los Angeles Chargers',   conference: 'AFC', division: 'West',  stadium: 'SoFi Stadium',               dome: true,  surface: 'turf',  altitude: 100,  lat: 33.9535, lon: -118.3392 },
  25: { abbr: 'SF',  name: 'San Francisco 49ers',    conference: 'NFC', division: 'West',  stadium: "Levi's Stadium",             dome: false, surface: 'grass', altitude: 40,   lat: 37.4030, lon: -121.9697 },
  26: { abbr: 'SEA', name: 'Seattle Seahawks',       conference: 'NFC', division: 'West',  stadium: 'Lumen Field',                dome: false, surface: 'turf',  altitude: 22,   lat: 47.5952, lon: -122.3316 },
  27: { abbr: 'TB',  name: 'Tampa Bay Buccaneers',   conference: 'NFC', division: 'South', stadium: 'Raymond James Stadium',      dome: false, surface: 'grass', altitude: 10,   lat: 27.9759, lon: -82.5033 },
  28: { abbr: 'WSH', name: 'Washington Commanders',  conference: 'NFC', division: 'East',  stadium: 'Northwest Stadium',          dome: false, surface: 'grass', altitude: 60,   lat: 38.9078, lon: -76.8645 },
  29: { abbr: 'CAR', name: 'Carolina Panthers',      conference: 'NFC', division: 'South', stadium: 'Bank of America Stadium',    dome: false, surface: 'grass', altitude: 746,  lat: 35.2258, lon: -80.8528 },
  30: { abbr: 'JAX', name: 'Jacksonville Jaguars',   conference: 'AFC', division: 'South', stadium: 'EverBank Stadium',           dome: false, surface: 'grass', altitude: 16,   lat: 30.3239, lon: -81.6373 },
  33: { abbr: 'BAL', name: 'Baltimore Ravens',       conference: 'AFC', division: 'North', stadium: 'M&T Bank Stadium',           dome: false, surface: 'grass', altitude: 154,  lat: 39.2780, lon: -76.6227 },
  34: { abbr: 'HOU', name: 'Houston Texans',         conference: 'AFC', division: 'South', stadium: 'NRG Stadium',                dome: true,  surface: 'turf',  altitude: 43,   lat: 29.6847, lon: -95.4107 },
};

// Common abbreviation aliases → canonical ESPN abbr (defensive, like NBA's GS/GSW).
const ABBR_ALIASES = {
  JAC: 'JAX',
  WAS: 'WSH',
  LA:  'LAR',
  SD:  'LAC',
  OAK: 'LV',
  STL: 'LAR',
};

const ID_BY_ABBR = {};
for (const [id, t] of Object.entries(TEAM_BY_ID)) {
  ID_BY_ABBR[t.abbr] = Number(id);
}

function normalizeAbbr(abbr) {
  if (!abbr) return null;
  const up = String(abbr).trim().toUpperCase();
  return ABBR_ALIASES[up] ?? up;
}

export function isNflTeamId(teamId) {
  const n = Number(teamId);
  return Number.isFinite(n) && Object.prototype.hasOwnProperty.call(TEAM_BY_ID, n);
}

/**
 * Resolve a canonical ESPN team id from a raw id and/or abbreviation.
 * Returns the numeric ESPN id, or null when nothing matches.
 */
export function resolveNflTeamId({ teamId = null, teamAbbr = null } = {}) {
  if (isNflTeamId(teamId)) return Number(teamId);

  const abbr = normalizeAbbr(teamAbbr);
  if (abbr && ID_BY_ABBR[abbr]) return ID_BY_ABBR[abbr];

  const n = Number(teamId);
  return Number.isFinite(n) ? n : null;
}

/** Full identity + venue record for a team, by id or abbr. Null if unknown. */
export function getNflTeam({ teamId = null, teamAbbr = null } = {}) {
  const id = resolveNflTeamId({ teamId, teamAbbr });
  if (id != null && TEAM_BY_ID[id]) return { teamId: id, ...TEAM_BY_ID[id] };
  const abbr = normalizeAbbr(teamAbbr);
  if (abbr && ID_BY_ABBR[abbr]) {
    const rid = ID_BY_ABBR[abbr];
    return { teamId: rid, ...TEAM_BY_ID[rid] };
  }
  return null;
}

/** Stadium coords + venue attributes for the *home* team of a game. Null if unknown. */
export function getNflStadium({ teamId = null, teamAbbr = null } = {}) {
  const team = getNflTeam({ teamId, teamAbbr });
  if (!team) return null;
  return {
    stadium: team.stadium,
    dome: team.dome,
    surface: team.surface ?? null,
    altitude: team.altitude ?? null,
    lat: team.lat,
    lon: team.lon,
  };
}

/**
 * Normalize team identity fields on a game object. Unlike NBA there is no
 * second ID system, so this mostly fills in canonical abbr/name and a
 * `*_is_dome` hint for the home venue. Always returns a new object.
 */
export function enrichGameTeamIds(game) {
  if (!game || typeof game !== 'object') return game;

  const homeId = resolveNflTeamId({ teamId: game.home_team_id, teamAbbr: game.home_team_abbr });
  const awayId = resolveNflTeamId({ teamId: game.away_team_id, teamAbbr: game.away_team_abbr });
  const homeTeam = homeId != null ? TEAM_BY_ID[homeId] : null;
  const awayTeam = awayId != null ? TEAM_BY_ID[awayId] : null;

  return {
    ...game,
    home_team_id: homeId,
    away_team_id: awayId,
    home_team_abbr: game.home_team_abbr ?? homeTeam?.abbr ?? null,
    away_team_abbr: game.away_team_abbr ?? awayTeam?.abbr ?? null,
    home_team_name: game.home_team_name ?? homeTeam?.name ?? null,
    away_team_name: game.away_team_name ?? awayTeam?.name ?? null,
    stadium: game.stadium ?? homeTeam?.stadium ?? null,
    dome: game.dome ?? homeTeam?.dome ?? null,
    team_id_mapped: !!(homeTeam && awayTeam),
  };
}

export { TEAM_BY_ID, ID_BY_ABBR };
