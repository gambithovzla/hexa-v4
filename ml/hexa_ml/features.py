"""Feature engineering — turns the raw pick_features DataFrame into a
numeric matrix XGBoost can consume.

Conventions:
  - All categorical encoding is explicit (no get_dummies surprises).
  - NaN is preserved — XGBoost handles missing values natively.
  - Functions are pure; the trained pipeline saves the column order so
    inference uses the exact same schema.
"""

from __future__ import annotations

import pandas as pd

# Numeric features used by every market model. Order matters — it's the
# contract between training and inference.
BASE_NUMERIC_FEATURES = [
    # Pitching
    "home_pitcher_xwoba", "away_pitcher_xwoba",
    "home_pitcher_whiff", "away_pitcher_whiff",
    "home_pitcher_k_pct", "away_pitcher_k_pct",
    "home_pitcher_era", "away_pitcher_era",
    "home_pitcher_days_rest", "away_pitcher_days_rest",
    "home_pitcher_pitches_last_start", "away_pitcher_pitches_last_start",
    "home_bullpen_pitches_last_3d", "away_bullpen_pitches_last_3d",
    # Hitting
    "home_team_ops", "away_team_ops",
    "home_lineup_avg_xwoba", "away_lineup_avg_xwoba",
    # Park / weather
    "park_factor_overall", "park_factor_hr",
    "temperature", "wind_speed",
    # Game context
    "game_number_in_series",
    # Odds (market signal)
    "odds_ml_home", "odds_ml_away", "odds_ou_total",
    # Team strength — the only MLB signals available BOTH live (standings) and in
    # free history (schedule scores). They carry the pre-training frame, where all
    # the Statcast columns above are NaN. Cumulative season-to-date, computed
    # as-of each game (no leakage).
    "home_runs_for_avg", "away_runs_for_avg",
    "home_runs_against_avg", "away_runs_against_avg",
    "home_run_diff_avg", "away_run_diff_avg",
    "home_win_pct", "away_win_pct",
    "home_venue_win_pct", "away_venue_win_pct",
    "home_last10_wins", "away_last10_wins",
]

# Boolean features encoded as int (0/1/NaN)
BOOL_FEATURES = ["is_day_game", "is_dome"]

# Computed differentials — same matchup info rephrased as edges
DERIVED_FEATURES = [
    "pitcher_xwoba_diff",      # away - home (positive = home pitcher better)
    "pitcher_era_diff",
    "lineup_xwoba_diff",       # home - away (positive = home offense better)
    "team_ops_diff",
    "days_rest_diff",
    "bullpen_fatigue_diff",    # higher = home pen more rested
    "implied_prob_home",       # from odds_ml_home
    "implied_prob_away",
    # Team-strength edges (home − away) — the dominant signals in pre-training
    "run_diff_edge",           # season run differential per game
    "win_pct_edge",
    "venue_win_pct_edge",      # home team at home vs away team on road
    "last10_form_edge",
]

# ── NFL features ──────────────────────────────────────────────────────────────

NFL_BASE_NUMERIC = [
    "home_epa_off", "away_epa_off",
    "home_epa_def", "away_epa_def",
    # opponent-adjusted (SOS) EPA — DVOA-style; alongside raw so live serving that
    # only supplies raw EPA still feeds the model.
    "home_epa_off_adj", "away_epa_off_adj",
    "home_epa_def_adj", "away_epa_def_adj",
    "home_success_rate", "away_success_rate",
    "home_proe", "away_proe",
    # situational efficiency — computed by build_team_stats / as-of-week situational,
    # previously surfaced to the Oracle but never fed to the model:
    "home_rz_td_pct_off", "away_rz_td_pct_off",
    "home_rz_td_pct_def", "away_rz_td_pct_def",
    "home_third_down_conv_off", "away_third_down_conv_off",
    "home_third_down_conv_def", "away_third_down_conv_def",
    "home_sack_rate_off", "away_sack_rate_off",
    "home_sack_rate_def", "away_sack_rate_def",
    # recent scoring form (prior-week PPG / point diff):
    "home_form_ppg_for", "away_form_ppg_for",
    "home_form_ppg_against", "away_form_ppg_against",
    "home_form_point_diff", "away_form_point_diff",
    "home_rest_days", "away_rest_days",
    "injuries_home_severe", "injuries_away_severe",
    "wind_mph",
    "oracle_confidence",
    "data_quality_score",
    "signal_coherence_score",
]

NFL_BOOL_FEATURES = [
    "home_is_short_week", "away_is_short_week",
    "home_is_off_bye", "away_is_off_bye",
    "qb_home_active", "qb_away_active",
    "is_dome",
]

NFL_DERIVED_FEATURES = [
    "epa_off_diff",
    "epa_def_diff",
    "epa_composite_diff",
    "epa_off_adj_diff",
    "epa_def_adj_diff",
    "epa_composite_adj_diff",
    "rz_off_diff",
    "third_down_off_diff",
    "sack_protection_diff",
    "sack_pressure_diff",
    "form_diff",
    "rest_diff",
    "injury_diff",
]

# ── Soccer features (Sprint 11 ML sidecar) ───────────────────────────────────

SOCCER_BASE_NUMERIC = [
    # Season goal stats
    "home_goals_for",    "away_goals_for",
    "home_goals_against", "away_goals_against",
    "home_goal_diff",    "away_goal_diff",
    "home_points",       "away_points",
    # xG (null until Understat/FBref produces reliable per-game data)
    "home_xg",  "away_xg",
    "home_xga", "away_xga",
    # Recent form
    "home_last10_wins", "away_last10_wins",
    # 3-way odds (dominant signal for soccer)
    "odds_ml_home", "odds_ml_away", "draw_price",
    "odds_ou_total", "btts_yes_price",
    # Context quality
    "context_completeness",
    "oracle_confidence",
]

SOCCER_DERIVED_FEATURES = [
    "goal_diff_delta",        # home_goal_diff - away_goal_diff
    "points_delta",           # home_points - away_points
    "xg_diff",                # home_xg - away_xg (NaN when xg unavailable)
    "form_wins_diff",         # home_last10_wins - away_last10_wins
    "implied_prob_home",      # de-vigged from 3-way market
    "implied_prob_draw",
    "implied_prob_away",
]

# ── Tennis features (individual sport — player A = "home" slot) ────────────────

TENNIS_BASE_NUMERIC = [
    "home_elo_surface", "away_elo_surface",
    "home_elo_overall", "away_elo_overall",
    "home_rank", "away_rank",
    "h2h_surface_wins_home", "h2h_surface_wins_away",
    "h2h_total_wins_home", "h2h_total_wins_away",
    "home_rest_days", "away_rest_days",
    "home_sets_played_tourney", "away_sets_played_tourney",
    "best_of",
    "oracle_confidence",
    "data_quality_score",
    "signal_coherence_score",
]

# Surface is the tennis "park factor"; one-hot it so the model can learn
# surface-conditional behaviour even within a single pooled model.
TENNIS_SURFACE_ONEHOT = [
    "surface_hard", "surface_clay", "surface_grass", "surface_carpet",
]

TENNIS_DERIVED_FEATURES = [
    "elo_surface_diff",
    "elo_overall_diff",
    "rank_diff",
    "h2h_surface_diff",
    "h2h_total_diff",
    "fatigue_diff",
]

# ── Player-prop snapshot features (Sprint 5 deferred resumed) ─────────────────

PROP_NUMERIC_FEATURES = [
    "prop_player_xwoba", "prop_player_xba", "prop_player_xslg",
    "prop_player_k_pct", "prop_player_bb_pct",
    "prop_player_avg_exit_velocity", "prop_player_barrel_pct",
    "prop_player_hard_hit_pct",
    "prop_player_rolling_woba_7d", "prop_player_rolling_woba_14d", "prop_player_rolling_woba_21d",
    "prop_player_ops_vs_lhp", "prop_player_ops_vs_rhp",
    "prop_opponent_pitcher_xwoba_against", "prop_opponent_pitcher_k_pct",
    "prop_implied_prob",
]

# NFL player props (pooled "nfl_prop" market). Pick-aligned: the model predicts
# P(the bet side wins). Player season/recent averages are null until the nflverse
# player-stats fetcher lands (Fase 2.1) — XGBoost tolerates the NaNs; the strongest
# present signal is the de-vigged market fair prob and the average-vs-line gap.
NFL_PROP_KINDS = (
    "pass_yds", "pass_tds", "pass_completions", "pass_attempts", "pass_interceptions",
    "rush_yds", "rush_attempts", "reception_yds", "receptions", "anytime_td",
)
NFL_PROP_KIND_ONEHOT = [f"propkind_{k}" for k in NFL_PROP_KINDS]
NFL_PROP_FEATURES = [
    "line", "prop_side_over",
    "prop_implied_prob", "nfl_prop_fair_prob",
    "nfl_prop_player_season_avg", "nfl_prop_player_recent_avg", "nfl_prop_player_games",
    "nfl_prop_season_minus_line", "nfl_prop_recent_minus_line",
    *NFL_PROP_KIND_ONEHOT,
]


def _american_to_implied_prob(odds: pd.Series) -> pd.Series:
    """Convert American moneyline odds to implied probability."""
    odds = pd.to_numeric(odds, errors="coerce")
    out = pd.Series(index=odds.index, dtype="float64")
    pos_mask = odds > 0
    neg_mask = odds < 0
    out[pos_mask] = 100.0 / (odds[pos_mask] + 100.0)
    out[neg_mask] = -odds[neg_mask] / (-odds[neg_mask] + 100.0)
    return out


def _col_or_nan(df: pd.DataFrame, col: str) -> pd.Series:
    """Return a numeric Series for `col` or a NaN-filled Series of df length."""
    if col in df.columns:
        return pd.to_numeric(df[col], errors="coerce")
    return pd.Series([float("nan")] * len(df), index=df.index, dtype="float64")


def add_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Append computed features to the DataFrame (returns a copy)."""
    out = df.copy()

    h_xw = _col_or_nan(out, "home_pitcher_xwoba")
    a_xw = _col_or_nan(out, "away_pitcher_xwoba")
    out["pitcher_xwoba_diff"] = a_xw - h_xw  # away xwoba higher → home pitcher better

    h_era = _col_or_nan(out, "home_pitcher_era")
    a_era = _col_or_nan(out, "away_pitcher_era")
    out["pitcher_era_diff"] = a_era - h_era

    h_lu = _col_or_nan(out, "home_lineup_avg_xwoba")
    a_lu = _col_or_nan(out, "away_lineup_avg_xwoba")
    out["lineup_xwoba_diff"] = h_lu - a_lu

    h_ops = _col_or_nan(out, "home_team_ops")
    a_ops = _col_or_nan(out, "away_team_ops")
    out["team_ops_diff"] = h_ops - a_ops

    h_rest = _col_or_nan(out, "home_pitcher_days_rest")
    a_rest = _col_or_nan(out, "away_pitcher_days_rest")
    out["days_rest_diff"] = h_rest - a_rest

    h_pen = _col_or_nan(out, "home_bullpen_pitches_last_3d")
    a_pen = _col_or_nan(out, "away_bullpen_pitches_last_3d")
    # Higher own-pen usage = more fatigued, so home advantage when away pen is heavier
    out["bullpen_fatigue_diff"] = a_pen - h_pen

    out["implied_prob_home"] = _american_to_implied_prob(_col_or_nan(out, "odds_ml_home"))
    out["implied_prob_away"] = _american_to_implied_prob(_col_or_nan(out, "odds_ml_away"))

    out["run_diff_edge"] = _col_or_nan(out, "home_run_diff_avg") - _col_or_nan(out, "away_run_diff_avg")
    out["win_pct_edge"] = _col_or_nan(out, "home_win_pct") - _col_or_nan(out, "away_win_pct")
    out["venue_win_pct_edge"] = _col_or_nan(out, "home_venue_win_pct") - _col_or_nan(out, "away_venue_win_pct")
    out["last10_form_edge"] = _col_or_nan(out, "home_last10_wins") - _col_or_nan(out, "away_last10_wins")

    out["prop_side_over"] = (
        out.get("side", pd.Series([None] * len(out), index=out.index))
        .astype(str)
        .str.lower()
        .map({"over": 1.0, "under": 0.0})
    )

    # Booleans → numeric (NaN preserved)
    for col in BOOL_FEATURES:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    return out


def soccer_feature_columns(market: str) -> list[str]:
    cols = list(SOCCER_BASE_NUMERIC) + list(SOCCER_DERIVED_FEATURES)
    if market == "soccer_total":
        cols.append("odds_ou_total")  # line already in base; keep for total model
    return cols


def feature_columns(market: str) -> list[str]:
    """Return the full ordered feature column list for a given market.

    overunder gets the line itself as a feature (since the target depends on it).
    runline / moneyline don't need the line.
    NFL markets use NFL-specific columns.
    """
    if market == "nfl_prop":
        return list(NFL_PROP_FEATURES)

    if market.startswith("nfl_"):
        cols = list(NFL_BASE_NUMERIC) + list(NFL_BOOL_FEATURES) + list(NFL_DERIVED_FEATURES)
        if market == "nfl_spread":
            cols.append("spread_close")
        if market == "nfl_total":
            cols.append("total_close")
        return cols

    if market.startswith("soccer_"):
        return soccer_feature_columns(market)

    if market.startswith("tennis_"):
        cols = list(TENNIS_BASE_NUMERIC) + list(TENNIS_SURFACE_ONEHOT) + list(TENNIS_DERIVED_FEATURES)
        if market == "tennis_set_handicap":
            cols.append("set_handicap_close")
        if market == "tennis_total_games":
            cols.append("total_games_close")
        return cols

    cols = list(BASE_NUMERIC_FEATURES) + list(BOOL_FEATURES) + list(DERIVED_FEATURES)
    if market == "overunder":
        cols.append("line")
    if market.startswith("prop_"):
        cols.extend(PROP_NUMERIC_FEATURES)
        cols.extend(["line", "prop_side_over"])
    return cols


def add_nfl_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Append NFL-specific computed features."""
    out = df.copy()

    h_epa_off = _col_or_nan(out, "home_epa_off")
    a_epa_off = _col_or_nan(out, "away_epa_off")
    h_epa_def = _col_or_nan(out, "home_epa_def")
    a_epa_def = _col_or_nan(out, "away_epa_def")

    out["epa_off_diff"] = h_epa_off - a_epa_off
    # Lower epa_def = better defense; positive diff = home defense advantage
    out["epa_def_diff"] = a_epa_def - h_epa_def
    out["epa_composite_diff"] = out["epa_off_diff"] + out["epa_def_diff"]

    # Opponent-adjusted (SOS) EPA diffs — same orientation as the raw diffs above.
    h_epa_off_adj = _col_or_nan(out, "home_epa_off_adj")
    a_epa_off_adj = _col_or_nan(out, "away_epa_off_adj")
    h_epa_def_adj = _col_or_nan(out, "home_epa_def_adj")
    a_epa_def_adj = _col_or_nan(out, "away_epa_def_adj")
    out["epa_off_adj_diff"] = h_epa_off_adj - a_epa_off_adj
    out["epa_def_adj_diff"] = a_epa_def_adj - h_epa_def_adj
    out["epa_composite_adj_diff"] = out["epa_off_adj_diff"] + out["epa_def_adj_diff"]

    # Situational efficiency diffs (home-positive orientation).
    out["rz_off_diff"] = _col_or_nan(out, "home_rz_td_pct_off") - _col_or_nan(out, "away_rz_td_pct_off")
    out["third_down_off_diff"] = _col_or_nan(out, "home_third_down_conv_off") - _col_or_nan(out, "away_third_down_conv_off")
    # Lower sack_rate_off = better protection → home edge = away allowed − home allowed.
    out["sack_protection_diff"] = _col_or_nan(out, "away_sack_rate_off") - _col_or_nan(out, "home_sack_rate_off")
    # Higher sack_rate_def = better pass rush → home edge = home forced − away forced.
    out["sack_pressure_diff"] = _col_or_nan(out, "home_sack_rate_def") - _col_or_nan(out, "away_sack_rate_def")
    out["form_diff"] = _col_or_nan(out, "home_form_point_diff") - _col_or_nan(out, "away_form_point_diff")

    h_rest = _col_or_nan(out, "home_rest_days")
    a_rest = _col_or_nan(out, "away_rest_days")
    out["rest_diff"] = h_rest - a_rest

    h_inj = _col_or_nan(out, "injuries_home_severe")
    a_inj = _col_or_nan(out, "injuries_away_severe")
    out["injury_diff"] = a_inj - h_inj  # positive = away more injured = home advantage

    for col in NFL_BOOL_FEATURES:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")

    return out


def add_nfl_prop_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Append NFL player-prop computed features (pooled across prop kinds)."""
    out = df.copy()

    out["prop_side_over"] = (
        out.get("side", pd.Series([None] * len(out), index=out.index))
        .astype(str)
        .str.lower()
        .map({"over": 1.0, "under": 0.0})
    )

    # Prefer a stored implied prob; otherwise derive it from the American odds.
    implied = _col_or_nan(out, "prop_implied_prob")
    derived_implied = _american_to_implied_prob(_col_or_nan(out, "prop_odds_american"))
    out["prop_implied_prob"] = implied.fillna(derived_implied)

    line = _col_or_nan(out, "line")
    season = _col_or_nan(out, "nfl_prop_player_season_avg")
    recent = _col_or_nan(out, "nfl_prop_player_recent_avg")
    out["nfl_prop_season_minus_line"] = season - line
    out["nfl_prop_recent_minus_line"] = recent - line

    kind = out.get("prop_kind", pd.Series([None] * len(out), index=out.index)).astype(str).str.lower()
    for k in NFL_PROP_KINDS:
        out[f"propkind_{k}"] = (kind == k).astype(float)

    return out


def add_soccer_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Append soccer-specific computed features."""
    out = df.copy()

    h_gd = _col_or_nan(out, "home_goal_diff")
    a_gd = _col_or_nan(out, "away_goal_diff")
    out["goal_diff_delta"] = h_gd - a_gd

    h_pts = _col_or_nan(out, "home_points")
    a_pts = _col_or_nan(out, "away_points")
    out["points_delta"] = h_pts - a_pts

    h_xg = _col_or_nan(out, "home_xg")
    a_xg = _col_or_nan(out, "away_xg")
    out["xg_diff"] = h_xg - a_xg

    h_fw = _col_or_nan(out, "home_last10_wins")
    a_fw = _col_or_nan(out, "away_last10_wins")
    out["form_wins_diff"] = h_fw - a_fw

    # De-vig 3-way odds → implied probs
    raw_h = _american_to_implied_prob(_col_or_nan(out, "odds_ml_home"))
    raw_d = _american_to_implied_prob(_col_or_nan(out, "draw_price"))
    raw_a = _american_to_implied_prob(_col_or_nan(out, "odds_ml_away"))
    total = raw_h + raw_d + raw_a
    total = total.replace(0, float("nan"))
    out["implied_prob_home"] = raw_h / total
    out["implied_prob_draw"] = raw_d / total
    out["implied_prob_away"] = raw_a / total

    return out


def add_tennis_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Append tennis-specific computed features (player A = "home" slot).

    Diffs are A-minus-B (positive = player A favored), so the model predicts
    P(player A wins). Surface is one-hot encoded.
    """
    out = df.copy()

    h_elos = _col_or_nan(out, "home_elo_surface")
    a_elos = _col_or_nan(out, "away_elo_surface")
    out["elo_surface_diff"] = h_elos - a_elos

    h_eloo = _col_or_nan(out, "home_elo_overall")
    a_eloo = _col_or_nan(out, "away_elo_overall")
    out["elo_overall_diff"] = h_eloo - a_eloo

    # Lower rank number = better player; positive diff = player A higher-ranked.
    h_rank = _col_or_nan(out, "home_rank")
    a_rank = _col_or_nan(out, "away_rank")
    out["rank_diff"] = a_rank - h_rank

    out["h2h_surface_diff"] = _col_or_nan(out, "h2h_surface_wins_home") - _col_or_nan(out, "h2h_surface_wins_away")
    out["h2h_total_diff"]   = _col_or_nan(out, "h2h_total_wins_home")   - _col_or_nan(out, "h2h_total_wins_away")

    # Higher own fatigue (more sets played) is a disadvantage; positive diff =
    # player B more fatigued = player A advantage.
    h_sets = _col_or_nan(out, "home_sets_played_tourney")
    a_sets = _col_or_nan(out, "away_sets_played_tourney")
    out["fatigue_diff"] = a_sets - h_sets

    # Surface one-hot
    surf = out.get("surface", pd.Series([None] * len(out), index=out.index)).astype(str).str.lower()
    for s in ("hard", "clay", "grass", "carpet"):
        out[f"surface_{s}"] = (surf == s).astype(float)

    return out


def build_X(df: pd.DataFrame, market: str) -> pd.DataFrame:
    """Build the feature matrix for the given market.

    Adds derived columns, then selects + reorders to `feature_columns(market)`.
    Columns missing from the input are filled with NaN so older snapshots
    still produce the right schema.
    """
    if market == "nfl_prop":
        enriched = add_nfl_prop_derived(df)
    elif market.startswith("nfl_"):
        enriched = add_nfl_derived(df)
    elif market.startswith("soccer_"):
        enriched = add_soccer_derived(df)
    elif market.startswith("tennis_"):
        enriched = add_tennis_derived(df)
    else:
        enriched = add_derived(df)
    # Dedupe while preserving order — some market column lists intentionally
    # repeat a base column (e.g. soccer_total re-lists odds_ou_total). A
    # duplicate name makes enriched[cols] select a 2-col frame, which breaks the
    # per-column pd.to_numeric coercion below.
    cols = list(dict.fromkeys(feature_columns(market)))

    for c in cols:
        if c not in enriched.columns:
            enriched[c] = pd.NA

    X = enriched[cols].copy()

    # Coerce every column to float so XGBoost receives a clean numeric matrix
    for c in cols:
        X[c] = pd.to_numeric(X[c], errors="coerce")

    return X
