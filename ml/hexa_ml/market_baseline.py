"""Reference forecasters to score every trained model against.

A Brier score in isolation says nothing. 0.24 sounds precise until you notice
that predicting 50% on every game scores 0.25, and that the closing line —
already stored in `pick_features` — usually scores a good deal better than
either. A model only has edge if it beats the market on the same rows, so the
training pipeline computes two reference forecasts on every test set:

  base rate  — the training-set mean, repeated for each test row. The floor
               that requires no information at all.
  market     — the de-vigged closing line. The bar that matters.

Neither is fabricated when the inputs are missing: a reference that cannot be
built honestly comes back as `unavailable` rather than a plausible-looking
default, because a fake baseline is worse than no baseline.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .metrics import american_to_implied, devig_two_way

# Markets whose target is "home side wins" and that store both prices, so the
# closing line can be de-vigged into a genuine fair probability.
_TWO_WAY_MONEYLINE = {"moneyline", "nfl_moneyline", "soccer_moneyline"}

# Markets priced around a line the book moves until both sides are ~even. The
# closing number itself is the forecast, and its fair probability is ~0.5 by
# construction. Beating this is beating the line, not the price.
_SYMMETRIC_LINE = {"nfl_spread", "overunder", "nfl_total", "soccer_total"}

# Historical frames whose odds columns are modelled, not observed. MLB
# pre-training fills odds_ml_home from a Pythagorean expectation derived from
# the same team-strength features the booster trains on — scoring against it
# would be scoring the model against itself.
_SYNTHETIC_ODDS_SOURCES = {"mlb_history"}


@dataclass
class MarketReference:
    """A reference forecast aligned row-for-row with a test frame."""

    probs: np.ndarray
    source: str
    n_covered: int
    coverage: float
    note: str = ""
    excluded_synthetic: int = 0


@dataclass
class BaselineReport:
    """Both references plus the comparisons, ready for the model card."""

    base_rate: float
    vs_base_rate: dict = field(default_factory=dict)
    vs_market: dict = field(default_factory=dict)
    market_source: str = "unavailable"
    market_coverage: float = 0.0
    market_note: str = ""


def _empty(n: int, note: str) -> MarketReference:
    return MarketReference(
        probs=np.full(n, np.nan),
        source="unavailable",
        n_covered=0,
        coverage=0.0,
        note=note,
    )


def _synthetic_mask(df: pd.DataFrame) -> np.ndarray:
    """Rows whose stored odds were computed rather than observed."""
    if "source" not in df.columns:
        return np.zeros(len(df), dtype=bool)
    return df["source"].isin(_SYNTHETIC_ODDS_SOURCES).to_numpy()


def resolve_market_reference(df: pd.DataFrame, market: str) -> MarketReference:
    """Build the de-vigged market forecast for `market` on the rows of `df`.

    The returned probabilities are oriented the same way as the training
    target: P(home wins) for moneyline, P(the favoured side of the line hits)
    for the symmetric-line markets, P(the pick wins) for props.
    """
    n = len(df)
    if n == 0:
        return _empty(0, "empty frame")

    if market in _TWO_WAY_MONEYLINE:
        if "odds_ml_home" not in df.columns or "odds_ml_away" not in df.columns:
            return _empty(n, "no two-way moneyline prices stored")

        home = pd.to_numeric(df["odds_ml_home"], errors="coerce").to_numpy()
        away = pd.to_numeric(df["odds_ml_away"], errors="coerce").to_numpy()

        synthetic = _synthetic_mask(df)
        home = np.where(synthetic, np.nan, home)
        away = np.where(synthetic, np.nan, away)

        fair = devig_two_way(american_to_implied(home), american_to_implied(away))
        covered = int(np.isfinite(fair).sum())
        note = "de-vigged closing moneyline"
        if synthetic.any():
            note += f"; {int(synthetic.sum())} synthetic-odds rows excluded"
        return MarketReference(
            probs=fair,
            source="devig_two_way" if covered else "unavailable",
            n_covered=covered,
            coverage=covered / n,
            note=note,
            excluded_synthetic=int(synthetic.sum()),
        )

    if market in _SYMMETRIC_LINE:
        return MarketReference(
            probs=np.full(n, 0.5),
            source="symmetric_line",
            n_covered=n,
            coverage=1.0,
            note=(
                "no two-way prices stored; the closing line is assumed fair at "
                "0.5, which is the honest reading of a balanced spread/total"
            ),
        )

    if market.startswith("prop_") or market == "nfl_prop":
        if "prop_odds_american" not in df.columns:
            return _empty(n, "no prop prices stored")
        price = pd.to_numeric(df["prop_odds_american"], errors="coerce").to_numpy()
        imp = american_to_implied(price)
        covered = int(np.isfinite(imp).sum())
        return MarketReference(
            probs=imp,
            source="one_way_vig_inclusive" if covered else "unavailable",
            n_covered=covered,
            coverage=covered / n,
            note=(
                "only one side of the prop is stored, so the vig cannot be "
                "removed; this reference is biased HIGH and therefore an "
                "easier bar than the true market"
            ),
        )

    return _empty(n, f"no market reference defined for '{market}'")


def build_baseline_report(
    y_train: np.ndarray,
    y_test: np.ndarray,
    p_test: np.ndarray,
    test_df: pd.DataFrame,
    market: str,
    n_boot: int = 10_000,
) -> BaselineReport:
    """Score `p_test` against both references on the held-out rows."""
    from .metrics import paired_brier_comparison

    base_rate = float(np.mean(y_train)) if len(y_train) else 0.5
    p_base = np.full(len(y_test), base_rate)

    ref = resolve_market_reference(test_df, market)

    return BaselineReport(
        base_rate=round(base_rate, 4),
        vs_base_rate=paired_brier_comparison(y_test, p_test, p_base, n_boot=n_boot),
        vs_market=paired_brier_comparison(y_test, p_test, ref.probs, n_boot=n_boot),
        market_source=ref.source,
        market_coverage=round(ref.coverage, 4),
        market_note=ref.note,
    )
