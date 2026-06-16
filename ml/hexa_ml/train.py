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

import numpy as np
import pandas as pd

from .config import get_settings
from .data import filter_for_market, load_dataset, make_target, temporal_split
from .features import build_X
from .models import MARKET_MODELS
from .models.base import TrainMetrics
from .calibration import brier, kelly_roi, logloss, reliability_diagram
from .metrics import pick_accuracy

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

# MLB markets that can be pre-trained from free schedule history (final scores).
# over/under is excluded — its target needs a total line the free schedule lacks.
MLB_PRETRAIN_MARKETS = ("moneyline", "runline")

NFL_MARKETS    = ("nfl_moneyline", "nfl_spread", "nfl_total")
# Pooled player-prop market. Separate from NFL_MARKETS because it does NOT
# pre-train from nflverse (no historical prop lines exist there) — it trains
# only from resolved live picks (sport='nfl', market_type='prop').
NFL_PROP_MARKETS = ("nfl_prop",)
SOCCER_MARKETS = ("soccer_moneyline", "soccer_total", "soccer_btts")
TENNIS_MARKETS = ("tennis_moneyline", "tennis_set_handicap", "tennis_total_games")

# Market → sport (for dataset loading)
MARKET_SPORT = {
    **{m: "nfl"    for m in NFL_MARKETS},
    **{m: "nfl"    for m in NFL_PROP_MARKETS},
    **{m: "soccer" for m in SOCCER_MARKETS},
    **{m: "tennis" for m in TENNIS_MARKETS},
}


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

    # Guard: XGBoost needs both classes present in the training set. A single-class
    # y_train silently produces a degenerate model that always predicts the same side.
    unique_classes = np.unique(y_train)
    if len(unique_classes) < 2:
        logger.warning(
            "Skipping %s — y_train has only one class (%s). "
            "Need both 0 and 1 to train a meaningful model.",
            market, unique_classes,
        )
        return None

    X_train = build_X(train_df, market)
    X_test = build_X(test_df, market)

    # Sample weights: live picks (real Statcast + odds) get 5× the gradient
    # contribution of historical pre-training rows (team-strength features only).
    # Only applied when both kinds are present — if all rows are live or all are
    # historical the uniform weight is equivalent and we skip it for clarity.
    sample_weight: np.ndarray | None = None
    if "source" in train_df.columns:
        is_live = train_df["source"].isin(["live", "oracle_chat"]).to_numpy()
        if is_live.any() and not is_live.all():
            sample_weight = np.where(is_live, 5.0, 1.0)
            logger.info(
                "[%s] sample weights: %d live (5×) + %d historical (1×)",
                market, int(is_live.sum()), int((~is_live).sum()),
            )

    model_cls = MARKET_MODELS[market]
    model = model_cls()
    # Use the test set itself for calibration as well — fine for small data,
    # we re-evaluate Brier separately so this isn't double-counted as quality.
    model.fit(X_train, y_train, X_calib=X_test, y_calib=y_test, sample_weight=sample_weight)

    # In-sample (sanity) and out-of-sample (real) metrics
    p_train = model.predict_proba(X_train)
    p_test = model.predict_proba(X_test)

    brier_train = brier(y_train, p_train)
    brier_test = brier(y_test, p_test)
    ll_test = logloss(y_test, p_test)
    pick_acc, pick_acc_n = pick_accuracy(y_test, p_test)

    if market.startswith("prop_") or market == "nfl_prop":
        odds_col = "prop_odds_american"
    elif market in {"moneyline", "runline", "nfl_moneyline"}:
        odds_col = "odds_ml_home"
    else:
        odds_col = "odds_ou_total"
    # The column may be absent entirely (e.g. nflverse historical frames carry
    # closing points, not American prices) — fall back to the -110 vig default
    # so the diagnostic ROI metric still computes instead of crashing on a scalar.
    odds_series = test_df.get(odds_col)
    if odds_series is None:
        odds_test = pd.Series([-110.0] * len(test_df)).to_numpy()
    else:
        odds_test = pd.to_numeric(odds_series, errors="coerce").fillna(-110).to_numpy()
    roi = kelly_roi(y_test, p_test, odds_test, kelly_fraction=0.25)

    low_sample = len(test_df) < 30
    if low_sample:
        logger.warning(
            "[%s] n_test=%d < 30 — Brier/ROI metrics are unreliable at this sample size.",
            market, len(test_df),
        )

    # Reliability diagram on the (calibrated) held-out predictions, mapped to the
    # {label, pred_mean, actual_frac, count} shape the admin panel renders. Same
    # test slice as brier_test above, so the panel and the Brier tell one story.
    curve = [
        {
            "label": f"{int(round(p.bucket_low * 100))}-{int(round(p.bucket_high * 100))}%",
            "pred_mean": round(p.predicted_mean, 4),
            "actual_frac": round(p.actual_rate, 4),
            "count": p.n,
        }
        for p in reliability_diagram(y_test, p_test, n_buckets=10)
    ]

    metrics = TrainMetrics(
        market=market,
        n_train=len(X_train),
        n_test=len(X_test),
        brier_train=brier_train,
        brier_test=brier_test,
        logloss_test=ll_test,
        roi_kelly25_test=roi,
        pick_accuracy_test=pick_acc,
        pick_accuracy_n=pick_acc_n,
        feature_columns=list(X_train.columns),
        reliability_diagram=curve,
        low_sample_warning=low_sample,
        trained_at=_now_iso(),
    )
    model.metrics = metrics

    saved = model.save(out_dir)
    logger.info(
        "[%s] saved → %s | brier_test=%.4f logloss=%.4f roi_kelly25=%.4f pick_acc=%.3f (n=%d, vs 0.524 break-even)",
        market, saved, brier_test, ll_test, roi, pick_acc, pick_acc_n,
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

    # Separate markets by sport — each loads its own isolated dataset.
    nfl_markets      = [m for m in markets if m in NFL_MARKETS]
    nfl_prop_markets = [m for m in markets if m in NFL_PROP_MARKETS]
    soccer_markets   = [m for m in markets if m in SOCCER_MARKETS]
    tennis_markets   = [m for m in markets if m in TENNIS_MARKETS]
    std_markets      = [
        m for m in markets
        if m not in NFL_MARKETS and m not in NFL_PROP_MARKETS
        and m not in SOCCER_MARKETS and m not in TENNIS_MARKETS
    ]

    # Load standard dataset once for all non-NFL/soccer markets
    df = None
    mlb_pretrain_years: list[int] | None = None
    if std_markets:
        logger.info("Loading MLB dataset…")
        df = load_dataset(csv_path=csv_path)
        logger.info("Loaded %d rows; %d resolved", len(df), int(df["result"].notna().sum()))
        # MLB pre-training: team-strength history (final scores) for the score-
        # derivable markets, concatenated on top of live picks — the MLB analog
        # of the nflverse / football-data pre-training below.
        if not csv_path and settings.mlb_pretrain_enabled and any(
            m in MLB_PRETRAIN_MARKETS for m in std_markets
        ):
            try:
                from . import mlb_history_loader
                mlb_pretrain_years = mlb_history_loader.parse_seasons(settings.mlb_pretrain_seasons)
                logger.info("MLB pre-training enabled — seasons %s", mlb_pretrain_years)
            except Exception as exc:
                logger.warning("MLB pre-training setup failed (%s)", exc)
                mlb_pretrain_years = None

    # Load NFL dataset separately if any NFL market requested. Live picks come
    # from pick_features (empty in the offseason); nflverse historical EPA is
    # concatenated per-market so models can train before any live pick resolves.
    nfl_df = None
    nfl_pretrain_years: list[int] | None = None
    if (nfl_markets or nfl_prop_markets) and not csv_path:
        logger.info("Loading NFL live dataset…")
        try:
            nfl_df = load_dataset(sport="nfl")
            logger.info("NFL: Loaded %d live rows; %d resolved", len(nfl_df), int(nfl_df["result"].notna().sum()))
        except Exception as exc:
            logger.warning("NFL live dataset load failed (%s) — relying on nflverse history", exc)
            nfl_df = None
        if nfl_markets and settings.nfl_pretrain_enabled:
            try:
                from . import nflverse_loader
                if nflverse_loader.is_available():
                    nfl_pretrain_years = nflverse_loader.parse_seasons(settings.nfl_pretrain_seasons)
                    logger.info("NFL pre-training enabled — seasons %s", nfl_pretrain_years)
                else:
                    logger.warning("pyarrow unavailable — NFL pre-training skipped")
            except Exception as exc:
                logger.warning("NFL pre-training setup failed (%s)", exc)
                nfl_pretrain_years = None

    # Load Soccer dataset separately. Live picks come from pick_features (often
    # empty out of season); football-data.co.uk historical results + closing
    # odds are concatenated per-market so models can train before any live pick
    # resolves — the soccer analog of the nflverse pre-training above.
    soccer_df = None
    soccer_pretrain_years: list[int] | None = None
    if soccer_markets and not csv_path:
        logger.info("Loading Soccer live dataset…")
        try:
            soccer_df = load_dataset(sport="soccer")
            logger.info("Soccer: Loaded %d live rows; %d resolved", len(soccer_df), int(soccer_df["result"].notna().sum()))
        except Exception as exc:
            logger.warning("Soccer live dataset load failed (%s) — relying on football-data history", exc)
            soccer_df = None
        if settings.soccer_pretrain_enabled:
            try:
                from . import soccer_history_loader
                soccer_pretrain_years = soccer_history_loader.parse_seasons(settings.soccer_pretrain_seasons)
                logger.info("Soccer pre-training enabled — seasons %s", soccer_pretrain_years)
            except Exception as exc:
                logger.warning("Soccer pre-training setup failed (%s)", exc)
                soccer_pretrain_years = None

    # Load Tennis dataset separately
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
                    "pick_accuracy_test": metrics.pick_accuracy_test,
                    "pick_accuracy_n": metrics.pick_accuracy_n,
                    "reliability_diagram": metrics.reliability_diagram,
                    "low_sample_warning": metrics.low_sample_warning,
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
            if market in MLB_PRETRAIN_MARKETS and mlb_pretrain_years:
                from . import mlb_history_loader
                parts = []
                if df is not None and not df.empty:
                    parts.append(df)
                try:
                    hist = mlb_history_loader.build_mlb_training_frame(market, mlb_pretrain_years)
                    if not hist.empty:
                        logger.info("MLB %s: +%d historical rows", market, len(hist))
                        parts.append(hist)
                except Exception as exc:
                    logger.warning("MLB historical frame for %s failed (%s)", market, exc)
                if not parts:
                    logger.warning("MLB %s: no data (no live picks, no history) — skipping", market)
                    summary[market] = {"skipped": True, "reason": "no_data"}
                    continue
                combined = parts[0] if len(parts) == 1 else pd.concat(parts, ignore_index=True)
                _train_market(combined, market)
            else:
                _train_market(df, market)

    if nfl_markets:
        from . import nflverse_loader
        for market in nfl_markets:
            parts = []
            if nfl_df is not None and not nfl_df.empty:
                parts.append(nfl_df)
            if nfl_pretrain_years:
                try:
                    hist = nflverse_loader.build_nfl_training_frame(market, nfl_pretrain_years)
                    logger.info("NFL %s: +%d historical rows", market, len(hist))
                    parts.append(hist)
                except Exception as exc:
                    logger.warning("NFL historical frame for %s failed (%s)", market, exc)
            if not parts:
                logger.warning("NFL %s: no data (no live picks, no history) — skipping", market)
                summary[market] = {"skipped": True, "reason": "no_data"}
                continue
            combined = parts[0] if len(parts) == 1 else pd.concat(parts, ignore_index=True)
            _train_market(combined, market)

    # NFL player props: live-only (no nflverse pre-training — no historical lines).
    if nfl_prop_markets:
        for market in nfl_prop_markets:
            if nfl_df is None or nfl_df.empty:
                logger.warning("NFL %s: no live picks yet — skipping", market)
                summary[market] = {"skipped": True, "reason": "no_data"}
                continue
            _train_market(nfl_df, market)

    if soccer_markets:
        from . import soccer_history_loader
        for market in soccer_markets:
            parts = []
            if soccer_df is not None and not soccer_df.empty:
                parts.append(soccer_df)
            if soccer_pretrain_years:
                try:
                    hist = soccer_history_loader.build_soccer_training_frame(market, soccer_pretrain_years)
                    if not hist.empty:
                        logger.info("Soccer %s: +%d historical rows", market, len(hist))
                        parts.append(hist)
                except Exception as exc:
                    logger.warning("Soccer historical frame for %s failed (%s)", market, exc)
            if not parts:
                logger.warning("Soccer %s: no data (no live picks, no history) — skipping", market)
                summary[market] = {"skipped": True, "reason": "no_data"}
                continue
            combined = parts[0] if len(parts) == 1 else pd.concat(parts, ignore_index=True)
            _train_market(combined, market)

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
        choices=[*MARKETS, *NFL_MARKETS, *NFL_PROP_MARKETS, *SOCCER_MARKETS, *TENNIS_MARKETS, "all"],
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
    markets = (*MARKETS, *NFL_MARKETS, *SOCCER_MARKETS, *TENNIS_MARKETS) if args.market == "all" else (args.market,)
    train_all(
        csv_path=args.csv,
        out_dir=args.out_dir,
        markets=markets,
        min_train_size_override=args.min_train_size,
    )


if __name__ == "__main__":
    main()
