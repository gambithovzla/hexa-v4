/**
 * nfl-context-builder.js — assembles a rich game context payload for NFL picks.
 *
 * Mirrors nba-context-builder.js, scoped to NFL. Consumes nfl-api.js for team
 * stats (standings-derived), recent form, and ESPN injuries, plus Open-Meteo for
 * outdoor weather. Always returns a `context_meta` block exposing data freshness
 * and completeness so the admin UI and downstream guards can gate on quality.
 *
 * NFL-specific shape vs NBA:
 *   - rest/short-week/off-bye derived from the schedule (weekly cadence)
 *   - QB availability surfaced explicitly from injuries (the dominant variable)
 *   - weather (wind/cold) for non-dome home venues; domes are weather-neutral
 *   - EPA/success/PROE fields are present but null until the nflverse fetcher (9b+)
 */

import {
  getNflTeamStats,
  getNflTeamRecentGames,
  getNflLeagueInjuries,
  findTeamInjuries,
} from './nfl-api.js';
import { getNflAdvancedTeamStats, findAdvancedStats } from './nfl-advanced-fetcher.js';
import { resolveNflTeamId, getNflTeam, getNflStadium } from './nfl-team-map.js';

/** NFL season year for a calendar date (Sep–Feb belongs to the Sep year). */
function seasonFromDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 8 ? y : y - 1;
}

function diffDays(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return null;
  const a = new Date(fromDateStr);
  const b = new Date(toDateStr);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function recentFormSummary(games) {
  if (!games?.length) return null;
  const wins = games.filter(g => g.result === 'W').length;
  const losses = games.filter(g => g.result === 'L').length;
  const ties = games.filter(g => g.result === 'T').length;
  const pf = games.filter(g => g.points_for != null);
  const pa = games.filter(g => g.points_against != null);
  const avg = arr => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null);
  return {
    record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
    avgPointsFor: avg(pf.map(g => g.points_for)),
    avgPointsAgainst: avg(pa.map(g => g.points_against)),
    games: games.map(g => ({
      date: g.game_date,
      opponent: g.opponent,
      homeAway: g.home_away,
      result: g.result,
      pointsFor: g.points_for,
      pointsAgainst: g.points_against,
    })),
  };
}

function rankInjuriesBySeverity(injuries) {
  const order = { out_for_season: 0, out: 1, doubtful: 2, questionable: 3, game_time_decision: 4, probable: 5, day_to_day: 6, unknown: 7 };
  return [...injuries].sort((a, b) => (order[a.statusKey] ?? 99) - (order[b.statusKey] ?? 99));
}

function summariseInjuries(record) {
  if (!record || !Array.isArray(record.injuries)) {
    return { ok: false, count: 0, items: [], severeCount: 0, qbStatus: null };
  }
  const items = rankInjuriesBySeverity(record.injuries);
  const severeCount = items.filter(i => ['out', 'doubtful', 'out_for_season'].includes(i.statusKey)).length;
  // QB is the dominant NFL variable — surface the most severe QB injury, if any.
  const qb = items.find(i => String(i.position).toUpperCase() === 'QB');
  const qbStatus = qb ? { playerName: qb.playerName, status: qb.status, statusKey: qb.statusKey } : null;
  return { ok: true, count: items.length, items, severeCount, qbStatus };
}

function fractionPresent(...vals) {
  const total = vals.length || 1;
  const present = vals.filter(v => v != null).length;
  return Math.round((present / total) * 100) / 100;
}

// ── Weather (Open-Meteo direct; weather-api.js is MLB-coupled/frozen) ──────────

function nflWeatherFlags(temp, wind, precip) {
  const flags = [];
  if (wind != null) {
    if (wind > 20)      flags.push(`HIGH WIND ${wind}mph — suppresses passing & long FGs, favor UNDER/run`);
    else if (wind > 15) flags.push(`WIND ${wind}mph — modest passing/kicking impact`);
  }
  if (temp != null) {
    if (temp < 20)      flags.push(`EXTREME COLD ${temp}°F — ball-handling/passing degraded, favor UNDER`);
    else if (temp < 32) flags.push(`FREEZING ${temp}°F — run-leaning script likely`);
  }
  if (precip != null && precip > 60) flags.push(`PRECIP ${precip}% — ball security risk, favor UNDER/run`);
  return flags;
}

async function fetchNflWeather({ lat, lon, gameTime }) {
  if (lat == null || lon == null) return null;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,weathercode` +
      `&windspeed_unit=mph&temperature_unit=fahrenheit&timezone=auto&forecast_days=2`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let data;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } finally {
      clearTimeout(timeout);
    }
    const times = data.hourly?.time ?? [];
    if (!times.length) return null;
    const gameHour = gameTime ? new Date(gameTime).getHours() : 13;
    let idx = times.findIndex(t => new Date(t).getHours() >= gameHour);
    if (idx === -1) idx = times.length - 1;
    const temp = data.hourly.temperature_2m?.[idx] ?? null;
    const wind = data.hourly.windspeed_10m?.[idx] ?? null;
    const precip = data.hourly.precipitation_probability?.[idx] ?? null;
    return {
      temperature: temp,
      windSpeed: wind,
      windDirection: data.hourly.winddirection_10m?.[idx] ?? null,
      precipitationProbability: precip,
      weatherCode: data.hourly.weathercode?.[idx] ?? null,
      analysis: nflWeatherFlags(temp, wind, precip),
    };
  } catch (err) {
    console.warn(`[nfl-context] weather fetch failed: ${err.message}`);
    return null;
  }
}

function lookupTeamStats(teamStats, teamId, teamAbbr) {
  if (!Array.isArray(teamStats) || teamStats.length === 0) return null;
  if (teamId != null) {
    const byId = teamStats.find(t => String(t.team_id) === String(teamId));
    if (byId) return byId;
  }
  if (teamAbbr) {
    const byAbbr = teamStats.find(t => String(t.team_abbr).toUpperCase() === String(teamAbbr).toUpperCase());
    if (byAbbr) return byAbbr;
  }
  return null;
}

/**
 * Cumulative schedule fatigue from the recent games: games & road games in the
 * last 14 days plus short-rest games.
 *
 * NFL teams never play on back-to-back calendar days, so the MLB notion of
 * "consecutive days played" is meaningless here (every Thu/Sun/Mon gap is 3-4
 * days, which the old ≤4-day streak check wrongly flagged as fatigue for every
 * single game). The real NFL fatigue signal is the SHORT WEEK: a game played on
 * ≤6 days rest from the prior game. We count those within the 14-day window.
 */
function buildFatigueBlock(recentGames, gameDate) {
  const empty = { gamesLast14d: 0, roadGamesLast14d: 0, shortRestGames: 0 };
  if (!recentGames?.length) return empty;
  const cutoff = gameDate ? new Date(new Date(gameDate).getTime() - 14 * 24 * 60 * 60 * 1000) : null;
  const recent = cutoff
    ? recentGames.filter(g => g.game_date && new Date(g.game_date) >= cutoff)
    : recentGames.slice(0, 3);
  const roadGames = recent.filter(g => g.home_away === 'away').length;

  // Walk chronologically and count games that followed the prior game on short
  // rest (≤6 days), restricted to those that fall inside the 14-day window.
  const chrono = recentGames
    .filter(g => g.game_date)
    .slice()
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date));
  let shortRestGames = 0;
  for (let i = 1; i < chrono.length; i++) {
    const gap = diffDays(chrono[i - 1].game_date, chrono[i].game_date);
    if (gap == null || gap > 6) continue;
    if (!cutoff || new Date(chrono[i].game_date) >= cutoff) shortRestGames++;
  }

  return {
    gamesLast14d: recent.length,
    roadGamesLast14d: roadGames,
    shortRestGames,
  };
}

/** Detect a backup QB in the injury list (the non-starter QB, if starter is out). */
function detectBackupQb(injuries) {
  if (!injuries?.items) return null;
  const qbs = injuries.items.filter(i => String(i.position).toUpperCase() === 'QB');
  if (qbs.length < 2) return null;
  // starter is the most severe; second QB by severity = backup
  const backup = qbs[1];
  return backup ? { playerName: backup.playerName, status: backup.status } : null;
}

function buildTeamBlock(stats, recentGames, injuries, teamId, teamAbbr, gameDate, advanced = null) {
  const meta = getNflTeam({ teamId, teamAbbr }) ?? {};
  const lastGame = recentGames[0] ?? null;
  const rest = diffDays(lastGame?.game_date, gameDate);
  const epaOff = advanced?.epa_off ?? stats?.epa_off ?? null;
  const epaDef = advanced?.epa_def ?? stats?.epa_def ?? null;
  const successRateOff = advanced?.success_rate_off ?? stats?.success_rate_off ?? null;
  const successRateDef = advanced?.success_rate_def ?? stats?.success_rate_def ?? null;
  const proe = advanced?.proe ?? stats?.proe ?? null;
  return {
    teamId: teamId ?? null,
    teamAbbr: stats?.team_abbr ?? teamAbbr ?? meta.abbr ?? null,
    teamName: stats?.team_name ?? meta.name ?? null,
    conference: stats?.conference ?? meta.conference ?? null,
    division: stats?.division ?? meta.division ?? null,
    record: stats ? `${stats.wins ?? 0}-${stats.losses ?? 0}${stats.ties ? `-${stats.ties}` : ''}` : null,
    pointsForPerGame: stats?.ppg_for ?? null,
    pointsAgainstPerGame: stats?.ppg_against ?? null,
    pointDiff: stats?.point_diff ?? null,
    // nflverse-sourced advanced metrics (overlaid from the ML sidecar):
    epaOff,
    epaDef,
    successRateOff,
    successRateDef,
    successRate: successRateOff,
    proe,
    playsPerGame: advanced?.plays_per_game ?? null,
    pace: stats?.pace_sec_play ?? null,
    // Situational/efficiency metrics from nflverse (new — Sprint 9.4):
    redZoneTdPctOff: advanced?.red_zone_td_pct_off ?? null,
    redZoneTdPctDef: advanced?.red_zone_td_pct_def ?? null,
    thirdDownConvOff: advanced?.third_down_conv_off ?? null,
    thirdDownConvDef: advanced?.third_down_conv_def ?? null,
    sackRateOff: advanced?.sack_rate_off ?? null,   // sacks allowed per dropback
    sackRateDef: advanced?.sack_rate_def ?? null,   // sacks forced per dropback
    restDays: rest,
    isShortWeek: rest != null ? rest <= 5 : null,
    isOffBye: rest != null ? rest >= 13 : null,
    scheduleFatigue: buildFatigueBlock(recentGames, gameDate),
    recentForm: recentFormSummary(recentGames),
    injuries,
    qbStatus: injuries.qbStatus,
    backupQb: detectBackupQb(injuries),
  };
}

/**
 * buildNflGameContext({ homeTeamId, awayTeamId, homeTeamAbbr, awayTeamAbbr, gameDate, gameTime?, season?, marketOdds? })
 *
 * Returns { season, gameDate, home, away, weather, context_meta }.
 */
export async function buildNflGameContext({
  homeTeamId,
  awayTeamId,
  homeTeamAbbr = null,
  awayTeamAbbr = null,
  gameDate,
  gameTime = null,
  season = null,
  marketOdds = null,
}) {
  const startedAt = Date.now();

  const homeId = resolveNflTeamId({ teamId: homeTeamId, teamAbbr: homeTeamAbbr });
  const awayId = resolveNflTeamId({ teamId: awayTeamId, teamAbbr: awayTeamAbbr });
  const stadium = getNflStadium({ teamId: homeId, teamAbbr: homeTeamAbbr });
  const isDome = stadium?.dome === true;

  const advSeason = season ?? seasonFromDate(gameDate);

  const [teamStats, homeGames, awayGames, injuriesPayload, weather, advancedStats] = await Promise.all([
    getNflTeamStats(season).catch(err => {
      console.warn(`[nfl-context] team stats failed: ${err.message}`);
      return [];
    }),
    getNflTeamRecentGames(homeId, season, 6).catch(err => {
      console.warn(`[nfl-context] home recent games failed: ${err.message}`);
      return [];
    }),
    getNflTeamRecentGames(awayId, season, 6).catch(err => {
      console.warn(`[nfl-context] away recent games failed: ${err.message}`);
      return [];
    }),
    getNflLeagueInjuries().catch(err => {
      console.warn(`[nfl-context] injuries failed: ${err.message}`);
      return { byTeamId: {}, byAbbr: {}, fetchedAt: null, source: 'unavailable', stale: true };
    }),
    isDome
      ? Promise.resolve(null)
      : fetchNflWeather({ lat: stadium?.lat, lon: stadium?.lon, gameTime }),
    getNflAdvancedTeamStats(advSeason).catch(err => {
      console.warn(`[nfl-context] advanced stats failed: ${err.message}`);
      return null;
    }),
  ]);

  const homeStats = lookupTeamStats(teamStats, homeId, homeTeamAbbr);
  const awayStats = lookupTeamStats(teamStats, awayId, awayTeamAbbr);

  const homeAdvanced = findAdvancedStats(advancedStats, homeStats?.team_abbr ?? homeTeamAbbr);
  const awayAdvanced = findAdvancedStats(advancedStats, awayStats?.team_abbr ?? awayTeamAbbr);

  const homeInjuries = summariseInjuries(findTeamInjuries(injuriesPayload, { teamId: homeId, teamAbbr: homeTeamAbbr }));
  const awayInjuries = summariseInjuries(findTeamInjuries(injuriesPayload, { teamId: awayId, teamAbbr: awayTeamAbbr }));

  const home = buildTeamBlock(homeStats, homeGames, homeInjuries, homeId, homeTeamAbbr, gameDate, homeAdvanced);
  const away = buildTeamBlock(awayStats, awayGames, awayInjuries, awayId, awayTeamAbbr, gameDate, awayAdvanced);

  const weatherBlock = isDome
    ? { dome: true, stadium: stadium?.stadium ?? null, surface: stadium?.surface ?? null, altitude: stadium?.altitude ?? null, neutral: true, analysis: [] }
    : weather
      ? { dome: false, stadium: stadium?.stadium ?? null, surface: stadium?.surface ?? null, altitude: stadium?.altitude ?? null, ...weather }
      : { dome: false, stadium: stadium?.stadium ?? null, surface: stadium?.surface ?? null, altitude: stadium?.altitude ?? null, neutral: false, unavailable: true, analysis: [] };

  const staleFlags = [];
  if (!homeStats) staleFlags.push('home_team_stats_missing');
  if (!awayStats) staleFlags.push('away_team_stats_missing');
  if (!homeGames.length) staleFlags.push('home_recent_games_missing');
  if (!awayGames.length) staleFlags.push('away_recent_games_missing');
  if (injuriesPayload.source === 'unavailable') staleFlags.push('injuries_unavailable');
  else if (injuriesPayload.stale) staleFlags.push('injuries_stale');
  if (!homeInjuries.qbStatus && !awayInjuries.qbStatus) { /* no QB flags = healthy starters assumed */ }
  if (!isDome && (!weather)) staleFlags.push('weather_unavailable');
  if (!marketOdds) staleFlags.push('market_odds_missing');
  const advancedOk = !!(home.epaOff != null && away.epaOff != null);
  const situationalOk = !!(home.redZoneTdPctOff != null && away.redZoneTdPctOff != null);
  const trenchesOk = !!(home.sackRateDef != null && away.sackRateDef != null);
  if (!advancedOk) staleFlags.push('advanced_stats_unavailable');
  else if (advancedStats?.isFallback) staleFlags.push('advanced_stats_prior_season');
  if (!situationalOk) staleFlags.push('situational_stats_unavailable');

  const completeness = {
    teamStats: fractionPresent(homeStats, awayStats),
    advancedStats: fractionPresent(home.epaOff, away.epaOff),
    situationalStats: fractionPresent(home.redZoneTdPctOff, away.redZoneTdPctOff, home.thirdDownConvOff, away.thirdDownConvOff),
    trenchStats: fractionPresent(home.sackRateDef, away.sackRateDef),
    recentForm: fractionPresent(homeGames.length ? 1 : null, awayGames.length ? 1 : null),
    injuries: injuriesPayload.source === 'espn' ? 1 : 0,
    weather: isDome ? 1 : (weather ? 1 : 0),
    marketOdds: marketOdds ? 1 : 0,
  };
  const overall = +(
    (completeness.teamStats * 0.20 +
     completeness.advancedStats * 0.18 +
     completeness.situationalStats * 0.12 +
     completeness.trenchStats * 0.10 +
     completeness.recentForm * 0.18 +
     completeness.injuries * 0.12 +
     completeness.weather * 0.05 +
     completeness.marketOdds * 0.05).toFixed(2)
  );

  const context_meta = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    teamIds: {
      home: { input: homeTeamId ?? null, resolved: homeId ?? null },
      away: { input: awayTeamId ?? null, resolved: awayId ?? null },
    },
    sources: {
      teamStats: { ok: !!(homeStats && awayStats), source: 'espn-standings', n: teamStats.length },
      advancedStats: {
        ok: advancedOk,
        source: advancedStats ? 'nflverse-sidecar' : 'unavailable',
        season: advancedStats?.season ?? advSeason ?? null,
        requestedSeason: advSeason ?? null,
        // true when the requested season had no nflverse PBP yet (off-season /
        // early season) and we fell back to the last completed season.
        isFallback: advancedStats?.isFallback ?? false,
        fetchedAt: advancedStats?.fetchedAt ?? null,
      },
      recentForm: { ok: !!(homeGames.length && awayGames.length), source: 'espn', n: { home: homeGames.length, away: awayGames.length } },
      injuries: {
        ok: injuriesPayload.source === 'espn',
        source: injuriesPayload.source,
        stale: !!injuriesPayload.stale,
        fetchedAt: injuriesPayload.fetchedAt,
        count: { home: homeInjuries.count, away: awayInjuries.count },
        severe: { home: homeInjuries.severeCount, away: awayInjuries.severeCount },
        qb: { home: homeInjuries.qbStatus, away: awayInjuries.qbStatus },
      },
      weather: { ok: isDome || !!weather, source: isDome ? 'dome' : (weather ? 'open-meteo' : 'unavailable'), dome: isDome },
      marketOdds: { ok: !!marketOdds, source: marketOdds?.source ?? null, provided: marketOdds ? (marketOdds.provided ?? 'server') : null },
    },
    completeness,
    overallCompleteness: overall,
    staleFlags,
  };

  return { season, gameDate, home, away, weather: weatherBlock, context_meta };
}
