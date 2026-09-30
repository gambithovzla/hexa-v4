from datetime import datetime, timedelta

import pandas as pd

from hexa_ml.nfl_market_residual import evaluate_nfl_market_residual


def _frame():
    rows = []
    for season in (2023, 2024, 2025):
        for week in range(1, 11):
            date = datetime(season, 9, 1) + timedelta(weeks=week - 1)
            for game in range(4):
                rows.append({
                    "game_date": date, "season": season, "week": week,
                    "game_pk": season * 1000 + week * 10 + game,
                    "market_type": "moneyline", "result": "resolved",
                    "source": "nflverse_history", "home_score": 24 if game % 2 else 17,
                    "away_score": 20, "odds_ml_home": -110, "odds_ml_away": -110,
                    "home_epa_off": 0.05 if game % 2 else -0.05,
                    "away_epa_off": 0.0,
                })
    return pd.DataFrame(rows)


def test_market_residual_never_uses_future_season_for_selection():
    report = evaluate_nfl_market_residual(
        _frame(), "nfl_moneyline", min_fit=20, min_selection=5,
        min_test=10, n_boot=100,
    )
    assert report["promotion_ready"] is False
    assert report["price_roi"] is None
    assert [fold["test_season"] for fold in report["folds"]] == [2024, 2025]
    for fold in report["folds"]:
        assert fold["status"] == "evaluated"
        assert fold["fit_last_date"] < fold["selection_first_date"] < fold["test_first_date"]
        assert fold["vs_market"]["n"] == 40
        assert fold["selected_shrinkage"] in (0.0, 0.25, 0.5, 1.0)
        assert fold["selected_alpha"] in (10.0, 100.0, 1000.0)


def test_market_residual_requires_a_real_two_sided_reference():
    frame = _frame().drop(columns=["odds_ml_away"])
    report = evaluate_nfl_market_residual(frame, "nfl_moneyline",
                                          min_fit=20, min_selection=5, min_test=10)
    assert all(fold["status"] == "market_reference_unavailable" for fold in report["folds"])
