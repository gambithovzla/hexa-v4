/**
 * MLB Stats API client
 * Base URL: https://statsapi.mlb.com/api/v1
 *
 * Exported functions:
 *   getTodayGames(date?)     — partidos del día, normalizados
 *   getTeams()               — 30 equipos MLB (cacheado en memoria)
 *   getPitcherStats(id)      — stats de temporada de un pitcher
 *   getTeamHittingStats(id)  — stats ofensivas de un equipo
 */

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const SEASON = new Date().getFullYear();

// ---------------------------------------------------------------------------
// Caché en memoria para getTodayGames — evita spam a la API de MLB
// TTL: 10 minutos por fecha. Formato: Map<dateStr, { data, expiresAt }>
// ---------------------------------------------------------------------------
const gamesCache = new Map();
const GAMES_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

// Seasons to try in order — current year may have no data early in calendar year
const SEASON_FALLBACK = SEASON >= 2026 ? [SEASON, 2025, 2024] : [SEASON, SEASON - 1];

// 3 seasons for historical trend analysis (most recent first) — keeps API calls manageable
const HISTORICAL_SEASONS = SEASON >= 2026
  ? [2025, 2024, 2023]
  : [SEASON, SEASON - 1, SEASON - 2];

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

async function fetchJSON(url, timeoutMs = 10_000) {
  console.log(`[MLB API] GET ${url}`);
  let res;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message;
    console.error(`[MLB API] Network error → ${url}:`, msg);
    throw new Error(`Network error al conectar con la API de MLB: ${msg}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[MLB API] HTTP ${res.status} → ${url}`, body.slice(0, 200));
    throw new Error(`MLB API respondió con ${res.status} para ${url}`);
  }

  try {
    return await res.json();
  } catch (err) {
    console.error(`[MLB API] JSON inválido → ${url}:`, err.message);
    throw new Error(`Respuesta JSON inválida desde la API de MLB`);
  }
}

// ---------------------------------------------------------------------------
// Normalización de datos
// ---------------------------------------------------------------------------

/**
 * Extrae los campos relevantes de un pitcher probable crudo.
 */
function normalizeProbablePitcher(raw) {
  if (!raw) return null;
  return {
    id: raw.id ?? null,
    fullName: raw.fullName ?? 'TBD',
    throwingHand: raw.pitchHand?.code ?? null,
  };
}

/**
 * Normalises a lineup player array from the hydrated lineups field.
 */
function normalizeLineup(players) {
  if (!Array.isArray(players) || players.length === 0) return [];
  return players
    .map(p => ({
      id:           p.id           ?? p.person?.id        ?? null,
      fullName:     p.fullName     ?? p.person?.fullName  ?? p.name ?? null,
      position:     p.position?.abbreviation ?? p.pos     ?? null,
      battingOrder: p.battingOrder ?? null,
    }))
    .sort((a, b) => (a.battingOrder ?? 999) - (b.battingOrder ?? 999));
}

/**
 * Normaliza un juego crudo del endpoint /schedule en un objeto limpio.
 */
function normalizeGame(game) {
  const home = game.teams?.home ?? {};
  const away = game.teams?.away ?? {};

  // Lineup extraction — hydrate=lineups populates game.lineups
  const rawLineups  = game.lineups ?? null;
  const homeLineup  = normalizeLineup(rawLineups?.homePlayers ?? rawLineups?.home ?? []);
  const awayLineup  = normalizeLineup(rawLineups?.awayPlayers ?? rawLineups?.away ?? []);

  let lineupStatus = 'unavailable';
  if (homeLineup.length > 0 || awayLineup.length > 0) lineupStatus = 'confirmed';
  else if (home.probablePitcher || away.probablePitcher)  lineupStatus = 'probable';

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,                         // ISO 8601 UTC
    gameTime: game.gameDate
      ? new Date(game.gameDate).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : null,
    status: {
      code: game.status?.statusCode ?? null,
      description: game.status?.detailedState ?? 'Unknown',
      // Valores posibles: 'scheduled', 'live', 'final', 'postponed', etc.
      simplified: simplifyStatus(game.status?.abstractGameState),
    },
    venue: {
      id: game.venue?.id ?? null,
      name: game.venue?.name ?? null,
    },
    teams: {
      home: {
        id: home.team?.id ?? null,
        name: home.team?.name ?? null,
        abbreviation: home.team?.abbreviation ?? null,
        score: home.score ?? null,
        probablePitcher: normalizeProbablePitcher(home.probablePitcher),
        leagueRecord: home.leagueRecord ?? null,
      },
      away: {
        id: away.team?.id ?? null,
        name: away.team?.name ?? null,
        abbreviation: away.team?.abbreviation ?? null,
        score: away.score ?? null,
        probablePitcher: normalizeProbablePitcher(away.probablePitcher),
        leagueRecord: away.leagueRecord ?? null,
      },
    },
    linescore: game.linescore ?? null,
    seriesDescription: game.seriesDescription ?? null,
    gamesInSeries: game.gamesInSeries ?? null,
    seriesGameNumber: game.seriesGameNumber ?? null,
    lineupStatus,
    lineups: { home: homeLineup, away: awayLineup },
  };
}

function simplifyStatus(abstractState) {
  switch (abstractState) {
    case 'Live':    return 'live';
    case 'Final':   return 'final';
    case 'Preview': return 'scheduled';
    default:        return 'scheduled';
  }
}

/**
 * Normaliza un equipo crudo del endpoint /teams.
 */
function normalizeTeam(team) {
  return {
    id: team.id,
    name: team.name,
    abbreviation: team.abbreviation ?? null,
    teamName: team.teamName ?? null,       // e.g. "Yankees" (sin ciudad)
    locationName: team.locationName ?? null,
    division: team.division?.name ?? null,
    league: team.league?.name ?? null,
    venue: team.venue?.name ?? null,
  };
}

/**
 * Extrae las stats relevantes de un pitcher desde la respuesta cruda.
 * Devuelve el primer bloque de stats de temporada encontrado.
 */
function normalizePitcherStats(data) {
  const stats = data.stats ?? [];
  const seasonStats = stats.find(s => s.type?.displayName === 'season');
  const splits = seasonStats?.splits ?? [];
  const totals = splits[0]?.stat ?? {};

  return {
    era: totals.era ?? null,
    whip: totals.whip ?? null,
    wins: totals.wins ?? null,
    losses: totals.losses ?? null,
    inningsPitched: totals.inningsPitched ?? null,
    strikeOuts: totals.strikeOuts ?? null,
    baseOnBalls: totals.baseOnBalls ?? null,
    hits: totals.hits ?? null,
    homeRuns: totals.homeRuns ?? null,
    strikeoutsPer9Inn: totals.strikeoutsPer9Inn ?? null,
    walksPer9Inn: totals.walksPer9Inn ?? null,
    hitsPer9Inn: totals.hitsPer9Inn ?? null,
    obp: totals.obp ?? null,
    ops: totals.ops ?? null,
    gamesStarted: totals.gamesStarted ?? null,
    gamesPitched: totals.gamesPitched ?? null,
  };
}

/**
 * Extrae las stats ofensivas relevantes de un equipo.
 */
function normalizeHittingStats(data) {
  const stats = data.stats ?? [];
  const seasonStats = stats.find(s => s.type?.displayName === 'season');
  const splits = seasonStats?.splits ?? [];
  const totals = splits[0]?.stat ?? {};

  return {
    avg: totals.avg ?? null,
    obp: totals.obp ?? null,
    slg: totals.slg ?? null,
    ops: totals.ops ?? null,
    runs: totals.runs ?? null,
    hits: totals.hits ?? null,
    homeRuns: totals.homeRuns ?? null,
    rbi: totals.rbi ?? null,
    strikeOuts: totals.strikeOuts ?? null,
    baseOnBalls: totals.baseOnBalls ?? null,
    stolenBases: totals.stolenBases ?? null,
    leftOnBase: totals.leftOnBase ?? null,
    atBats: totals.atBats ?? null,
    gamesPlayed: totals.gamesPlayed ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cache en memoria para los 30 equipos (no cambia en temporada)
// ---------------------------------------------------------------------------

let teamsCache = null;

// ---------------------------------------------------------------------------
// Funciones exportadas
// ---------------------------------------------------------------------------

/**
 * Trae los partidos del día (o de la fecha indicada) normalizados.
 * @param {string} [date] — formato YYYY-MM-DD; default: hoy
 * @returns {Promise<Array>}
 */
export async function getTodayGames(date) {
  const targetDate = date ?? new Date().toISOString().split('T')[0];

  // Servir desde caché si no ha expirado
  const cached = gamesCache.get(targetDate);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[MLB API] Partidos para ${targetDate} servidos desde caché (expira en ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
    return cached.data;
  }

  const url =
    `${MLB_BASE}/schedule` +
    `?date=${targetDate}` +
    `&sportId=1` +
    `&hydrate=team,linescore,probablePitcher,lineups`;

  try {
    const data = await fetchJSON(url);
    const rawGames = (data.dates ?? []).flatMap(d => d.games ?? []);
    const games = rawGames.map(normalizeGame);
    console.log(`[MLB API] ${games.length} partidos encontrados para ${targetDate} — guardados en caché por 10 min`);

    // Guardar en caché
    gamesCache.set(targetDate, { data: games, expiresAt: Date.now() + GAMES_CACHE_TTL_MS });

    return games;
  } catch (err) {
    console.error('[MLB API] Error en getTodayGames:', err.message);
    throw err;
  }
}

/**
 * Devuelve los 30 equipos MLB.
 * Cacheado en memoria: se solicita una sola vez por proceso.
 * @returns {Promise<Array>}
 */
export async function getTeams() {
  if (teamsCache) {
    console.log('[MLB API] Equipos servidos desde caché');
    return teamsCache;
  }

  const url = `${MLB_BASE}/teams?sportId=1`;
  try {
    const data = await fetchJSON(url);
    const teams = (data.teams ?? []).map(normalizeTeam);
    teamsCache = teams;
    console.log(`[MLB API] ${teams.length} equipos cacheados en memoria`);
    return teams;
  } catch (err) {
    console.error('[MLB API] Error en getTeams:', err.message);
    throw err;
  }
}

/**
 * Stats de temporada de un pitcher.
 * @param {number|string} pitcherId
 * @returns {Promise<object>}
 */
export async function getPitcherStats(pitcherId) {
  if (!pitcherId) throw new Error('getPitcherStats: pitcherId es requerido');

  for (const season of SEASON_FALLBACK) {
    try {
      const url = `${MLB_BASE}/people/${pitcherId}/stats?stats=season&season=${season}&group=pitching`;
      const data = await fetchJSON(url);
      const splits = data.stats?.find(s => s.type?.displayName === 'season')?.splits ?? [];
      if (splits.length > 0) {
        const stats = normalizePitcherStats(data);
        console.log(`[MLB API] Pitcher ${pitcherId} stats loaded from season ${season} (ERA: ${stats.era})`);
        return { pitcherId, season, stats };
      }
      console.log(`[MLB API] Season ${season} returned empty splits for pitcher ${pitcherId} — trying next`);
    } catch (err) {
      console.log(`[MLB API] Season ${season} failed for pitcher ${pitcherId}: ${err.message}`);
    }
  }

  console.warn(`[MLB API] No stats found for pitcher ${pitcherId} in seasons: ${SEASON_FALLBACK.join(', ')}`);
  return null;
}

/**
 * Stats ofensivas de temporada de un equipo.
 * @param {number|string} teamId
 * @returns {Promise<object>}
 */
export async function getTeamHittingStats(teamId) {
  if (!teamId) throw new Error('getTeamHittingStats: teamId es requerido');

  for (const season of SEASON_FALLBACK) {
    try {
      const url = `${MLB_BASE}/teams/${teamId}/stats?stats=season&season=${season}&group=hitting`;
      const data = await fetchJSON(url);
      const splits = data.stats?.find(s => s.type?.displayName === 'season')?.splits ?? [];
      if (splits.length > 0) {
        const stats = normalizeHittingStats(data);
        console.log(`[MLB API] Team ${teamId} hitting stats loaded from season ${season} (AVG: ${stats.avg})`);
        return { teamId, season, stats };
      }
      console.log(`[MLB API] Season ${season} returned empty splits for team ${teamId} — trying next`);
    } catch (err) {
      console.log(`[MLB API] Season ${season} failed for team ${teamId}: ${err.message}`);
    }
  }

  console.warn(`[MLB API] No hitting stats found for team ${teamId} in seasons: ${SEASON_FALLBACK.join(', ')}`);
  return null;
}

// ---------------------------------------------------------------------------
// Historical stats — collects up to 5 past seasons for trend analysis
// ---------------------------------------------------------------------------

/**
 * Fetches pitcher stats for HISTORICAL_SEASONS sequentially (avoids rate limiting).
 * Returns { pitcherId, season, stats, historical: [{season, era, whip, k9, bb9, hr9},...] }
 */
export async function getPitcherHistoricalStats(pitcherId) {
  if (!pitcherId) return null;

  const seasons = [];
  for (const season of HISTORICAL_SEASONS) {
    try {
      const data = await fetchJSON(`${MLB_BASE}/people/${pitcherId}/stats?stats=season&season=${season}&group=pitching`);
      const splits = data.stats?.find(s => s.type?.displayName === 'season')?.splits ?? [];
      if (splits.length > 0) seasons.push({ season, stats: normalizePitcherStats(data) });
    } catch (_) { /* season unavailable — continue */ }
    await new Promise(r => setTimeout(r, 100));
  }

  if (seasons.length === 0) return null;

  const histLog = seasons.map(s => `${s.season}(ERA:${s.stats.era})`).join(', ');
  console.log(`[MLB API] Pitcher ${pitcherId} historical: ${histLog}`);

  const current = seasons[0];
  const historical = seasons.slice(1).map(({ season, stats: s }) => {
    const ip  = parseFloat(s.inningsPitched ?? 0);
    const hr9 = s.homeRuns != null && ip > 0 ? ((s.homeRuns / ip) * 9).toFixed(2) : null;
    return { season, era: s.era, whip: s.whip, k9: s.strikeoutsPer9Inn, bb9: s.walksPer9Inn, hr9 };
  });

  return { pitcherId, season: current.season, stats: current.stats, historical };
}

/**
 * Fetches team hitting stats for HISTORICAL_SEASONS sequentially (avoids rate limiting).
 * Returns { teamId, season, stats, historical: [{season, avg, ops, hr, runs},...] }
 */
export async function getTeamHittingHistoricalStats(teamId) {
  if (!teamId) return null;

  const seasons = [];
  for (const season of HISTORICAL_SEASONS) {
    try {
      const data = await fetchJSON(`${MLB_BASE}/teams/${teamId}/stats?stats=season&season=${season}&group=hitting`);
      const splits = data.stats?.find(s => s.type?.displayName === 'season')?.splits ?? [];
      if (splits.length > 0) seasons.push({ season, stats: normalizeHittingStats(data) });
    } catch (_) { /* season unavailable — continue */ }
    await new Promise(r => setTimeout(r, 100));
  }

  if (seasons.length === 0) return null;

  const histLog = seasons.map(s => `${s.season}(AVG:${s.stats.avg})`).join(', ');
  console.log(`[MLB API] Team ${teamId} historical: ${histLog}`);

  const current = seasons[0];
  const historical = seasons.slice(1).map(({ season, stats: s }) => ({
    season, avg: s.avg, ops: s.ops, hr: s.homeRuns, runs: s.runs,
  }));

  return { teamId, season: current.season, stats: current.stats, historical };
}

/**
 * Returns the player's current team from the MLB people endpoint.
 * Used to verify that a pitcher is actually on the scheduled team.
 */
export async function getCurrentTeam(playerId) {
  if (!playerId) return null;
  try {
    const data = await fetchJSON(`${MLB_BASE}/people/${playerId}?hydrate=currentTeam`);
    const person = data.people?.[0];
    if (!person) return null;
    return {
      playerId,
      fullName:         person.fullName,
      currentTeamId:    person.currentTeam?.id           ?? null,
      currentTeamName:  person.currentTeam?.name         ?? null,
      currentTeamAbbr:  person.currentTeam?.abbreviation ?? null,
    };
  } catch (err) {
    console.warn(`[MLB API] getCurrentTeam(${playerId}) failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Team pitching stats (starters + bullpen)
// ---------------------------------------------------------------------------

/**
 * Stats de pitcheo de temporada de un equipo.
 * Endpoint: /teams/{teamId}/stats?stats=season,seasonAdvanced&season={year}&group=pitching
 *
 * Intenta aislar métricas específicas del bullpen (relevistas) si la API las
 * expone en los splits. Si no, bullpen quedará null.
 *
 * @param {number|string} teamId
 * @returns {Promise<{teamId, season, overall: object, bullpen: object|null}>}
 *          Devuelve un objeto vacío si la API falla — NUNCA lanza.
 */
export async function getTeamPitchingStats(teamId) {
  if (!teamId) return {};

  for (const season of SEASON_FALLBACK) {
    try {
      const url =
        `${MLB_BASE}/teams/${teamId}/stats` +
        `?stats=season,seasonAdvanced&season=${season}&group=pitching`;
      const data = await fetchJSON(url);

      const stats = data.stats ?? [];
      const seasonBlock = stats.find(s => s.type?.displayName === 'season');
      const splits = seasonBlock?.splits ?? [];

      if (splits.length === 0) {
        console.log(`[MLB API] Season ${season} returned empty pitching splits for team ${teamId} — trying next`);
        continue;
      }

      // El primer split suele ser el total del equipo
      const overallStat = splits[0]?.stat ?? {};

      // Intentar encontrar un split específico de relevistas:
      // La API puede exponer splits por rol (relief) en el campo split.code o description.
      const bullpenSplit = splits.find(s => {
        const code = s.split?.code ?? '';
        const desc = (s.split?.description ?? '').toLowerCase();
        return (
          code === 'R' ||
          desc.includes('relief') ||
          desc.includes('bullpen')
        );
      }) ?? null;
      const bullpenStat = bullpenSplit?.stat ?? null;

      const extractMetrics = (stat) => ({
        era:               stat.era               ?? null,
        whip:              stat.whip              ?? null,
        strikeoutsPer9Inn: stat.strikeoutsPer9Inn  ?? null,
        walksPer9Inn:      stat.walksPer9Inn       ?? null,
        inningsPitched:    stat.inningsPitched     ?? null,
        strikeOuts:        stat.strikeOuts         ?? null,
        baseOnBalls:       stat.baseOnBalls        ?? null,
        saves:             stat.saves              ?? null,
        blownSaves:        stat.blownSaves         ?? null,
        holds:             stat.holds              ?? null,
        gamesFinished:     stat.gamesFinished      ?? null,
      });

      const overall = extractMetrics(overallStat);
      const bullpen  = bullpenStat ? extractMetrics(bullpenStat) : null;

      console.log(`[MLB API] Team ${teamId} pitching stats loaded from season ${season} (ERA: ${overall.era})`);
      return { teamId, season, overall, bullpen };

    } catch (err) {
      console.log(`[MLB API] Season ${season} pitching failed for team ${teamId}: ${err.message}`);
    }
  }

  console.warn(`[MLB API] No pitching stats found for team ${teamId} in seasons: ${SEASON_FALLBACK.join(', ')}`);
  return {};
}

// ---------------------------------------------------------------------------
// Platoon Splits — batting stats vs LHP and vs RHP
// ---------------------------------------------------------------------------

/**
 * Fetches a team's batting splits broken down by opposing pitcher handedness.
 *
 * Endpoint: /teams/{teamId}/stats?stats=statSplits&group=hitting&sitCodes=vl,vr
 *   - sitCode "vl" → vs Left-Handed Pitcher
 *   - sitCode "vr" → vs Right-Handed Pitcher
 *
 * Returns { vsLHP: { avg, obp, slg, ops }, vsRHP: { avg, obp, slg, ops } }
 * or null if the API returns no usable data.
 *
 * @param {number|string} teamId
 * @returns {Promise<{vsLHP: object, vsRHP: object}|null>}
 */
export async function getTeamHittingSplits(teamId) {
  if (!teamId) return null;

  // Helper to extract the four core batting metrics from a raw stat block.
  const extractSplitStats = (stat) => ({
    avg: stat.avg ?? null,
    obp: stat.obp ?? null,
    slg: stat.slg ?? null,
    ops: stat.ops ?? null,
    atBats: stat.atBats ?? null,
    hits:   stat.hits   ?? null,
    homeRuns: stat.homeRuns ?? null,
  });

  // Attempt each fallback season in order — same pattern as the rest of the module.
  for (const season of SEASON_FALLBACK) {
    try {
      const url =
        `${MLB_BASE}/teams/${teamId}/stats` +
        `?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr`;

      const data = await fetchJSON(url);

      // The API wraps results in data.stats[].splits[]; each split entry has:
      //   split.code  → "vl" | "vr"
      //   split.description → "vs. Left" | "vs. Right" (varies by API version)
      //   stat → the batting stat block
      const splitsBlock = (data.stats ?? []).find(
        s => s.type?.displayName === 'statSplits' || s.group?.displayName === 'hitting'
      );

      const rawSplits = splitsBlock?.splits ?? data.stats?.[0]?.splits ?? [];

      if (rawSplits.length === 0) {
        console.log(`[MLB API] Season ${season} returned no platoon splits for team ${teamId} — trying next`);
        continue;
      }

      // Identify vs-Left and vs-Right entries by split code or description.
      const vsLeft = rawSplits.find(s => {
        const code = (s.split?.code ?? '').toLowerCase();
        const desc = (s.split?.description ?? '').toLowerCase();
        return code === 'vl' || desc.includes('vs. left') || desc.includes('vs left');
      });

      const vsRight = rawSplits.find(s => {
        const code = (s.split?.code ?? '').toLowerCase();
        const desc = (s.split?.description ?? '').toLowerCase();
        return code === 'vr' || desc.includes('vs. right') || desc.includes('vs right');
      });

      if (!vsLeft && !vsRight) {
        console.log(`[MLB API] Season ${season} splits found but no vl/vr entries for team ${teamId} — trying next`);
        continue;
      }

      const result = {
        season,
        vsLHP: vsLeft  ? extractSplitStats(vsLeft.stat  ?? {}) : null,
        vsRHP: vsRight ? extractSplitStats(vsRight.stat ?? {}) : null,
      };

      console.log(
        `[MLB API] Team ${teamId} platoon splits loaded (season ${season})` +
        ` vsLHP AVG:${result.vsLHP?.avg ?? 'N/A'} vsRHP AVG:${result.vsRHP?.avg ?? 'N/A'}`
      );
      return result;

    } catch (err) {
      console.log(`[MLB API] Season ${season} platoon splits failed for team ${teamId}: ${err.message}`);
    }
  }

  console.warn(`[MLB API] No platoon splits found for team ${teamId} in seasons: ${SEASON_FALLBACK.join(', ')}`);
  return null;
}

// ---------------------------------------------------------------------------
// Función auxiliar mantenida para compatibilidad con context-builder.js
// ---------------------------------------------------------------------------

export async function getGameContext(gameId) {
  const url = `${MLB_BASE}/game/${gameId}/boxscore`;
  try {
    const boxscore = await fetchJSON(url);
    return { gameId, boxscore };
  } catch (err) {
    console.error(`[MLB API] Error en getGameContext(${gameId}):`, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getBullpenUsage — bullpen workload for a team over the last 3 days
// ---------------------------------------------------------------------------

function parseInningsPitched(ip) {
  if (!ip && ip !== 0) return 0;
  const str = String(ip);
  const parts = str.split('.');
  const whole = parseInt(parts[0], 10) || 0;
  const thirds = parseInt(parts[1] || '0', 10);
  return whole + (thirds / 3);
}

function ipToDisplay(decimalIP) {
  const whole = Math.floor(decimalIP);
  const thirds = Math.round((decimalIP - whole) * 3);
  return `${whole}.${thirds}`;
}

export async function getBullpenUsage(teamId) {
  if (!teamId) return null;

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const threeDaysAgoDate = new Date();
    threeDaysAgoDate.setDate(threeDaysAgoDate.getDate() - 3);
    const threeDaysAgo = threeDaysAgoDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const scheduleUrl = `${MLB_BASE}/schedule?teamId=${teamId}&startDate=${threeDaysAgo}&endDate=${today}&sportId=1&gameType=R`;
    const scheduleData = await fetchJSON(scheduleUrl);

    const finishedGames = [];
    for (const dateEntry of (scheduleData.dates ?? [])) {
      for (const game of (dateEntry.games ?? [])) {
        if (game.status?.abstractGameState === 'Final') {
          finishedGames.push({ gamePk: game.gamePk, date: dateEntry.date });
        }
      }
    }

    const recentGames = finishedGames.slice(-3);

    // Map: playerId -> { id, name, appearances: [] }
    const relieversMap = new Map();

    for (let i = 0; i < recentGames.length; i++) {
      const { gamePk, date } = recentGames[i];
      if (i > 0) await new Promise(r => setTimeout(r, 200));

      try {
        const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
        const feed = await fetchJSON(feedUrl);

        const liveData = feed.liveData;
        if (!liveData?.boxscore) continue;

        const homeTeamId = feed.gameData?.teams?.home?.id;
        const side = homeTeamId === Number(teamId) ? 'home' : 'away';

        const teamBox = liveData.boxscore.teams[side];
        if (!teamBox) continue;

        const pitcherIds = teamBox.pitchers ?? [];
        if (pitcherIds.length === 0) continue;

        const starterId = pitcherIds[0];
        const relieverIds = pitcherIds.slice(1);

        for (const pid of relieverIds) {
          const playerKey = `ID${pid}`;
          const player = teamBox.players?.[playerKey];
          if (!player) continue;

          const pitching = player.stats?.pitching;
          if (!pitching || !pitching.inningsPitched) continue;

          const appearance = {
            date,
            ip: pitching.inningsPitched,
            er: pitching.earnedRuns ?? 0,
            k: pitching.strikeOuts ?? 0,
            h: pitching.hits ?? 0,
            bb: pitching.baseOnBalls ?? 0,
            pitchCount: pitching.numberOfPitches ?? 0,
          };

          if (!relieversMap.has(pid)) {
            relieversMap.set(pid, {
              id: pid,
              name: player.person?.fullName ?? `Player ${pid}`,
              appearances: [],
            });
          }
          relieversMap.get(pid).appearances.push(appearance);
        }
      } catch (gameErr) {
        console.warn(`[MLB API] Failed to fetch boxscore for game ${gamePk}:`, gameErr.message);
      }
    }

    const gameDates = recentGames.map(g => g.date).sort();
    const today1dAgo = gameDates[gameDates.length - 1];
    const today2dAgo = gameDates.length >= 2 ? gameDates[gameDates.length - 2] : null;

    let bullpenIP_1d = 0, bullpenIP_2d = 0, bullpenIP_3d = 0;
    let bullpenER_3d = 0, bullpenK_3d = 0;

    const relievers = Array.from(relieversMap.values()).map(r => {
      r.appearances.sort((a, b) => a.date.localeCompare(b.date));

      let totalDecimalIP = 0;
      for (const app of r.appearances) {
        const decIP = parseInningsPitched(app.ip);
        totalDecimalIP += decIP;

        bullpenIP_3d += decIP;
        bullpenER_3d += app.er;
        bullpenK_3d += app.k;

        if (app.date === today1dAgo) bullpenIP_1d += decIP;
        if (today2dAgo && (app.date === today1dAgo || app.date === today2dAgo)) bullpenIP_2d += decIP;
      }

      const dates = r.appearances.map(a => a.date).sort();
      let isBackToBack = false;
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) { isBackToBack = true; break; }
      }

      return {
        id: r.id,
        name: r.name,
        appearances: r.appearances,
        totalIP_last3d: Math.round(totalDecimalIP * 1000) / 1000,
        gamesLast3d: r.appearances.length,
        isBackToBack,
      };
    });

    const totalIP = ipToDisplay(bullpenIP_3d);
    console.log(`[MLB API] Bullpen usage for team ${teamId}: ${relievers.length} relievers, ${totalIP}IP last 3 days`);

    return {
      teamId,
      gamesAnalyzed: recentGames.length,
      relievers,
      bullpenIP_1d: Math.round(bullpenIP_1d * 1000) / 1000,
      bullpenIP_2d: Math.round(bullpenIP_2d * 1000) / 1000,
      bullpenIP_3d: Math.round(bullpenIP_3d * 1000) / 1000,
      bullpenER_3d,
      bullpenK_3d,
    };
  } catch (err) {
    console.warn(`[MLB API] getBullpenUsage failed for team ${teamId}:`, err.message);
    return null;
  }
}

/**
 * Fetches individual batter splits vs LHP and vs RHP.
 * Endpoint: /people/{playerId}/stats?stats=statSplits&group=hitting&season={year}&sitCodes=vl,vr
 *
 * @param {number|string} playerId
 * @returns {Promise<{playerId, vsLHP: object|null, vsRHP: object|null}|null>}
 */
export async function getBatterSplits(playerId) {
  if (!playerId) return null;

  const extractStats = (stat) => ({
    avg: stat.avg ?? null,
    obp: stat.obp ?? null,
    slg: stat.slg ?? null,
    ops: stat.ops ?? null,
    atBats: stat.atBats ?? null,
    hits: stat.hits ?? null,
    homeRuns: stat.homeRuns ?? null,
    strikeOuts: stat.strikeOuts ?? null,
    baseOnBalls: stat.baseOnBalls ?? null,
  });

  for (const season of SEASON_FALLBACK) {
    try {
      const url =
        `${MLB_BASE}/people/${playerId}/stats` +
        `?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr`;
      const data = await fetchJSON(url);

      const splitsBlock = (data.stats ?? []).find(
        s => s.type?.displayName === 'statSplits' || s.group?.displayName === 'hitting'
      );
      const rawSplits = splitsBlock?.splits ?? data.stats?.[0]?.splits ?? [];

      if (rawSplits.length === 0) {
        console.log(`[MLB API] Season ${season} returned no batter splits for player ${playerId} — trying next`);
        continue;
      }

      let vsLHP = null;
      let vsRHP = null;

      for (const split of rawSplits) {
        const code = split.split?.code ?? '';
        const desc = (split.split?.description ?? '').toLowerCase();
        if (code === 'vl' || desc.includes('vs. left')) {
          vsLHP = extractStats(split.stat ?? {});
        } else if (code === 'vr' || desc.includes('vs. right')) {
          vsRHP = extractStats(split.stat ?? {});
        }
      }

      if (vsLHP || vsRHP) {
        console.log(`[MLB API] Batter ${playerId} splits loaded from season ${season} — vsLHP: ${vsLHP?.avg ?? 'N/A'} vsRHP: ${vsRHP?.avg ?? 'N/A'}`);
        return { playerId, season, vsLHP, vsRHP };
      }

      console.log(`[MLB API] Season ${season} had splits but no vl/vr codes for player ${playerId} — trying next`);
    } catch (err) {
      console.log(`[MLB API] Season ${season} batter splits failed for player ${playerId}: ${err.message}`);
    }
  }

  console.warn(`[MLB API] No batter splits found for player ${playerId} in seasons: ${SEASON_FALLBACK.join(', ')}`);
  return null;
}
