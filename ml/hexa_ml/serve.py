"""FastAPI app — the HTTP surface the Node Oracle talks to.

Endpoints:
  - GET  /health                 → liveness + model state
  - POST /predict/moneyline      → P(home wins)
  - POST /predict/overunder      → P(OVER hits)
  - POST /predict/runline        → P(home covers -1.5)
  - POST /predict/prop/{kind}    → P(prop side wins) by prop kind
  - POST /predict/batch          → batch any market
  - POST /predict/ensemble       → meta-learner combining oracle + legacy + python
  - GET  /calibration            → reliability diagram of last test set
  - GET  /calibration/ensemble   → ensemble manifest (Sprint 4)
  - POST /retrain                → fire training run (admin token required)
  - POST /retrain/ensemble       → fire ensemble training (admin token required)

Auth: every non-/health endpoint requires
  Authorization: Bearer ${HEXA_ML_INTERNAL_TOKEN}
when the env var is set (it's blank in dev for convenience).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from . import __version__
from .config import get_settings
from .predict import ModelNotAvailable, Prediction, get_registry
from .models import MARKET_MODELS

logger = logging.getLogger("hexa_ml.serve")
SUPPORTED_MARKETS = tuple(MARKET_MODELS.keys())
SUPPORTED_PROP_ENDPOINTS = {
    "hits": "prop_hits",
    "strikeouts": "prop_strikeouts",
    "total_bases": "prop_total_bases",
    "home_runs": "prop_home_runs",
    "rbis": "prop_rbis",
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Pre-load whatever artifacts exist so the first request is faster."""
    artifacts = Path(get_settings().artifacts_dir)
    # Always ensure the dir exists — critical when using a Railway Volume
    # mounted at /data with HEXA_ML_ARTIFACTS_DIR=/data/artifacts.
    artifacts.mkdir(parents=True, exist_ok=True)
    if any(artifacts.glob("*.pkl")):
        results = get_registry().reload()
        logger.info("Startup reload: %s", results)
    else:
        logger.info("No model artifacts found in %s — running cold", artifacts)
    yield


app = FastAPI(
    title="H.E.X.A. ML Sidecar",
    version=__version__,
    description="XGBoost prediction service for MLB markets.",
    lifespan=lifespan,
)

bearer = HTTPBearer(auto_error=False)


def require_internal_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> None:
    """Reject requests that lack the shared token.

    When `HEXA_ML_INTERNAL_TOKEN` is empty (dev), auth is disabled. In
    production Railway always injects it.
    """
    expected = get_settings().internal_token
    if not expected:
        return
    if credentials is None or credentials.credentials != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing bearer token",
        )


# ── Request / response models ─────────────────────────────────────────────
class FeaturePayload(BaseModel):
    """One game's features. All fields optional — XGBoost handles NaN."""

    home_pitcher_xwoba: float | None = None
    away_pitcher_xwoba: float | None = None
    home_pitcher_whiff: float | None = None
    away_pitcher_whiff: float | None = None
    home_pitcher_k_pct: float | None = None
    away_pitcher_k_pct: float | None = None
    home_pitcher_era: float | None = None
    away_pitcher_era: float | None = None
    home_pitcher_days_rest: float | None = None
    away_pitcher_days_rest: float | None = None
    home_pitcher_pitches_last_start: float | None = None
    away_pitcher_pitches_last_start: float | None = None
    home_bullpen_pitches_last_3d: float | None = None
    away_bullpen_pitches_last_3d: float | None = None
    home_team_ops: float | None = None
    away_team_ops: float | None = None
    home_lineup_avg_xwoba: float | None = None
    away_lineup_avg_xwoba: float | None = None
    park_factor_overall: float | None = None
    park_factor_hr: float | None = None
    temperature: float | None = None
    wind_speed: float | None = None
    is_day_game: float | None = None
    is_dome: float | None = None
    game_number_in_series: float | None = None
    odds_ml_home: float | None = None
    odds_ml_away: float | None = None
    odds_ou_total: float | None = None
    # OverUnder needs the line itself as a feature
    line: float | None = None
    side: str | None = None
    prop_player_xwoba: float | None = None
    prop_player_xba: float | None = None
    prop_player_xslg: float | None = None
    prop_player_k_pct: float | None = None
    prop_player_bb_pct: float | None = None
    prop_player_avg_exit_velocity: float | None = None
    prop_player_barrel_pct: float | None = None
    prop_player_hard_hit_pct: float | None = None
    prop_player_rolling_woba_14d: float | None = None

    model_config = {"extra": "allow"}


class PredictionOut(BaseModel):
    market: str
    probability: float = Field(..., ge=0, le=1)
    confidence: float = Field(..., ge=0, le=100)
    top_features: list[tuple[str, float]]
    model_version: str | None


class BatchItem(FeaturePayload):
    market: str = Field(
        ...,
        pattern="^(moneyline|overunder|runline|prop_hits|prop_strikeouts|prop_total_bases|prop_home_runs|prop_rbis)$",
    )
    game_pk: int | None = None


class BatchRequest(BaseModel):
    items: list[BatchItem] = Field(..., max_length=50)


class BatchResponse(BaseModel):
    predictions: list[dict[str, Any]]


class HealthResponse(BaseModel):
    status: str
    version: str
    models_loaded: list[str]
    models_available: list[str]
    manifest: dict
    ensembles_loaded: list[str] = []
    ensembles_available: list[str] = []
    artifacts_dir: str = ""       # absolute path in use — confirms Volume mount
    artifacts_persistent: bool = False  # True when not under /app (Railway Volume)


class RetrainRequest(BaseModel):
    market: str = Field(
        default="all",
        pattern="^(moneyline|overunder|runline|prop_hits|prop_strikeouts|prop_total_bases|prop_home_runs|prop_rbis|all)$",
    )
    csv: str | None = None
    # Optional admin override — bypasses the per-market `min_train_size` floor.
    # Useful for probing a new market with very few samples. None = use the
    # configured per-market default (e.g. 25 for runline, 60 for the rest).
    min_train_size_override: int | None = Field(default=None, ge=15, le=10_000)


class RetrainResponse(BaseModel):
    status: str
    summary: dict


# ── Ensemble request / response models (Sprint 4) ─────────────────────────
class EnsembleRequest(BaseModel):
    """Inputs for the meta-learner — one probability per source.

    All three sources are required so the meta-learner can apply the
    weights it was trained with. The Node side only calls this when all
    three are available; otherwise it should fall back to the Oracle.
    """

    market: str = Field(default="moneyline", pattern="^(moneyline)$")
    oracle_prob: float = Field(..., ge=0, le=1)
    legacy_prob: float = Field(..., ge=0, le=1)
    python_prob: float = Field(..., ge=0, le=1)


class EnsembleResponse(BaseModel):
    market: str
    probability: float = Field(..., ge=0, le=1)
    confidence: float = Field(..., ge=0, le=100)
    sources: dict[str, float]
    weights: dict[str, float]
    model_version: str | None


class EnsembleRetrainRequest(BaseModel):
    market: str = Field(default="moneyline", pattern="^(moneyline|all)$")
    min_rows: int = Field(default=50, ge=20, le=10_000)
    force: bool = Field(
        default=False,
        description="Save the artifact even when it does not beat individual sources.",
    )


# ── Helpers ───────────────────────────────────────────────────────────────
def _to_dict(p: Prediction) -> dict[str, Any]:
    return {
        "market": p.market,
        "probability": p.probability,
        "confidence": p.confidence,
        "top_features": p.top_features,
        "model_version": p.model_version,
    }


def _predict_one(market: str, payload: FeaturePayload) -> PredictionOut:
    try:
        prediction = get_registry().predict(market, payload.model_dump(exclude_none=False))
    except ModelNotAvailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return PredictionOut(**_to_dict(prediction))


# ── Routes ────────────────────────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Liveness check — also reports which markets have trained artifacts."""
    registry = get_registry()
    available = [m for m in SUPPORTED_MARKETS if registry.has_artifact(m)]
    ensembles_available = [
        m for m in ("moneyline",) if registry.has_ensemble_artifact(m)
    ]
    settings = get_settings()
    art_dir = settings.artifacts_dir.resolve()
    return HealthResponse(
        status="ok",
        version=__version__,
        models_loaded=registry.loaded_markets(),
        models_available=available,
        manifest=registry.manifest,
        ensembles_loaded=registry.loaded_ensembles(),
        ensembles_available=ensembles_available,
        artifacts_dir=str(art_dir),
        artifacts_persistent=not str(art_dir).startswith("/app"),
    )


@app.post(
    "/predict/moneyline",
    response_model=PredictionOut,
    dependencies=[Depends(require_internal_token)],
)
def predict_moneyline(payload: FeaturePayload) -> PredictionOut:
    return _predict_one("moneyline", payload)


@app.post(
    "/predict/overunder",
    response_model=PredictionOut,
    dependencies=[Depends(require_internal_token)],
)
def predict_overunder(payload: FeaturePayload) -> PredictionOut:
    return _predict_one("overunder", payload)


@app.post(
    "/predict/runline",
    response_model=PredictionOut,
    dependencies=[Depends(require_internal_token)],
)
def predict_runline(payload: FeaturePayload) -> PredictionOut:
    return _predict_one("runline", payload)


@app.post(
    "/predict/prop/{prop_kind}",
    response_model=PredictionOut,
    dependencies=[Depends(require_internal_token)],
)
def predict_prop(prop_kind: str, payload: FeaturePayload) -> PredictionOut:
    market = SUPPORTED_PROP_ENDPOINTS.get(prop_kind)
    if not market:
        allowed = ", ".join(SUPPORTED_PROP_ENDPOINTS.keys())
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported prop kind '{prop_kind}'. Allowed: {allowed}",
        )
    return _predict_one(market, payload)


@app.post(
    "/predict/batch",
    response_model=BatchResponse,
    dependencies=[Depends(require_internal_token)],
)
def predict_batch(payload: BatchRequest) -> BatchResponse:
    """Score multiple games in one call — groups by market so each model
    only loads once even if the client mixes markets."""
    registry = get_registry()
    by_market: dict[str, list[tuple[int, dict]]] = {}
    for idx, item in enumerate(payload.items):
        market = item.market
        by_market.setdefault(market, []).append((idx, item.model_dump(exclude={"market"})))

    out: list[dict | None] = [None] * len(payload.items)
    for market, items in by_market.items():
        try:
            preds = registry.predict_batch(market, [row for _, row in items])
        except ModelNotAvailable as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc
        for (idx, _), p in zip(items, preds, strict=False):
            out[idx] = _to_dict(p)

    return BatchResponse(predictions=[item or {} for item in out])


@app.get("/calibration", dependencies=[Depends(require_internal_token)])
def calibration() -> dict:
    """Return the most recent reliability stats from the manifest."""
    manifest = get_registry().manifest
    return {"manifest": manifest}


@app.post(
    "/predict/ensemble",
    response_model=EnsembleResponse,
    dependencies=[Depends(require_internal_token)],
)
def predict_ensemble_endpoint(payload: EnsembleRequest) -> EnsembleResponse:
    """Combine oracle / legacy / python probabilities via the meta-learner."""
    try:
        prediction = get_registry().predict_ensemble(
            market=payload.market,
            oracle_prob=payload.oracle_prob,
            legacy_prob=payload.legacy_prob,
            python_prob=payload.python_prob,
        )
    except ModelNotAvailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return EnsembleResponse(
        market=prediction.market,
        probability=prediction.probability,
        confidence=prediction.confidence,
        sources=prediction.sources,
        weights=prediction.weights,
        model_version=prediction.model_version,
    )


@app.get("/calibration/ensemble", dependencies=[Depends(require_internal_token)])
def calibration_ensemble() -> dict:
    """Return the ensemble manifest (per-source Brier scores + weights)."""
    return {"manifest": get_registry().ensemble_manifest}


@app.post(
    "/retrain/ensemble",
    response_model=RetrainResponse,
    dependencies=[Depends(require_internal_token)],
)
async def retrain_ensemble_endpoint(payload: EnsembleRetrainRequest) -> RetrainResponse:
    """Train the ensemble meta-learner from `shadow_model_runs` rows."""
    from .train_ensemble import ENSEMBLE_MARKETS, train_ensemble

    markets = ENSEMBLE_MARKETS if payload.market == "all" else (payload.market,)

    def _run() -> dict:
        return train_ensemble(
            markets=markets,
            min_rows=payload.min_rows,
            force_save=payload.force,
        )

    summary = await asyncio.to_thread(_run)
    get_registry().reload()
    return RetrainResponse(status="ok", summary=summary)


@app.post(
    "/retrain",
    response_model=RetrainResponse,
    dependencies=[Depends(require_internal_token)],
)
async def retrain(payload: RetrainRequest) -> RetrainResponse:
    """Run training synchronously, then reload models from disk.

    Wrapped in a thread because XGBoost holds the GIL during fit().
    """
    from .train import MARKETS, train_all

    markets = MARKETS if payload.market == "all" else (payload.market,)

    def _run() -> dict:
        return train_all(
            csv_path=payload.csv,
            markets=markets,
            min_train_size_override=payload.min_train_size_override,
        )

    summary = await asyncio.to_thread(_run)
    get_registry().reload()
    return RetrainResponse(status="ok", summary=summary)
