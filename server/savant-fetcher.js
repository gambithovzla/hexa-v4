/**
 * savant-fetcher.js — Baseball Savant Statcast leaderboard fetcher for H.E.X.A. V4
 *
 * Fetches CSV leaderboards from baseballsavant.mlb.com and caches them in memory.
 * Cache TTL is 6 hours. All CSV parsing is done without external dependencies.
 *
 * Exports:
 *   getBatterStatcast(playerName)  — xwOBA, xBA, xSLG, EV, Barrel%, HardHit%, rolling wOBA,
 *                                    sprint speed, batted ball profile, year-to-year Δ, percentiles
 *   getPitcherStatcast(playerName) — xwOBA_against, xBA_against, Whiff%, arsenal run values,
 *                                    rolling wOBA against, pitch tempo, batted ball profile, year-to-year Δ
 *   getParkFactor(teamName)        — park factor overall/R/HR/H + venue name
 *   getCatcherFraming(catcherName) — framing_runs, strike_rate_added, extra_strikes_per_game
 *   getFieldingOAA(playerName)     — outs_above_average, fielding_runs_prevented, position
 *   refreshCache()                 — force re-fetch of all leaderboards
 *   getCacheStatus()               — { lastUpdated, recordCounts }
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; HEXA-V4/1.0)',
  'Accept': 'text/csv,*/*',
};

const ENDPOINTS = {
  xStatsBatter:      'https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=2025&position=&team=&min=q&csv=true',
  xStatsPitcher:     'https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=2025&position=&team=&min=q&csv=true',
  exitVelocity:      'https://baseballsavant.mlb.com/leaderboard/exit_velocity_barrels?type=batter&year=2025&min=q&csv=true',
  pitchArsenal:      'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&year=2025&min=q&csv=true',
  percentiles:       'https://baseballsavant.mlb.com/leaderboard/percentile-rankings?type=batter&year=2025&csv=true',
  rollingBatter:     'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=batter&type=woba&rolling=30&year=2025&min=10&csv=true',
  rollingPitcher:    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=pitcher&type=woba&rolling=30&year=2025&min=10&csv=true',
  pitchTempo:        'https://baseballsavant.mlb.com/leaderboard/pitch-tempo?year=2025&type=pitcher&csv=true',
  sprintSpeed:       'https://baseballsavant.mlb.com/leaderboard/sprint_speed?year=2025&position=&team=&min=10&csv=true',
  battedBallBatter:  'https://baseballsavant.mlb.com/leaderboard/batted-ball?year=2025&type=batter&min=q&csv=true',
  battedBallPitcher: 'https://baseballsavant.mlb.com/leaderboard/batted-ball?year=2025&type=pitcher&min=q&csv=true',
  parkFactors:       'https://baseballsavant.mlb.com/leaderboard/park-factors?type=month&batSide=&pitchHand=&leagueId=&min=1&csv=true',
  catcherFraming:    'https://baseballsavant.mlb.com/leaderboard/catcher_framing?year=2025&team=&min=q&csv=true',
  fieldingOAA:       'https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=Fielder&year=2025&team=&csv=true',
  yearToYearBatter:  'https://baseballsavant.mlb.com/leaderboard/statcast-year-to-year?group=Batter&type=xwoba&year=2025&csv=true',
  yearToYearPitcher: 'https://baseballsavant.mlb.com/leaderboard/statcast-year-to-year?group=Pitcher&type=xwoba&year=2025&csv=true',
};

// ── In-memory cache ───────────────────────────────────────────────────────────

let _cache = {
  xStatsBatter:      null,
  xStatsPitcher:     null,
  exitVelocity:      null,
  pitchArsenal:      null,
  percentiles:       null,
  rollingBatter:     null,
  rollingPitcher:    null,
  pitchTempo:        null,
  sprintSpeed:       null,
  battedBallBatter:  null,
  battedBallPitcher: null,
  parkFactors:       null,
  catcherFraming:    null,
  fieldingOAA:       null,
  yearToYearBatter:  null,
  yearToYearPitcher: null,
  lastUpdated:       0,
};

// ── CSV parser ────────────────────────────────────────────────────────────────

/**
 * Minimal RFC-4180 CSV parser.
 * Returns an array of objects keyed by the header row.
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h.trim()] = (values[idx] ?? '').trim();
    });
    rows.push(obj);
  }
  return rows;
}

/** Splits one CSV line respecting quoted fields */
function splitCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchCSV(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Savant fetch failed: ${res.status} ${res.statusText} — ${url}`);
  const text = await res.text();
  return parseCSV(text);
}

async function loadAll() {
  console.log('[savant] Fetching all leaderboards…');
  const [
    xStatsBatter, xStatsPitcher, exitVelocity, pitchArsenal, percentiles,
    rollingBatter, rollingPitcher, pitchTempo, sprintSpeed, battedBallBatter, battedBallPitcher,
    parkFactors, catcherFraming, fieldingOAA, yearToYearBatter, yearToYearPitcher,
  ] = await Promise.all([
    fetchCSV(ENDPOINTS.xStatsBatter),
    fetchCSV(ENDPOINTS.xStatsPitcher),
    fetchCSV(ENDPOINTS.exitVelocity),
    fetchCSV(ENDPOINTS.pitchArsenal),
    fetchCSV(ENDPOINTS.percentiles),
    fetchCSV(ENDPOINTS.rollingBatter),
    fetchCSV(ENDPOINTS.rollingPitcher),
    fetchCSV(ENDPOINTS.pitchTempo),
    fetchCSV(ENDPOINTS.sprintSpeed),
    fetchCSV(ENDPOINTS.battedBallBatter),
    fetchCSV(ENDPOINTS.battedBallPitcher),
    fetchCSV(ENDPOINTS.parkFactors),
    fetchCSV(ENDPOINTS.catcherFraming),
    fetchCSV(ENDPOINTS.fieldingOAA),
    fetchCSV(ENDPOINTS.yearToYearBatter),
    fetchCSV(ENDPOINTS.yearToYearPitcher),
  ]);
  _cache = {
    xStatsBatter, xStatsPitcher, exitVelocity, pitchArsenal, percentiles,
    rollingBatter, rollingPitcher, pitchTempo, sprintSpeed, battedBallBatter, battedBallPitcher,
    parkFactors, catcherFraming, fieldingOAA, yearToYearBatter, yearToYearPitcher,
    lastUpdated: Date.now(),
  };
  console.log(
    `[savant] Cache refreshed — batters: ${xStatsBatter.length}, pitchers: ${xStatsPitcher.length}, ` +
    `EV: ${exitVelocity.length}, arsenal: ${pitchArsenal.length}, pct: ${percentiles.length}, ` +
    `rollingB: ${rollingBatter.length}, rollingP: ${rollingPitcher.length}, ` +
    `tempo: ${pitchTempo.length}, sprint: ${sprintSpeed.length}, ` +
    `bbBatter: ${battedBallBatter.length}, bbPitcher: ${battedBallPitcher.length}, ` +
    `parks: ${parkFactors.length}, framing: ${catcherFraming.length}, ` +
    `oaa: ${fieldingOAA.length}, y2yB: ${yearToYearBatter.length}, y2yP: ${yearToYearPitcher.length}`
  );
}

async function ensureCache() {
  if (!_cache.lastUpdated || Date.now() - _cache.lastUpdated > CACHE_TTL_MS) {
    await loadAll();
  }
}

// ── Player matching ───────────────────────────────────────────────────────────

/** Normalises a name for comparison: lowercase, trim, collapse spaces */
function norm(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Fuzzy player match against a leaderboard array.
 * Tries exact full-name match first, then last-name-only match.
 * The name field examined is determined by the `nameKey` param (default 'last_name, first_name').
 */
function findPlayer(rows, playerName, nameKey = 'last_name, first_name') {
  if (!rows?.length || !playerName) return null;
  const query = norm(playerName);

  // Build normalised name variants from each row
  function rowName(row) {
    const raw = row[nameKey] ?? row['player_name'] ?? row['name'] ?? '';
    return norm(raw);
  }

  // 1. Exact full-name match
  let match = rows.find(r => rowName(r) === query);
  if (match) return match;

  // 2. Try "first last" vs stored "last, first"
  const parts = query.split(' ');
  if (parts.length >= 2) {
    const reversed = parts.slice(1).join(' ') + ' ' + parts[0]; // "last first"
    match = rows.find(r => rowName(r).replace(', ', ' ') === reversed || rowName(r).replace(', ', ' ') === query);
    if (match) return match;
  }

  // 3. Last-name-only match (first result wins)
  const lastName = parts[parts.length - 1];
  match = rows.find(r => {
    const rn = rowName(r);
    return rn.split(', ')[0] === lastName || rn.split(' ').pop() === lastName;
  });
  if (match) return match;

  // 4. Word-overlap score ≥ 0.5
  match = rows
    .map(r => {
      const rn  = rowName(r).replace(/[,]/g, '');
      const rWords = new Set(rn.split(' '));
      const qWords = query.replace(/[,]/g, '').split(' ');
      const overlap = qWords.filter(w => rWords.has(w)).length;
      return { row: r, score: overlap / Math.max(qWords.length, rWords.size) };
    })
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)[0]?.row ?? null;

  return match;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns merged Statcast data for a batter:
 *   xwOBA, xBA, xSLG, xISO  (from expected_statistics)
 *   avg_exit_velocity, max_exit_velocity, barrel_batted_rate, hard_hit_percent  (exit velocity)
 *   percentile rankings object  (percentile-rankings)
 */
export async function getBatterStatcast(playerName) {
  await ensureCache();

  const xs  = findPlayer(_cache.xStatsBatter,     playerName);
  const ev  = findPlayer(_cache.exitVelocity,      playerName);
  const pct = findPlayer(_cache.percentiles,       playerName);
  const rb  = findPlayer(_cache.rollingBatter,     playerName);
  const ss  = findPlayer(_cache.sprintSpeed,       playerName);
  const bb  = findPlayer(_cache.battedBallBatter,  playerName);
  const y2y = findPlayer(_cache.yearToYearBatter,  playerName);

  if (!xs && !ev && !pct && !rb && !ss && !bb && !y2y) return null;

  return {
    player_name: xs?.['last_name, first_name'] ?? ev?.['last_name, first_name'] ?? playerName,
    // Expected stats
    xwOBA:    parseFloat(xs?.xwOBA   ?? xs?.['xwoba']   ?? '') || null,
    xBA:      parseFloat(xs?.xBA     ?? xs?.['xba']     ?? '') || null,
    xSLG:     parseFloat(xs?.xSLG    ?? xs?.['xslg']    ?? '') || null,
    xISO:     parseFloat(xs?.xISO    ?? xs?.['xiso']    ?? '') || null,
    wOBA:     parseFloat(xs?.wOBA    ?? xs?.['woba']    ?? '') || null,
    // Exit velocity / barrels
    avg_exit_velocity:  parseFloat(ev?.avg_hit_speed ?? ev?.['avg_exit_velocity'] ?? '') || null,
    max_exit_velocity:  parseFloat(ev?.max_hit_speed ?? ev?.['max_exit_velocity'] ?? '') || null,
    barrel_batted_rate: parseFloat(ev?.brl_percent   ?? ev?.['barrel_batted_rate'] ?? ev?.brl_pa ?? '') || null,
    hard_hit_percent:   parseFloat(ev?.['hard_hit_percent'] ?? ev?.anglesweetspotpercent ?? '') || null,
    // Rolling wOBA (last 30 days)
    rolling_woba_30d: parseFloat(rb?.woba ?? rb?.['xwoba'] ?? rb?.['rolling_woba'] ?? '') || null,
    // Sprint speed (ft/sec)
    sprint_speed: parseFloat(ss?.sprint_speed ?? ss?.['hp_to_1b'] ?? '') || null,
    // Batted ball profile
    gb_pct:   parseFloat(bb?.gb_percent ?? bb?.gb ?? '') || null,
    fb_pct:   parseFloat(bb?.fb_percent ?? bb?.fb ?? '') || null,
    ld_pct:   parseFloat(bb?.ld_percent ?? bb?.ld ?? '') || null,
    iffb_pct: parseFloat(bb?.iffb_percent ?? bb?.iffb ?? '') || null,
    // Year-over-year xwOBA change (positive = improving)
    year_to_year_xwoba_change: calcYearToYearDiff(y2y),
    // Percentile rankings
    percentiles: pct ? extractPercentiles(pct) : null,
    // Source rows for transparency
    _sources: { xStats: !!xs, exitVelocity: !!ev, percentiles: !!pct, rolling: !!rb, sprintSpeed: !!ss, battedBall: !!bb, yearToYear: !!y2y },
  };
}

/**
 * Returns merged Statcast data for a pitcher:
 *   xwOBA_against, xBA_against, xSLG_against  (from expected_statistics pitcher side)
 *   whiff_percent, k_percent, bb_percent       (from expected_statistics)
 *   pitch arsenal run values                   (from pitch-arsenal-stats)
 */
export async function getPitcherStatcast(playerName) {
  await ensureCache();

  const xs  = findPlayer(_cache.xStatsPitcher,    playerName);
  const pa  = findPlayer(_cache.pitchArsenal,      playerName);
  const rp  = findPlayer(_cache.rollingPitcher,    playerName);
  const pt  = findPlayer(_cache.pitchTempo,        playerName);
  const bb  = findPlayer(_cache.battedBallPitcher, playerName);
  const y2y = findPlayer(_cache.yearToYearPitcher, playerName);

  if (!xs && !pa && !rp && !pt && !bb && !y2y) return null;

  return {
    player_name: xs?.['last_name, first_name'] ?? pa?.['last_name, first_name'] ?? playerName,
    // Expected stats (against)
    xwOBA_against: parseFloat(xs?.xwOBA ?? xs?.['xwoba'] ?? '') || null,
    xBA_against:   parseFloat(xs?.xBA   ?? xs?.['xba']   ?? '') || null,
    xSLG_against:  parseFloat(xs?.xSLG  ?? xs?.['xslg']  ?? '') || null,
    wOBA_against:  parseFloat(xs?.wOBA  ?? xs?.['woba']  ?? '') || null,
    // Plate discipline
    whiff_percent: parseFloat(xs?.['whiff_percent'] ?? xs?.['swstr_percent'] ?? '') || null,
    k_percent:     parseFloat(xs?.['k_percent']     ?? xs?.['strikeout_percent'] ?? '') || null,
    bb_percent:    parseFloat(xs?.['bb_percent']    ?? xs?.['walk_percent'] ?? '') || null,
    // Pitch arsenal
    arsenal: pa ? extractArsenal(pa) : null,
    // Run value — best single-pitch run value from arsenal row
    run_value_per_pitch: pa ? bestPitchRunValue(pa) : null,
    // Rolling wOBA against (last 30 days)
    rolling_woba_against_30d: parseFloat(rp?.woba ?? rp?.['xwoba'] ?? rp?.['rolling_woba'] ?? '') || null,
    // Pitch tempo (avg seconds between pitches)
    pitch_tempo_seconds: parseFloat(
      pt?.avg_seconds ?? pt?.['seconds_between_pitches'] ?? pt?.['avg_time'] ?? pt?.tempo ?? ''
    ) || null,
    // Batted ball profile (against)
    gb_pct: parseFloat(bb?.gb_percent ?? bb?.gb ?? '') || null,
    fb_pct: parseFloat(bb?.fb_percent ?? bb?.fb ?? '') || null,
    ld_pct: parseFloat(bb?.ld_percent ?? bb?.ld ?? '') || null,
    // Year-over-year xwOBA against change (positive = improving for pitcher = opponents hitting better)
    year_to_year_xwoba_against_change: calcYearToYearDiff(y2y),
    _sources: { xStats: !!xs, pitchArsenal: !!pa, rolling: !!rp, pitchTempo: !!pt, battedBall: !!bb, yearToYear: !!y2y },
  };
}

/**
 * Returns park factor data for a team.
 * Match by team abbreviation (e.g. "NYY") or full city/nickname (e.g. "Yankees").
 */
export async function getParkFactor(teamName) {
  await ensureCache();
  if (!_cache.parkFactors?.length || !teamName) return null;

  const q = norm(teamName);
  const row = _cache.parkFactors.find(r => {
    const abbr  = norm(r['team_abbrev'] ?? r['team'] ?? r['abbreviation'] ?? '');
    const full  = norm(r['team_full']   ?? r['name']  ?? r['team_name']   ?? '');
    const venue = norm(r['venue_name']  ?? r['park']  ?? '');
    return abbr === q || full.includes(q) || q.includes(abbr) || venue.includes(q);
  }) ?? null;

  if (!row) return null;

  return {
    team:                 row['team_abbrev']    ?? row['team']         ?? teamName,
    venue_name:           row['venue_name']     ?? row['park']         ?? null,
    park_factor_overall:  parseFloat(row['park_factor']    ?? row['pf']    ?? row['factor'] ?? '') || null,
    park_factor_R:        parseFloat(row['park_factor_r']  ?? row['pfr']   ?? row['r']      ?? '') || null,
    park_factor_HR:       parseFloat(row['park_factor_hr'] ?? row['pfhr']  ?? row['hr']     ?? '') || null,
    park_factor_H:        parseFloat(row['park_factor_h']  ?? row['pfh']   ?? row['h']      ?? '') || null,
  };
}

/**
 * Returns catcher framing metrics for a catcher.
 */
export async function getCatcherFraming(catcherName) {
  await ensureCache();

  const row = findPlayer(_cache.catcherFraming, catcherName);
  if (!row) return null;

  return {
    player_name:           row['last_name, first_name'] ?? catcherName,
    framing_runs:          parseFloat(row['framing_runs']         ?? row['runs_extra_strikes'] ?? row['run_value'] ?? '') || null,
    strike_rate_added:     parseFloat(row['strike_rate_added']    ?? row['strike_rate']        ?? '') || null,
    extra_strikes_per_game:parseFloat(row['extra_strikes_per_game'] ?? row['strikes_gained_per_game'] ?? row['strikes_per_game'] ?? '') || null,
  };
}

/**
 * Returns Outs Above Average (OAA) fielding data for a player.
 */
export async function getFieldingOAA(playerName) {
  await ensureCache();

  const row = findPlayer(_cache.fieldingOAA, playerName);
  if (!row) return null;

  return {
    player_name:              row['last_name, first_name'] ?? playerName,
    outs_above_average:       parseFloat(row['outs_above_average']      ?? row['oaa']                    ?? '') || null,
    fielding_runs_prevented:  parseFloat(row['fielding_runs_prevented'] ?? row['runs_prevented']         ?? row['fielding_run_value'] ?? '') || null,
    position:                 row['primary_pos_formatted'] ?? row['position'] ?? row['pos'] ?? null,
  };
}

/** Forces a full cache refresh regardless of TTL. Returns getCacheStatus() after refresh. */
export async function refreshCache() {
  _cache.lastUpdated = 0;
  await loadAll();
  return getCacheStatus();
}

/** Returns cache metadata without triggering a fetch */
export function getCacheStatus() {
  return {
    lastUpdated: _cache.lastUpdated ? new Date(_cache.lastUpdated).toISOString() : null,
    age_minutes: _cache.lastUpdated ? Math.round((Date.now() - _cache.lastUpdated) / 60000) : null,
    recordCounts: {
      xStatsBatter:      _cache.xStatsBatter?.length      ?? 0,
      xStatsPitcher:     _cache.xStatsPitcher?.length     ?? 0,
      exitVelocity:      _cache.exitVelocity?.length      ?? 0,
      pitchArsenal:      _cache.pitchArsenal?.length      ?? 0,
      percentiles:       _cache.percentiles?.length       ?? 0,
      rollingBatter:     _cache.rollingBatter?.length     ?? 0,
      rollingPitcher:    _cache.rollingPitcher?.length    ?? 0,
      pitchTempo:        _cache.pitchTempo?.length        ?? 0,
      sprintSpeed:       _cache.sprintSpeed?.length       ?? 0,
      battedBallBatter:  _cache.battedBallBatter?.length  ?? 0,
      battedBallPitcher: _cache.battedBallPitcher?.length ?? 0,
      parkFactors:       _cache.parkFactors?.length       ?? 0,
      catcherFraming:    _cache.catcherFraming?.length    ?? 0,
      fieldingOAA:       _cache.fieldingOAA?.length       ?? 0,
      yearToYearBatter:  _cache.yearToYearBatter?.length  ?? 0,
      yearToYearPitcher: _cache.yearToYearPitcher?.length ?? 0,
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Computes year-over-year xwOBA change from a year-to-year leaderboard row.
 * Returns current_year − previous_year (positive = improving).
 * Tries several column name patterns Savant has used historically.
 */
function calcYearToYearDiff(row) {
  if (!row) return null;
  // Pattern 1: explicit diff column
  const diff = parseFloat(
    row['diff'] ?? row['xwoba_diff'] ?? row['change'] ?? row['delta'] ?? ''
  );
  if (!isNaN(diff)) return Math.round(diff * 1000) / 1000;
  // Pattern 2: current vs prior year columns
  const cur  = parseFloat(row['xwoba']      ?? row['xwoba_cur']  ?? row['year1_xwoba'] ?? '');
  const prev = parseFloat(row['prev_xwoba'] ?? row['xwoba_prev'] ?? row['year2_xwoba'] ?? '');
  if (!isNaN(cur) && !isNaN(prev)) return Math.round((cur - prev) * 1000) / 1000;
  return null;
}

/** Extracts percentile rankings from a percentile-rankings row */
function extractPercentiles(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('p_') || k.startsWith('percent')) {
      const num = parseFloat(v);
      if (!isNaN(num)) out[k] = num;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Returns the single best (most negative = run-saving) run_value_per_100 found across
 * all pitch-type-prefixed columns in a pitch-arsenal-stats row.
 */
function bestPitchRunValue(row) {
  const PITCH_PREFIXES = ['ff_', 'si_', 'fc_', 'sl_', 'cu_', 'ch_', 'fs_', 'kn_', 'sv_', 'cs_'];
  let best = null;
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (!PITCH_PREFIXES.some(p => lk.startsWith(p))) continue;
    if (!lk.includes('run_value')) continue;
    const num = parseFloat(v);
    if (!isNaN(num) && (best === null || num < best)) best = num;
  }
  // Fallback: top-level run_value_per_100 column
  if (best === null) {
    const top = parseFloat(row['run_value_per_100'] ?? row['run_value'] ?? '');
    if (!isNaN(top)) best = top;
  }
  return best;
}

/** Extracts pitch arsenal run values from a pitch-arsenal-stats row */
function extractArsenal(row) {
  const out = {};
  // Common column names: run_value_per_100, whiff_percent, put_away per pitch type prefix
  const PITCH_PREFIXES = ['ff_', 'si_', 'fc_', 'sl_', 'cu_', 'ch_', 'fs_', 'kn_', 'sv_', 'cs_'];
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (PITCH_PREFIXES.some(p => lk.startsWith(p))) {
      const num = parseFloat(v);
      if (!isNaN(num)) out[k] = num;
    }
  }
  // Also grab overall whiff / put_away / hard_hit
  for (const col of ['whiff_percent', 'put_away', 'hard_hit_percent', 'barrel_batted_rate', 'run_value', 'run_value_per_100']) {
    if (row[col] !== undefined) {
      const num = parseFloat(row[col]);
      if (!isNaN(num)) out[col] = num;
    }
  }
  return Object.keys(out).length ? out : null;
}
