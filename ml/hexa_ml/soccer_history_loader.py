"""soccer_history_loader.py — historical soccer results + closing odds.

This is the soccer analog of `nflverse_loader.py`: it turns many seasons of
match results into a leakage-free training frame so the soccer_moneyline /
soccer_total / soccer_btts models can be trained *before* a single live pick is
resolved (exactly the win NFL got from nflverse).

Source: **football-data.co.uk** — free season CSVs (no API key) with full-time
scores + 1X2 / over-2.5 closing odds for the 5 big European leagues, going back
20+ years. The only consumer is pre-training; live team stats keep coming from
ESPN standings (the Node `soccer-context-builder.js`), so there is no serve
endpoint here.

MLS (`usa.1`) is **not** on football-data.co.uk — it is a European-focused site —
so pre-training covers the 5 European leagues. This mirrors the existing xG gap
(Understat doesn't cover MLS either): MLS models lean on live picks once the
season produces them.

Features are computed *as-of* each match (cumulative season-to-date totals
*before* kickoff — the same semantics the live ESPN standings give at pick time),
so there is no future leakage. xG/xGA stay NaN here (football-data carries no xG;
Understat historical xG is a separate, heavier scrape tracked as a follow-up) —
XGBoost tolerates the missing column and the dominant signals (de-vigged 3-way
odds + goal diff + form + points) are all present.

No new dependency: CSVs are read with pandas (already pinned) over urllib
(stdlib). The fetch is defensive — a not-yet-published or unreachable
season/league is skipped, never fatal.
"""

from __future__ import annotations

import io
import logging
import time
import urllib.request

import numpy as np
import pandas as pd

logger = logging.getLogger("hexa_ml.soccer_history")

# Internal soccer-league slug → football-data.co.uk division code. MLS is absent
# from the source on purpose (see module docstring).
_LEAGUE_DIV = {
    "eng.1": "E0",   # Premier League
    "esp.1": "SP1",  # La Liga
    "ita.1": "I1",   # Serie A
    "ger.1": "D1",   # Bundesliga
    "fra.1": "F1",   # Ligue 1
}

_PRETRAIN_LEAGUES = tuple(_LEAGUE_DIV.keys())

# football-data.co.uk lays out one CSV per (season, division):
#   https://www.football-data.co.uk/mmz4281/{SEASON}/{DIV}.csv
# where SEASON for the 2023-24 campaign is "2324" (start-year and end-year, last
# two digits each).
_CSV_URL = "https://www.football-data.co.uk/mmz4281/{season}/{div}.csv"

# Closing-odds column triples in priority order (most-robust first): market
# closing average → Bet365 closing → market pre-match average → Bet365 pre-match
# → legacy Betbrain average. The first triple fully present in the file wins.
_ODDS_1X2_CANDIDATES = (
    ("AvgCH", "AvgCD", "AvgCA"),
    ("B365CH", "B365CD", "B365CA"),
    ("AvgH", "AvgD", "AvgA"),
    ("B365H", "B365D", "B365A"),
    ("BbAvH", "BbAvD", "BbAvA"),
)

# The over/under market in soccer is anchored at 2.5 goals — the line live
# serving stores in odds_ou_total.
_SOCCER_TOTAL_LINE = 2.5
_RECENT_WINDOW = 10  # last-N matches for the form "last10 wins" feature

# market → the market_type value filter_for_market(df, "soccer_*") expects.
_SOCCER_MARKET_TYPE = {
    "soccer_moneyline": "moneyline",
    "soccer_total": "total",
    "soccer_btts": "btts",
}

_CSV_TTL_S = 6 * 60 * 60  # 6h — same cadence as the other historical loaders
_csv_cache: dict[tuple[str, int], pd.DataFrame] = {}


def supported_leagues() -> tuple[str, ...]:
    return _PRETRAIN_LEAGUES


def default_pretrain_years(n_seasons: int = 8) -> list[int]:
    """The last `n_seasons` completed European seasons, by start year.

    A season starting in August of year S finishes the following May (S+1). It
    counts as complete once we are past it: from June of S+1 onward the season
    is done; from August a new one has begun but is not yet complete. So before
    June the most recent completed start-year is year-2, otherwise year-1.
    """
    now = time.gmtime()
    last_complete = now.tm_year - 1 if now.tm_mon >= 6 else now.tm_year - 2
    return list(range(last_complete - n_seasons + 1, last_complete + 1))


def parse_seasons(spec: str) -> list[int]:
    """Parse a seasons spec like "2016-2023" or "2018,2019,2020" → [int].

    Empty spec → default_pretrain_years(). Years are season *start* years
    (2023 = the 2023-24 campaign).
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


def _season_code(start_year: int) -> str:
    """2023 → "2324" (football-data folder for the 2023-24 season)."""
    return f"{start_year % 100:02d}{(start_year + 1) % 100:02d}"


def _dec_to_american(dec) -> float:
    """Decimal odds → American. football-data publishes decimal; live serving
    (soccer-odds.js) stores American, so we convert to keep the de-vig features
    consistent across history and live inference."""
    try:
        d = float(dec)
    except (TypeError, ValueError):
        return float("nan")
    if not np.isfinite(d) or d <= 1.0:
        return float("nan")
    return (d - 1.0) * 100.0 if d >= 2.0 else -100.0 / (d - 1.0)


def _fetch_csv(div: str, start_year: int) -> pd.DataFrame:
    url = _CSV_URL.format(season=_season_code(start_year), div=div)
    req = urllib.request.Request(url, headers={"User-Agent": "hexa-ml/soccer-history"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    # football-data CSVs are latin-1 with occasional trailing junk columns; the
    # python engine + on_bad_lines='skip' is the most tolerant combination.
    df = pd.read_csv(
        io.BytesIO(raw),
        encoding="latin-1",
        engine="python",
        on_bad_lines="skip",
    )
    logger.info(
        "football-data %s %s → %d matches (%.1fKB) in %.1fs",
        div, _season_code(start_year), len(df), len(raw) / 1e3, time.time() - t0,
    )
    return df


def _load_csv(div: str, start_year: int) -> pd.DataFrame | None:
    key = (div, start_year)
    cached = _csv_cache.get(key)
    if cached is not None and (time.time() - cached.attrs.get("_ts", 0)) < _CSV_TTL_S:
        return cached
    try:
        df = _fetch_csv(div, start_year)
    except Exception as exc:
        logger.warning("football-data %s %s unavailable (%s) — skipping",
                       div, _season_code(start_year), exc)
        return None
    df.attrs["_ts"] = time.time()
    _csv_cache[key] = df
    return df


def refresh_cache() -> dict:
    _csv_cache.clear()
    return {"cleared": "all"}


def _pick_odds_triple(df: pd.DataFrame) -> tuple[str, str, str] | None:
    for triple in _ODDS_1X2_CANDIDATES:
        if all(c in df.columns for c in triple):
            return triple
    return None


def _league_season_rows(league: str, start_year: int) -> list[dict]:
    """Leakage-free per-match rows for one league-season.

    Each row carries the home/away cumulative season-to-date stats *before* the
    match (NaN for a team's first match — no prior data), plus the final score
    and de-vigged closing 1X2 odds. One row per played match.
    """
    div = _LEAGUE_DIV[league]
    df = _load_csv(div, start_year)
    if df is None or df.empty:
        return []
    need = {"HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"}
    if not need.issubset(df.columns):
        logger.warning("football-data %s %s missing core columns — skipping",
                       div, _season_code(start_year))
        return []

    df = df.dropna(subset=["HomeTeam", "AwayTeam", "FTHG", "FTAG"]).copy()
    df["_date"] = pd.to_datetime(df.get("Date"), dayfirst=True, errors="coerce")
    df = df.sort_values("_date", kind="stable").reset_index(drop=True)

    odds_cols = _pick_odds_triple(df)

    # Per-team running state, snapshotted *before* each match (no leakage).
    state: dict[str, dict] = {}

    def _fresh() -> dict:
        return {"gf": 0, "ga": 0, "pts": 0, "played": 0, "results": []}

    def _snapshot(team: str) -> dict:
        s = state.get(team)
        if s is None or s["played"] == 0:
            return {
                "goals_for": np.nan, "goals_against": np.nan,
                "goal_diff": np.nan, "points": np.nan, "last10_wins": np.nan,
            }
        return {
            "goals_for": float(s["gf"]),
            "goals_against": float(s["ga"]),
            "goal_diff": float(s["gf"] - s["ga"]),
            "points": float(s["pts"]),
            "last10_wins": float(sum(s["results"][-_RECENT_WINDOW:])),
        }

    def _update(team: str, scored: int, conceded: int) -> None:
        s = state.setdefault(team, _fresh())
        s["gf"] += scored
        s["ga"] += conceded
        s["played"] += 1
        if scored > conceded:
            s["pts"] += 3
            s["results"].append(1)
        elif scored == conceded:
            s["pts"] += 1
            s["results"].append(0)
        else:
            s["results"].append(0)

    rows: list[dict] = []
    for _, m in df.iterrows():
        home, away = str(m["HomeTeam"]), str(m["AwayTeam"])
        hs, as_ = int(m["FTHG"]), int(m["FTAG"])
        h_prev, a_prev = _snapshot(home), _snapshot(away)

        if odds_cols:
            ml_home = _dec_to_american(m.get(odds_cols[0]))
            draw    = _dec_to_american(m.get(odds_cols[1]))
            ml_away = _dec_to_american(m.get(odds_cols[2]))
        else:
            ml_home = draw = ml_away = np.nan

        rows.append({
            "game_date": m["_date"],
            "league": league,
            "home_score": hs,
            "away_score": as_,
            "total_runs": float(hs + as_),
            "home_goals_for": h_prev["goals_for"],
            "away_goals_for": a_prev["goals_for"],
            "home_goals_against": h_prev["goals_against"],
            "away_goals_against": a_prev["goals_against"],
            "home_goal_diff": h_prev["goal_diff"],
            "away_goal_diff": a_prev["goal_diff"],
            "home_points": h_prev["points"],
            "away_points": a_prev["points"],
            "home_last10_wins": h_prev["last10_wins"],
            "away_last10_wins": a_prev["last10_wins"],
            # xG carried as NaN — football-data has none (Understat historical
            # is a separate follow-up). XGBoost tolerates the missing column.
            "home_xg": np.nan, "away_xg": np.nan,
            "home_xga": np.nan, "away_xga": np.nan,
            "odds_ml_home": ml_home,
            "odds_ml_away": ml_away,
            "draw_price": draw,
            "odds_ou_total": _SOCCER_TOTAL_LINE,
            "btts_yes_price": np.nan,  # not published by football-data
            "context_completeness": np.nan,
            "oracle_confidence": np.nan,
            "line": np.nan,
            "side": None,
        })

        _update(home, hs, as_)
        _update(away, as_, hs)

    return rows


def build_soccer_training_frame(market: str, years: list[int]) -> pd.DataFrame:
    """Leakage-free historical training frame for one soccer market.

    Columns match what features.build_X("soccer_*") + data.filter_for_market +
    data.make_target consume, so the existing train_one_market pipeline trains
    directly. Iterates all 5 supported European leagues across `years` (season
    start years). Raises ValueError on an unknown market; returns an empty frame
    (not an error) when no season/league CSV is reachable.
    """
    if market not in _SOCCER_MARKET_TYPE:
        raise ValueError(f"Unsupported soccer market: {market!r}")

    all_rows: list[dict] = []
    for league in _PRETRAIN_LEAGUES:
        for year in sorted(set(years)):
            all_rows.extend(_league_season_rows(league, year))

    if not all_rows:
        logger.warning("No football-data history available for seasons %s", years)
        return pd.DataFrame()

    frame = pd.DataFrame(all_rows)
    frame["market_type"] = _SOCCER_MARKET_TYPE[market]
    frame["result"] = "resolved"  # non-null so filter_for_market keeps the row
    frame["source"] = "soccer_history"
    return frame.reset_index(drop=True)
