/**
 * nba-api.js — NBA Stats API wrapper with in-memory cache.
 *
 * Base URL: https://stats.nba.com/stats/
 * No API key required, but headers are mandatory (403 without them).
 *
 * Cache TTLs:
 *   - Team stats (season-level):  6 hours
 *   - Daily game schedule:        5 minutes
 *   - Team recent games:          10 minutes
 */

const NBA_BASE = 'https://stats.nba.com/stats';
const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Accept': 'application/json, text/plain, */*',
};

const CURRENT_SEASON = '2025-26';

// ── In-memory cache ───────────────────────────────────────────────────────────

const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const TTL = {
  TEAM_STATS: 6 * 60 * 60 * 1000,   // 6h
  DAILY_GAMES: 5 * 60 * 1000,        // 5min
  RECENT_GAMES: 10 * 60 * 1000,      // 10min
  STANDINGS: 15 * 60 * 1000,         // 15min
};

// ── NBA API response parser ───────────────────────────────────────────────────

/**
 * NBA Stats API returns: { resultSets: [{ name, headers, rowSet }] }
 * This helper converts a resultSet into an array of plain objects.
 */
function parseResultSet(resultSet) {
  const { headers, rowSet } = resultSet;
  return rowSet.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i]]))
  );
}

async function nbaFetch(endpoint, params = {}) {
  const url = new URL(`${NBA_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { headers: NBA_HEADERS });
  if (!res.ok) {
    throw new Error(`[nba-api] ${endpoint} → HTTP ${res.status}`);
  }
  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * getNbaGamesForDate(dateStr)
 *   dateStr: 'YYYY-MM-DD'
 *   Returns array of game objects for that calendar date.
 */
export async function getNbaGamesForDate(dateStr) {
  const cacheKey = `games:${dateStr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await nbaFetch('scoreboardv2', {
    GameDate: dateStr,
    LeagueID: '00',
    DayOffset: '0',
  });

  const gameHeader = data.resultSets?.find(rs => rs.name === 'GameHeader');
  const lineScore = data.resultSets?.find(rs => rs.name === 'LineScore');

  if (!gameHeader) {
    console.warn(`[nba-api] No GameHeader resultSet for ${dateStr}`);
    return [];
  }

  const games = parseResultSet(gameHeader);
  const scores = lineScore ? parseResultSet(lineScore) : [];

  // Merge home/away scores into each game row
  const scoresByGameId = {};
  for (const s of scores) {
    if (!scoresByGameId[s.GAME_ID]) scoresByGameId[s.GAME_ID] = [];
    scoresByGameId[s.GAME_ID].push(s);
  }

  const result = games.map(g => {
    const [home, away] = (scoresByGameId[g.GAME_ID] || []).sort(
      (a, b) => (a.TEAM_ID === g.HOME_TEAM_ID ? -1 : 1)
    );
    return {
      game_id: g.GAME_ID,
      game_date: dateStr,
      status: g.GAME_STATUS_TEXT,
      game_status_id: g.GAME_STATUS_ID ?? null,
      home_team_id: g.HOME_TEAM_ID,
      home_team_abbr: home?.TEAM_ABBREVIATION ?? null,
      home_team_name: home?.TEAM_CITY_NAME
        ? `${home.TEAM_CITY_NAME} ${home.TEAM_NAME}`
        : null,
      home_score: home?.PTS ?? null,
      away_team_id: g.VISITOR_TEAM_ID,
      away_team_abbr: away?.TEAM_ABBREVIATION ?? null,
      away_team_name: away?.TEAM_CITY_NAME
        ? `${away.TEAM_CITY_NAME} ${away.TEAM_NAME}`
        : null,
      away_score: away?.PTS ?? null,
      arena: g.ARENA_NAME ?? null,
      national_tv: g.NATL_TV_BROADCASTER_ABBREVIATION ?? null,
      season: CURRENT_SEASON,
    };
  });

  cacheSet(cacheKey, result, TTL.DAILY_GAMES);
  console.log(`[nba-api] scoreboardv2 ${dateStr}: ${result.length} games`);
  return result;
}

/**
 * getNbaLeagueTeamStats(season)
 *   season: e.g. '2025-26' (defaults to current)
 *   Returns array of team efficiency stats for the season.
 */
export async function getNbaLeagueTeamStats(season = CURRENT_SEASON) {
  const cacheKey = `team_stats:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await nbaFetch('leaguedashteamstats', {
    Season: season,
    SeasonType: 'Regular Season',
    PerMode: 'PerGame',
    MeasureType: 'Advanced',
    LeagueID: '00',
    PORound: '0',
    PaceAdjust: 'N',
    PlusMinus: 'N',
    Rank: 'N',
    Outcome: '',
    Location: '',
    Month: '0',
    SeasonSegment: '',
    DateFrom: '',
    DateTo: '',
    OpponentTeamID: '0',
    VsConference: '',
    VsDivision: '',
    GameScope: '',
    PlayerExperience: '',
    PlayerPosition: '',
    StarterBench: '',
    DraftYear: '',
    DraftPick: '',
    College: '',
    Country: '',
    Height: '',
    Weight: '',
    TwoWay: '0',
    LastNGames: '0',
    GameSegment: '',
    Period: '0',
    ShotClockRange: '',
  });

  const rs = data.resultSets?.find(r => r.name === 'LeagueDashTeamStats');
  if (!rs) {
    console.warn('[nba-api] No LeagueDashTeamStats resultSet');
    return [];
  }

  const rows = parseResultSet(rs);
  const result = rows.map(r => ({
    team_id: r.TEAM_ID,
    team_abbr: r.TEAM_ABBREVIATION,
    team_name: r.TEAM_NAME,
    season,
    wins: r.W ?? null,
    losses: r.L ?? null,
    off_rating: r.OFF_RATING ?? null,
    def_rating: r.DEF_RATING ?? null,
    net_rating: r.NET_RATING ?? null,
    pace: r.PACE ?? null,
    ts_pct: r.TS_PCT ?? null,
    reb_pct: r.REB_PCT ?? null,
    ast_pct: r.AST_PCT ?? null,
  }));

  cacheSet(cacheKey, result, TTL.TEAM_STATS);
  console.log(`[nba-api] leaguedashteamstats ${season}: ${result.length} teams`);
  return result;
}

let _gameLogHeadersLogged = false;

async function fetchTeamGameLog(teamId, season, seasonType) {
  try {
    const data = await nbaFetch('teamgamelog', {
      TeamID: String(teamId),
      Season: season,
      SeasonType: seasonType,
      LeagueID: '00',
    });
    const rs = data.resultSets?.find(r => r.name === 'TeamGameLog');
    if (!rs) return [];
    if (!_gameLogHeadersLogged) {
      console.log(`[nba-api] teamgamelog headers: ${rs.headers.join(', ')}`);
      _gameLogHeadersLogged = true;
    }
    return parseResultSet(rs);
  } catch (err) {
    // SeasonType not yet active (e.g. Playoffs in October) returns 4xx — silent.
    console.warn(`[nba-api] teamgamelog ${seasonType} for ${teamId}: ${err.message}`);
    return [];
  }
}

/**
 * Normalise one teamgamelog row.
 *
 * NBA's teamgamelog uses `PLUS_MINUS` in most versions and `+/-` in some.
 * Falls back to a key scan so new response shapes don't silently zero out.
 */
function normalisePlusMinus(r) {
  if (r.PLUS_MINUS != null) return r.PLUS_MINUS;
  if (r['+/-'] != null) return r['+/-'];
  const key = Object.keys(r).find(k => /plus.?minus/i.test(k) || k === '+/-');
  return key != null ? (r[key] ?? null) : null;
}

function normaliseTeamGameLogRow(r) {
  const plusMinus = normalisePlusMinus(r);
  return {
    game_id: r.Game_ID,
    game_date: r.GAME_DATE,
    matchup: r.MATCHUP,
    wl: r.WL,
    pts: r.PTS ?? null,
    opp_pts: plusMinus != null && r.PTS != null ? r.PTS - plusMinus : null,
    fg_pct: r.FG_PCT ?? null,
    ft_pct: r.FT_PCT ?? null,
    fg3_pct: r.FG3_PCT ?? null,
    ast: r.AST ?? null,
    reb: r.REB ?? null,
    tov: r.TOV ?? null,
    plus_minus: plusMinus,
  };
}

/**
 * getNbaTeamRecentGames(teamId, season, lastN)
 *   Returns the last N games for a team in the given season.
 *
 * Pulls both 'Regular Season' and 'Playoffs' logs and merges them sorted
 * by date descending — during May/June playoffs, the most recent games
 * are postseason and the regular-season-only fetch is stale.
 */
export async function getNbaTeamRecentGames(teamId, season = CURRENT_SEASON, lastN = 10) {
  const cacheKey = `recent:${teamId}:${season}:${lastN}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [regular, playoffs] = await Promise.all([
    fetchTeamGameLog(teamId, season, 'Regular Season'),
    fetchTeamGameLog(teamId, season, 'Playoffs'),
  ]);

  const merged = [...playoffs, ...regular]
    .map(normaliseTeamGameLogRow)
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
    .slice(0, lastN);

  cacheSet(cacheKey, merged, TTL.RECENT_GAMES);
  return merged;
}

// ── Standings ────────────────────────────────────────────────────────────────

const CONFERENCE_LABEL = {
  East: { en: 'Eastern Conference', es: 'Conferencia Este' },
  West: { en: 'Western Conference', es: 'Conferencia Oeste' },
};

function parsePlayoffRank(r) {
  const v = r.PlayoffRank ?? r.ConferenceRank ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normaliseStandingsRow(r) {
  const wins = Number(r.WINS ?? 0);
  const losses = Number(r.LOSSES ?? 0);
  const total = wins + losses;
  const pct = total > 0 ? wins / total : 0;
  return {
    teamId:        r.TeamID,
    abbreviation:  r.TeamAbbreviation ?? null,
    name:          r.TeamName ?? null,
    fullName:      r.TeamCity && r.TeamName ? `${r.TeamCity} ${r.TeamName}` : (r.TeamName ?? null),
    conference:    r.Conference ?? null,
    division:      r.Division ?? null,
    wins,
    losses,
    pct:           pct.toFixed(3).replace(/^0/, ''),
    pctRaw:        pct,
    gamesBack:     r.ConferenceGamesBack ?? r.GamesBack ?? null,
    home:          r.HOME ?? null,
    road:          r.ROAD ?? null,
    last10:        r.L10 ?? null,
    streak:        r.strCurrentStreak ?? r.CurrentStreak ?? null,
    pointsPg:      r.PointsPG ?? null,
    oppPointsPg:   r.OppPointsPG ?? null,
    diff:          r.DiffPointsPG ?? null,
    confRecord:    r.ConferenceRecord ?? null,
    divRecord:     r.DivisionRecord ?? null,
    conferenceRank: parsePlayoffRank(r),
  };
}

export async function getNbaStandings(season = CURRENT_SEASON) {
  const cacheKey = `standings:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await nbaFetch('leaguestandingsv3', {
    LeagueID:   '00',
    Season:     season,
    SeasonType: 'Regular Season',
  });

  const rs = data.resultSets?.find(r => r.name === 'Standings');
  if (!rs) {
    console.warn('[nba-api] No Standings resultSet');
    return { season, updatedAt: new Date().toISOString(), conferences: [] };
  }

  const rows = parseResultSet(rs).map(normaliseStandingsRow);
  const byConf = { East: [], West: [] };
  for (const t of rows) {
    const key = t.conference === 'East' || t.conference === 'West' ? t.conference : null;
    if (key) byConf[key].push(t);
  }

  for (const k of Object.keys(byConf)) {
    byConf[k].sort((a, b) => {
      if (a.conferenceRank != null && b.conferenceRank != null) return a.conferenceRank - b.conferenceRank;
      return (b.pctRaw - a.pctRaw) || (b.wins - a.wins);
    });
  }

  const result = {
    season,
    updatedAt: new Date().toISOString(),
    conferences: ['East', 'West'].map(key => ({
      key,
      name: CONFERENCE_LABEL[key],
      teams: byConf[key],
    })),
  };

  cacheSet(cacheKey, result, TTL.STANDINGS);
  console.log(`[nba-api] leaguestandingsv3 ${season}: East ${byConf.East.length}, West ${byConf.West.length}`);
  return result;
}
