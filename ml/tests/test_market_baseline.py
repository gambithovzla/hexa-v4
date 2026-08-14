"""Tests for the reference forecasters every model is scored against."""

from __future__ import annotations

import numpy as np
import pandas as pd

from hexa_ml.market_baseline import (
    build_baseline_report,
    resolve_market_reference,
)
from hexa_ml.metrics import (
    american_to_implied,
    devig_two_way,
    paired_brier_comparison,
)


def test_american_to_implied_both_signs():
    imp = american_to_implied(np.array([-110.0, 100.0, -200.0]))
    assert imp[0] == 110 / 210
    assert imp[1] == 0.5
    assert imp[2] == 200 / 300


def test_american_to_implied_rejects_zero_and_nan():
    """Zero is not a price. The naive 100/abs(0) would silently return inf,
    which downstream reads as a free bet at infinite odds."""
    imp = american_to_implied(np.array([0.0, np.nan]))
    assert np.isnan(imp).all()


def test_devig_two_way_removes_overround():
    # -110 both sides: each implies 52.38%, summing to 104.76%.
    imp = american_to_implied(np.array([-110.0]))
    fair = devig_two_way(imp, imp)
    assert abs(fair[0] - 0.5) < 1e-12


def test_devig_two_way_favourite_underdog():
    fair = devig_two_way(
        american_to_implied(np.array([-200.0])),
        american_to_implied(np.array([170.0])),
    )
    # Fair prob sits below the vig-inclusive 66.7% implied by -200 alone.
    assert 0.60 < fair[0] < 0.667


def test_devig_needs_both_sides():
    fair = devig_two_way(np.array([0.55]), np.array([np.nan]))
    assert np.isnan(fair[0])


def test_paired_comparison_detects_a_real_edge():
    rng = np.random.default_rng(0)
    n = 4000
    truth = rng.uniform(0.2, 0.8, size=n)
    y = (rng.uniform(size=n) < truth).astype(int)
    # Model sees the truth; reference is a coin flip.
    result = paired_brier_comparison(y, truth, np.full(n, 0.5), n_boot=2000)
    assert result["delta"] < 0
    assert result["beats_reference"] is True
    assert result["skill_score"] > 0


def test_paired_comparison_calls_a_coin_flip_a_coin_flip():
    """A model that merely matches the reference must not read as an edge."""
    rng = np.random.default_rng(1)
    n = 77  # the NFL test-set size
    y = rng.integers(0, 2, size=n)
    p_model = np.full(n, 0.5) + rng.normal(0, 0.01, size=n)
    result = paired_brier_comparison(y, p_model, np.full(n, 0.5), n_boot=2000)
    assert result["beats_reference"] is False
    assert result["ci_low"] < 0 < result["ci_high"]


def test_paired_comparison_handles_missing_reference_rows():
    y = np.array([1, 0, 1, 0])
    p_model = np.array([0.6, 0.4, 0.7, 0.3])
    p_ref = np.array([0.5, np.nan, 0.5, np.nan])
    result = paired_brier_comparison(y, p_model, p_ref, n_boot=500)
    assert result["n"] == 2


def test_paired_comparison_empty_overlap():
    result = paired_brier_comparison(
        np.array([1, 0]), np.array([0.5, 0.5]), np.array([np.nan, np.nan])
    )
    assert result["n"] == 0
    assert result["beats_reference"] is False


def test_moneyline_reference_devigs_stored_prices():
    df = pd.DataFrame({
        "odds_ml_home": [-150.0, 120.0],
        "odds_ml_away": [130.0, -140.0],
        "source": ["live", "live"],
    })
    ref = resolve_market_reference(df, "moneyline")
    assert ref.source == "devig_two_way"
    assert ref.coverage == 1.0
    assert 0.5 < ref.probs[0] < 0.62
    assert ref.probs[1] < 0.5


def test_moneyline_reference_excludes_synthetic_mlb_history_odds():
    """MLB pre-training fills odds from a Pythagorean expectation built out of
    the same team-strength features the booster trains on. Scoring the model
    against those prices would be scoring it against itself."""
    df = pd.DataFrame({
        "odds_ml_home": [-150.0, -150.0],
        "odds_ml_away": [130.0, 130.0],
        "source": ["live", "mlb_history"],
    })
    ref = resolve_market_reference(df, "moneyline")
    assert ref.n_covered == 1
    assert ref.excluded_synthetic == 1
    assert np.isnan(ref.probs[1])


def test_symmetric_line_markets_reference_at_half():
    df = pd.DataFrame({"spread_close": [-3.5, 7.0]})
    ref = resolve_market_reference(df, "nfl_spread")
    assert ref.source == "symmetric_line"
    assert (ref.probs == 0.5).all()


def test_prop_reference_is_flagged_as_vig_inclusive():
    df = pd.DataFrame({"prop_odds_american": [-120.0, 105.0]})
    ref = resolve_market_reference(df, "prop_hits")
    assert ref.source == "one_way_vig_inclusive"
    assert "biased HIGH" in ref.note


def test_missing_columns_yield_unavailable_not_a_guess():
    df = pd.DataFrame({"game_date": pd.to_datetime(["2025-01-01"])})
    ref = resolve_market_reference(df, "moneyline")
    assert ref.source == "unavailable"
    assert ref.n_covered == 0
    assert np.isnan(ref.probs).all()


def test_unknown_market_has_no_fabricated_reference():
    df = pd.DataFrame({"odds_ml_home": [-110.0]})
    ref = resolve_market_reference(df, "runline")
    assert ref.source == "unavailable"


def test_baseline_report_shape():
    rng = np.random.default_rng(3)
    n = 60
    y_train = rng.integers(0, 2, size=200)
    y_test = rng.integers(0, 2, size=n)
    p_test = np.full(n, 0.55)
    test_df = pd.DataFrame({
        "odds_ml_home": np.full(n, -110.0),
        "odds_ml_away": np.full(n, -110.0),
        "source": ["live"] * n,
    })
    report = build_baseline_report(y_train, y_test, p_test, test_df, "moneyline", n_boot=500)
    assert report.market_source == "devig_two_way"
    assert report.vs_market["n"] == n
    assert report.vs_base_rate["n"] == n
    assert 0.0 <= report.base_rate <= 1.0
