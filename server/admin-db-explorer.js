/**
 * admin-db-explorer.js — read-only DB browser for admins.
 *
 * Exposes GET /api/admin/db/tables and /api/admin/db/:table.
 * All table and column names come from the TABLES whitelist below — query
 * params never reach the SQL string directly, so this is safe against SQLi.
 *
 * Sensitive columns (password_hash, verification_code, reset hashes, etc.)
 * are NOT in the whitelist and cannot be returned.
 */

import pool from './db.js';

// ── Whitelist ──────────────────────────────────────────────────────────────────
// For each table:
//   columns      → columns the API may return / order by
//   filterable   → columns admins may filter by (?column=value)
//   searchable   → columns scanned by ?search=foo (ILIKE '%foo%')
//   defaultOrder → ORDER BY column (DESC)
//
// To expose a new table, add an entry here. Never use SELECT *.

const TABLES = {
  users: {
    columns: [
      'id', 'email', 'credits', 'is_admin', 'email_verified', 'created_at',
    ],
    filterable: ['id', 'email', 'is_admin', 'email_verified'],
    searchable: ['email', 'id'],
    defaultOrder: 'created_at',
  },
  bankroll: {
    columns: ['user_id', 'initial_bankroll', 'current_bankroll', 'updated_at'],
    filterable: ['user_id'],
    searchable: ['user_id'],
    defaultOrder: 'updated_at',
  },
  bets: {
    columns: [
      'id', 'user_id', 'date', 'matchup', 'pick', 'odds', 'stake',
      'potential_win', 'result', 'source', 'notes', 'pick_id', 'created_at',
    ],
    filterable: ['id', 'user_id', 'result', 'source', 'pick_id'],
    searchable: ['matchup', 'pick', 'notes', 'user_id'],
    defaultOrder: 'created_at',
  },
  picks: {
    columns: [
      'id', 'user_id', 'user_email', 'type', 'matchup', 'pick',
      'oracle_confidence', 'bet_value', 'model_risk', 'model', 'language',
      'result', 'odds_at_pick', 'closing_odds', 'clv', 'kelly_recommendation',
      'game_pk', 'game_date', 'postmortem_summary', 'selection_method',
      'safe_scope', 'pick_time_lima', 'created_at', 'deleted_at',
    ],
    filterable: [
      'id', 'user_id', 'user_email', 'type', 'result', 'model',
      'game_pk', 'game_date', 'selection_method',
    ],
    searchable: ['matchup', 'pick', 'user_email', 'postmortem_summary'],
    defaultOrder: 'created_at',
  },
  odds_snapshots: {
    columns: [
      'id', 'game_id', 'game_date', 'home_team', 'away_team',
      'moneyline_home', 'moneyline_away', 'run_line_home', 'run_line_home_price',
      'run_line_away', 'run_line_away_price', 'total', 'over_price',
      'under_price', 'captured_at',
    ],
    filterable: ['id', 'game_id', 'game_date', 'home_team', 'away_team'],
    searchable: ['game_id', 'home_team', 'away_team'],
    defaultOrder: 'captured_at',
  },
  pending_credits: {
    columns: [
      'id', 'email', 'credits', 'source', 'purchase_id', 'amount',
      'product_name', 'claimed', 'created_at',
    ],
    filterable: ['id', 'email', 'source', 'purchase_id', 'claimed'],
    searchable: ['email', 'product_name', 'purchase_id'],
    defaultOrder: 'created_at',
  },
  bmc_processed_purchases: {
    columns: [
      'purchase_id', 'source', 'email', 'credits', 'product_name',
      'amount', 'processed_at',
    ],
    filterable: ['purchase_id', 'source', 'email'],
    searchable: ['email', 'product_name', 'purchase_id'],
    defaultOrder: 'processed_at',
  },
  nowpayments_invoices: {
    columns: [
      'id', 'order_id', 'user_id', 'invoice_id', 'plan_id', 'credits',
      'price_usd', 'pay_currency', 'status', 'created_at', 'completed_at',
    ],
    filterable: [
      'id', 'order_id', 'user_id', 'invoice_id', 'plan_id', 'status',
      'pay_currency',
    ],
    searchable: ['order_id', 'invoice_id', 'user_id', 'plan_id'],
    defaultOrder: 'created_at',
  },
  backtest_results: {
    columns: [
      'id', 'run_id', 'historical_date', 'game_pk', 'matchup', 'home_team',
      'away_team', 'pick', 'oracle_confidence', 'bet_value', 'model_risk',
      'pick_type', 'actual_home_score', 'actual_away_score', 'actual_result',
      'model', 'prompt_version', 'latency_ms', 'has_critical_flags',
      'bet_value_raw', 'created_at',
    ],
    filterable: [
      'id', 'run_id', 'game_pk', 'historical_date', 'pick_type',
      'actual_result', 'model', 'has_critical_flags',
    ],
    searchable: ['matchup', 'pick', 'home_team', 'away_team', 'run_id'],
    defaultOrder: 'created_at',
  },
  pick_features: {
    columns: [
      'id', 'pick_id', 'backtest_id', 'game_pk', 'game_date',
      'home_pitcher_xwoba', 'away_pitcher_xwoba',
      'home_pitcher_whiff', 'away_pitcher_whiff',
      'home_pitcher_k_pct', 'away_pitcher_k_pct',
      'home_pitcher_era', 'away_pitcher_era',
      'home_team_ops', 'away_team_ops',
      'home_lineup_avg_xwoba', 'away_lineup_avg_xwoba',
      'park_factor_overall', 'park_factor_hr', 'temperature', 'wind_speed',
      'data_quality_score', 'signal_coherence_score',
      'odds_ml_home', 'odds_ml_away', 'odds_ou_total',
      'pick', 'result', 'user_email', 'pick_time_lima', 'created_at',
    ],
    filterable: [
      'id', 'pick_id', 'backtest_id', 'game_pk', 'game_date',
      'result', 'user_email',
    ],
    searchable: ['pick', 'user_email'],
    defaultOrder: 'created_at',
  },
  shadow_model_runs: {
    columns: [
      'id', 'user_id', 'user_email', 'pick_id', 'backtest_id',
      'source_type', 'analysis_mode', 'model_key', 'model_version',
      'game_pk', 'game_date', 'home_team_abbr', 'away_team_abbr',
      'oracle_pick', 'oracle_confidence', 'oracle_home_win_prob',
      'oracle_predicted_winner_abbr',
      'shadow_score', 'shadow_confidence', 'shadow_home_win_prob',
      'shadow_predicted_winner_abbr',
      'agree_with_oracle', 'actual_winner_abbr', 'actual_home_score',
      'actual_away_score', 'actual_status',
      'pick_time_lima', 'created_at', 'updated_at',
    ],
    filterable: [
      'id', 'user_id', 'user_email', 'pick_id', 'backtest_id',
      'source_type', 'analysis_mode', 'model_key', 'game_pk',
      'game_date', 'actual_status', 'agree_with_oracle',
    ],
    searchable: ['user_email', 'oracle_pick', 'home_team_abbr', 'away_team_abbr'],
    defaultOrder: 'created_at',
  },
  app_settings: {
    columns: ['key', 'value', 'updated_at'],
    filterable: ['key'],
    searchable: ['key'],
    defaultOrder: 'updated_at',
  },
  oracle_sessions: {
    columns: [
      'id', 'user_id', 'session_key', 'date_et', 'mode', 'game_ids',
      'matchups', 'created_at', 'updated_at',
    ],
    filterable: ['id', 'user_id', 'session_key', 'date_et', 'mode'],
    searchable: ['session_key', 'matchups', 'user_id'],
    defaultOrder: 'updated_at',
  },
  hexa_insights: {
    columns: [
      'id', 'type', 'title', 'explanation', 'pick_id', 'week_start',
      'dedupe_key', 'created_at', 'deleted_at',
    ],
    filterable: ['id', 'type', 'pick_id', 'week_start', 'dedupe_key'],
    searchable: ['title', 'explanation', 'dedupe_key'],
    defaultOrder: 'created_at',
  },
  content_queue: {
    columns: [
      'id', 'type', 'lang', 'status', 'publish_target', 'title', 'format',
      'cta', 'visual_brief', 'generated_with', 'scheduled_for',
      'approved_at', 'approved_by', 'published_at', 'last_error',
      'created_by', 'created_at', 'updated_at',
    ],
    filterable: [
      'id', 'type', 'lang', 'status', 'publish_target',
      'created_by', 'approved_by',
    ],
    searchable: ['title', 'cta', 'visual_brief', 'last_error'],
    defaultOrder: 'created_at',
  },
  parlay_synergy_runs: {
    columns: [
      'id', 'user_id', 'user_email', 'created_at', 'game_date',
      'requested_legs', 'mode', 'language', 'engine', 'model',
      'combined_prob', 'combined_dec_odds', 'synergy_type',
      'resolved', 'hit', 'legs_hit', 'resolved_at',
      'shadow_old_hit', 'credits_charged', 'is_admin_run',
      'bet_type', 'market_focus',
    ],
    filterable: [
      'id', 'user_id', 'user_email', 'game_date', 'mode', 'engine',
      'model', 'resolved', 'hit', 'is_admin_run', 'bet_type', 'market_focus',
    ],
    searchable: ['user_email', 'synergy_type'],
    defaultOrder: 'created_at',
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function parseInteger(value, fallback, { min = 0, max = Infinity } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function quoteIdent(name) {
  // Defensive: only ever called with whitelisted names, but double-quote
  // anyway in case a column collides with a reserved word.
  return `"${name.replace(/"/g, '""')}"`;
}

function buildWhereClause(table, query) {
  const cfg = TABLES[table];
  const conditions = [];
  const params = [];

  // Equality filters on whitelisted columns
  for (const col of cfg.filterable) {
    const raw = query[col];
    if (raw === undefined || raw === null || raw === '') continue;
    params.push(raw);
    conditions.push(`${quoteIdent(col)} = $${params.length}`);
  }

  // ?search= → ILIKE across `searchable` columns
  if (query.search && cfg.searchable.length > 0) {
    params.push(`%${query.search}%`);
    const idx = params.length;
    const orParts = cfg.searchable.map(
      (col) => `${quoteIdent(col)}::text ILIKE $${idx}`
    );
    conditions.push(`(${orParts.join(' OR ')})`);
  }

  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

// ── Route handlers ─────────────────────────────────────────────────────────────

function listTables(req, res) {
  const tables = Object.entries(TABLES).map(([name, cfg]) => ({
    name,
    columns: cfg.columns,
    filterable: cfg.filterable,
    searchable: cfg.searchable,
    defaultOrder: cfg.defaultOrder,
  }));
  res.json({ tables });
}

async function readTable(req, res) {
  const { table } = req.params;
  const cfg = TABLES[table];
  if (!cfg) {
    return res.status(404).json({ error: `Unknown table '${table}'` });
  }

  const limit  = parseInteger(req.query.limit,  DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT });
  const offset = parseInteger(req.query.offset, 0,             { min: 0 });

  const orderColRaw = (req.query.order_by || cfg.defaultOrder || cfg.columns[0]).toString();
  const orderCol    = cfg.columns.includes(orderColRaw) ? orderColRaw : cfg.defaultOrder || cfg.columns[0];
  const orderDir    = (req.query.order_dir || 'desc').toString().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { sql: whereSql, params } = buildWhereClause(table, req.query);

  const selectCols = cfg.columns.map(quoteIdent).join(', ');
  const tableQuoted = quoteIdent(table);

  try {
    const dataSql = `
      SELECT ${selectCols}
      FROM ${tableQuoted}
      ${whereSql}
      ORDER BY ${quoteIdent(orderCol)} ${orderDir} NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countSql = `SELECT COUNT(*)::int AS total FROM ${tableQuoted} ${whereSql}`;

    const [dataRes, countRes] = await Promise.all([
      pool.query(dataSql, params),
      pool.query(countSql, params),
    ]);

    res.json({
      table,
      columns: cfg.columns,
      rows: dataRes.rows,
      total: countRes.rows[0]?.total ?? 0,
      limit,
      offset,
      orderBy: orderCol,
      orderDir,
    });
  } catch (err) {
    console.error(`[admin-db-explorer] read ${table} failed:`, err.message);
    res.status(500).json({ error: 'Failed to read table', details: err.message });
  }
}

// ── Mounting ───────────────────────────────────────────────────────────────────

export function mountAdminDbExplorer(app, { verifyToken, isAdmin }) {
  app.get('/api/admin/db/tables',     verifyToken, isAdmin, listTables);
  app.get('/api/admin/db/:table',     verifyToken, isAdmin, readTable);
}

export const ADMIN_DB_TABLES = TABLES;
