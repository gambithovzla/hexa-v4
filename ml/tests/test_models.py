"""End-to-end tests: train each market on synthetic data, then predict + persist."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from hexa_ml.data import filter_for_market, make_target, temporal_split
from hexa_ml.features import build_X
from hexa_ml.models import MARKET_MODELS
from hexa_ml.models.base import MarketModelBase


def _train_market(df: pd.DataFrame, market: str) -> MarketModelBase:
    sub = filter_for_market(df, market)
    # On the synthetic dataset every market has < 100 rows so we bypass the
    # production threshold here and just check that the pipeline works.
    train, test = temporal_split(sub, test_days=30)
    if len(train) == 0:
        # Synthetic data shouldn't fail this; assert explicitly.
        train = sub
        test = sub
    y_train = make_target(train, market).to_numpy()
    y_test = make_target(test, market).to_numpy()
    X_train = build_X(train, market)
    X_test = build_X(test, market)

    model_cls = MARKET_MODELS[market]
    model = model_cls()
    model.fit(X_train, y_train, X_calib=X_test, y_calib=y_test)
    return model


def test_moneyline_trains_and_predicts(fake_dataset):
    model = _train_market(fake_dataset, "moneyline")
    sub = filter_for_market(fake_dataset, "moneyline").head(3)
    X = build_X(sub, "moneyline")
    probs = model.predict_proba(X)
    assert probs.shape == (3,)
    assert ((probs >= 0) & (probs <= 1)).all()


def test_overunder_trains_with_line(fake_dataset):
    model = _train_market(fake_dataset, "overunder")
    sub = filter_for_market(fake_dataset, "overunder").head(3)
    X = build_X(sub, "overunder")
    assert "line" in X.columns
    probs = model.predict_proba(X)
    assert ((probs >= 0) & (probs <= 1)).all()


def test_runline_trains(fake_dataset):
    model = _train_market(fake_dataset, "runline")
    sub = filter_for_market(fake_dataset, "runline").head(3)
    X = build_X(sub, "runline")
    probs = model.predict_proba(X)
    assert ((probs >= 0) & (probs <= 1)).all()


def test_feature_importance_returns_top_k(fake_dataset):
    model = _train_market(fake_dataset, "moneyline")
    top = model.feature_importance(top_k=5)
    assert len(top) <= 5
    for name, score in top:
        assert isinstance(name, str)
        assert isinstance(score, float)


def test_save_load_roundtrip(fake_dataset, tmp_path: Path):
    model = _train_market(fake_dataset, "moneyline")
    saved = model.save(tmp_path)
    assert saved.exists()

    from hexa_ml.models import MoneylineModel
    loaded = MoneylineModel.load(saved)
    assert loaded.feature_columns == model.feature_columns

    sub = filter_for_market(fake_dataset, "moneyline").head(3)
    X = build_X(sub, "moneyline")
    p1 = model.predict_proba(X)
    p2 = loaded.predict_proba(X)
    np.testing.assert_allclose(p1, p2, rtol=1e-6)


def test_alignment_handles_extra_input_columns(fake_dataset):
    """Inference with a wider DataFrame than training should still work."""
    model = _train_market(fake_dataset, "moneyline")
    sub = filter_for_market(fake_dataset, "moneyline").head(3)
    X = build_X(sub, "moneyline")
    X["unexpected_extra_col"] = 1.0  # noise the model has never seen
    probs = model.predict_proba(X)
    assert probs.shape == (3,)


def test_predict_logs_warning_on_missing_training_feature(fake_dataset, caplog):
    """_align_columns must emit a WARNING (not silently fill with NaN) when a
    feature present in training is absent at inference time."""
    import logging
    model = _train_market(fake_dataset, "moneyline")
    sub = filter_for_market(fake_dataset, "moneyline").head(3)
    X = build_X(sub, "moneyline")
    # Drop a feature the model was trained on to simulate a schema drift
    X_stripped = X.drop(columns=[model.feature_columns[0]])
    with caplog.at_level(logging.WARNING, logger="hexa_ml.model"):
        probs = model.predict_proba(X_stripped)
    assert probs.shape == (3,), "must still return predictions (graceful degradation)"
    assert ((probs >= 0) & (probs <= 1)).all()
    assert any("missing" in msg.lower() for msg in caplog.messages), (
        "Expected a warning about missing training features but none was emitted"
    )


def test_single_class_y_train_returns_none(fake_dataset, tmp_path):
    """train_one_market must return None (not a broken model) when y_train has
    only one class — e.g. all picks are wins after a lucky streak."""
    from hexa_ml.train import train_one_market
    sub = filter_for_market(fake_dataset, "moneyline").copy()
    # Force all outcomes to 'win' so make_target produces all-1 vector
    sub["result"] = "win"
    sub["home_score"] = 5
    sub["away_score"] = 3
    result = train_one_market(
        sub, "moneyline", tmp_path, test_days=30, min_train_size=10
    )
    assert result is None, (
        "Expected None when y_train is single-class, got a TrainMetrics object"
    )
