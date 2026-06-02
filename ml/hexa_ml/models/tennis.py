"""Tennis market models — match winner, set handicap, and total games.

Tennis is the platform's first individual sport. Same XGBoost + Platt
calibration base as the other sports, with strong L2 regularization (the live
dataset is small until picks accumulate). Unlike the team sports, the tennis
sidecar can be PRE-TRAINED from Jeff Sackmann's historical match data (surface
ELO → outcome) so a useful model exists from day one — see train.py and
docs/tennis-roadmap.md (Sprint 12e). Feature engineering lives in
features.build_X under the tennis_* market keys (player A = "home" slot).
"""

from __future__ import annotations

from .base import MarketModelBase

_TENNIS_PARAMS = {
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


class TennisMoneylineModel(MarketModelBase):
    market_key = "tennis_moneyline"
    default_params = _TENNIS_PARAMS  # type: ignore[assignment]


class TennisSetHandicapModel(MarketModelBase):
    market_key = "tennis_set_handicap"
    default_params = _TENNIS_PARAMS  # type: ignore[assignment]


class TennisTotalGamesModel(MarketModelBase):
    market_key = "tennis_total_games"
    default_params = _TENNIS_PARAMS  # type: ignore[assignment]
