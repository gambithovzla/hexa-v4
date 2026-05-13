"""Over/Under total runs — XGBoost classifier with Platt calibration."""

from __future__ import annotations

from .base import MarketModelBase


class OverUnderModel(MarketModelBase):
    """Target: 1 if total_runs > line (the OVER hits).

    Takes the betting `line` as a feature so the same model can score
    different totals (8.5 vs 9.5) for the same matchup.
    """

    market_key = "overunder"
    default_params = {  # noqa: RUF012
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "max_depth": 5,
        "learning_rate": 0.04,
        "n_estimators": 500,
        "min_child_weight": 5,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "tree_method": "hist",
    }
