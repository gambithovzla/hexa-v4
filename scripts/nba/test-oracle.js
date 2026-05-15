#!/usr/bin/env node
/**
 * test-oracle.js — manual harness for iterating on the NBA Oracle prompt.
 *
 * Pulls real games and team stats from stats.nba.com, builds the deterministic
 * context payload, and prints both:
 *   (1) the exact text block the LLM sees (so you can audit what's getting
 *       serialised)
 *   (2) the raw LLM response and parsed JSON (so you can audit pick quality,
 *       confidence calibration, JSON shape compliance, Spanish translation,
 *       Kelly math, etc.)
 *
 * Usage:
 *   node --env-file=.env scripts/nba/test-oracle.js                       # list today's NBA games
 *   node --env-file=.env scripts/nba/test-oracle.js --date=2026-05-14     # list games for a date
 *   node --env-file=.env scripts/nba/test-oracle.js --game=0042500301     # run Oracle on that game
 *   node --env-file=.env scripts/nba/test-oracle.js --game=0042500301 --lang=es
 *   node --env-file=.env scripts/nba/test-oracle.js --game=0042500301 --bankroll=500
 *   node --env-file=.env scripts/nba/test-oracle.js --game=0042500301 --engine=premium
 *   node --env-file=.env scripts/nba/test-oracle.js --chat="¿Cubre BOS el spread?" --game=0042500301
 *
 * Flags:
 *   --date=YYYY-MM-DD   defaults to today (in local TZ)
 *   --game=GAME_ID      NBA game_id from the listing — required to run Oracle
 *   --lang=es|en        defaults to en
 *   --engine=deep|premium|haiku   defaults to deep (Sonnet 4.6)
 *   --bankroll=N        triggers Kelly stake calculation in the output
 *   --chat="question"   switches to chat mode instead of single-game pick
 *   --json-only         suppresses the serialised context — just shows JSON
 *
 * This script does NOT write to the database. It does NOT publish anywhere.
 * It exists purely to iterate on the prompt before wiring infrastructure.
 */

import 'dotenv/config';
import { getNbaGamesForDate } from '../../server/nba-api.js';
import { buildNbaGameContext } from '../../server/nba-context-builder.js';
import {
  analyzeNbaChat,
  analyzeNbaGame,
  serializeNbaContext,
} from '../../server/services/oracleNba.js';

// ── arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

function todayInIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function pad(str, n) {
  const s = String(str ?? '');
  if (s.length >= n) return s;
  return s + ' '.repeat(n - s.length);
}

function fmtUsd(n) {
  return `$${Number(n).toFixed(2)}`;
}

function estimateCost(usage, modelId) {
  // Anthropic pricing snapshot (per million tokens). Approximate; for orientation only.
  const pricing = {
    'claude-opus-4-7':            { input: 15, output: 75 },
    'claude-sonnet-4-6':          { input: 3,  output: 15 },
    'claude-haiku-4-5-20251001':  { input: 0.8, output: 4 },
  };
  const p = pricing[modelId];
  if (!p || !usage) return null;
  const inTok  = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const cost   = (inTok / 1_000_000) * p.input + (outTok / 1_000_000) * p.output;
  return { inTok, outTok, cost };
}

function divider(label) {
  const line = '─'.repeat(78);
  if (!label) return line;
  return `\n${line}\n  ${label}\n${line}`;
}

// ── modes ─────────────────────────────────────────────────────────────────────

async function modeList(date) {
  const games = await getNbaGamesForDate(date);
  if (games.length === 0) {
    console.log(`No NBA games on ${date} (off-day, off-season, or API returned empty).`);
    console.log('Tip: try a date during regular season (Oct-Apr) or playoffs (Apr-Jun).');
    return;
  }
  console.log(`\n${games.length} NBA game(s) on ${date}:\n`);
  console.log(`  ${pad('GAME_ID', 14)} ${pad('STATUS', 22)} ${pad('AWAY', 22)} @ ${pad('HOME', 22)} SCORE`);
  console.log(`  ${'-'.repeat(14)} ${'-'.repeat(22)} ${'-'.repeat(22)} - ${'-'.repeat(22)} -----`);
  for (const g of games) {
    const away = `${g.away_team_abbr ?? '?'} (${g.away_team_id})`;
    const home = `${g.home_team_abbr ?? '?'} (${g.home_team_id})`;
    const score = g.away_score != null && g.home_score != null
      ? `${g.away_score}-${g.home_score}`
      : '—';
    console.log(`  ${pad(g.game_id, 14)} ${pad(g.status ?? '?', 22)} ${pad(away, 22)} @ ${pad(home, 22)} ${score}`);
  }
  console.log('\nRun with: --game=GAME_ID  to invoke the Oracle on a specific game.\n');
}

async function modeAnalyze({ date, gameId, lang, engine, bankroll, jsonOnly }) {
  const games = await getNbaGamesForDate(date);
  const game = games.find(g => g.game_id === gameId);
  if (!game) {
    console.error(`Game ${gameId} not found on ${date}. Run without --game to list available games.`);
    process.exitCode = 1;
    return;
  }

  console.log(divider('GAME'));
  console.log(`  ${game.away_team_abbr} @ ${game.home_team_abbr}  —  ${date}  —  ${game.status}`);
  console.log(`  Arena: ${game.arena ?? 'n/a'}  |  TV: ${game.national_tv ?? 'none'}  |  Game ID: ${game.game_id}`);

  console.log(divider('Building context (NBA Stats API → buildNbaGameContext)...'));
  const t0 = Date.now();
  const context = await buildNbaGameContext({
    homeTeamId: game.home_team_id,
    awayTeamId: game.away_team_id,
    gameDate: date,
    season: game.season,
  });
  console.log(`  Context built in ${Date.now() - t0}ms.`);

  if (!jsonOnly) {
    console.log(divider('SERIALISED CONTEXT (what the LLM sees)'));
    console.log(serializeNbaContext({ context }));
  }

  console.log(divider(`Calling Anthropic (engine=${engine}, lang=${lang}${bankroll ? `, bankroll=$${bankroll}` : ''})...`));
  const gameDescription = `${game.away_team_abbr} @ ${game.home_team_abbr} — ${date}`;
  const t1 = Date.now();
  const result = await analyzeNbaGame({
    context,
    gameDescription,
    lang,
    engine,
    userBankroll: bankroll ? Number(bankroll) : undefined,
  });
  const ms = Date.now() - t1;
  console.log(`  LLM call: ${ms}ms  |  model: ${result.model}  |  stop_reason: ${result.stopReason}`);

  const cost = estimateCost(result.usage, result.model);
  if (cost) {
    console.log(`  Tokens: ${cost.inTok} in / ${cost.outTok} out  |  Approx cost: ${fmtUsd(cost.cost)}`);
  }

  if (result.parseError) {
    console.log(divider('JSON PARSE ERROR — raw output below'));
    console.log(result.rawText);
    process.exitCode = 2;
    return;
  }

  console.log(divider('RAW LLM TEXT'));
  console.log(result.rawText);

  console.log(divider('PARSED JSON'));
  console.log(JSON.stringify(result.data, null, 2));

  // ── prompt-discipline sanity checks ────────────────────────────────────────
  console.log(divider('PROMPT-DISCIPLINE CHECKS'));
  const data = result.data ?? {};
  const conf = data.master_prediction?.oracle_confidence;
  const inRange = typeof conf === 'number' && conf >= 50 && conf <= 78;
  console.log(`  oracle_confidence (50-78):  ${inRange ? 'OK' : 'FAIL'}  (${conf})`);

  const bestConf = data.best_pick?.confidence;
  const matchesMaster = typeof conf === 'number' && typeof bestConf === 'number'
    && Math.abs(bestConf * 100 - conf) < 0.5;
  console.log(`  best_pick.confidence == oracle_confidence/100:  ${matchesMaster ? 'OK' : 'FAIL'}  (${bestConf})`);

  const validRisks = ['low', 'medium', 'high'];
  console.log(`  model_risk valid:  ${validRisks.includes(data.model_risk) ? 'OK' : 'FAIL'}  (${data.model_risk})`);

  const validValues = ['HIGH VALUE', 'MODERATE VALUE', 'MARGINAL VALUE', 'NO VALUE'];
  console.log(`  bet_value valid:   ${validValues.includes(data.master_prediction?.bet_value) ? 'OK' : 'FAIL'}  (${data.master_prediction?.bet_value})`);

  const validTypes = ['Moneyline', 'Spread', 'Total', 'PlayerProp'];
  console.log(`  best_pick.type valid:  ${validTypes.includes(data.best_pick?.type) ? 'OK' : 'FAIL'}  (${data.best_pick?.type})`);

  const reportLen = String(data.oracle_report ?? '').length;
  console.log(`  oracle_report length (700-900):  ${reportLen >= 600 && reportLen <= 1100 ? 'OK' : 'WARN'}  (${reportLen} chars)`);

  const hunchLen = String(data.hexa_hunch ?? '').length;
  console.log(`  hexa_hunch length (<150):  ${hunchLen <= 150 ? 'OK' : 'WARN'}  (${hunchLen} chars)`);

  const probSum = (data.probability_model?.home_wins ?? 0) + (data.probability_model?.away_wins ?? 0);
  console.log(`  probability_model sum ≈ 10000:  ${Math.abs(probSum - 10000) <= 50 ? 'OK' : 'WARN'}  (${probSum})`);

  if (bankroll) {
    const hasKelly = typeof data.kelly_recommendation === 'string' && data.kelly_recommendation.length > 0;
    console.log(`  kelly_recommendation present (bankroll provided):  ${hasKelly ? 'OK' : 'FAIL'}`);
  }

  // Anti-hallucination: if best_pick.type is PlayerProp but no player data in context, warn.
  if (data.best_pick?.type === 'PlayerProp') {
    console.log(`  WARN: PlayerProp recommended. Verify no player names were fabricated.`);
  }

  console.log('');
}

async function modeChat({ date, gameId, question, lang }) {
  const games = await getNbaGamesForDate(date);
  const game = games.find(g => g.game_id === gameId);
  if (!game) {
    console.error(`Game ${gameId} not found on ${date}.`);
    process.exitCode = 1;
    return;
  }

  const context = await buildNbaGameContext({
    homeTeamId: game.home_team_id,
    awayTeamId: game.away_team_id,
    gameDate: date,
    season: game.season,
  });

  console.log(divider('CHAT MODE'));
  console.log(`  Game: ${game.away_team_abbr} @ ${game.home_team_abbr}  —  ${date}`);
  console.log(`  Question: ${question}`);

  const result = await analyzeNbaChat({
    context,
    gameDescription: `${game.away_team_abbr} @ ${game.home_team_abbr} — ${date}`,
    question,
    lang,
  });

  const cost = estimateCost(result.usage, result.model);
  if (cost) {
    console.log(`  Model: ${result.model}  |  Tokens: ${cost.inTok}/${cost.outTok}  |  Cost: ${fmtUsd(cost.cost)}`);
  }
  console.log(divider('CHAT RESPONSE'));
  console.log(result.text);
  console.log('');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set. Use --env-file=.env or export it.');
    process.exit(1);
  }

  const date = args.date || todayInIsoDate();
  const lang = args.lang === 'es' ? 'es' : 'en';
  const engine = ['deep', 'premium', 'haiku'].includes(args.engine) ? args.engine : 'deep';

  if (args.chat && args.game) {
    await modeChat({ date, gameId: args.game, question: args.chat, lang });
    return;
  }

  if (args.game) {
    await modeAnalyze({
      date,
      gameId: args.game,
      lang,
      engine,
      bankroll: args.bankroll,
      jsonOnly: !!args['json-only'],
    });
    return;
  }

  await modeList(date);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
