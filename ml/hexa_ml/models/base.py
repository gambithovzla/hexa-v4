"""Shared base class for market-specific XGBoost models."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

from ..calibration import PlattCalibrator

logger = logging.getLogger("hexa_ml.model")


@dataclass
class TrainMetrics:
    """Summary statistics from a fit() call. Persisted alongside the booster."""

    market: str
    n_train: int
    n_test: int
    brier_train: float = 0.0
    brier_test: float = 0.0
    logloss_test: float = 0.0
    roi_kelly25_test: float = 0.0
    # Honest directional hit rate at the model's >50% pick on the held-out set:
    # ATS for spread, over/under for total, straight-up for moneyline. Beats the
    # -110 vig only above 52.4% — the real test a training Brier can't show.
    pick_accuracy_test: float = 0.0
    pick_accuracy_n: int = 0
    feature_columns: list[str] = field(default_factory=list)
    # Reliability-diagram buckets for the admin calibration panel. Each entry is
    # {label, pred_mean, actual_frac, count} on the held-out test set — the shape
    # client/src/pages/AdminMLControlCenter.jsx consumes directly.
    reliability_diagram: list[dict] = field(default_factory=list)
    # True when n_test < 30: Brier/ROI are noisy at that sample size and should
    # not be used for model-quality decisions (e.g. runline with N_TEST=19).
    low_sample_warning: bool = False
    trained_at: str = ""


class MarketModelBase:
    """Common pattern for all market models — owns a booster + calibrator.

    Concrete classes set:
      - market_key (str): e.g. "moneyline"
      - default_params (dict): XGBoost hyperparameters
    """

    market_key: str = "base"
    default_params: dict = {  # noqa: RUF012 - shared default, treated as immutable
        "objective": "binary:logistic",
        "eval_metric": "logloss",
        "max_depth": 4,
        "learning_rate": 0.05,
        "n_estimators": 400,
        "min_child_weight": 5,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "tree_method": "hist",
    }

    def __init__(self, params: dict | None = None) -> None:
        self.params = {**self.default_params, **(params or {})}
        self.booster: xgb.XGBClassifier | None = None
        self.calibrator: PlattCalibrator | None = None
        self.feature_columns: list[str] = []
        self.metrics: TrainMetrics | None = None

    # ── Training ──────────────────────────────────────────────────────────
    def fit(
        self,
        X_train: pd.DataFrame,
        y_train: np.ndarray,
        X_calib: pd.DataFrame | None = None,
        y_calib: np.ndarray | None = None,
        sample_weight: np.ndarray | None = None,
    ) -> "MarketModelBase":
        """Train the booster, then fit the Platt calibrator on held-out data.

        Falls back to in-sample calibration if X_calib is None (less ideal
        but works for tiny datasets).
        """
        self.feature_columns = list(X_train.columns)
        self.booster = xgb.XGBClassifier(**self.params)
        self.booster.fit(X_train, y_train, sample_weight=sample_weight)

        if X_calib is not None and y_calib is not None and len(y_calib) > 0:
            raw = self.booster.predict_proba(X_calib)[:, 1]
            self.calibrator = PlattCalibrator().fit(raw, y_calib)
        else:
            raw = self.booster.predict_proba(X_train)[:, 1]
            self.calibrator = PlattCalibrator().fit(raw, y_train)

        return self

    # ── Inference ─────────────────────────────────────────────────────────
    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        if self.booster is None:
            raise RuntimeError(f"{self.market_key} model is not fitted")
        X_ordered = self._align_columns(X)
        raw = self.booster.predict_proba(X_ordered)[:, 1]
        if self.calibrator is not None:
            return self.calibrator.transform(raw)
        return raw

    def feature_importance(self, top_k: int = 10) -> list[tuple[str, float]]:
        """Return (feature, importance) pairs sorted descending."""
        if self.booster is None:
            return []
        importances = self.booster.feature_importances_
        pairs = list(zip(self.feature_columns, importances, strict=False))
        pairs.sort(key=lambda kv: kv[1], reverse=True)
        return [(name, float(score)) for name, score in pairs[:top_k]]

    # ── Persistence ───────────────────────────────────────────────────────
    def save(self, dir_path: str | Path) -> Path:
        dir_path = Path(dir_path)
        dir_path.mkdir(parents=True, exist_ok=True)
        out = dir_path / f"{self.market_key}.pkl"
        joblib.dump(
            {
                "market_key": self.market_key,
                "params": self.params,
                "booster": self.booster,
                "calibrator": self.calibrator,
                "feature_columns": self.feature_columns,
                "metrics": self.metrics,
            },
            out,
        )
        return out

    @classmethod
    def load(cls, path: str | Path) -> "MarketModelBase":
        payload = joblib.load(path)
        model = cls(params=payload["params"])
        model.booster = payload["booster"]
        model.calibrator = payload["calibrator"]
        model.feature_columns = payload["feature_columns"]
        model.metrics = payload.get("metrics")
        return model

    # ── Internals ─────────────────────────────────────────────────────────
    def _align_columns(self, X: pd.DataFrame) -> pd.DataFrame:
        """Reorder + fill missing columns so inference matches training schema."""
        missing = [c for c in self.feature_columns if c not in X.columns]
        if missing:
            logger.warning(
                "[%s] inference missing %d training feature(s) — filling with NaN "
                "(predictions may degrade): %s",
                self.market_key,
                len(missing),
                missing[:10],
            )
            X = X.copy()
            for c in missing:
                X[c] = np.nan  # float NaN keeps dtype numeric; pd.NA creates object columns
        return X[self.feature_columns]
