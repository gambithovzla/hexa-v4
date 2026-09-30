from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from hexa_ml.nfl_walk_forward import evaluate_nfl_walk_forward, _cluster_brier_delta


class ConstantModel:
    def fit(self, X_train, y_train, X_calib=None, y_calib=None):
        assert X_calib is not None
        assert len(X_calib) == len(y_calib)
        return self

    def predict_proba(self, X):
        return np.full(len(X), 0.55)


def sample_frame():
    rows = []
    for season in (2023, 2024, 2025):
        for week in range(1, 11):
            date = datetime(season, 9, 1) + timedelta(weeks=week - 1)
            for game in range(4):
                rows.append({
                    "game_date": date, "season": season, "week": week,
                    "game_pk": season * 1000 + week * 10 + game,
                    "market_type": "moneyline", "result": "resolved",
                    "source": "nflverse_history",
                    "home_score": 24 if game % 2 else 17, "away_score": 20,
                    "odds_ml_home": -110, "odds_ml_away": -110,
                })
    return pd.DataFrame(rows)


def test_walk_forward_keeps_fit_calibration_and_future_seasons_separate():
    report = evaluate_nfl_walk_forward(
        sample_frame(), "nfl_moneyline", model_factory=ConstantModel,
        min_fit=20, min_calibration=5, min_selection=5, min_test=10, n_boot=100,
    )
    assert [fold["test_season"] for fold in report["folds"]] == [2024, 2025]
    assert all(fold["status"] == "evaluated" for fold in report["folds"])
    for fold in report["folds"]:
        assert fold["fit_last_date"] < fold["calibration_first_date"] < fold["selection_first_date"] < fold["test_first_date"]
        assert fold["n_test"] == 40
        assert fold["vs_market"]["n"] == 40
        assert fold["price_roi"] is None
        assert fold["market_blend"]["model_weight_selected_on_prior_weeks"] in (0.0, 0.1, 0.25, 0.5, 1.0)
    assert report["promotion_ready"] is False


def test_week_cluster_bootstrap_does_not_claim_edge_without_reference():
    result = _cluster_brier_delta(
        np.array([1, 0, 1, 0]), np.array([.6, .4, .6, .4]),
        np.array([np.nan] * 4), np.array(["w1", "w1", "w2", "w2"]),
        n_boot=100, seed=1,
    )
    assert result["n"] == 0
    assert result["beats_reference"] is False
