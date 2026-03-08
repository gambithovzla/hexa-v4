/**
 * Auto-context fetcher
 * Construye el contexto estructurado que H.E.X.A. necesita para analizar un partido.
 *
 * Función principal: buildContext(gameData)
 *   Recibe un objeto normalizado de getTodayGames() y devuelve un string listo
 *   para inyectar en el prompt del Oracle.
 */

import { getPitcherStats, getTeamHittingStats } from './mlb-api.js';

// ---------------------------------------------------------------------------
// Umbrales para flags situacionales
// ---------------------------------------------------------------------------

const FLAGS = {
  ERA_OVERPERFORMING: 2.50,   // ERA por debajo de esto → posible sobrerendimiento
  ERA_CONCERNING: 5.00,       // ERA por encima de esto → señal de alerta
  HR9_VULNERABLE: 1.50,       // HR/9 sobre esto → vulnerable a jonrones
  WHIP_ELITE: 1.00,           // WHIP bajo esto → élite
  WHIP_POOR: 1.40,            // WHIP sobre esto → preocupante
  OPS_STRONG: 0.780,          // OPS de equipo sobre esto → ofensiva potente
  OPS_WEAK: 0.680,            // OPS de equipo bajo esto → ofensiva débil
  AVG_HIGH: 0.270,            // AVG sobre esto → buen contacto
  BB9_HIGH: 4.0,              // BB/9 sobre esto → control problemático
};

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

const fmt = {
  stat: (v, decimals = 3) =>
    v != null ? Number(v).toFixed(decimals) : 'N/A',
  pct: (v) =>
    v != null ? `${(Number(v) * 100).toFixed(1)}%` : 'N/A',
  int: (v) =>
    v != null ? String(v) : 'N/A',
  line: (label, value) =>
    `${label}: ${value}`,
};

function section(title) {
  return `--- ${title} ---`;
}

function header(title) {
  return `=== ${title} ===`;
}

// ---------------------------------------------------------------------------
// Generación de flags situacionales
// ---------------------------------------------------------------------------

/**
 * Evalúa las stats de un pitcher y produce flags de texto.
 * @param {string} name       — nombre del pitcher
 * @param {string} side       — 'Home' | 'Away'
 * @param {object|null} stats — objeto stats normalizado de getPitcherStats()
 * @returns {string[]}
 */
function pitcherFlags(name, side, stats) {
  if (!stats) return [];
  const flags = [];
  const { era, whip, hr9: hr9Raw, strikeoutsPer9Inn, walksPer9Inn, homeRuns, inningsPitched } = stats;

  // Derivamos HR/9 si no viene directo
  const ip = parseFloat(inningsPitched);
  const hr9 = hr9Raw != null
    ? parseFloat(hr9Raw)
    : (homeRuns != null && ip > 0 ? (homeRuns / ip) * 9 : null);

  const eraNum = era != null ? parseFloat(era) : null;
  const whipNum = whip != null ? parseFloat(whip) : null;
  const bb9Num = walksPer9Inn != null ? parseFloat(walksPer9Inn) : null;

  if (eraNum != null && eraNum < FLAGS.ERA_OVERPERFORMING) {
    flags.push(`${side} starter ${name} ERA (${fmt.stat(eraNum)}) may indicate overperformance — regression risk`);
  }
  if (eraNum != null && eraNum > FLAGS.ERA_CONCERNING) {
    flags.push(`${side} starter ${name} has concerning ERA (${fmt.stat(eraNum)}) — high run-allowed risk`);
  }
  if (hr9 != null && hr9 > FLAGS.HR9_VULNERABLE) {
    flags.push(`${side} starter ${name} vulnerable to home runs (HR/9: ${fmt.stat(hr9, 2)})`);
  }
  if (whipNum != null && whipNum <= FLAGS.WHIP_ELITE) {
    flags.push(`${side} starter ${name} is elite at limiting baserunners (WHIP: ${fmt.stat(whipNum)})`);
  }
  if (whipNum != null && whipNum > FLAGS.WHIP_POOR) {
    flags.push(`${side} starter ${name} struggles to limit baserunners (WHIP: ${fmt.stat(whipNum)})`);
  }
  if (bb9Num != null && bb9Num > FLAGS.BB9_HIGH) {
    flags.push(`${side} starter ${name} has command issues (BB/9: ${fmt.stat(bb9Num, 2)})`);
  }

  return flags;
}

/**
 * Evalúa las stats ofensivas de un equipo y produce flags de texto.
 * @param {string} teamName
 * @param {string} side       — 'Home' | 'Away'
 * @param {object|null} stats — objeto stats normalizado de getTeamHittingStats()
 * @returns {string[]}
 */
function hittingFlags(teamName, side, stats) {
  if (!stats) return [];
  const flags = [];
  const { ops, avg } = stats;

  const opsNum = ops != null ? parseFloat(ops) : null;
  const avgNum = avg != null ? parseFloat(avg) : null;

  if (opsNum != null && opsNum > FLAGS.OPS_STRONG) {
    flags.push(`${side} team ${teamName} has a strong offense (OPS: ${fmt.stat(opsNum)})`);
  }
  if (opsNum != null && opsNum < FLAGS.OPS_WEAK) {
    flags.push(`${side} team ${teamName} has a weak offense (OPS: ${fmt.stat(opsNum)}) — low run-scoring risk`);
  }
  if (avgNum != null && avgNum > FLAGS.AVG_HIGH) {
    flags.push(`${side} team ${teamName} makes strong contact (AVG: ${fmt.stat(avgNum)})`);
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Bloque de pitcher (texto)
// ---------------------------------------------------------------------------

function pitcherBlock(label, pitcherData, probablePitcher) {
  const lines = [section(`${label} PITCHING`)];

  const name = probablePitcher?.fullName ?? null;
  const hand = probablePitcher?.throwingHand ? `(${probablePitcher.throwingHand}HP)` : '';

  if (!name) {
    lines.push(`Starter: ⚠ MISSING DATA: probable pitcher not announced — increase model_risk`);
    return lines.join('\n');
  }

  lines.push(`Starter: ${name} ${hand}`.trim());

  if (!pitcherData?.stats) {
    lines.push(`Stats: ⚠ MISSING DATA: season stats unavailable for ${name} — increase model_risk`);
    return lines.join('\n');
  }

  const s = pitcherData.stats;

  // Derivar HR/9 si no viene directo
  const ip = parseFloat(s.inningsPitched ?? 0);
  const hr9 = s.homeRuns != null && ip > 0
    ? fmt.stat((s.homeRuns / ip) * 9, 2)
    : 'N/A';

  lines.push(
    `ERA: ${fmt.stat(s.era)} | WHIP: ${fmt.stat(s.whip)} | K/9: ${fmt.stat(s.strikeoutsPer9Inn, 2)} | BB/9: ${fmt.stat(s.walksPer9Inn, 2)} | HR/9: ${hr9}`,
    `Record: ${fmt.int(s.wins)}-${fmt.int(s.losses)} | IP: ${s.inningsPitched ?? 'N/A'} | K: ${fmt.int(s.strikeOuts)} | BB: ${fmt.int(s.baseOnBalls)}`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bloque ofensivo (texto)
// ---------------------------------------------------------------------------

function offenseBlock(label, hittingData, teamName) {
  const lines = [section(`${label} OFFENSE (Season)`)];

  if (!hittingData?.stats) {
    lines.push(`⚠ MISSING DATA: hitting stats unavailable for ${teamName ?? label} — increase model_risk`);
    return lines.join('\n');
  }

  const s = hittingData.stats;

  lines.push(
    `AVG: ${fmt.stat(s.avg)} | OBP: ${fmt.stat(s.obp)} | SLG: ${fmt.stat(s.slg)} | OPS: ${fmt.stat(s.ops)}`,
    `HR: ${fmt.int(s.homeRuns)} | R: ${fmt.int(s.runs)} | RBI: ${fmt.int(s.rbi)} | SB: ${fmt.int(s.stolenBases)}`,
    `K: ${fmt.int(s.strikeOuts)} | BB: ${fmt.int(s.baseOnBalls)} | LOB: ${fmt.int(s.leftOnBase)} | G: ${fmt.int(s.gamesPlayed)}`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Función principal exportada
// ---------------------------------------------------------------------------

/**
 * Construye el contexto estructurado completo para un partido.
 *
 * @param {object} gameData — objeto normalizado devuelto por getTodayGames()
 * @returns {Promise<string>} String listo para el prompt del Oracle
 */
export async function buildContext(gameData) {
  const home = gameData.teams?.home;
  const away = gameData.teams?.away;

  const homeName = home?.name ?? 'Home Team';
  const awayName = away?.name ?? 'Away Team';
  const homeAbbr = home?.abbreviation ?? 'HM';
  const awayAbbr = away?.abbreviation ?? 'AW';

  const homePitcher = home?.probablePitcher;
  const awayPitcher = away?.probablePitcher;

  // Fetch paralelo: fallo individual no cancela el resto
  const [homeStatsResult, awayStatsResult, homePitcherResult, awayPitcherResult] =
    await Promise.allSettled([
      home?.id ? getTeamHittingStats(home.id) : Promise.resolve(null),
      away?.id ? getTeamHittingStats(away.id) : Promise.resolve(null),
      homePitcher?.id ? getPitcherStats(homePitcher.id) : Promise.resolve(null),
      awayPitcher?.id ? getPitcherStats(awayPitcher.id) : Promise.resolve(null),
    ]);

  const settled = (r) => (r.status === 'fulfilled' ? r.value : null);

  const homeHitting = settled(homeStatsResult);
  const awayHitting = settled(awayStatsResult);
  const homePitcherStats = settled(homePitcherResult);
  const awayPitcherStats = settled(awayPitcherResult);

  // ---------------------------------------------------------------------------
  // Ensamblar el string
  // ---------------------------------------------------------------------------

  const blocks = [];

  // Encabezado
  blocks.push(header(`GAME CONTEXT: ${awayAbbr} @ ${homeAbbr} — ${awayName} @ ${homeName}`));
  blocks.push(`Venue: ${gameData.venue?.name ?? '⚠ MISSING DATA: venue unknown'}`);
  blocks.push(`Game Time: ${gameData.gameTime ?? '⚠ MISSING DATA: time unknown'}`);
  blocks.push(`Status: ${gameData.status?.description ?? 'Scheduled'}`);
  if (gameData.seriesDescription) {
    blocks.push(`Series: ${gameData.seriesDescription} — Game ${gameData.seriesGameNumber ?? '?'} of ${gameData.gamesInSeries ?? '?'}`);
  }
  blocks.push('');

  // Pitcheo
  blocks.push(pitcherBlock('HOME', homePitcherStats, homePitcher));
  blocks.push('');
  blocks.push(pitcherBlock('AWAY', awayPitcherStats, awayPitcher));
  blocks.push('');

  // Ofensiva
  blocks.push(offenseBlock('HOME', homeHitting, homeName));
  blocks.push('');
  blocks.push(offenseBlock('AWAY', awayHitting, awayName));
  blocks.push('');

  // Flags situacionales
  const flags = [
    ...pitcherFlags(homePitcher?.fullName ?? 'TBD', 'Home', homePitcherStats?.stats ?? null),
    ...pitcherFlags(awayPitcher?.fullName ?? 'TBD', 'Away', awayPitcherStats?.stats ?? null),
    ...hittingFlags(homeName, 'Home', homeHitting),
    ...hittingFlags(awayName, 'Away', awayHitting),
  ];

  blocks.push(section('SITUATIONAL FLAGS'));
  if (flags.length === 0) {
    blocks.push('No significant flags detected.');
  } else {
    flags.forEach(f => blocks.push(`⚑ ${f}`));
  }

  return blocks.join('\n');
}

// ---------------------------------------------------------------------------
// Compatibilidad: versión que recibe gamePk en lugar de gameData completo.
// Usada por index.js en las rutas /analyze/parlay y /analyze/full-day.
// ---------------------------------------------------------------------------

import { getTodayGames } from './mlb-api.js';

/**
 * @param {number|string} gamePk
 * @returns {Promise<string>}
 */
export async function buildContextById(gamePk) {
  // getTodayGames trae el día completo; filtramos el partido que nos interesa.
  // Para no hacer una llamada extra usamos getGameContext del boxscore como fallback.
  const today = new Date().toISOString().split('T')[0];
  const games = await getTodayGames(today);
  const game = games.find(g => String(g.gamePk) === String(gamePk));
  if (!game) throw new Error(`Partido ${gamePk} no encontrado en la jornada de hoy`);
  return buildContext(game);
}

/**
 * Serializa el contexto (ya es string; función mantenida para compatibilidad).
 */
export function serializeContext(ctx) {
  return typeof ctx === 'string' ? ctx : JSON.stringify(ctx, null, 2);
}
