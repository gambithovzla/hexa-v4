"""Training pipeline for the ensemble meta-learner.

Reads rows from `shadow_model_runs` where the 3 prediction sources
(oracle / legacy validator / Python XGBoost) all produced a probability
and the game has resolved, then fits a LogisticRegression that learns
how much to weigh each source.

Entrypoint:
    python -m hexa_ml.train_ensemble [--market moneyline]
                                     [--out-dir artifacts]
                                     [--min-rows 50]

The training endpoint at /train/ensemble in serve.py calls train_ensemble().

Acceptance gate: the saved artifact only gets written if the ensemble's
test-set Brier score beats every individual source. Otherwise we keep
the old artifact (or no artifact) so the Node side falls back to the
existing Oracle behavior.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .config import get_settings
from .data import load_ensemble_training_data, temporal_split
from .calibration import brier
from .models.ensemble import (
    EnsembleMetaLearner,
    EnsembleMetrics,
    SOURCE_COLUMN,
    sources_for_market,
)

logger = logging.getLogger("hexa_ml.train_ensemble")

ENSEMBLE_MARKETS = ("moneyline", "overunder", "runline", "prop")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _extract_sources(df: pd.DataFrame, source_columns: tuple[str, ...]) -> np.ndarray:
    """Build the (n, k) array of pick-aligned probabilities for the given sources.

    k is 3 for moneyline (oracle/legacy/python) and 2 for the value markets
    (oracle/python). Column order matches `source_columns`.
    """
    cols = [SOURCE_COLUMN[s] for s in source_columns]
    return df[cols].to_numpy(dtype=float)


def train_ensemble_one(
    market: str,
    out_dir: Path,
    *,
    min_rows: int = 50,
    test_days: int = 30,
    database_url: str | None = None,
    force_save: bool = False,
) -> EnsembleMetrics | None:
    """Train a single-market ensemble.

    Returns the metrics on success, None when we don't have enough data
    yet OR the ensemble fails to beat individual sources on the test set.
    """
    df = load_ensemble_training_data(database_url=database_url, market=market)
    if df.empty or len(df) < min_rows:
        logger.warning(
            "Skipping ensemble %s — only %d eligible rows (need >= %d)",
            market, len(df), min_rows,
        )
        return None

    try:
        train_df, test_df = temporal_split(df, test_days=test_days)
    except ValueError as exc:
        logger.warning("temporal_split failed for ensemble: %s", exc)
        return None

    if len(train_df) < max(20, min_rows // 2) or len(test_df) < 10:
        logger.warning(
            "Skipping ensemble %s — split too small (train=%d test=%d)",
            market, len(train_df), len(test_df),
        )
        return None

    source_columns = sources_for_market(market)

    X_train = _extract_sources(train_df, source_columns)
    y_train = train_df["y_true"].to_numpy(dtype=int)
    X_test = _extract_sources(test_df, source_columns)
    y_test = test_df["y_true"].to_numpy(dtype=int)

    ensemble = EnsembleMetaLearner(market=market, source_columns=source_columns)
    ensemble.fit(X_train, y_train)

    p_train = ensemble.predict_proba(X_train)
    p_test = ensemble.predict_proba(X_test)

    brier_train = brier(y_train, p_train)
    brier_test = brier(y_test, p_test)

    # Per-source baselines on the test set — only for the sources in play.
    brier_by_source = {
        name: brier(y_test, X_test[:, i]) for i, name in enumerate(source_columns)
    }
    best_source = min(brier_by_source.values())
    beats_best = brier_test < best_source

    coefs = ensemble.weights()
    metrics = EnsembleMetrics(
        market=market,
        n_train=len(X_train),
        n_test=len(X_test),
        brier_train=brier_train,
        brier_test=brier_test,
        brier_oracle=brier_by_source.get("oracle", 0.0),
        brier_legacy=brier_by_source.get("legacy", 0.0),
        brier_python=brier_by_source.get("python", 0.0),
        coef_oracle=coefs.get("oracle", 0.0),
        coef_legacy=coefs.get("legacy", 0.0),
        coef_python=coefs.get("python", 0.0),
        intercept=coefs["intercept"],
        trained_at=_now_iso(),
        source_columns=list(source_columns),
    )
    ensemble.metrics = metrics

    logger.info(
        "[ensemble:%s] sources=%s brier_test=%.4f | %s | beats_best=%s",
        market, ",".join(source_columns), brier_test,
        " ".join(f"{k}={v:.4f}" for k, v in brier_by_source.items()), beats_best,
    )

    if not beats_best and not force_save:
        logger.warning(
            "Ensemble %s does NOT beat the best individual source — artifact not promoted. "
            "Pass --force to save anyway for inspection.",
            market,
        )
        return None

    saved = ensemble.save(out_dir)
    logger.info("[ensemble:%s] saved → %s", market, saved)
    return metrics


def train_ensemble(
    *,
    out_dir: str | None = None,
    markets: tuple[str, ...] = ENSEMBLE_MARKETS,
    min_rows: int = 50,
    force_save: bool = False,
) -> dict[str, dict | None]:
    """Train ensembles for every requested market and write a manifest."""
    settings = get_settings()
    out_path = Path(out_dir or settings.artifacts_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    summary: dict[str, dict | None] = {}
    for market in markets:
        try:
            metrics = train_ensemble_one(
                market,
                out_path,
                min_rows=min_rows,
                test_days=settings.test_days,
                force_save=force_save,
            )
            summary[market] = (
                {
                    "n_train": metrics.n_train,
                    "n_test": metrics.n_test,
                    "brier_test": metrics.brier_test,
                    "brier_oracle": metrics.brier_oracle,
                    "brier_legacy": metrics.brier_legacy,
                    "brier_python": metrics.brier_python,
                    "coef_oracle": metrics.coef_oracle,
                    "coef_legacy": metrics.coef_legacy,
                    "coef_python": metrics.coef_python,
                    "intercept": metrics.intercept,
                    "trained_at": metrics.trained_at,
                    "source_columns": metrics.source_columns,
                }
                if metrics
                else None
            )
        except Exception:
            logger.exception("Ensemble training failed for %s", market)
            summary[market] = None

    manifest_path = out_path / "ensemble_manifest.json"
    # Same merge logic as train.py — avoid wiping per-market entries
    # when a partial retrain only covers a subset of markets.
    existing_markets: dict = {}
    if manifest_path.exists():
        try:
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
            existing_markets = prev.get("markets") or {}
        except Exception as exc:
            logger.warning("Could not parse existing ensemble_manifest.json (%s)", exc)
    merged_markets = {**existing_markets, **summary}
    manifest_path.write_text(
        json.dumps(
            {"trained_at": _now_iso(), "markets": merged_markets},
            indent=2,
        ),
        encoding="utf-8",
    )
    logger.info("Ensemble manifest written → %s", manifest_path)
    return summary


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Train H.E.X.A. ensemble meta-learner")
    p.add_argument(
        "--market",
        choices=["moneyline", "overunder", "runline", "prop", "all"],
        default="all",
    )
    p.add_argument("--out-dir", default=None)
    p.add_argument("--min-rows", type=int, default=50)
    p.add_argument(
        "--force",
        action="store_true",
        help="Save the ensemble even when it does NOT beat individual sources",
    )
    p.add_argument("--log-level", default="INFO")
    return p


def main() -> None:
    args = _build_parser().parse_args()
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )
    markets = ENSEMBLE_MARKETS if args.market == "all" else (args.market,)
    train_ensemble(
        out_dir=args.out_dir,
        markets=markets,
        min_rows=args.min_rows,
        force_save=args.force,
    )


if __name__ == "__main__":
    main()
