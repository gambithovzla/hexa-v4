"""MLB player-prop market models (binary win/loss on the selected side)."""

from __future__ import annotations

from .base import MarketModelBase


class _BasePropModel(MarketModelBase):
    default_params = {  # noqa: RUF012
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "max_depth": 4,
        "learning_rate": 0.05,
        "n_estimators": 350,
        "min_child_weight": 5,
        "subsample": 0.9,
        "colsample_bytree": 0.9,
        "reg_alpha": 0.2,
        "reg_lambda": 1.8,
        "tree_method": "hist",
    }


class PropHitsModel(_BasePropModel):
    market_key = "prop_hits"


class PropStrikeoutsModel(_BasePropModel):
    market_key = "prop_strikeouts"


class PropTotalBasesModel(_BasePropModel):
    market_key = "prop_total_bases"


class PropHomeRunsModel(_BasePropModel):
    market_key = "prop_home_runs"


class PropRbisModel(_BasePropModel):
    market_key = "prop_rbis"
