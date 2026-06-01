"""Soccer market models — moneyline (1X2 home wins), total (O/U goals), BTTS.

Uses the same XGBoost + Platt calibration base as the NFL models.
Strong L2 regularization since the soccer dataset starts small.
Soccer features come from features.build_X with soccer_* market keys.
"""

from __future__ import annotations

from .base import MarketModelBase

_SOCCER_PARAMS = {
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


class SoccerMoneylineModel(MarketModelBase):
    market_key = "soccer_moneyline"
    default_params = _SOCCER_PARAMS  # type: ignore[assignment]


class SoccerTotalModel(MarketModelBase):
    market_key = "soccer_total"
    default_params = _SOCCER_PARAMS  # type: ignore[assignment]


class SoccerBttsModel(MarketModelBase):
    market_key = "soccer_btts"
    default_params = _SOCCER_PARAMS  # type: ignore[assignment]
