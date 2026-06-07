"""Tests for the soccer history loader — no network.

The football-data CSV fetch is monkeypatched with a tiny synthetic season so the
leakage-free as-of aggregation, decimal→American odds conversion, and
label/feature shaping are exercised deterministically.
"""

from __future__ import annotations

import pandas as pd
import pytest

from hexa_ml import soccer_history_loader as sh


def _synthetic_csv() -> pd.DataFrame:
    """Two teams (AAA, BBB), one league-season, three matchdays.

    MD1: AAA 2-0 BBB (H)   MD2: BBB 2-2 AAA (D)   MD3: AAA 0-1 BBB (A)
    Decimal 1X2 odds in Bet365 columns.
    """
    return pd.DataFrame({
        "Date":     ["01/08/2023", "08/08/2023", "15/08/2023"],
        "HomeTeam": ["AAA", "BBB", "AAA"],
        "AwayTeam": ["BBB", "AAA", "BBB"],
        "FTHG":     [2, 2, 0],
        "FTAG":     [0, 2, 1],
        "FTR":      ["H", "D", "A"],
        "B365H":    [1.80, 2.50, 1.95],
        "B365D":    [3.50, 3.30, 3.60],
        "B365A":    [4.50, 2.80, 4.00],
    })


@pytest.fixture(autouse=True)
def _patch_fetch(monkeypatch):
    csv = _synthetic_csv()
    # Single league keeps the synthetic season deterministic.
    monkeypatch.setattr(sh, "_PRETRAIN_LEAGUES", ("eng.1",))
    monkeypatch.setattr(sh, "_fetch_csv", lambda div, year: csv.copy())
    sh.refresh_cache()
    yield
    sh.refresh_cache()


def test_parse_seasons_range_and_list():
    assert sh.parse_seasons("2016-2018") == [2016, 2017, 2018]
    assert sh.parse_seasons("2018,2020,2019") == [2018, 2019, 2020]
    assert sh.parse_seasons("") == sh.default_pretrain_years()


def test_season_code():
    assert sh._season_code(2023) == "2324"
    assert sh._season_code(1999) == "9900"


def test_dec_to_american_sign():
    # 1.80 decimal → -125 American (favorite); 4.50 → +350 (underdog).
    assert sh._dec_to_american(1.80) == pytest.approx(-125.0)
    assert sh._dec_to_american(4.50) == pytest.approx(350.0)
    assert sh._dec_to_american(2.00) == pytest.approx(100.0)


def test_training_frame_is_leakage_free_first_match():
    df = sh.build_soccer_training_frame("soccer_moneyline", [2023])
    assert len(df) == 3
    md1 = df.sort_values("game_date").iloc[0]
    # No prior matches → cumulative features must be NaN (no future leakage).
    assert pd.isna(md1["home_goals_for"])
    assert pd.isna(md1["away_points"])
    assert pd.isna(md1["home_last10_wins"])


def test_training_frame_as_of_cumulative():
    df = sh.build_soccer_training_frame("soccer_moneyline", [2023]).sort_values("game_date")
    md3 = df.iloc[2]  # AAA home, after 2 prior matches (W, D)
    assert md3["home_goals_for"] == pytest.approx(4.0)    # 2 + 2
    assert md3["home_goal_diff"] == pytest.approx(2.0)    # (2+2) - (0+2)
    assert md3["home_points"] == pytest.approx(4.0)       # 3 (win) + 1 (draw)
    assert md3["home_last10_wins"] == pytest.approx(1.0)  # one win in prior two
    assert md3["away_points"] == pytest.approx(1.0)       # BBB: L + D


def test_training_frame_odds_converted_to_american():
    df = sh.build_soccer_training_frame("soccer_moneyline", [2023]).sort_values("game_date")
    md1 = df.iloc[0]
    assert md1["odds_ml_home"] == pytest.approx(-125.0)   # 1.80 decimal
    assert md1["odds_ml_away"] == pytest.approx(350.0)    # 4.50 decimal
    assert md1["odds_ou_total"] == pytest.approx(2.5)     # fixed soccer line


def test_training_frame_market_type_and_shape():
    assert sh.build_soccer_training_frame("soccer_moneyline", [2023])["market_type"].iloc[0] == "moneyline"
    assert sh.build_soccer_training_frame("soccer_total", [2023])["market_type"].iloc[0] == "total"
    assert sh.build_soccer_training_frame("soccer_btts", [2023])["market_type"].iloc[0] == "btts"
    df = sh.build_soccer_training_frame("soccer_btts", [2023])
    assert (df["result"] == "resolved").all()
    assert (df["source"] == "soccer_history").all()


def test_unsupported_market_raises():
    with pytest.raises(ValueError):
        sh.build_soccer_training_frame("soccer_props", [2023])


def test_empty_when_no_csv(monkeypatch):
    def _boom(div, year):
        raise RuntimeError("unreachable")
    monkeypatch.setattr(sh, "_fetch_csv", _boom)
    sh.refresh_cache()
    df = sh.build_soccer_training_frame("soccer_moneyline", [2023])
    assert df.empty
