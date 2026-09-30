"""Prospective-style NFL model audit: fit past seasons, score the next one.

This is a research report, never a model promotion. Closing nflverse lines may
support predictive comparison, but cannot establish bet365 execution ROI.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

from .data import filter_for_market, load_dataset, make_target
from .features import build_X
from .market_baseline import resolve_market_reference
from .models import MARKET_MODELS

NFL_MARKETS = ("nfl_moneyline", "nfl_spread", "nfl_total")


def _season_and_week(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    date = pd.to_datetime(out["game_date"], errors="coerce", utc=True)
    year = date.dt.year - date.dt.month.le(2).astype(int)
    if "season" in out:
        out["audit_season"] = pd.to_numeric(out["season"], errors="coerce").fillna(year)
    else:
        out["audit_season"] = year
    if "week" in out:
        week = pd.to_numeric(out["week"], errors="coerce")
    else:
        week = pd.Series(np.nan, index=out.index)
    fallback = date.dt.strftime("%Y-%W")
    out["audit_week"] = np.where(week.notna(),
                                  out["audit_season"].astype("Int64").astype(str) + "-" + week.astype("Int64").astype(str),
                                  fallback)
    out["audit_game_date"] = date
    return out.dropna(subset=["audit_season", "audit_game_date"])


def _fit_calibration_selection_split(prior: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Three chronological windows, each containing whole game weeks."""
    ordered = prior.sort_values(["audit_game_date", "audit_week"], kind="stable")
    weeks = ordered["audit_week"].drop_duplicates().tolist()
    if len(weeks) < 6:
        empty = ordered.iloc[0:0]
        return empty, empty, empty
    n_tail = max(1, int(np.ceil(len(weeks) * 0.2)))
    fit_weeks = set(weeks[:-2 * n_tail])
    calibration_weeks = set(weeks[-2 * n_tail:-n_tail])
    selection_weeks = set(weeks[-n_tail:])
    return (ordered[ordered["audit_week"].isin(fit_weeks)],
            ordered[ordered["audit_week"].isin(calibration_weeks)],
            ordered[ordered["audit_week"].isin(selection_weeks)])


def _cluster_brier_delta(y: np.ndarray, model: np.ndarray, reference: np.ndarray,
                         weeks: np.ndarray, n_boot: int, seed: int) -> dict:
    mask = np.isfinite(y) & np.isfinite(model) & np.isfinite(reference)
    if not mask.any():
        return {"n": 0, "delta": None, "ci_low": None, "ci_high": None, "beats_reference": False}
    error = (model[mask] - y[mask]) ** 2 - (reference[mask] - y[mask]) ** 2
    groups = np.asarray(weeks)[mask]
    unique = np.unique(groups)
    group_values = [error[groups == group] for group in unique]
    rng = np.random.default_rng(seed)
    estimates = np.empty(n_boot)
    for i in range(n_boot):
        sampled = rng.integers(0, len(unique), len(unique))
        values = np.concatenate([group_values[j] for j in sampled])
        estimates[i] = values.mean()
    low, high = np.quantile(estimates, [0.025, 0.975])
    return {"n": int(mask.sum()), "weeks": len(unique),
            "delta": round(float(error.mean()), 5),
            "ci_low": round(float(low), 5), "ci_high": round(float(high), 5),
            "beats_reference": bool(high < 0)}


def evaluate_nfl_walk_forward(
    frame: pd.DataFrame,
    market: str,
    *,
    model_factory: Callable | None = None,
    min_fit: int = 120,
    min_calibration: int = 35,
    min_selection: int = 35,
    min_test: int = 50,
    n_boot: int = 1000,
    seed: int = 2026,
) -> dict:
    if market not in NFL_MARKETS:
        raise ValueError(f"Unsupported NFL market: {market}")
    if n_boot < 1:
        raise ValueError("n_boot must be positive")
    sub = _season_and_week(filter_for_market(frame, market))
    seasons = sorted(sub["audit_season"].astype(int).unique().tolist())
    folds = []
    factory = model_factory or MARKET_MODELS[market]
    for season in seasons[1:]:
        prior = sub[sub["audit_season"] < season]
        test = sub[sub["audit_season"] == season]
        fit, calibration, selection = _fit_calibration_selection_split(prior)
        fold = {"test_season": int(season), "n_fit": len(fit),
                "n_calibration": len(calibration), "n_selection": len(selection), "n_test": len(test)}
        if (len(fit) < min_fit or len(calibration) < min_calibration
                or len(selection) < min_selection or len(test) < min_test):
            fold["status"] = "insufficient_samples"
            folds.append(fold)
            continue
        y_fit = make_target(fit, market).to_numpy(dtype=int)
        y_calib = make_target(calibration, market).to_numpy(dtype=int)
        y_test = make_target(test, market).to_numpy(dtype=int)
        if len(np.unique(y_fit)) != 2 or len(np.unique(y_calib)) != 2:
            fold["status"] = "single_class_fit_or_calibration"
            folds.append(fold)
            continue
        model = factory()
        model.fit(build_X(fit, market), y_fit,
                  X_calib=build_X(calibration, market), y_calib=y_calib)
        probability = np.asarray(model.predict_proba(build_X(test, market)), dtype=float)
        if probability.shape != y_test.shape or not np.isfinite(probability).all():
            fold["status"] = "invalid_predictions"
            folds.append(fold)
            continue
        probability = np.clip(probability, 1e-6, 1 - 1e-6)
        ref = resolve_market_reference(test, market)
        selection_ref = resolve_market_reference(selection, market)
        base = np.full(len(test), float(y_fit.mean()))
        weeks = test["audit_week"].astype(str).to_numpy()
        fold.update({
            "status": "evaluated",
            "fit_last_date": fit["audit_game_date"].max().isoformat(),
            "calibration_first_date": calibration["audit_game_date"].min().isoformat(),
            "selection_first_date": selection["audit_game_date"].min().isoformat(),
            "test_first_date": test["audit_game_date"].min().isoformat(),
            "brier": round(float(np.mean((probability - y_test) ** 2)), 5),
            "log_loss": round(float(np.mean(-y_test * np.log(probability)
                                              - (1 - y_test) * np.log(1 - probability))), 5),
            "vs_base_rate": _cluster_brier_delta(y_test, probability, base, weeks, n_boot, seed),
            "market_reference": {"source": ref.source, "coverage": ref.coverage,
                                 "note": ref.note},
            "vs_market": _cluster_brier_delta(y_test, probability, ref.probs, weeks, n_boot, seed),
            "price_roi": None,
            "price_roi_reason": "bet365 accepted prices are not present in this training frame",
        })
        if selection_ref.coverage >= 0.95 and ref.coverage >= 0.95:
            y_selection = make_target(selection, market).to_numpy(dtype=int)
            p_selection = np.asarray(model.predict_proba(build_X(selection, market)), dtype=float)
            candidates = (0.0, 0.1, 0.25, 0.5, 1.0)
            finite = np.isfinite(selection_ref.probs) & np.isfinite(p_selection)
            weight = min(candidates, key=lambda w: np.mean(
                (w * p_selection[finite] + (1 - w) * selection_ref.probs[finite]
                 - y_selection[finite]) ** 2))
            blended = weight * probability + (1 - weight) * ref.probs
            comparison = _cluster_brier_delta(y_test, blended, ref.probs, weeks, n_boot, seed)
            fold["market_blend"] = {
                "model_weight_selected_on_prior_weeks": weight,
                "brier": round(float(np.nanmean((blended - y_test) ** 2)), 5),
                "vs_market": comparison,
                "selection_market_coverage": selection_ref.coverage,
            }
        else:
            fold["market_blend"] = None
        folds.append(fold)
    return {"market": market, "method": "expanding_season_walk_forward",
            "calibration": "middle_20_percent_of_prior_game_weeks",
            "selection": "last_20_percent_of_prior_game_weeks; fixed_blend_grid_0,0.1,0.25,0.5,1",
            "bootstrap_unit": "game_week", "label_version": 2,
            "seasons": seasons, "n_filtered": len(sub), "folds": folds,
            "promotion_ready": False,
            "note": "This audit measures prediction, not executable bet365 profitability."}


def main() -> None:
    parser = argparse.ArgumentParser(description="NFL expanding-season walk-forward audit")
    parser.add_argument("--market", choices=(*NFL_MARKETS, "all"), required=True)
    parser.add_argument("--csv", help="Exported pick_features CSV; without it read DATABASE_URL")
    parser.add_argument("--nflverse-years", help="Comma-separated historical seasons, e.g. 2018,2019")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    live = None
    if args.csv or not args.nflverse_years:
        live = load_dataset(csv_path=args.csv, sport="nfl")
    years = [int(year) for year in args.nflverse_years.split(",")] if args.nflverse_years else []
    if args.nflverse_years:
        from .nflverse_loader import build_nfl_training_frame
    markets = NFL_MARKETS if args.market == "all" else (args.market,)
    for market in markets:
        frames = [live] if live is not None else []
        if years:
            frames.append(build_nfl_training_frame(market, years, include_schedule_prices=True))
        report = evaluate_nfl_walk_forward(pd.concat(frames, ignore_index=True), market)
        target = args.out / f"{market}.json" if args.market == "all" else args.out
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
        print(f"Wrote {target} ({sum(f['status'] == 'evaluated' for f in report['folds'])} evaluated folds)")


if __name__ == "__main__":
    main()
