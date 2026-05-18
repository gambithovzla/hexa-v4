#!/usr/bin/env node
/**
 * Recompute hexa_insights.week_start using Lima calendar (America/Lima).
 * Fixes rows assigned with UTC toISOString() (e.g. Sunday 7pm Lima → wrong next week).
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-insights-week-start.js
 *   node --env-file=.env scripts/backfill-insights-week-start.js --dry-run
 */

import pool from '../server/db.js';
import { getLimaWeekStart, normalizeDateKey } from '../server/utils/dateKeys.js';

const dryRun = process.argv.includes('--dry-run');
const auditUtc = process.argv.includes('--audit-utc');

function oldUtcWeekStart(value) {
  const raw = String(value ?? '').trim();
  let dateKey = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  if (!dateKey) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) dateKey = parsed.toISOString().slice(0, 10);
  }
  if (!dateKey) return null;
  const d = new Date(`${dateKey}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function resolveInsightAnchorDate(row) {
  return (
    normalizeDateKey(row.pick_game_date)
    ?? normalizeDateKey(row.pick_data?.game_date)
    ?? normalizeDateKey(row.created_at)
  );
}

const { rows } = await pool.query(
  `SELECT
     i.id,
     i.week_start::text AS week_start,
     i.pick_id,
     i.pick_data,
     i.created_at,
     p.game_date::text AS pick_game_date
   FROM hexa_insights i
   LEFT JOIN picks p ON p.id = i.pick_id
   WHERE i.deleted_at IS NULL
   ORDER BY i.id ASC`
);

let updated = 0;
let unchanged = 0;
const changes = [];

for (const row of rows) {
  const anchor = resolveInsightAnchorDate(row);
  if (!anchor) {
    unchanged++;
    continue;
  }

  const correct = getLimaWeekStart(anchor);
  const current = String(row.week_start).slice(0, 10);

  if (current === correct) {
    unchanged++;
    continue;
  }

  changes.push({
    id: row.id,
    pick_id: row.pick_id,
    anchor,
    from: current,
    to: correct,
  });

  if (!dryRun) {
    await pool.query(
      `UPDATE hexa_insights SET week_start = $1::date WHERE id = $2`,
      [correct, row.id]
    );
  }
  updated++;
}

console.log(`[backfill-insights-week] dry_run=${dryRun} scanned=${rows.length} updated=${updated} unchanged=${unchanged}`);

if (changes.length) {
  console.log('[backfill-insights-week] changes:');
  for (const c of changes) {
    console.log(`  #${c.id} pick=${c.pick_id ?? '—'} anchor=${c.anchor} ${c.from} → ${c.to}`);
  }
} else {
  console.log('[backfill-insights-week] all week_start values already correct');
}

if (auditUtc) {
  let utcWrong = 0;
  for (const row of rows) {
    const anchor = resolveInsightAnchorDate(row);
    if (!anchor) continue;
    const stored = String(row.week_start).slice(0, 10);
    const lima = getLimaWeekStart(anchor);
    const utc = oldUtcWeekStart(row.pick_game_date ?? row.pick_data?.game_date ?? row.created_at);
    if (stored === utc && stored !== lima) {
      utcWrong++;
      console.log(`  [audit] #${row.id} stored=${stored} lima_should=${lima} anchor=${anchor}`);
    }
  }
  console.log(`[backfill-insights-week] audit: ${utcWrong} row(s) match old UTC bug pattern`);
}

await pool.end();
