"""Tests for the calibration / metrics module."""

from __future__ import annotations

import numpy as np

from hexa_ml.calibration import (
    PlattCalibrator,
    brier,
    kelly_roi,
    logloss,
    reliability_diagram,
)


def test_brier_perfect_predictions():
    y = np.array([0, 1, 0, 1])
    assert brier(y, y.astype(float)) == 0.0


def test_brier_random_predictions_near_quarter():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, size=500)
    p = rng.uniform(0, 1, size=500)
    score = brier(y, p)
    # Random baseline ~ 0.33; pinning a wide range so the test isn't flaky.
    assert 0.2 < score < 0.4


def test_logloss_bounded():
    y = np.array([0, 1, 0, 1])
    score = logloss(y, np.array([0.1, 0.9, 0.2, 0.8]))
    assert 0 < score < 1


def test_platt_calibrator_monotonic():
    """After fitting, calibrated probs preserve rank order of raw probs."""
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, size=200)
    raw = rng.uniform(0, 1, size=200)

    cal = PlattCalibrator().fit(raw, y)
    transformed = cal.transform(raw)

    # Same rank order
    order_raw = np.argsort(raw)
    order_cal = np.argsort(transformed)
    assert np.array_equal(order_raw, order_cal)


def test_reliability_diagram_buckets():
    rng = np.random.default_rng(2)
    y = rng.integers(0, 2, size=200)
    p = rng.uniform(0, 1, size=200)
    points = reliability_diagram(y, p, n_buckets=10)
    assert len(points) > 0
    for pt in points:
        assert 0 <= pt.predicted_mean <= 1
        assert 0 <= pt.actual_rate <= 1
        assert pt.n > 0


def test_kelly_roi_no_bets_returns_zero():
    y = np.array([1, 0, 1])
    p = np.array([0.30, 0.30, 0.30])  # all below implied 0.524
    odds = np.array([-110, -110, -110])
    assert kelly_roi(y, p, odds) == 0.0


def test_kelly_roi_positive_when_predictions_are_truthy():
    """If predictions are well-calibrated and there's edge, ROI > 0."""
    rng = np.random.default_rng(3)
    n = 500
    # Underlying truth: 60% home wins. Odds -110 implies 52.4%.
    y = (rng.uniform(0, 1, n) < 0.6).astype(int)
    # Predictions perfectly calibrated at 0.6 (with tiny noise)
    p = np.clip(0.6 + rng.normal(0, 0.01, n), 0.55, 0.65)
    odds = np.full(n, -110)
    roi = kelly_roi(y, p, odds, kelly_fraction=0.25)
    assert roi > 0
