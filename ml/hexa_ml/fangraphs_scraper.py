"""
fangraphs_scraper.py — FanGraphs ZiPS projections scraper (A2).

Fetches rest-of-season ZiPS projections from FanGraphs public pages.
Projections are cached in the DB (table: fangraphs_projections) and
exposed as features by the ML pipeline.

FanGraphs provides ZiPS projections at:
  https://www.fangraphs.com/projections.aspx?pos=all&stats=bat&type=zips&team=0&lg=all

Usage in serve.py:
  POST /fangraphs/refresh  — admin trigger to re-scrape projections
  GET  /fangraphs/pitcher/:name  — pitcher projection lookup
  GET  /fangraphs/batter/:name   — batter projection lookup

NOTE: FanGraphs scraping is permitted for personal/non-commercial use per their ToS.
      Use a reasonable request delay (≥2s) and respect server load.
"""

import re
import time
import asyncio
import logging
from typing import Optional
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("fangraphs_scraper")

FANGRAPHS_BASE = "https://www.fangraphs.com"
REQUEST_DELAY = 2.0  # seconds between requests

# ZiPS projection endpoints
PROJECTIONS = {
    "zips_bat": f"{FANGRAPHS_BASE}/projections.aspx?pos=all&stats=bat&type=zips&team=0&lg=all",
    "zips_pit": f"{FANGRAPHS_BASE}/projections.aspx?pos=all&stats=pit&type=zips&team=0&lg=all",
    "dc_bat":   f"{FANGRAPHS_BASE}/projections.aspx?pos=all&stats=bat&type=dc&team=0&lg=all",
    "dc_pit":   f"{FANGRAPHS_BASE}/projections.aspx?pos=all&stats=pit&type=dc&team=0&lg=all",
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; HexaOracle/1.0; +https://hexaoracle.lat)",
    "Accept": "text/html,application/xhtml+xml",
}


async def fetch_page(url: str, client: httpx.AsyncClient) -> Optional[str]:
    """Fetch a single FanGraphs projections page."""
    try:
        resp = await client.get(url, headers=HEADERS, follow_redirects=True, timeout=30)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        logger.warning(f"[fangraphs] fetch failed {url}: {e}")
        return None


def parse_projections_table(html: str) -> list[dict]:
    """
    Parse the FanGraphs projections table from HTML.
    Returns list of dicts with player stats.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = []

    # FanGraphs uses a data table with class "rgMasterTable" or similar
    table = soup.find("table", {"class": re.compile(r"rgMasterTable|table")})
    if not table:
        # Try to find the main stats table
        table = soup.find("table", id=re.compile(r"ProjectionBoard"))
    if not table:
        logger.warning("[fangraphs] No projections table found in HTML")
        return rows

    headers = []
    for th in (table.find("thead") or table).find_all("th"):
        headers.append(th.get_text(strip=True).lower().replace(" ", "_"))

    tbody = table.find("tbody")
    if not tbody:
        return rows

    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 3:
            continue
        row = {}
        for i, cell in enumerate(cells):
            if i < len(headers):
                raw = cell.get_text(strip=True)
                # Try to parse numeric values
                try:
                    row[headers[i]] = float(raw) if raw and raw not in ("-", "—", "") else None
                except ValueError:
                    row[headers[i]] = raw if raw else None
        if row.get("name") or row.get("player"):
            rows.append(row)

    return rows


async def scrape_all_projections() -> dict[str, list[dict]]:
    """Scrape all projection types. Returns dict keyed by projection type."""
    results = {}
    async with httpx.AsyncClient() as client:
        for proj_type, url in PROJECTIONS.items():
            logger.info(f"[fangraphs] Scraping {proj_type}...")
            html = await fetch_page(url, client)
            if html:
                rows = parse_projections_table(html)
                results[proj_type] = rows
                logger.info(f"[fangraphs] {proj_type}: {len(rows)} players parsed")
            else:
                results[proj_type] = []
            await asyncio.sleep(REQUEST_DELAY)

    return results


def find_pitcher(projections: dict, name: str) -> Optional[dict]:
    """Find a pitcher by name in ZiPS/DC pitching projections."""
    name_lower = name.lower()
    for proj_type in ("zips_pit", "dc_pit"):
        for row in projections.get(proj_type, []):
            player_name = str(row.get("name") or row.get("player") or "").lower()
            if name_lower in player_name or player_name in name_lower:
                return {"source": proj_type, **row}
    return None


def find_batter(projections: dict, name: str) -> Optional[dict]:
    """Find a batter by name in ZiPS/DC batting projections."""
    name_lower = name.lower()
    for proj_type in ("zips_bat", "dc_bat"):
        for row in projections.get(proj_type, []):
            player_name = str(row.get("name") or row.get("player") or "").lower()
            if name_lower in player_name or player_name in name_lower:
                return {"source": proj_type, **row}
    return None


# ── FastAPI integration (called from serve.py) ──────────────────────────────

_cached_projections: dict = {}
_last_scrape: float = 0.0
CACHE_TTL = 6 * 3600  # 6 hours


async def get_projections(force_refresh: bool = False) -> dict:
    """Return cached projections, refreshing if stale."""
    global _cached_projections, _last_scrape
    if force_refresh or (time.time() - _last_scrape) > CACHE_TTL:
        logger.info("[fangraphs] Refreshing projections cache...")
        _cached_projections = await scrape_all_projections()
        _last_scrape = time.time()
        total = sum(len(v) for v in _cached_projections.values())
        logger.info(f"[fangraphs] Cache refreshed: {total} projection rows")
    return _cached_projections
