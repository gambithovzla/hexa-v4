/**
 * nhl-api.js — NHL data wrapper over ESPN's hidden site API (no key required).
 *
 * Mirrors nba-api.js (date-based cadence, not the NFL week cadence). ESPN is the
 * canonical source — same provider and Railway-friendly pattern as NBA/NFL.
 * Advanced special-teams metrics (PP%, PK%) are not in ESPN's keyless standings,
 * so they are surfaced as null here and filled later if a richer source lands
 * (analogous to EPA being null until nflverse in the NFL wrapper).
 *
 * Cache TTLs mirror the other sports: scoreboard 5min (30s when live),
 * team/standings 6h/15min, injuries 15min. On failure we serve stale cache,
 * then degrade to empty — never throw to callers.
 */

import { enrichGameTeamIds, getNhlTeam } from './nhl-team-map.js';

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings';
const ESPN_INJURIES_URL = `${ESPN_SITE}/injuries`;

// ── In-memory cache (same shape as nba-api.js) ─────────────────────────────────

const _cache = new Map();

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.data;
}

function cacheGetStale(key) {
  return _cache.get(key)?.data ?? null;
}

function cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const TTL = {
  TEAM_STATS:   6 * 60 * 60 * 1000, // 6h
  DAY_GAMES:    5 * 60 * 1000,      // 5min — schedule/final
  DAY_GAMES_LIVE: 30 * 1000,        // 30s — when any game is in progress
  RECENT_GAMES: 10 * 60 * 1000,     // 10min
  STANDINGS:    15 * 60 * 1000,     // 15min
  INJURIES:     15 * 60 * 1000,     // 15min
  SUMMARY_LIVE: 30 * 1000,          // 30s — live game summary
};

// ── HTTP helper ────────────────────────────────────────────────────────────────

async function espnFetch(url, { timeoutMs = 8000, label = 'espn' } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    const msg = err.name === 'AbortError' ? `timeout after ${Math.round(timeoutMs / 1000)}s` : err.message;
    throw new Error(`[nhl-api] ${label} → ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Status mapping ─────────────────────────────────────────────────────────────

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
    detail.includes('period') ||
    detail.includes('intermission') ||
    detail.includes('ot') ||
    detail.includes('so')
  ) {
    return { game_status_id: 2, status: type.shortDetail ?? type.detail ?? type.description ?? 'In Progress' };
  }
  return { game_status_id: 1, status: type.shortDetail ?? type.detail ?? type.description ?? 'Scheduled' };
}

function normalizeScoreboardEvent(event, ctx = {}) {
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
  const nationalTv = comp.broadcasts?.[0]?.names?.[0] ?? comp.geoBroadcasts?.[0]?.media?.shortName ?? null;
  const safeDate = event.date ? String(event.date).slice(0, 10) : (ctx.dateStr ?? null);

  return enrichGameTeamIds({
    game_id: String(event.id ?? comp.id),
    season: ctx.season ?? event.season?.year ?? null,
    season_type: ctx.seasonType ?? event.season?.type ?? null,
    game_date: safeDate,
    game_datetime: event.date ?? null,
    status: mappedStatus.status,
    game_status_id: mappedStatus.game_status_id,
    live_period: event.status?.period ?? null,
    live_clock: event.status?.displayClock ?? null,
    home_team_id: Number(home.team.id),
    home_team_abbr: home.team.abbreviation ?? null,
    home_team_name: home.team.displayName ?? null,
    home_score: parseScore(home.score),
    home_record: home.records?.[0]?.summary ?? null,
    away_team_id: Number(away.team.id),
    away_team_abbr: away.team.abbreviation ?? null,
    away_team_name: away.team.displayName ?? null,
    away_score: parseScore(away.score),
    away_record: away.records?.[0]?.summary ?? null,
    venue: comp.venue?.fullName ?? null,
    neutral_site: !!comp.neutralSite,
    national_tv: nationalTv,
  });
}

// ── Games by date ────────────────────────────────────────────────────────────

/**
 * getNhlGamesForDate(YYYY-MM-DD) → array of normalized games for that calendar
 * day. Defaults to today (UTC) when no date is provided.
 */
export async function getNhlGamesForDate(dateStr) {
  const date = dateStr ?? new Date().toISOString().slice(0, 10);
  const cacheKey = `games:${date}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const compact = String(date).replaceAll('-', '');
  const url = `${ESPN_SITE}/scoreboard?dates=${compact}`;
  try {
    const data = await espnFetch(url, { label: `scoreboard ${date}` });
    const events = Array.isArray(data.events) ? data.events : [];
    const games = events
      .map(ev => normalizeScoreboardEvent(ev, { dateStr: date, season: data.season?.year, seasonType: data.season?.type }))
      .filter(Boolean);
    const anyLive = games.some(g => g.game_status_id === 2);
    cacheSet(cacheKey, games, anyLive ? TTL.DAY_GAMES_LIVE : TTL.DAY_GAMES);
    console.log(`[nhl-api] scoreboard ${date}: ${games.length} games (live=${anyLive})`);
    return games;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nhl-api] scoreboard ${date} failed (${err.message}) — serving stale`);
      return stale;
    }
    console.error(`[nhl-api] scoreboard ${date} failed (${err.message}) — returning empty`);
    return [];
  }
}

// ── Standings (also the source for team stats) ─────────────────────────────────

function statValue(entry, ...names) {
  const stats = Array.isArray(entry?.stats) ? entry.stats : [];
  for (const name of names) {
    const s = stats.find(st => st.name === name || st.type === name || st.abbreviation === name);
    if (s && s.value != null) return Number(s.value);
  }
  return null;
}

// ESPN standings nest entries under children (conference → division). Flatten.
function collectStandingEntries(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  const entries = node.standings?.entries ?? node.entries;
  if (Array.isArray(entries)) acc.push(...entries.map(e => ({ ...e, _group: node.name ?? node.abbreviation ?? null })));
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectStandingEntries(child, acc);
  }
  return acc;
}

function mapStandingEntry(entry) {
  const team = entry?.team ?? {};
  const teamId = team.id != null ? Number(team.id) : null;
  const meta = getNhlTeam({ teamId, teamAbbr: team.abbreviation }) ?? {};
  const wins = statValue(entry, 'wins');
  const losses = statValue(entry, 'losses');
  const otLosses = statValue(entry, 'otLosses', 'otlosses', 'overtimeLosses') ?? 0;
  const points = statValue(entry, 'points');
  // For hockey, ESPN's pointsFor/pointsAgainst carry GOALS for/against.
  const goalsFor = statValue(entry, 'pointsFor', 'goalsFor', 'avgPointsFor');
  const goalsAgainst = statValue(entry, 'pointsAgainst', 'goalsAgainst', 'avgPointsAgainst');
  const games = (wins ?? 0) + (losses ?? 0) + (otLosses ?? 0);
  const maxPoints = games * 2;
  return {
    team_id: teamId,
    team_abbr: meta.abbr ?? team.abbreviation ?? null,
    team_name: team.displayName ?? meta.name ?? null,
    conference: meta.conference ?? null,
    division: meta.division ?? null,
    wins, losses, ot_losses: otLosses,
    points,
    points_pct: points != null && maxPoints > 0 ? Math.round((points / maxPoints) * 1000) / 1000 : null,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    goal_diff: goalsFor != null && goalsAgainst != null ? goalsFor - goalsAgainst : statValue(entry, 'pointDifferential', 'differential'),
    gf_per_game: goalsFor != null && games > 0 ? Math.round((goalsFor / games) * 100) / 100 : null,
    ga_per_game: goalsAgainst != null && games > 0 ? Math.round((goalsAgainst / games) * 100) / 100 : null,
    streak: statValue(entry, 'streak'),
    games_played: games,
  };
}

async function fetchStandings(season) {
  const url = `${ESPN_STANDINGS_URL}?season=${season}&level=3`;
  const data = await espnFetch(url, { label: `standings ${season}`, timeoutMs: 10000 });
  const entries = collectStandingEntries(data);
  return entries.map(mapStandingEntry).filter(e => e.team_abbr != null);
}

/**
 * getNhlStandings(season) → { season, conferences: { Eastern:[...], Western:[...] }, teams:[...] }
 * `season` is the 4-digit end year of the NHL season (ESPN convention).
 */
export async function getNhlStandings(season = null) {
  const yr = season ?? new Date().getFullYear();
  const cacheKey = `standings:${yr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const teams = await fetchStandings(yr);
    const conferences = { Eastern: [], Western: [] };
    for (const t of teams) {
      if (t.conference && conferences[t.conference]) conferences[t.conference].push(t);
    }
    const result = { season: yr, conferences, teams, fetchedAt: new Date().toISOString() };
    cacheSet(cacheKey, result, TTL.STANDINGS);
    console.log(`[nhl-api] standings ${yr}: ${teams.length} teams`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nhl-api] standings ${yr} failed (${err.message}) — serving stale`);
      return stale;
    }
    console.error(`[nhl-api] standings ${yr} failed (${err.message}) — returning empty`);
    return { season: yr, conferences: { Eastern: [], Western: [] }, teams: [], fetchedAt: null };
  }
}

/**
 * getNhlTeamStats(season) → array of per-team season stats (standings-derived).
 * PP%/PK% are left null here and filled by a richer source later.
 */
export async function getNhlTeamStats(season = null) {
  const yr = season ?? new Date().getFullYear();
  const cacheKey = `team_stats:${yr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const standings = await getNhlStandings(yr);
  const teams = (standings.teams ?? []).map(t => ({
    team_id: t.team_id,
    team_abbr: t.team_abbr,
    team_name: t.team_name,
    conference: t.conference,
    division: t.division,
    wins: t.wins,
    losses: t.losses,
    ot_losses: t.ot_losses,
    points: t.points,
    points_pct: t.points_pct,
    goals_for: t.goals_for,
    goals_against: t.goals_against,
    goal_diff: t.goal_diff,
    gf_per_game: t.gf_per_game,
    ga_per_game: t.ga_per_game,
    games_played: t.games_played,
    // richer-source (filled later):
    pp_pct: null,
    pk_pct: null,
    shots_for_per_game: null,
    shots_against_per_game: null,
    faceoff_pct: null,
  }));
  cacheSet(cacheKey, teams, TTL.TEAM_STATS);
  return teams;
}

// ── Recent games (form) ─────────────────────────────────────────────────────────

/**
 * getNhlTeamRecentGames(teamId, season, lastN) → recent COMPLETED games,
 * most-recent first: { game_date, opponent, home_away, result, goals_for, goals_against }.
 * Keyed on the ESPN numeric team id (carried through on each game object).
 */
export async function getNhlTeamRecentGames(teamId, season = null, lastN = 8) {
  const id = Number(teamId);
  if (!Number.isFinite(id)) return [];
  const yr = season ?? new Date().getFullYear();
  const cacheKey = `recent:${id}:${yr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached.slice(0, lastN);

  const url = `${ESPN_SITE}/teams/${id}/schedule?season=${yr}`;
  try {
    const data = await espnFetch(url, { label: `schedule team ${id} ${yr}` });
    const events = Array.isArray(data.events) ? data.events : [];
    const games = [];
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const status = mapEspnStatusType(ev.status?.type ?? comp.status?.type ?? {});
      if (status.game_status_id !== 3) continue; // completed only
      const self = comp.competitors?.find(c => Number(c.team?.id) === id);
      const opp = comp.competitors?.find(c => Number(c.team?.id) !== id);
      if (!self || !opp) continue;
      const gf = Number(self.score?.value ?? self.score);
      const ga = Number(opp.score?.value ?? opp.score);
      const won = self.winner === true || (Number.isFinite(gf) && Number.isFinite(ga) && gf > ga);
      games.push({
        game_date: ev.date ? String(ev.date).slice(0, 10) : null,
        opponent: opp.team?.abbreviation ?? null,
        home_away: self.homeAway ?? null,
        result: won ? 'W' : 'L',
        goals_for: Number.isFinite(gf) ? gf : null,
        goals_against: Number.isFinite(ga) ? ga : null,
      });
    }
    games.sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)));
    cacheSet(cacheKey, games, TTL.RECENT_GAMES);
    return games.slice(0, lastN);
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) return stale.slice(0, lastN);
    console.warn(`[nhl-api] recent games team ${id} failed (${err.message}) — empty`);
    return [];
  }
}

// ── Injuries (ESPN league feed — same shape as NBA/NFL) ────────────────────────

function normaliseInjuryStatus(value) {
  const s = String(value ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('injured reserve') || s === 'ir')            return 'out';
  if (s.includes('long term') || s.includes('ltir'))          return 'out';
  if (s.includes('out for season'))                           return 'out_for_season';
  if (s.includes('suspend'))                                  return 'out';
  if (s.includes('out'))                                      return 'out';
  if (s.includes('doubt'))                                    return 'doubtful';
  if (s.includes('quest'))                                    return 'questionable';
  if (s.includes('prob'))                                     return 'probable';
  if (s.includes('day'))                                      return 'day_to_day';
  if (s.includes('game time') || s.includes('time decision')) return 'game_time_decision';
  return s.replace(/[^a-z]+/g, '_');
}

function normaliseInjuryEntry(item) {
  const athlete = item?.athlete ?? {};
  const details = item?.details ?? {};
  return {
    playerId:   athlete.id != null ? String(athlete.id) : null,
    playerName: athlete.displayName ?? athlete.fullName ?? null,
    position:   athlete.position?.abbreviation ?? null,
    status:     item?.status ?? null,
    statusKey:  normaliseInjuryStatus(item?.status),
    type:       details.type ?? null,
    detail:     details.detail ?? null,
    side:       details.side ?? null,
    returnDate: details.returnDate ?? null,
    comment:    item?.longComment ?? item?.shortComment ?? null,
  };
}

/**
 * getNhlLeagueInjuries() → { byTeamId, byAbbr, fetchedAt, source, stale }.
 * Resilient: serves stale cache on failure, never throws.
 */
export async function getNhlLeagueInjuries() {
  const cacheKey = 'injuries:league';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const data = await espnFetch(ESPN_INJURIES_URL, { label: 'injuries' });
    const teams = Array.isArray(data.injuries) ? data.injuries : [];

    const byTeamId = {};
    const byAbbr = {};
    for (const t of teams) {
      const team = t?.team ?? {};
      const teamId = team.id != null ? String(team.id) : null;
      const abbr = team.abbreviation ?? null;
      const list = Array.isArray(t?.injuries) ? t.injuries.map(normaliseInjuryEntry) : [];
      const payload = {
        teamId,
        abbreviation: abbr,
        displayName: team.displayName ?? team.name ?? null,
        injuries: list,
      };
      if (teamId) byTeamId[teamId] = payload;
      if (abbr) byAbbr[abbr] = payload;
    }

    const result = { byTeamId, byAbbr, fetchedAt: new Date().toISOString(), source: 'espn', stale: false };
    cacheSet(cacheKey, result, TTL.INJURIES);
    const total = teams.reduce((n, t) => n + (Array.isArray(t.injuries) ? t.injuries.length : 0), 0);
    console.log(`[nhl-api] injuries (ESPN): ${teams.length} teams, ${total} entries`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nhl-api] injuries failed (${err.message}) — serving stale`);
      return { ...stale, stale: true };
    }
    console.warn(`[nhl-api] injuries failed (${err.message}) — no cache`);
    return { byTeamId: {}, byAbbr: {}, fetchedAt: null, source: 'unavailable', stale: true };
  }
}

/** Lookup injuries for one team across both id and abbr keys. */
export function findTeamInjuries(payload, { teamId, teamAbbr }) {
  if (!payload) return null;
  if (teamId != null && payload.byTeamId?.[String(teamId)]) return payload.byTeamId[String(teamId)];
  if (teamAbbr && payload.byAbbr?.[String(teamAbbr)]) return payload.byAbbr[String(teamAbbr)];
  return null;
}

// ── Game summary (live + resolution) ───────────────────────────────────────────

/**
 * getNhlGameSummary(eventId) → normalized live/final state from ESPN's summary
 * endpoint (header competition + winprobability). Win probability may be absent
 * for hockey; falls back to null.
 */
export async function getNhlGameSummary(eventId) {
  const cacheKey = `summary:${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${ESPN_SITE}/summary?event=${eventId}`;
  try {
    const data = await espnFetch(url, { label: `summary ${eventId}`, timeoutMs: 10000 });
    const comp = data.header?.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === 'home');
    const away = comp?.competitors?.find(c => c.homeAway === 'away');
    const statusType = comp?.status?.type ?? data.header?.status?.type ?? {};
    const mapped = mapEspnStatusType(statusType);
    const wp = Array.isArray(data.winprobability) && data.winprobability.length
      ? data.winprobability[data.winprobability.length - 1]
      : null;

    const result = {
      event_id: String(eventId),
      status: mapped.status,
      game_status_id: mapped.game_status_id,
      period: comp?.status?.period ?? null,
      clock: comp?.status?.displayClock ?? null,
      home_team_id: home?.team?.id != null ? Number(home.team.id) : null,
      home_team_abbr: home?.team?.abbreviation ?? null,
      home_score: home?.score != null ? Number(home.score) : null,
      away_team_id: away?.team?.id != null ? Number(away.team.id) : null,
      away_team_abbr: away?.team?.abbreviation ?? null,
      away_score: away?.score != null ? Number(away.score) : null,
      home_win_prob: wp?.homeWinPercentage != null ? Number(wp.homeWinPercentage) : null,
      fetchedAt: new Date().toISOString(),
    };
    const ttl = mapped.game_status_id === 2 ? TTL.SUMMARY_LIVE : TTL.DAY_GAMES;
    cacheSet(cacheKey, result, ttl);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) return stale;
    console.warn(`[nhl-api] summary ${eventId} failed (${err.message})`);
    return null;
  }
}
