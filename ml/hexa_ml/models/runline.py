"""Run-line (home covers -1.5) — XGBoost classifier with Platt calibration."""

from __future__ import annotations

from .base import MarketModelBase


class RunlineModel(MarketModelBase):
    """Target: 1 if home covers the -1.5 run line.

    Run-line is the noisiest market — a single late-inning HR flips it.
    Slightly larger trees and stronger L2 to combat overfitting given
    the small expected training set in v1.
    """

    market_key = "runline"
    default_params = {  # noqa: RUF012
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "max_depth": 4,
        "learning_rate": 0.05,
        "n_estimators": 350,
        "min_child_weight": 8,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.3,
        "reg_lambda": 2.0,
        "tree_method": "hist",
    }
