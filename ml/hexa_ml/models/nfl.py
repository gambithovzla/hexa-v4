"""NFL market models — moneyline, spread, and total.

Uses the same XGBoost + Platt calibration base as MLB models but with
stronger L2 regularization (NFL dataset is small until enough picks accumulate)
and NFL-specific feature engineering via features.build_X with nfl_* market keys.
"""

from __future__ import annotations

from .base import MarketModelBase

_NFL_PARAMS = {
    "objective":        "binary:logistic",
    "eval_metric":      "logloss",
    "max_depth":        3,
    "learning_rate":    0.05,
    "n_estimators":     300,
    "min_child_weight": 8,
    "subsample":        0.80,
    "colsample_bytree": 0.80,
    "reg_alpha":        0.5,
    "reg_lambda":       3.0,
    "tree_method":      "hist",
}


class NflMoneylineModel(MarketModelBase):
    market_key = "nfl_moneyline"
    default_params = _NFL_PARAMS  # type: ignore[assignment]


class NflSpreadModel(MarketModelBase):
    market_key = "nfl_spread"
    default_params = _NFL_PARAMS  # type: ignore[assignment]


class NflTotalModel(MarketModelBase):
    market_key = "nfl_total"
    default_params = _NFL_PARAMS  # type: ignore[assignment]
