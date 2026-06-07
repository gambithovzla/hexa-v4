"""Tests for feature engineering."""

from __future__ import annotations

import numpy as np
import pandas as pd

from hexa_ml.features import (
    BASE_NUMERIC_FEATURES,
    DERIVED_FEATURES,
    _american_to_implied_prob,
    add_derived,
    build_X,
    feature_columns,
)


def test_feature_columns_overunder_includes_line():
    cols = feature_columns("overunder")
    assert "line" in cols, "overunder model must take the line as a feature"


def test_feature_columns_moneyline_excludes_line():
    cols = feature_columns("moneyline")
    assert "line" not in cols


def test_derived_features_added(fake_dataset):
    enriched = add_derived(fake_dataset)
    for col in DERIVED_FEATURES:
        assert col in enriched.columns, f"missing derived: {col}"


def test_pitcher_xwoba_diff_sign(fake_dataset):
    """When away xwoba > home xwoba, diff should be positive (home pitcher better)."""
    enriched = add_derived(fake_dataset)
    diff = enriched["pitcher_xwoba_diff"]
    raw = fake_dataset["away_pitcher_xwoba"] - fake_dataset["home_pitcher_xwoba"]
    pd.testing.assert_series_equal(
        diff.reset_index(drop=True),
        raw.reset_index(drop=True),
        check_names=False,
    )


def test_implied_prob_negative_odds():
    """-110 ⇒ ~0.524 implied probability."""
    probs = _american_to_implied_prob(pd.Series([-110, -200, -150]))
    assert abs(probs.iloc[0] - 0.5238) < 0.01
    assert abs(probs.iloc[1] - 0.6667) < 0.01
    assert abs(probs.iloc[2] - 0.6000) < 0.01


def test_implied_prob_positive_odds():
    """+150 ⇒ 0.40 implied probability."""
    probs = _american_to_implied_prob(pd.Series([+150, +200, +100]))
    assert abs(probs.iloc[0] - 0.4) < 0.01
    assert abs(probs.iloc[1] - 0.3333) < 0.01
    assert abs(probs.iloc[2] - 0.5) < 0.01


def test_build_X_matches_column_order(fake_dataset):
    X = build_X(fake_dataset, "moneyline")
    assert list(X.columns) == feature_columns("moneyline")


def test_build_X_overunder_has_line(fake_dataset):
    X = build_X(fake_dataset, "overunder")
    assert "line" in X.columns
    assert X["line"].notna().all()


def test_build_X_handles_missing_columns():
    """Stripped-down dataset still produces the right schema."""
    minimal = pd.DataFrame({
        "home_pitcher_xwoba": [0.300],
        "away_pitcher_xwoba": [0.320],
    })
    X = build_X(minimal, "moneyline")
    assert list(X.columns) == feature_columns("moneyline")
    # Missing cols are NaN, not dropped
    assert X["home_team_ops"].isna().all()


def test_base_features_all_present_in_X(fake_dataset):
    X = build_X(fake_dataset, "moneyline")
    for col in BASE_NUMERIC_FEATURES:
        assert col in X.columns


def test_all_X_columns_numeric(fake_dataset):
    X = build_X(fake_dataset, "moneyline")
    for col in X.columns:
        assert np.issubdtype(X[col].dtype, np.number), f"{col} is {X[col].dtype}"


def test_nfl_prop_feature_columns_and_build_X():
    """nfl_prop is a pooled player-prop market with one-hot prop kinds and a
    de-vigged market signal — distinct from the team-level nfl_* markets."""
    cols = feature_columns("nfl_prop")
    assert "prop_side_over" in cols
    assert "nfl_prop_fair_prob" in cols
    assert "propkind_pass_yds" in cols
    assert "propkind_anytime_td" in cols
    # Must NOT carry the team EPA features (it routes before the nfl_ prefix).
    assert "home_epa_off" not in cols

    df = pd.DataFrame({
        "market_type": ["prop", "prop"],
        "prop_kind": ["pass_yds", "anytime_td"],
        "side": ["over", "under"],
        "line": [274.5, 0.5],
        "prop_odds_american": [-115, 120],
        "nfl_prop_player_season_avg": [262.0, 0.6],
    })
    X = build_X(df, "nfl_prop")
    assert list(X.columns) == cols
    assert X["prop_side_over"].tolist() == [1.0, 0.0]
    assert X["propkind_pass_yds"].tolist() == [1.0, 0.0]
    # season_minus_line = season_avg - line
    assert abs(X["nfl_prop_season_minus_line"].iloc[0] - (262.0 - 274.5)) < 1e-6
