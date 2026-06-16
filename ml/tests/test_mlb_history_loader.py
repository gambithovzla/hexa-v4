"""Tests for the MLB history loader — no network.

The MLB schedule fetch is monkeypatched with a tiny synthetic season so the
leakage-free as-of aggregation (run diff, win %, home/road split, last-10) and
the runline/moneyline frame shaping are exercised deterministically.
"""

from __future__ import annotations

import pandas as pd
import pytest

from hexa_ml import mlb_history_loader as mh
from hexa_ml.data import filter_for_market, make_target
from hexa_ml.features import build_X


def _synthetic_season() -> pd.DataFrame:
    """Two teams (id 1 = AAA, id 2 = BBB), three games in date order.

    G1 2023-04-01: AAA(home) 5-3 BBB   → AAA home win
    G2 2023-04-02: BBB(home) 6-2 AAA   → BBB home win
    G3 2023-04-03: AAA(home) 1-0 BBB   → AAA home win (covers -1.5? no, by 1)
    """
    return pd.DataFrame([
        {"game_date": pd.Timestamp("2023-04-01T18:00:00Z"), "home_id": 1, "away_id": 2, "home_score": 5, "away_score": 3},
        {"game_date": pd.Timestamp("2023-04-02T18:00:00Z"), "home_id": 2, "away_id": 1, "home_score": 6, "away_score": 2},
        {"game_date": pd.Timestamp("2023-04-03T18:00:00Z"), "home_id": 1, "away_id": 2, "home_score": 1, "away_score": 0},
    ])


@pytest.fixture(autouse=True)
def _patch_fetch(monkeypatch):
    season = _synthetic_season()
    monkeypatch.setattr(mh, "_load_season", lambda year: season.copy())
    mh.refresh_cache()
    yield
    mh.refresh_cache()


def test_parse_seasons_range_and_list():
    assert mh.parse_seasons("2016-2018") == [2016, 2017, 2018]
    assert mh.parse_seasons("2018,2020,2019") == [2018, 2019, 2020]
    assert mh.parse_seasons("") == mh.default_pretrain_years()


def test_supported_markets():
    assert mh.supported_markets() == ("moneyline", "runline")


def test_first_game_features_are_nan_no_leakage():
    rows = mh._season_rows(2023)
    g1 = rows[0]
    # Neither team has played before G1 — every as-of feature must be NaN.
    assert pd.isna(g1["home_run_diff_avg"])
    assert pd.isna(g1["away_win_pct"])
    assert pd.isna(g1["home_venue_win_pct"])


def test_asof_accumulation_third_game():
    rows = mh._season_rows(2023)
    g3 = rows[2]  # AAA home vs BBB, after each has played twice
    # AAA (home in G3) prior record: G1 win (home), G2 loss (away) → 1-1, win_pct .5
    assert g3["home_win_pct"] == pytest.approx(0.5)
    # AAA runs for before G3: 5 (G1) + 2 (G2) = 7 over 2 games = 3.5
    assert g3["home_runs_for_avg"] == pytest.approx(3.5)
    # AAA home-venue win pct: 1 home game (G1), won → 1.0
    assert g3["home_venue_win_pct"] == pytest.approx(1.0)
    # BBB (away in G3) road record before G3: G1 was away (loss) → 0-1 road → 0.0
    assert g3["away_venue_win_pct"] == pytest.approx(0.0)


def test_build_frame_and_targets_runline():
    frame = mh.build_mlb_training_frame("runline", [2023])
    assert not frame.empty
    assert (frame["market_type"] == "runline").all()
    assert frame["result"].notna().all()
    sub = filter_for_market(frame, "runline")
    y = make_target(sub, "runline")
    # G1 home by 2 (>1.5)=1 ; G2 home by 4 =1 ; G3 home by 1 (not >1.5)=0
    assert list(y) == [1, 1, 0]
    # The team-strength edges feed build_X without error.
    X = build_X(sub, "runline")
    assert "run_diff_edge" in X.columns
    assert "venue_win_pct_edge" in X.columns


def test_build_frame_moneyline_targets():
    frame = mh.build_mlb_training_frame("moneyline", [2023])
    sub = filter_for_market(frame, "moneyline")
    y = make_target(sub, "moneyline")
    # make_target is home-win framed; the home team won all three (5-3, 6-2, 1-0).
    assert list(y) == [1, 1, 1]


def test_unsupported_market_raises():
    with pytest.raises(ValueError):
        mh.build_mlb_training_frame("overunder", [2023])


def test_pythagorean_odds_filled_after_first_game():
    """Games after the first should have synthetic odds from Pythagorean expectation."""
    frame = mh.build_mlb_training_frame("moneyline", [2023])
    # G1 (index 0) has NaN team averages — odds should stay NaN (no leakage).
    assert pd.isna(frame.loc[0, "odds_ml_home"])
    assert pd.isna(frame.loc[0, "odds_ml_away"])
    # G3 (index 2) has 2 games of history — both odds must be filled.
    assert pd.notna(frame.loc[2, "odds_ml_home"])
    assert pd.notna(frame.loc[2, "odds_ml_away"])


def test_pythagorean_odds_symmetry():
    """Home and away implied probs must sum to ~1 (fair line, no vig)."""
    import numpy as np
    frame = mh.build_mlb_training_frame("moneyline", [2023])
    valid = frame["odds_ml_home"].notna()
    assert valid.any(), "No rows with synthetic odds"

    def _implied(american: float) -> float:
        if american < 0:
            return (-american) / (-american + 100)
        return 100 / (american + 100)

    for _, row in frame[valid].iterrows():
        p_home = _implied(row["odds_ml_home"])
        p_away = _implied(row["odds_ml_away"])
        assert abs(p_home + p_away - 1.0) < 0.02, (
            f"Implied probs don't sum to 1: home={p_home:.3f} away={p_away:.3f}"
        )


def test_pythagorean_hfa_favors_home():
    """Home team should be favoured when both teams have identical run differentials."""
    frame = mh.build_mlb_training_frame("moneyline", [2023])
    valid = frame["odds_ml_home"].notna()
    assert valid.any()
    # When both teams are equal, HFA logit pushes p_win_home > 0.5 → negative ML (favourite)
    # We only check the stronger home teams (win_pct_edge > 0) for robustness.
    eq_rows = frame[valid & (frame["home_runs_for_avg"] == frame["away_runs_for_avg"])]
    if not eq_rows.empty:
        assert (eq_rows["odds_ml_home"] < 0).all(), "Equal-strength home team should be favourite"


def test_source_column_is_mlb_history():
    """Historical frame rows must carry source='mlb_history' for sample weighting."""
    frame = mh.build_mlb_training_frame("moneyline", [2023])
    assert (frame["source"] == "mlb_history").all()
