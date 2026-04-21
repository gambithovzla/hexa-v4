import pool from '../db.js';

const AUTO_EXPLANATION = 'AUTO_PUBLISHED_WIN';

function normalizeDateKey(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function getWeekStart(value = new Date()) {
  const dateKey = normalizeDateKey(value) ?? new Date().toISOString().slice(0, 10);
  const d = new Date(`${dateKey}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function parseJsonMaybe(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeLooseText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\s*\([^)]*\))+\s*$/g, '')
    .replace(/[^a-z0-9+.\-@\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDedupeKey(pick) {
  const pickKey = normalizeLooseText(pick?.pick);
  if (!pickKey) return null;

  const gameKey = pick?.game_pk != null
    ? `game:${pick.game_pk}`
    : `matchup:${normalizeLooseText(pick?.matchup)}:${normalizeDateKey(pick?.game_date ?? pick?.created_at) ?? 'unknown'}`;

  return `${gameKey}|pick:${pickKey}`;
}

function buildPickData(pick) {
  return {
    auto_published: true,
    source: 'resolver_win',
    matchup: pick.matchup ?? '',
    pick: pick.pick ?? '',
    oracle_confidence: pick.oracle_confidence ?? null,
    bet_value: pick.bet_value ?? null,
    game_date: normalizeDateKey(pick.game_date),
    game_pk: pick.game_pk ?? null,
    type: pick.type ?? null,
    best_pick: parseJsonMaybe(pick.best_pick, {}) ?? {},
    value_breakdown: parseJsonMaybe(pick.value_breakdown, null),
  };
}

async function fetchPickById(pickId, client = pool) {
  const { rows } = await client.query(
    `SELECT
       id,
       type,
       matchup,
       pick,
       oracle_confidence,
       bet_value,
       best_pick,
       value_breakdown,
       result,
       game_pk,
       game_date,
       created_at
     FROM picks
     WHERE id = $1
     LIMIT 1`,
    [pickId]
  );

  return rows[0] ?? null;
}

export async function publishWinningInsightFromPick(pick, client = pool) {
  if (!pick || pick.result !== 'win') {
    return { success: false, reason: 'not-win' };
  }

  const title = String(pick.pick ?? '').trim();
  if (!title) {
    return { success: false, reason: 'missing-pick-title' };
  }

  const weekStart = getWeekStart(pick.game_date ?? pick.created_at);
  const dedupeKey = buildDedupeKey(pick);
  if (!dedupeKey) {
    return { success: false, reason: 'missing-dedupe-key' };
  }

  const pickData = buildPickData(pick);
  const matchup = pickData.matchup ?? '';
  const { rows: existingRows } = await client.query(
    `SELECT id
     FROM hexa_insights
     WHERE deleted_at IS NULL
       AND (
         dedupe_key = $1
         OR ($2::int IS NOT NULL AND pick_id = $2)
         OR (
           week_start = $3
           AND lower(trim(title)) = lower(trim($4))
           AND COALESCE(pick_data->>'matchup', '') = $5
         )
       )
     LIMIT 1`,
    [dedupeKey, pick.id ?? null, weekStart, title, matchup]
  );

  if (existingRows.length > 0) {
    return { success: true, published: false, reason: 'duplicate', insightId: existingRows[0].id };
  }

  const { rows } = await client.query(
    `INSERT INTO hexa_insights (type, title, explanation, pick_id, pick_data, week_start, dedupe_key)
     VALUES ('acierto', $1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING *`,
    [title, AUTO_EXPLANATION, pick.id ?? null, JSON.stringify(pickData), weekStart, dedupeKey]
  );

  if (!rows.length) {
    return { success: true, published: false, reason: 'duplicate-race' };
  }

  return { success: true, published: true, insight: rows[0] };
}

export async function publishWinningInsightByPickId(pickId, client = pool) {
  const pick = await fetchPickById(pickId, client);
  if (!pick) {
    return { success: false, reason: 'pick-not-found' };
  }

  return publishWinningInsightFromPick(pick, client);
}

export { AUTO_EXPLANATION };
