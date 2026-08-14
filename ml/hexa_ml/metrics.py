"""Pure evaluation metrics (numpy-only) shared by the training pipeline.

Kept dependency-light (no sklearn/pydantic/xgboost) so honest backtest metrics
can be unit-tested in isolation.
"""

from __future__ import annotations

import numpy as np


def pick_accuracy(y_true: np.ndarray, p: np.ndarray) -> tuple[float, int]:
    """Directional hit rate at the model's >50% pick on a held-out set.

    The binary target is pick-aligned (1 = the modelled side won: home covers /
    over hits / home wins). The model bets whichever side it favours, so the honest
    score is how often that side actually won — ATS for spread, over/under for
    total, straight-up for moneyline. This is the test a training Brier can't show:
    only above the -110 break-even (~0.524) does the model beat the vig.
    Coin-flips (p == 0.5) are excluded. Returns (accuracy, n_scored).
    """
    y = np.asarray(y_true).astype(float)
    p = np.asarray(p).astype(float)
    mask = p != 0.5
    n = int(mask.sum())
    if n == 0:
        return 0.0, 0
    hit = (p[mask] > 0.5) == (y[mask] == 1)
    return float(hit.mean()), n


def american_to_implied(odds: np.ndarray) -> np.ndarray:
    """American odds → vig-inclusive implied probability.

    Zero is not a valid American price; it yields NaN rather than the
    silent infinity a naive 100/abs(0) would produce.
    """
    o = np.asarray(odds, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        imp = np.where(o > 0, 100.0 / (o + 100.0), np.abs(o) / (np.abs(o) + 100.0))
    return np.where(np.isfinite(o) & (o != 0), imp, np.nan)


def devig_two_way(imp_a: np.ndarray, imp_b: np.ndarray) -> np.ndarray:
    """Strip the vig from a two-way market by proportional normalisation.

    Returns the fair probability of side A. The book's overround is
    imp_a + imp_b - 1; splitting it in proportion to each side's implied
    probability is the standard (multiplicative) de-vig. Pairs where either
    side is missing, or that do not overround, return NaN — a de-vigged
    number from a half-quoted market would be a fabrication.
    """
    a = np.asarray(imp_a, dtype=float)
    b = np.asarray(imp_b, dtype=float)
    total = a + b
    with np.errstate(divide="ignore", invalid="ignore"):
        fair = a / total
    ok = np.isfinite(a) & np.isfinite(b) & (total > 0)
    return np.where(ok, fair, np.nan)


def brier_per_row(y_true: np.ndarray, p: np.ndarray) -> np.ndarray:
    """Squared error per observation — the paired unit behind every Brier."""
    y = np.asarray(y_true, dtype=float)
    return (np.asarray(p, dtype=float) - y) ** 2


def paired_brier_comparison(
    y_true: np.ndarray,
    p_model: np.ndarray,
    p_reference: np.ndarray,
    n_boot: int = 10_000,
    seed: int = 0,
) -> dict:
    """Compare a model's Brier against a reference's on the SAME rows.

    The comparison is paired: both scores come from identical observations,
    so the sampling noise that dominates a small test set largely cancels.
    Rows where either probability is missing are dropped from both sides.

    `delta` is model minus reference, so negative means the model is better.
    The bootstrap resamples rows (not scores) to get a distribution for that
    delta; `beats_reference` is True only when the whole 95% interval sits
    below zero. On a 77-row test set that bar is rarely cleared, which is
    the point — it stops a lucky slice from reading as an edge.
    """
    y = np.asarray(y_true, dtype=float)
    pm = np.asarray(p_model, dtype=float)
    pr = np.asarray(p_reference, dtype=float)

    mask = np.isfinite(y) & np.isfinite(pm) & np.isfinite(pr)
    n = int(mask.sum())
    if n == 0:
        return {
            "n": 0,
            "brier_model": None,
            "brier_reference": None,
            "delta": None,
            "skill_score": None,
            "ci_low": None,
            "ci_high": None,
            "beats_reference": False,
        }

    err_m = brier_per_row(y[mask], pm[mask])
    err_r = brier_per_row(y[mask], pr[mask])
    brier_m = float(err_m.mean())
    brier_r = float(err_r.mean())
    delta = brier_m - brier_r

    diff = err_m - err_r
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_boot, n))
    boot = diff[idx].mean(axis=1)
    ci_low, ci_high = np.percentile(boot, [2.5, 97.5])

    # Murphy skill score: fraction of the reference's error the model removes.
    skill = 1.0 - brier_m / brier_r if brier_r > 0 else None

    return {
        "n": n,
        "brier_model": round(brier_m, 4),
        "brier_reference": round(brier_r, 4),
        "delta": round(delta, 4),
        "skill_score": round(skill, 4) if skill is not None else None,
        "ci_low": round(float(ci_low), 4),
        "ci_high": round(float(ci_high), 4),
        "beats_reference": bool(ci_high < 0),
    }
