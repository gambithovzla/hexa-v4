"""Tests for the EnsembleMetaLearner — Sprint 4."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from hexa_ml.models.ensemble import (
    SOURCE_NAMES,
    EnsembleMetaLearner,
    EnsembleMetrics,
    _logit,
)


# ── Pure helpers ──────────────────────────────────────────────────────────────


def test_logit_round_trip():
    """logit(sigmoid(x)) ≈ x for moderate values."""
    raw = np.array([0.1, 0.3, 0.5, 0.7, 0.9])
    out = _logit(raw)
    sigmoid = 1 / (1 + np.exp(-out))
    np.testing.assert_allclose(sigmoid, raw, atol=1e-6)


def test_logit_clips_extreme_probabilities():
    """Hard 0/1 inputs are clipped so we don't produce -inf / +inf."""
    out = _logit(np.array([0.0, 1.0]))
    assert np.all(np.isfinite(out))


def test_source_names_match_training_order():
    """The first column is always oracle, second legacy, third python."""
    assert SOURCE_NAMES == ("oracle", "legacy", "python")


# ── Fit / predict / persistence ───────────────────────────────────────────────


def _make_dataset(n: int = 200, seed: int = 42):
    """Generate a synthetic dataset where Python is the most informative source."""
    rng = np.random.default_rng(seed)
    y = rng.integers(0, 2, size=n)

    # Oracle: 60% accurate
    oracle = np.where(y == 1, rng.uniform(0.45, 0.85, n), rng.uniform(0.15, 0.55, n))
    # Legacy: 55% accurate, noisier
    legacy = np.where(y == 1, rng.uniform(0.40, 0.80, n), rng.uniform(0.20, 0.60, n))
    # Python: 70% accurate, the strongest single source
    python = np.where(y == 1, rng.uniform(0.55, 0.95, n), rng.uniform(0.05, 0.45, n))

    X = np.stack([oracle, legacy, python], axis=1)
    return X, y


def test_fit_rejects_wrong_shape():
    ens = EnsembleMetaLearner()
    with pytest.raises(ValueError):
        ens.fit(np.zeros((10, 2)), np.zeros(10))


def test_predict_proba_returns_valid_range():
    X, y = _make_dataset(n=120)
    ens = EnsembleMetaLearner().fit(X, y)
    probs = ens.predict_proba(X)
    assert np.all((probs >= 0) & (probs <= 1))
    assert len(probs) == len(y)


def test_predict_one_matches_predict_proba():
    X, y = _make_dataset(n=80)
    ens = EnsembleMetaLearner().fit(X, y)
    bulk = ens.predict_proba(X[0:1])[0]
    single = ens.predict_one(X[0, 0], X[0, 1], X[0, 2])
    np.testing.assert_allclose(bulk, single, atol=1e-9)


def test_unfitted_predict_raises():
    ens = EnsembleMetaLearner()
    with pytest.raises(RuntimeError):
        ens.predict_proba(np.array([[0.5, 0.5, 0.5]]))


def test_weights_returns_per_source_coefficients():
    X, y = _make_dataset(n=300)
    ens = EnsembleMetaLearner().fit(X, y)
    weights = ens.weights()
    assert set(weights.keys()) == {"oracle", "legacy", "python", "intercept"}
    # Python is the strongest source in the synthetic dataset → it should
    # have the highest positive weight among the 3 source coefficients.
    assert weights["python"] > weights["legacy"]
    assert weights["python"] > weights["oracle"]


def test_save_and_load_round_trip(tmp_path: Path):
    X, y = _make_dataset(n=150)
    ens = EnsembleMetaLearner(market="moneyline").fit(X, y)
    ens.metrics = EnsembleMetrics(
        market="moneyline", n_train=100, n_test=50, brier_test=0.20,
    )
    saved = ens.save(tmp_path)
    assert saved.exists()
    assert saved.name == "ensemble_moneyline.pkl"

    reloaded = EnsembleMetaLearner.load(saved)
    assert reloaded.market == "moneyline"
    assert reloaded.fitted is True
    assert reloaded.metrics is not None
    assert reloaded.metrics.brier_test == 0.20

    # Predictions should match exactly after a save/load round trip
    p_orig = ens.predict_proba(X[:5])
    p_reloaded = reloaded.predict_proba(X[:5])
    np.testing.assert_allclose(p_orig, p_reloaded, atol=1e-12)


def test_ensemble_beats_or_matches_best_individual_source():
    """On a synthetic set where Python is best, the ensemble should be at least as good."""
    from hexa_ml.calibration import brier
    X, y = _make_dataset(n=400, seed=7)
    split = 300
    X_train, y_train = X[:split], y[:split]
    X_test, y_test = X[split:], y[split:]

    ens = EnsembleMetaLearner().fit(X_train, y_train)
    p_ens = ens.predict_proba(X_test)

    brier_ens = brier(y_test, p_ens)
    brier_python = brier(y_test, X_test[:, 2])  # python is the best single source

    # The ensemble should at worst tie the best individual source
    # (within a small tolerance to handle finite-sample noise).
    assert brier_ens <= brier_python + 0.005
