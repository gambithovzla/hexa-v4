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

// Seasons to try in order — current year may have no data early in calendar year
const SEASON_FALLBACK = SEASON >= 2026 ? [SEASON, 2025, 2024] : [SEASON, SEASON - 1];

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

async function fetchJSON(url) {
  console.log(`[MLB API] GET ${url}`);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(`[MLB API] Network error → ${url}:`, err.message);
    throw new Error(`Network error al conectar con la API de MLB: ${err.message}`);
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
 * Normaliza un juego crudo del endpoint /schedule en un objeto limpio.
 */
function normalizeGame(game) {
  const home = game.teams?.home ?? {};
  const away = game.teams?.away ?? {};

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
  const url =
    `${MLB_BASE}/schedule` +
    `?date=${targetDate}` +
    `&sportId=1` +
    `&hydrate=team,linescore,probablePitcher`;

  try {
    const data = await fetchJSON(url);
    const rawGames = (data.dates ?? []).flatMap(d => d.games ?? []);
    const games = rawGames.map(normalizeGame);
    console.log(`[MLB API] ${games.length} partidos encontrados para ${targetDate}`);
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
