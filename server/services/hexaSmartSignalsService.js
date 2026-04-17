/**
 * hexaSmartSignalsService.js
 *
 * Pure rule-based signal generators for the H.E.X.A. Pizarra del Día.
 * No ML, no LLM — every signal is a deterministic function over MLB data.
 *
 * Each detector:
 *   - receives plain input (team object, lineup, game log, etc.)
 *   - returns an array of Signal objects (never throws, returns [] on missing data)
 *
 * Signal shape:
 *   {
 *     type:     'team_streak_hot' | 'team_streak_cold' | 'hot_offense' | 'cold_offense'
 *               | 'bullpen_heavy' | 'hit_streak' | 'cold_batter' | 'high_scoring_matchup',
 *     icon:     string (emoji),
 *     text:     { es: string, en: string },
 *     priority: number (0–100, higher = more relevant),
 *     meta:     { ...context-specific fields... }
 *   }
 *
 * Thresholds live in ./hexaThresholds.json so non-devs can tune them.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Thresholds loader ────────────────────────────────────────────────────────

let _cachedThresholds = null;
function loadThresholds() {
  if (_cachedThresholds) return _cachedThresholds;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'hexaThresholds.json'), 'utf-8');
    _cachedThresholds = JSON.parse(raw);
  } catch (err) {
    console.warn('[smart-signals] Could not load hexaThresholds.json, using safe defaults:', err.message);
    _cachedThresholds = SAFE_DEFAULTS;
  }
  return _cachedThresholds;
}

// Fallback if JSON is missing or malformed — keeps the app alive.
const SAFE_DEFAULTS = {
  team_streaks: { hot_streak_min_wins: 4, cold_streak_min_losses: 4, lookback_games: 10 },
  offense:      { hot_offense_window_games: 4, hot_offense_min_total_runs: 24, cold_offense_window_games: 3, cold_offense_max_total_runs: 5 },
  bullpen:      { bullpen_heavy_usage_min_pitchers: 6, bullpen_heavy_usage_min_ip_yesterday: 5 },
  batter:       { hit_streak_min_games: 3, hit_streak_lookback: 7, cold_batter_min_games_no_hit: 3, cold_batter_min_at_bats_per_game: 2, max_batters_per_team: 4 },
  matchup:      { high_scoring_min_team_runs_last3: 14 },
  output:       { max_insights: 30, priority_weights: {
    team_streak_hot: 90, team_streak_cold: 70, hot_offense: 85, cold_offense: 60,
    bullpen_heavy: 75, hit_streak: 80, cold_batter: 55, high_scoring_matchup: 95,
  } },
};

export function getThresholds() { return loadThresholds(); }

// ── Utility: weighted priority ───────────────────────────────────────────────

function priorityFor(type, boost = 0) {
  const base = loadThresholds().output?.priority_weights?.[type] ?? 50;
  return Math.min(100, Math.max(0, base + boost));
}

// ── Signal 1: Team win/loss streak ───────────────────────────────────────────

/**
 * @param {{id:number, teamName:string, teamAbbr:string}} team
 * @param {Array<{date, result:'W'|'L'}>} recentSchedule  — chronological (oldest → newest)
 */
export function detectTeamStreaks(team, recentSchedule) {
  if (!team?.teamName || !Array.isArray(recentSchedule) || recentSchedule.length === 0) return [];
  const cfg = loadThresholds().team_streaks;

  // Walk from newest backwards counting same-result run
  const newestFirst = [...recentSchedule].reverse();
  const first = newestFirst[0];
  if (!first?.result) return [];
  let streak = 0;
  for (const g of newestFirst) {
    if (g.result === first.result) streak++;
    else break;
  }

  const out = [];
  if (first.result === 'W' && streak >= cfg.hot_streak_min_wins) {
    out.push({
      type:     'team_streak_hot',
      icon:     '🔥',
      text: {
        es: `${team.teamName} llegan con ${streak} victorias seguidas`,
        en: `${team.teamName} come in on a ${streak}-game win streak`,
      },
      priority: priorityFor('team_streak_hot', Math.min(10, streak - cfg.hot_streak_min_wins)),
      meta:     { teamId: team.id, teamAbbr: team.teamAbbr, teamName: team.teamName, streak, type: 'wins' },
    });
  } else if (first.result === 'L' && streak >= cfg.cold_streak_min_losses) {
    out.push({
      type:     'team_streak_cold',
      icon:     '❄️',
      text: {
        es: `${team.teamName} encadenan ${streak} derrotas consecutivas`,
        en: `${team.teamName} have dropped ${streak} in a row`,
      },
      priority: priorityFor('team_streak_cold', Math.min(10, streak - cfg.cold_streak_min_losses)),
      meta:     { teamId: team.id, teamAbbr: team.teamAbbr, teamName: team.teamName, streak, type: 'losses' },
    });
  }
  return out;
}

// ── Signal 2 + 3: Hot / cold offense ─────────────────────────────────────────

/**
 * @param {{teamName, teamAbbr}} team
 * @param {Array<{date, scored:number}>} recentSchedule  — chronological
 */
export function detectHotOffense(team, recentSchedule) {
  if (!team?.teamName || !Array.isArray(recentSchedule)) return [];
  const cfg = loadThresholds().offense;
  const window = recentSchedule.slice(-cfg.hot_offense_window_games);
  if (window.length < cfg.hot_offense_window_games) return [];

  const totalRuns = window.reduce((s, g) => s + (g.scored ?? 0), 0);
  if (totalRuns < cfg.hot_offense_min_total_runs) return [];

  return [{
    type:     'hot_offense',
    icon:     '🔥',
    text: {
      es: `${team.teamName} han anotado ${totalRuns} carreras en sus últimos ${window.length} juegos`,
      en: `${team.teamName} have scored ${totalRuns} runs over their last ${window.length} games`,
    },
    priority: priorityFor('hot_offense'),
    meta:     { teamId: team.id, teamAbbr: team.teamAbbr, teamName: team.teamName, runs: totalRuns, games: window.length },
  }];
}

export function detectColdOffense(team, recentSchedule) {
  if (!team?.teamName || !Array.isArray(recentSchedule)) return [];
  const cfg = loadThresholds().offense;
  const window = recentSchedule.slice(-cfg.cold_offense_window_games);
  if (window.length < cfg.cold_offense_window_games) return [];

  const totalRuns = window.reduce((s, g) => s + (g.scored ?? 0), 0);
  if (totalRuns > cfg.cold_offense_max_total_runs) return [];

  return [{
    type:     'cold_offense',
    icon:     '❄️',
    text: {
      es: `${team.teamName} han producido poco: ${totalRuns} carreras en sus últimos ${window.length} juegos`,
      en: `${team.teamName} have been quiet: ${totalRuns} runs across their last ${window.length} games`,
    },
    priority: priorityFor('cold_offense'),
    meta:     { teamId: team.id, teamAbbr: team.teamAbbr, teamName: team.teamName, runs: totalRuns, games: window.length },
  }];
}

// ── Signal 4: Bullpen heavy usage ────────────────────────────────────────────

/**
 * @param {{teamName, teamAbbr}} team
 * @param {object} bullpenUsage — output of getBullpenUsage()
 */
export function detectBullpenFatigue(team, bullpenUsage) {
  if (!team?.teamName || !bullpenUsage) return [];
  const cfg = loadThresholds().bullpen;

  const relievers = Array.isArray(bullpenUsage.relievers) ? bullpenUsage.relievers : [];
  // "Yesterday's" usage = bullpenIP_1d + number of distinct relievers that appeared yesterday
  const yesterdayPitchers = relievers.filter(r =>
    (r.appearances ?? []).some(a => a.date === getYesterdayLocal())
  );
  const pitchersYesterday = yesterdayPitchers.length;
  const ipYesterday = Number(bullpenUsage.bullpenIP_1d ?? 0);

  const heavy = pitchersYesterday >= cfg.bullpen_heavy_usage_min_pitchers
             || ipYesterday        >= cfg.bullpen_heavy_usage_min_ip_yesterday;
  if (!heavy) return [];

  return [{
    type:     'bullpen_heavy',
    icon:     '⚠️',
    text: {
      es: `Bullpen de ${team.teamName} podría llegar exigido tras usar ${pitchersYesterday} pitcher(s) ayer`,
      en: `${team.teamName} bullpen may be taxed after using ${pitchersYesterday} pitcher(s) yesterday`,
    },
    priority: priorityFor('bullpen_heavy'),
    meta:     { teamId: team.id, teamAbbr: team.teamAbbr, teamName: team.teamName, pitchersYesterday, ipYesterday },
  }];
}

function getYesterdayLocal() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ── Signal 5: Batter hit streak ──────────────────────────────────────────────

/**
 * @param {{id, fullName, teamAbbr}} batter
 * @param {Array<{date, atBats, hits}>} gameLog  — chronological (oldest → newest)
 */
export function detectHitStreak(batter, gameLog) {
  if (!batter?.fullName || !Array.isArray(gameLog) || gameLog.length === 0) return [];
  const cfg = loadThresholds().batter;

  // Count consecutive games with >=1 hit starting from most recent game
  const newestFirst = [...gameLog].reverse();
  let streak = 0;
  for (const g of newestFirst) {
    if (g.atBats > 0 && g.hits >= 1) streak++;
    else break;
  }
  if (streak < cfg.hit_streak_min_games) return [];

  return [{
    type:     'hit_streak',
    icon:     '🎯',
    text: {
      es: `${batter.fullName} suma ${streak} juegos consecutivos con hit`,
      en: `${batter.fullName} has hit safely in ${streak} straight games`,
    },
    priority: priorityFor('hit_streak', Math.min(10, streak - cfg.hit_streak_min_games)),
    meta:     { playerId: batter.id, playerName: batter.fullName, teamId: batter.teamId, teamAbbr: batter.teamAbbr, streak },
  }];
}

// ── Signal 6: Cold batter ────────────────────────────────────────────────────

export function detectColdBatter(batter, gameLog) {
  if (!batter?.fullName || !Array.isArray(gameLog) || gameLog.length === 0) return [];
  const cfg = loadThresholds().batter;

  const newestFirst = [...gameLog].reverse();
  let slump = 0;
  for (const g of newestFirst) {
    if (g.atBats >= cfg.cold_batter_min_at_bats_per_game && g.hits === 0) slump++;
    else break;
  }
  if (slump < cfg.cold_batter_min_games_no_hit) return [];

  return [{
    type:     'cold_batter',
    icon:     '❄️',
    text: {
      es: `${batter.fullName} acumula ${slump} juegos sin hit`,
      en: `${batter.fullName} is hitless across his last ${slump} games`,
    },
    priority: priorityFor('cold_batter'),
    meta:     { playerId: batter.id, playerName: batter.fullName, teamId: batter.teamId, teamAbbr: batter.teamAbbr, slump },
  }];
}

// ── Signal 7: High-scoring matchup candidate ─────────────────────────────────

/**
 * A matchup is flagged when BOTH teams average high run production recently
 * OR one has a hot offense AND the other has a fatigued bullpen.
 *
 * @param {{home:{teamName, teamAbbr, recent}, away:{teamName, teamAbbr, recent}}} bundle
 * @param {{home:{pitchersYesterday:number}|null, away:{pitchersYesterday:number}|null}} bullpens
 */
export function detectHighScoringMatchup(bundle, bullpens = {}) {
  if (!bundle?.home?.teamName || !bundle?.away?.teamName) return [];
  const cfg = loadThresholds().matchup;
  const offenseCfg = loadThresholds().offense;
  const bullpenCfg = loadThresholds().bullpen;

  const last3 = (schedule = []) =>
    schedule.slice(-3).reduce((s, g) => s + (g.scored ?? 0), 0);

  const homeLast3 = last3(bundle.home.recent);
  const awayLast3 = last3(bundle.away.recent);

  const bothHot = homeLast3 >= cfg.high_scoring_min_team_runs_last3
               && awayLast3 >= cfg.high_scoring_min_team_runs_last3;

  const homeHotOpp = awayLast3 >= offenseCfg.hot_offense_min_total_runs - 4
                  && (bullpens?.home?.pitchersYesterday ?? 0) >= bullpenCfg.bullpen_heavy_usage_min_pitchers;
  const awayHotOpp = homeLast3 >= offenseCfg.hot_offense_min_total_runs - 4
                  && (bullpens?.away?.pitchersYesterday ?? 0) >= bullpenCfg.bullpen_heavy_usage_min_pitchers;

  if (!bothHot && !homeHotOpp && !awayHotOpp) return [];

  return [{
    type:     'high_scoring_matchup',
    icon:     '🎯',
    text: {
      es: `${bundle.away.teamName} vs ${bundle.home.teamName} perfila como juego de alta producción`,
      en: `${bundle.away.teamName} vs ${bundle.home.teamName} shapes up as a high-scoring matchup`,
    },
    priority: priorityFor('high_scoring_matchup'),
    meta:     {
      homeId:   bundle.home.id,
      awayId:   bundle.away.id,
      homeName: bundle.home.teamName,
      awayName: bundle.away.teamName,
      awayAbbr: bundle.away.teamAbbr,
      homeAbbr: bundle.home.teamAbbr,
      homeLast3,
      awayLast3,
    },
  }];
}

// ── Aggregator: rank + trim ──────────────────────────────────────────────────

/**
 * Sorts signals by priority (desc) and trims to max_insights.
 * Also de-duplicates identical (type, teamAbbr, playerId) combinations.
 */
export function rankAndTrim(signals) {
  const cfg = loadThresholds().output;
  const seen = new Set();
  const deduped = [];
  for (const s of signals) {
    if (!s) continue;
    const key = `${s.type}:${s.meta?.teamAbbr ?? ''}:${s.meta?.playerId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  deduped.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return deduped.slice(0, cfg.max_insights);
}
