"""Training pipeline — fits market-specific XGBoost models and persists them.

Entrypoint:
    python -m hexa_ml.train [--market moneyline|overunder|runline|prop_hits|prop_strikeouts|prop_total_bases|prop_home_runs|prop_rbis|all]
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

MARKETS = (
    "moneyline",
    "overunder",
    "runline",
    "prop_hits",
    "prop_strikeouts",
    "prop_total_bases",
    "prop_home_runs",
    "prop_rbis",
)

NFL_MARKETS = ("nfl_moneyline", "nfl_spread", "nfl_total")
TENNIS_MARKETS = ("tennis_moneyline", "tennis_set_handicap", "tennis_total_games")

# Market → sport (for dataset loading)
MARKET_SPORT = {m: "nfl" for m in NFL_MARKETS}
MARKET_SPORT.update({m: "tennis" for m in TENNIS_MARKETS})


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def min_train_size_for_market(market: str, override: int | None = None) -> int:
    """Resolve the effective `min_train_size` for a market.

    Priority: explicit `override` argument > per-market env override (e.g.
    `runline_min_train_size`) > global `min_train_size`. Runline ships with
    a lower default (25) because resolved -1.5 picks are rare; the model
    compensates with stronger L2 regularization.
    """
    if override is not None and override >= 15:
        return int(override)
    settings = get_settings()
    per_market = getattr(settings, f"{market}_min_train_size", None)
    if per_market is not None:
        return int(per_market)
    return int(settings.min_train_size)


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
    # Floors scale with the configured minimum so low-volume markets like
    # runline (min=25) can still train when the temporal split is tight.
    min_split_train = max(10, min_train_size // 3)
    min_split_test = max(5, min_train_size // 5)
    if len(train_df) < min_split_train or len(test_df) < min_split_test:
        logger.warning(
            "Skipping %s — split too small (train=%d test=%d, need train>=%d test>=%d)",
            market, len(train_df), len(test_df), min_split_train, min_split_test,
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

    if market.startswith("prop_"):
        odds_col = "prop_odds_american"
    elif market in {"moneyline", "runline"}:
        odds_col = "odds_ml_home"
    else:
        odds_col = "odds_ou_total"
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
    min_train_size_override: int | None = None,
) -> dict:
    """Train every requested market and write a manifest JSON.

    The manifest is what the FastAPI /health and /calibration endpoints
    read at boot to report current model state.

    `min_train_size_override` overrides the global and per-market floors
    when set — useful for admin-triggered retrains that want to force a
    training run even with very few samples (e.g. probing a new market).

    NFL markets (nfl_moneyline, nfl_spread, nfl_total) load their own
    sport='nfl' dataset, keeping it isolated from MLB/NBA training data.
    """
    settings = get_settings()
    out_path = Path(out_dir or settings.artifacts_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Separate NFL, tennis and standard markets — each sport loads its own
    # isolated dataset (sport='nfl' / 'tennis' / 'mlb').
    nfl_markets = [m for m in markets if m in NFL_MARKETS]
    tennis_markets = [m for m in markets if m in TENNIS_MARKETS]
    std_markets = [m for m in markets if m not in NFL_MARKETS and m not in TENNIS_MARKETS]

    # Load standard dataset once for all non-NFL markets
    df = None
    if std_markets:
        logger.info("Loading MLB dataset…")
        df = load_dataset(csv_path=csv_path)
        logger.info("Loaded %d rows; %d resolved", len(df), int(df["result"].notna().sum()))

    # Load NFL dataset separately if any NFL market requested
    nfl_df = None
    if nfl_markets and not csv_path:
        logger.info("Loading NFL dataset…")
        try:
            nfl_df = load_dataset(sport="nfl")
            logger.info("NFL: Loaded %d rows; %d resolved", len(nfl_df), int(nfl_df["result"].notna().sum()))
        except Exception as exc:
            logger.warning("NFL dataset load failed (%s) — skipping NFL markets", exc)
            nfl_markets = []

    tennis_df = None
    if tennis_markets and not csv_path:
        logger.info("Loading Tennis dataset…")
        try:
            tennis_df = load_dataset(sport="tennis")
            logger.info("Tennis: Loaded %d rows; %d resolved", len(tennis_df), int(tennis_df["result"].notna().sum()))
        except Exception as exc:
            logger.warning("Tennis dataset load failed (%s) — skipping tennis markets", exc)
            tennis_markets = []

    summary: dict[str, dict | None] = {}

    def _train_market(market_df: pd.DataFrame, market: str) -> None:
        effective_min = min_train_size_for_market(market, override=min_train_size_override)
        try:
            metrics = train_one_market(
                market_df,
                market,
                out_path,
                test_days=settings.test_days,
                min_train_size=effective_min,
            )
            summary[market] = (
                {
                    "n_train": metrics.n_train,
                    "n_test": metrics.n_test,
                    "brier_test": metrics.brier_test,
                    "logloss_test": metrics.logloss_test,
                    "roi_kelly25_test": metrics.roi_kelly25_test,
                    "trained_at": metrics.trained_at,
                    "min_train_size_used": effective_min,
                }
                if metrics
                else {"skipped": True, "min_train_size_used": effective_min}
            )
        except Exception as exc:
            logger.exception("Training failed for %s", market)
            summary[market] = {"error": str(exc), "min_train_size_used": effective_min}

    if df is not None:
        for market in std_markets:
            _train_market(df, market)

    if nfl_df is not None:
        for market in nfl_markets:
            _train_market(nfl_df, market)

    if tennis_df is not None:
        for market in tennis_markets:
            _train_market(tennis_df, market)

    manifest_path = out_path / "manifest.json"
    # Merge with any existing manifest so partial retrains (e.g. only
    # "overunder") don't wipe metrics for markets that weren't retrained
    # this run. Without the merge a single-market retrain leaves the
    # admin dashboard showing "trained: never" for the other markets
    # even though their .pkl artifacts are still on disk.
    existing_markets: dict = {}
    if manifest_path.exists():
        try:
            prev = json.loads(manifest_path.read_text(encoding="utf-8"))
            existing_markets = prev.get("markets") or {}
        except Exception as exc:
            logger.warning("Could not parse existing manifest.json (%s) — starting fresh", exc)
    merged_markets = {**existing_markets, **summary}
    manifest_path.write_text(
        json.dumps(
            {"trained_at": _now_iso(), "markets": merged_markets},
            indent=2,
        ),
        encoding="utf-8",
    )
    logger.info("Manifest written → %s (merged %d existing + %d new markets)",
                manifest_path, len(existing_markets), len(summary))
    return summary


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train H.E.X.A. ML models")
    parser.add_argument(
        "--market",
        choices=[*MARKETS, *NFL_MARKETS, *TENNIS_MARKETS, "all"],
        default="all",
        help="Which market(s) to train",
    )
    parser.add_argument("--csv", default=None, help="Optional CSV dataset path")
    parser.add_argument("--out-dir", default=None, help="Artifacts output directory")
    parser.add_argument(
        "--min-train-size",
        type=int,
        default=None,
        help="Override the per-market min_train_size floor (>=15)",
    )
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
    markets = (*MARKETS, *NFL_MARKETS, *TENNIS_MARKETS) if args.market == "all" else (args.market,)
    train_all(
        csv_path=args.csv,
        out_dir=args.out_dir,
        markets=markets,
        min_train_size_override=args.min_train_size,
    )


if __name__ == "__main__":
    main()
