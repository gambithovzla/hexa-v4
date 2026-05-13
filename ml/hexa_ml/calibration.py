"""Probability calibration and evaluation metrics.

XGBoost's raw probabilities are usually overconfident. Platt scaling
(logistic regression on out-of-fold scores) flattens them so the
predicted prob lines up with empirical hit rate. The same calibrator
is saved alongside the booster and applied at inference time.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss


@dataclass
class CalibrationCurvePoint:
    """One bucket on the reliability diagram."""

    bucket_low: float
    bucket_high: float
    predicted_mean: float
    actual_rate: float
    n: int


class PlattCalibrator:
    """Wrap a LogisticRegression so a single fitted object is portable.

    Trained on (raw_score, y_true) pairs. At inference time, .transform()
    pushes raw probs through the sigmoid and returns calibrated probs.
    """

    def __init__(self) -> None:
        self.model = LogisticRegression(solver="lbfgs", C=1.0, max_iter=1000)
        self.fitted = False

    def fit(self, raw_probs: np.ndarray, y_true: np.ndarray) -> "PlattCalibrator":
        # Logit-transform raw probs into a 1D regressor input
        eps = 1e-6
        clipped = np.clip(raw_probs, eps, 1 - eps)
        logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
        self.model.fit(logits, y_true)
        self.fitted = True
        return self

    def transform(self, raw_probs: np.ndarray) -> np.ndarray:
        if not self.fitted:
            return raw_probs
        eps = 1e-6
        clipped = np.clip(raw_probs, eps, 1 - eps)
        logits = np.log(clipped / (1 - clipped)).reshape(-1, 1)
        return self.model.predict_proba(logits)[:, 1]


def brier(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Brier score — lower is better. Random binary classifier ≈ 0.25."""
    return float(brier_score_loss(y_true, y_pred))


def logloss(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Log-loss, with clipping so a single 0/1 doesn't blow it up."""
    eps = 1e-15
    return float(log_loss(y_true, np.clip(y_pred, eps, 1 - eps)))


def reliability_diagram(
    y_true: np.ndarray, y_pred: np.ndarray, n_buckets: int = 10
) -> list[CalibrationCurvePoint]:
    """Build a reliability diagram for plotting.

    Buckets predictions in [0, 1] into `n_buckets` equal-width bins,
    and reports the predicted mean vs the actual hit rate per bin.
    Empty buckets are dropped.
    """
    edges = np.linspace(0, 1, n_buckets + 1)
    points: list[CalibrationCurvePoint] = []

    for i in range(n_buckets):
        lo, hi = edges[i], edges[i + 1]
        mask = (y_pred >= lo) & (y_pred < hi) if i < n_buckets - 1 else (y_pred >= lo) & (y_pred <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        predicted_mean = float(y_pred[mask].mean())
        actual_rate = float(y_true[mask].mean())
        points.append(
            CalibrationCurvePoint(
                bucket_low=float(lo),
                bucket_high=float(hi),
                predicted_mean=predicted_mean,
                actual_rate=actual_rate,
                n=n,
            )
        )

    return points


def kelly_roi(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    odds_american: np.ndarray,
    kelly_fraction: float = 0.25,
) -> float:
    """Simulate ROI on the test set with fractional Kelly staking.

    Assumes the bet is taken at `odds_american` whenever predicted prob
    exceeds implied prob (positive edge). Returns total profit / total
    stake — anything > 0 beats the market on this slice.
    """
    odds = np.asarray(odds_american, dtype=float)
    # American → decimal payout
    decimal = np.where(odds > 0, 1 + odds / 100.0, 1 + 100.0 / np.abs(odds))
    implied = np.where(odds > 0, 100.0 / (odds + 100.0), -odds / (-odds + 100.0))

    edge = y_pred - implied
    bet_mask = edge > 0

    if bet_mask.sum() == 0:
        return 0.0

    p = y_pred[bet_mask]
    b = decimal[bet_mask] - 1.0
    full_kelly = (p * b - (1 - p)) / np.maximum(b, 1e-9)
    stakes = np.clip(full_kelly * kelly_fraction, 0, 1)

    wins = y_true[bet_mask].astype(bool)
    profit = np.where(wins, stakes * b, -stakes)
    total_stake = stakes.sum()
    if total_stake <= 0:
        return 0.0
    return float(profit.sum() / total_stake)
