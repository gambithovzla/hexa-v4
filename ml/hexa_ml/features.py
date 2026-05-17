"""Feature engineering — turns the raw pick_features DataFrame into a
numeric matrix XGBoost can consume.

Conventions:
  - All categorical encoding is explicit (no get_dummies surprises).
  - NaN is preserved — XGBoost handles missing values natively.
  - Functions are pure; the trained pipeline saves the column order so
    inference uses the exact same schema.
"""

from __future__ import annotations

import pandas as pd

# Numeric features used by every market model. Order matters — it's the
# contract between training and inference.
BASE_NUMERIC_FEATURES = [
    # Pitching
    "home_pitcher_xwoba", "away_pitcher_xwoba",
    "home_pitcher_whiff", "away_pitcher_whiff",
    "home_pitcher_k_pct", "away_pitcher_k_pct",
    "home_pitcher_era", "away_pitcher_era",
    "home_pitcher_days_rest", "away_pitcher_days_rest",
    "home_pitcher_pitches_last_start", "away_pitcher_pitches_last_start",
    "home_bullpen_pitches_last_3d", "away_bullpen_pitches_last_3d",
    # Hitting
    "home_team_ops", "away_team_ops",
    "home_lineup_avg_xwoba", "away_lineup_avg_xwoba",
    # Park / weather
    "park_factor_overall", "park_factor_hr",
    "temperature", "wind_speed",
    # Game context
    "game_number_in_series",
    # Odds (market signal)
    "odds_ml_home", "odds_ml_away", "odds_ou_total",
]

# Boolean features encoded as int (0/1/NaN)
BOOL_FEATURES = ["is_day_game", "is_dome"]

# Computed differentials — same matchup info rephrased as edges
DERIVED_FEATURES = [
    "pitcher_xwoba_diff",      # away - home (positive = home pitcher better)
    "pitcher_era_diff",
    "lineup_xwoba_diff",       # home - away (positive = home offense better)
    "team_ops_diff",
    "days_rest_diff",
    "bullpen_fatigue_diff",    # higher = home pen more rested
    "implied_prob_home",       # from odds_ml_home
    "implied_prob_away",
]

# Player-prop snapshot features (Sprint 5 deferred resumed)
PROP_NUMERIC_FEATURES = [
    "prop_player_xwoba", "prop_player_xba", "prop_player_xslg",
    "prop_player_k_pct", "prop_player_bb_pct",
    "prop_player_avg_exit_velocity", "prop_player_barrel_pct",
    "prop_player_hard_hit_pct",
    "prop_player_rolling_woba_7d", "prop_player_rolling_woba_14d", "prop_player_rolling_woba_21d",
    "prop_player_ops_vs_lhp", "prop_player_ops_vs_rhp",
    "prop_opponent_pitcher_xwoba_against", "prop_opponent_pitcher_k_pct",
    "prop_implied_prob",
]


def _american_to_implied_prob(odds: pd.Series) -> pd.Series:
    """Convert American moneyline odds to implied probability."""
    odds = pd.to_numeric(odds, errors="coerce")
    out = pd.Series(index=odds.index, dtype="float64")
    pos_mask = odds > 0
    neg_mask = odds < 0
    out[pos_mask] = 100.0 / (odds[pos_mask] + 100.0)
    out[neg_mask] = -odds[neg_mask] / (-odds[neg_mask] + 100.0)
    return out


def _col_or_nan(df: pd.DataFrame, col: str) -> pd.Series:
    """Return a numeric Series for `col` or a NaN-filled Series of df length."""
    if col in df.columns:
        return pd.to_numeric(df[col], errors="coerce")
    return pd.Series([float("nan")] * len(df), index=df.index, dtype="float64")


def add_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Append computed features to the DataFrame (returns a copy)."""
    out = df.copy()

    h_xw = _col_or_nan(out, "home_pitcher_xwoba")
    a_xw = _col_or_nan(out, "away_pitcher_xwoba")
    out["pitcher_xwoba_diff"] = a_xw - h_xw  # away xwoba higher → home pitcher better

    h_era = _col_or_nan(out, "home_pitcher_era")
    a_era = _col_or_nan(out, "away_pitcher_era")
    out["pitcher_era_diff"] = a_era - h_era

    h_lu = _col_or_nan(out, "home_lineup_avg_xwoba")
    a_lu = _col_or_nan(out, "away_lineup_avg_xwoba")
    out["lineup_xwoba_diff"] = h_lu - a_lu

    h_ops = _col_or_nan(out, "home_team_ops")
    a_ops = _col_or_nan(out, "away_team_ops")
    out["team_ops_diff"] = h_ops - a_ops

    h_rest = _col_or_nan(out, "home_pitcher_days_rest")
    a_rest = _col_or_nan(out, "away_pitcher_days_rest")
    out["days_rest_diff"] = h_rest - a_rest

    h_pen = _col_or_nan(out, "home_bullpen_pitches_last_3d")
    a_pen = _col_or_nan(out, "away_bullpen_pitches_last_3d")
    # Higher own-pen usage = more fatigued, so home advantage when away pen is heavier
    out["bullpen_fatigue_diff"] = a_pen - h_pen

    out["implied_prob_home"] = _american_to_implied_prob(_col_or_nan(out, "odds_ml_home"))
    out["implied_prob_away"] = _american_to_implied_prob(_col_or_nan(out, "odds_ml_away"))
    out["prop_side_over"] = (
        out.get("side", pd.Series([None] * len(out), index=out.index))
        .astype(str)
        .str.lower()
        .map({"over": 1.0, "under": 0.0})
    )

    # Booleans → numeric (NaN preserved)
    for col in BOOL_FEATURES:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    return out


def feature_columns(market: str) -> list[str]:
    """Return the full ordered feature column list for a given market.

    overunder gets the line itself as a feature (since the target depends on it).
    runline / moneyline don't need the line.
    """
    cols = list(BASE_NUMERIC_FEATURES) + list(BOOL_FEATURES) + list(DERIVED_FEATURES)
    if market == "overunder":
        cols.append("line")
    if market.startswith("prop_"):
        cols.extend(PROP_NUMERIC_FEATURES)
        cols.extend(["line", "prop_side_over"])
    return cols


def build_X(df: pd.DataFrame, market: str) -> pd.DataFrame:
    """Build the feature matrix for the given market.

    Adds derived columns, then selects + reorders to `feature_columns(market)`.
    Columns missing from the input are filled with NaN so older snapshots
    still produce the right schema.
    """
    enriched = add_derived(df)
    cols = feature_columns(market)

    for c in cols:
        if c not in enriched.columns:
            enriched[c] = pd.NA

    X = enriched[cols].copy()

    # Coerce every column to float so XGBoost receives a clean numeric matrix
    for c in cols:
        X[c] = pd.to_numeric(X[c], errors="coerce")

    return X
