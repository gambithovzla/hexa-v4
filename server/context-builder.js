/**
 * context-builder.js — H.E.X.A. V4
 * Construye el contexto estructurado completo para el Oracle.
 * ACTUALIZADO: todos los campos Statcast al prompt, 9 bateadores por lineup (lineup completo).
 */

import { getPitcherStats, getTeamHittingStats, getPitcherHistoricalStats, getTeamHittingHistoricalStats, getCurrentTeam } from './mlb-api.js';
import { getBatterStatcast, getPitcherStatcast, getParkFactor, getCatcherFraming, getFieldingOAA, getCacheStatus } from './savant-fetcher.js';
import { getGameWeather } from './weather-api.js';

// ---------------------------------------------------------------------------
// Historical MLB context (static reference data for Spring Training + early season)
// ---------------------------------------------------------------------------

const HISTORICAL_MLB_CONTEXT = {
  park_factors_2025: {
    // Hitter-friendly parks
    COL: { overall: 112, hr: 123, description: 'Coors Field - extreme hitter park, high altitude' },
    CIN: { overall: 105, hr: 108, description: 'Great American Ball Park - hitter friendly' },
    TEX: { overall: 104, hr: 106, description: 'Globe Life Field - hitter friendly dome' },
    // Pitcher-friendly parks
    SF:  { overall: 94,  hr: 88,  description: 'Oracle Park - extreme pitcher park, marine layer' },
    NYM: { overall: 95,  hr: 92,  description: 'Citi Field - pitcher friendly' },
    OAK: { overall: 96,  hr: 94,  description: 'Oakland Coliseum - pitcher friendly' },
    MIA: { overall: 95,  hr: 91,  description: 'LoanDepot Park - pitcher friendly dome' },
    // Neutral / slight hitter
    LAD: { overall: 100, hr: 100, description: 'Dodger Stadium - neutral' },
    NYY: { overall: 101, hr: 103, description: 'Yankee Stadium - slight hitter friendly' },
  },
  team_tendencies_historical: {
    LAD: { home_win_pct_5yr: 0.587, notes: 'Elite pitching depth, strong home record' },
    HOU: { home_win_pct_5yr: 0.574, notes: 'Strong home record, Minute Maid Park advantage' },
    NYY: { home_win_pct_5yr: 0.561, notes: 'Yankee Stadium short porch favors lefty power' },
    ATL: { home_win_pct_5yr: 0.558, notes: 'Truist Park hitter friendly, strong home crowd' },
    OAK: { road_win_pct_5yr: 0.421, notes: 'Historically weak road team' },
    MIA: { road_win_pct_5yr: 0.428, notes: 'Weak road performance historically' },
    COL: { road_win_pct_5yr: 0.419, notes: 'Extreme home/road split due to altitude' },
  },
  pitcher_archetypes: {
    power_pitcher:   { k9_min: 10, whiff_min: 30, notes: 'High K upside, favor K props' },
    contact_pitcher: { k9_max: 7,  gb_min: 50,   notes: 'Groundball focused, favor UNDER' },
    flyball_pitcher: { fb_min: 40, hr9_risk: 'high', notes: 'HR risk, favor OVER in hitter parks' },
  },
  spring_training_adjustments: {
    note: 'Spring Training stats unreliable. Use career trends and historical park factors.',
    confidence_reduction: 25,
    recommended_picks: 'single_game_moneyline_favorites_only',
  },
};

function buildHistoricalContextBlock() {
  const pf = HISTORICAL_MLB_CONTEXT.park_factors_2025;
  const tt = HISTORICAL_MLB_CONTEXT.team_tendencies_historical;
  const st = HISTORICAL_MLB_CONTEXT.spring_training_adjustments;

  const pfLines = Object.entries(pf).map(([abbr, d]) =>
    `  ${abbr}: overall=${d.overall} HR=${d.hr} — ${d.description}`
  );
  const ttLines = Object.entries(tt).map(([abbr, d]) => {
    const pct = d.home_win_pct_5yr ?? d.road_win_pct_5yr;
    const side = d.home_win_pct_5yr ? 'home' : 'road';
    return `  ${abbr}: ${side}_win_pct_5yr=${pct} — ${d.notes}`;
  });

  return [
    '=== HISTORICAL MLB REFERENCE DATA ===',
    `--- PARK FACTORS (${new Date().getFullYear()} estimates) ---`,
    ...pfLines,
    '--- TEAM TENDENCIES (5-year historical) ---',
    ...ttLines,
    '--- SPRING TRAINING / EARLY SEASON NOTE ---',
    `  ${st.note}`,
    `  Confidence reduction: ${st.confidence_reduction}%`,
    `  Recommended: ${st.recommended_picks}`,
    '=== END HISTORICAL DATA ===',
  ].join('\n');
}

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
// Bloques Statcast / Baseball Savant
// ---------------------------------------------------------------------------

/**
 * Formats a pitcher's Savant data into a single context line.
 * Returns null if no data available.
 */
function pitcherSavantBlock(label, savant) {
  if (!savant) return `${section(`${label} PITCHER STATCAST`)}\n⚠ No Savant data (Spring Training / not found)`;

  const f2 = (v) => (v != null ? Number(v).toFixed(2) : 'N/A');
  const f3 = (v) => (v != null ? Number(v).toFixed(3) : 'N/A');
  const fp = (v) => (v != null ? `${Number(v).toFixed(1)}%` : 'N/A');

  const lines = [section(`${label} PITCHER STATCAST (Savant ${new Date().getFullYear()})`)];
  lines.push(
    `xwOBA against: ${f3(savant.xwOBA_against)} | xBA against: ${f3(savant.xBA_against)} | xSLG against: ${f3(savant.xSLG_against)}`,
    `Whiff%: ${fp(savant.whiff_percent)} | K%: ${fp(savant.k_percent)} | BB%: ${fp(savant.bb_percent)}`,
  );

  if (savant.arsenal && Object.keys(savant.arsenal).length > 0) {
    // Summarise top run values and whiff rates by pitch type
    const pitchTypes = { ff: 'FF', si: 'SI', fc: 'FC', sl: 'SL', cu: 'CU', ch: 'CH', fs: 'FS' };
    const rvParts = [];
    for (const [prefix, name] of Object.entries(pitchTypes)) {
      const rv = savant.arsenal[`${prefix}_run_value_per_100`] ?? savant.arsenal[`${prefix}_rv_per100`] ?? null;
      if (rv != null) rvParts.push(`${name}:${f2(rv)}`);
    }
    if (rvParts.length) lines.push(`Arsenal RV/100: ${rvParts.join(' | ')}`);
  }

  return lines.join('\n');
}

/**
 * Formats a batter's Savant data into a context block.
 * Returns null if no data available.
 */
function batterSavantLine(name, savant) {
  if (!savant) return `  ${name}: no Savant data`;
  const f3 = (v) => (v != null ? Number(v).toFixed(3) : 'N/A');
  const fp = (v) => (v != null ? `${Number(v).toFixed(1)}%` : 'N/A');
  const f1 = (v) => (v != null ? Number(v).toFixed(1) : 'N/A');

  const pctXwOBA = savant.percentiles?.['p_xwoba'] ?? savant.percentiles?.['xwoba'] ?? null;
  const pctEV    = savant.percentiles?.['p_exit_velocity'] ?? savant.percentiles?.['exit_velocity'] ?? null;
  const pctStr   = pctXwOBA != null ? ` | xwOBA-pct:${Math.round(pctXwOBA)}` : '';
  const evPct    = pctEV    != null ? ` EV-pct:${Math.round(pctEV)}`         : '';

  return (
    `  ${name}: xwOBA ${f3(savant.xwOBA)} xBA ${f3(savant.xBA)} xSLG ${f3(savant.xSLG)}` +
    ` | EV ${f1(savant.avg_exit_velocity)} Barrel% ${fp(savant.barrel_batted_rate)} HH% ${fp(savant.hard_hit_percent)}` +
    pctStr + evPct
  );
}

// ---------------------------------------------------------------------------
// Historical trend blocks
// ---------------------------------------------------------------------------

function pitcherHistoricalBlock(name, teamAbbr, historicalData, maxPastSeasons = 5) {
  if (!historicalData?.historical?.length) return null;
  const cur  = historicalData;
  const s    = cur.stats;
  const ip   = parseFloat(s.inningsPitched ?? 0);
  const hr9  = s.homeRuns != null && ip > 0 ? ((s.homeRuns / ip) * 9).toFixed(2) : 'N/A';
  const hist = historicalData.historical.slice(0, maxPastSeasons);
  const lines = [`=== PITCHER HISTORICAL TRENDS (${hist.length + 1} seasons) ===`];
  lines.push(`${name} (${teamAbbr ?? 'UNK'}):`);
  lines.push(`* ${cur.season}: ERA ${s.era ?? 'N/A'}, WHIP ${s.whip ?? 'N/A'}, K/9 ${s.strikeoutsPer9Inn ?? 'N/A'}, BB/9 ${s.walksPer9Inn ?? 'N/A'}, HR/9 ${hr9}`);
  for (const h of hist) {
    lines.push(`* ${h.season}: ERA ${h.era ?? 'N/A'}, WHIP ${h.whip ?? 'N/A'}, K/9 ${h.k9 ?? 'N/A'}, BB/9 ${h.bb9 ?? 'N/A'}, HR/9 ${h.hr9 ?? 'N/A'}`);
  }
  const eras = [parseFloat(s.era), ...hist.map(h => parseFloat(h.era))].filter(v => !isNaN(v));
  if (eras.length >= 2) {
    const avg = (eras.reduce((a, b) => a + b, 0) / eras.length).toFixed(2);
    const trend = eras[0] < eras[eras.length - 1] - 0.3
      ? 'Improving ERA trend'
      : eras[0] > eras[eras.length - 1] + 0.3
        ? 'Declining ERA trend'
        : 'Consistent performance';
    lines.push(`TREND: ${trend}, ${eras.length}-season ERA average ${avg}`);
  }
  return lines.join('\n');
}

function teamHistoricalBlock(teamName, historicalData, maxPastSeasons = 5) {
  if (!historicalData?.historical?.length) return null;
  const cur  = historicalData;
  const s    = cur.stats;
  const hist = historicalData.historical.slice(0, maxPastSeasons);
  const lines = [`=== TEAM HISTORICAL TRENDS (${hist.length + 1} seasons) ===`];
  lines.push(`${teamName}:`);
  lines.push(`* ${cur.season}: AVG ${s.avg ?? 'N/A'}, OPS ${s.ops ?? 'N/A'}, HR ${s.homeRuns ?? 'N/A'}, R ${s.runs ?? 'N/A'}`);
  for (const h of hist) {
    lines.push(`* ${h.season}: AVG ${h.avg ?? 'N/A'}, OPS ${h.ops ?? 'N/A'}, HR ${h.hr ?? 'N/A'}, R ${h.runs ?? 'N/A'}`);
  }
  const opsList = [parseFloat(s.ops), ...hist.map(h => parseFloat(h.ops))].filter(v => !isNaN(v));
  if (opsList.length >= 2) {
    const trend = opsList[0] > opsList[opsList.length - 1] + 0.02
      ? 'Improving offense trend'
      : opsList[0] < opsList[opsList.length - 1] - 0.02
        ? 'Declining offense trend'
        : 'Consistent mid-tier offense';
    lines.push(`TREND: ${trend}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Lineup status block
// ---------------------------------------------------------------------------

function lineupStatusBlock(gameData) {
  const status     = gameData.lineupStatus ?? 'unavailable';
  const homeLineup = gameData.lineups?.home ?? [];
  const awayLineup = gameData.lineups?.away ?? [];
  const lines = ['=== LINEUP STATUS ==='];

  if (status === 'confirmed') {
    lines.push('✅ LINEUP STATUS: CONFIRMED');
    if (homeLineup.length > 0) {
      lines.push(`Home batting order: ${homeLineup.slice(0, 9).map((p, i) => `${i + 1}. ${p.fullName}`).join(', ')}`);
    }
    if (awayLineup.length > 0) {
      lines.push(`Away batting order: ${awayLineup.slice(0, 9).map((p, i) => `${i + 1}. ${p.fullName}`).join(', ')}`);
    }
  } else if (status === 'probable') {
    lines.push('⚠️ LINEUP STATUS: PROBABLE — Analysis based on probable starters only. Confirmed lineups not yet available.');
  } else {
    lines.push('⚠️ LINEUP STATUS: UNAVAILABLE — Analysis based on probable starters and team tendencies only.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Team verification helper
// ---------------------------------------------------------------------------

function teamVerificationLine(playerName, scheduledAbbr, verification) {
  if (!verification) return null;
  const curAbbr = verification.currentTeamAbbr;
  if (curAbbr && scheduledAbbr && curAbbr.toLowerCase() !== scheduledAbbr.toLowerCase()) {
    return `⚠️ TEAM VERIFICATION: ${playerName} — current MLB team (${curAbbr}) differs from scheduled team (${scheduledAbbr}) — possible trade/FA — verify before betting`;
  }
  return `✓ TEAM VERIFICATION: ${playerName} — current team confirmed as ${curAbbr ?? verification.currentTeamName ?? 'Unknown'}`;
}

/**
 * Construye el contexto estructurado completo para un partido.
 *
 * @param {object}      gameData — objeto normalizado devuelto por getTodayGames()
 * @param {object|null} oddsData — resultado de matchOddsToGame() (opcional)
 * @returns {Promise<string>} String listo para el prompt del Oracle
 */
export async function buildContext(gameData, oddsData = null) {
  const maxPastSeasons = 3;
  const home = gameData.teams?.home;
  const away = gameData.teams?.away;

  const homeName = home?.name ?? 'Home Team';
  const awayName = away?.name ?? 'Away Team';
  const homeAbbr = home?.abbreviation ?? 'HM';
  const awayAbbr = away?.abbreviation ?? 'AW';

  const homePitcher = home?.probablePitcher;
  const awayPitcher = away?.probablePitcher;

  // Fetch sequentially (home first, then away) to avoid rate-limiting on the MLB Stats API.
  // getCurrentTeam calls are lightweight and run in parallel after historical stats complete.
  let homeHitting      = null;
  let awayHitting      = null;
  let homePitcherStats = null;
  let awayPitcherStats = null;

  try { homeHitting      = home?.id      ? await getTeamHittingHistoricalStats(home.id)      : null; } catch (_) {}
  try { homePitcherStats = homePitcher?.id ? await getPitcherHistoricalStats(homePitcher.id) : null; } catch (_) {}
  try { awayHitting      = away?.id      ? await getTeamHittingHistoricalStats(away.id)      : null; } catch (_) {}
  try { awayPitcherStats = awayPitcher?.id ? await getPitcherHistoricalStats(awayPitcher.id) : null; } catch (_) {}

  const [homeTeamVerifyResult, awayTeamVerifyResult] = await Promise.allSettled([
    homePitcher?.id ? getCurrentTeam(homePitcher.id) : Promise.resolve(null),
    awayPitcher?.id ? getCurrentTeam(awayPitcher.id) : Promise.resolve(null),
  ]);

  const settled = (r) => (r.status === 'fulfilled' ? r.value : null);

  const homePitcherTeam = settled(homeTeamVerifyResult);
  const awayPitcherTeam = settled(awayTeamVerifyResult);

  // ── Baseball Savant Statcast (non-blocking) ──────────────────────────────
  let homePitcherSavant = null;
  let awayPitcherSavant = null;
  let savantCacheStatus = null;
  let savantBatters     = { home: [], away: [] };
  let parkFactorData    = null;
  let catcherFraming    = { home: null, away: null };
  let oaaOutfielders    = []; // [{ player, side:'Home'|'Away', oaa }]

  try {
    const homeLineup = gameData.teams?.home?.lineup ?? gameData.lineups?.home ?? null;
    const awayLineup = gameData.teams?.away?.lineup ?? gameData.lineups?.away ?? null;

    function findByPos(lineup, pos) {
      if (!Array.isArray(lineup)) return null;
      return lineup.find(p => typeof p === 'object' && (p.position === pos || p.pos === pos)) ?? null;
    }

    const savantFetches = [
      homePitcher?.fullName ? getPitcherStatcast(homePitcher.fullName) : Promise.resolve(null),
      awayPitcher?.fullName ? getPitcherStatcast(awayPitcher.fullName) : Promise.resolve(null),
    ];

    const homeBatters9 = Array.isArray(homeLineup) ? homeLineup.slice(0, 9) : [];
    const awayBatters9 = Array.isArray(awayLineup) ? awayLineup.slice(0, 9) : [];
    const homeCatcher = findByPos(homeLineup, 'C');
    const awayCatcher = findByPos(awayLineup, 'C');
    const OF_POSITIONS = ['CF', 'LF', 'RF'];
    const allOFPlayers = [
      ...OF_POSITIONS.map(pos => { const p = findByPos(homeLineup, pos); return p ? { player: p, pos, side: 'Home' } : null; }),
      ...OF_POSITIONS.map(pos => { const p = findByPos(awayLineup, pos); return p ? { player: p, pos, side: 'Away' } : null; }),
    ].filter(Boolean);

    const batterFetches = [
      ...homeBatters9.map(b => getBatterStatcast(b.fullName ?? b.name ?? b)),
      ...awayBatters9.map(b => getBatterStatcast(b.fullName ?? b.name ?? b)),
    ];
    const referenceFetches = [
      getParkFactor(homeName),
      getCatcherFraming(homeCatcher?.fullName ?? homeCatcher?.name ?? ''),
      getCatcherFraming(awayCatcher?.fullName ?? awayCatcher?.name ?? ''),
      ...allOFPlayers.map(({ player }) => getFieldingOAA(player.fullName ?? player.name ?? '')),
    ];

    const [pitcherResults, batterResults, referenceResults] = await Promise.all([
      Promise.allSettled(savantFetches),
      Promise.allSettled(batterFetches),
      Promise.allSettled(referenceFetches),
    ]);

    homePitcherSavant = pitcherResults[0].status === 'fulfilled' ? pitcherResults[0].value : null;
    awayPitcherSavant = pitcherResults[1].status === 'fulfilled' ? pitcherResults[1].value : null;

    const allBatters = [...homeBatters9, ...awayBatters9];
    batterResults.forEach((r, idx) => {
      const name   = allBatters[idx]?.fullName ?? allBatters[idx]?.name ?? allBatters[idx] ?? `Batter ${idx + 1}`;
      const savant = r.status === 'fulfilled' ? r.value : null;
      if (idx < homeBatters9.length) savantBatters.home.push({ name, savant });
      else                            savantBatters.away.push({ name, savant });
    });

    parkFactorData      = referenceResults[0].status === 'fulfilled' ? referenceResults[0].value : null;
    catcherFraming.home = referenceResults[1].status === 'fulfilled' ? referenceResults[1].value : null;
    catcherFraming.away = referenceResults[2].status === 'fulfilled' ? referenceResults[2].value : null;
    allOFPlayers.forEach(({ player, pos, side }, idx) => {
      const oaa = referenceResults[3 + idx].status === 'fulfilled' ? referenceResults[3 + idx].value : null;
      if (oaa) oaaOutfielders.push({ name: player.fullName ?? player.name, pos, side, oaa });
    });

    savantCacheStatus = getCacheStatus();
  } catch (err) {
    console.warn('[context-builder] Baseball Savant unavailable — continuing without Statcast data:', err.message);
  }

  // ── Real-time weather (Open-Meteo, non-blocking) ─────────────────────────
  let weatherData = null;
  try {
    weatherData = await getGameWeather(homeName, gameData.gameTime);
  } catch (err) {
    console.warn('[context-builder] Weather fetch failed — continuing without weather data:', err.message);
  }

  // ── DEBUG: log assembled data before building context string ───────────────
  console.log('=== CONTEXT BUILDER DEBUG ===');
  console.log('MLB Stats data keys:', Object.keys({
    homeHitting:       homeHitting,
    awayHitting:       awayHitting,
    homePitcherStats:  homePitcherStats,
    awayPitcherStats:  awayPitcherStats,
  }).filter(k => ({ homeHitting, awayHitting, homePitcherStats, awayPitcherStats })[k] != null));
  console.log('Statcast data available:', !!(homePitcherSavant || awayPitcherSavant));
  console.log('Odds data:', JSON.stringify(oddsData)?.substring(0, 300));
  console.log('=== END CONTEXT BUILDER ===');

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

  // ── Statcast / Savant blocks ─────────────────────────────────────────────
  blocks.push(pitcherSavantBlock('HOME', homePitcherSavant));
  blocks.push('');
  blocks.push(pitcherSavantBlock('AWAY', awayPitcherSavant));
  blocks.push('');

  // Batter Savant — only rendered when lineup data was available
  if (savantBatters.home.length > 0 || savantBatters.away.length > 0) {
    blocks.push(section(`BATTER STATCAST — TOP 3 per Lineup (Savant ${new Date().getFullYear()})`));
    if (savantBatters.home.length > 0) {
      blocks.push(`${homeName} (Home):`);
      savantBatters.home.forEach(({ name, savant }) => blocks.push(batterSavantLine(name, savant)));
    }
    if (savantBatters.away.length > 0) {
      blocks.push(`${awayName} (Away):`);
      savantBatters.away.forEach(({ name, savant }) => blocks.push(batterSavantLine(name, savant)));
    }
    blocks.push('');
  }

  // ── Park Factor ──────────────────────────────────────────────────────────
  try {
    blocks.push(section('PARK FACTOR (Baseball Savant)'));
    if (parkFactorData) {
      blocks.push(`Venue: ${parkFactorData.venue_name ?? gameData.venue?.name ?? 'N/A'}`);
      blocks.push(
        `Overall: ${parkFactorData.park_factor_overall ?? 'N/A'}` +
        ` | HR: ${parkFactorData.park_factor_HR ?? 'N/A'}` +
        ` | Hits: ${parkFactorData.park_factor_H ?? 'N/A'}` +
        ` | Runs: ${parkFactorData.park_factor_R ?? 'N/A'}`
      );
    } else {
      blocks.push('Park factor data unavailable');
    }
    blocks.push('');
  } catch (_) { /* skip silently */ }

  // ── Catcher Framing ──────────────────────────────────────────────────────
  try {
    if (catcherFraming.home || catcherFraming.away) {
      blocks.push(section('CATCHER FRAMING'));
      const fmtCatcher = (label, data) => {
        if (!data) return null;
        return (
          `${label} C (${data.player_name}): framing_runs=${data.framing_runs ?? 'N/A'}` +
          `, extra_strikes/game=${data.extra_strikes_per_game ?? 'N/A'}`
        );
      };
      const homeLine = fmtCatcher('Home', catcherFraming.home);
      const awayLine = fmtCatcher('Away', catcherFraming.away);
      if (homeLine) blocks.push(homeLine);
      if (awayLine) blocks.push(awayLine);
      blocks.push('');
    }
  } catch (_) { /* skip silently */ }

  // ── Outfield Defense OAA ─────────────────────────────────────────────────
  try {
    if (oaaOutfielders.length > 0) {
      blocks.push(section('OUTFIELD DEFENSE (OAA)'));
      oaaOutfielders.forEach(({ name, pos, side, oaa }) => {
        blocks.push(
          `${side} ${pos} ${name}: OAA=${oaa.outs_above_average ?? 'N/A'}` +
          `, runs_prevented=${oaa.fielding_runs_prevented ?? 'N/A'}`
        );
      });
      blocks.push('');
    }
  } catch (_) { /* skip silently */ }

  // Savant cache status (informational, not for Claude reasoning)
  if (savantCacheStatus) {
    blocks.push(
      `[Savant cache: updated ${savantCacheStatus.lastUpdated ?? 'never'} | ` +
      `batters: ${savantCacheStatus.recordCounts.xStatsBatter} pitchers: ${savantCacheStatus.recordCounts.xStatsPitcher}]`
    );
    blocks.push('');
  }

  // Market odds (injected when The Odds API data is available)
  if (oddsData?.odds) {
    const { moneyline: ml, runLine: rl, overUnder: ou } = oddsData.odds;
    const am  = (n) => (n == null ? 'N/A' : n > 0 ? `+${n}` : String(n));
    const sp  = (n) => (n == null ? '?'   : n > 0 ? `+${n}` : String(n));
    blocks.push('');
    blocks.push(section('MARKET ODDS'));
    if (oddsData.source === 'estimated_spring_training') {
      blocks.push('⚠ ESTIMATED LINES (Spring Training — no real market available)');
    }
    blocks.push(
      `ML Home ${am(ml.home)} Away ${am(ml.away)}` +
      ` | RL Home ${sp(rl.home.spread)} ${am(rl.home.price)} Away ${sp(rl.away.spread)} ${am(rl.away.price)}` +
      ` | O/U ${ou.total ?? 'N/A'} O${am(ou.overPrice)} U${am(ou.underPrice)}`
    );
  }

  // ── Weather Conditions ─────────────────────────────────────────────────────
  blocks.push('');
  if (weatherData) {
    if (weatherData.isIndoor) {
      blocks.push(`=== WEATHER: INDOOR STADIUM (${weatherData.stadium}) — Weather not a factor ===`);
    } else {
      blocks.push(`=== WEATHER CONDITIONS — ${weatherData.stadium} ===`);
      blocks.push(`Temperature: ${weatherData.temperature}°F`);
      blocks.push(`Wind: ${weatherData.windSpeed}mph`);
      blocks.push(`Rain probability: ${weatherData.precipitationProbability}%`);
      const flags = weatherData.analysis ?? [];
      blocks.push(`⚠️ WEATHER FLAGS: ${flags.length > 0 ? flags.join(' | ') : 'No significant weather factors'}`);
      blocks.push(
        'ORACLE INSTRUCTION: Factor wind speed and direction into OVER/UNDER analysis. ' +
        'Wind > 15mph toward outfield = OVER bias. Cold < 50°F = UNDER bias. Rain > 60% = reduce confidence.'
      );
    }
  }

  // ── Lineup Status ──────────────────────────────────────────────────────────
  blocks.push('');
  blocks.push(lineupStatusBlock(gameData));
  console.log(`[context-builder] Lineup status: ${gameData.lineupStatus ?? 'unavailable'}`);

  // ── Team Verification ──────────────────────────────────────────────────────
  const homeVerLine = teamVerificationLine(homePitcher?.fullName ?? 'Home pitcher', homeAbbr, homePitcherTeam);
  const awayVerLine = teamVerificationLine(awayPitcher?.fullName ?? 'Away pitcher', awayAbbr, awayPitcherTeam);
  if (homeVerLine || awayVerLine) {
    blocks.push('');
    blocks.push('=== TEAM VERIFICATION ===');
    if (homeVerLine) blocks.push(homeVerLine);
    if (awayVerLine) blocks.push(awayVerLine);
  }

  // ── Pitcher Historical Trends ──────────────────────────────────────────────
  const homePitcherHist = pitcherHistoricalBlock(homePitcher?.fullName ?? 'Home Pitcher', homeAbbr, homePitcherStats, maxPastSeasons);
  const awayPitcherHist = pitcherHistoricalBlock(awayPitcher?.fullName ?? 'Away Pitcher', awayAbbr, awayPitcherStats, maxPastSeasons);
  if (homePitcherHist) { blocks.push(''); blocks.push(homePitcherHist); }
  if (awayPitcherHist) { blocks.push(''); blocks.push(awayPitcherHist); }

  // ── Team Hitting Historical Trends ─────────────────────────────────────────
  const homeTeamHist = teamHistoricalBlock(homeName, homeHitting, maxPastSeasons);
  const awayTeamHist = teamHistoricalBlock(awayName, awayHitting, maxPastSeasons);
  if (homeTeamHist) { blocks.push(''); blocks.push(homeTeamHist); }
  if (awayTeamHist) { blocks.push(''); blocks.push(awayTeamHist); }

  // Historical MLB reference data (always appended — park factors + team tendencies)
  blocks.push('');
  blocks.push(buildHistoricalContextBlock());

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
