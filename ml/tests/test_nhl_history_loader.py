"""Tests for nhl_history_loader — pure functions only (no network)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from hexa_ml import nhl_history_loader as nhl
from hexa_ml.data import filter_for_market, make_target
from hexa_ml.features import build_X, feature_columns


def _payload(games):
    return {"games": games}


def _game(gid, date, home, away, hs, as_, game_type=2, last_period="REG", abbr_key="abbrev"):
    return {
        "id": gid,
        "gameType": game_type,
        "gameDate": date,
        "homeTeam": {abbr_key: home, "score": hs},
        "awayTeam": {abbr_key: away, "score": as_},
        "gameOutcome": {"lastPeriodType": last_period},
    }


def test_parse_schedule_payload_filters_and_normalizes():
    games = nhl.parse_schedule_payload(_payload([
        _game(1, "2023-10-10", "TOR", "MTL", 4, 2),
        _game(2, "2023-10-12", "TOR", "BOS", 1, 3, game_type=1),     # preseason → dropped
        {"id": 3, "gameType": 2, "homeTeam": {"abbrev": "TOR"}, "awayTeam": {"abbrev": "NYR"}},  # no score → dropped
        _game(4, "2023-10-14", "NYR", "TOR", 2, 3, last_period="OT", abbr_key="triCode"),
    ]))
    assert [g["game_id"] for g in games] == [1, 4]
    assert games[0]["home_abbr"] == "TOR" and games[0]["away_score"] == 2
    assert games[1]["home_abbr"] == "NYR"  # triCode key variant tolerated
    assert games[1]["last_period_type"] == "OT"


def test_parse_schedule_payload_tolerates_garbage():
    assert nhl.parse_schedule_payload({}) == []
    assert nhl.parse_schedule_payload({"games": "nope"}) == []
    assert nhl.parse_schedule_payload({"games": [None, 42, {}]}) == []


def test_season_rows_are_leakage_free():
    rows = nhl.season_rows([
        {"game_id": 1, "game_date": "2023-10-10", "home_abbr": "TOR", "away_abbr": "MTL",
         "home_score": 4, "away_score": 2, "last_period_type": "REG"},
        {"game_id": 2, "game_date": "2023-10-12", "home_abbr": "MTL", "away_abbr": "TOR",
         "home_score": 3, "away_score": 1, "last_period_type": "REG"},
    ])
    # First game: neither team has prior data → NaN features
    assert np.isnan(rows[0]["home_goal_diff"]) and np.isnan(rows[0]["away_gf_per_game"])
    # Second game: snapshots reflect ONLY game 1 (not game 2's own result)
    assert rows[1]["home_goal_diff"] == -2.0   # MTL after losing 2-4
    assert rows[1]["away_goal_diff"] == 2.0    # TOR after winning 4-2
    assert rows[1]["away_gf_per_game"] == 4.0
    assert rows[1]["home_points_pct"] == 0.0
    assert rows[1]["away_points_pct"] == 1.0


def test_season_rows_ot_loser_point_and_b2b():
    rows = nhl.season_rows([
        {"game_id": 1, "game_date": "2023-10-10", "home_abbr": "TOR", "away_abbr": "MTL",
         "home_score": 2, "away_score": 3, "last_period_type": "SO"},
        {"game_id": 2, "game_date": "2023-10-11", "home_abbr": "TOR", "away_abbr": "BOS",
         "home_score": 5, "away_score": 1, "last_period_type": "REG"},
    ])
    # TOR lost in SO → 1 point of 2 possible → points_pct 0.5; played yesterday → B2B
    assert rows[1]["home_points_pct"] == 0.5
    assert rows[1]["home_rest_days"] == 1.0
    assert rows[1]["home_is_b2b"] == 1.0
    # BOS has no prior games → rest NaN
    assert np.isnan(rows[1]["away_rest_days"])


def _synthetic_frame(market: str, n: int = 80) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    games = []
    teams = ["TOR", "MTL", "BOS", "NYR", "EDM", "COL"]
    date = pd.Timestamp("2023-10-01")
    for i in range(n):
        home, away = rng.choice(teams, size=2, replace=False)
        games.append({
            "game_id": i, "game_date": str(date.date()),
            "home_abbr": home, "away_abbr": away,
            "home_score": int(rng.integers(0, 7)), "away_score": int(rng.integers(0, 7)),
            "last_period_type": "REG",
        })
        date += pd.Timedelta(days=1)
    frame = pd.DataFrame(nhl.season_rows(games))
    frame["market_type"] = "moneyline" if market == "nhl_moneyline" else "puckline"
    frame["result"] = "resolved"
    frame["source"] = "nhl_history"
    return frame


@pytest.mark.parametrize("market", ["nhl_moneyline", "nhl_puckline"])
def test_frame_flows_through_filter_target_and_build_x(market):
    frame = _synthetic_frame(market)
    sub = filter_for_market(frame, market)
    assert len(sub) == len(frame)

    y = make_target(sub, market)
    assert set(y.unique()).issubset({0, 1})
    if market == "nhl_puckline":
        expected = (sub["home_score"] - sub["away_score"] > 1.5).astype(int)
        assert (y == expected).all()

    X = build_X(sub, market)
    assert list(X.columns) == feature_columns(market)
    assert X["nhl_goal_diff_delta"].notna().sum() > 0
    assert X["points_pct_diff"].notna().sum() > 0


def test_build_nhl_training_frame_rejects_unknown_market():
    with pytest.raises(ValueError):
        nhl.build_nhl_training_frame("nhl_total", [2023])


def test_parse_seasons():
    assert nhl.parse_seasons("2018-2020") == [2018, 2019, 2020]
    assert nhl.parse_seasons("2021,2019") == [2019, 2021]
    assert len(nhl.parse_seasons("")) == 8
