"""Baseball Savant's pitch-by-pitch CSV export (Statcast Search).

Savant's CSV carries numbers the MLB Stats API doesn't: run value per pitch,
expected stats (xBA, xwOBA, xSLG), the official contact-quality class used
for barrels, perceived velocity, arm angle and bat tracking. This module
downloads a player's rows and merges them onto the Stats API pitches.

The export isn't an official API: column names can change and very large
queries are truncated (reportedly ~25,000 rows), which one player's season
stays well under.
"""
from __future__ import annotations

import csv
import io
import threading
import time
from urllib.parse import urlencode

import requests

from .mlb_api import Pitch

CSV_URL = "https://baseballsavant.mlb.com/statcast_search/csv"
CACHE_TTL_SECONDS = 10 * 60

_session = requests.Session()
_session.headers["User-Agent"] = "statcast-explorer (personal project)"
_cache: dict[str, tuple[float, list[dict]]] = {}
_cache_lock = threading.Lock()

# Savant column -> (Pitch field, converter)
FIELDS = {
    "delta_run_exp": ("run_value", float),
    "estimated_ba_using_speedangle": ("xba", float),
    "estimated_woba_using_speedangle": ("xwoba", float),
    "estimated_slg_using_speedangle": ("xslg", float),
    "woba_value": ("woba_value", float),
    "woba_denom": ("woba_denom", float),
    "launch_speed_angle": ("launch_speed_angle", lambda v: int(float(v))),
    "effective_speed": ("effective_speed", float),
    "arm_angle": ("arm_angle", float),
    "bat_speed": ("bat_speed", float),
    "swing_length": ("swing_length", float),
    "events": ("savant_event", str),
}


def csv_url(player_id: int, role: str, start: str, end: str) -> str:
    """Statcast Search CSV for one player's regular-season pitches in [start, end]."""
    lookup = "pitchers_lookup[]" if role == "pitcher" else "batters_lookup[]"
    params = {
        "all": "true",
        "type": "details",
        "player_type": "pitcher" if role == "pitcher" else "batter",
        lookup: player_id,
        "game_date_gt": start,
        "game_date_lt": end,
        "hfGT": "R|",  # regular season
        "min_pitches": 0,
        "min_results": 0,
    }
    return CSV_URL + "?" + urlencode(params)


def parse_csv(text: str) -> list[dict]:
    """CSV text -> list of row dicts ('' becomes None)."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    return [{k: (v if v not in ("", "null", "NA") else None) for k, v in row.items() if k} for row in reader]


def fetch_rows(player_id: int, role: str, start: str, end: str) -> list[dict]:
    """Download (and cache) the player's Savant rows between two YYYY-MM-DD dates."""
    url = csv_url(player_id, role, start, end)
    now = time.time()
    with _cache_lock:
        hit = _cache.get(url)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
    resp = _session.get(url, timeout=60)
    resp.raise_for_status()
    rows = parse_csv(resp.text)
    if rows and "game_pk" not in rows[0]:
        raise ValueError("Unexpected Savant CSV format")
    with _cache_lock:
        _cache[url] = (now, rows)
    return rows


def _key(game_pk, at_bat_number, pitch_number) -> tuple[int, int, int] | None:
    try:
        return int(float(game_pk)), int(float(at_bat_number)), int(float(pitch_number))
    except (TypeError, ValueError):
        return None


def merge(pitches: list[Pitch], rows: list[dict]) -> int:
    """Copy Savant fields onto matching pitches in place; returns how many matched.

    Rows match on (game_pk, at_bat_number, pitch_number), which both sources share.
    """
    by_key = {}
    for row in rows:
        key = _key(row.get("game_pk"), row.get("at_bat_number"), row.get("pitch_number"))
        if key:
            by_key[key] = row
    matched = 0
    for p in pitches:
        row = by_key.get(_key(p.game_pk, p.at_bat_number, p.pitch_number))
        if row is None:
            continue
        matched += 1
        for column, (field, convert) in FIELDS.items():
            value = row.get(column)
            if value is None:
                continue
            try:
                setattr(p, field, convert(value))
            except ValueError:
                pass
    return matched


def add_savant_data(pitches: list[Pitch], games: list[dict], player_id: int, role: str) -> bool:
    """Fetch and merge Savant data for these games. False if Savant was unavailable."""
    if not pitches or not games:
        return False
    dates = sorted(g["date"] for g in games)
    try:
        rows = fetch_rows(player_id, role, dates[0], dates[-1])
    except (requests.RequestException, ValueError):
        return False
    return merge(pitches, rows) > 0
