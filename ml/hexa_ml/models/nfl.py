"""NFL market models — moneyline, spread, total, and pooled player props.

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


# Player props are pooled into a SINGLE model across all prop kinds (pass_yds,
# rush_yds, receptions, anytime_td, …). Per-kind models would each need their own
# 50-row floor — far too sparse for a brand-new market. Pooling + a prop_kind
# one-hot lets the model specialise while reaching the minimum sample sooner.
# Pick-aligned target: P(the bet side wins).
_NFL_PROP_PARAMS = {
    "objective":        "binary:logistic",
    "eval_metric":      "logloss",
    "max_depth":        4,
    "learning_rate":    0.05,
    "n_estimators":     350,
    "min_child_weight": 6,
    "subsample":        0.85,
    "colsample_bytree": 0.85,
    "reg_alpha":        0.3,
    "reg_lambda":       2.5,
    "tree_method":      "hist",
}


class NflPropModel(MarketModelBase):
    market_key = "nfl_prop"
    default_params = _NFL_PROP_PARAMS  # type: ignore[assignment]
