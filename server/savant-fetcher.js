/**
 * savant-fetcher.js — Baseball Savant Statcast leaderboard fetcher for H.E.X.A. V4
 *
 * Fetches CSV leaderboards from baseballsavant.mlb.com and caches them in memory.
 * Cache TTL is 6 hours. All CSV parsing is done without external dependencies.
 *
 * Exports:
 *   getBatterStatcast(playerName)  — xwOBA, xBA, xSLG, EV, Barrel%, HardHit%, rolling wOBA (7/14/21/30d),
 *                                    home_run_profile, run_value_profile, swing_path,
 *                                    sprint speed, batted ball profile, year-to-year Δ, percentiles
 *   getPitcherStatcast(playerName) — xwOBA_against, Whiff%, arsenal run values,
 *                                    home_run_profile_against, run_value_by_pitch,
 *                                    rolling wOBA against (7/14/21/30d), pitch tempo, batted ball profile
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

// ── Season window ─────────────────────────────────────────────────────────────

/**
 * Returns an array of seasons to query, most recent first.
 * e.g. getSeasonWindow(5) in 2026 → [2026, 2025, 2024, 2023, 2022, 2021]
 */
function getSeasonWindow(historyYears = 5) {
  const current = new Date().getFullYear();
  const years = [];
  for (let i = 0; i <= historyYears; i++) years.push(current - i);
  return years;
}

const ENDPOINTS = {
  // ── Existing leaderboards ────────────────────────────────────────────────
  xStatsBatter:      'https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=2025&position=&team=&min=q&csv=true',
  xStatsPitcher:     'https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=2025&position=&team=&min=q&csv=true',
  exitVelocity:      [
    'https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=2025&position=&team=&min=25&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/exit_velocity_barrels?type=batter&year=2025&min=q&csv=true',
  ],
  pitchArsenal:      'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&year=2025&min=q&csv=true',
  percentiles:       'https://baseballsavant.mlb.com/leaderboard/percentile-rankings?type=batter&year=2025&csv=true',
  rollingBatter:     [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=10&selections=xba,xslg,xwoba,xobp,exit_velocity_avg,launch_angle_avg,barrel_batted_rate&chart=false&x=xba&y=xba&r=no&chartType=bbs&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=batter&type=woba&rolling=30&year=2025&min=10&csv=true',
  ],
  rollingPitcher:    [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=10&selections=xba,xslg,xwoba,xobp,exit_velocity_avg,launch_angle_avg,barrel_batted_rate&chart=false&x=xba&y=xba&r=no&chartType=bbs&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=pitcher&type=woba&rolling=30&year=2025&min=10&csv=true',
  ],
  pitchTempo:        'https://baseballsavant.mlb.com/leaderboard/pitch-tempo?year=2025&type=pitcher&csv=true',
  sprintSpeed:       'https://baseballsavant.mlb.com/leaderboard/sprint_speed?year=2025&position=&team=&min=10&csv=true',
  battedBallBatter:  'https://baseballsavant.mlb.com/leaderboard/batted-ball?year=2025&type=batter&min=q&csv=true',
  battedBallPitcher: 'https://baseballsavant.mlb.com/leaderboard/batted-ball?year=2025&type=pitcher&min=q&csv=true',
  parkFactors:       [], // Savant park factors CSV endpoint returns HTML, not CSV — using hardcoded values
  catcherFraming:    'https://baseballsavant.mlb.com/leaderboard/catcher_framing?year=2025&team=&min=q&csv=true',
  fieldingOAA:       'https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=Fielder&year=2025&team=&csv=true',
  yearToYearBatter:  [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=25&selections=xwoba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/statcast-year-to-year?group=Batter&type=xwoba&year=2025&csv=true',
  ],
  yearToYearPitcher: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=25&selections=xwoba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/statcast-year-to-year?group=Pitcher&type=xwoba&year=2025&csv=true',
  ],

  // ── New leaderboards ─────────────────────────────────────────────────────
  homeRunsBatter:    [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=q&selections=hr,hr_per_fb,fb_percent&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/home_runs?year=2025&type=batter&min=q&csv=true',
  ],
  homeRunsPitcher:   [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=q&selections=hr,hr_per_fb,fb_percent&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/home_runs?year=2025&type=pitcher&min=q&csv=true',
  ],
  runValueBatter:    [
    'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=batter&year=2025&min=q&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=q&selections=run_value,run_value_per_100&chart=false&csv=true',
  ],
  runValuePitcher:   [
    'https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&year=2025&min=q&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=q&selections=run_value,run_value_per_100&chart=false&csv=true',
  ],
  rollingBatter7d:   [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=5&selections=woba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=batter&type=woba&rolling=7&year=2025&min=5&csv=true',
  ],
  rollingBatter14d:  [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=8&selections=woba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=batter&type=woba&rolling=14&year=2025&min=8&csv=true',
  ],
  rollingBatter21d:  [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=10&selections=woba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=batter&type=woba&rolling=21&year=2025&min=10&csv=true',
  ],
  rollingPitcher7d:  [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=5&selections=woba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=pitcher&type=woba&rolling=7&year=2025&min=5&csv=true',
  ],
  rollingPitcher14d: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=8&selections=woba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=pitcher&type=woba&rolling=14&year=2025&min=8&csv=true',
  ],
  rollingPitcher21d: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=10&selections=woba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/rolling-stats?group=pitcher&type=woba&rolling=21&year=2025&min=10&csv=true',
  ],
  swingPath:         [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=q&selections=attack_angle_avg,squared_up_pct,fast_swing_rate&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/swing-path?year=2025&type=batter&min=q&csv=true',
  ],
  batTracking: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=q&selections=bat_speed,swing_length,squared_up_pct,blasts_per_swing&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/bat-tracking?year=2025&type=batter&min=q&csv=true',
  ],
  catcherPopTime: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=catcher&filter=&sort=4&sortDir=desc&min=q&selections=pop_2b_sba,pop_2b_sba_count,exchange_2b_3b_sba&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/catcher_pop_time?year=2025&team=&min=q&csv=true',
  ],
  outfieldJump: [
    'https://baseballsavant.mlb.com/leaderboard/outfield_jump?year=2025&team=&min=q&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/outs_above_average?type=OF&year=2025&team=&csv=true',
  ],
  armStrength: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=fielder&filter=&sort=4&sortDir=desc&min=q&selections=arm_strength,arm_value&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/arm_strength?year=2025&type=outfielder&team=&min=q&csv=true',
  ],
  ninetyFtSplits: [
    'https://baseballsavant.mlb.com/leaderboard/sprint_speed?year=2025&position=&team=&min=10&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=batter&filter=&sort=4&sortDir=desc&min=10&selections=hp_to_1b,sprint_speed&chart=false&csv=true',
  ],
  pitcherPositioning: [
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=q&selections=n_shift,shift_rate&chart=false&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/pitcher-positioning?year=2025&type=pitcher&min=q&csv=true',
  ],
  activeSpin: [
    'https://baseballsavant.mlb.com/leaderboard/active-spin?year=2025&type=pitcher&min=q&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=q&selections=active_spin,spin_rate&chart=false&csv=true',
  ],
  pitchMovement: [
    'https://baseballsavant.mlb.com/leaderboard/pitch-movement?year=2025&type=pitcher&min=q&csv=true',
    'https://baseballsavant.mlb.com/leaderboard/custom?year=2025&type=pitcher&filter=&sort=4&sortDir=desc&min=q&selections=pfx_x,pfx_z,spin_rate&chart=false&csv=true',
  ],
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
  // New
  homeRunsBatter:    null,
  homeRunsPitcher:   null,
  runValueBatter:    null,
  runValuePitcher:   null,
  rollingBatter7d:   null,
  rollingBatter14d:  null,
  rollingBatter21d:  null,
  rollingPitcher7d:  null,
  rollingPitcher14d: null,
  rollingPitcher21d: null,
  swingPath:         null,
  batTracking:       null,
  catcherPopTime:    null,
  outfieldJump:      null,
  armStrength:       null,
  ninetyFtSplits:    null,
  pitcherPositioning: null,
  activeSpin:        null,
  pitchMovement:     null,
  lastUpdated:       0,
  yearsLoaded:       [],
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

/** Tries each URL in order; returns the first successful result, throws after all fail. */
async function fetchCSVWithFallback(urls, name = '') {
  let lastErr;
  for (const url of urls) {
    try {
      return await fetchCSV(url);
    } catch (err) {
      console.warn(`[savant] ${name ? name + ': ' : ''}${url} — ${err.message}; trying next URL…`);
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Replaces year=NNNN with year=<year> in a URL string */
function substituteYear(url, year) {
  return url.replace(/year=\d{4}/g, `year=${year}`);
}

/**
 * For the current season, replaces min=q / min=25 / min=10 with min=1
 * so early-season data is captured before players reach qualified thresholds.
 */
function substituteMinForCurrentYear(url, year) {
  const currentYear = new Date().getFullYear();
  if (year === currentYear) {
    return url.replace(/min=q/g, 'min=1').replace(/min=25/g, 'min=1').replace(/min=10/g, 'min=1');
  }
  return url;
}

/**
 * Fetches a leaderboard across multiple seasons and merges results.
 * Most recent year's data wins when a player appears in multiple seasons.
 * Returns { rows, yearsLoaded }.
 */
async function fetchMultiYear(urlsOrUrl, years, name = '') {
  const urlList = Array.isArray(urlsOrUrl) ? urlsOrUrl : [urlsOrUrl];
  const playerMap = new Map(); // playerKey → row (most recent year wins)
  const yearsLoaded = [];

  for (const year of years) {
    const yearUrls = urlList.map(u => substituteMinForCurrentYear(substituteYear(u, year), year));
    try {
      const rows = await fetchCSVWithFallback(yearUrls, `${name}:${year}`);
      if (!rows.length) continue;
      yearsLoaded.push(year);
      for (const row of rows) {
        const key =
          row['player_id'] ??
          row['last_name, first_name'] ??
          row['player_name'] ??
          row['name'] ??
          JSON.stringify(row).slice(0, 40);
        // Only set if not already present — years are iterated most-recent-first
        if (!playerMap.has(key)) playerMap.set(key, row);
      }
    } catch {
      // year unavailable — skip silently (fetchCSVWithFallback already warned)
    }
  }

  return { rows: [...playerMap.values()], yearsLoaded };
}

async function loadAll() {
  const years = getSeasonWindow(5);
  console.log(`[savant] Fetching all leaderboards for seasons: ${years.join(', ')}…`);

  const KEYS = [
    'xStatsBatter', 'xStatsPitcher', 'exitVelocity', 'pitchArsenal', 'percentiles',
    'rollingBatter', 'rollingPitcher', 'pitchTempo', 'sprintSpeed',
    'battedBallBatter', 'battedBallPitcher',
    'parkFactors', 'catcherFraming', 'fieldingOAA',
    'yearToYearBatter', 'yearToYearPitcher',
    'homeRunsBatter', 'homeRunsPitcher',
    'runValueBatter', 'runValuePitcher',
    'rollingBatter7d', 'rollingBatter14d', 'rollingBatter21d',
    'rollingPitcher7d', 'rollingPitcher14d', 'rollingPitcher21d',
    'swingPath',
    'batTracking', 'catcherPopTime', 'outfieldJump', 'armStrength',
    'ninetyFtSplits', 'pitcherPositioning', 'activeSpin', 'pitchMovement',
  ];

  const fetches = KEYS.map(key => {
    const endpoint = ENDPOINTS[key];
    if (Array.isArray(endpoint) && endpoint.length === 0) {
      return Promise.resolve({ rows: [], yearsLoaded: [] });
    }
    if (key === 'parkFactors') {
      // Fixed rolling-3-year URL — fetch once, not per-season
      return fetchCSV(endpoint)
        .then(rows => ({ rows, yearsLoaded: [2025] }))
        .catch(err => {
          console.warn(`[savant] parkFactors: ${err.message}`);
          return { rows: [], yearsLoaded: [] };
        });
    }
    return fetchMultiYear(endpoint, years, key);
  });

  const results = await Promise.allSettled(fetches);

  const newCache = { lastUpdated: Date.now(), yearsLoaded: new Set() };
  results.forEach((r, idx) => {
    const key = KEYS[idx];
    if (r.status === 'fulfilled') {
      newCache[key] = r.value.rows;
      r.value.yearsLoaded.forEach(y => newCache.yearsLoaded.add(y));
    } else {
      console.warn(`[savant] WARNING: ${key} failed entirely — skipping`);
      newCache[key] = [];
    }
  });
  newCache.yearsLoaded = [...newCache.yearsLoaded].sort((a, b) => b - a);

  _cache = newCache;

  const c = newCache;
  console.log(
    `[savant] Cache refreshed (years: ${c.yearsLoaded.join(',')}) — ` +
    `batters: ${c.xStatsBatter.length}, pitchers: ${c.xStatsPitcher.length}, ` +
    `EV: ${c.exitVelocity.length}, arsenal: ${c.pitchArsenal.length}, pct: ${c.percentiles.length}, ` +
    `rollingB: ${c.rollingBatter.length}, rollingP: ${c.rollingPitcher.length}, ` +
    `tempo: ${c.pitchTempo.length}, sprint: ${c.sprintSpeed.length}, ` +
    `bbBatter: ${c.battedBallBatter.length}, bbPitcher: ${c.battedBallPitcher.length}, ` +
    `parks: ${c.parkFactors.length}, framing: ${c.catcherFraming.length}, ` +
    `oaa: ${c.fieldingOAA.length}, y2yB: ${c.yearToYearBatter.length}, y2yP: ${c.yearToYearPitcher.length}, ` +
    `hrBatter: ${c.homeRunsBatter.length}, hrPitcher: ${c.homeRunsPitcher.length}, ` +
    `rvBatter: ${c.runValueBatter.length}, rvPitcher: ${c.runValuePitcher.length}, ` +
    `rb7d: ${c.rollingBatter7d.length}, rb14d: ${c.rollingBatter14d.length}, rb21d: ${c.rollingBatter21d.length}, ` +
    `rp7d: ${c.rollingPitcher7d.length}, rp14d: ${c.rollingPitcher14d.length}, rp21d: ${c.rollingPitcher21d.length}, ` +
    `swingPath: ${c.swingPath.length}, ` +
    `batTracking: ${c.batTracking.length}, catcherPopTime: ${c.catcherPopTime.length}, outfieldJump: ${c.outfieldJump.length}, armStrength: ${c.armStrength.length}, ` +
    `90ft: ${c.ninetyFtSplits.length}, pitcherPos: ${c.pitcherPositioning.length}, activeSpin: ${c.activeSpin.length}, pitchMovement: ${c.pitchMovement.length}`
  );
  console.log(`[savant] Year breakdown: ${JSON.stringify(Object.fromEntries([...newCache.yearsLoaded].map(y => [y, 'loaded'])))}`);
}

async function ensureCache() {
  if (!_cache.lastUpdated || Date.now() - _cache.lastUpdated > CACHE_TTL_MS) {
    await loadAll();
  }
}

// ── Player matching ───────────────────────────────────────────────────────────

/** Normalises a name for comparison: lowercase, remove accents, trim, collapse spaces */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // Remove accents: é→e, ñ→n, ü→u
    .replace(/[.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy player match against a leaderboard array.
 * Tries exact full-name match first, then last-name-only match.
 * The name field examined is determined by the `nameKey` param (default 'last_name, first_name').
 */
function findPlayer(rows, playerName, nameKey = 'last_name, first_name') {
  if (!rows?.length || !playerName) return null;
  const query = norm(playerName);

  function rowName(row) {
    const raw = row[nameKey] ?? row['player_name'] ?? row['name'] ?? '';
    return norm(raw);
  }

  // 1. Exact full-name match (after normalization)
  let match = rows.find(r => rowName(r) === query);
  if (match) return match;

  // 2. Try "first last" vs stored "last, first" (Savant format)
  const parts = query.split(' ');
  if (parts.length >= 2) {
    // "max fried" → try "fried, max" and "fried max"
    const reversed = parts.slice(1).join(' ') + ', ' + parts[0];
    const reversedNoComma = parts.slice(1).join(' ') + ' ' + parts[0];
    match = rows.find(r => {
      const rn = rowName(r);
      return rn === reversed || rn === reversedNoComma || rn.replace(', ', ' ') === query || rn.replace(', ', ' ') === reversedNoComma;
    });
    if (match) return match;
  }

  // 3. Last-name match (first result wins)
  const lastName = parts[parts.length - 1];
  if (lastName.length > 2) {
    match = rows.find(r => {
      const rn = rowName(r);
      const rnParts = rn.replace(',', '').split(' ');
      return rnParts[0] === lastName || rnParts[rnParts.length - 1] === lastName;
    });
    if (match) return match;
  }

  // 4. First name + last name both present (handles middle names, suffixes)
  if (parts.length >= 2) {
    const firstName = parts[0];
    match = rows.find(r => {
      const rn = rowName(r);
      return rn.includes(firstName) && rn.includes(lastName);
    });
    if (match) return match;
  }

  // 5. Word-overlap score >= 0.5
  match = rows
    .map(r => {
      const rn     = rowName(r).replace(/[,]/g, '');
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
 * Returns merged Statcast data for a batter.
 * New fields: home_run_profile, run_value_profile, rolling_windows, swing_path
 */
export async function getBatterStatcast(playerName) {
  await ensureCache();

  const xs   = findPlayer(_cache.xStatsBatter,     playerName);
  const ev   = findPlayer(_cache.exitVelocity,      playerName);
  const pct  = findPlayer(_cache.percentiles,       playerName);
  const rb   = findPlayer(_cache.rollingBatter,     playerName);
  const ss   = findPlayer(_cache.sprintSpeed,       playerName);
  const bb   = findPlayer(_cache.battedBallBatter,  playerName);
  const y2y  = findPlayer(_cache.yearToYearBatter,  playerName);
  // New
  const hr   = findPlayer(_cache.homeRunsBatter,    playerName);
  const rv   = findPlayer(_cache.runValueBatter,    playerName);
  const rb7  = findPlayer(_cache.rollingBatter7d,   playerName);
  const rb14 = findPlayer(_cache.rollingBatter14d,  playerName);
  const rb21 = findPlayer(_cache.rollingBatter21d,  playerName);
  const sp   = findPlayer(_cache.swingPath,         playerName);
  const btRow = findPlayer(_cache.batTracking,      playerName);
  const sf   = findPlayer(_cache.ninetyFtSplits,    playerName);

  if (!xs && !ev && !pct && !rb && !ss && !bb && !y2y && !hr && !rv && !rb7 && !rb14 && !rb21 && !sp && !btRow && !sf) {
    console.log(`[savant] Batter NOT FOUND in cache: "${playerName}" (normalized: "${norm(playerName)}")`);
    return null;
  }

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
    // Rolling wOBA (30-day legacy + new short-term windows)
    rolling_woba_30d: parseFloat(rb?.woba ?? rb?.['xwoba'] ?? rb?.['rolling_woba'] ?? '') || null,
    rolling_windows: {
      woba_7d:  parseFloat(rb7?.woba  ?? rb7?.['rolling_woba']  ?? rb7?.['xwoba']  ?? '') || null,
      woba_14d: parseFloat(rb14?.woba ?? rb14?.['rolling_woba'] ?? rb14?.['xwoba'] ?? '') || null,
      woba_21d: parseFloat(rb21?.woba ?? rb21?.['rolling_woba'] ?? rb21?.['xwoba'] ?? '') || null,
    },
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
    // Home run profile (new)
    home_run_profile: hr ? extractBatterHomeRunProfile(hr) : null,
    // Run value by pitch type faced (new)
    run_value_profile: rv ? extractBatterRunValue(rv) : null,
    // Swing path / attack angle (new)
    swing_path: sp ? extractSwingPath(sp) : null,
    // Bat tracking (new)
    bat_tracking: btRow ? {
      bat_speed:        parseFloat(btRow?.bat_speed       ?? btRow?.['avg_bat_speed']    ?? '') || null,
      swing_length:     parseFloat(btRow?.swing_length    ?? btRow?.['avg_swing_length'] ?? '') || null,
      blasts_per_swing: parseFloat(btRow?.blasts_per_swing ?? btRow?.['blasts_swing']    ?? '') || null,
    } : null,
    // 90ft splits
    splits_90ft: sf ? {
      hp_to_1b:     parseFloat(sf?.hp_to_1b     ?? sf?.['home_to_first'] ?? '') || null,
      sprint_speed: parseFloat(sf?.sprint_speed ?? sf?.['speed']         ?? '') || null,
    } : null,
    // Source rows for transparency
    _sources: {
      xStats: !!xs, exitVelocity: !!ev, percentiles: !!pct,
      rolling: !!rb, rolling7d: !!rb7, rolling14d: !!rb14, rolling21d: !!rb21,
      sprintSpeed: !!ss, battedBall: !!bb, yearToYear: !!y2y,
      homeRuns: !!hr, runValue: !!rv, swingPath: !!sp, batTracking: !!btRow,
      ninetyFtSplits: !!sf,
    },
  };
}

/**
 * Returns merged Statcast data for a pitcher.
 * New fields: home_run_profile_against, run_value_by_pitch, rolling_windows_against
 */
export async function getPitcherStatcast(playerName) {
  await ensureCache();

  const xs   = findPlayer(_cache.xStatsPitcher,    playerName);
  const pa   = findPlayer(_cache.pitchArsenal,      playerName);
  const rp   = findPlayer(_cache.rollingPitcher,    playerName);
  const pt   = findPlayer(_cache.pitchTempo,        playerName);
  const bb   = findPlayer(_cache.battedBallPitcher, playerName);
  const y2y  = findPlayer(_cache.yearToYearPitcher, playerName);
  // New
  const hr   = findPlayer(_cache.homeRunsPitcher,   playerName);
  const rv   = findPlayer(_cache.runValuePitcher,   playerName);
  const rp7  = findPlayer(_cache.rollingPitcher7d,    playerName);
  const rp14 = findPlayer(_cache.rollingPitcher14d,   playerName);
  const rp21 = findPlayer(_cache.rollingPitcher21d,   playerName);
  const pp   = findPlayer(_cache.pitcherPositioning,  playerName);
  const asp  = findPlayer(_cache.activeSpin,           playerName);
  const pm   = findPlayer(_cache.pitchMovement,        playerName);

  if (!xs && !pa && !rp && !pt && !bb && !y2y && !hr && !rv && !rp7 && !rp14 && !rp21 && !pp && !asp && !pm) {
    console.log(`[savant] Pitcher NOT FOUND in cache: "${playerName}" (normalized: "${norm(playerName)}")`);
    return null;
  }

  return {
    player_name: xs?.['last_name, first_name'] ?? pa?.['last_name, first_name'] ?? playerName,
    // Expected stats (against)
    xwOBA_against: parseFloat(xs?.xwOBA ?? xs?.['xwoba'] ?? '') || null,
    xBA_against:   parseFloat(xs?.xBA   ?? xs?.['xba']   ?? '') || null,
    xSLG_against:  parseFloat(xs?.xSLG  ?? xs?.['xslg']  ?? '') || null,
    wOBA_against:  parseFloat(xs?.wOBA  ?? xs?.['woba']  ?? '') || null,
    // Plate discipline
    whiff_percent:     parseFloat(xs?.['whiff_percent']      ?? xs?.['swstr_percent']        ?? '') || null,
    k_percent:         parseFloat(xs?.['k_percent']          ?? xs?.['strikeout_percent']    ?? '') || null,
    bb_percent:        parseFloat(xs?.['bb_percent']         ?? xs?.['walk_percent']         ?? '') || null,
    // Deep K props metrics — multiple fallback keys per field (Savant changes column names between seasons)
    csw_percent:       parseFloat(xs?.['csw_percent']        ?? xs?.['csw_rate']             ?? xs?.['called_plus_whiff_pct'] ?? '') || null,
    o_swing_percent:   parseFloat(xs?.['o_swing_percent']    ?? xs?.['chase_percent']        ?? xs?.['chase_rate']           ?? xs?.['oz_swing_percent'] ?? '') || null,
    z_contact_percent: parseFloat(xs?.['z_contact_percent']  ?? xs?.['zone_contact_pct']    ?? '') || null,
    // Pitch arsenal (existing)
    arsenal: pa ? extractArsenal(pa) : null,
    // Best single-pitch run value
    run_value_per_pitch: pa ? bestPitchRunValue(pa) : null,
    // Rolling wOBA against (30-day legacy + new short-term windows)
    rolling_woba_against_30d: parseFloat(rp?.woba ?? rp?.['xwoba'] ?? rp?.['rolling_woba'] ?? '') || null,
    rolling_windows_against: {
      woba_against_7d:  parseFloat(rp7?.woba  ?? rp7?.['rolling_woba']  ?? rp7?.['xwoba']  ?? '') || null,
      woba_against_14d: parseFloat(rp14?.woba ?? rp14?.['rolling_woba'] ?? rp14?.['xwoba'] ?? '') || null,
      woba_against_21d: parseFloat(rp21?.woba ?? rp21?.['rolling_woba'] ?? rp21?.['xwoba'] ?? '') || null,
    },
    // Pitch tempo
    pitch_tempo_seconds: parseFloat(
      pt?.avg_seconds ?? pt?.['seconds_between_pitches'] ?? pt?.['avg_time'] ?? pt?.tempo ?? ''
    ) || null,
    // Batted ball profile (against)
    gb_pct: parseFloat(bb?.gb_percent ?? bb?.gb ?? '') || null,
    fb_pct: parseFloat(bb?.fb_percent ?? bb?.fb ?? '') || null,
    ld_pct: parseFloat(bb?.ld_percent ?? bb?.ld ?? '') || null,
    // Year-over-year xwOBA against change
    year_to_year_xwoba_against_change: calcYearToYearDiff(y2y),
    // Home run profile allowed (new)
    home_run_profile_against: hr ? extractPitcherHomeRunProfile(hr) : null,
    // Run value by pitch type thrown (new)
    run_value_by_pitch: rv ? extractPitcherRunValue(rv) : null,
    // Pitcher positioning / shift tendencies
    pitcher_positioning: pp ? {
      shift_rate: parseFloat(pp?.shift_rate ?? pp?.['n_shift']  ?? '') || null,
      n_shift:    parseInt(pp?.n_shift      ?? pp?.['shifts']   ?? '') || null,
    } : null,
    // Active spin profile
    active_spin: asp ? {
      active_spin_pct: parseFloat(asp?.active_spin  ?? asp?.['active_spin_pct']  ?? '') || null,
      avg_spin_rate:   parseFloat(asp?.spin_rate     ?? asp?.['avg_spin_rate']    ?? '') || null,
    } : null,
    // Pitch movement profile
    pitch_movement: pm ? {
      horizontal_break: parseFloat(pm?.pfx_x    ?? pm?.['h_break']   ?? '') || null,
      vertical_break:   parseFloat(pm?.pfx_z    ?? pm?.['v_break']   ?? '') || null,
      avg_spin_rate:    parseFloat(pm?.spin_rate ?? pm?.['spin_rate'] ?? '') || null,
    } : null,
    _sources: {
      xStats: !!xs, pitchArsenal: !!pa,
      rolling: !!rp, rolling7d: !!rp7, rolling14d: !!rp14, rolling21d: !!rp21,
      pitchTempo: !!pt, battedBall: !!bb, yearToYear: !!y2y,
      homeRuns: !!hr, runValue: !!rv,
      pitcherPositioning: !!pp, activeSpin: !!asp, pitchMovement: !!pm,
    },
  };
}

/**
 * Returns park factor data for a team.
 */
export async function getParkFactor(teamName) {
  await ensureCache();
  if (!_cache.parkFactors?.length || !teamName) return null;

  const q = norm(teamName);
  const row = _cache.parkFactors.find(r => {
    const abbr  = norm(r['team_abbrev'] ?? r['team_abbr'] ?? r['team']      ?? r['abbreviation'] ?? '');
    const full  = norm(r['team_name']   ?? r['team_full'] ?? r['name']      ?? '');
    const venue = norm(r['venue_name']  ?? r['venue']     ?? r['park']      ?? '');
    return abbr === q || full.includes(q) || q.includes(abbr) || venue.includes(q);
  }) ?? null;

  if (!row) return null;

  return {
    team:                 row['team_abbrev']  ?? row['team_abbr']   ?? row['team']         ?? teamName,
    venue_name:           row['venue_name']   ?? row['venue']       ?? row['park']         ?? null,
    park_factor_overall:  parseFloat(row['index_wOBA']    ?? row['park_factor']  ?? row['pf']    ?? row['factor'] ?? '') || null,
    park_factor_R:        parseFloat(row['index_R']       ?? row['park_factor_r']  ?? row['pfr'] ?? row['r']      ?? '') || null,
    park_factor_HR:       parseFloat(row['index_HR']      ?? row['park_factor_hr'] ?? row['pfhr'] ?? row['hr']    ?? '') || null,
    park_factor_H:        parseFloat(row['index_H']       ?? row['park_factor_h']  ?? row['pfh']  ?? row['h']     ?? '') || null,
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
    player_name:            row['last_name, first_name'] ?? catcherName,
    framing_runs:           parseFloat(row['framing_runs']           ?? row['runs_extra_strikes'] ?? row['run_value'] ?? '') || null,
    strike_rate_added:      parseFloat(row['strike_rate_added']      ?? row['strike_rate']        ?? '') || null,
    extra_strikes_per_game: parseFloat(row['extra_strikes_per_game'] ?? row['strikes_gained_per_game'] ?? row['strikes_per_game'] ?? '') || null,
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
    player_name:             row['last_name, first_name'] ?? playerName,
    outs_above_average:      parseFloat(row['outs_above_average']      ?? row['oaa']                    ?? '') || null,
    fielding_runs_prevented: parseFloat(row['fielding_runs_prevented'] ?? row['runs_prevented']         ?? row['fielding_run_value'] ?? '') || null,
    position:                row['primary_pos_formatted'] ?? row['position'] ?? row['pos'] ?? null,
  };
}

/**
 * Returns catcher pop time / exchange metrics for a catcher.
 */
export async function getCatcherPopTime(catcherName) {
  await ensureCache();
  const row = findPlayer(_cache.catcherPopTime, catcherName);
  if (!row) return null;
  return {
    player_name:   row['last_name, first_name'] ?? catcherName,
    pop_time_2b:   parseFloat(row['pop_2b_sba']         ?? row['pop_time']  ?? '') || null,
    exchange_time: parseFloat(row['exchange_2b_3b_sba'] ?? row['exchange']  ?? '') || null,
    attempts:      parseInt(row['pop_2b_sba_count']      ?? row['attempts'] ?? '') || null,
  };
}

/**
 * Returns outfield jump and arm strength metrics for an outfielder.
 */
export async function getOutfieldJump(playerName) {
  await ensureCache();
  const row = findPlayer(_cache.outfieldJump, playerName);
  if (!row) return null;
  return {
    player_name:      row['last_name, first_name'] ?? playerName,
    jump_distance:    parseFloat(row['jump_distance']    ?? row['jump']      ?? '') || null,
    reaction_time:    parseFloat(row['reaction_time']    ?? row['reaction']  ?? '') || null,
    oaa_of:           parseFloat(row['outs_above_average'] ?? row['oaa']     ?? '') || null,
    arm_strength_mph: parseFloat(row['arm_strength']     ?? row['arm_speed'] ?? '') || null,
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
    yearsLoaded: _cache.yearsLoaded ?? [],
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
      // New
      homeRunsBatter:    _cache.homeRunsBatter?.length    ?? 0,
      homeRunsPitcher:   _cache.homeRunsPitcher?.length   ?? 0,
      runValueBatter:    _cache.runValueBatter?.length    ?? 0,
      runValuePitcher:   _cache.runValuePitcher?.length   ?? 0,
      rollingBatter7d:   _cache.rollingBatter7d?.length   ?? 0,
      rollingBatter14d:  _cache.rollingBatter14d?.length  ?? 0,
      rollingBatter21d:  _cache.rollingBatter21d?.length  ?? 0,
      rollingPitcher7d:  _cache.rollingPitcher7d?.length  ?? 0,
      rollingPitcher14d: _cache.rollingPitcher14d?.length ?? 0,
      rollingPitcher21d: _cache.rollingPitcher21d?.length ?? 0,
      swingPath:         _cache.swingPath?.length         ?? 0,
      batTracking:       _cache.batTracking?.length       ?? 0,
      catcherPopTime:    _cache.catcherPopTime?.length    ?? 0,
      outfieldJump:      _cache.outfieldJump?.length      ?? 0,
      armStrength:        _cache.armStrength?.length        ?? 0,
      ninetyFtSplits:     _cache.ninetyFtSplits?.length     ?? 0,
      pitcherPositioning: _cache.pitcherPositioning?.length ?? 0,
      activeSpin:         _cache.activeSpin?.length         ?? 0,
      pitchMovement:      _cache.pitchMovement?.length      ?? 0,
    },
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Maps Savant pitch-type column prefixes to human-readable names */
const PITCH_TYPE_NAMES = {
  ff: 'fastball_4seam',
  si: 'sinker',
  fc: 'cutter',
  sl: 'slider',
  cu: 'curveball',
  ch: 'changeup',
  fs: 'splitter',
  kn: 'knuckleball',
  sv: 'sweeper',
  st: 'sweeper',
  cs: 'slow_curve',
  ep: 'eephus',
};

/**
 * Computes year-over-year xwOBA change from a year-to-year leaderboard row.
 */
function calcYearToYearDiff(row) {
  if (!row) return null;
  const diff = parseFloat(row['diff'] ?? row['xwoba_diff'] ?? row['change'] ?? row['delta'] ?? '');
  if (!isNaN(diff)) return Math.round(diff * 1000) / 1000;
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
 * Returns the best (most negative = run-saving) run_value_per_100 across all
 * pitch-type-prefixed columns in a pitch-arsenal-stats row.
 */
function bestPitchRunValue(row) {
  const PITCH_PREFIXES = ['ff_', 'si_', 'fc_', 'sl_', 'cu_', 'ch_', 'fs_', 'kn_', 'sv_', 'st_', 'cs_'];
  let best = null;
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (!PITCH_PREFIXES.some(p => lk.startsWith(p))) continue;
    if (!lk.includes('run_value')) continue;
    const num = parseFloat(v);
    if (!isNaN(num) && (best === null || num < best)) best = num;
  }
  if (best === null) {
    const top = parseFloat(row['run_value_per_100'] ?? row['run_value'] ?? '');
    if (!isNaN(top)) best = top;
  }
  return best;
}

/** Extracts pitch arsenal run values from a pitch-arsenal-stats row */
function extractArsenal(row) {
  const out = {};
  const PITCH_PREFIXES = ['ff_', 'si_', 'fc_', 'sl_', 'cu_', 'ch_', 'fs_', 'kn_', 'sv_', 'st_', 'cs_'];
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (PITCH_PREFIXES.some(p => lk.startsWith(p))) {
      const num = parseFloat(v);
      if (!isNaN(num)) out[k] = num;
    }
  }
  for (const col of ['whiff_percent', 'put_away', 'hard_hit_percent', 'barrel_batted_rate', 'run_value', 'run_value_per_100']) {
    if (row[col] !== undefined) {
      const num = parseFloat(row[col]);
      if (!isNaN(num)) out[col] = num;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Extracts batter run-value-by-pitch-type-faced from a pitch-arsenal-stats (batter) row.
 * Returns object with human-readable pitch type keys.
 */
function extractBatterRunValue(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    const prefix = Object.keys(PITCH_TYPE_NAMES).find(p => lk.startsWith(p + '_'));
    if (!prefix) continue;
    if (!lk.includes('run_value') && !lk.includes('whiff') && !lk.includes('woba')) continue;
    const pitchName = PITCH_TYPE_NAMES[prefix];
    const statName  = lk.replace(prefix + '_', '');
    const num = parseFloat(v);
    if (!isNaN(num)) {
      if (!out[pitchName]) out[pitchName] = {};
      out[pitchName][statName] = num;
    }
  }
  // Overall run value
  const overall = parseFloat(row['run_value_per_100'] ?? row['run_value'] ?? '');
  if (!isNaN(overall)) out.overall_run_value_per_100 = overall;
  return Object.keys(out).length ? out : null;
}

/**
 * Extracts pitcher run-value-by-pitch-type-thrown from a pitch-arsenal-stats (pitcher) row.
 * Returns object with human-readable pitch type keys, plus best/worst pitch annotations.
 */
function extractPitcherRunValue(row) {
  if (!row) return null;
  const out = {};
  let best = { name: null, value: Infinity };   // most negative = best pitch for pitcher
  let worst = { name: null, value: -Infinity }; // most positive = worst pitch (hitter-friendly)

  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    const prefix = Object.keys(PITCH_TYPE_NAMES).find(p => lk.startsWith(p + '_'));
    if (!prefix) continue;
    if (!lk.includes('run_value') && !lk.includes('whiff') && !lk.includes('woba')) continue;
    const pitchName = PITCH_TYPE_NAMES[prefix];
    const statName  = lk.replace(prefix + '_', '');
    const num = parseFloat(v);
    if (!isNaN(num)) {
      if (!out[pitchName]) out[pitchName] = {};
      out[pitchName][statName] = num;
      // Track best/worst specifically for run_value_per_100
      if (lk.endsWith('run_value_per_100') || lk.endsWith('run_value')) {
        if (num < best.value)  { best  = { name: pitchName, value: num }; }
        if (num > worst.value) { worst = { name: pitchName, value: num }; }
      }
    }
  }

  if (best.name)  out.best_pitch  = { pitch: best.name,  run_value_per_100: best.value };
  if (worst.name) out.worst_pitch = { pitch: worst.name, run_value_per_100: worst.value };

  const overall = parseFloat(row['run_value_per_100'] ?? row['run_value'] ?? '');
  if (!isNaN(overall)) out.overall_run_value_per_100 = overall;

  return Object.keys(out).length ? out : null;
}

/** Extracts home run profile for a batter from the HR leaderboard */
function extractBatterHomeRunProfile(row) {
  if (!row) return null;
  return {
    home_runs:     parseFloat(row['hr']          ?? row['home_runs']     ?? '') || null,
    hr_per_pa:     parseFloat(row['hr_per_pa']   ?? row['hr_pa']         ?? '') || null,
    hr_per_fb:     parseFloat(row['hr_per_fb']   ?? row['hr_fb']         ?? '') || null,
    avg_hr_dist:   parseFloat(row['avg_distance'] ?? row['avg_hit_dist'] ?? row['distance'] ?? '') || null,
    max_hr_dist:   parseFloat(row['max_distance'] ?? row['max_hit_dist'] ?? '') || null,
    avg_launch_spd:parseFloat(row['avg_launch_speed'] ?? row['avg_exit_velocity'] ?? row['launch_speed'] ?? '') || null,
    pull_pct:      parseFloat(row['pull_percent'] ?? row['pull_pct']     ?? '') || null,
  };
}

/** Extracts home run profile allowed for a pitcher from the HR leaderboard */
function extractPitcherHomeRunProfile(row) {
  if (!row) return null;
  return {
    hr_allowed:          parseFloat(row['hr']          ?? row['home_runs']     ?? '') || null,
    hr_per_fb_allowed:   parseFloat(row['hr_per_fb']   ?? row['hr_fb']         ?? '') || null,
    hr_per_pa_allowed:   parseFloat(row['hr_per_pa']   ?? row['hr_pa']         ?? '') || null,
    avg_hr_dist_allowed: parseFloat(row['avg_distance'] ?? row['avg_hit_dist'] ?? '') || null,
  };
}

/** Extracts swing path / attack angle data from the swing-path leaderboard */
function extractSwingPath(row) {
  if (!row) return null;
  return {
    attack_angle:     parseFloat(row['attack_angle_avg'] ?? row['attack_angle']  ?? '') || null,
    squared_up_pct:   parseFloat(row['squared_up_pct']  ?? row['squared_up']    ?? '') || null,
    fast_swing_rate:  parseFloat(row['fast_swing_rate'] ?? row['fast_swing_pct'] ?? '') || null,
    blasts_per_swing: parseFloat(row['blasts_per_swing'] ?? row['blasts_swing']  ?? '') || null,
  };
}
