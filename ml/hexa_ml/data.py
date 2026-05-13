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
    "source",
]

SELECT_COLUMNS = REQUIRED_COLUMNS + OPTIONAL_FEATURE_COLUMNS


def load_from_postgres(database_url: str | None = None) -> pd.DataFrame:
    """Read the training dataset directly from `pick_features`.

    Returns a DataFrame indexed by `id` with all required + optional columns.
    Only `source = 'live'` rows are returned (excludes admin tests and backtests).
    """
    url = database_url or get_settings().database_url
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required for load_from_postgres(). "
            "Pass a CSV path to load_dataset() instead for local dev."
        )

    cols = ", ".join(SELECT_COLUMNS)
    sql = f"""
        SELECT {cols}
        FROM pick_features
        WHERE source = 'live'
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
) -> pd.DataFrame:
    """Smart loader — uses CSV if given, falls back to Postgres."""
    if csv_path:
        return load_from_csv(csv_path)
    return load_from_postgres(database_url)


def filter_for_market(df: pd.DataFrame, market: str) -> pd.DataFrame:
    """Slice the dataset to rows usable for training a specific market.

    Filters:
      - market_type matches
      - result is not null (resolved)
      - for moneyline / runline: home_score and away_score present
      - for overunder: total_runs present
    """
    out = df[df["market_type"] == market].copy()
    out = out[out["result"].notna()]

    if market in {"moneyline", "runline"}:
        out = out[out["home_score"].notna() & out["away_score"].notna()]
    elif market == "overunder":
        out = out[out["total_runs"].notna() & out["line"].notna()]

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
    raise ValueError(f"Unknown market: {market}")


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
