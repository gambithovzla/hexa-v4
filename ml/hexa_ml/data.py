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
    "prop_player_hard_hit_pct", "prop_player_rolling_woba_14d",
    "source",
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
    if sport_norm not in {"mlb", "nba"}:
        raise ValueError(f"Unsupported sport: {sport!r}. Expected 'mlb' or 'nba'.")

    cols = ", ".join(SELECT_COLUMNS)
    sql = f"""
        SELECT {cols}
        FROM pick_features
        WHERE source = 'live'
          AND COALESCE(sport, 'mlb') = '{sport_norm}'
        ORDER BY game_date ASC, id ASC
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

    return out.reset_index(drop=True)


def make_target(df: pd.DataFrame, market: str) -> pd.Series:
    """Build the binary target column for a given market.

    moneyline → 1 if home won, 0 otherwise (drops pushes if any)
    overunder → 1 if total_runs > line (the bet hits the OVER)
    runline   → 1 if home covered (home_score - away_score > -1.5)
                Note: we encode "did home cover -1.5" as the target;
                the side column tells us which side the pick was on.
    """
    if market == "moneyline":
        return (df["home_score"] > df["away_score"]).astype(int)
    if market == "overunder":
        return (df["total_runs"] > df["line"]).astype(int)
    if market == "runline":
        diff = df["home_score"].astype(float) - df["away_score"].astype(float)
        return (diff > 1.5).astype(int)
    if market.startswith("prop_"):
        normalized = df["result"].astype(str).str.lower()
        return normalized.isin(["win", "won"]).astype(int)
    raise ValueError(f"Unknown market: {market}")


def load_ensemble_training_data(
    *,
    database_url: str | None = None,
    market: str = "moneyline",
) -> pd.DataFrame:
    """Pull ensemble training rows from `shadow_model_runs` (Sprint 3 schema).

    Returns rows where every source has a probability and the game is
    resolved. The target `y` is 1 if the home team won, 0 otherwise.

    Only `actual_status = 'resolved'` rows are returned — pushes and
    pending games are excluded.

    Per-market filtering is not enforced yet because shadow_model_runs
    tracks game-winner predictions (moneyline only). Once the legacy
    validator is extended to over/under and run-line we can add a
    market_type column and filter here.
    """
    if market != "moneyline":
        raise NotImplementedError(
            f"Ensemble market '{market}' not supported yet — only 'moneyline' has "
            "shadow_model_runs coverage. Extend shadow-model.js to score over/under "
            "and run-line first."
        )

    url = database_url or get_settings().database_url
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required to train the ensemble. "
            "shadow_model_runs lives in Postgres and is not exported to CSV."
        )

    sql = """
        SELECT
          id,
          game_pk,
          game_date,
          created_at,
          home_team_id,
          away_team_id,
          oracle_home_win_prob,
          shadow_home_win_prob,
          python_model_score,
          python_model_status,
          actual_winner_id,
          actual_home_score,
          actual_away_score,
          actual_status
        FROM shadow_model_runs
        WHERE actual_status = 'resolved'
          AND oracle_home_win_prob IS NOT NULL
          AND shadow_home_win_prob IS NOT NULL
          AND python_model_score IS NOT NULL
          AND python_model_status = 'ok'
        ORDER BY created_at ASC
    """

    engine = create_engine(url)
    try:
        df = pd.read_sql(sql, engine)
    finally:
        engine.dispose()

    if df.empty:
        return df

    df["y_true"] = (
        df["actual_winner_id"].astype(str) == df["home_team_id"].astype(str)
    ).astype(int)

    for col in ("oracle_home_win_prob", "shadow_home_win_prob", "python_model_score"):
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["game_date"] = pd.to_datetime(df["game_date"], errors="coerce")
    if df["game_date"].isna().all():
        df["game_date"] = pd.to_datetime(df["created_at"], errors="coerce")

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
