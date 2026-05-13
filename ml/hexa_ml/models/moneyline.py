"""Moneyline (binary: home wins) — XGBoost classifier with Platt calibration."""

from __future__ import annotations

from .base import MarketModelBase


class MoneylineModel(MarketModelBase):
    """Target: 1 if home team wins.

    Stronger regularization than O/U because pitcher matchup variance
    dominates and the signal-to-noise ratio is lower than total runs.
    """

    market_key = "moneyline"
    default_params = {  # noqa: RUF012
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "max_depth": 4,
        "learning_rate": 0.05,
        "n_estimators": 400,
        "min_child_weight": 6,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_alpha": 0.2,
        "reg_lambda": 1.5,
        "tree_method": "hist",
    }
