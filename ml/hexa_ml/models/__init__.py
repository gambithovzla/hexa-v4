"""Market-specific XGBoost model wrappers.

Each model class exposes the same interface:
  - .fit(X, y) → trains the booster + calibrator
  - .predict_proba(X) → calibrated P(class=1)
  - .save(path), .load(path) classmethod for persistence
"""

from .moneyline import MoneylineModel
from .overunder import OverUnderModel
from .runline import RunlineModel

MARKET_MODELS = {
    "moneyline": MoneylineModel,
    "overunder": OverUnderModel,
    "runline": RunlineModel,
}

__all__ = ["MoneylineModel", "OverUnderModel", "RunlineModel", "MARKET_MODELS"]
