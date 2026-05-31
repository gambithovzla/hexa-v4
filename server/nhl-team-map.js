/**
 * nhl-team-map.js — NHL team identity + arena metadata.
 *
 * Mirrors nfl-team-map.js / nba-team-map.js, with one deliberate difference:
 * the canonical key is the **abbreviation**, not the ESPN numeric id. ESPN's
 * NHL team ids are not reliably documented (and Utah/Seattle use large legacy
 * ids), so we resolve identity by abbr — which ESPN's scoreboard always
 * returns — and carry the game's numeric id through untouched. Conference /
 * division / arena are looked up by abbr.
 *
 * Hockey is played indoors, so there is no `dome`/weather dimension like the
 * NFL map — every venue is weather-neutral. `arena` is informational only.
 */

// Canonical NHL identity, keyed by ESPN abbreviation. 32 active franchises.
const TEAM_BY_ABBR = {
  ANA:  { name: 'Anaheim Ducks',          conference: 'Western', division: 'Pacific',      arena: 'Honda Center' },
  BOS:  { name: 'Boston Bruins',          conference: 'Eastern', division: 'Atlantic',     arena: 'TD Garden' },
  BUF:  { name: 'Buffalo Sabres',         conference: 'Eastern', division: 'Atlantic',     arena: 'KeyBank Center' },
  CGY:  { name: 'Calgary Flames',         conference: 'Western', division: 'Pacific',      arena: 'Scotiabank Saddledome' },
  CAR:  { name: 'Carolina Hurricanes',    conference: 'Eastern', division: 'Metropolitan', arena: 'Lenovo Center' },
  CHI:  { name: 'Chicago Blackhawks',     conference: 'Western', division: 'Central',      arena: 'United Center' },
  COL:  { name: 'Colorado Avalanche',     conference: 'Western', division: 'Central',      arena: 'Ball Arena' },
  CBJ:  { name: 'Columbus Blue Jackets',  conference: 'Eastern', division: 'Metropolitan', arena: 'Nationwide Arena' },
  DAL:  { name: 'Dallas Stars',           conference: 'Western', division: 'Central',      arena: 'American Airlines Center' },
  DET:  { name: 'Detroit Red Wings',      conference: 'Eastern', division: 'Atlantic',     arena: 'Little Caesars Arena' },
  EDM:  { name: 'Edmonton Oilers',        conference: 'Western', division: 'Pacific',      arena: 'Rogers Place' },
  FLA:  { name: 'Florida Panthers',       conference: 'Eastern', division: 'Atlantic',     arena: 'Amerant Bank Arena' },
  LA:   { name: 'Los Angeles Kings',      conference: 'Western', division: 'Pacific',      arena: 'Crypto.com Arena' },
  MIN:  { name: 'Minnesota Wild',         conference: 'Western', division: 'Central',      arena: 'Grand Casino Arena' },
  MTL:  { name: 'Montreal Canadiens',     conference: 'Eastern', division: 'Atlantic',     arena: 'Bell Centre' },
  NSH:  { name: 'Nashville Predators',    conference: 'Western', division: 'Central',      arena: 'Bridgestone Arena' },
  NJ:   { name: 'New Jersey Devils',      conference: 'Eastern', division: 'Metropolitan', arena: 'Prudential Center' },
  NYI:  { name: 'New York Islanders',     conference: 'Eastern', division: 'Metropolitan', arena: 'UBS Arena' },
  NYR:  { name: 'New York Rangers',       conference: 'Eastern', division: 'Metropolitan', arena: 'Madison Square Garden' },
  OTT:  { name: 'Ottawa Senators',        conference: 'Eastern', division: 'Atlantic',     arena: 'Canadian Tire Centre' },
  PHI:  { name: 'Philadelphia Flyers',    conference: 'Eastern', division: 'Metropolitan', arena: 'Wells Fargo Center' },
  PIT:  { name: 'Pittsburgh Penguins',    conference: 'Eastern', division: 'Metropolitan', arena: 'PPG Paints Arena' },
  SJ:   { name: 'San Jose Sharks',        conference: 'Western', division: 'Pacific',      arena: 'SAP Center' },
  SEA:  { name: 'Seattle Kraken',         conference: 'Western', division: 'Pacific',      arena: 'Climate Pledge Arena' },
  STL:  { name: 'St. Louis Blues',        conference: 'Western', division: 'Central',      arena: 'Enterprise Center' },
  TB:   { name: 'Tampa Bay Lightning',    conference: 'Eastern', division: 'Atlantic',     arena: 'Amalie Arena' },
  TOR:  { name: 'Toronto Maple Leafs',    conference: 'Eastern', division: 'Atlantic',     arena: 'Scotiabank Arena' },
  UTAH: { name: 'Utah Mammoth',           conference: 'Western', division: 'Central',      arena: 'Delta Center' },
  VAN:  { name: 'Vancouver Canucks',      conference: 'Western', division: 'Pacific',      arena: 'Rogers Arena' },
  VGK:  { name: 'Vegas Golden Knights',   conference: 'Western', division: 'Pacific',      arena: 'T-Mobile Arena' },
  WSH:  { name: 'Washington Capitals',    conference: 'Eastern', division: 'Metropolitan', arena: 'Capital One Arena' },
  WPG:  { name: 'Winnipeg Jets',          conference: 'Western', division: 'Central',      arena: 'Canada Life Centre' },
};

// Common abbreviation aliases → canonical ESPN abbr (defensive).
const ABBR_ALIASES = {
  LAK: 'LA',
  SJS: 'SJ',
  TBL: 'TB',
  NJD: 'NJ',
  WAS: 'WSH',
  MON: 'MTL',
  VEG: 'VGK',
  LV:  'VGK',
  CLS: 'CBJ',
  CLB: 'CBJ',
  // Arizona/Phoenix Coyotes relocated to Utah for 2024-25.
  ARI: 'UTAH',
  ARZ: 'UTAH',
  PHX: 'UTAH',
  UTA: 'UTAH',
};

function normalizeAbbr(abbr) {
  if (!abbr) return null;
  const up = String(abbr).trim().toUpperCase();
  return ABBR_ALIASES[up] ?? up;
}

export function isNhlAbbr(abbr) {
  const norm = normalizeAbbr(abbr);
  return !!norm && Object.prototype.hasOwnProperty.call(TEAM_BY_ABBR, norm);
}

/**
 * Resolve a canonical NHL abbreviation from a raw abbr (and/or id, unused for
 * identity but accepted for call-site symmetry with the other sports). Returns
 * the canonical abbr, or null when nothing matches.
 */
export function resolveNhlAbbr({ teamId = null, teamAbbr = null } = {}) {
  const abbr = normalizeAbbr(teamAbbr);
  if (abbr && TEAM_BY_ABBR[abbr]) return abbr;
  return null;
}

/**
 * resolveNhlTeamId — passthrough for the ESPN numeric id (identity is keyed by
 * abbr in NHL). Returns the numeric id when finite, else null. Kept so the
 * context builder / persistence call sites mirror the NFL/NBA shape.
 */
export function resolveNhlTeamId({ teamId = null, teamAbbr = null } = {}) {
  if (teamId == null) return null;
  const n = Number(teamId);
  return Number.isFinite(n) ? n : null;
}

/** Full identity + arena record for a team, by abbr (id ignored for metadata). */
export function getNhlTeam({ teamId = null, teamAbbr = null } = {}) {
  const abbr = resolveNhlAbbr({ teamId, teamAbbr });
  if (!abbr) return null;
  const id = resolveNhlTeamId({ teamId });
  return { teamId: id, abbr, ...TEAM_BY_ABBR[abbr] };
}

/**
 * Normalize team identity fields on a game object. Preserves the ESPN numeric
 * id as-is and fills canonical abbr/name/conference/division/arena from the
 * abbr lookup. Always returns a new object.
 */
export function enrichGameTeamIds(game) {
  if (!game || typeof game !== 'object') return game;

  const home = getNhlTeam({ teamId: game.home_team_id, teamAbbr: game.home_team_abbr });
  const away = getNhlTeam({ teamId: game.away_team_id, teamAbbr: game.away_team_abbr });

  return {
    ...game,
    home_team_abbr: home?.abbr ?? game.home_team_abbr ?? null,
    away_team_abbr: away?.abbr ?? game.away_team_abbr ?? null,
    home_team_name: game.home_team_name ?? home?.name ?? null,
    away_team_name: game.away_team_name ?? away?.name ?? null,
    arena: game.arena ?? home?.arena ?? null,
    team_id_mapped: !!(home && away),
  };
}

export { TEAM_BY_ABBR };
