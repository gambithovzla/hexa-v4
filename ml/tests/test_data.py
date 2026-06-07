"""Tests for the data loading and splitting utilities."""

from __future__ import annotations

import pandas as pd
import pytest

from hexa_ml.data import (
    REQUIRED_COLUMNS,
    filter_for_market,
    load_from_csv,
    make_target,
    temporal_split,
)


def test_filter_for_market_moneyline_keeps_only_resolved(fake_dataset):
    sub = filter_for_market(fake_dataset, "moneyline")
    assert (sub["market_type"] == "moneyline").all()
    assert sub["result"].notna().all()
    assert sub["home_score"].notna().all()


def test_filter_for_market_overunder_requires_total(fake_dataset):
    sub = filter_for_market(fake_dataset, "overunder")
    assert sub["total_runs"].notna().all()
    assert sub["line"].notna().all()


def test_make_target_moneyline_uses_score(fake_dataset):
    sub = filter_for_market(fake_dataset, "moneyline")
    y = make_target(sub, "moneyline")
    expected = (sub["home_score"] > sub["away_score"]).astype(int)
    pd.testing.assert_series_equal(
        y.reset_index(drop=True),
        expected.reset_index(drop=True),
        check_names=False,
    )


def test_make_target_overunder_compares_to_line(fake_dataset):
    sub = filter_for_market(fake_dataset, "overunder")
    y = make_target(sub, "overunder")
    expected = (sub["total_runs"] > sub["line"]).astype(int)
    pd.testing.assert_series_equal(
        y.reset_index(drop=True),
        expected.reset_index(drop=True),
        check_names=False,
    )


def test_temporal_split_ordering(fake_dataset):
    train, test = temporal_split(fake_dataset, test_days=30)
    assert len(train) > 0
    assert len(test) > 0
    # No leakage — every test date is strictly after every train date
    assert train["game_date"].max() < test["game_date"].min()


def test_temporal_split_raises_without_dates():
    df = pd.DataFrame({"id": [1, 2], "game_date": [pd.NaT, pd.NaT]})
    with pytest.raises(ValueError):
        temporal_split(df, test_days=10)


def test_load_from_csv_round_trip(tmp_path, fake_dataset):
    """Writing and reading back the dataset preserves required columns."""
    csv_path = tmp_path / "ds.csv"
    fake_dataset.to_csv(csv_path, index=False)
    loaded = load_from_csv(csv_path)
    for col in REQUIRED_COLUMNS:
        assert col in loaded.columns


def test_load_from_csv_missing_required_raises(tmp_path):
    minimal = pd.DataFrame({"id": [1], "game_pk": [123]})
    csv_path = tmp_path / "bad.csv"
    minimal.to_csv(csv_path, index=False)
    with pytest.raises(ValueError, match="missing required columns"):
        load_from_csv(csv_path)


def test_nfl_prop_filter_and_target():
    """nfl_prop slices market_type=='prop', drops unresolved/no-line rows, and
    builds a pick-aligned target (win→1)."""
    df = pd.DataFrame({
        "market_type": ["prop", "prop", "prop", "moneyline"],
        "prop_kind": ["pass_yds", "rush_yds", "receptions", None],
        "side": ["over", "under", "over", "home"],
        "line": [274.5, 89.5, None, None],          # 3rd row dropped (no line)
        "result": ["win", "loss", "win", "win"],     # 4th row dropped (not prop)
        "home_score": [None, None, None, 24],
        "away_score": [None, None, None, 20],
        "total_runs": [None, None, None, None],
    })
    sub = filter_for_market(df, "nfl_prop")
    assert len(sub) == 2  # only the two resolved prop rows with a line
    y = make_target(sub, "nfl_prop")
    assert y.tolist() == [1, 0]
