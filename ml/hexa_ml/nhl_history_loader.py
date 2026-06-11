"""nhl_history_loader.py — historical NHL results from the official NHL API.

The NHL analog of `nflverse_loader.py` / `soccer_history_loader.py`: turns
many seasons of final scores into a leakage-free training frame so the
nhl_moneyline / nhl_puckline models can be trained *before* a single live
pick is resolved (Sprint 10e — the sidecar NHL deferred since the MVP).

Source: **api-web.nhle.com** (official, free, no key) —
`/v1/club-schedule-season/{TEAM}/{seasonId}` returns every game of a team's
season with final scores and OT/SO outcome. One request per team-season
(~32/season); games are deduped by game id since each appears on two
schedules.

Markets covered by pre-training:
  - nhl_moneyline — P(home wins). Label from final score (OT/SO already
    decide a winner; there are no NHL draws).
  - nhl_puckline  — P(home covers -1.5). The puck line is FIXED at ±1.5 in
    the NHL by convention, so historical labels are market-aligned without
    needing historical odds (unlike a variable spread).
  - nhl_total is NOT pre-trained: the goals line varies (5.5–6.5) and this
    source carries no market lines; training at a fake fixed line would
    teach the model zero line sensitivity. It trains from live picks.

Features are computed *as-of* each game (cumulative season-to-date before
puck drop — the same semantics the live ESPN standings give at pick time),
so there is no future leakage. Odds / PP% / PK% / injuries stay NaN here
(the source has none); XGBoost tolerates the missing columns and the
dominant present signals (goal diff, GF/GA rates, points%, form, rest/B2B)
all flow.

No new dependency: JSON over urllib (stdlib). The fetch is defensive — an
unreachable team/season is skipped, never fatal (franchises that didn't
exist yet in a season simply 404).
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request

import numpy as np
import pandas as pd

logger = logging.getLogger("hexa_ml.nhl_history")

# Franchise abbreviations to request per season. Includes relocations: ARI
# (through 2023-24) and UTA (2024-25 onward) both listed — the one that
# doesn't exist for a given season 404s and is skipped.
_TEAM_ABBRS = (
    "ANA", "ARI", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL",
    "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR",
    "OTT", "PHI", "PIT", "SJS", "SEA", "STL", "TBL", "TOR", "UTA", "VAN",
    "VGK", "WSH", "WPG",
)

_SCHEDULE_URL = "https://api-web.nhle.com/v1/club-schedule-season/{abbr}/{season_id}"

_REGULAR_SEASON_GAME_TYPE = 2
_RECENT_WINDOW = 10
_PUCK_LINE = 1.5

_NHL_MARKET_TYPE = {
    "nhl_moneyline": "moneyline",
    "nhl_puckline": "puckline",
}

_CACHE_TTL_S = 6 * 60 * 60
_season_cache: dict[int, list[dict]] = {}
_season_cache_ts: dict[int, float] = {}


def pretrain_markets() -> tuple[str, ...]:
    return tuple(_NHL_MARKET_TYPE.keys())


def default_pretrain_years(n_seasons: int = 8) -> list[int]:
    """Last `n_seasons` completed NHL seasons, by start year.

    A season starting in October of year S finishes in June of S+1. From
    July of S+1 onward it counts as complete.
    """
    now = time.gmtime()
    last_complete = now.tm_year - 1 if now.tm_mon >= 7 else now.tm_year - 2
    return list(range(last_complete - n_seasons + 1, last_complete + 1))


def parse_seasons(spec: str) -> list[int]:
    """Parse "2016-2023" or "2018,2019" → [int]. Empty → default years.

    Years are season *start* years (2023 = the 2023-24 campaign).
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


def _first_key(d: dict, *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return default


def parse_schedule_payload(payload: dict) -> list[dict]:
    """Normalize one club-schedule-season JSON into completed regular-season
    games: {game_id, game_date, home_abbr, away_abbr, home_score, away_score,
    last_period_type}. Pure — unit-tested without network. Tolerant of the
    NHL API's key variants (abbrev/abbr/triCode)."""
    games = payload.get("games") if isinstance(payload, dict) else None
    if not isinstance(games, list):
        return []

    out: list[dict] = []
    for g in games:
        if not isinstance(g, dict):
            continue
        if g.get("gameType") != _REGULAR_SEASON_GAME_TYPE:
            continue
        home = g.get("homeTeam") or {}
        away = g.get("awayTeam") or {}
        home_score = _first_key(home, "score")
        away_score = _first_key(away, "score")
        if home_score is None or away_score is None:
            continue  # not played yet
        home_abbr = _first_key(home, "abbrev", "abbr", "triCode")
        away_abbr = _first_key(away, "abbrev", "abbr", "triCode")
        if not home_abbr or not away_abbr:
            continue
        outcome = g.get("gameOutcome") or {}
        out.append({
            "game_id": g.get("id"),
            "game_date": g.get("gameDate"),
            "home_abbr": str(home_abbr),
            "away_abbr": str(away_abbr),
            "home_score": int(home_score),
            "away_score": int(away_score),
            "last_period_type": str(_first_key(outcome, "lastPeriodType", default="REG")),
        })
    return out


def _fetch_team_season(abbr: str, start_year: int) -> list[dict]:
    season_id = f"{start_year}{start_year + 1}"
    url = _SCHEDULE_URL.format(abbr=abbr, season_id=season_id)
    req = urllib.request.Request(url, headers={"User-Agent": "hexa-ml/nhl-history"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return parse_schedule_payload(payload)


def _load_season_games(start_year: int) -> list[dict]:
    cached_ts = _season_cache_ts.get(start_year, 0)
    if start_year in _season_cache and (time.time() - cached_ts) < _CACHE_TTL_S:
        return _season_cache[start_year]

    by_id: dict = {}
    fetched_teams = 0
    for abbr in _TEAM_ABBRS:
        try:
            for g in _fetch_team_season(abbr, start_year):
                if g["game_id"] is not None:
                    by_id[g["game_id"]] = g
            fetched_teams += 1
        except Exception as exc:
            logger.debug("NHL schedule %s %d unavailable (%s) — skipping team",
                         abbr, start_year, exc)
    games = sorted(by_id.values(), key=lambda g: (str(g["game_date"]), str(g["game_id"])))
    logger.info("NHL %d-%d: %d games from %d team schedules",
                start_year, start_year + 1, len(games), fetched_teams)
    _season_cache[start_year] = games
    _season_cache_ts[start_year] = time.time()
    return games


def refresh_cache() -> dict:
    _season_cache.clear()
    _season_cache_ts.clear()
    return {"cleared": "all"}


def season_rows(games: list[dict]) -> list[dict]:
    """Leakage-free per-game rows from one season's chronologically sorted
    completed games. Pure — unit-tested with synthetic games.

    Each row snapshots both teams' cumulative season-to-date stats *before*
    the game: goal diff, GF/GA per game, points% (W=2, OT/SO loss=1), last-10
    wins, rest days and back-to-back — the exact fields the live NHL context
    builder exposes — plus the final score for labels.
    """
    state: dict[str, dict] = {}

    def _fresh() -> dict:
        return {"gf": 0, "ga": 0, "pts": 0, "played": 0, "results": [], "last_date": None}

    def _snapshot(team: str, date: pd.Timestamp) -> dict:
        s = state.get(team)
        if s is None or s["played"] == 0:
            return {
                "goal_diff": np.nan, "gf_per_game": np.nan, "ga_per_game": np.nan,
                "points_pct": np.nan, "last10_wins": np.nan,
                "rest_days": np.nan, "is_b2b": np.nan,
            }
        rest = np.nan
        b2b = np.nan
        if s["last_date"] is not None and pd.notna(date):
            rest = float((date - s["last_date"]).days)
            b2b = 1.0 if rest <= 1 else 0.0
        return {
            "goal_diff": float(s["gf"] - s["ga"]),
            "gf_per_game": float(s["gf"] / s["played"]),
            "ga_per_game": float(s["ga"] / s["played"]),
            "points_pct": float(s["pts"] / (2 * s["played"])),
            "last10_wins": float(sum(s["results"][-_RECENT_WINDOW:])),
            "rest_days": rest,
            "is_b2b": b2b,
        }

    def _update(team: str, scored: int, conceded: int, overtime: bool, date: pd.Timestamp) -> None:
        s = state.setdefault(team, _fresh())
        s["gf"] += scored
        s["ga"] += conceded
        s["played"] += 1
        if scored > conceded:
            s["pts"] += 2
            s["results"].append(1)
        else:
            if overtime:
                s["pts"] += 1  # OT/SO loser point
            s["results"].append(0)
        if pd.notna(date):
            s["last_date"] = date

    rows: list[dict] = []
    for g in games:
        date = pd.to_datetime(g.get("game_date"), errors="coerce")
        home, away = g["home_abbr"], g["away_abbr"]
        hs, as_ = int(g["home_score"]), int(g["away_score"])
        overtime = str(g.get("last_period_type", "REG")).upper() in {"OT", "SO"}

        h_prev = _snapshot(home, date)
        a_prev = _snapshot(away, date)

        rows.append({
            "game_date": date,
            "home_score": hs,
            "away_score": as_,
            "total_runs": float(hs + as_),
            "home_goal_diff": h_prev["goal_diff"],
            "away_goal_diff": a_prev["goal_diff"],
            "home_gf_per_game": h_prev["gf_per_game"],
            "away_gf_per_game": a_prev["gf_per_game"],
            "home_ga_per_game": h_prev["ga_per_game"],
            "away_ga_per_game": a_prev["ga_per_game"],
            "home_points_pct": h_prev["points_pct"],
            "away_points_pct": a_prev["points_pct"],
            "home_last10_wins": h_prev["last10_wins"],
            "away_last10_wins": a_prev["last10_wins"],
            "home_rest_days": h_prev["rest_days"],
            "away_rest_days": a_prev["rest_days"],
            "home_is_b2b": h_prev["is_b2b"],
            "away_is_b2b": a_prev["is_b2b"],
            # Not present in this source — NaN, XGBoost-tolerated.
            "home_pp_pct": np.nan, "away_pp_pct": np.nan,
            "home_pk_pct": np.nan, "away_pk_pct": np.nan,
            "injuries_home_severe": np.nan, "injuries_away_severe": np.nan,
            "goalie_home_confirmed": np.nan, "goalie_away_confirmed": np.nan,
            "odds_ml_home": np.nan, "odds_ml_away": np.nan,
            "odds_ou_total": np.nan,
            "puck_line_close": _PUCK_LINE,
            "context_completeness": np.nan,
            "oracle_confidence": np.nan,
            "line": np.nan,
            "side": None,
        })

        _update(home, hs, as_, overtime and hs < as_, date)
        _update(away, as_, hs, overtime and as_ < hs, date)

    return rows


def build_nhl_training_frame(market: str, years: list[int]) -> pd.DataFrame:
    """Leakage-free historical training frame for one NHL market.

    Columns match what features.build_X("nhl_*") + data.filter_for_market +
    data.make_target consume, so train_one_market trains directly. Returns an
    empty frame (not an error) when no season is reachable.
    """
    if market not in _NHL_MARKET_TYPE:
        raise ValueError(f"Unsupported NHL pre-train market: {market!r}")

    all_rows: list[dict] = []
    for year in sorted(set(years)):
        all_rows.extend(season_rows(_load_season_games(year)))

    if not all_rows:
        logger.warning("No NHL history available for seasons %s", years)
        return pd.DataFrame()

    frame = pd.DataFrame(all_rows)
    frame["market_type"] = _NHL_MARKET_TYPE[market]
    frame["result"] = "resolved"  # non-null so filter_for_market keeps the row
    frame["source"] = "nhl_history"
    return frame.reset_index(drop=True)
