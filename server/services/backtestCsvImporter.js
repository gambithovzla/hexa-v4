/**
 * backtestCsvImporter.js — Import historical picks from CSV for A/B testing (A7).
 *
 * Accepts CSV with columns (case-insensitive, flexible order):
 *   matchup    — e.g. "NYY @ BOS"
 *   pick       — e.g. "NYY ML" or "Over 8.5"
 *   home_score — numeric
 *   away_score — numeric
 *   game_date  — YYYY-MM-DD  (optional)
 *   confidence — optional 0.0-1.0 or 0-100
 *   notes      — optional free text
 *
 * The importer:
 * 1. Parses the CSV (no external deps)
 * 2. Resolves each pick against provided scores via resolvePickFromFinalState
 * 3. Writes rows to `csv_backtest_runs` table (source-tagged)
 * 4. Returns a summary { imported, wins, losses, pushes, errors[], roi }
 *
 * Endpoint: POST /api/admin/backtest/import-csv
 * Body: { csv: string, label?: string, dryRun?: boolean }
 */

import pool from '../db.js';
import { resolvePickFromFinalState } from '../pick-resolver.js';

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  function splitLine(line) {
    const fields = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = splitLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i]);
    if (values.every(v => !v)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = values[idx] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

function buildGameForResolver(row) {
  const homeScore = parseFloat(row.home_score ?? row.home ?? 0) || 0;
  const awayScore = parseFloat(row.away_score ?? row.away ?? 0) || 0;
  const parts = String(row.matchup ?? '').split(/\s+[@vs.]+\s+/i);
  const awayTeam = parts[0]?.trim() ?? '';
  const homeTeam = parts[1]?.trim() ?? '';

  return {
    teams: {
      home: { name: homeTeam, abbreviation: homeTeam, score: homeScore },
      away: { name: awayTeam, abbreviation: awayTeam, score: awayScore },
    },
    status: { simplified: 'final' },
    gamePk: null,
  };
}

/**
 * Import a CSV of historical picks and evaluate win/loss/push.
 *
 * @param {{ csv: string, label?: string, dryRun?: boolean }} opts
 */
export async function importBacktestCsv({ csv, label = 'csv_import', dryRun = false }) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error('CSV is empty or has no data rows');

  const summary = { imported: 0, wins: 0, losses: 0, pushes: 0, errors: [], dryRun, label };
  const runId = `${label}_${Date.now()}`;
  const toInsert = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 2;

    const matchup = row.matchup?.trim();
    const pick = row.pick?.trim();
    const gameDate = row.game_date?.trim() || null;

    if (!matchup || !pick) {
      summary.errors.push(`Row ${lineNum}: missing matchup or pick`);
      continue;
    }

    const game = buildGameForResolver(row);
    const { result } = resolvePickFromFinalState(pick, game);

    if (!result) {
      summary.errors.push(`Row ${lineNum}: could not resolve "${pick}" for "${matchup}" (scores: ${row.home_score ?? '?'}-${row.away_score ?? '?'})`);
      continue;
    }

    let confidence = null;
    if (row.confidence) {
      const raw = parseFloat(row.confidence);
      confidence = raw > 1 ? raw / 100 : raw;
    }

    toInsert.push({
      run_id: runId,
      matchup,
      pick,
      result,
      home_score: parseFloat(row.home_score ?? 0) || 0,
      away_score: parseFloat(row.away_score ?? 0) || 0,
      game_date: gameDate,
      confidence,
      notes: row.notes?.trim() || null,
    });

    if (result === 'win') summary.wins++;
    else if (result === 'loss') summary.losses++;
    else summary.pushes++;
    summary.imported++;
  }

  const total = summary.wins + summary.losses + summary.pushes;
  summary.roi = total > 0 ? Math.round(((summary.wins - summary.losses) / total) * 100) / 100 : null;

  if (!dryRun && toInsert.length > 0) {
    for (const r of toInsert) {
      await pool.query(
        `INSERT INTO csv_backtest_runs
           (run_id, matchup, pick, result, home_score, away_score, game_date, confidence, notes, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [r.run_id, r.matchup, r.pick, r.result, r.home_score, r.away_score, r.game_date, r.confidence, r.notes]
      );
    }
    summary.run_id = runId;
  }

  return summary;
}

/**
 * List past CSV backtest runs with aggregated stats.
 */
export async function listCsvBacktestRuns({ limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT
       run_id,
       MIN(created_at) AS imported_at,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE result = 'win') AS wins,
       COUNT(*) FILTER (WHERE result = 'loss') AS losses,
       COUNT(*) FILTER (WHERE result = 'push') AS pushes
     FROM csv_backtest_runs
     GROUP BY run_id
     ORDER BY MIN(created_at) DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    ...r,
    roi: r.total > 0 ? Math.round(((r.wins - r.losses) / r.total) * 100) / 100 : null,
  }));
}
