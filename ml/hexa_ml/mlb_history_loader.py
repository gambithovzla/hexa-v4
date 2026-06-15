"""mlb_history_loader.py — historical MLB results → team-strength training frame.

The MLB analog of `soccer_history_loader.py` / `nflverse_loader.py`. It turns many
seasons of final scores into a leakage-free training frame so the `runline` and
`moneyline` models can be pre-trained *before* enough live picks resolve.

Why this is different from NFL/soccer pre-training: MLB's live model features are
Statcast (xwOBA, whiff%, …) and betting odds, and **neither exists for free in
history**. So we cannot backfill the rich features. What we *can* compute from a
free schedule of final scores — and what is also available live from standings —
is **team strength**: season-to-date run differential, win %, home/road win %,
and last-10 form. Those are the columns `features.BASE_NUMERIC_FEATURES` was
extended with; the Statcast columns stay NaN here (XGBoost tolerates them, exactly
like xG is NaN in the soccer history frame). The over/under market is *not*
pre-trained: its target needs a total line, which the free schedule has no record
of.

Source: **MLB Stats API** (`statsapi.mlb.com/api/v1/schedule`) — the same host the
Node app already uses, no API key. One request per season returns every regular-
season game with final scores. Features are computed *as-of* each game (cumulative
totals *before* first pitch — the same semantics live standings give at pick time),
so there is no future leakage.

No new dependency: JSON over urllib (stdlib), parsed into pandas (already pinned).
The fetch is defensive — an unreachable or not-yet-played season is skipped, never
fatal.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from collections import deque

import numpy as np
import pandas as pd

logger = logging.getLogger("hexa_ml.mlb_history")

# One call per season covers the regular season (late March → early October). We
# bracket generously and rely on the Final-status filter to drop spring/postseason.
_SCHEDULE_URL = (
    "https://statsapi.mlb.com/api/v1/schedule"
    "?sportId=1&gameType=R&startDate={year}-03-01&endDate={year}-11-15"
)

_RECENT_WINDOW = 10  # last-N games for the form feature

# market → the market_type value filter_for_market(df, market) expects. Only the
# score-derivable markets are pre-trainable (over/under needs a total line).
_MLB_MARKET_TYPE = {
    "moneyline": "moneyline",
    "runline": "runline",
}

_CACHE_TTL_S = 6 * 60 * 60  # 6h — same cadence as the other historical loaders
_season_cache: dict[int, pd.DataFrame] = {}


def supported_markets() -> tuple[str, ...]:
    return tuple(_MLB_MARKET_TYPE.keys())


def default_pretrain_years(n_seasons: int = 8) -> list[int]:
    """The last `n_seasons` completed MLB seasons, by year.

    A season finishes in early October. From November onward the current year is
    complete; before that the most recent completed season is the prior year.
    """
    now = time.gmtime()
    last_complete = now.tm_year if now.tm_mon >= 11 else now.tm_year - 1
    return list(range(last_complete - n_seasons + 1, last_complete + 1))


def parse_seasons(spec: str) -> list[int]:
    """Parse a seasons spec like "2016-2023" or "2018,2019,2020" → [int].

    Empty spec → default_pretrain_years().
    """
    spec = (spec or "").strip()
    if not spec:
        return default_pretrain_years()
    years: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            years.update(range(int(a), int(b) + 1))
        else:
            years.add(int(part))
    return sorted(years)


def _fetch_season(year: int) -> list[dict]:
    """Return [{game_date, home_id, away_id, home_score, away_score}] for a season.

    Only completed (Final) regular-season games with both scores present.
    """
    url = _SCHEDULE_URL.format(year=year)
    req = urllib.request.Request(url, headers={"User-Agent": "hexa-ml/mlb-history"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read())

    games: list[dict] = []
    for date_block in payload.get("dates", []):
        for g in date_block.get("games", []):
            status = (g.get("status") or {}).get("abstractGameState")
            if status != "Final":
                continue
            home = (g.get("teams") or {}).get("home") or {}
            away = (g.get("teams") or {}).get("away") or {}
            hs, as_ = home.get("score"), away.get("score")
            hid = (home.get("team") or {}).get("id")
            aid = (away.get("team") or {}).get("id")
            if hs is None or as_ is None or hid is None or aid is None:
                continue
            games.append({
                "game_date": pd.to_datetime(g.get("gameDate"), errors="coerce", utc=True),
                "home_id": int(hid),
                "away_id": int(aid),
                "home_score": int(hs),
                "away_score": int(as_),
            })
    logger.info("MLB schedule %d → %d final games in %.1fs", year, len(games), time.time() - t0)
    return games


def _load_season(year: int) -> pd.DataFrame | None:
    cached = _season_cache.get(year)
    if cached is not None and (time.time() - cached.attrs.get("_ts", 0)) < _CACHE_TTL_S:
        return cached
    try:
        games = _fetch_season(year)
    except Exception as exc:
        logger.warning("MLB schedule %d unavailable (%s) — skipping", year, exc)
        return None
    if not games:
        return None
    df = pd.DataFrame(games).sort_values("game_date", kind="stable").reset_index(drop=True)
    df.attrs["_ts"] = time.time()
    _season_cache[year] = df
    return df


def refresh_cache() -> dict:
    _season_cache.clear()
    return {"cleared": "all"}


def _fresh() -> dict:
    return {
        "gp": 0, "w": 0, "rf": 0, "ra": 0,
        "home_gp": 0, "home_w": 0, "away_gp": 0, "away_w": 0,
        "results": deque(maxlen=_RECENT_WINDOW),
    }


def _snapshot(state: dict, venue: str) -> dict:
    """Cumulative-before-this-game stats for one team. venue ∈ {'home','away'}.

    NaN when the team has not played yet (no prior data — no leakage to fabricate).
    """
    if state["gp"] == 0:
        return {
            "runs_for_avg": np.nan, "runs_against_avg": np.nan, "run_diff_avg": np.nan,
            "win_pct": np.nan, "venue_win_pct": np.nan, "last10_wins": np.nan,
        }
    venue_gp = state["home_gp"] if venue == "home" else state["away_gp"]
    venue_w = state["home_w"] if venue == "home" else state["away_w"]
    return {
        "runs_for_avg": state["rf"] / state["gp"],
        "runs_against_avg": state["ra"] / state["gp"],
        "run_diff_avg": (state["rf"] - state["ra"]) / state["gp"],
        "win_pct": state["w"] / state["gp"],
        "venue_win_pct": (venue_w / venue_gp) if venue_gp > 0 else np.nan,
        "last10_wins": float(sum(state["results"])),
    }


def _update(state: dict, scored: int, conceded: int, venue: str) -> None:
    won = scored > conceded
    state["gp"] += 1
    state["rf"] += scored
    state["ra"] += conceded
    if won:
        state["w"] += 1
    if venue == "home":
        state["home_gp"] += 1
        state["home_w"] += 1 if won else 0
    else:
        state["away_gp"] += 1
        state["away_w"] += 1 if won else 0
    state["results"].append(1 if won else 0)


def _season_rows(year: int) -> list[dict]:
    df = _load_season(year)
    if df is None or df.empty:
        return []

    state: dict[int, dict] = {}
    rows: list[dict] = []
    for _, g in df.iterrows():
        hid, aid = g["home_id"], g["away_id"]
        hs, as_ = g["home_score"], g["away_score"]
        h_state = state.setdefault(hid, _fresh())
        a_state = state.setdefault(aid, _fresh())
        h_prev = _snapshot(h_state, "home")
        a_prev = _snapshot(a_state, "away")

        rows.append({
            "game_date": g["game_date"].tz_localize(None) if g["game_date"] is not None else None,
            "home_score": int(hs),
            "away_score": int(as_),
            "total_runs": float(hs + as_),
            "home_runs_for_avg": h_prev["runs_for_avg"],
            "away_runs_for_avg": a_prev["runs_for_avg"],
            "home_runs_against_avg": h_prev["runs_against_avg"],
            "away_runs_against_avg": a_prev["runs_against_avg"],
            "home_run_diff_avg": h_prev["run_diff_avg"],
            "away_run_diff_avg": a_prev["run_diff_avg"],
            "home_win_pct": h_prev["win_pct"],
            "away_win_pct": a_prev["win_pct"],
            "home_venue_win_pct": h_prev["venue_win_pct"],
            "away_venue_win_pct": a_prev["venue_win_pct"],
            "home_last10_wins": h_prev["last10_wins"],
            "away_last10_wins": a_prev["last10_wins"],
            "line": np.nan,
            "side": None,
        })

        _update(h_state, hs, as_, "home")
        _update(a_state, as_, hs, "away")

    return rows


def build_mlb_training_frame(market: str, years: list[int]) -> pd.DataFrame:
    """Leakage-free historical training frame for one MLB market.

    Columns match what features.build_X("moneyline"/"runline") + data.make_target
    consume, so the existing train_one_market pipeline trains directly. Raises
    ValueError on an unsupported market; returns an empty frame (not an error)
    when no season schedule is reachable.
    """
    if market not in _MLB_MARKET_TYPE:
        raise ValueError(f"Unsupported MLB pre-train market: {market!r}")

    all_rows: list[dict] = []
    for year in sorted(set(years)):
        all_rows.extend(_season_rows(year))

    if not all_rows:
        logger.warning("No MLB schedule history available for seasons %s", years)
        return pd.DataFrame()

    frame = pd.DataFrame(all_rows)
    frame["market_type"] = _MLB_MARKET_TYPE[market]
    frame["result"] = "resolved"  # non-null so filter_for_market keeps the row
    frame["source"] = "mlb_history"
    return frame.reset_index(drop=True)
