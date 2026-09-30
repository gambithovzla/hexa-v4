"""Research audit: can pregame NFL features improve the closing market forecast?

The market is the anchor. Ridge estimates only a residual to its de-vigged
probability. No bet365 entry prices exist here, so this cannot establish ROI.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .data import filter_for_market, load_dataset, make_target
from .features import build_X
from .market_baseline import resolve_market_reference
from .nfl_walk_forward import (
    NFL_MARKETS, _cluster_brier_delta, _fit_calibration_selection_split,
    _season_and_week,
)

RESIDUAL_FEATURES = (
    "epa_composite_diff", "epa_composite_adj_diff", "form_diff", "rest_diff",
)
ALPHAS = (10.0, 100.0, 1000.0)
SHRINKAGES = (0.0, 0.25, 0.5, 1.0)


def _features(frame: pd.DataFrame, market: str) -> pd.DataFrame:
    x = build_X(frame, market)
    return x.loc[:, list(RESIDUAL_FEATURES)]


def _scores(y: np.ndarray, p: np.ndarray) -> dict:
    finite = np.isfinite(y) & np.isfinite(p)
    if not finite.any():
        return {"n": 0, "brier": None, "log_loss": None}
    q = np.clip(p[finite], 1e-6, 1 - 1e-6)
    outcome = y[finite]
    return {"n": int(finite.sum()),
            "brier": round(float(np.mean((q - outcome) ** 2)), 5),
            "log_loss": round(float(np.mean(-outcome * np.log(q)
                                           - (1 - outcome) * np.log(1 - q))), 5)}


def evaluate_nfl_market_residual(frame: pd.DataFrame, market: str, *,
                                 min_fit: int = 120, min_selection: int = 35,
                                 min_test: int = 50, n_boot: int = 1000,
                                 seed: int = 2026) -> dict:
    if market not in NFL_MARKETS:
        raise ValueError(f"Unsupported NFL market: {market}")
    if n_boot < 1:
        raise ValueError("n_boot must be positive")
    sub = _season_and_week(filter_for_market(frame, market))
    seasons = sorted(sub["audit_season"].astype(int).unique().tolist())
    folds = []
    for season in seasons[1:]:
        prior = sub[sub["audit_season"] < season]
        test = sub[sub["audit_season"] == season]
        fit, calibration, selection = _fit_calibration_selection_split(prior)
        # Calibration weeks stay embargoed. The residual model has no separate
        # calibrator; only older fit weeks train it and later selection weeks
        # select alpha/shrinkage. Test season is never inspected for selection.
        fold = {"test_season": int(season), "n_fit": len(fit),
                "n_embargoed_calibration": len(calibration),
                "n_selection": len(selection), "n_test": len(test)}
        if len(fit) < min_fit or len(selection) < min_selection or len(test) < min_test:
            fold["status"] = "insufficient_samples"
            folds.append(fold)
            continue
        fit_ref = resolve_market_reference(fit, market).probs
        select_ref = resolve_market_reference(selection, market).probs
        test_ref = resolve_market_reference(test, market).probs
        y_fit = make_target(fit, market).to_numpy(dtype=float)
        y_select = make_target(selection, market).to_numpy(dtype=float)
        y_test = make_target(test, market).to_numpy(dtype=float)
        fit_mask = np.isfinite(fit_ref)
        select_mask = np.isfinite(select_ref)
        if (fit_mask.sum() < min_fit or select_mask.sum() < min_selection
                or not np.isfinite(test_ref).any()):
            fold["status"] = "market_reference_unavailable"
            folds.append(fold)
            continue
        x_fit = _features(fit, market)
        x_select = _features(selection, market)
        x_test = _features(test, market)
        candidates = []
        for alpha in ALPHAS:
            model = make_pipeline(
                SimpleImputer(strategy="median", keep_empty_features=True),
                StandardScaler(), Ridge(alpha=alpha),
            )
            model.fit(x_fit.loc[fit_mask], y_fit[fit_mask] - fit_ref[fit_mask])
            select_delta = model.predict(x_select)
            test_delta = model.predict(x_test)
            for shrinkage in SHRINKAGES:
                selected = np.clip(select_ref[select_mask]
                                   + shrinkage * select_delta[select_mask], 1e-6, 1 - 1e-6)
                candidates.append((float(np.mean((selected - y_select[select_mask]) ** 2)),
                                   shrinkage, alpha, test_delta))
        # Prefer no adjustment on a tie, then stronger regularization.
        _, shrinkage, alpha, test_delta = min(candidates,
                                               key=lambda item: (item[0], item[1], -item[2]))
        predicted = np.clip(test_ref + shrinkage * test_delta, 1e-6, 1 - 1e-6)
        weeks = test["audit_week"].astype(str).to_numpy()
        fold.update({"status": "evaluated",
                     "fit_last_date": fit["audit_game_date"].max().isoformat(),
                     "selection_first_date": selection["audit_game_date"].min().isoformat(),
                     "test_first_date": test["audit_game_date"].min().isoformat(),
                     "selected_alpha": alpha, "selected_shrinkage": shrinkage,
                     "market": _scores(y_test, test_ref),
                     "residual": _scores(y_test, predicted),
                     "vs_market": _cluster_brier_delta(y_test, predicted, test_ref,
                                                       weeks, n_boot, seed)})
        folds.append(fold)
    return {"market": market, "method": "market_residual_expanding_season",
            "features": list(RESIDUAL_FEATURES), "alpha_grid": list(ALPHAS),
            "shrinkage_grid": list(SHRINKAGES), "bootstrap_unit": "game_week",
            "seasons": seasons, "n_filtered": len(sub), "folds": folds,
            "promotion_ready": False,
            "price_roi": None,
            "note": "Uses public closing prices, not bet365 entry prices; predictive audit only."}


def main() -> None:
    parser = argparse.ArgumentParser(description="NFL market residual audit")
    parser.add_argument("--market", choices=(*NFL_MARKETS, "all"), required=True)
    parser.add_argument("--csv", help="Exported pick_features CSV")
    parser.add_argument("--nflverse-years", help="Comma-separated historical seasons")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    live = load_dataset(csv_path=args.csv, sport="nfl") if args.csv or not args.nflverse_years else None
    years = [int(value) for value in args.nflverse_years.split(",")] if args.nflverse_years else []
    if years:
        from .nflverse_loader import build_nfl_training_frame
    markets = NFL_MARKETS if args.market == "all" else (args.market,)
    for market in markets:
        frames = [live] if live is not None else []
        if years:
            frames.append(build_nfl_training_frame(market, years, include_schedule_prices=True))
        report = evaluate_nfl_market_residual(pd.concat(frames, ignore_index=True), market)
        target = args.out / f"{market}_residual.json" if args.market == "all" else args.out
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
        print(f"Wrote {target} ({sum(f['status'] == 'evaluated' for f in report['folds'])} evaluated folds)")


if __name__ == "__main__":
    main()
