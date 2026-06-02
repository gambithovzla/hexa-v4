/**
 * tennis-elo-fetcher.js — surface ELO + H2H + recent form from Jeff Sackmann's
 * open tennis datasets (GitHub). This is the "Savant" of tennis: the data that
 * makes a surface-aware read possible, analogous to savant-fetcher.js (MLB),
 * the nflverse fetcher (NFL) and soccer-xg-fetcher.js (Soccer).
 *
 * Source: github.com/JeffSackmann/tennis_atp + tennis_wta — match-by-match CSVs,
 * one file per season, stable raw URLs. We pull the current + previous season,
 * run a single chronological ELO pass (overall + per-surface), and build H2H +
 * recent-form indexes. Everything is keyed by a normalized player name.
 *
 * Design contract (same as the other fetchers):
 *   - Cache 24h, stale fallback, NEVER throws. When GitHub is unreachable the
 *     lookups return null and the Oracle degrades to rankings-only (exactly the
 *     behavior tennis-context-builder documents for the pre-ELO phase).
 *
 * Public API:
 *   getSurfaceElo(tour, name, surface) → { overall, surface } | null
 *   getH2H(tour, nameA, nameB, surface) → { aWins, bWins, aWinsSurface, bWinsSurface } | null
 *   getRecentForm(tour, name) → { record, recent, surfaceRecord } | null
 *   getTennisEloStatus()
 */

const RAW_BASE = {
  atp: 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master',
  wta: 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master',
};
const FILE_PREFIX = { atp: 'atp_matches', wta: 'wta_matches' };

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ELO_BASE = 1500;
const ELO_K = 32;
const RECENT_FORM_N = 10;

// tour → { builtAt, elo: Map, h2h: Map, form: Map } | null
const _index = new Map();
let _status = { atp: null, wta: null };

function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSurface(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('carpet')) return 'carpet';
  if (s.includes('hard')) return 'hard';
  return 'hard'; // Sackmann default when blank
}

function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** Minimal CSV parse for the columns we use (Sackmann names have no commas). */
function parseMatchesCsv(text) {
  const lines = String(text ?? '').split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const col = (name) => header.indexOf(name);
  const iDate = col('tourney_date');
  const iSurface = col('surface');
  const iWinner = col('winner_name');
  const iLoser = col('loser_name');
  if (iWinner === -1 || iLoser === -1) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(',');
    const winner = f[iWinner];
    const loser = f[iLoser];
    if (!winner || !loser) continue;
    rows.push({
      date: iDate !== -1 ? Number(f[iDate]) : 0,
      surface: normalizeSurface(iSurface !== -1 ? f[iSurface] : ''),
      winner,
      loser,
    });
  }
  return rows;
}

async function fetchSeason(tour, year) {
  const url = `${RAW_BASE[tour]}/${FILE_PREFIX[tour]}_${year}.csv`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (hexa-tennis-elo)' } });
  if (!res.ok) throw new Error(`Sackmann ${tour} ${year}: HTTP ${res.status}`);
  return parseMatchesCsv(await res.text());
}

/**
 * Build the ELO/H2H/form indexes for a tour from the current + previous season.
 * Single chronological pass; bounded work even with a full season of matches.
 */
function buildIndexes(matches) {
  matches.sort((a, b) => (a.date || 0) - (b.date || 0));

  const elo = new Map();          // name → { overall, surfaces: {hard,clay,grass,carpet} }
  const h2h = new Map();          // "a|b" (sorted) → { [name]: wins, surface: {name: wins} }
  const form = new Map();         // name → [{ result:'W'|'L', surface }]

  const getElo = (name) => {
    if (!elo.has(name)) elo.set(name, { overall: ELO_BASE, surfaces: {} });
    const e = elo.get(name);
    return e;
  };
  const surfRating = (e, surface) => (e.surfaces[surface] ?? ELO_BASE);

  for (const m of matches) {
    const w = normName(m.winner);
    const l = normName(m.loser);
    if (!w || !l) continue;
    const surface = m.surface;

    const ew = getElo(w);
    const el = getElo(l);

    // Overall ELO update
    const expW = expectedScore(ew.overall, el.overall);
    ew.overall += ELO_K * (1 - expW);
    el.overall += ELO_K * (0 - (1 - expW));

    // Surface ELO update
    const wsr = surfRating(ew, surface);
    const lsr = surfRating(el, surface);
    const expWs = expectedScore(wsr, lsr);
    ew.surfaces[surface] = wsr + ELO_K * (1 - expWs);
    el.surfaces[surface] = lsr + ELO_K * (0 - (1 - expWs));

    // H2H
    const key = w < l ? `${w}|${l}` : `${l}|${w}`;
    if (!h2h.has(key)) h2h.set(key, { wins: {}, surface: {} });
    const rec = h2h.get(key);
    rec.wins[w] = (rec.wins[w] ?? 0) + 1;
    if (!rec.surface[surface]) rec.surface[surface] = {};
    rec.surface[surface][w] = (rec.surface[surface][w] ?? 0) + 1;

    // Recent form (append; trimmed at lookup)
    if (!form.has(w)) form.set(w, []);
    if (!form.has(l)) form.set(l, []);
    form.get(w).push({ result: 'W', surface });
    form.get(l).push({ result: 'L', surface });
  }

  return { elo, h2h, form };
}

async function ensureIndex(tour) {
  if (!RAW_BASE[tour]) return null;
  const cached = _index.get(tour);
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;

  const year = new Date().getUTCFullYear();
  try {
    const seasons = await Promise.allSettled([
      fetchSeason(tour, year),
      fetchSeason(tour, year - 1),
    ]);
    const matches = seasons
      .filter(s => s.status === 'fulfilled')
      .flatMap(s => s.value);
    if (!matches.length) throw new Error('no matches parsed');

    const built = { builtAt: Date.now(), ...buildIndexes(matches) };
    _index.set(tour, built);
    _status[tour] = { ok: true, builtAt: new Date().toISOString(), matches: matches.length, players: built.elo.size };
    console.log(`[tennis-elo] ${tour}: built from ${matches.length} matches, ${built.elo.size} players`);
    return built;
  } catch (err) {
    if (cached) {
      console.warn(`[tennis-elo] ${tour} rebuild failed, serving stale: ${err.message}`);
      return cached;
    }
    _status[tour] = { ok: false, builtAt: null, error: err.message };
    console.warn(`[tennis-elo] ${tour} unavailable: ${err.message}`);
    return null;
  }
}

// ── Public lookups ─────────────────────────────────────────────────────────────

export async function getSurfaceElo(tour, name, surface) {
  const idx = await ensureIndex(tour);
  if (!idx) return null;
  const e = idx.elo.get(normName(name));
  if (!e) return null;
  const surf = surface ? normalizeSurface(surface) : null;
  return {
    overall: Math.round(e.overall),
    surface: surf && e.surfaces[surf] != null ? Math.round(e.surfaces[surf]) : null,
  };
}

export async function getH2H(tour, nameA, nameB, surface) {
  const idx = await ensureIndex(tour);
  if (!idx) return null;
  const a = normName(nameA);
  const b = normName(nameB);
  if (!a || !b) return null;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const rec = idx.h2h.get(key);
  if (!rec) return { aWins: 0, bWins: 0, aWinsSurface: 0, bWinsSurface: 0 };
  const surf = surface ? normalizeSurface(surface) : null;
  const surfRec = surf ? (rec.surface[surf] ?? {}) : {};
  return {
    aWins: rec.wins[a] ?? 0,
    bWins: rec.wins[b] ?? 0,
    aWinsSurface: surfRec[a] ?? 0,
    bWinsSurface: surfRec[b] ?? 0,
  };
}

export async function getRecentForm(tour, name, surface) {
  const idx = await ensureIndex(tour);
  if (!idx) return null;
  const all = idx.form.get(normName(name));
  if (!all || !all.length) return null;
  const recent = all.slice(-RECENT_FORM_N);
  const wins = recent.filter(r => r.result === 'W').length;
  const losses = recent.length - wins;
  let surfaceRecord = null;
  if (surface) {
    const surf = normalizeSurface(surface);
    const sg = all.filter(r => r.surface === surf).slice(-RECENT_FORM_N);
    if (sg.length) {
      const sw = sg.filter(r => r.result === 'W').length;
      surfaceRecord = `${sw}-${sg.length - sw}`;
    }
  }
  return {
    record: `${wins}-${losses}`,
    recent: recent.map(r => r.result).join(''),
    surfaceRecord,
  };
}

export function getTennisEloStatus() {
  return { ..._status };
}

export default { getSurfaceElo, getH2H, getRecentForm, getTennisEloStatus };
