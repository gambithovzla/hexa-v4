"""Loaders for the training dataset.

Two sources, same shape:
  - Postgres (production retraining)
  - CSV from `scripts/training/export-dataset.js` (local dev / fallback)

Returns a pandas DataFrame with the columns produced by Sprint 1's
pick_features schema. Downstream feature engineering lives in features.py;
this module focuses on I/O and schema validation.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine

from .config import get_settings
from .models.ensemble import sources_for_market

# Columns the Sprint 1 migration adds to pick_features. The loader will
# tolerate missing optional columns (e.g. umpire_id) so an older CSV still
# works, but the required ones below must exist.
REQUIRED_COLUMNS = [
    "id", "pick_id", "game_pk", "game_date",
    "market_type", "side", "line",
    "result",
    "home_score", "away_score", "total_runs",
]

OPTIONAL_FEATURE_COLUMNS = [
    "home_pitcher_xwoba", "away_pitcher_xwoba",
    "home_pitcher_whiff", "away_pitcher_whiff",
    "home_pitcher_k_pct", "away_pitcher_k_pct",
    "home_pitcher_era", "away_pitcher_era",
    "home_pitcher_days_rest", "away_pitcher_days_rest",
    "home_pitcher_pitches_last_start", "away_pitcher_pitches_last_start",
    "home_bullpen_pitches_last_3d", "away_bullpen_pitches_last_3d",
    "home_team_ops", "away_team_ops",
    "home_lineup_avg_xwoba", "away_lineup_avg_xwoba",
    "park_factor_overall", "park_factor_hr",
    "temperature", "wind_speed",
    "is_day_game", "is_dome",
    "game_number_in_series", "umpire_id",
    "odds_ml_home", "odds_ml_away", "odds_ou_total",
    "data_quality_score", "signal_coherence_score",
    "oracle_confidence", "kelly_fraction",
    "prop_kind", "prop_player_id",
    "prop_player_name",
    "prop_player_xwoba", "prop_player_xba", "prop_player_xslg",
    "prop_player_k_pct", "prop_player_bb_pct",
    "prop_player_avg_exit_velocity", "prop_player_barrel_pct",
    "prop_player_hard_hit_pct",
    "prop_player_rolling_woba_7d", "prop_player_rolling_woba_14d", "prop_player_rolling_woba_21d",
    "prop_player_ops_vs_lhp", "prop_player_ops_vs_rhp",
    "prop_opponent_pitcher_hand", "prop_opponent_pitcher_xwoba_against", "prop_opponent_pitcher_k_pct",
    "prop_odds_american", "prop_implied_prob",
    "source",
    # NFL-specific columns (Sprint 9 — nfl_* markets)
    "home_epa_off", "away_epa_off", "home_epa_def", "away_epa_def",
    "home_success_rate", "away_success_rate",
    "home_proe", "away_proe",
    "home_pace", "away_pace",
    "home_rest_days", "away_rest_days",
    "home_is_short_week", "away_is_short_week",
    "home_is_off_bye", "away_is_off_bye",
    "qb_home_active", "qb_away_active",
    "qb_home_tier", "qb_away_tier",
    "wind_mph",
    "spread_close", "total_close",
    "injuries_home_severe", "injuries_away_severe",
    # Soccer-specific columns (Sprint 11 — soccer_* markets)
    "home_goals_for", "away_goals_for",
    "home_goals_against", "away_goals_against",
    "home_goal_diff", "away_goal_diff",
    "home_points", "away_points",
    "home_xg", "away_xg",
    "home_xga", "away_xga",
    "home_last10_wins", "away_last10_wins",
    "draw_price", "btts_yes_price",
    "context_completeness",
    # Tennis-specific columns (Sprint 12 — tennis_* markets; player A = home slot)
    "home_elo_surface", "away_elo_surface",
    "home_elo_overall", "away_elo_overall",
    "home_rank", "away_rank",
    "h2h_surface_wins_home", "h2h_surface_wins_away",
    "h2h_total_wins_home", "h2h_total_wins_away",
    "home_sets_played_tourney", "away_sets_played_tourney",
    "surface", "tournament_round", "best_of",
    "set_handicap_close", "total_games_close",
    "pick_side",
]

SELECT_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_FEATURE_COLUMNS


def load_from_postgres(database_url: str | None = None, sport: str = "mlb") -> pd.DataFrame:
    """Read the training dataset directly from `pick_features`.

    Returns a DataFrame indexed by `id` with all required + optional columns.
    Only `source = 'live'` rows for the requested sport are returned
    (excludes admin tests, backtests, and cross-sport contamination).
    Rows with NULL sport are treated as MLB for backwards compatibility
    with pre-NBA pick_features data.
    """
    url = database_url or get_settings().database_url
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required for load_from_postgres(). "
            "Pass a CSV path to load_dataset() instead for local dev."
        )

    sport_norm = (sport or "mlb").lower()
    if sport_norm not in {"mlb", "nba", "nfl", "soccer", "tennis"}:
        raise ValueError(f"Unsupported sport: {sport!r}. Expected 'mlb', 'nba', 'nfl', 'soccer', or 'tennis'.")

    cols = ", ".join(f"pf.{c}" for c in SELECT_COLUMNS)
    sql = f"""
        SELECT {cols}
        FROM pick_features pf
        LEFT JOIN picks p ON p.id = pf.pick_id
        WHERE pf.source = 'live'
          AND COALESCE(pf.sport, 'mlb') = '{sport_norm}'
          AND (
            pf.backtest_id IS NOT NULL
            OR pf.pick_id IS NULL
            OR p.deleted_at IS NULL
          )
        ORDER BY pf.game_date ASC, pf.id ASC
    """
    engine = create_engine(url)
    try:
        df = pd.read_sql(sql, engine)
    finally:
        engine.dispose()

    df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    return df


def load_from_csv(path: str | Path) -> pd.DataFrame:
    """Read the training dataset from the Node export script's CSV.

    Tolerates missing optional columns by filling them with NaN.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    # Read with header only first so we can validate columns before pandas
    # raises a less-helpful error about missing parse_dates targets.
    df = pd.read_csv(path, low_memory=False)

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"CSV is missing required columns: {missing}. "
            "Re-export with scripts/training/export-dataset.js after Sprint 1 migration."
        )

    if "game_date" in df.columns:
        df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")

    for col in OPTIONAL_FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA

    return df


def load_dataset(
    *,
    csv_path: str | Path | None = None,
    database_url: str | None = None,
    sport: str = "mlb",
) -> pd.DataFrame:
    """Smart loader — uses CSV if given, falls back to Postgres.

    `sport` is passed through to `load_from_postgres` to keep the MLB
    training pipeline isolated from NBA picks (and vice versa).
    """
    if csv_path:
        return load_from_csv(csv_path)
    return load_from_postgres(database_url, sport=sport)


def filter_for_market(df: pd.DataFrame, market: str) -> pd.DataFrame:
    """Slice the dataset to rows usable for training a specific market.

    Filters:
      - market_type matches
      - result is not null (resolved)
      - for moneyline / runline: home_score and away_score present
      - for overunder: total_runs present
    """
    prop_market_map = {
        "prop_hits": "hits",
        "prop_strikeouts": "strikeouts",
        "prop_total_bases": "total_bases",
        "prop_home_runs": "home_runs",
        "prop_rbis": "rbis",
    }

    if market in prop_market_map:
        out = df[
            (df["market_type"] == "prop")
            & (df["prop_kind"] == prop_market_map[market])
        ].copy()
    elif market == "nfl_moneyline":
        out = df[df["market_type"] == "moneyline"].copy()
    elif market == "nfl_spread":
        out = df[df["market_type"].isin(["spread", "runline"])].copy()
    elif market == "nfl_total":
        out = df[df["market_type"].isin(["overunder", "totals"])].copy()
    elif market == "soccer_moneyline":
        out = df[df["market_type"] == "moneyline"].copy()
    elif market == "soccer_total":
        out = df[df["market_type"].isin(["overunder", "total"])].copy()
    elif market == "soccer_btts":
        out = df[df["market_type"] == "btts"].copy()
    elif market == "tennis_moneyline":
        out = df[df["market_type"] == "moneyline"].copy()
    elif market == "tennis_set_handicap":
        out = df[df["market_type"].isin(["set_handicap", "spread"])].copy()
    elif market == "tennis_total_games":
        out = df[df["market_type"].isin(["total_games", "overunder", "totals"])].copy()
    else:
        out = df[df["market_type"] == market].copy()
    out = out[out["result"].notna()]

    if market in {"moneyline", "runline"}:
        out = out[out["home_score"].notna() & out["away_score"].notna()]
    elif market == "overunder":
        out = out[out["total_runs"].notna() & out["line"].notna()]
    elif market in prop_market_map:
        out = out[out["line"].notna()]
        out = out[
            out["result"].astype(str).str.lower().isin(["win", "won", "loss", "lost"])
        ]
    elif market == "nfl_moneyline":
        out = out[out["home_score"].notna() & out["away_score"].notna()]
    elif market == "nfl_spread":
        out = out[out["home_score"].notna() & out["away_score"].notna() & out["spread_close"].notna()]
    elif market == "nfl_total":
        out = out[out["total_runs"].notna() & out["total_close"].notna()]
    elif market == "soccer_moneyline":
        out = out[out["home_score"].notna() & out["away_score"].notna()]
    elif market == "soccer_total":
        out = out[out["home_score"].notna() & out["away_score"].notna()]
    elif market == "soccer_btts":
        out = out[out["home_score"].notna() & out["away_score"].notna()]
    elif market.startswith("tennis_"):
        # Tennis has no box-score columns; the binary outcome lives in `result`
        # (win/loss) plus `pick_side` to orient it to player A. Drop voids
        # (retirements/walkovers) and unresolved rows.
        out = out[out["result"].astype(str).str.lower().isin(["win", "won", "loss", "lost"])]
        out = out[out["pick_side"].notna()]

    return out.reset_index(drop=True)


def make_target(df: pd.DataFrame, market: str) -> pd.Series:
    """Build the binary target column for a given market.

    moneyline → 1 if home won, 0 otherwise (drops pushes if any)
    overunder → 1 if total_runs > line (the bet hits the OVER)
    runline   → 1 if home covered (home_score - away_score > -1.5)
                Note: we encode "did home cover -1.5" as the target;
                the side column tells us which side the pick was on.
    nfl_moneyline → 1 if home won (same as moneyline)
    nfl_spread    → 1 if home covers the closing spread
    nfl_total     → 1 if total_runs > total_close (OVER hits)
    """
    if market in {"moneyline", "nfl_moneyline", "soccer_moneyline"}:
        return (df["home_score"] > df["away_score"]).astype(int)
    if market == "overunder":
        return (df["total_runs"] > df["line"]).astype(int)
    if market in {"nfl_total", "soccer_total"}:
        # soccer_total: P(OVER goals line) — home_score+away_score vs odds_ou_total
        line_col = "total_close" if market == "nfl_total" else "odds_ou_total"
        total = df["home_score"].astype(float) + df["away_score"].astype(float)
        line  = pd.to_numeric(df.get(line_col, pd.Series([float("nan")] * len(df))), errors="coerce")
        return (total > line).astype(int)
    if market == "runline":
        diff = df["home_score"].astype(float) - df["away_score"].astype(float)
        return (diff > 1.5).astype(int)
    if market == "nfl_spread":
        diff = df["home_score"].astype(float) - df["away_score"].astype(float)
        spread = df["spread_close"].astype(float)
        return (diff > -spread).astype(int)
    if market == "soccer_btts":
        # 1 if both teams scored (home_score >= 1 AND away_score >= 1)
        h = df["home_score"].astype(float)
        a = df["away_score"].astype(float)
        return ((h >= 1) & (a >= 1)).astype(int)
    if market.startswith("prop_"):
        normalized = df["result"].astype(str).str.lower()
        return normalized.isin(["win", "won"]).astype(int)
    if market.startswith("tennis_"):
        # Features are A-minus-B (predict P(player A wins)). The stored result is
        # "did the pick win"; pick_side says which player it was on. So
        #   A_won = (pick on A) == (pick won).
        pick_won = df["result"].astype(str).str.lower().isin(["win", "won"])
        pick_on_a = df["pick_side"].astype(str).str.lower() == "player_a"
        return (pick_on_a == pick_won).astype(int)
    raise ValueError(f"Unknown market: {market}")


def load_ensemble_training_data(
    *,
    database_url: str | None = None,
    market: str = "moneyline",
) -> pd.DataFrame:
    """Pull ensemble training rows from `shadow_model_runs` using pick-aligned probs.

    Uses oracle_pick_prob / legacy_pick_prob / python_pick_prob — all in the
    'did the pick win' frame — instead of the old home-win frame. Supports
    moneyline, overunder, runline, and prop markets.

    The target y_true = 1 when the picked side won, computed per market:
      - moneyline : picked team won
      - overunder : total > line (if side='over') or < line (if side='under')
      - runline   : picked side covered -1.5 / +1.5
      - prop      : picks.result IN ('win', 'won') — requires JOIN on pick_id

    Only actual_status='resolved' rows with all three pick-aligned probabilities
    are returned.
    """
    supported = {"moneyline", "overunder", "runline", "prop"}
    if market not in supported:
        raise NotImplementedError(
            f"Ensemble market '{market}' not supported. Supported: {supported}"
        )

    url = database_url or get_settings().database_url
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required to train the ensemble. "
            "shadow_model_runs lives in Postgres and is not exported to CSV."
        )

    # Legacy validator only scores moneyline. For the value markets the
    # ensemble is 2-source (oracle + python), so we must NOT require
    # legacy_pick_prob — that filter is exactly why over/under/runline/prop
    # never had an ensemble.
    needs_legacy = "legacy" in sources_for_market(market)
    legacy_filter = "\n                  AND {prefix}legacy_pick_prob IS NOT NULL" if needs_legacy else ""

    engine = create_engine(url)
    try:
        if market == "prop":
            sql = """
                SELECT
                  smr.id,
                  smr.game_pk,
                  smr.game_date,
                  smr.created_at,
                  smr.oracle_pick_prob,
                  smr.legacy_pick_prob,
                  smr.python_pick_prob,
                  LOWER(p.result) AS pick_result
                FROM shadow_model_runs smr
                JOIN picks p ON p.id = smr.pick_id
                WHERE smr.actual_status = 'resolved'
                  AND smr.pick_market_type = 'prop'
                  AND smr.oracle_pick_prob IS NOT NULL
                  AND smr.python_pick_prob IS NOT NULL{legacy_clause}
                  AND LOWER(p.result) IN ('win', 'won', 'loss', 'lost')
                ORDER BY smr.created_at ASC
            """.format(legacy_clause=legacy_filter.format(prefix="smr."))
        else:
            sql = """
                SELECT
                  id,
                  game_pk,
                  game_date,
                  created_at,
                  pick_market_type,
                  pick_side,
                  pick_line,
                  oracle_pick_prob,
                  legacy_pick_prob,
                  python_pick_prob,
                  actual_home_score,
                  actual_away_score,
                  actual_status
                FROM shadow_model_runs
                WHERE actual_status = 'resolved'
                  AND pick_market_type = '{market}'
                  AND oracle_pick_prob IS NOT NULL
                  AND python_pick_prob IS NOT NULL{legacy_clause}
                ORDER BY created_at ASC
            """.format(market=market, legacy_clause=legacy_filter.format(prefix=""))
        df = pd.read_sql(sql, engine)
    finally:
        engine.dispose()

    if df.empty:
        return df

    for col in ("oracle_pick_prob", "legacy_pick_prob", "python_pick_prob"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    if df["game_date"].isna().all():
        df["game_date"] = pd.to_datetime(df["created_at"], errors="coerce")

    if market == "prop":
        df["y_true"] = df["pick_result"].isin(["win", "won"]).astype(int)
    else:
        for col in ("actual_home_score", "actual_away_score", "pick_line"):
            df[col] = pd.to_numeric(df[col], errors="coerce")

        def _pick_won(row: pd.Series) -> float:
            hs = row["actual_home_score"]
            as_ = row["actual_away_score"]
            side = str(row.get("pick_side") or "").lower()
            if pd.isna(hs) or pd.isna(as_):
                return float("nan")
            if market == "moneyline":
                home_won = hs > as_
                return float(home_won if side == "home" else not home_won)
            if market == "overunder":
                line = row["pick_line"]
                if pd.isna(line):
                    return float("nan")
                total = hs + as_
                return float(total > line if side == "over" else total < line)
            if market == "runline":
                diff = hs - as_
                # home picked -1.5 → need diff > 1.5; away picked +1.5 → need diff < 1.5
                return float(diff > 1.5 if side == "home" else diff < 1.5)
            return float("nan")

        df["y_true"] = df.apply(_pick_won, axis=1)
        df = df.dropna(subset=["y_true"]).copy()

    df["y_true"] = df["y_true"].astype(int)
    return df


def temporal_split(
    df: pd.DataFrame, test_days: int
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split chronologically — last `test_days` is the test set.

    Never use random_state=42 for time-series data: prediction in the
    future from past data is the only honest evaluation.
    """
    if "game_date" not in df.columns or df["game_date"].isna().all():
        raise ValueError("game_date is required for temporal_split")

    cutoff = df["game_date"].max() - pd.Timedelta(days=test_days)
    train_df = df[df["game_date"] <= cutoff].copy()
    test_df = df[df["game_date"] > cutoff].copy()
    return train_df, test_df
