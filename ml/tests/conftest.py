"""Pytest fixtures shared across the ML test suite."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def fake_dataset() -> pd.DataFrame:
    """Synthetic pick_features-shaped DataFrame for unit tests.

    180 rows across 6 months. Generated with a known signal:
      home wins more often when home_pitcher_xwoba is lower (better) than away.
    Enough rows so temporal_split has both train and test sides.
    """
    rng = np.random.default_rng(seed=42)
    n = 180

    dates = pd.date_range("2025-01-01", periods=n, freq="D")

    home_xwoba = rng.uniform(0.270, 0.360, size=n)
    away_xwoba = rng.uniform(0.270, 0.360, size=n)

    # Inject signal: pitcher xwoba differential drives outcomes
    edge = away_xwoba - home_xwoba  # positive → home pitcher better
    logit = 10 * edge + rng.normal(0, 0.5, size=n)
    home_win = (1 / (1 + np.exp(-logit))) > rng.uniform(0, 1, size=n)

    home_score = np.where(home_win, rng.integers(4, 11, n), rng.integers(0, 5, n))
    away_score = np.where(home_win, rng.integers(0, 5, n), rng.integers(4, 11, n))
    total = home_score + away_score

    return pd.DataFrame({
        "id": range(1, n + 1),
        "pick_id": range(1, n + 1),
        "game_pk": range(700000, 700000 + n),
        "game_date": dates,
        "market_type": rng.choice(["moneyline", "overunder", "runline"], size=n),
        "side": rng.choice(["home", "away", "over", "under"], size=n),
        "line": rng.choice([7.5, 8.5, 9.5, -1.5, 1.5], size=n).astype(float),
        "result": rng.choice(["win", "loss", "push"], size=n, p=[0.55, 0.42, 0.03]),
        "home_score": home_score,
        "away_score": away_score,
        "total_runs": total,
        "home_pitcher_xwoba": home_xwoba,
        "away_pitcher_xwoba": away_xwoba,
        "home_pitcher_whiff": rng.uniform(20, 35, n),
        "away_pitcher_whiff": rng.uniform(20, 35, n),
        "home_pitcher_k_pct": rng.uniform(18, 32, n),
        "away_pitcher_k_pct": rng.uniform(18, 32, n),
        "home_pitcher_era": rng.uniform(2.5, 5.5, n),
        "away_pitcher_era": rng.uniform(2.5, 5.5, n),
        "home_pitcher_days_rest": rng.integers(3, 7, n),
        "away_pitcher_days_rest": rng.integers(3, 7, n),
        "home_pitcher_pitches_last_start": rng.integers(75, 110, n),
        "away_pitcher_pitches_last_start": rng.integers(75, 110, n),
        "home_bullpen_pitches_last_3d": rng.integers(20, 90, n),
        "away_bullpen_pitches_last_3d": rng.integers(20, 90, n),
        "home_team_ops": rng.uniform(0.680, 0.820, n),
        "away_team_ops": rng.uniform(0.680, 0.820, n),
        "home_lineup_avg_xwoba": rng.uniform(0.290, 0.370, n),
        "away_lineup_avg_xwoba": rng.uniform(0.290, 0.370, n),
        "park_factor_overall": rng.integers(90, 115, n),
        "park_factor_hr": rng.integers(85, 120, n),
        "temperature": rng.uniform(50, 95, n),
        "wind_speed": rng.uniform(0, 20, n),
        "is_day_game": rng.integers(0, 2, n),
        "is_dome": rng.integers(0, 2, n),
        "game_number_in_series": rng.integers(1, 4, n),
        "umpire_id": rng.integers(10000, 99999, n),
        "odds_ml_home": rng.choice([-200, -150, -110, +120, +160, +200], size=n),
        "odds_ml_away": rng.choice([-200, -150, -110, +120, +160, +200], size=n),
        "odds_ou_total": rng.choice([8.0, 8.5, 9.0, 9.5, 10.0], size=n),
        "data_quality_score": rng.integers(60, 100, n),
        "signal_coherence_score": rng.integers(60, 100, n),
        "oracle_confidence": rng.integers(50, 90, n),
        "kelly_fraction": rng.uniform(0, 0.1, n),
        "prop_kind": [None] * n,
        "prop_player_id": [None] * n,
        "source": ["live"] * n,
    })
