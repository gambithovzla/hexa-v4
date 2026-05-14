"""Meta-learner that combines the 3 sources of prediction we collect today:

  1. Oracle (Claude / Grok dual LLM)          → oracle_home_win_prob
  2. Legacy deterministic validator           → shadow_home_win_prob
  3. Python XGBoost market model              → python_model_score

The ensemble takes those three probabilities as inputs and returns a single
calibrated probability. A LogisticRegression learns per-source weights from
the resolved rows in shadow_model_runs (Sprint 3 schema).

Why LogisticRegression:
  - 3 inputs only → over-fitting is unlikely with 500+ rows.
  - The learned coefficients map cleanly to "weight per source", which is
    exactly the dashboard story we want to tell.
  - Inputs are pushed through a logit transform first, so the LR operates
    on log-odds — that keeps the relationship between inputs and output
    linear in the natural geometry of probability.

Persistence is identical to the per-market XGBoost models: one .pkl per
market with metrics attached, so the Python sidecar's existing reload
pipeline works without modification.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression


SOURCE_NAMES = ("oracle", "legacy", "python")


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

    def __init__(self, market: str = "moneyline", C: float = 1.0) -> None:
        self.market = market
        self.model = LogisticRegression(solver="lbfgs", C=C, max_iter=1000)
        self.fitted = False
        self.metrics: EnsembleMetrics | None = None

    # ── Training ──────────────────────────────────────────────────────────
    def fit(self, X_probs: np.ndarray, y: np.ndarray) -> "EnsembleMetaLearner":
        """Fit on (n, 3) array of source probabilities + (n,) binary outcome."""
        if X_probs.ndim != 2 or X_probs.shape[1] != 3:
            raise ValueError(
                f"Expected X_probs shape (n, 3), got {X_probs.shape}. "
                "Order: oracle, legacy, python."
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
        if X_probs.shape[1] != 3:
            raise ValueError(f"Expected 3 source probs, got {X_probs.shape[1]}")
        X = _logit(X_probs)
        return self.model.predict_proba(X)[:, 1]

    def predict_one(self, oracle: float, legacy: float, python: float) -> float:
        """Convenience wrapper for the single-row inference path."""
        arr = np.array([[oracle, legacy, python]], dtype=float)
        return float(self.predict_proba(arr)[0])

    # ── Weights / interpretability ────────────────────────────────────────
    def weights(self) -> dict[str, float]:
        """Return per-source coefficients on the logit scale.

        Bigger coefficient = the ensemble trusts that source more.
        Negative coefficient = the source disagrees with the truth on
        average (sign-flipped contribution).
        """
        if not self.fitted:
            return {name: 0.0 for name in SOURCE_NAMES}
        coefs = self.model.coef_[0]
        return {
            "oracle": float(coefs[0]),
            "legacy": float(coefs[1]),
            "python": float(coefs[2]),
            "intercept": float(self.model.intercept_[0]),
        }

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
            },
            out,
        )
        return out

    @classmethod
    def load(cls, path: str | Path) -> "EnsembleMetaLearner":
        payload = joblib.load(path)
        ens = cls(market=payload["market"])
        ens.model = payload["model"]
        ens.fitted = payload["fitted"]
        ens.metrics = payload.get("metrics")
        return ens
