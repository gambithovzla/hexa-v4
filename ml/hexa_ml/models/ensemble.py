"""Meta-learner that combines the prediction sources we collect today:

  1. Oracle (Claude / Grok dual LLM)          → oracle_pick_prob
  2. Legacy deterministic validator           → legacy_pick_prob
  3. Python XGBoost market model              → python_pick_prob

The ensemble takes the source probabilities as inputs and returns a single
calibrated probability. A LogisticRegression learns per-source weights from
the resolved rows in shadow_model_runs (Sprint 3 schema).

Adaptive source count (2026-05-31): the Legacy validator (xgboostValidator.js)
only scores moneyline — it has no concept of totals, run lines or player
props. So the ensemble is now N-source: moneyline uses all 3 sources, while
over/under, run line and props use a 2-source ensemble (Oracle + Python).
`MARKET_SOURCES` is the single source of truth for which sources each market
uses, shared across data.py / train_ensemble.py / predict.py.

Why LogisticRegression:
  - Few inputs → over-fitting is unlikely with enough rows.
  - The learned coefficients map cleanly to "weight per source", which is
    exactly the dashboard story we want to tell.
  - Inputs are pushed through a logit transform first, so the LR operates
    on log-odds — that keeps the relationship between inputs and output
    linear in the natural geometry of probability.

Persistence is identical to the per-market XGBoost models: one .pkl per
market with metrics attached, so the Python sidecar's existing reload
pipeline works without modification. The .pkl now also stores
`source_columns` so a loaded ensemble knows how many inputs it expects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression


SOURCE_NAMES = ("oracle", "legacy", "python")

# Which sources each market's ensemble uses. Legacy only scores moneyline,
# so the value markets fall back to a 2-source ensemble of Oracle + Python.
MARKET_SOURCES: dict[str, tuple[str, ...]] = {
    "moneyline": ("oracle", "legacy", "python"),
    "overunder": ("oracle", "python"),
    "runline":   ("oracle", "python"),
    "prop":      ("oracle", "python"),
}

# Maps a logical source name to its pick-aligned column in shadow_model_runs.
SOURCE_COLUMN = {
    "oracle": "oracle_pick_prob",
    "legacy": "legacy_pick_prob",
    "python": "python_pick_prob",
}


def sources_for_market(market: str) -> tuple[str, ...]:
    """Return the ordered tuple of sources an ensemble uses for `market`."""
    return MARKET_SOURCES.get(market, ("oracle", "legacy", "python"))


def _logit(p: np.ndarray) -> np.ndarray:
    """Push probabilities into log-odds space."""
    eps = 1e-6
    clipped = np.clip(p, eps, 1 - eps)
    return np.log(clipped / (1 - clipped))


@dataclass
class EnsembleMetrics:
    """Persisted alongside the model so the dashboard can compare sources."""

    market: str
    n_train: int
    n_test: int
    brier_train: float = 0.0
    brier_test: float = 0.0
    brier_oracle: float = 0.0
    brier_legacy: float = 0.0
    brier_python: float = 0.0
    coef_oracle: float = 0.0
    coef_legacy: float = 0.0
    coef_python: float = 0.0
    intercept: float = 0.0
    trained_at: str = ""
    source_columns: list[str] = field(default_factory=lambda: list(SOURCE_NAMES))


class EnsembleMetaLearner:
    """Per-market logistic-regression meta-learner.

    Inputs: 3 source probabilities in [0, 1].
    Output: 1 calibrated probability in [0, 1].

    The ensemble is only ever loaded once enough resolved rows have all
    three sources populated. Until then the artifact does not exist and
    the Node endpoint falls back transparently.
    """

    def __init__(
        self,
        market: str = "moneyline",
        C: float = 1.0,
        source_columns: tuple[str, ...] | list[str] | None = None,
    ) -> None:
        self.market = market
        self.source_columns: tuple[str, ...] = (
            tuple(source_columns) if source_columns else sources_for_market(market)
        )
        self.model = LogisticRegression(solver="lbfgs", C=C, max_iter=1000)
        self.fitted = False
        self.metrics: EnsembleMetrics | None = None

    @property
    def n_sources(self) -> int:
        return len(self.source_columns)

    # ── Training ──────────────────────────────────────────────────────────
    def fit(self, X_probs: np.ndarray, y: np.ndarray) -> "EnsembleMetaLearner":
        """Fit on (n, k) array of source probabilities + (n,) binary outcome.

        k must equal len(self.source_columns) — 3 for moneyline, 2 for the
        value markets (oracle + python).
        """
        if X_probs.ndim != 2 or X_probs.shape[1] != self.n_sources:
            raise ValueError(
                f"Expected X_probs shape (n, {self.n_sources}), got {X_probs.shape}. "
                f"Order: {', '.join(self.source_columns)}."
            )
        X = _logit(X_probs)
        self.model.fit(X, y)
        self.fitted = True
        return self

    # ── Inference ─────────────────────────────────────────────────────────
    def predict_proba(self, X_probs: np.ndarray) -> np.ndarray:
        """Return calibrated probabilities for one or more rows."""
        if not self.fitted:
            raise RuntimeError(f"Ensemble {self.market} is not fitted")
        X_probs = np.atleast_2d(X_probs)
        if X_probs.shape[1] != self.n_sources:
            raise ValueError(
                f"Expected {self.n_sources} source probs, got {X_probs.shape[1]}"
            )
        X = _logit(X_probs)
        return self.model.predict_proba(X)[:, 1]

    def predict_sources(self, source_probs: dict[str, float]) -> float:
        """Single-row inference from a {source_name: prob} mapping.

        Only the sources in self.source_columns are read, in order.
        """
        missing = [s for s in self.source_columns if source_probs.get(s) is None]
        if missing:
            raise ValueError(
                f"Ensemble {self.market} needs sources {self.source_columns}; "
                f"missing {missing}"
            )
        arr = np.array(
            [[float(source_probs[s]) for s in self.source_columns]], dtype=float
        )
        return float(self.predict_proba(arr)[0])

    def predict_one(self, oracle: float, legacy: float, python: float) -> float:
        """Backwards-compatible 3-source wrapper (moneyline path)."""
        return self.predict_sources(
            {"oracle": oracle, "legacy": legacy, "python": python}
        )

    # ── Weights / interpretability ────────────────────────────────────────
    def weights(self) -> dict[str, float]:
        """Return per-source coefficients on the logit scale.

        Only the sources this ensemble actually uses appear (plus intercept).
        Bigger coefficient = the ensemble trusts that source more.
        Negative coefficient = the source disagrees with the truth on
        average (sign-flipped contribution).
        """
        if not self.fitted:
            base: dict[str, float] = {name: 0.0 for name in self.source_columns}
            base["intercept"] = 0.0
            return base
        coefs = self.model.coef_[0]
        out = {name: float(coefs[i]) for i, name in enumerate(self.source_columns)}
        out["intercept"] = float(self.model.intercept_[0])
        return out

    # ── Persistence ───────────────────────────────────────────────────────
    def save(self, dir_path: str | Path) -> Path:
        dir_path = Path(dir_path)
        dir_path.mkdir(parents=True, exist_ok=True)
        out = dir_path / f"ensemble_{self.market}.pkl"
        joblib.dump(
            {
                "market": self.market,
                "model": self.model,
                "fitted": self.fitted,
                "metrics": self.metrics,
                "source_columns": list(self.source_columns),
            },
            out,
        )
        return out

    @classmethod
    def load(cls, path: str | Path) -> "EnsembleMetaLearner":
        payload = joblib.load(path)
        # Older artifacts predate source_columns → derive from the market
        # (moneyline → 3 sources), preserving backwards compatibility.
        ens = cls(
            market=payload["market"],
            source_columns=payload.get("source_columns"),
        )
        ens.model = payload["model"]
        ens.fitted = payload["fitted"]
        ens.metrics = payload.get("metrics")
        return ens
