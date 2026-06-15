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
