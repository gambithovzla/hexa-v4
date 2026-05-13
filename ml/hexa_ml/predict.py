"""Inference layer — loads cached models and produces calibrated predictions.

The ModelRegistry is the singleton FastAPI workers use. It lazy-loads each
market's pickle on first request and caches them in memory; calling .reload()
re-reads the artifacts directory after a retraining run.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .config import get_settings
from .features import build_X
from .models import MARKET_MODELS
from .models.base import MarketModelBase

logger = logging.getLogger("hexa_ml.predict")


@dataclass
class Prediction:
    """One model prediction returned to the Node API."""

    market: str
    probability: float
    confidence: float
    top_features: list[tuple[str, float]]
    model_version: str | None = None


class ModelNotAvailable(RuntimeError):
    """Raised when a market hasn't been trained yet (cold start)."""


class ModelRegistry:
    """Thread-safe in-memory cache of loaded MarketModelBase instances."""

    def __init__(self, artifacts_dir: Path | None = None) -> None:
        self._dir = artifacts_dir or get_settings().artifacts_dir
        self._models: dict[str, MarketModelBase] = {}
        self._manifest: dict | None = None
        self._lock = threading.Lock()

    # ── State ─────────────────────────────────────────────────────────────
    def is_loaded(self, market: str) -> bool:
        return market in self._models

    def has_artifact(self, market: str) -> bool:
        return (self._dir / f"{market}.pkl").exists()

    @property
    def manifest(self) -> dict:
        if self._manifest is None:
            self._load_manifest()
        return self._manifest or {}

    def loaded_markets(self) -> list[str]:
        return sorted(self._models)

    # ── Loading ───────────────────────────────────────────────────────────
    def get(self, market: str) -> MarketModelBase:
        if market not in MARKET_MODELS:
            raise ValueError(f"Unknown market: {market}")

        with self._lock:
            if market not in self._models:
                self._load_market(market)
        return self._models[market]

    def reload(self) -> dict[str, bool]:
        """Drop cached models and reload from disk. Returns market → success."""
        with self._lock:
            self._models = {}
            self._manifest = None
            results: dict[str, bool] = {}
            for market in MARKET_MODELS:
                try:
                    self._load_market(market)
                    results[market] = True
                except Exception as exc:
                    logger.warning("Reload failed for %s: %s", market, exc)
                    results[market] = False
            self._load_manifest()
        return results

    def _load_market(self, market: str) -> None:
        path = self._dir / f"{market}.pkl"
        if not path.exists():
            raise ModelNotAvailable(
                f"No trained model for {market}. Run `python -m hexa_ml.train`."
            )
        model_cls = MARKET_MODELS[market]
        self._models[market] = model_cls.load(path)
        logger.info("Loaded %s model from %s", market, path)

    def _load_manifest(self) -> None:
        manifest_path = self._dir / "manifest.json"
        if manifest_path.exists():
            try:
                self._manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("Could not parse manifest.json: %s", exc)
                self._manifest = {}
        else:
            self._manifest = {}

    # ── Prediction ────────────────────────────────────────────────────────
    def predict(self, market: str, features: dict | pd.DataFrame) -> Prediction:
        """Run inference for one game on the given market.

        `features` is either a dict (single row) or a DataFrame (batch).
        Always returns a single Prediction; for batches, use predict_batch.
        """
        model = self.get(market)
        df = features if isinstance(features, pd.DataFrame) else pd.DataFrame([features])
        X = build_X(df, market)
        prob = float(model.predict_proba(X)[0])

        # Confidence = distance from coin flip, expressed in 0–100 scale
        confidence = round(abs(prob - 0.5) * 200, 2)

        top = model.feature_importance(top_k=5)
        version = (self.manifest.get("markets", {}).get(market) or {}).get("trained_at")
        return Prediction(
            market=market,
            probability=round(prob, 4),
            confidence=confidence,
            top_features=top,
            model_version=version,
        )

    def predict_batch(
        self, market: str, rows: list[dict]
    ) -> list[Prediction]:
        if not rows:
            return []
        model = self.get(market)
        df = pd.DataFrame(rows)
        X = build_X(df, market)
        probs = model.predict_proba(X)
        top = model.feature_importance(top_k=5)
        version = (self.manifest.get("markets", {}).get(market) or {}).get("trained_at")
        return [
            Prediction(
                market=market,
                probability=round(float(p), 4),
                confidence=round(abs(float(p) - 0.5) * 200, 2),
                top_features=top,
                model_version=version,
            )
            for p in probs
        ]


# Module-level singleton — FastAPI workers share this
_registry: ModelRegistry | None = None


def get_registry() -> ModelRegistry:
    global _registry
    if _registry is None:
        _registry = ModelRegistry()
    return _registry


def reset_registry_for_tests() -> None:
    """Pytest helper — wipes the singleton."""
    global _registry
    _registry = None
