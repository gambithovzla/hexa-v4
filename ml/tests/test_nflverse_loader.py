"""Tests for the nflverse loader — no network.

The pbp fetch is monkeypatched with a tiny synthetic play-by-play frame so the
aggregation, leakage-free as-of logic, and label/feature shaping are exercised
deterministically.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from hexa_ml import nflverse_loader as nv


def _synthetic_pbp() -> pd.DataFrame:
    """Two teams (AAA, BBB), one season, three weeks, one game per week.

    Each game has 2 plays per team so aggregates are easy to reason about.
    """
    rows = []
    games = [
        ("2023_01_BBB_AAA", 1, "AAA", "BBB", 24, 17, 3.0, 44.0),
        ("2023_02_AAA_BBB", 2, "BBB", "AAA", 20, 21, -1.0, 41.0),
        ("2023_03_BBB_AAA", 3, "AAA", "BBB", 10, 27, 6.0, 38.0),
    ]
    for gid, wk, home, away, hs, as_, spread, total in games:
        for posteam, defteam, epa, succ, poe in [
            (home, away, 0.10, 1, 2.0),
            (home, away, -0.05, 0, -1.0),
            (away, home, 0.20, 1, 5.0),
            (away, home, 0.00, 0, 0.0),
        ]:
            rows.append({
                "game_id": gid, "season": 2023, "week": wk, "season_type": "REG",
                "game_date": f"2023-09-{wk:02d}", "roof": "outdoors", "div_game": 0,
                "home_team": home, "away_team": away,
                "home_score": hs, "away_score": as_,
                "spread_line": spread, "total_line": total,
                "posteam": posteam, "defteam": defteam,
                "play_type": "pass", "epa": epa, "success": succ, "pass_oe": poe,
            })
    return pd.DataFrame(rows)


@pytest.fixture(autouse=True)
def _patch_pbp(monkeypatch):
    pbp = _synthetic_pbp()
    monkeypatch.setattr(nv, "_NFLVERSE_AVAILABLE", True)
    monkeypatch.setattr(nv, "_fetch_pbp_year", lambda year: pbp.copy())
    nv.refresh_team_stats()
    yield
    nv.refresh_team_stats()


def test_parse_seasons_range_and_list():
    assert nv.parse_seasons("2016-2018") == [2016, 2017, 2018]
    assert nv.parse_seasons("2018,2020,2019") == [2018, 2019, 2020]
    assert nv.parse_seasons("") == nv.default_pretrain_years()


def test_build_team_stats_keys_by_abbr():
    payload = nv.build_team_stats(2023)
    assert payload["season"] == 2023
    assert set(payload["teams"].keys()) == {"AAA", "BBB"}
    aaa = payload["teams"]["AAA"]
    # AAA runs offense in all 3 games: home plays (0.10, -0.05) in wk1+wk3 and
    # away plays (0.20, 0.00) in wk2 → mean of 6 plays = 0.30/6 = 0.05.
    assert aaa["epa_off"] == pytest.approx(0.05, abs=1e-6)
    assert aaa["games_played"] == 3
    assert aaa["proe"] is not None


def test_opponent_adjusted_epa_season():
    payload = nv.build_team_stats(2023)
    aaa = payload["teams"]["AAA"]
    # AAA offense (raw 0.05) faced only BBB's defense (raw allowed 0.05), which is
    # better than the league mean (0.0625) → adjusted EPA gets a small boost.
    # adj = raw_epa − (opp_def − league_mean) = 0.05 − (0.05 − 0.0625) = 0.0625.
    assert aaa["epa_off_adj"] == pytest.approx(0.0625, abs=1e-6)
    # SOS = mean opposing defensive EPA faced (lower = tougher slate).
    assert aaa["sos_off"] == pytest.approx(0.05, abs=1e-6)
    assert aaa["epa_def_adj"] is not None


def test_training_frame_has_adjusted_epa_columns_leakage_free():
    df = nv.build_nfl_training_frame("nfl_moneyline", [2023])
    for col in ("home_epa_off_adj", "away_epa_off_adj", "home_epa_def_adj", "away_epa_def_adj"):
        assert col in df.columns
    wk1 = df[df["week"] == 1].iloc[0]
    # No prior weeks → adjusted EPA must be NaN for week 1 (no future leakage).
    assert pd.isna(wk1["home_epa_off_adj"])
    wk3 = df[df["week"] == 3].iloc[0]
    assert not pd.isna(wk3["home_epa_off_adj"])


def test_training_frame_is_leakage_free_week1():
    df = nv.build_nfl_training_frame("nfl_moneyline", [2023])
    assert len(df) == 3
    wk1 = df[df["week"] == 1].iloc[0]
    # No prior weeks → EPA features must be NaN for week 1 (no future leakage).
    assert pd.isna(wk1["home_epa_off"])
    assert pd.isna(wk1["away_epa_def"])
    wk3 = df[df["week"] == 3].iloc[0]
    assert not pd.isna(wk3["home_epa_off"])


def test_training_frame_spread_sign_and_total():
    df = nv.build_nfl_training_frame("nfl_spread", [2023])
    row = df[df["week"] == 1].iloc[0]
    # nflverse spread_line=3 (home favored by 3) → American home spread -3.
    assert row["spread_close"] == pytest.approx(-3.0)
    assert row["total_close"] == pytest.approx(44.0)
    assert row["total_runs"] == pytest.approx(row["home_score"] + row["away_score"])
    assert row["market_type"] == "spread"


def test_training_frame_market_type_mapping():
    assert nv.build_nfl_training_frame("nfl_total", [2023])["market_type"].iloc[0] == "overunder"
    assert nv.build_nfl_training_frame("nfl_moneyline", [2023])["market_type"].iloc[0] == "moneyline"


def test_unsupported_market_raises():
    with pytest.raises(ValueError):
        nv.build_nfl_training_frame("nfl_props", [2023])


def _synthetic_player_weeks() -> pd.DataFrame:
    """Two players, REG weeks 1-3, easy-to-reason averages."""
    return pd.DataFrame({
        "player_display_name": ["Patrick Mahomes"] * 3 + ["Christian McCaffrey"] * 3,
        "player_id": ["1"] * 3 + ["2"] * 3,
        "position": ["QB"] * 3 + ["RB"] * 3,
        "season": [2024] * 6,
        "week": [1, 2, 3, 1, 2, 3],
        "season_type": ["REG"] * 6,
        "passing_yards": [300, 280, 260, 0, 0, 0],
        "passing_tds": [3, 2, 1, 0, 0, 0],
        "completions": [25, 22, 20, 0, 0, 0],
        "attempts": [35, 33, 30, 0, 0, 0],
        "interceptions": [1, 0, 1, 0, 0, 0],
        "rushing_yards": [10, 5, 8, 95, 110, 80],
        "carries": [2, 1, 2, 20, 22, 18],
        "rushing_tds": [0, 0, 1, 1, 2, 0],
        "receiving_yards": [0, 0, 0, 40, 30, 55],
        "receptions": [0, 0, 0, 5, 4, 6],
        "targets": [0, 0, 0, 6, 5, 7],
        "receiving_tds": [0, 0, 0, 0, 1, 1],
    })


def test_build_player_stats_season_recent_and_anytime_td(monkeypatch):
    monkeypatch.setattr(nv, "_NFLVERSE_AVAILABLE", True)
    monkeypatch.setattr(nv, "_load_player_weeks", lambda season: _synthetic_player_weeks())
    nv.refresh_team_stats()  # clear caches

    payload = nv.build_player_stats(2024)
    players = payload["players"]

    mahomes = players["patrick mahomes"]
    assert mahomes["games"] == 3
    assert mahomes["season_avg"]["pass_yds"] == 280.0
    assert mahomes["season_avg"]["pass_tds"] == 2.0

    cmc = players["christian mccaffrey"]
    assert cmc["season_avg"]["rush_yds"] == round((95 + 110 + 80) / 3, 3)
    # anytime_td = rushing_tds + receiving_tds, averaged over games
    assert cmc["season_avg"]["anytime_td"] == round((1 + 3 + 1) / 3, 3)
    # recent_avg over the last <=4 games equals season here (3 games)
    assert cmc["recent_avg"]["receptions"] == round((5 + 4 + 6) / 3, 3)
