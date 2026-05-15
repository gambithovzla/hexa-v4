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
  if (Date.now() > entry.expiresAt) return null;
  return entry.data;
}

// Returns whatever was last cached for `key`, even if its TTL expired.
// Used as a graceful fallback when stats.nba.com is unreachable.
function cacheGetStale(key) {
  return _cache.get(key)?.data ?? null;
}

function cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const TTL = {
  TEAM_STATS: 6 * 60 * 60 * 1000,   // 6h
  DAILY_GAMES: 5 * 60 * 1000,        // 5min — schedule/final games
  DAILY_GAMES_LIVE: 30 * 1000,       // 30s — when any game is in progress
  RECENT_GAMES: 10 * 60 * 1000,      // 10min
  STANDINGS: 15 * 60 * 1000,         // 15min
  PLAYOFF_LIVE: 10 * 60 * 1000,      // 10min — live playoff bracket
};

// ── ESPN Playoff bracket ──────────────────────────────────────────────────────
// stats.nba.com blocks Railway datacenter IPs; ESPN's site API does not.
// We fetch all postseason scoreboard events and aggregate series records.

const ESPN_SCOREBOARD_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const ESPN_STANDINGS_BASE  = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';

function seasonStartYear(season) {
  const n = Number.parseInt(String(season).split('-')[0], 10);
  return Number.isFinite(n) ? n : new Date().getFullYear();
}

function parsePlayoffNote(headline) {
  if (!headline) return { conference: null, round: null };
  const hl = headline.toLowerCase();
  const conference = hl.startsWith('east') ? 'East' : hl.startsWith('west') ? 'West' : null;
  let round = null;
  if      (hl.includes('1st round') || hl.includes('first round')) round = 'first_round';
  else if (hl.includes('conf') && hl.includes('final'))            round = 'conf_finals';
  else if (hl.includes('semifinal') || hl.includes('second round')) round = 'conf_semis';
  else if (hl.includes('final'))                                    round = 'finals';
  return { conference, round };
}

async function fetchEspnPlayoffEvents(season) {
  const endYear   = 2000 + parseInt(season.split('-')[1], 10); // '2025-26' → 2026
  const startDate = `${endYear}0410`;
  const endDate   = `${endYear}0701`;
  const url       = `${ESPN_SCOREBOARD_BASE}?seasontype=3&dates=${startDate}-${endDate}&limit=500`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.events ?? [];
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'timeout after 10s' : err.message;
    throw new Error(`[nba-api] espn playoff events → ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEspnScoreboardByDate(dateStr, { seasonType } = {}) {
  const dateCompact = String(dateStr).replaceAll('-', '');
  const params = new URLSearchParams({ dates: dateCompact });
  if (seasonType) params.set('seasontype', String(seasonType));
  const url = `${ESPN_SCOREBOARD_BASE}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.events ?? [];
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'timeout after 8s' : err.message;
    throw new Error(`[nba-api] espn scoreboard ${dateStr} → ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

function mapEspnStatusType(type = {}) {
  const state = String(type.state ?? '').toLowerCase();
  const name = String(type.name ?? '').toLowerCase();
  const detail = String(type.detail ?? type.shortDetail ?? '').toLowerCase();
  if (state === 'post' || name.includes('final') || detail.includes('final')) {
    return { game_status_id: 3, status: type.shortDetail ?? type.detail ?? type.description ?? 'Final' };
  }
  if (
    state === 'in' ||
    name.includes('in progress') ||
    detail.includes('qtr') ||
    detail.includes('quarter') ||
    detail.includes('halftime') ||
    detail.includes('ot')
  ) {
    return { game_status_id: 2, status: type.shortDetail ?? type.detail ?? type.description ?? 'In Progress' };
  }
  return { game_status_id: 1, status: type.shortDetail ?? type.detail ?? type.description ?? 'Scheduled' };
}

function normalizeEspnScoreboardEvent(event, dateStr) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  if (!home?.team || !away?.team) return null;
  const mappedStatus = mapEspnStatusType(event.status?.type ?? {});
  const parseScore = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);
  const nationalTv = comp.broadcasts?.[0]?.names?.[0] ?? comp.geoBroadcasts?.[0]?.media?.shortName ?? null;
  const safeDate = event.date ? String(event.date).slice(0, 10) : dateStr;
  return {
    game_id: event.id ?? comp.id,
    game_date: safeDate,
    status: mappedStatus.status,
    game_status_id: mappedStatus.game_status_id,
    live_period: event.status?.period ?? null,
    live_clock: event.status?.displayClock ?? null,
    home_team_id: Number(home.team.id),
    home_team_abbr: home.team.abbreviation ?? null,
    home_team_name: home.team.displayName ?? null,
    home_score: homeScore,
    home_qtrs: [],
    home_fg_pct: null,
    home_ft_pct: null,
    home_fg3_pct: null,
    home_ast: null,
    home_reb: null,
    home_tov: null,
    away_team_id: Number(away.team.id),
    away_team_abbr: away.team.abbreviation ?? null,
    away_team_name: away.team.displayName ?? null,
    away_score: awayScore,
    away_qtrs: [],
    away_fg_pct: null,
    away_ft_pct: null,
    away_fg3_pct: null,
    away_ast: null,
    away_reb: null,
    away_tov: null,
    arena: comp.venue?.fullName ?? null,
    national_tv: nationalTv,
    season: CURRENT_SEASON,
  };
}

async function fetchEspnGamesForDate(dateStr) {
  const [postseasonEvents, regularEvents] = await Promise.all([
    fetchEspnScoreboardByDate(dateStr, { seasonType: 3 }),
    fetchEspnScoreboardByDate(dateStr).catch(() => []),
  ]);
  const events = postseasonEvents.length > 0 ? postseasonEvents : regularEvents;
  return events
    .map(ev => normalizeEspnScoreboardEvent(ev, dateStr))
    .filter(Boolean);
}

function buildLiveBracketFromEvents(events, season) {
  const seriesMap = new Map();

  for (const ev of events) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const note = comp.notes?.[0]?.headline ?? '';
    const { conference, round } = parsePlayoffNote(note);
    if (!round) continue;

    const sorted    = [...comp.competitors].sort((a, b) => String(a.team.id).localeCompare(String(b.team.id)));
    const key       = sorted.map(c => c.team.id).join('_');
    const seriesComps = comp.series?.competitors ?? [];
    const isGame1   = /game 1$/i.test(note);

    const makeTeam = c => ({
      espnId:       String(c.team.id),
      abbreviation: c.team.abbreviation,
      name:         c.team.shortDisplayName || c.team.name || c.team.abbreviation,
      fullName:     c.team.displayName,
      homeAway:     c.homeAway,
      seriesWins:   Number(seriesComps.find(sc => String(sc.id) === String(c.team.id))?.wins ?? 0),
    });

    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
        date: ev.date, conference, round, note,
        summary: comp.series?.summary ?? '',
        completed: comp.series?.completed ?? false,
        bestOf: comp.series?.totalCompetitions ?? 7,
        teams: comp.competitors.map(makeTeam),
        homeIdGame1: null,
      });
    }

    const entry = seriesMap.get(key);
    if (ev.date >= entry.date) {
      entry.date      = ev.date;
      entry.summary   = comp.series?.summary ?? '';
      entry.completed = comp.series?.completed ?? false;
      entry.teams     = comp.competitors.map(makeTeam);
    }
    if (isGame1) {
      entry.homeIdGame1 = String(comp.competitors.find(c => c.homeAway === 'home')?.team.id ?? '');
    }
  }

  const entryToMatchup = (entry, idx) => {
    const homeId = entry.homeIdGame1;
    const [top, bottom] = homeId
      ? [entry.teams.find(t => t.espnId === homeId), entry.teams.find(t => t.espnId !== homeId)]
      : entry.teams;
    const safeTop    = top    ?? entry.teams[0];
    const safeBottom = bottom ?? entry.teams[1];
    const winnerTeam = entry.completed
      ? (safeTop.seriesWins > safeBottom.seriesWins ? safeTop : safeBottom)
      : null;

    const toShape = t => t ? {
      seed: null,
      teamId: `espn:${t.espnId}`,
      abbreviation: t.abbreviation,
      name: t.name,
      fullName: t.fullName,
      wins: null,
      losses: null,
      seriesWins: t.seriesWins,
    } : null;

    return {
      id:        `${entry.conference ?? 'NBA'}-${entry.round}-${idx}`,
      label:     entry.note.replace(/\s*[-–]\s*Game\s*\d+$/i, ''),
      round:     entry.round,
      bestOf:    entry.bestOf,
      top:       toShape(safeTop),
      bottom:    toShape(safeBottom),
      winner:    winnerTeam ? (winnerTeam.espnId === safeTop?.espnId ? 'top' : 'bottom') : null,
      series:    `${safeTop?.seriesWins ?? 0}-${safeBottom?.seriesWins ?? 0}`,
      summary:   entry.summary,
      completed: entry.completed,
    };
  };

  const ROUND_NAMES = {
    first_round: { en: 'First Round',       es: 'Primera Ronda'       },
    conf_semis:  { en: 'Conference Semis',  es: 'Semifinales Conf.'   },
    conf_finals: { en: 'Conference Finals', es: 'Finales Conf.'        },
  };

  const buildLiveConf = confKey => {
    const entries = [...seriesMap.values()]
      .filter(s => s.conference === confKey)
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      key:  confKey,
      name: CONFERENCE_LABEL[confKey],
      playIn: [],
      rounds: ['first_round', 'conf_semis', 'conf_finals'].map(rk => ({
        key:      rk,
        name:     ROUND_NAMES[rk],
        matchups: entries.filter(s => s.round === rk).map((s, i) => entryToMatchup(s, i)),
      })),
    };
  };

  const finalsEntries = [...seriesMap.values()].filter(s => s.round === 'finals');
  const finalMatchup  = finalsEntries.length > 0
    ? entryToMatchup(finalsEntries[0], 0)
    : makeMatchup({ id: 'NBA-FINAL', label: 'NBA Finals', round: 'finals', top: null, bottom: null });

  return {
    sport:      'nba',
    source:     'live',
    season,
    updatedAt:  new Date().toISOString(),
    conferences: [buildLiveConf('East'), buildLiveConf('West')],
    final: {
      key:     'nba_finals',
      name:    { en: 'NBA Finals', es: 'Final NBA' },
      matchup: finalMatchup,
    },
  };
}

// LineScore quarter columns. NBA returns up to 10 OTs.
const QTR_KEYS = ['PTS_QTR1', 'PTS_QTR2', 'PTS_QTR3', 'PTS_QTR4'];
const OT_KEYS  = Array.from({ length: 10 }, (_, i) => `PTS_OT${i + 1}`);
const PERIOD_KEYS = [...QTR_KEYS, ...OT_KEYS];

function extractPeriodScores(line) {
  if (!line) return [];
  return PERIOD_KEYS.map(k => line[k] ?? null);
}

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

const NBA_FETCH_TIMEOUT_MS = 8000;

async function nbaFetch(endpoint, params = {}, { timeoutMs = NBA_FETCH_TIMEOUT_MS } = {}) {
  const url = new URL(`${NBA_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  // stats.nba.com regularly rate-limits or hangs requests from datacenter IPs.
  // An AbortController prevents the entire route from waiting forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      headers: NBA_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? `timeout after ${timeoutMs}ms`
      : err.message;
    throw new Error(`[nba-api] ${endpoint} → ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
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

  // ESPN first: stats.nba.com hangs from Railway (~8s timeout) before any fallback.
  try {
    const espnGames = await fetchEspnGamesForDate(dateStr);
    const anyLive = espnGames.some(r => r.game_status_id === 2);
    const ttl = anyLive ? TTL.DAILY_GAMES_LIVE : TTL.DAILY_GAMES;
    cacheSet(cacheKey, espnGames, ttl);
    console.log(`[nba-api] scoreboard (ESPN) ${dateStr}: ${espnGames.length} games`);
    return espnGames;
  } catch (espnErr) {
    console.warn(`[nba-api] ESPN scoreboard ${dateStr} failed (${espnErr.message}) — trying stats.nba.com`);
  }

  const stale = cacheGetStale(cacheKey);
  if (stale) {
    console.warn(`[nba-api] scoreboard ${dateStr}: serving stale cache`);
    return stale;
  }

  let data;
  try {
    data = await nbaFetch('scoreboardv2', {
      GameDate: dateStr,
      LeagueID: '00',
      DayOffset: '0',
    });
  } catch (err) {
    console.error(`[nba-api] scoreboardv2 ${dateStr} failed (${err.message}) — returning empty`);
    return [];
  }

  const gameHeader = data.resultSets?.find(rs => rs.name === 'GameHeader');
  const lineScore = data.resultSets?.find(rs => rs.name === 'LineScore');

  if (!gameHeader) {
    try {
      const espnGames = await fetchEspnGamesForDate(dateStr);
      const anyLive = espnGames.some(r => r.game_status_id === 2);
      cacheSet(cacheKey, espnGames, anyLive ? TTL.DAILY_GAMES_LIVE : TTL.DAILY_GAMES);
      console.warn(`[nba-api] No GameHeader resultSet for ${dateStr} — using ESPN fallback (${espnGames.length} games)`);
      return espnGames;
    } catch (espnErr) {
      console.error(`[nba-api] No GameHeader resultSet for ${dateStr}; ESPN fallback failed (${espnErr.message})`);
      return [];
    }
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
      live_period: g.LIVE_PERIOD ?? null,
      live_clock:  g.LIVE_PC_TIME ?? null,
      home_team_id: g.HOME_TEAM_ID,
      home_team_abbr: home?.TEAM_ABBREVIATION ?? null,
      home_team_name: home?.TEAM_CITY_NAME
        ? `${home.TEAM_CITY_NAME} ${home.TEAM_NAME}`
        : null,
      home_score:    home?.PTS ?? null,
      home_qtrs:     extractPeriodScores(home),
      home_fg_pct:   home?.FG_PCT ?? null,
      home_ft_pct:   home?.FT_PCT ?? null,
      home_fg3_pct:  home?.FG3_PCT ?? null,
      home_ast:      home?.AST ?? null,
      home_reb:      home?.REB ?? null,
      home_tov:      home?.TOV ?? null,
      away_team_id: g.VISITOR_TEAM_ID,
      away_team_abbr: away?.TEAM_ABBREVIATION ?? null,
      away_team_name: away?.TEAM_CITY_NAME
        ? `${away.TEAM_CITY_NAME} ${away.TEAM_NAME}`
        : null,
      away_score:    away?.PTS ?? null,
      away_qtrs:     extractPeriodScores(away),
      away_fg_pct:   away?.FG_PCT ?? null,
      away_ft_pct:   away?.FT_PCT ?? null,
      away_fg3_pct:  away?.FG3_PCT ?? null,
      away_ast:      away?.AST ?? null,
      away_reb:      away?.REB ?? null,
      away_tov:      away?.TOV ?? null,
      arena: g.ARENA_NAME ?? null,
      national_tv: g.NATL_TV_BROADCASTER_ABBREVIATION ?? null,
      season: CURRENT_SEASON,
    };
  });

  // Adaptive TTL: when any game is in-progress (status 2) shorten the cache so
  // the live tracker sees fresh scores; for schedule/final-only days keep 5min.
  const anyLive = result.some(r => r.game_status_id === 2);
  const ttl = anyLive ? TTL.DAILY_GAMES_LIVE : TTL.DAILY_GAMES;
  cacheSet(cacheKey, result, ttl);
  console.log(`[nba-api] scoreboardv2 ${dateStr}: ${result.length} games (live=${anyLive}, ttl=${Math.round(ttl/1000)}s)`);
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

  let data;
  try {
    data = await nbaFetch('leaguedashteamstats', {
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
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nba-api] leaguedashteamstats ${season} failed (${err.message}) — serving stale cache`);
      return stale;
    }
    console.error(`[nba-api] leaguedashteamstats ${season} failed (${err.message}) — returning empty`);
    return [];
  }

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

const DIVISION_ORDER = {
  East: ['Atlantic', 'Central', 'Southeast'],
  West: ['Northwest', 'Pacific', 'Southwest'],
};

const DIVISION_LABEL = {
  Atlantic:  { en: 'Atlantic',  es: 'Atlántico' },
  Central:   { en: 'Central',   es: 'Central' },
  Southeast: { en: 'Southeast', es: 'Sureste' },
  Northwest: { en: 'Northwest', es: 'Noroeste' },
  Pacific:   { en: 'Pacific',   es: 'Pacífico' },
  Southwest: { en: 'Southwest', es: 'Suroeste' },
};

function parsePlayoffRank(r) {
  const v = r.PlayoffRank ?? r.ConferenceRank ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDivisionRank(r) {
  const v = r.DivisionRank ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function truthy(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return v.trim() !== '' && v !== '0' && v.toLowerCase() !== 'false';
  return false;
}

function derivePlayoffStatus(rank, flags) {
  if (truthy(flags.eliminatedConference) && !truthy(flags.clinchedPlayoffBirth) && !truthy(flags.clinchedPlayIn)) {
    return 'out';
  }
  if (truthy(flags.clinchedPlayoffBirth) || truthy(flags.clinchedConferenceTitle) || truthy(flags.clinchedDivisionTitle)) {
    return 'playoff';
  }
  if (truthy(flags.clinchedPlayIn)) return 'playIn';
  if (rank == null) return 'unknown';
  if (rank <= 6) return 'playoff';
  if (rank <= 10) return 'playIn';
  return 'out';
}

function normaliseStandingsRow(r) {
  const wins = Number(r.WINS ?? 0);
  const losses = Number(r.LOSSES ?? 0);
  const total = wins + losses;
  const pct = total > 0 ? wins / total : 0;
  const conferenceRank = parsePlayoffRank(r);
  const flags = {
    clinchedPlayoffBirth:   r.ClinchedPlayoffBirth   ?? r.ClinchedPlayoffBerth ?? null,
    clinchedPlayIn:         r.ClinchedPlayIn         ?? null,
    clinchedConferenceTitle:r.ClinchedConferenceTitle?? null,
    clinchedDivisionTitle:  r.ClinchedDivisionTitle  ?? null,
    eliminatedConference:   r.EliminatedConference   ?? null,
  };
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
    gamesBack:        r.ConferenceGamesBack ?? r.GamesBack ?? null,
    divisionGamesBack:r.DivisionGamesBack ?? null,
    home:          r.HOME ?? null,
    road:          r.ROAD ?? null,
    last10:        r.L10 ?? null,
    streak:        r.strCurrentStreak ?? r.CurrentStreak ?? null,
    pointsPg:      r.PointsPG ?? null,
    oppPointsPg:   r.OppPointsPG ?? null,
    diff:          r.DiffPointsPG ?? null,
    confRecord:    r.ConferenceRecord ?? null,
    divRecord:     r.DivisionRecord ?? null,
    conferenceRank,
    divisionRank:  parseDivisionRank(r),
    playoffStatus: derivePlayoffStatus(conferenceRank, flags),
    flags: {
      clinchedPlayoff:        truthy(flags.clinchedPlayoffBirth),
      clinchedPlayIn:         truthy(flags.clinchedPlayIn),
      clinchedConferenceTitle:truthy(flags.clinchedConferenceTitle),
      clinchedDivisionTitle:  truthy(flags.clinchedDivisionTitle),
      eliminated:             truthy(flags.eliminatedConference),
    },
  };
}

const ESPN_DIVISION_BY_ABBR = {
  BOS: 'Atlantic', BKN: 'Atlantic', NY: 'Atlantic', PHI: 'Atlantic', TOR: 'Atlantic',
  CHI: 'Central', CLE: 'Central', DET: 'Central', IND: 'Central', MIL: 'Central',
  ATL: 'Southeast', CHA: 'Southeast', MIA: 'Southeast', ORL: 'Southeast', WSH: 'Southeast',
  DEN: 'Northwest', MIN: 'Northwest', OKC: 'Northwest', POR: 'Northwest', UTAH: 'Northwest',
  GS: 'Pacific', LAC: 'Pacific', LAL: 'Pacific', PHX: 'Pacific', SAC: 'Pacific',
  DAL: 'Southwest', HOU: 'Southwest', MEM: 'Southwest', NO: 'Southwest', SA: 'Southwest',
};

function getEspnEntryStat(entry, name) {
  const needle = String(name).toLowerCase();
  return entry?.stats?.find(s => String(s?.name ?? '').toLowerCase() === needle) ?? null;
}

function getEspnNumeric(entry, name) {
  const value = getEspnEntryStat(entry, name)?.value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getEspnDisplay(entry, name) {
  const stat = getEspnEntryStat(entry, name);
  return stat?.displayValue ?? null;
}

function normaliseEspnStandingsEntry(entry, conference) {
  const team = entry?.team ?? {};
  const wins = getEspnNumeric(entry, 'wins') ?? 0;
  const losses = getEspnNumeric(entry, 'losses') ?? 0;
  const conferenceRank = getEspnNumeric(entry, 'playoffSeed');
  const division = ESPN_DIVISION_BY_ABBR[team.abbreviation] ?? null;
  const winPctRaw = getEspnNumeric(entry, 'winPercent');
  const fallbackPct = wins + losses > 0 ? wins / (wins + losses) : 0;
  const pctRaw = winPctRaw != null ? winPctRaw : fallbackPct;
  const pctDisplay = getEspnDisplay(entry, 'winPercent') ?? pctRaw.toFixed(3).replace(/^0/, '');
  return {
    teamId: Number(team.id),
    abbreviation: team.abbreviation ?? null,
    name: team.name ?? null,
    fullName: team.displayName ?? null,
    conference,
    division,
    wins,
    losses,
    pct: pctDisplay,
    pctRaw,
    gamesBack: getEspnNumeric(entry, 'gamesBehind'),
    divisionGamesBack: null,
    home: getEspnDisplay(entry, 'Home'),
    road: getEspnDisplay(entry, 'Road'),
    last10: getEspnDisplay(entry, 'Last Ten Games'),
    streak: getEspnDisplay(entry, 'streak'),
    pointsPg: getEspnNumeric(entry, 'avgPointsFor'),
    oppPointsPg: getEspnNumeric(entry, 'avgPointsAgainst'),
    diff: getEspnNumeric(entry, 'differential'),
    confRecord: getEspnDisplay(entry, 'vs. Conf.'),
    divRecord: getEspnDisplay(entry, 'vs. Div.'),
    conferenceRank,
    divisionRank: null,
    playoffStatus: conferenceRank == null ? 'unknown' : conferenceRank <= 6 ? 'playoff' : conferenceRank <= 10 ? 'playIn' : 'out',
    flags: {
      clinchedPlayoff: false,
      clinchedPlayIn: false,
      clinchedConferenceTitle: false,
      clinchedDivisionTitle: false,
      eliminated: false,
    },
  };
}

async function fetchEspnStandings(season = CURRENT_SEASON) {
  const year = seasonStartYear(season);
  const url = `${ESPN_STANDINGS_BASE}?season=${year}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const conferencesRaw = Array.isArray(data.children) ? data.children : [];
    const byConf = { East: [], West: [] };
    for (const conf of conferencesRaw) {
      const key = String(conf.id) === '5'
        ? 'East'
        : String(conf.id) === '6'
          ? 'West'
          : null;
      if (!key) continue;
      const entries = Array.isArray(conf.standings?.entries) ? conf.standings.entries : [];
      byConf[key] = entries.map(entry => normaliseEspnStandingsEntry(entry, key));
      byConf[key].sort((a, b) => {
        if (a.conferenceRank != null && b.conferenceRank != null) return a.conferenceRank - b.conferenceRank;
        return (b.pctRaw - a.pctRaw) || (b.wins - a.wins);
      });
      const divRankByDivision = {};
      for (const team of byConf[key]) {
        if (!team.division) continue;
        if (!divRankByDivision[team.division]) divRankByDivision[team.division] = 0;
        divRankByDivision[team.division] += 1;
        team.divisionRank = divRankByDivision[team.division];
      }
    }
    return {
      season,
      updatedAt: new Date().toISOString(),
      conferences: ['East', 'West'].map(confKey => {
        const teams = byConf[confKey] ?? [];
        const divisions = DIVISION_ORDER[confKey].map(divKey => ({
          key: divKey,
          name: DIVISION_LABEL[divKey],
          teams: teams.filter(t => t.division === divKey),
        }));
        return {
          key: confKey,
          name: CONFERENCE_LABEL[confKey],
          teams,
          divisions,
        };
      }),
    };
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'timeout after 8s' : err.message;
    throw new Error(`[nba-api] espn standings ${season} → ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getNbaStandings(season = CURRENT_SEASON) {
  const cacheKey = `standings:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const espnStandings = await fetchEspnStandings(season);
    const teamCount = espnStandings.conferences?.reduce((n, c) => n + (c.teams?.length ?? 0), 0) ?? 0;
    if (teamCount > 0) {
      cacheSet(cacheKey, espnStandings, TTL.STANDINGS);
      console.log(`[nba-api] standings (ESPN) ${season}: ${teamCount} teams`);
      return espnStandings;
    }
  } catch (espnErr) {
    console.warn(`[nba-api] ESPN standings ${season} failed (${espnErr.message}) — trying stats.nba.com`);
  }

  const stale = cacheGetStale(cacheKey);
  if (stale) {
    console.warn(`[nba-api] standings ${season}: serving stale cache`);
    return stale;
  }

  let data;
  try {
    data = await nbaFetch('leaguestandingsv3', {
      LeagueID:   '00',
      Season:     season,
      SeasonType: 'Regular Season',
    });
  } catch (err) {
    console.error(`[nba-api] leaguestandingsv3 ${season} failed (${err.message}) — returning empty`);
    return { season, updatedAt: new Date().toISOString(), conferences: [] };
  }

  const rs = data.resultSets?.find(r => r.name === 'Standings');
  if (!rs) {
    try {
      const espnStandings = await fetchEspnStandings(season);
      cacheSet(cacheKey, espnStandings, TTL.STANDINGS);
      console.warn('[nba-api] No Standings resultSet — using ESPN fallback');
      return espnStandings;
    } catch (espnErr) {
      console.error(`[nba-api] No Standings resultSet; ESPN fallback failed (${espnErr.message})`);
      return { season, updatedAt: new Date().toISOString(), conferences: [] };
    }
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
    conferences: ['East', 'West'].map(key => {
      const teams = byConf[key];
      const divs = DIVISION_ORDER[key].map(divKey => {
        const divTeams = teams
          .filter(t => t.division === divKey)
          .sort((a, b) => {
            if (a.divisionRank != null && b.divisionRank != null) return a.divisionRank - b.divisionRank;
            return (b.pctRaw - a.pctRaw) || (b.wins - a.wins);
          });
        return { key: divKey, name: DIVISION_LABEL[divKey], teams: divTeams };
      });
      return {
        key,
        name: CONFERENCE_LABEL[key],
        teams,
        divisions: divs,
      };
    }),
  };

  cacheSet(cacheKey, result, TTL.STANDINGS);
  console.log(`[nba-api] leaguestandingsv3 ${season}: East ${byConf.East.length}, West ${byConf.West.length}`);
  return result;
}

// ── Playoff bracket (derived from standings) ─────────────────────────────────

function bracketTeamFromStanding(s, seed) {
  if (!s) return null;
  return {
    seed,
    teamId:       s.teamId,
    abbreviation: s.abbreviation,
    name:         s.name,
    fullName:     s.fullName,
    wins:         s.wins,
    losses:       s.losses,
    pct:          s.pct,
  };
}

function makeMatchup({ id, label, top, bottom, round, bestOf = 7 }) {
  return {
    id, label, round, bestOf,
    top, bottom,
    winner: null, // populated when real series data is available
    series: null, // e.g., '2-1' when real data is available
  };
}

export async function getNbaPlayoffBracket(season = CURRENT_SEASON) {
  const cacheKey = `playoffs:${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // ESPN site API works from Railway; stats.nba.com does not.
  // If the playoffs have started, ESPN will have events and we return a live bracket.
  // If the season is still in regular season, events will be empty and we fall through
  // to the standings-derived projected bracket.
  try {
    const events = await fetchEspnPlayoffEvents(season);
    if (events.length > 0) {
      const result = buildLiveBracketFromEvents(events, season);
      cacheSet(cacheKey, result, TTL.PLAYOFF_LIVE);
      console.log(`[nba-api] playoff bracket (live/ESPN): ${events.length} events`);
      return result;
    }
    console.log(`[nba-api] ESPN returned 0 playoff events — building projected bracket from standings`);
  } catch (err) {
    console.warn(`[nba-api] ESPN playoff fetch failed (${err.message}) — building projected bracket`);
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn('[nba-api] playoff bracket: serving stale cache');
      return stale;
    }
  }

  // Projected bracket derived from current regular-season standings (pre-playoffs).
  const standings = await getNbaStandings(season);

  const buildConference = confKey => {
    const conf = standings.conferences.find(c => c.key === confKey);
    const teams = conf?.teams ?? [];
    const byRank = Array.from({ length: 11 }, (_, i) => {
      const target = i + 1;
      return teams.find(t => t.conferenceRank === target) ?? null;
    });
    const seed = n => bracketTeamFromStanding(byRank[n], n);

    const playIn = [
      makeMatchup({ id: `${confKey}-PI-78`, label: '7v8 → #7 Seed', round: 'play_in', bestOf: 1, top: seed(7), bottom: seed(8) }),
      makeMatchup({ id: `${confKey}-PI-910`, label: '9v10', round: 'play_in', bestOf: 1, top: seed(9), bottom: seed(10) }),
      makeMatchup({ id: `${confKey}-PI-final`, label: 'Loser 7v8 vs Winner 9v10 → #8 Seed', round: 'play_in', bestOf: 1, top: null, bottom: null }),
    ];

    const round1 = [
      makeMatchup({ id: `${confKey}-R1-18`, label: '1 vs 8', round: 'first_round', top: seed(1), bottom: seed(8) }),
      makeMatchup({ id: `${confKey}-R1-45`, label: '4 vs 5', round: 'first_round', top: seed(4), bottom: seed(5) }),
      makeMatchup({ id: `${confKey}-R1-36`, label: '3 vs 6', round: 'first_round', top: seed(3), bottom: seed(6) }),
      makeMatchup({ id: `${confKey}-R1-27`, label: '2 vs 7', round: 'first_round', top: seed(2), bottom: seed(7) }),
    ];

    const semis = [
      makeMatchup({ id: `${confKey}-SF-1845`, label: 'Semifinal 1', round: 'conf_semis', top: null, bottom: null }),
      makeMatchup({ id: `${confKey}-SF-3627`, label: 'Semifinal 2', round: 'conf_semis', top: null, bottom: null }),
    ];

    const finals = [
      makeMatchup({ id: `${confKey}-CF`, label: 'Conference Final', round: 'conf_finals', top: null, bottom: null }),
    ];

    return {
      key: confKey,
      name: CONFERENCE_LABEL[confKey],
      playIn,
      rounds: [
        { key: 'first_round', name: { en: 'First Round',       es: 'Primera Ronda'     }, matchups: round1 },
        { key: 'conf_semis',  name: { en: 'Conference Semis',  es: 'Semifinales Conf.' }, matchups: semis  },
        { key: 'conf_finals', name: { en: 'Conference Finals', es: 'Finales Conf.'     }, matchups: finals },
      ],
    };
  };

  const result = {
    sport:      'nba',
    source:     'projected',
    season,
    updatedAt:  new Date().toISOString(),
    conferences: [buildConference('East'), buildConference('West')],
    final: {
      key:     'nba_finals',
      name:    { en: 'NBA Finals', es: 'Final NBA' },
      matchup: makeMatchup({ id: 'NBA-FINAL', label: 'NBA Finals', round: 'finals', top: null, bottom: null }),
    },
  };

  cacheSet(cacheKey, result, TTL.STANDINGS);
  console.log(`[nba-api] playoff bracket (projected) built for ${season}`);
  return result;
}
