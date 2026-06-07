"""Runtime configuration loaded from env vars.

Uses pydantic-settings so the same Settings object can be reused in tests
with overrides. The fields mirror what Railway exposes (DATABASE_URL,
HEXA_ML_INTERNAL_TOKEN) plus tunable training hyperparameters.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All env vars used by the ML sidecar."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Connection ────────────────────────────────────────────────────────
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    internal_token: str = Field(
        default="", validation_alias="HEXA_ML_INTERNAL_TOKEN"
    )

    # ── Paths ─────────────────────────────────────────────────────────────
    # Set HEXA_ML_ARTIFACTS_DIR=/data/artifacts on Railway (with a volume
    # mounted at /data) to make models survive restarts/redeploys.
    artifacts_dir: Path = Field(
        default=Path("artifacts"),
        validation_alias="HEXA_ML_ARTIFACTS_DIR",
    )
    data_dir: Path = Field(default=Path("data"))

    # ── Training hyperparameters ──────────────────────────────────────────
    # Temporal split: test set = last N days of resolved picks
    test_days: int = Field(default=30, ge=7, le=180)
    # Minimum resolved picks required to train a market (global floor).
    # Lowered from 100 to 60 on 2026-05-14 to unblock runline training.
    min_train_size: int = Field(default=60, ge=15)
    # Per-market overrides — when set, replace `min_train_size` for that
    # market only. Used for low-volume markets like runline that are
    # historically rarer but worth training with stronger regularization.
    runline_min_train_size: int | None = Field(default=25, ge=15)
    overunder_min_train_size: int | None = Field(default=None, ge=15)
    moneyline_min_train_size: int | None = Field(default=None, ge=15)
    prop_hits_min_train_size: int | None = Field(default=30, ge=15)
    prop_strikeouts_min_train_size: int | None = Field(default=30, ge=15)
    prop_total_bases_min_train_size: int | None = Field(default=30, ge=15)
    prop_home_runs_min_train_size: int | None = Field(default=30, ge=15)
    prop_rbis_min_train_size: int | None = Field(default=30, ge=15)
    # Acceptance threshold (Brier score) — moneyline floor for production
    moneyline_brier_ceiling: float = Field(default=0.24)

    # ── NFL pre-training (nflverse history) ───────────────────────────────
    # When enabled, NFL market models train on leakage-free historical EPA from
    # nflverse instead of waiting for ~60 resolved live picks. Live picks (once
    # they exist) are concatenated on top automatically.
    nfl_pretrain_enabled: bool = Field(
        default=True, validation_alias="NFL_PRETRAIN_ENABLED"
    )
    # Empty → last 8 completed seasons. Accepts "2016-2023" or "2018,2019,2020".
    nfl_pretrain_seasons: str = Field(
        default="", validation_alias="NFL_PRETRAIN_SEASONS"
    )

    # ── Soccer pre-training (football-data.co.uk history) ─────────────────
    # When enabled, soccer market models train on leakage-free historical
    # results + closing odds from football-data.co.uk (5 big European leagues)
    # instead of waiting for ~25 resolved live picks. Live picks (once they
    # exist) are concatenated on top automatically.
    soccer_pretrain_enabled: bool = Field(
        default=True, validation_alias="SOCCER_PRETRAIN_ENABLED"
    )
    # Empty → last 8 completed seasons. Accepts "2016-2023" or "2018,2019,2020"
    # (season start years: 2023 = the 2023-24 campaign).
    soccer_pretrain_seasons: str = Field(
        default="", validation_alias="SOCCER_PRETRAIN_SEASONS"
    )

    # ── Server ────────────────────────────────────────────────────────────
    port: int = Field(default=8000, validation_alias="PORT")
    log_level: str = Field(default="info", validation_alias="LOG_LEVEL")


_settings: Settings | None = None


def get_settings() -> Settings:
    """Cached settings — call this everywhere instead of instantiating."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings_for_tests() -> None:
    """Pytest helper — wipes the cache so a fresh Settings() reads env again."""
    global _settings
    _settings = None
