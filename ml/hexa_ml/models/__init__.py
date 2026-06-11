"""Market-specific XGBoost model wrappers.

Each model class exposes the same interface:
  - .fit(X, y) → trains the booster + calibrator
  - .predict_proba(X) → calibrated P(class=1)
  - .save(path), .load(path) classmethod for persistence
"""

from .moneyline import MoneylineModel
from .overunder import OverUnderModel
from .runline import RunlineModel
from .props import (
    PropHitsModel,
    PropStrikeoutsModel,
    PropTotalBasesModel,
    PropHomeRunsModel,
    PropRbisModel,
)
from .nfl import NflMoneylineModel, NflSpreadModel, NflTotalModel, NflPropModel
from .nhl import NhlMoneylineModel, NhlPucklineModel, NhlTotalModel
from .soccer import SoccerMoneylineModel, SoccerTotalModel, SoccerBttsModel
from .tennis import TennisMoneylineModel, TennisSetHandicapModel, TennisTotalGamesModel

MARKET_MODELS = {
    "moneyline": MoneylineModel,
    "overunder": OverUnderModel,
    "runline": RunlineModel,
    "prop_hits": PropHitsModel,
    "prop_strikeouts": PropStrikeoutsModel,
    "prop_total_bases": PropTotalBasesModel,
    "prop_home_runs": PropHomeRunsModel,
    "prop_rbis": PropRbisModel,
    "nfl_moneyline": NflMoneylineModel,
    "nfl_spread": NflSpreadModel,
    "nfl_total": NflTotalModel,
    "nfl_prop": NflPropModel,
    "nhl_moneyline": NhlMoneylineModel,
    "nhl_puckline": NhlPucklineModel,
    "nhl_total": NhlTotalModel,
    "soccer_moneyline": SoccerMoneylineModel,
    "soccer_total": SoccerTotalModel,
    "soccer_btts": SoccerBttsModel,
    "tennis_moneyline": TennisMoneylineModel,
    "tennis_set_handicap": TennisSetHandicapModel,
    "tennis_total_games": TennisTotalGamesModel,
}

__all__ = [
    "MoneylineModel",
    "OverUnderModel",
    "RunlineModel",
    "PropHitsModel",
    "PropStrikeoutsModel",
    "PropTotalBasesModel",
    "PropHomeRunsModel",
    "PropRbisModel",
    "NflMoneylineModel",
    "NflSpreadModel",
    "NflTotalModel",
    "NflPropModel",
    "NhlMoneylineModel",
    "NhlPucklineModel",
    "NhlTotalModel",
    "SoccerMoneylineModel",
    "SoccerTotalModel",
    "SoccerBttsModel",
    "TennisMoneylineModel",
    "TennisSetHandicapModel",
    "TennisTotalGamesModel",
    "MARKET_MODELS",
]
