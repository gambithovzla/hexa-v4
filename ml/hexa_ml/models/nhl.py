"""NHL market models — moneyline (home wins), puck line (home -1.5), total.

Same XGBoost + Platt calibration base as the NFL/Soccer models. Strong L2
regularization: moneyline/puckline pre-train on ~8 seasons of NHL history
(no odds columns — score-derived features only), total starts from live
picks and stays small for a while.
"""

from __future__ import annotations

from .base import MarketModelBase

_NHL_PARAMS = {
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


class NhlMoneylineModel(MarketModelBase):
    market_key = "nhl_moneyline"
    default_params = _NHL_PARAMS  # type: ignore[assignment]


class NhlPucklineModel(MarketModelBase):
    market_key = "nhl_puckline"
    default_params = _NHL_PARAMS  # type: ignore[assignment]


class NhlTotalModel(MarketModelBase):
    market_key = "nhl_total"
    default_params = _NHL_PARAMS  # type: ignore[assignment]
