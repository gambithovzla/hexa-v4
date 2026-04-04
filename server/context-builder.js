/**
 * Auto-context fetcher
 * Construye el contexto estructurado que H.E.X.A. necesita para analizar un partido.
 *
 * Función principal: buildContext(gameData)
 *   Recibe un objeto normalizado de getTodayGames() y devuelve un string listo
 *   para inyectar en el prompt del Oracle.
 */

import { getPitcherStats, getTeamHittingStats, getPitcherHistoricalStats, getTeamHittingHistoricalStats, getCurrentTeam, getTeamPitchingStats, getTeamHittingSplits, getBullpenUsage, getBatterSplits, getPitcherHomeSplits, getPitcherRestDays } from './mlb-api.js';
import { getBatterStatcast, getPitcherStatcast, getParkFactor, getCatcherFraming, getFieldingOAA, getCacheStatus } from './savant-fetcher.js';
import { getGameWeather } from './weather-api.js';
import { calculateImpliedProbability } from './odds-api.js';
import { getLineMovement } from './line-movement.js';

// ---------------------------------------------------------------------------
// In-memory context cache — avoids redundant API calls when the same game is
// analysed multiple times within a short window (e.g. props then moneyline).
// ---------------------------------------------------------------------------

const _contextCache = new Map();
const CONTEXT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

// Limpiar entradas expiradas cada 30 minutos
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _contextCache) {
    if (now - val.timestamp > CONTEXT_CACHE_TTL_MS) _contextCache.delete(key);
  }
  if (_contextCache.size > 0) console.log(`[context-builder] Cache cleanup — ${_contextCache.size} entries remaining`);
}, 30 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Historical MLB context (static reference data for Spring Training + early season)
// ---------------------------------------------------------------------------

const HISTORICAL_MLB_CONTEXT = {
  park_factors_2026: {
    LAD: { overall: 104, hr: 129, r: 108, description: 'UNIQLO Field at Dodger Stadium - hitter friendly, extreme HR park' },
    PHI: { overall: 104, hr: 113, r: 108, description: 'Citizens Bank Park - hitter friendly' },
    CIN: { overall: 103, hr: 112, r: 106, description: 'Great American Ball Park - hitter friendly' },
    BAL: { overall: 103, hr: 105, r: 106, description: 'Oriole Park at Camden Yards - hitter friendly' },
    HOU: { overall: 102, hr: 108, r: 104, description: 'Daikin Park - slight hitter friendly' },
    NYM: { overall: 100, hr: 99,  r: 100, description: 'Citi Field - neutral' },
    MIL: { overall: 99,  hr: 100, r: 98,  description: 'American Family Field - neutral dome' },
    SD:  { overall: 99,  hr: 104, r: 98,  description: 'Petco Park - neutral, slight HR boost' },
    STL: { overall: 99,  hr: 75,  r: 98,  description: 'Busch Stadium - neutral overall, extreme HR suppression' },
    SF:  { overall: 99,  hr: 71,  r: 98,  description: 'Oracle Park - neutral overall, extreme HR suppression, marine layer' },
    CHC: { overall: 96,  hr: 94,  r: 92,  description: 'Wrigley Field - pitcher friendly, wind dependent' },
    SEA: { overall: 91,  hr: 92,  r: 83,  description: 'T-Mobile Park - extreme pitcher park' },
    COL: { overall: 110, hr: 120, r: 112, description: 'Coors Field - extreme hitter park, high altitude' },
    TEX: { overall: 101, hr: 106, r: 102, description: 'Globe Life Field - slight hitter friendly dome' },
    BOS: { overall: 101, hr: 95,  r: 103, description: 'Fenway Park - slight hitter friendly, unique dimensions' },
    NYY: { overall: 100, hr: 105, r: 100, description: 'Yankee Stadium - neutral overall, short porch HR boost' },
    ATL: { overall: 100, hr: 100, r: 100, description: 'Truist Park - neutral' },
    MIN: { overall: 100, hr: 102, r: 100, description: 'Target Field - neutral' },
    TOR: { overall: 100, hr: 100, r: 100, description: 'Rogers Centre - neutral dome' },
    ARI: { overall: 100, hr: 102, r: 100, description: 'Chase Field - neutral, retractable roof' },
    CLE: { overall: 99,  hr: 97,  r: 99,  description: 'Progressive Field - slight pitcher friendly' },
    DET: { overall: 99,  hr: 98,  r: 99,  description: 'Comerica Park - slight pitcher friendly' },
    KC:  { overall: 99,  hr: 98,  r: 99,  description: 'Kauffman Stadium - slight pitcher friendly' },
    PIT: { overall: 99,  hr: 97,  r: 99,  description: 'PNC Park - slight pitcher friendly' },
    TB:  { overall: 99,  hr: 97,  r: 99,  description: 'Tropicana Field - slight pitcher friendly dome' },
    CWS: { overall: 98,  hr: 100, r: 98,  description: 'Guaranteed Rate Field - neutral' },
    LAA: { overall: 98,  hr: 96,  r: 98,  description: 'Angel Stadium - slight pitcher friendly' },
    WSH: { overall: 98,  hr: 99,  r: 98,  description: 'Nationals Park - slight pitcher friendly' },
    OAK: { overall: 97,  hr: 95,  r: 97,  description: 'Sacramento - estimated neutral to slight pitcher friendly' },
    MIA: { overall: 96,  hr: 92,  r: 96,  description: 'LoanDepot Park - pitcher friendly dome' },
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
  const pf = HISTORICAL_MLB_CONTEXT.park_factors_2026;
  const tt = HISTORICAL_MLB_CONTEXT.team_tendencies_historical;
  const st = HISTORICAL_MLB_CONTEXT.spring_training_adjustments;

  const pfLines = Object.entries(pf).map(([abbr, d]) =>
    `  ${abbr}: overall=${d.overall} HR=${d.hr} R=${d.r ?? 'N/A'} — ${d.description}`
  );
  const ttLines = Object.entries(tt).map(([abbr, d]) => {
    const pct = d.home_win_pct_5yr ?? d.road_win_pct_5yr;
    const side = d.home_win_pct_5yr ? 'home' : 'road';
    return `  ${abbr}: ${side}_win_pct_5yr=${pct} — ${d.notes}`;
  });

  return [
    '=== HISTORICAL MLB REFERENCE DATA ===',
    '--- PARK FACTORS (2025 estimates) ---',
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

/**
 * Builds the offensive context block for one team.
 *
 * @param {string}      label        — 'HOME' | 'AWAY'
 * @param {object|null} hittingData  — season overall stats from getTeamHittingHistoricalStats()
 * @param {string}      teamName     — display name of the team
 * @param {object|null} splitsData   — result of getTeamHittingSplits() { vsLHP, vsRHP }
 * @param {string|null} rivalHand    — throwing hand of the opposing starter: 'L', 'R', or null
 */
function offenseBlock(label, hittingData, teamName, splitsData = null, rivalHand = null, rivalPitcherName = null) {
  const rivalInfo = rivalPitcherName
    ? ` — FACING: ${rivalPitcherName} (${rivalHand === 'L' ? 'LHP' : rivalHand === 'R' ? 'RHP' : '?'})`
    : '';
  const lines = [section(`${label} OFFENSE (Season)${rivalInfo}`)];

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

  // ── Platoon Splits cross-match ─────────────────────────────────────────────
  // If we know the rival pitcher's hand, inject the specific split stats.
  // Fallback: show both splits when hand is unknown but splits data is available.
  if (splitsData) {
    if (rivalHand === 'L' && splitsData.vsLHP) {
      const sp = splitsData.vsLHP;
      lines.push(
        `[PLATOON SPLIT — vs LHP (Matchup)] AVG: ${fmt.stat(sp.avg)} | OBP: ${fmt.stat(sp.obp)} | SLG: ${fmt.stat(sp.slg)} | OPS: ${fmt.stat(sp.ops)}` +
        (sp.atBats ? ` | AB: ${sp.atBats}` : '') +
        ` ← ORACLE: use these figures, not the season overall above`
      );
    } else if (rivalHand === 'R' && splitsData.vsRHP) {
      const sp = splitsData.vsRHP;
      lines.push(
        `[PLATOON SPLIT — vs RHP (Matchup)] AVG: ${fmt.stat(sp.avg)} | OBP: ${fmt.stat(sp.obp)} | SLG: ${fmt.stat(sp.slg)} | OPS: ${fmt.stat(sp.ops)}` +
        (sp.atBats ? ` | AB: ${sp.atBats}` : '') +
        ` ← ORACLE: use these figures, not the season overall above`
      );
    } else if (!rivalHand) {
      // Rival hand unknown — expose both so the Oracle at least has context.
      if (splitsData.vsLHP) {
        const sp = splitsData.vsLHP;
        lines.push(
          `[PLATOON SPLIT — vs LHP (pitcher hand TBD)] AVG: ${fmt.stat(sp.avg)} | OBP: ${fmt.stat(sp.obp)} | SLG: ${fmt.stat(sp.slg)} | OPS: ${fmt.stat(sp.ops)}`
        );
      }
      if (splitsData.vsRHP) {
        const sp = splitsData.vsRHP;
        lines.push(
          `[PLATOON SPLIT — vs RHP (pitcher hand TBD)] AVG: ${fmt.stat(sp.avg)} | OBP: ${fmt.stat(sp.obp)} | SLG: ${fmt.stat(sp.slg)} | OPS: ${fmt.stat(sp.ops)}`
        );
      }
    }
    // rivalHand defined but no matching split entry → fall through silently (overall already shown).
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bloque de bullpen / pitcheo del equipo (texto)
// ---------------------------------------------------------------------------

/**
 * Formatea las estadísticas de pitcheo/bullpen de ambos equipos en un bloque
 * de texto claro para el LLM.
 *
 * @param {string} homeName       — Nombre del equipo local
 * @param {string} awayName       — Nombre del equipo visitante
 * @param {object|null} homePitching — Resultado de getTeamPitchingStats() para Home
 * @param {object|null} awayPitching — Resultado de getTeamPitchingStats() para Away
 * @returns {string}
 */
function buildBullpenBlock(homeName, awayName, homePitching, awayPitching, homeBullpenUsage, awayBullpenUsage) {
  const lines = ['### BULLPEN & RELIEF PITCHING ###'];

  const fmtStat = (v, d = 2) => (v != null ? Number(v).toFixed(d) : 'N/A');

  const formatTeamLine = (label, pitchingData) => {
    const stats = pitchingData?.bullpen ?? pitchingData?.overall ?? null;
    if (!stats) {
      return `[${label}] Bullpen Season: Datos no disponibles`;
    }
    const era  = fmtStat(stats.era);
    const whip = fmtStat(stats.whip);
    const k9   = fmtStat(stats.strikeoutsPer9Inn);
    const bb9  = fmtStat(stats.walksPer9Inn);
    const saves = stats.saves != null ? ` | SV: ${stats.saves}` : '';
    const source = pitchingData?.bullpen ? '(Bullpen)' : '(Team pitching)';
    return `[${label}] ${source} Season ERA: ${era} | WHIP: ${whip} | K/9: ${k9} | BB/9: ${bb9}${saves}`;
  };

  lines.push(formatTeamLine(homeName, homePitching ?? null));
  lines.push(formatTeamLine(awayName, awayPitching ?? null));

  // ── Recent usage block (P3) ──────────────────────────────────────────────
  const formatUsageBlock = (label, usage) => {
    if (!usage) return [`[${label}] Recent Bullpen Usage: No data available`];
    const uLines = [];
    uLines.push(`[${label}] RECENT BULLPEN USAGE (last 3 days, ${usage.gamesAnalyzed} games analyzed):`);
    uLines.push(`  Workload: ${usage.bullpenIP_1d}IP yesterday | ${usage.bullpenIP_2d}IP last 2d | ${usage.bullpenIP_3d}IP last 3d | ${usage.bullpenER_3d}ER | ${usage.bullpenK_3d}K`);

    const fatigued = usage.relievers.filter(r => r.isBackToBack || r.totalIP_last3d >= 2.0);
    const heavy    = usage.relievers.filter(r => r.totalIP_last3d >= 3.0);

    if (heavy.length > 0) {
      uLines.push(`  ⚠ HEAVY USAGE: ${heavy.map(r => `${r.name} (${r.totalIP_last3d.toFixed(1)}IP/${r.gamesLast3d}G)`).join(', ')}`);
    }
    if (fatigued.length > 0) {
      const b2b = fatigued.filter(r => r.isBackToBack);
      if (b2b.length > 0) {
        uLines.push(`  ⚠ BACK-TO-BACK: ${b2b.map(r => r.name).join(', ')} — pitched consecutive days`);
      }
    }

    const fresh = usage.relievers.filter(r => r.gamesLast3d === 0 || (r.gamesLast3d === 1 && r.totalIP_last3d <= 1.0));
    if (fresh.length > 0) {
      uLines.push(`  ✓ FRESH/AVAILABLE: ${fresh.map(r => r.name).join(', ')}`);
    }

    // Fatigue summary for Oracle
    if (usage.bullpenIP_3d >= 10) {
      uLines.push(`  🔴 BULLPEN FATIGUE: CRITICAL — ${usage.bullpenIP_3d}IP in 3 days. Late-inning vulnerability HIGH.`);
    } else if (usage.bullpenIP_3d >= 7) {
      uLines.push(`  🟡 BULLPEN FATIGUE: MODERATE — ${usage.bullpenIP_3d}IP in 3 days. Monitor late innings.`);
    } else {
      uLines.push(`  🟢 BULLPEN FATIGUE: LOW — ${usage.bullpenIP_3d}IP in 3 days. Bullpen relatively fresh.`);
    }

    return uLines;
  };

  lines.push('');
  lines.push(...formatUsageBlock(homeName, homeBullpenUsage));
  lines.push('');
  lines.push(...formatUsageBlock(awayName, awayBullpenUsage));

  lines.push('');
  lines.push('ORACLE INSTRUCTION: When bullpen fatigue is CRITICAL or MODERATE, bias OVER/UNDER toward OVER for late innings. When a key reliever is back-to-back, reduce confidence in that team holding a lead. Fresh bullpen = UNDER bias for late innings.');
  lines.push('### END BULLPEN ###');

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
// Deep K Props Analysis block
// ---------------------------------------------------------------------------

/**
 * Builds the Deep K Props Analysis context block.
 * Inserted after BATTER STATCAST, before PARK FACTOR.
 * Returns null when neither pitcher has Statcast data.
 *
 * @param {object|null} homePitcher       — probable pitcher object (home)
 * @param {object|null} awayPitcher       — probable pitcher object (away)
 * @param {object|null} homePitcherSavant — Statcast data for home pitcher
 * @param {object|null} awayPitcherSavant — Statcast data for away pitcher
 * @param {{ home: Array, away: Array }} savantBatters — top-3 batter Statcast per side
 * @returns {string|null}
 */
function buildKPropsBlock(homePitcher, awayPitcher, homePitcherSavant, awayPitcherSavant, savantBatters) {
  if (!homePitcherSavant && !awayPitcherSavant) return null;

  const fp1 = (v) => (v != null ? Number(v).toFixed(1) : 'N/A');
  const f3  = (v) => (v != null ? Number(v).toFixed(3) : 'N/A');

  const PITCH_DISPLAY = {
    ff: '4-seam FB', si: 'Sinker', fc: 'Cutter', sl: 'Slider',
    cu: 'Curveball', ch: 'Changeup', fs: 'Splitter', kn: 'Knuckleball',
    sv: 'Sweeper', st: 'Sweeper', cs: 'Slow Curve',
  };

  /** Finds the pitch type with the highest whiff% in the arsenal object. */
  function bestKPitch(arsenal) {
    if (!arsenal || typeof arsenal !== 'object') return null;
    let best = null;
    for (const prefix of Object.keys(PITCH_DISPLAY)) {
      const whiffKey = Object.keys(arsenal).find(k =>
        k.toLowerCase().startsWith(prefix + '_') && k.toLowerCase().includes('whiff')
      );
      if (!whiffKey) continue;
      const whiff = parseFloat(arsenal[whiffKey]);
      if (isNaN(whiff)) continue;
      const rvKey = Object.keys(arsenal).find(k =>
        k.toLowerCase().startsWith(prefix + '_') && k.toLowerCase().includes('run_value_per_100')
      );
      const rv = rvKey ? parseFloat(arsenal[rvKey]) : null;
      if (!best || whiff > best.whiff) {
        best = { pitchType: PITCH_DISPLAY[prefix] ?? prefix.toUpperCase(), whiff, runValue: isNaN(rv) ? null : rv };
      }
    }
    return best;
  }

  /** Returns K Props Edge label based on whiff% and K%. Values are percentages (e.g. 32.5, not 0.325). */
  function kPropsEdge(whiffPct, kPct) {
    if (whiffPct == null || kPct == null) return 'NEUTRAL (insufficient data)';
    if (whiffPct > 32 && kPct > 27) return 'STRONG OVER';
    if (whiffPct > 28 && kPct > 24) return 'LEAN OVER';
    if (whiffPct < 20 || kPct < 18) return 'STRONG UNDER';
    if (whiffPct < 24 && kPct < 21) return 'LEAN UNDER';
    return 'NEUTRAL';
  }

  /** Calculates lineup K susceptibility from top-N batter data, scaled to 9-batter lineup. */
  function lineupKSusceptibility(batters) {
    const withData = batters.filter(b => b.savant?.xwOBA != null);
    if (withData.length === 0) {
      return { label: 'UNKNOWN (no Statcast data)', weakCount: 'N/A', avgXwOBA: null };
    }
    const weakCount    = withData.filter(b => b.savant.xwOBA < 0.300).length;
    const avgXwOBA     = withData.reduce((s, b) => s + b.savant.xwOBA, 0) / withData.length;
    // Scale weak-contact count to 9-batter lineup estimate
    const scaledWeak   = Math.round((weakCount / withData.length) * 9);
    const label        = scaledWeak >= 5 ? 'HIGH' : scaledWeak >= 3 ? 'MEDIUM' : 'LOW';
    return { label, weakCount: scaledWeak, avgXwOBA };
  }

  /** Builds the profile block for one pitcher side. */
  function pitcherKSection(side, pitcher, savant, opponentBatters) {
    const name        = pitcher?.fullName ?? `${side} Pitcher`;
    const oppSide     = side === 'HOME' ? 'AWAY' : 'HOME';
    const lines       = [`${side} PITCHER K PROFILE: ${name}`];

    if (!savant) {
      lines.push('No Statcast data available');
      return lines.join('\n');
    }

    const whiff = savant.whiff_percent;
    const kPct  = savant.k_percent;
    const csw   = savant.csw_percent;
    const chase = savant.o_swing_percent;

    // Savant stores k_percent / whiff_percent as decimals (e.g. 0.285) OR whole numbers (28.5).
    // Normalise to percentage point values for display and logic.
    const toPercPt = (v) => (v != null ? (v <= 1 ? v * 100 : v) : null);
    const whiffPP = toPercPt(whiff);
    const kPctPP  = toPercPt(kPct);
    const cswPP   = toPercPt(csw);
    const chasePP = toPercPt(chase);

    const statLine = [
      `Season K%: ${kPctPP != null ? fp1(kPctPP) + '%' : 'N/A'}`,
      `Whiff%: ${whiffPP != null ? fp1(whiffPP) + '%' : 'N/A'}`,
    ];
    if (cswPP   != null) statLine.push(`CSW%: ${fp1(cswPP)}%`);
    if (chasePP != null) statLine.push(`Chase Rate: ${fp1(chasePP)}%`);
    lines.push(statLine.join(' | '));

    const bestPitch = bestKPitch(savant.arsenal);
    if (bestPitch) {
      const rvStr = bestPitch.runValue != null ? `, Run Value ${Number(bestPitch.runValue).toFixed(1)}` : '';
      lines.push(`Best Strikeout Pitch: ${bestPitch.pitchType} — Whiff% ${fp1(bestPitch.whiff)}%${rvStr}`);
    } else {
      lines.push('Best Strikeout Pitch: N/A (no per-pitch arsenal data)');
    }

    const edge = kPropsEdge(whiffPP, kPctPP);
    lines.push(`K Props Edge: ${edge}`);
    lines.push('');

    const sus = lineupKSusceptibility(opponentBatters);
    lines.push(`vs ${oppSide} LINEUP K Vulnerability:`);
    lines.push(`* Batters with xwOBA < .300 (weak contact): ~${sus.weakCount} of 9`);
    if (sus.avgXwOBA != null) lines.push(`* Avg lineup xwOBA: ${f3(sus.avgXwOBA)}`);
    lines.push(`* Lineup K Susceptibility: ${sus.label}`);

    return lines.join('\n');
  }

  /** Returns recommendation string for one pitcher. */
  function kPropRec(sideLabel, savant) {
    if (!savant) return `${sideLabel} Pitcher K Prop: SKIP — no Statcast data`;
    const toPercPt = (v) => (v != null ? (v <= 1 ? v * 100 : v) : null);
    const edge = kPropsEdge(toPercPt(savant.whiff_percent), toPercPt(savant.k_percent));
    if (edge === 'STRONG OVER')  return `${sideLabel} Pitcher K Prop: OVER — Elite Whiff% + K% combination`;
    if (edge === 'LEAN OVER')    return `${sideLabel} Pitcher K Prop: OVER — Above-average strikeout profile`;
    if (edge === 'STRONG UNDER') return `${sideLabel} Pitcher K Prop: UNDER — Below-average strikeout metrics`;
    if (edge === 'LEAN UNDER')   return `${sideLabel} Pitcher K Prop: UNDER — Below-league-average K profile`;
    return `${sideLabel} Pitcher K Prop: SKIP — No strong K prop edge identified`;
  }

  const out = ['=== DEEP K PROPS ANALYSIS ===', ''];
  out.push(pitcherKSection('HOME', homePitcher, homePitcherSavant, savantBatters?.away ?? []));
  out.push('');
  out.push(pitcherKSection('AWAY', awayPitcher, awayPitcherSavant, savantBatters?.home ?? []));
  out.push('');
  out.push('K PROPS RECOMMENDATION:');
  out.push(kPropRec('Home', homePitcherSavant));
  out.push(kPropRec('Away', awayPitcherSavant));
  out.push('=== END K PROPS ===');

  return out.join('\n');
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

// ---------------------------------------------------------------------------
// Data Integrity Layer
// ---------------------------------------------------------------------------

function calcDataQuality({
  homePitcherStats, awayPitcherStats,
  homePitcher, awayPitcher,
  homePitcherSavant, awayPitcherSavant,
  savantBatters, weatherData, parkFactorData,
  oddsData, gameData,
}) {
  let score = 0;
  const missing = [];
  const available = [];

  // Pitchers (30 pts)
  if (homePitcher?.fullName && homePitcherStats?.stats) { score += 15; available.push('home_pitcher_stats'); }
  else missing.push('home_pitcher_stats');
  if (awayPitcher?.fullName && awayPitcherStats?.stats) { score += 15; available.push('away_pitcher_stats'); }
  else missing.push('away_pitcher_stats');

  // Statcast pitchers (20 pts) — give full points if savant object exists, even if some fields are null
  if (homePitcherSavant != null) { score += 10; available.push('home_pitcher_statcast'); }
  else missing.push('home_pitcher_statcast');
  if (awayPitcherSavant != null) { score += 10; available.push('away_pitcher_statcast'); }
  else missing.push('away_pitcher_statcast');

  // Statcast batters (10 pts) — give full points if any batters returned, even if not all have every field
  const hasBatterData = (savantBatters?.home?.length ?? 0) > 0 || (savantBatters?.away?.length ?? 0) > 0;
  const battersWithData = [
    ...(savantBatters?.home ?? []),
    ...(savantBatters?.away ?? []),
  ].filter(b => b.savant?.xwOBA != null).length;
  if (hasBatterData) { score += 10; available.push('batter_statcast'); }
  else missing.push(`batter_statcast (only ${battersWithData} with data)`);

  // Rolling windows (10 pts) — accept any rolling data from pitchers or batters
  const hasRolling = (homePitcherSavant?.rolling_windows_against?.woba_against_7d != null)
    || (awayPitcherSavant?.rolling_windows_against?.woba_against_7d != null)
    || (savantBatters?.home?.some(b => b.savant?.rolling_woba_30d != null))
    || (savantBatters?.away?.some(b => b.savant?.rolling_woba_30d != null));
  if (hasRolling) { score += 10; available.push('rolling_windows'); }
  else missing.push('rolling_windows');

  // Odds (10 pts)
  if (oddsData?.odds && oddsData.source !== 'estimated_spring_training') { score += 10; available.push('real_odds'); }
  else missing.push('real_odds (spring training estimates)');

  // Lineup (10 pts)
  if (gameData?.lineupStatus === 'confirmed') { score += 10; available.push('confirmed_lineup'); }
  else missing.push('confirmed_lineup');

  // Weather (5 pts)
  if (weatherData && !weatherData.error) { score += 5; available.push('weather'); }
  else missing.push('weather');

  // Park factor (5 pts)
  if (parkFactorData?.park_factor_overall != null) { score += 5; available.push('park_factor'); }
  else missing.push('park_factor');

  // Determine strategy
  let strategy, confidencePenalty, allowedBetTypes;
  if (score >= 75) {
    strategy = 'FULL_ANALYSIS';
    confidencePenalty = 0;
    allowedBetTypes = 'all';
  } else if (score >= 50) {
    strategy = 'STANDARD_ANALYSIS';
    confidencePenalty = 0;
    allowedBetTypes = 'moneyline, runline, over-under, props only if batter statcast available';
  } else if (score >= 30) {
    strategy = 'LIMITED_ANALYSIS';
    confidencePenalty = 15;
    allowedBetTypes = 'moneyline and over-under only';
  } else {
    strategy = 'MINIMAL_ANALYSIS';
    confidencePenalty = 25;
    allowedBetTypes = 'moneyline only';
  }

  return { score, strategy, confidencePenalty, allowedBetTypes, missing, available };
}

// ---------------------------------------------------------------------------
// Signal Coherence Layer
// ---------------------------------------------------------------------------

/**
 * Evalúa si las señales estadísticas se alinean (coherentes) o se contradicen.
 * Cada señal vota OVER, UNDER o NEUTRAL.
 *
 * @param {object|null} homePitcherSavant
 * @param {object|null} awayPitcherSavant
 * @param {{ home: Array, away: Array }} savantBatters
 * @param {object|null} parkFactorData
 * @param {object|null} weatherData
 * @param {object|null} homePitching
 * @param {object|null} awayPitching
 * @returns {{ coherenceScore: number, overSignals: number, underSignals: number,
 *             neutralSignals: number, dominantDirection: string,
 *             signals: Array<{name:string, vote:string, reason:string}> }}
 */
function calcSignalCoherence({
  homePitcherSavant, awayPitcherSavant,
  savantBatters,
  parkFactorData,
  weatherData,
  homePitching, awayPitching,
}) {
  const signals = [];

  function vote(name, v, reason) {
    signals.push({ name, vote: v, reason });
  }

  // 1. HOME PITCHER (xwOBA_against)
  const homeXwOBA = homePitcherSavant?.xwOBA_against;
  if (homeXwOBA == null) {
    vote('Home Pitcher (Statcast)', 'NEUTRAL', 'No xwOBA_against data');
  } else if (homeXwOBA < 0.300) {
    vote('Home Pitcher (Statcast)', 'UNDER', `xwOBA_against ${homeXwOBA.toFixed(3)} — elite`);
  } else if (homeXwOBA > 0.360) {
    vote('Home Pitcher (Statcast)', 'OVER', `xwOBA_against ${homeXwOBA.toFixed(3)} — hittable`);
  } else {
    vote('Home Pitcher (Statcast)', 'NEUTRAL', `xwOBA_against ${homeXwOBA.toFixed(3)} — league avg`);
  }

  // 2. AWAY PITCHER (xwOBA_against)
  const awayXwOBA = awayPitcherSavant?.xwOBA_against;
  if (awayXwOBA == null) {
    vote('Away Pitcher (Statcast)', 'NEUTRAL', 'No xwOBA_against data');
  } else if (awayXwOBA < 0.300) {
    vote('Away Pitcher (Statcast)', 'UNDER', `xwOBA_against ${awayXwOBA.toFixed(3)} — elite`);
  } else if (awayXwOBA > 0.360) {
    vote('Away Pitcher (Statcast)', 'OVER', `xwOBA_against ${awayXwOBA.toFixed(3)} — hittable`);
  } else {
    vote('Away Pitcher (Statcast)', 'NEUTRAL', `xwOBA_against ${awayXwOBA.toFixed(3)} — league avg`);
  }

  // 3. HOME ROLLING FORM (woba_against_7d)
  const homeWoba7d = homePitcherSavant?.rolling_windows_against?.woba_against_7d;
  if (homeWoba7d == null) {
    vote('Home Pitcher Form (7d)', 'NEUTRAL', 'No rolling window data');
  } else if (homeWoba7d < 0.280) {
    vote('Home Pitcher Form (7d)', 'UNDER', `woba_against_7d ${homeWoba7d.toFixed(3)} — dominant streak`);
  } else if (homeWoba7d > 0.380) {
    vote('Home Pitcher Form (7d)', 'OVER', `woba_against_7d ${homeWoba7d.toFixed(3)} — struggling`);
  } else {
    vote('Home Pitcher Form (7d)', 'NEUTRAL', `woba_against_7d ${homeWoba7d.toFixed(3)}`);
  }

  // 4. AWAY ROLLING FORM (woba_against_7d)
  const awayWoba7d = awayPitcherSavant?.rolling_windows_against?.woba_against_7d;
  if (awayWoba7d == null) {
    vote('Away Pitcher Form (7d)', 'NEUTRAL', 'No rolling window data');
  } else if (awayWoba7d < 0.280) {
    vote('Away Pitcher Form (7d)', 'UNDER', `woba_against_7d ${awayWoba7d.toFixed(3)} — dominant streak`);
  } else if (awayWoba7d > 0.380) {
    vote('Away Pitcher Form (7d)', 'OVER', `woba_against_7d ${awayWoba7d.toFixed(3)} — struggling`);
  } else {
    vote('Away Pitcher Form (7d)', 'NEUTRAL', `woba_against_7d ${awayWoba7d.toFixed(3)}`);
  }

  // 5. HOME OFFENSE (avg xwOBA of home batters with Statcast data)
  const homeSCBatters = (savantBatters?.home ?? []).filter(b => b.savant?.xwOBA != null);
  if (homeSCBatters.length === 0) {
    vote('Home Offense (Statcast)', 'NEUTRAL', 'No batter Statcast data');
  } else {
    const avgXwOBA = homeSCBatters.reduce((s, b) => s + b.savant.xwOBA, 0) / homeSCBatters.length;
    if (avgXwOBA > 0.360) {
      vote('Home Offense (Statcast)', 'OVER', `Avg xwOBA ${avgXwOBA.toFixed(3)} — elite lineup`);
    } else if (avgXwOBA < 0.300) {
      vote('Home Offense (Statcast)', 'UNDER', `Avg xwOBA ${avgXwOBA.toFixed(3)} — weak lineup`);
    } else {
      vote('Home Offense (Statcast)', 'NEUTRAL', `Avg xwOBA ${avgXwOBA.toFixed(3)}`);
    }
  }

  // 6. AWAY OFFENSE (avg xwOBA of away batters with Statcast data)
  const awaySCBatters = (savantBatters?.away ?? []).filter(b => b.savant?.xwOBA != null);
  if (awaySCBatters.length === 0) {
    vote('Away Offense (Statcast)', 'NEUTRAL', 'No batter Statcast data');
  } else {
    const avgXwOBA = awaySCBatters.reduce((s, b) => s + b.savant.xwOBA, 0) / awaySCBatters.length;
    if (avgXwOBA > 0.360) {
      vote('Away Offense (Statcast)', 'OVER', `Avg xwOBA ${avgXwOBA.toFixed(3)} — elite lineup`);
    } else if (avgXwOBA < 0.300) {
      vote('Away Offense (Statcast)', 'UNDER', `Avg xwOBA ${avgXwOBA.toFixed(3)} — weak lineup`);
    } else {
      vote('Away Offense (Statcast)', 'NEUTRAL', `Avg xwOBA ${avgXwOBA.toFixed(3)}`);
    }
  }

  // 7. PARK FACTOR
  const parkOverall = parkFactorData?.park_factor_overall;
  if (parkOverall == null) {
    vote('Park Factor', 'NEUTRAL', 'No park factor data');
  } else if (parkOverall > 105) {
    vote('Park Factor', 'OVER', `park_factor_overall ${parkOverall} — hitter friendly`);
  } else if (parkOverall < 95) {
    vote('Park Factor', 'UNDER', `park_factor_overall ${parkOverall} — pitcher friendly`);
  } else {
    vote('Park Factor', 'NEUTRAL', `park_factor_overall ${parkOverall} — neutral`);
  }

  // 8. WEATHER
  if (!weatherData || weatherData.error) {
    vote('Weather', 'NEUTRAL', 'No weather data');
  } else if (weatherData.isIndoor) {
    vote('Weather', 'NEUTRAL', 'Indoor stadium — weather not a factor');
  } else {
    const temp = weatherData.temperature;
    const wind = weatherData.windSpeed;
    if (temp > 85 && wind > 10) {
      vote('Weather', 'OVER', `Temp ${temp}°F + wind ${wind}mph — ball carries`);
    } else if (temp < 50) {
      vote('Weather', 'UNDER', `Cold ${temp}°F — ball dies`);
    } else if (wind > 10) {
      vote('Weather', 'NEUTRAL', `Wind ${wind}mph at ${temp}°F — direction indeterminate`);
    } else {
      vote('Weather', 'NEUTRAL', `Temp ${temp}°F, wind ${wind}mph — no strong bias`);
    }
  }

  // 9. BULLPEN HOME
  const homeBP = homePitching?.bullpen ?? homePitching?.overall ?? null;
  if (!homeBP) {
    vote('Bullpen Home', 'NEUTRAL', 'No bullpen data');
  } else {
    const bpEra   = homeBP.era     != null ? parseFloat(homeBP.era)              : null;
    const bpInn3d = homeBP.innings_last_3d != null ? parseFloat(homeBP.innings_last_3d) : null;
    const eraStr  = bpEra  != null ? `ERA ${bpEra.toFixed(2)}`   : 'ERA N/A';
    const innStr  = bpInn3d != null ? ` / ${bpInn3d}IP last 3d` : '';
    if (bpEra != null && (bpEra > 4.50 || (bpInn3d != null && bpInn3d > 8))) {
      vote('Bullpen Home', 'OVER', `${eraStr}${innStr} — tired/vulnerable`);
    } else if (bpEra != null && bpEra < 3.00 && (bpInn3d == null || bpInn3d < 4)) {
      vote('Bullpen Home', 'UNDER', `${eraStr}${innStr} — fresh/elite`);
    } else {
      vote('Bullpen Home', 'NEUTRAL', `${eraStr}${innStr} — neutral range`);
    }
  }

  // 10. BULLPEN AWAY
  const awayBP = awayPitching?.bullpen ?? awayPitching?.overall ?? null;
  if (!awayBP) {
    vote('Bullpen Away', 'NEUTRAL', 'No bullpen data');
  } else {
    const bpEra   = awayBP.era     != null ? parseFloat(awayBP.era)              : null;
    const bpInn3d = awayBP.innings_last_3d != null ? parseFloat(awayBP.innings_last_3d) : null;
    const eraStr  = bpEra  != null ? `ERA ${bpEra.toFixed(2)}`   : 'ERA N/A';
    const innStr  = bpInn3d != null ? ` / ${bpInn3d}IP last 3d` : '';
    if (bpEra != null && (bpEra > 4.50 || (bpInn3d != null && bpInn3d > 8))) {
      vote('Bullpen Away', 'OVER', `${eraStr}${innStr} — tired/vulnerable`);
    } else if (bpEra != null && bpEra < 3.00 && (bpInn3d == null || bpInn3d < 4)) {
      vote('Bullpen Away', 'UNDER', `${eraStr}${innStr} — fresh/elite`);
    } else {
      vote('Bullpen Away', 'NEUTRAL', `${eraStr}${innStr} — neutral range`);
    }
  }

  // ── Calculate coherence score ─────────────────────────────────────────────
  const overCount    = signals.filter(s => s.vote === 'OVER').length;
  const underCount   = signals.filter(s => s.vote === 'UNDER').length;
  const neutralCount = signals.filter(s => s.vote === 'NEUTRAL').length;
  const total        = overCount + underCount;

  let coherenceScore;
  let dominantDirection;

  if (total === 0) {
    coherenceScore    = 50;
    dominantDirection = 'MIXED';
  } else if (underCount === 0) {
    coherenceScore    = 100;
    dominantDirection = 'OVER';
  } else if (overCount === 0) {
    coherenceScore    = 100;
    dominantDirection = 'UNDER';
  } else {
    coherenceScore    = Math.round((Math.max(overCount, underCount) / total) * 100);
    dominantDirection = overCount > underCount ? 'OVER' : underCount > overCount ? 'UNDER' : 'MIXED';
  }

  return { coherenceScore, overSignals: overCount, underSignals: underCount, neutralSignals: neutralCount, dominantDirection, signals };
}

/**
 * Construye el contexto estructurado completo para un partido.
 *
 * @param {object}      gameData — objeto normalizado devuelto por getTodayGames()
 * @param {object|null} oddsData — resultado de matchOddsToGame() (opcional)
 * @returns {Promise<string>} String listo para el prompt del Oracle
 */
export async function buildContext(gameData, oddsData = null) {
  const cacheKey = `${gameData.gamePk}-${(gameData.gameDate ?? new Date().toISOString()).split('T')[0]}`;
  const cached = _contextCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL_MS) {
    console.log(`[context-builder] Cache HIT for ${cacheKey} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
    return cached.context;
  }

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

  // ── Pitcher home/away splits (Gap #3) ──────────────────────────────────────
  let homePitcherHASplits = null;
  let awayPitcherHASplits = null;
  try { homePitcherHASplits = homePitcher?.id ? await getPitcherHomeSplits(homePitcher.id) : null; } catch (_) {}
  try { awayPitcherHASplits = awayPitcher?.id ? await getPitcherHomeSplits(awayPitcher.id) : null; } catch (_) {}
  if (homePitcherHASplits) console.log(`[context-builder] Home pitcher H/A splits loaded`);
  if (awayPitcherHASplits) console.log(`[context-builder] Away pitcher H/A splits loaded`);

  // ── Pitcher rest days (Gap #4) ─────────────────────────────────────────────
  const gameDate = (gameData.gameDate ?? new Date().toISOString()).split('T')[0];
  let homePitcherRest = null;
  let awayPitcherRest = null;
  try { homePitcherRest = homePitcher?.id ? await getPitcherRestDays(homePitcher.id, gameDate) : null; } catch (_) {}
  try { awayPitcherRest = awayPitcher?.id ? await getPitcherRestDays(awayPitcher.id, gameDate) : null; } catch (_) {}
  if (homePitcherRest) console.log(`[context-builder] Home pitcher rest: ${homePitcherRest.daysRest} days`);
  if (awayPitcherRest) console.log(`[context-builder] Away pitcher rest: ${awayPitcherRest.daysRest} days`);

  // ── Platoon splits (parallel, non-blocking) ─────────────────────────────────
  let homeSplits = null;
  let awaySplits = null;
  try {
    const [homeSplitsResult, awaySplitsResult] = await Promise.all([
      home?.id ? getTeamHittingSplits(home.id) : Promise.resolve(null),
      away?.id ? getTeamHittingSplits(away.id) : Promise.resolve(null),
    ]);
    homeSplits = homeSplitsResult;
    awaySplits = awaySplitsResult;
  } catch (err) {
    console.warn('[context-builder] Platoon splits unavailable — continuing without split data:', err.message);
  }

  const [homeTeamVerifyResult, awayTeamVerifyResult] = await Promise.allSettled([
    homePitcher?.id ? getCurrentTeam(homePitcher.id) : Promise.resolve(null),
    awayPitcher?.id ? getCurrentTeam(awayPitcher.id) : Promise.resolve(null),
  ]);

  const settled = (r) => (r.status === 'fulfilled' ? r.value : null);

  // ── Team pitching / bullpen stats (parallel, non-blocking) ─────────────────
  let homePitching = null;
  let awayPitching = null;
  try {
    const [homePitchingResult, awayPitchingResult] = await Promise.all([
      home?.id ? getTeamPitchingStats(home.id) : Promise.resolve({}),
      away?.id ? getTeamPitchingStats(away.id) : Promise.resolve({}),
    ]);
    homePitching = homePitchingResult ?? {};
    awayPitching = awayPitchingResult ?? {};
  } catch (err) {
    console.warn('[context-builder] Team pitching stats unavailable — continuing without bullpen data:', err.message);
  }

  // ── Bullpen recent usage (P3 — last 3 days from boxscores) ────────────────
  let homeBullpenUsage = null;
  let awayBullpenUsage = null;
  try {
    const [homeUsageResult, awayUsageResult] = await Promise.all([
      home?.id ? getBullpenUsage(home.id) : Promise.resolve(null),
      away?.id ? getBullpenUsage(away.id) : Promise.resolve(null),
    ]);
    homeBullpenUsage = homeUsageResult;
    awayBullpenUsage = awayUsageResult;
    if (homeBullpenUsage) console.log(`[context-builder] Home bullpen usage: ${homeBullpenUsage.bullpenIP_3d}IP last 3d, ${homeBullpenUsage.relievers.length} relievers`);
    if (awayBullpenUsage) console.log(`[context-builder] Away bullpen usage: ${awayBullpenUsage.bullpenIP_3d}IP last 3d, ${awayBullpenUsage.relievers.length} relievers`);
  } catch (err) {
    console.warn('[context-builder] Bullpen usage data unavailable — continuing:', err.message);
  }

  const homePitcherTeam = settled(homeTeamVerifyResult);
  const awayPitcherTeam = settled(awayTeamVerifyResult);

  // Inject pitcher throwing hand from person data into probablePitcher objects
  if (homePitcherTeam?.pitchHand && homePitcher) {
    homePitcher.throwingHand = homePitcherTeam.pitchHand;
    console.log(`[context-builder] Home pitcher hand: ${homePitcherTeam.pitchHand}HP`);
  }
  if (awayPitcherTeam?.pitchHand && awayPitcher) {
    awayPitcher.throwingHand = awayPitcherTeam.pitchHand;
    console.log(`[context-builder] Away pitcher hand: ${awayPitcherTeam.pitchHand}HP`);
  }

  // ── Baseball Savant Statcast (non-blocking) ──────────────────────────────
  let homePitcherSavant = null;
  let awayPitcherSavant = null;
  let savantCacheStatus = null;
  let savantBatters     = { home: [], away: [] };
  let batterSplitsMap   = { home: [], away: [] };
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

    const homeBatters = Array.isArray(homeLineup) ? homeLineup.slice(0, 9) : [];
    const awayBatters = Array.isArray(awayLineup) ? awayLineup.slice(0, 9) : [];
    const homeCatcher = findByPos(homeLineup, 'C');
    const awayCatcher = findByPos(awayLineup, 'C');
    const OF_POSITIONS = ['CF', 'LF', 'RF'];
    const allOFPlayers = [
      ...OF_POSITIONS.map(pos => { const p = findByPos(homeLineup, pos); return p ? { player: p, pos, side: 'Home' } : null; }),
      ...OF_POSITIONS.map(pos => { const p = findByPos(awayLineup, pos); return p ? { player: p, pos, side: 'Away' } : null; }),
    ].filter(Boolean);

    console.log('[context-builder] Batter names to search:', [...homeBatters, ...awayBatters].map(b => b.fullName ?? b.name ?? b));
    const batterFetches = [
      ...homeBatters.map(b => getBatterStatcast(b.fullName ?? b.name ?? b)),
      ...awayBatters.map(b => getBatterStatcast(b.fullName ?? b.name ?? b)),
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

    const homeBattersFull = Array.isArray(homeLineup) ? homeLineup.slice(0, 9) : [];
    const awayBattersFull = Array.isArray(awayLineup) ? awayLineup.slice(0, 9) : [];
    const allBatters = [...homeBattersFull, ...awayBattersFull];
    batterResults.forEach((r, idx) => {
      const name   = allBatters[idx]?.fullName ?? allBatters[idx]?.name ?? allBatters[idx] ?? `Batter ${idx + 1}`;
      const savant = r.status === 'fulfilled' ? r.value : null;
      if (idx < homeBattersFull.length) savantBatters.home.push({ name, savant });
      else                               savantBatters.away.push({ name, savant });
    });
    const foundCount = [...savantBatters.home, ...savantBatters.away].filter(b => b.savant !== null).length;
    const totalCount = savantBatters.home.length + savantBatters.away.length;
    console.log(`[context-builder] Batter Statcast: ${foundCount}/${totalCount} found in cache`);

    // ── Individual batter splits vs LHP/RHP (P4 enhancement) ────────────────
    // Fetch splits for ALL lineup batters (not just top 3) to support player props
    const allHomeBatters = Array.isArray(homeLineup) ? homeLineup : [];
    const allAwayBatters = Array.isArray(awayLineup) ? awayLineup : [];
    const splitFetches = [];
    const splitMeta = []; // track which batter each fetch belongs to

    for (const b of allHomeBatters) {
      const id = b.id ?? b.playerId ?? null;
      const name = b.fullName ?? b.name ?? 'Unknown';
      if (id) {
        splitFetches.push(getBatterSplits(id));
        splitMeta.push({ name, side: 'home', id });
      }
    }
    for (const b of allAwayBatters) {
      const id = b.id ?? b.playerId ?? null;
      const name = b.fullName ?? b.name ?? 'Unknown';
      if (id) {
        splitFetches.push(getBatterSplits(id));
        splitMeta.push({ name, side: 'away', id });
      }
    }

    if (splitFetches.length > 0) {
      const splitResults = await Promise.allSettled(splitFetches);
      splitResults.forEach((result, idx) => {
        const meta = splitMeta[idx];
        const splits = result.status === 'fulfilled' ? result.value : null;
        if (splits && (splits.vsLHP || splits.vsRHP)) {
          batterSplitsMap[meta.side].push({ name: meta.name, id: meta.id, splits });
        }
      });
      console.log(`[context-builder] Individual batter splits: ${batterSplitsMap.home.length} home, ${batterSplitsMap.away.length} away`);
    }

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

  // Fallback to hardcoded park factors if dynamic fetch returned nothing
  if (!parkFactorData) {
    const homeAbbr = gameData.teams?.home?.abbreviation;
    const hardcoded = HISTORICAL_MLB_CONTEXT.park_factors_2026[homeAbbr];
    if (hardcoded) {
      parkFactorData = {
        team: homeAbbr,
        venue_name: gameData.venue?.name ?? hardcoded.description?.split(' - ')[0] ?? null,
        park_factor_overall: hardcoded.overall,
        park_factor_HR: hardcoded.hr,
        park_factor_R: hardcoded.r,
        park_factor_H: null,
      };
      console.log(`[context-builder] Park factor loaded for ${homeAbbr}: overall=${hardcoded.overall} HR=${hardcoded.hr} R=${hardcoded.r}`);
    }
  }

  // ── Real-time weather (Open-Meteo, non-blocking) ─────────────────────────
  let weatherData = null;
  try {
    weatherData = await getGameWeather(homeName, gameData.gameTime);
  } catch (err) {
    console.warn('[context-builder] Weather fetch failed — continuing without weather data:', err.message);
  }

  // ── Data Integrity Layer ───────────────────────────────────────────────────
  const dataQuality = calcDataQuality({
    homePitcherStats, awayPitcherStats,
    homePitcher, awayPitcher,
    homePitcherSavant, awayPitcherSavant,
    savantBatters, weatherData, parkFactorData,
    oddsData, gameData,
  });
  console.log(`[context-builder] Data Quality Score: ${dataQuality.score}/100 — ${dataQuality.strategy}`);

  const signalCoherence = calcSignalCoherence({
    homePitcherSavant, awayPitcherSavant,
    savantBatters,
    parkFactorData,
    weatherData,
    homePitching, awayPitching,
  });
  console.log(`[context-builder] Signal Coherence Score: ${signalCoherence.coherenceScore}/100 — ${signalCoherence.dominantDirection} (${signalCoherence.overSignals}O/${signalCoherence.underSignals}U/${signalCoherence.neutralSignals}N)`);

  // ── Line Movement (P7 — from odds_snapshots) ──────────────────────────────
  let lineMovement = null;
  try {
    const gameDate = (gameData.gameDate ?? new Date().toISOString()).split('T')[0];
    lineMovement = await getLineMovement(homeName, awayName, gameDate);
    if (lineMovement) {
      console.log(`[context-builder] Line movement: ${lineMovement.snapshots_count} snapshots, sharp=${lineMovement.sharp_signal}, dir=${lineMovement.direction}`);
    }
  } catch (err) {
    console.warn('[context-builder] Line movement fetch failed — continuing:', err.message);
  }

  // ── DEBUG: log assembled data before building context string ───────────────
  if (process.env.NODE_ENV !== 'production') {
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
  }

  // ---------------------------------------------------------------------------
  // Ensamblar el string
  // ---------------------------------------------------------------------------

  const blocks = [];

  blocks.push('=== DATA INTEGRITY REPORT ===');
  blocks.push(`Quality Score: ${dataQuality.score}/100 — Strategy: ${dataQuality.strategy}`);
  blocks.push(`Confidence penalty: -${dataQuality.confidencePenalty}%`);
  blocks.push(`Allowed bet types: ${dataQuality.allowedBetTypes}`);
  blocks.push(`Available: ${dataQuality.available.join(', ')}`);
  blocks.push(`Missing: ${dataQuality.missing.length > 0 ? dataQuality.missing.join(', ') : 'none'}`);
  blocks.push('ORACLE INSTRUCTION: Adjust your confidence by subtracting the confidence penalty from your calculated oracle_confidence. Restrict bet types to the allowed list above. If strategy is MINIMAL_ANALYSIS, set model_risk to high regardless of other signals.');
  blocks.push('=== END DATA INTEGRITY ===');
  blocks.push('');

  // ── Signal Coherence Report ────────────────────────────────────────────────
  blocks.push('=== SIGNAL COHERENCE REPORT ===');
  blocks.push(`Coherence Score: ${signalCoherence.coherenceScore}/100`);
  blocks.push(`Dominant Direction: ${signalCoherence.dominantDirection}`);
  blocks.push(`Signals Aligned: ${signalCoherence.overSignals} OVER | ${signalCoherence.underSignals} UNDER | ${signalCoherence.neutralSignals} NEUTRAL`);
  blocks.push('');
  blocks.push('Signal Details:');
  signalCoherence.signals.forEach(s => {
    blocks.push(`* ${s.name}: ${s.vote} — ${s.reason}`);
  });
  if (signalCoherence.coherenceScore < 50) {
    blocks.push(`⚠️ COHERENCE WARNING: Multiple signals conflict. Reduce confidence by 10% and flag model_risk accordingly.`);
  }
  blocks.push('=== END SIGNAL COHERENCE ===');
  blocks.push('');

  // Encabezado
  blocks.push(header(`GAME CONTEXT: ${awayAbbr} @ ${homeAbbr} — ${awayName} @ ${homeName}`));
  blocks.push(`Venue: ${gameData.venue?.name ?? '⚠ MISSING DATA: venue unknown'}`);
  blocks.push(`Game Time: ${gameData.gameTime ?? '⚠ MISSING DATA: time unknown'}`);
  blocks.push(`Status: ${gameData.status?.description ?? 'Scheduled'}`);
  if (gameData.seriesDescription) {
    blocks.push(`Series: ${gameData.seriesDescription} — Game ${gameData.seriesGameNumber ?? '?'} of ${gameData.gamesInSeries ?? '?'}`);
  }
  blocks.push('');

  // ── Data Quality Block ────────────────────────────────────────────────────
  blocks.push(section('DATA QUALITY'));
  blocks.push(`Score: ${dataQuality.score}/100 | Strategy: ${dataQuality.strategy} | Confidence penalty: ${dataQuality.confidencePenalty}%`);
  blocks.push(`Allowed bet types: ${dataQuality.allowedBetTypes}`);
  if (dataQuality.available.length > 0) {
    blocks.push(`Available: ${dataQuality.available.join(', ')}`);
  }
  if (dataQuality.missing.length > 0) {
    blocks.push(`Missing: ${dataQuality.missing.join(', ')}`);
  }
  blocks.push('');

  // Pitcheo — abridores
  blocks.push(pitcherBlock('HOME', homePitcherStats, homePitcher));
  blocks.push('');
  blocks.push(pitcherBlock('AWAY', awayPitcherStats, awayPitcher));
  blocks.push('');

  // ── Pitcher Home/Away Splits ──────────────────────────────────────────────
  if (homePitcherHASplits || awayPitcherHASplits) {
    blocks.push(section('PITCHER HOME/AWAY SPLITS'));
    const fmtHA = (v) => v != null ? Number(v).toFixed(2) : 'N/A';
    const fmtHA3 = (v) => v != null ? Number(v).toFixed(3) : 'N/A';

    const formatPitcherHA = (label, name, splits, isHome) => {
      if (!splits) return `[${label}] ${name}: Home/Away splits unavailable`;
      // isHome = true means this pitcher IS at home today
      const relevant = isHome ? splits.home : splits.away;
      const other = isHome ? splits.away : splits.home;
      const venue = isHome ? 'HOME' : 'AWAY';
      const otherVenue = isHome ? 'Away' : 'Home';

      if (!relevant) return `[${label}] ${name}: No ${venue.toLowerCase()} split data`;

      let line = `[${label}] ${name} — TODAY (${venue}): ERA ${fmtHA(relevant.era)} | WHIP ${fmtHA(relevant.whip)} | OPS-against ${fmtHA3(relevant.ops)} | IP ${relevant.inningsPitched ?? 'N/A'} | K ${relevant.strikeOuts ?? 'N/A'}`;
      if (other) {
        line += ` | ${otherVenue}: ERA ${fmtHA(other.era)} | WHIP ${fmtHA(other.whip)}`;
        // Flag significant gap
        const relERA = parseFloat(relevant.era);
        const othERA = parseFloat(other.era);
        if (!isNaN(relERA) && !isNaN(othERA)) {
          const gap = Math.abs(relERA - othERA);
          if (gap >= 1.0) {
            const better = relERA < othERA ? venue : otherVenue;
            line += ` ⚠ ${gap.toFixed(2)} ERA gap — significantly ${relERA < othERA ? 'better' : 'worse'} at ${venue}`;
          }
        }
      }
      return line;
    };

    // Home pitcher IS at home, Away pitcher IS away
    blocks.push(formatPitcherHA('HOME', homePitcher?.fullName ?? 'Home Pitcher', homePitcherHASplits, true));
    blocks.push(formatPitcherHA('AWAY', awayPitcher?.fullName ?? 'Away Pitcher', awayPitcherHASplits, false));
    blocks.push('ORACLE INSTRUCTION: When a pitcher has 1.00+ ERA gap between home and away, weight the venue-specific split heavily. A pitcher with 2.80 home ERA and 5.20 away ERA pitching on the road is a significantly weaker proposition.');
    blocks.push('');
  }

  // ── Pitcher Rest Days ─────────────────────────────────────────────────────
  if (homePitcherRest || awayPitcherRest) {
    blocks.push(section('PITCHER REST DAYS'));

    const formatRest = (label, name, rest) => {
      if (!rest || rest.daysRest == null) return `[${label}] ${name}: Rest days unknown`;
      const days = rest.daysRest;
      const ipStr = rest.lastIP ? ` (${rest.lastIP}IP` + (rest.lastPitchCount ? `, ${rest.lastPitchCount} pitches` : '') + ')' : '';
      let flag = '';
      if (days <= 3) flag = ' ⚠ SHORT REST — velocity and stamina risk';
      else if (days === 4) flag = ' — Normal rest (4 days)';
      else if (days === 5) flag = ' — Extra rest (5 days) — may benefit velocity';
      else if (days >= 6) flag = ' — Extended rest (6+ days) — rust risk possible';
      return `[${label}] ${name}: ${days} days rest (last: ${rest.lastStart}${ipStr})${flag}`;
    };

    blocks.push(formatRest('HOME', homePitcher?.fullName ?? 'Home Pitcher', homePitcherRest));
    blocks.push(formatRest('AWAY', awayPitcher?.fullName ?? 'Away Pitcher', awayPitcherRest));
    blocks.push('');
  }

  // Bullpen / pitcheo del equipo
  blocks.push(buildBullpenBlock(homeName, awayName, homePitching, awayPitching, homeBullpenUsage, awayBullpenUsage));
  blocks.push('');

  // Ofensiva — cross-matched with rival pitcher's throwing hand for platoon splits
  // Home offense faces the Away pitcher → use awayPitcher.throwingHand
  // Away offense faces the Home pitcher → use homePitcher.throwingHand
  const homePitcherHand = homePitcher?.throwingHand ?? null;  // hand of HOME starter (faces Away batters)
  const awayPitcherHand = awayPitcher?.throwingHand ?? null;  // hand of AWAY starter (faces Home batters)

  blocks.push(offenseBlock('HOME', homeHitting, homeName, homeSplits, awayPitcherHand, awayPitcher?.fullName));
  blocks.push('');
  blocks.push(offenseBlock('AWAY', awayHitting, awayName, awaySplits, homePitcherHand, homePitcher?.fullName));
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
    blocks.push(section(`BATTER STATCAST — Full Lineup (Savant ${new Date().getFullYear()})`));
    if (savantBatters.home.length > 0) {
      blocks.push(`${homeName} (Home) — FACING: ${awayPitcher?.fullName ?? 'TBD'} (${awayPitcher?.throwingHand === 'L' ? 'LHP' : awayPitcher?.throwingHand === 'R' ? 'RHP' : '?'}):`);
      savantBatters.home.forEach(({ name, savant }) => blocks.push(batterSavantLine(name, savant)));
    }
    if (savantBatters.away.length > 0) {
      blocks.push(`${awayName} (Away) — FACING: ${homePitcher?.fullName ?? 'TBD'} (${homePitcher?.throwingHand === 'L' ? 'LHP' : homePitcher?.throwingHand === 'R' ? 'RHP' : '?'}):`);
      savantBatters.away.forEach(({ name, savant }) => blocks.push(batterSavantLine(name, savant)));
    }
    blocks.push('');
  }

  // ── Individual Batter Splits vs LHP/RHP ──────────────────────────────────
  if (batterSplitsMap.home.length > 0 || batterSplitsMap.away.length > 0) {
    const rivalPitcherHandForHome = awayPitcher?.throwingHand ?? null; // home batters face away pitcher
    const rivalPitcherHandForAway = homePitcher?.throwingHand ?? null; // away batters face home pitcher

    blocks.push(section('INDIVIDUAL BATTER SPLITS vs LHP/RHP'));

    const formatBatterSplit = (batter, rivalHand) => {
      const s = batter.splits;
      const fmtS = (v) => v != null ? Number(v).toFixed(3) : 'N/A';
      const lines = [];

      if (rivalHand === 'L' && s.vsLHP) {
        const sp = s.vsLHP;
        lines.push(`  ${batter.name} vs LHP: AVG ${fmtS(sp.avg)} | OBP ${fmtS(sp.obp)} | SLG ${fmtS(sp.slg)} | OPS ${fmtS(sp.ops)} | HR ${sp.homeRuns ?? 'N/A'} | K ${sp.strikeOuts ?? 'N/A'} (${sp.atBats ?? '?'} AB) ← MATCHUP SPLIT`);
      } else if (rivalHand === 'R' && s.vsRHP) {
        const sp = s.vsRHP;
        lines.push(`  ${batter.name} vs RHP: AVG ${fmtS(sp.avg)} | OBP ${fmtS(sp.obp)} | SLG ${fmtS(sp.slg)} | OPS ${fmtS(sp.ops)} | HR ${sp.homeRuns ?? 'N/A'} | K ${sp.strikeOuts ?? 'N/A'} (${sp.atBats ?? '?'} AB) ← MATCHUP SPLIT`);
      } else {
        // Show both when pitcher hand unknown
        if (s.vsLHP) {
          const sp = s.vsLHP;
          lines.push(`  ${batter.name} vs LHP: AVG ${fmtS(sp.avg)} | OPS ${fmtS(sp.ops)} (${sp.atBats ?? '?'} AB)`);
        }
        if (s.vsRHP) {
          const sp = s.vsRHP;
          lines.push(`  ${batter.name} vs RHP: AVG ${fmtS(sp.avg)} | OPS ${fmtS(sp.ops)} (${sp.atBats ?? '?'} AB)`);
        }
      }
      return lines;
    };

    if (batterSplitsMap.home.length > 0) {
      const awayPName = awayPitcher?.fullName ?? 'Unknown';
      const awayPHand = rivalPitcherHandForHome === 'L' ? 'LHP' : rivalPitcherHandForHome === 'R' ? 'RHP' : 'Unknown hand';
      blocks.push(`${homeName} (Home) — FACING: ${awayPName} (${awayPHand})`);
      batterSplitsMap.home.forEach(b => {
        const lines = formatBatterSplit(b, rivalPitcherHandForHome);
        lines.forEach(l => blocks.push(l));
      });
    }
    if (batterSplitsMap.away.length > 0) {
      const homePName = homePitcher?.fullName ?? 'Unknown';
      const homePHand = rivalPitcherHandForAway === 'L' ? 'LHP' : rivalPitcherHandForAway === 'R' ? 'RHP' : 'Unknown hand';
      blocks.push(`${awayName} (Away) — FACING: ${homePName} (${homePHand})`);
      batterSplitsMap.away.forEach(b => {
        const lines = formatBatterSplit(b, rivalPitcherHandForAway);
        lines.forEach(l => blocks.push(l));
      });
    }

    blocks.push('ORACLE INSTRUCTION: Use individual batter splits for player prop analysis. A batter with OPS > .850 vs the matchup hand = strong hit/TB prop candidate. OPS < .600 vs matchup hand = fade candidate. Prioritize these splits over season averages for props.');
    blocks.push('');
  }

  // ── Deep K Props Analysis ─────────────────────────────────────────────────
  try {
    const kPropsBlock = buildKPropsBlock(
      homePitcher, awayPitcher,
      homePitcherSavant, awayPitcherSavant,
      savantBatters,
    );
    if (kPropsBlock) {
      blocks.push(kPropsBlock);
      blocks.push('');
    }
  } catch (_) { /* skip silently on any error */ }

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

  // Line Movement (injected when at least 2 snapshots exist for this game)
  if (lineMovement && lineMovement.snapshots_count >= 2) {
    const am = (n) => (n == null ? 'N/A' : n > 0 ? `+${n}` : String(n));
    const mv = (n) => (n == null ? 'N/A' : n > 0 ? `+${n}` : String(n));
    const { opening: op, current: cu, movement_ml_home, movement_ml_away, movement_total, sharp_signal, direction, snapshots_count, hours_tracked } = lineMovement;

    blocks.push('');
    blocks.push('=== LINE MOVEMENT ===');
    blocks.push(`Snapshots: ${snapshots_count} captures over ${hours_tracked} hours`);
    blocks.push(`Opening Line: HOME ${am(op.moneyline_home)} / AWAY ${am(op.moneyline_away)} | Total ${op.total ?? 'N/A'}`);
    blocks.push(`Current Line: HOME ${am(cu.moneyline_home)} / AWAY ${am(cu.moneyline_away)} | Total ${cu.total ?? 'N/A'}`);

    const mlMoveStr = movement_ml_home != null
      ? `HOME ML moved ${Math.abs(movement_ml_home)} cents${sharp_signal && Math.abs(movement_ml_home) >= 15 ? ' (sharp money detected)' : ''}`
      : 'HOME ML no movement';

    blocks.push(`Movement: ${mlMoveStr}`);
    if (movement_total != null) {
      blocks.push(`Total moved: ${mv(movement_total)} (from ${op.total ?? 'N/A'} to ${cu.total ?? 'N/A'})`);
    }
    if (sharp_signal && direction) {
      const side = direction === 'sharp on home' ? 'HOME' : 'AWAY';
      blocks.push(`⚠️ SHARP SIGNAL: Significant line movement on ${side} — indicates professional money.`);
    }
    blocks.push('=== END LINE MOVEMENT ===');
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
    const implHome = calculateImpliedProbability(ml.home);
    const implAway = calculateImpliedProbability(ml.away);
    const impl = (n) => (n == null ? '' : ` (Implied: ${n}%)`);
    blocks.push(
      `ML Home ${am(ml.home)}${impl(implHome)} Away ${am(ml.away)}${impl(implAway)}` +
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

  console.log('[context-builder] Savant batters with data:', savantBatters.home.filter(b => b.savant).length, 'home,', savantBatters.away.filter(b => b.savant).length, 'away');
  const context = blocks.join('\n');
  _contextCache.set(cacheKey, { context, timestamp: Date.now() });
  console.log(`[context-builder] Cache SET for ${cacheKey} (total cached: ${_contextCache.size})`);
  return context;
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
