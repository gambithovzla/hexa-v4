/**
 * nfl-api.js — NFL data wrapper over ESPN's hidden site API (no key required).
 *
 * Mirrors nba-api.js, with the one structural NFL difference: games are fetched
 * **by week** (`seasontype` + `week`), not by date. ESPN is the canonical source
 * (same provider as the NBA Railway-friendly fallback). Advanced metrics (EPA,
 * success rate, PROE) come from nflverse later (Sprint 9b+) — here we surface
 * what ESPN gives keyless: schedule, scores, standings-derived team stats,
 * recent form, and injuries.
 *
 * Cache TTLs mirror NBA: schedule 5min (30s when live), team/standings 6h/15min,
 * injuries 15min. On fetch failure we serve stale cache, then degrade to empty —
 * never throw to callers (resilient like getNbaLeagueInjuries).
 */

import { enrichGameTeamIds, getNflTeam } from './nfl-team-map.js';

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';
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

/** Test seam: the module-level cache otherwise bleeds between cases. */
export function _resetNflApiCache() {
  _cache.clear();
}

const TTL = {
  TEAM_STATS:    6 * 60 * 60 * 1000, // 6h
  WEEK_GAMES:    5 * 60 * 1000,      // 5min — schedule/final
  WEEK_GAMES_LIVE: 30 * 1000,        // 30s — when any game is in progress
  RECENT_GAMES:  10 * 60 * 1000,     // 10min
  STANDINGS:     15 * 60 * 1000,     // 15min
  INJURIES:      15 * 60 * 1000,     // 15min
  CURRENT_WEEK:  10 * 60 * 1000,     // 10min — current seasontype/week pointer
  SUMMARY_LIVE:  30 * 1000,          // 30s — live game summary
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
    throw new Error(`[nfl-api] ${label} → ${msg}`);
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
    detail.includes('qtr') ||
    detail.includes('quarter') ||
    detail.includes('halftime') ||
    detail.includes('ot')
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
    week: ctx.week ?? event.week?.number ?? null,
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

// ── Current week pointer ───────────────────────────────────────────────────────

/**
 * getCurrentNflWeek() → { season, seasonType, week }
 * Reads ESPN's scoreboard (no params) which reports the active week.
 * seasonType: 1=preseason, 2=regular, 3=postseason.
 */
export async function getCurrentNflWeek() {
  const cacheKey = 'current_week';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const data = await espnFetch(`${ESPN_SITE}/scoreboard`, { label: 'current week' });
    const result = resolveCurrentWeek(data);
    cacheSet(cacheKey, result, TTL.CURRENT_WEEK);
    // The no-param scoreboard already carries the active slate. Keeping it lets
    // getNflGamesForWeek recover when the explicit seasontype/week query comes
    // back empty, instead of showing an empty board on a day with games.
    cacheSet(CURRENT_SLATE_KEY, normalizeScoreboardEvents(data, result), TTL.WEEK_GAMES);
    return result;
  } catch (err) {
    console.warn(`[nfl-api] current week failed (${err.message}) — defaulting to regular week 1`);
    const stale = cacheGetStale(cacheKey);
    if (stale) return stale;
    return { season: new Date().getFullYear(), seasonType: 2, week: 1 };
  }
}

const CURRENT_SLATE_KEY = 'current_slate';

// ESPN reports seasontype 4 (offseason) on the root of the scoreboard well into
// the preseason, and a 4 fed back into ?seasontype= matches no games at all —
// the board goes empty on a day that has games. The events themselves carry the
// authoritative season/type/week for the slate being shown, so prefer those and
// only fall back to the root when the slate is empty.
function resolveCurrentWeek(data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const fromEvent = events.find(ev => VALID_SEASON_TYPES.has(Number(ev?.season?.type)));

  const season = fromEvent?.season?.year ?? data?.season?.year ?? new Date().getFullYear();
  const rootType = Number(data?.season?.type);
  const seasonType = fromEvent
    ? Number(fromEvent.season.type)
    : (VALID_SEASON_TYPES.has(rootType) ? rootType : 2);
  const week = fromEvent?.week?.number ?? data?.week?.number ?? 1;

  if (fromEvent && Number(fromEvent.season.type) !== rootType) {
    console.log(
      `[nfl-api] scoreboard root reported seasontype=${data?.season?.type} but the slate is ` +
      `seasontype=${seasonType} week=${week} — trusting the slate`,
    );
  }
  return { season, seasonType, week };
}

const VALID_SEASON_TYPES = new Set([1, 2, 3]);

function normalizeScoreboardEvents(data, ctx) {
  const events = Array.isArray(data?.events) ? data.events : [];
  return events.map(ev => normalizeScoreboardEvent(ev, ctx)).filter(Boolean);
}

// ── Games by week ──────────────────────────────────────────────────────────────

/**
 * getNflGamesForWeek({ season, seasonType, week })
 *   season: 4-digit year (defaults to current). seasonType: 1|2|3 (default 2).
 *   week: 1–18 regular / 1–4 post (defaults to current week).
 *   Returns array of normalized games.
 */
export async function getNflGamesForWeek({ season = null, seasonType = null, week = null } = {}) {
  let s = season, st = seasonType, w = week;
  // Only the fully-implicit call is "show me what's on now", and only that call
  // may fall back to the live slate — an explicit week request must answer for
  // the week that was asked for, empty or not.
  const isCurrent = season == null && seasonType == null && week == null;
  if (s == null || st == null || w == null) {
    const cur = await getCurrentNflWeek();
    s = s ?? cur.season;
    st = st ?? cur.seasonType;
    w = w ?? cur.week;
  }

  const cacheKey = `games:${s}:${st}:${w}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `${ESPN_SITE}/scoreboard?seasontype=${st}&week=${w}&dates=${s}`;
  try {
    const data = await espnFetch(url, { label: `scoreboard ${s} st${st} wk${w}` });
    const events = Array.isArray(data.events) ? data.events : [];
    const games = events
      .map(ev => normalizeScoreboardEvent(ev, { season: s, seasonType: st, week: w }))
      .filter(Boolean);
    if (games.length === 0 && isCurrent) {
      const slate = cacheGetStale(CURRENT_SLATE_KEY);
      if (slate?.length) {
        console.warn(
          `[nfl-api] scoreboard ${s} st${st} wk${w} returned 0 games but the live slate has ` +
          `${slate.length} — serving the slate`,
        );
        cacheSet(cacheKey, slate, TTL.WEEK_GAMES);
        return slate;
      }
    }
    const anyLive = games.some(g => g.game_status_id === 2);
    cacheSet(cacheKey, games, anyLive ? TTL.WEEK_GAMES_LIVE : TTL.WEEK_GAMES);
    console.log(`[nfl-api] scoreboard ${s} st${st} wk${w}: ${games.length} games (live=${anyLive})`);
    return games;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nfl-api] scoreboard ${s} st${st} wk${w} failed (${err.message}) — serving stale`);
      return stale;
    }
    console.error(`[nfl-api] scoreboard ${s} st${st} wk${w} failed (${err.message}) — returning empty`);
    return [];
  }
}

/** getNflGamesForDate(YYYY-MM-DD) — convenience for a single calendar day. */
export async function getNflGamesForDate(dateStr) {
  const cacheKey = `games_date:${dateStr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const compact = String(dateStr).replaceAll('-', '');
  const url = `${ESPN_SITE}/scoreboard?dates=${compact}`;
  try {
    const data = await espnFetch(url, { label: `scoreboard ${dateStr}` });
    const events = Array.isArray(data.events) ? data.events : [];
    const games = events
      .map(ev => normalizeScoreboardEvent(ev, { dateStr, season: data.season?.year, seasonType: data.season?.type, week: data.week?.number }))
      .filter(Boolean);
    const anyLive = games.some(g => g.game_status_id === 2);
    cacheSet(cacheKey, games, anyLive ? TTL.WEEK_GAMES_LIVE : TTL.WEEK_GAMES);
    return games;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) return stale;
    console.error(`[nfl-api] scoreboard ${dateStr} failed (${err.message}) — returning empty`);
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
  const meta = getNflTeam({ teamId, teamAbbr: team.abbreviation }) ?? {};
  const wins = statValue(entry, 'wins');
  const losses = statValue(entry, 'losses');
  const ties = statValue(entry, 'ties') ?? 0;
  const pointsFor = statValue(entry, 'pointsFor', 'avgPointsFor');
  const pointsAgainst = statValue(entry, 'pointsAgainst', 'avgPointsAgainst');
  const games = (wins ?? 0) + (losses ?? 0) + (ties ?? 0);
  return {
    team_id: teamId,
    team_abbr: team.abbreviation ?? meta.abbr ?? null,
    team_name: team.displayName ?? meta.name ?? null,
    conference: meta.conference ?? null,
    division: meta.division ?? null,
    wins, losses, ties,
    win_pct: statValue(entry, 'winPercent'),
    points_for: pointsFor,
    points_against: pointsAgainst,
    point_diff: statValue(entry, 'differential', 'pointDifferential'),
    ppg_for: pointsFor != null && games > 0 ? Math.round((pointsFor / games) * 10) / 10 : null,
    ppg_against: pointsAgainst != null && games > 0 ? Math.round((pointsAgainst / games) * 10) / 10 : null,
    streak: statValue(entry, 'streak'),
    games_played: games,
  };
}

async function fetchStandings(season) {
  const url = `${ESPN_STANDINGS_URL}?season=${season}&level=3`;
  const data = await espnFetch(url, { label: `standings ${season}`, timeoutMs: 10000 });
  const entries = collectStandingEntries(data);
  return entries.map(mapStandingEntry).filter(e => e.team_id != null);
}

/**
 * getNflStandings(season) → { season, conferences: { AFC:[...], NFC:[...] }, teams:[...] }
 */
export async function getNflStandings(season = null) {
  const yr = season ?? (await getCurrentNflWeek()).season;
  const cacheKey = `standings:${yr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const teams = await fetchStandings(yr);
    const conferences = { AFC: [], NFC: [] };
    for (const t of teams) {
      if (t.conference && conferences[t.conference]) conferences[t.conference].push(t);
    }
    const result = { season: yr, conferences, teams, fetchedAt: new Date().toISOString() };
    cacheSet(cacheKey, result, TTL.STANDINGS);
    console.log(`[nfl-api] standings ${yr}: ${teams.length} teams`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nfl-api] standings ${yr} failed (${err.message}) — serving stale`);
      return stale;
    }
    console.error(`[nfl-api] standings ${yr} failed (${err.message}) — returning empty`);
    return { season: yr, conferences: { AFC: [], NFC: [] }, teams: [], fetchedAt: null };
  }
}

/**
 * getNflTeamStats(season) → array of per-team season stats.
 * Derived from standings (records + points for/against). EPA/success/PROE
 * are left null here and filled by the nflverse advanced fetcher (Sprint 9b+).
 */
export async function getNflTeamStats(season = null) {
  const yr = season ?? (await getCurrentNflWeek()).season;
  const cacheKey = `team_stats:${yr}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const standings = await getNflStandings(yr);
  const teams = (standings.teams ?? []).map(t => ({
    team_id: t.team_id,
    team_abbr: t.team_abbr,
    team_name: t.team_name,
    conference: t.conference,
    division: t.division,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    win_pct: t.win_pct,
    points_for: t.points_for,
    points_against: t.points_against,
    point_diff: t.point_diff,
    ppg_for: t.ppg_for,
    ppg_against: t.ppg_against,
    games_played: t.games_played,
    // nflverse-sourced (filled later):
    epa_off: null,
    epa_def: null,
    success_rate_off: null,
    success_rate_def: null,
    proe: null,
    pace_sec_play: null,
    plays_per_game: null,
  }));
  cacheSet(cacheKey, teams, TTL.TEAM_STATS);
  return teams;
}

// ── Recent games (form) ─────────────────────────────────────────────────────────

/**
 * getNflTeamRecentGames(teamId, season, lastN) → array of recent COMPLETED games,
 * most-recent first: { game_date, opponent, home_away, result, points_for, points_against }.
 */
export async function getNflTeamRecentGames(teamId, season = null, lastN = 6) {
  const id = Number(teamId);
  if (!Number.isFinite(id)) return [];
  const yr = season ?? (await getCurrentNflWeek()).season;
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
      const pf = Number(self.score?.value ?? self.score);
      const pa = Number(opp.score?.value ?? opp.score);
      const won = self.winner === true || (Number.isFinite(pf) && Number.isFinite(pa) && pf > pa);
      const lost = opp.winner === true || (Number.isFinite(pf) && Number.isFinite(pa) && pf < pa);
      games.push({
        game_date: ev.date ? String(ev.date).slice(0, 10) : null,
        opponent: opp.team?.abbreviation ?? null,
        home_away: self.homeAway ?? null,
        result: won ? 'W' : lost ? 'L' : 'T',
        points_for: Number.isFinite(pf) ? pf : null,
        points_against: Number.isFinite(pa) ? pa : null,
      });
    }
    games.sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)));
    cacheSet(cacheKey, games, TTL.RECENT_GAMES);
    return games.slice(0, lastN);
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) return stale.slice(0, lastN);
    console.warn(`[nfl-api] recent games team ${id} failed (${err.message}) — empty`);
    return [];
  }
}

// ── Injuries (ESPN league feed — same shape as NBA) ────────────────────────────

function normaliseInjuryStatus(value) {
  const s = String(value ?? '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('injured reserve') || s === 'ir')              return 'out_for_season';
  if (s.includes('physically unable') || s.includes('pup'))     return 'out';
  if (s.includes('out for season'))                             return 'out_for_season';
  if (s.includes('suspend'))                                    return 'out';
  if (s.includes('out'))                                        return 'out';
  if (s.includes('doubt'))                                      return 'doubtful';
  if (s.includes('quest'))                                      return 'questionable';
  if (s.includes('prob'))                                       return 'probable';
  if (s.includes('day'))                                        return 'day_to_day';
  if (s.includes('game time') || s.includes('time decision'))   return 'game_time_decision';
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
 * getNflLeagueInjuries() → { byTeamId, byAbbr, fetchedAt, source, stale }.
 * Resilient: serves stale cache on failure, never throws.
 */
export async function getNflLeagueInjuries() {
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
    console.log(`[nfl-api] injuries (ESPN): ${teams.length} teams, ${total} entries`);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) {
      console.warn(`[nfl-api] injuries failed (${err.message}) — serving stale`);
      return { ...stale, stale: true };
    }
    console.warn(`[nfl-api] injuries failed (${err.message}) — no cache`);
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

// ── Game summary (live + resolution; consumed in Sprints 9.2 / 9c) ─────────────

/**
 * getNflGameSummary(eventId) → normalized live/final state composed from ESPN's
 * summary endpoint (boxscore + winprobability + drives). Minimal here; the live
 * tracker and resolver (later sprints) extend the consumption.
 */
export async function getNflGameSummary(eventId) {
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
      last_play: data.drives?.current?.plays?.slice(-1)?.[0]?.text ?? null,
      fetchedAt: new Date().toISOString(),
    };
    const ttl = mapped.game_status_id === 2 ? TTL.SUMMARY_LIVE : TTL.WEEK_GAMES;
    cacheSet(cacheKey, result, ttl);
    return result;
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) return stale;
    console.warn(`[nfl-api] summary ${eventId} failed (${err.message})`);
    return null;
  }
}
