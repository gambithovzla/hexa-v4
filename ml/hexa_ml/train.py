"""Training pipeline — fits market-specific XGBoost models and persists them.

Entrypoint:
    python -m hexa_ml.train [--market moneyline|overunder|runline|all]
                            [--csv data/picks-dataset-YYYY-MM-DD.csv]
                            [--out-dir artifacts]

When --csv is omitted the loader pulls from DATABASE_URL.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .config import get_settings
from .data import filter_for_market, load_dataset, make_target, temporal_split
from .features import build_X
from .models import MARKET_MODELS
from .models.base import TrainMetrics
from .calibration import brier, kelly_roi, logloss

logger = logging.getLogger("hexa_ml.train")

MARKETS = ("moneyline", "overunder", "runline")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def train_one_market(
    df: pd.DataFrame,
    market: str,
    out_dir: Path,
    test_days: int,
    min_train_size: int,
) -> TrainMetrics | None:
    """Train one market model and write the artifact to disk.

    Returns the TrainMetrics on success, or None if there isn't enough
    resolved data yet (e.g. <100 picks). In that case the caller should
    keep using the existing artifact (or the Node deterministic fallback).
    """
    sub = filter_for_market(df, market)
    if len(sub) < min_train_size:
        logger.warning(
            "Skipping %s — only %d resolved picks (need >= %d)",
            market, len(sub), min_train_size,
        )
        return None

    train_df, test_df = temporal_split(sub, test_days=test_days)
    min_split_train = max(20, min_train_size // 3)
    if len(train_df) < min_split_train or len(test_df) < 10:
        logger.warning(
            "Skipping %s — split too small (train=%d test=%d, need train>=%d test>=10)",
            market, len(train_df), len(test_df), min_split_train,
        )
        return None

    y_train = make_target(train_df, market).to_numpy()
    y_test = make_target(test_df, market).to_numpy()

    X_train = build_X(train_df, market)
    X_test = build_X(test_df, market)

    model_cls = MARKET_MODELS[market]
    model = model_cls()
    # Use the test set itself for calibration as well — fine for small data,
    # we re-evaluate Brier separately so this isn't double-counted as quality.
    model.fit(X_train, y_train, X_calib=X_test, y_calib=y_test)

    # In-sample (sanity) and out-of-sample (real) metrics
    p_train = model.predict_proba(X_train)
    p_test = model.predict_proba(X_test)

    brier_train = brier(y_train, p_train)
    brier_test = brier(y_test, p_test)
    ll_test = logloss(y_test, p_test)

    odds_col = "odds_ml_home" if market in {"moneyline", "runline"} else "odds_ou_total"
    odds_test = pd.to_numeric(test_df.get(odds_col), errors="coerce").fillna(-110).to_numpy()
    roi = kelly_roi(y_test, p_test, odds_test, kelly_fraction=0.25)

    metrics = TrainMetrics(
        market=market,
        n_train=len(X_train),
        n_test=len(X_test),
        brier_train=brier_train,
        brier_test=brier_test,
        logloss_test=ll_test,
        roi_kelly25_test=roi,
        feature_columns=list(X_train.columns),
        trained_at=_now_iso(),
    )
    model.metrics = metrics

    saved = model.save(out_dir)
    logger.info(
        "[%s] saved → %s | brier_test=%.4f logloss=%.4f roi_kelly25=%.4f",
        market, saved, brier_test, ll_test, roi,
    )
    return metrics


def train_all(
    csv_path: str | None = None,
    out_dir: str | None = None,
    markets: tuple[str, ...] = MARKETS,
) -> dict:
    """Train every requested market and write a manifest JSON.

    The manifest is what the FastAPI /health and /calibration endpoints
    read at boot to report current model state.
    """
    settings = get_settings()
    out_path = Path(out_dir or settings.artifacts_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    logger.info("Loading dataset…")
    df = load_dataset(csv_path=csv_path)
    logger.info("Loaded %d rows; %d resolved", len(df), int(df["result"].notna().sum()))

    summary: dict[str, dict | None] = {}
    for market in markets:
        try:
            metrics = train_one_market(
                df,
                market,
                out_path,
                test_days=settings.test_days,
                min_train_size=settings.min_train_size,
            )
            summary[market] = (
                {
                    "n_train": metrics.n_train,
                    "n_test": metrics.n_test,
                    "brier_test": metrics.brier_test,
                    "logloss_test": metrics.logloss_test,
                    "roi_kelly25_test": metrics.roi_kelly25_test,
                    "trained_at": metrics.trained_at,
                }
                if metrics
                else None
            )
        except Exception:
            logger.exception("Training failed for %s", market)
            summary[market] = None

    manifest_path = out_path / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {"trained_at": _now_iso(), "markets": summary},
            indent=2,
        ),
        encoding="utf-8",
    )
    logger.info("Manifest written → %s", manifest_path)
    return summary


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train H.E.X.A. ML models")
    parser.add_argument(
        "--market",
        choices=["moneyline", "overunder", "runline", "all"],
        default="all",
        help="Which market(s) to train",
    )
    parser.add_argument("--csv", default=None, help="Optional CSV dataset path")
    parser.add_argument("--out-dir", default=None, help="Artifacts output directory")
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Python log level (DEBUG / INFO / WARNING)",
    )
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    )
    markets = MARKETS if args.market == "all" else (args.market,)
    train_all(csv_path=args.csv, out_dir=args.out_dir, markets=markets)


if __name__ == "__main__":
    main()
