"""nflverse_loader.py — historical NFL advanced stats from nflverse play-by-play.

This is the NFL analog of Baseball Savant: it turns nflverse pbp into team-level
EPA (offense/defense), success rate, and PROE (pass rate over expected). Two
consumers:

  1. Serving current-season team stats to the Node context builder
     (`build_team_stats`) so the Oracle prompt gets real advanced metrics
     instead of nulls.
  2. Pre-training the nfl_moneyline / nfl_spread / nfl_total models from many
     seasons of history (`build_nfl_training_frame`) — the NFL market models
     can be trained *before* a single live pick is resolved.

Both labels (final scores, closing spread/total) and features (EPA/success/PROE)
come from the pbp parquet itself, fetched directly from the nflverse GitHub
release assets (no API key, no `nfl_data_py` dependency). We read the parquet
directly because `nfl_data_py` hard-caps `pandas<2.0`, which would break the
rest of the sidecar (pinned to pandas 2.2.3); reading the same release asset
ourselves keeps a single pandas version. The schedules CSV host
(habitatring.com) is avoided on purpose — it is not always reachable and the
pbp asset already carries the label columns we need.

`pyarrow` (for parquet) is the only added dependency. It is imported defensively
so a missing package or unreachable nflverse degrades the /nfl/* endpoints to
503 instead of taking down the whole sidecar — same pattern as fangraphs.
"""

from __future__ import annotations

import io
import logging
import time
import urllib.request
from threading import Lock

import numpy as np
import pandas as pd

logger = logging.getLogger("hexa_ml.nflverse")

try:
    import pyarrow  # noqa: F401  (read_parquet engine)

    _NFLVERSE_AVAILABLE = True
except ImportError as _err:  # pragma: no cover - depends on optional dep
    logger.warning("pyarrow unavailable — /nfl/* endpoints disabled (%s)", _err)
    _NFLVERSE_AVAILABLE = False

_PBP_URL = (
    "https://github.com/nflverse/nflverse-data/releases/download/pbp/"
    "play_by_play_{year}.parquet"
)

# Columns we actually consume — keeps each season's frame small (~full pbp is
# ~400 cols / 20MB; this subset is a fraction of that).
_PBP_COLUMNS = [
    "game_id", "season", "week", "season_type", "game_date", "roof", "div_game",
    "home_team", "away_team", "home_score", "away_score",
    "spread_line", "total_line",
    "posteam", "defteam", "play_type", "epa", "success", "pass_oe",
    # Additional columns for red zone, 3rd-down, and trench metrics:
    "yardline_100", "down", "first_down", "touchdown", "sack", "qb_hit",
    "pass_attempt",
]


def is_available() -> bool:
    return _NFLVERSE_AVAILABLE


def default_pretrain_years(n_seasons: int = 8) -> list[int]:
    """The last `n_seasons` completed NFL seasons.

    A season labeled YYYY runs Sep YYYY → Feb YYYY+1, so before September the
    current calendar year's season has no completed games yet and is excluded.
    """
    now = time.gmtime()
    last_complete = now.tm_year - 1 if now.tm_mon < 9 else now.tm_year
    return list(range(last_complete - n_seasons + 1, last_complete + 1))


def parse_seasons(spec: str) -> list[int]:
    """Parse a seasons spec like "2016-2023" or "2018,2019,2020" → [int]."""
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


# Only pass/rush plays with a defined EPA count toward team efficiency, matching
# the nflverse community convention for team EPA/play and success rate.
_RELEVANT_PLAY_TYPES = ("pass", "run")

# ── In-process cache for the served current-season team stats ──────────────────

_TEAM_STATS_TTL_S = 6 * 60 * 60  # 6h — same cadence as the Node savant fetcher
_team_stats_cache: dict[int, dict] = {}
_pbp_cache: dict[int, pd.DataFrame] = {}
_lock = Lock()


def _fetch_pbp_year(year: int) -> pd.DataFrame:
    url = _PBP_URL.format(year=year)
    req = urllib.request.Request(url, headers={"User-Agent": "hexa-ml/nflverse"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:  # follows the 302
        raw = resp.read()
    df = pd.read_parquet(io.BytesIO(raw))
    keep = [c for c in _PBP_COLUMNS if c in df.columns]
    df = df[keep]
    logger.info("nflverse pbp %d → %d plays (%.1fMB) in %.1fs",
                year, len(df), len(raw) / 1e6, time.time() - t0)
    return df


def _load_pbp(years: list[int]) -> pd.DataFrame:
    """Fetch (and memoize per-season) pbp for the given seasons."""
    if not _NFLVERSE_AVAILABLE:
        raise RuntimeError("pyarrow is not installed")
    frames = []
    for year in sorted(set(years)):
        with _lock:
            cached = _pbp_cache.get(year)
        if cached is None:
            try:
                cached = _fetch_pbp_year(year)
            except Exception as exc:
                # A not-yet-published season (or a transient fetch error) should
                # not sink the whole window — skip it and keep the others.
                logger.warning("nflverse pbp %d unavailable (%s) — skipping", year, exc)
                continue
            with _lock:
                _pbp_cache[year] = cached
        frames.append(cached)
    if not frames:
        raise RuntimeError(f"no nflverse pbp available for seasons {years}")
    return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]


def _relevant_plays(pbp: pd.DataFrame) -> pd.DataFrame:
    out = pbp[pbp["play_type"].isin(_RELEVANT_PLAY_TYPES)].copy()
    out = out[out["epa"].notna()]
    return out


def _red_zone_stats(pbp: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Red zone TD% per team — offense (posteam) and defense (defteam).

    Red zone = yardline_100 <= 20 on pass/run plays. TD% = TDs / red-zone plays.
    """
    if "yardline_100" not in pbp.columns or "touchdown" not in pbp.columns:
        empty = pd.Series(dtype=float, name="rz_td_pct")
        return empty, empty
    rz = pbp[
        (pbp["play_type"].isin(_RELEVANT_PLAY_TYPES)) &
        (pd.to_numeric(pbp["yardline_100"], errors="coerce") <= 20) &
        pbp["yardline_100"].notna()
    ].copy()
    rz["td"] = pd.to_numeric(rz["touchdown"], errors="coerce").fillna(0)
    off_rz = rz.groupby("posteam").agg(rz_plays=("td", "count"), rz_tds=("td", "sum"))
    def_rz = rz.groupby("defteam").agg(rz_plays=("td", "count"), rz_tds=("td", "sum"))
    off_pct = (off_rz["rz_tds"] / off_rz["rz_plays"].replace(0, np.nan)).rename("rz_td_pct_off")
    def_pct = (def_rz["rz_tds"] / def_rz["rz_plays"].replace(0, np.nan)).rename("rz_td_pct_def")
    return off_pct, def_pct


def _third_down_stats(pbp: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """3rd-down conversion rate per team — offense and defense."""
    if "down" not in pbp.columns or "first_down" not in pbp.columns:
        empty = pd.Series(dtype=float, name="third_down_conv")
        return empty, empty
    td3 = pbp[
        (pbp["play_type"].isin(_RELEVANT_PLAY_TYPES)) &
        (pd.to_numeric(pbp["down"], errors="coerce") == 3)
    ].copy()
    td3["converted"] = (
        pd.to_numeric(td3.get("first_down"), errors="coerce").fillna(0) +
        pd.to_numeric(td3.get("touchdown"), errors="coerce").fillna(0)
    ).clip(upper=1)
    off_conv = td3.groupby("posteam")["converted"].mean().rename("third_down_conv_off")
    def_conv = td3.groupby("defteam")["converted"].mean().rename("third_down_conv_def")
    return off_conv, def_conv


def _trench_stats(pbp: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Sack rate per team — offense (sacks allowed per dropback) and defense (sacks forced).

    A lower sack_rate_off = better O-line; a higher sack_rate_def = better pass rush.
    """
    if "pass_attempt" not in pbp.columns or "sack" not in pbp.columns:
        empty = pd.Series(dtype=float, name="sack_rate")
        return empty, empty
    passes = pbp[
        (pbp["play_type"].isin(_RELEVANT_PLAY_TYPES)) &
        (pd.to_numeric(pbp["pass_attempt"], errors="coerce") == 1)
    ].copy()
    passes["is_sack"] = pd.to_numeric(passes["sack"], errors="coerce").fillna(0)
    dropbacks_off = passes.groupby("posteam")["is_sack"].agg(["count", "sum"])
    dropbacks_def = passes.groupby("defteam")["is_sack"].agg(["count", "sum"])
    sack_rate_off = (dropbacks_off["sum"] / dropbacks_off["count"].replace(0, np.nan)).rename("sack_rate_off")
    sack_rate_def = (dropbacks_def["sum"] / dropbacks_def["count"].replace(0, np.nan)).rename("sack_rate_def")
    return sack_rate_off, sack_rate_def


def _season_team_stats(pbp: pd.DataFrame) -> pd.DataFrame:
    """Season-to-date per-team aggregates (one row per team).

    epa_def/success_def are computed from plays where the team is on defense
    (lower epa_def = better defense). proe is offense-only.
    Adds: red_zone_td_pct_off/def, third_down_conv_off/def, sack_rate_off/def.
    """
    plays = _relevant_plays(pbp)

    off = plays.groupby("posteam").agg(
        epa_off=("epa", "mean"),
        success_rate_off=("success", "mean"),
        proe=("pass_oe", "mean"),
        off_plays=("epa", "count"),
    )
    deff = plays.groupby("defteam").agg(
        epa_def=("epa", "mean"),
        success_rate_def=("success", "mean"),
        def_plays=("epa", "count"),
    )
    games = (
        pbp.dropna(subset=["posteam"])
        .groupby("posteam")["game_id"]
        .nunique()
        .rename("games_played")
    )

    rz_off, rz_def = _red_zone_stats(pbp)
    td3_off, td3_def = _third_down_stats(pbp)
    sack_off, sack_def = _trench_stats(pbp)

    stats = (
        off.join(deff, how="outer")
           .join(games, how="outer")
           .join(rz_off, how="left")
           .join(rz_def, how="left")
           .join(td3_off, how="left")
           .join(td3_def, how="left")
           .join(sack_off, how="left")
           .join(sack_def, how="left")
    )
    stats = stats.reset_index(names="team")
    games_safe = stats["games_played"].replace(0, np.nan)
    stats["plays_per_game"] = stats["off_plays"] / games_safe
    return stats


def build_team_stats(season: int) -> dict:
    """Per-team advanced stats for a season, keyed by nflverse team abbr.

    Returns { season, fetched_at, teams: { ABBR: {...} } }. Cached 6h.
    Raises RuntimeError if nflverse is unavailable so the endpoint can 503.
    """
    season = int(season)
    now = time.time()
    with _lock:
        cached = _team_stats_cache.get(season)
    if cached and (now - cached["_ts"]) < _TEAM_STATS_TTL_S:
        return cached["payload"]

    pbp = _load_pbp([season])
    stats = _season_team_stats(pbp)

    teams: dict[str, dict] = {}
    for _, row in stats.iterrows():
        abbr = str(row["team"]) if pd.notna(row["team"]) else None
        if not abbr or abbr in ("", "nan"):
            continue

        def _num(v):
            return None if pd.isna(v) else round(float(v), 4)

        teams[abbr] = {
            "team": abbr,
            "epa_off": _num(row.get("epa_off")),
            "epa_def": _num(row.get("epa_def")),
            "success_rate_off": _num(row.get("success_rate_off")),
            "success_rate_def": _num(row.get("success_rate_def")),
            "proe": _num(row.get("proe")),
            "plays_per_game": _num(row.get("plays_per_game")),
            "games_played": None if pd.isna(row.get("games_played")) else int(row["games_played"]),
            "red_zone_td_pct_off": _num(row.get("rz_td_pct_off")),
            "red_zone_td_pct_def": _num(row.get("rz_td_pct_def")),
            "third_down_conv_off": _num(row.get("third_down_conv_off")),
            "third_down_conv_def": _num(row.get("third_down_conv_def")),
            "sack_rate_off": _num(row.get("sack_rate_off")),
            "sack_rate_def": _num(row.get("sack_rate_def")),
        }

    payload = {
        "season": season,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "teams": teams,
    }
    with _lock:
        _team_stats_cache[season] = {"_ts": now, "payload": payload}
    return payload


def refresh_team_stats(season: int | None = None) -> dict:
    """Drop cached stats (and pbp) so the next call re-fetches from nflverse."""
    with _lock:
        if season is None:
            _team_stats_cache.clear()
            _pbp_cache.clear()
            _player_stats_cache.clear()
            _player_weeks_cache.clear()
        else:
            _team_stats_cache.pop(int(season), None)
            _pbp_cache.pop(int(season), None)
            _player_stats_cache.pop(int(season), None)
            _player_weeks_cache.pop(int(season), None)
    return {"cleared": "all" if season is None else int(season)}


# ── Player-level weekly stats (NFL props — Fase 2.1) ───────────────────────────

# nflverse renamed the weekly-player release a couple of times; try each known
# asset URL in order and use the first that resolves.
_PLAYER_WEEK_URLS = (
    "https://github.com/nflverse/nflverse-data/releases/download/player_stats/"
    "player_stats_{year}.parquet",
    "https://github.com/nflverse/nflverse-data/releases/download/stats_player/"
    "stats_player_week_{year}.parquet",
)

# Columns we read from the weekly file (intersected with what's actually present).
_PLAYER_WEEK_COLUMNS = [
    "player_id", "player_display_name", "player_name", "position",
    "recent_team", "season", "week", "season_type",
    "passing_yards", "passing_tds", "completions", "attempts", "interceptions",
    "rushing_yards", "carries", "rushing_tds",
    "receiving_yards", "receptions", "targets", "receiving_tds",
]

# Canonical prop kind → nflverse weekly stat column. anytime_td is derived
# (rushing_tds + receiving_tds) and handled separately.
_PROP_STAT_COLUMN = {
    "pass_yds": "passing_yards",
    "pass_tds": "passing_tds",
    "pass_completions": "completions",
    "pass_attempts": "attempts",
    "pass_interceptions": "interceptions",
    "rush_yds": "rushing_yards",
    "rush_attempts": "carries",
    "reception_yds": "receiving_yards",
    "receptions": "receptions",
}
_PROP_KINDS = (*_PROP_STAT_COLUMN.keys(), "anytime_td")
_RECENT_WINDOW = 4  # last N games for the "recent form" average

_PLAYER_STATS_TTL_S = 6 * 60 * 60
_player_stats_cache: dict[int, dict] = {}
_player_weeks_cache: dict[int, pd.DataFrame] = {}


def _normalize_player_name(name: str) -> str:
    """Lower, strip accents + punctuation, collapse spaces — mirrors the Node side."""
    import unicodedata

    s = unicodedata.normalize("NFD", str(name or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.lower()
    for ch in ".,'-":
        s = s.replace(ch, "")
    return " ".join(s.split())


def _fetch_player_weeks(year: int) -> pd.DataFrame:
    last_err: Exception | None = None
    for tmpl in _PLAYER_WEEK_URLS:
        url = tmpl.format(year=year)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hexa-ml/nflverse"})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
            df = pd.read_parquet(io.BytesIO(raw))
            keep = [c for c in _PLAYER_WEEK_COLUMNS if c in df.columns]
            df = df[keep]
            logger.info("nflverse player-weeks %d → %d rows (%.1fMB) in %.1fs",
                        year, len(df), len(raw) / 1e6, time.time() - t0)
            return df
        except Exception as exc:  # try the next asset URL
            last_err = exc
            logger.warning("nflverse player-weeks %d via %s failed (%s)", year, url, exc)
    raise RuntimeError(f"no nflverse player-weeks asset for {year}: {last_err}")


def _load_player_weeks(season: int) -> pd.DataFrame:
    if not _NFLVERSE_AVAILABLE:
        raise RuntimeError("pyarrow is not installed")
    with _lock:
        cached = _player_weeks_cache.get(season)
    if cached is None:
        cached = _fetch_player_weeks(season)
        with _lock:
            _player_weeks_cache[season] = cached
    return cached


def build_player_stats(season: int) -> dict:
    """Per-player season-to-date + recent prop averages for a season.

    Returns { season, fetched_at, players: { norm_name: {
        name, player_id, position, games,
        season_avg: { pass_yds: .., ... , anytime_td: .. },
        recent_avg: { ... last-4-game means ... },
    } } }. Cached 6h. Raises RuntimeError if nflverse is unavailable (→ 503).
    """
    season = int(season)
    now = time.time()
    with _lock:
        cached = _player_stats_cache.get(season)
    if cached and (now - cached["_ts"]) < _PLAYER_STATS_TTL_S:
        return cached["payload"]

    weeks = _load_player_weeks(season)
    if "season_type" in weeks.columns:
        weeks = weeks[weeks["season_type"].astype(str).str.upper() == "REG"].copy()
    else:
        weeks = weeks.copy()

    name_col = "player_display_name" if "player_display_name" in weeks.columns else "player_name"
    weeks["anytime_td"] = (
        pd.to_numeric(weeks.get("rushing_tds"), errors="coerce").fillna(0)
        + pd.to_numeric(weeks.get("receiving_tds"), errors="coerce").fillna(0)
    )
    if "week" in weeks.columns:
        weeks = weeks.sort_values("week")

    players: dict[str, dict] = {}
    for raw_name, grp in weeks.groupby(name_col):
        if not raw_name or str(raw_name) in ("", "nan"):
            continue
        norm = _normalize_player_name(raw_name)
        if not norm:
            continue
        tail = grp.tail(_RECENT_WINDOW)

        season_avg: dict[str, float | None] = {}
        recent_avg: dict[str, float | None] = {}
        for kind in _PROP_KINDS:
            col = _PROP_STAT_COLUMN.get(kind, kind)  # anytime_td maps to itself
            if col not in grp.columns:
                season_avg[kind] = None
                recent_avg[kind] = None
                continue
            s_full = pd.to_numeric(grp[col], errors="coerce")
            s_tail = pd.to_numeric(tail[col], errors="coerce")
            season_avg[kind] = None if s_full.dropna().empty else round(float(s_full.mean()), 3)
            recent_avg[kind] = None if s_tail.dropna().empty else round(float(s_tail.mean()), 3)

        pid = grp["player_id"].iloc[0] if "player_id" in grp.columns else None
        pos = grp["position"].iloc[0] if "position" in grp.columns else None
        players[norm] = {
            "name": str(raw_name),
            "player_id": None if pd.isna(pid) else str(pid),
            "position": None if pos is None or pd.isna(pos) else str(pos),
            "games": int(grp.shape[0]),
            "season_avg": season_avg,
            "recent_avg": recent_avg,
        }

    payload = {
        "season": season,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "players": players,
    }
    with _lock:
        _player_stats_cache[season] = {"_ts": now, "payload": payload}
    return payload


# ── As-of-week aggregates for leakage-free training ────────────────────────────


def _as_of_week_aggs(plays: pd.DataFrame, side: str) -> pd.DataFrame:
    """Cumulative team aggregates *excluding* the current week.

    side='posteam' → offense, side='defteam' → defense. Returns one row per
    (season, team, week) with the team's mean stats over all prior weeks of the
    same season. Week 1 has no history → NaN (XGBoost tolerates it).
    """
    g = (
        plays.groupby(["season", "week", side])
        .agg(
            epa_sum=("epa", "sum"),
            epa_cnt=("epa", "count"),
            succ_sum=("success", "sum"),
            succ_cnt=("success", "count"),
            proe_sum=("pass_oe", "sum"),
            proe_cnt=("pass_oe", "count"),
        )
        .reset_index()
        .rename(columns={side: "team"})
    )
    g = g.sort_values(["season", "team", "week"])
    grp = g.groupby(["season", "team"])
    for col in ("epa_sum", "epa_cnt", "succ_sum", "succ_cnt", "proe_sum", "proe_cnt"):
        # cumsum up to and including this week, then subtract this week → strictly prior
        g[f"prior_{col}"] = grp[col].cumsum() - g[col]

    epa_cnt = g["prior_epa_cnt"].replace(0, np.nan)
    succ_cnt = g["prior_succ_cnt"].replace(0, np.nan)
    proe_cnt = g["prior_proe_cnt"].replace(0, np.nan)
    g["epa"] = g["prior_epa_sum"] / epa_cnt
    g["success"] = g["prior_succ_sum"] / succ_cnt
    g["proe"] = g["prior_proe_sum"] / proe_cnt
    return g[["season", "week", "team", "epa", "success", "proe"]]


def _game_labels(pbp: pd.DataFrame) -> pd.DataFrame:
    """One row per game with final score + closing spread/total + game_date."""
    agg_cols = {
        "season": ("season", "first"),
        "week": ("week", "first"),
        "season_type": ("season_type", "first"),
        "home_team": ("home_team", "first"),
        "away_team": ("away_team", "first"),
        "home_score": ("home_score", "first"),
        "away_score": ("away_score", "first"),
        "spread_line": ("spread_line", "first"),
        "total_line": ("total_line", "first"),
    }
    if "game_date" in pbp.columns:
        agg_cols["game_date"] = ("game_date", "first")
    if "div_game" in pbp.columns:
        agg_cols["div_game"] = ("div_game", "first")
    if "roof" in pbp.columns:
        agg_cols["roof"] = ("roof", "first")

    games = (
        pbp.dropna(subset=["home_team", "away_team"])
        .groupby("game_id")
        .agg(**agg_cols)
        .reset_index()
    )
    return games


# market → the market_type value filter_for_market(df, "nfl_*") expects.
_NFL_MARKET_TYPE = {
    "nfl_moneyline": "moneyline",
    "nfl_spread": "spread",
    "nfl_total": "overunder",
}


def build_nfl_training_frame(market: str, years: list[int]) -> pd.DataFrame:
    """Build a leakage-free historical training frame for one NFL market.

    Columns match what features.build_X("nfl_*") + data.filter_for_market +
    data.make_target consume, so the existing train_one_market pipeline can
    train directly. Features are computed as-of each game's week (no future
    leakage). Labels come from final scores + nflverse closing lines.

    spread_close uses the American home-spread convention (home favored by N →
    -N), matching what nfl-odds.js stores in pick_features, so a model trained
    here is consistent with live serving.
    """
    if market not in _NFL_MARKET_TYPE:
        raise ValueError(f"Unsupported NFL market: {market!r}")
    if not _NFLVERSE_AVAILABLE:
        raise RuntimeError("pyarrow is not installed")

    pbp = _load_pbp(years)
    plays = _relevant_plays(pbp)

    off = _as_of_week_aggs(plays, "posteam")
    deff = _as_of_week_aggs(plays, "defteam")[["season", "week", "team", "epa"]]

    games = _game_labels(pbp)
    games = games[games["season_type"] == "REG"].copy()
    games = games.dropna(subset=["home_score", "away_score"])

    def _merge_side(g: pd.DataFrame, team_col: str, prefix: str) -> pd.DataFrame:
        o = off.rename(
            columns={
                "team": team_col,
                "epa": f"{prefix}_epa_off",
                "success": f"{prefix}_success_rate",
                "proe": f"{prefix}_proe",
            }
        )
        d = deff.rename(columns={"team": team_col, "epa": f"{prefix}_epa_def"})
        g = g.merge(o, on=["season", "week", team_col], how="left")
        g = g.merge(d, on=["season", "week", team_col], how="left")
        return g

    games = _merge_side(games, "home_team", "home")
    games = _merge_side(games, "away_team", "away")

    # Rest days from each team's prior game date, if game_date is present.
    if "game_date" in games.columns:
        games["game_date"] = pd.to_datetime(games["game_date"], errors="coerce")
        games = games.sort_values("game_date")
        long = pd.concat(
            [
                games[["game_id", "game_date", "home_team"]].rename(columns={"home_team": "team"}),
                games[["game_id", "game_date", "away_team"]].rename(columns={"away_team": "team"}),
            ]
        ).sort_values(["team", "game_date"])
        long["rest_days"] = long.groupby("team")["game_date"].diff().dt.days
        rest = long.set_index(["game_id", "team"])["rest_days"]
        games["home_rest_days"] = games.apply(
            lambda r: rest.get((r["game_id"], r["home_team"]), np.nan), axis=1
        )
        games["away_rest_days"] = games.apply(
            lambda r: rest.get((r["game_id"], r["away_team"]), np.nan), axis=1
        )
    else:
        games["home_rest_days"] = np.nan
        games["away_rest_days"] = np.nan
        games["game_date"] = pd.to_datetime(
            games["season"].astype(str) + "-01-01"
        ) + pd.to_timedelta((games["week"].astype(int) - 1) * 7, unit="D")

    games["total_runs"] = games["home_score"].astype(float) + games["away_score"].astype(float)
    games["spread_close"] = -pd.to_numeric(games["spread_line"], errors="coerce")
    games["total_close"] = pd.to_numeric(games["total_line"], errors="coerce")

    # Dome flag from nflverse roof (dome/closed = weather-neutral).
    if "roof" in games.columns:
        games["is_dome"] = (
            games["roof"].astype(str).str.lower().isin(["dome", "closed"]).astype(float)
        )
    else:
        games["is_dome"] = np.nan

    # Historical pre-training has no injury / QB / Oracle signal; leave NaN so the
    # model learns to rely on EPA + market, and live inference simply adds them.
    games["injuries_home_severe"] = np.nan
    games["injuries_away_severe"] = np.nan
    games["qb_home_active"] = np.nan
    games["qb_away_active"] = np.nan
    games["home_is_short_week"] = (games["home_rest_days"] <= 5).astype(float)
    games["away_is_short_week"] = (games["away_rest_days"] <= 5).astype(float)
    games["home_is_off_bye"] = (games["home_rest_days"] >= 13).astype(float)
    games["away_is_off_bye"] = (games["away_rest_days"] >= 13).astype(float)
    games["wind_mph"] = np.nan
    games["oracle_confidence"] = np.nan
    games["data_quality_score"] = np.nan
    games["signal_coherence_score"] = np.nan

    games["market_type"] = _NFL_MARKET_TYPE[market]
    games["result"] = "resolved"  # non-null so filter_for_market keeps the row
    games["source"] = "nflverse_history"
    games["line"] = np.nan
    games["side"] = None

    return games.reset_index(drop=True)
