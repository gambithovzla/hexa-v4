/**
 * run-backtest.js — Runs Oracle analysis against historical games and saves results
 *
 * Usage: node scripts/training/run-backtest.js 2026-04-01 [--dry-run] [--max=5] [--delay=5000]
 *
 * Prerequisites:
 *   - Server must be running (uses the API endpoints)
 *   - Admin JWT token in environment variable HEXA_ADMIN_TOKEN
 *   - Database must have backtest_results table
 *
 * Flow:
 *   1. Fetch completed games for target date (via historical-fetcher logic)
 *   2. For each game, call POST /api/analyze/safe (Safe Pick mode, 0 credits for admin)
 *   3. Parse Oracle response and compare pick against actual result
 *   4. Save to backtest_results table
 *
 * Safety:
 *   - Uses Safe Pick mode only (cheapest, most consistent)
 *   - Processes in batches of 3 with delay between batches
 *   - Never touches the picks table
 *   - Dry-run mode available for testing
 */

import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const API_URL = process.env.API_URL || 'https://hexa-v4-production.up.railway.app';
const ADMIN_TOKEN = process.env.HEXA_ADMIN_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const targetDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const dryRun = args.includes('--dry-run');
const maxGames = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] ?? '50');
const batchDelay = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] ?? '5000');

if (!targetDate) {
  console.error('Usage: node scripts/training/run-backtest.js YYYY-MM-DD [--dry-run] [--max=5] [--delay=5000]');
  process.exit(1);
}

if (!ADMIN_TOKEN) {
  console.error('Error: HEXA_ADMIN_TOKEN environment variable required');
  console.error('Get it by logging into hexaoracle.lat and copying the token from localStorage');
  process.exit(1);
}

// ── Generate unique run ID ────────────────────────────────────────────────────
const runId = `bt-${targetDate}-${Date.now().toString(36)}`;
console.log(`\n[backtest] Run ID: ${runId}`);
console.log(`[backtest] Target date: ${targetDate}`);
console.log(`[backtest] Max games: ${maxGames}`);
console.log(`[backtest] Batch delay: ${batchDelay}ms`);
console.log(`[backtest] Dry run: ${dryRun}`);
console.log(`[backtest] API: ${API_URL}\n`);

// ── Fetch completed games ─────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API ${res.status}: ${url}`);
  return res.json();
}

async function getCompletedGames(date) {
  const url = `${MLB_BASE}/schedule?date=${date}&sportId=1&hydrate=team,linescore,probablePitcher`;
  const data = await fetchJSON(url);
  const games = [];
  for (const dateObj of data.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const status = game.status?.detailedState ?? '';
      if (!status.toLowerCase().includes('final')) continue;
      const home = game.teams?.home;
      const away = game.teams?.away;
      games.push({
        gamePk: game.gamePk,
        home: { name: home?.team?.name, abbreviation: home?.team?.abbreviation, score: home?.score ?? 0 },
        away: { name: away?.team?.name, abbreviation: away?.team?.abbreviation, score: away?.score ?? 0 },
        totalRuns: (home?.score ?? 0) + (away?.score ?? 0),
      });
    }
  }
  return games;
}

// ── Call Oracle Safe Pick ─────────────────────────────────────────────────────
async function analyzeGame(gamePk, date) {
  const start = Date.now();
  const res = await fetch(`${API_URL}/api/analyze/safe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ gameId: gamePk, date, lang: 'en' }),
  });
  const json = await res.json();
  const latency = Date.now() - start;
  return { ...json, latency_ms: latency };
}

// ── Resolve pick against actual result ────────────────────────────────────────
function resolveResult(pickStr, game) {
  if (!pickStr) return null;
  const s = pickStr.trim();
  const homeScore = game.home.score;
  const awayScore = game.away.score;
  const total = homeScore + awayScore;

  // Over/Under
  let m = s.match(/(?:Over|O|M[aá]s\s+de)\s+(\d+\.?\d*)/i);
  if (m) { const line = parseFloat(m[1]); return total > line ? 'win' : total < line ? 'loss' : 'push'; }
  m = s.match(/(?:Under|U|Menos\s+de)\s+(\d+\.?\d*)/i);
  if (m) { const line = parseFloat(m[1]); return total < line ? 'win' : total > line ? 'loss' : 'push'; }

  // Moneyline
  if (/moneyline|ml|a ganar|dinero/i.test(s)) {
    const teamToken = s.replace(/\s*(moneyline|ml|a ganar|dinero)\s*/gi, '').trim().toLowerCase();
    const pickedHome = game.home.abbreviation.toLowerCase() === teamToken ||
                       game.home.name.toLowerCase().includes(teamToken);
    const pickedAway = game.away.abbreviation.toLowerCase() === teamToken ||
                       game.away.name.toLowerCase().includes(teamToken);
    if (pickedHome) return homeScore > awayScore ? 'win' : homeScore < awayScore ? 'loss' : 'push';
    if (pickedAway) return awayScore > homeScore ? 'win' : awayScore < homeScore ? 'loss' : 'push';
  }

  // Run Line
  m = s.match(/(.+?)\s+([+-]\d+\.?\d*)\s*(?:run\s*line|rl)/i);
  if (m) {
    const teamToken = m[1].trim().toLowerCase();
    const line = parseFloat(m[2]);
    const pickedHome = game.home.abbreviation.toLowerCase() === teamToken ||
                       game.home.name.toLowerCase().includes(teamToken);
    const score = pickedHome ? homeScore - awayScore : awayScore - homeScore;
    const adjusted = score + line;
    return adjusted > 0 ? 'win' : adjusted < 0 ? 'loss' : 'push';
  }

  return null; // Could not parse (e.g., player props)
}

// ── Main execution ────────────────────────────────────────────────────────────
async function main() {
  console.log('[backtest] Fetching completed games...');
  const games = await getCompletedGames(targetDate);
  console.log(`[backtest] Found ${games.length} completed games for ${targetDate}`);

  if (games.length === 0) {
    console.log('[backtest] No completed games found. Exiting.');
    process.exit(0);
  }

  const toProcess = games.slice(0, maxGames);
  console.log(`[backtest] Processing ${toProcess.length} games\n`);

  const pool = dryRun ? null : new Pool({ connectionString: DATABASE_URL });
  const results = { total: 0, wins: 0, losses: 0, pushes: 0, errors: 0, unresolved: 0 };

  // Process in batches of 3
  for (let i = 0; i < toProcess.length; i += 3) {
    const batch = toProcess.slice(i, i + 3);

    const batchResults = await Promise.allSettled(
      batch.map(async (game) => {
        const matchup = `${game.away.abbreviation} vs ${game.home.abbreviation}`;
        console.log(`[backtest] Analyzing: ${matchup} (gamePk: ${game.gamePk})`);

        try {
          const analysis = await analyzeGame(game.gamePk, targetDate);

          if (!analysis.success) {
            console.log(`  x Analysis failed: ${analysis.error}`);
            results.errors++;
            return;
          }

          // Extract pick from safe_pick response
          const safePick = analysis.data?.safe_pick;
          const pick = safePick?.pick ?? null;
          const confidence = safePick?.hit_probability ?? safePick?.confidence ?? null;
          const betValue = analysis.data?.bet_value ?? null;
          const modelRisk = analysis.data?.model_risk ?? null;

          // Resolve against actual result
          const actualResult = pick ? resolveResult(pick, game) : null;

          console.log(`  -> Pick: ${pick ?? 'N/A'}`);
          console.log(`  -> Confidence: ${confidence ?? 'N/A'}%`);
          console.log(`  -> Actual: ${game.away.abbreviation} ${game.away.score} - ${game.home.abbreviation} ${game.home.score} (total: ${game.totalRuns})`);
          console.log(`  -> Result: ${actualResult?.toUpperCase() ?? 'UNRESOLVED'}`);

          results.total++;
          if (actualResult === 'win') results.wins++;
          else if (actualResult === 'loss') results.losses++;
          else if (actualResult === 'push') results.pushes++;
          else results.unresolved++;

          // Save to DB (skip in dry-run)
          if (!dryRun && pool) {
            await pool.query(`
              INSERT INTO backtest_results (run_id, historical_date, game_pk, matchup, home_team, away_team,
                pick, oracle_confidence, bet_value, model_risk, pick_type,
                actual_home_score, actual_away_score, actual_result, model, latency_ms)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
              ON CONFLICT (run_id, game_pk, pick_type) DO NOTHING
            `, [
              runId, targetDate, game.gamePk, matchup,
              game.home.name, game.away.name,
              pick, confidence, betValue, modelRisk, 'safe',
              game.home.score, game.away.score, actualResult,
              'deep', analysis.latency_ms,
            ]);
          }
        } catch (err) {
          console.log(`  x Error: ${err.message}`);
          results.errors++;
        }
      })
    );

    // Delay between batches (except last)
    if (i + 3 < toProcess.length) {
      console.log(`\n[backtest] Batch complete. Waiting ${batchDelay / 1000}s...\n`);
      await new Promise(r => setTimeout(r, batchDelay));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`[backtest] RESULTS for ${targetDate}`);
  console.log(`  Run ID:     ${runId}`);
  console.log(`  Total:      ${results.total}`);
  console.log(`  Wins:       ${results.wins}`);
  console.log(`  Losses:     ${results.losses}`);
  console.log(`  Pushes:     ${results.pushes}`);
  console.log(`  Unresolved: ${results.unresolved}`);
  console.log(`  Errors:     ${results.errors}`);
  if (results.total > 0) {
    const resolved = results.wins + results.losses;
    const winRate = resolved > 0 ? ((results.wins / resolved) * 100).toFixed(1) : 'N/A';
    console.log(`  Win Rate:   ${winRate}%`);
  }
  console.log('='.repeat(50));

  if (pool) await pool.end();
}

main().catch(err => {
  console.error('[backtest] Fatal error:', err.message);
  process.exit(1);
});
