"""Client for the public MLB Stats API (statsapi.mlb.com).

The Stats API serves the same pitch-tracking (Statcast) numbers Baseball
Savant uses. This module fetches players, game logs and per-game
play-by-play, and flattens the play-by-play into one record per pitch.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Any

import requests

BASE_URL = "https://statsapi.mlb.com/api"
CACHE_TTL_SECONDS = 10 * 60
MAX_WORKERS = 8

_session = requests.Session()
_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def get_json(path: str) -> Any:
    """GET a Stats API path, caching responses for CACHE_TTL_SECONDS."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(path)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
    resp = _session.get(BASE_URL + path, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    with _cache_lock:
        _cache[path] = (now, data)
    return data


def fetch_teams(season: int) -> dict[int, str]:
    """Team id -> abbreviation (e.g. 147 -> "NYY")."""
    data = get_json(f"/v1/teams?sportId=1&season={season}")
    return {t["id"]: t.get("abbreviation", "") for t in data.get("teams", [])}


def fetch_players(season: int) -> list[dict]:
    """Every MLB player on a roster during the season, sorted by name."""
    data = get_json(f"/v1/sports/1/players?season={season}")
    teams = fetch_teams(season)
    players = []
    for p in data.get("people", []):
        pos = p.get("primaryPosition") or {}
        team_id = (p.get("currentTeam") or {}).get("id")
        players.append({
            "id": p["id"],
            "name": p.get("fullName", ""),
            "position": pos.get("abbreviation", ""),
            "is_pitcher": pos.get("type") == "Pitcher" or pos.get("abbreviation") == "P",
            "team": teams.get(team_id, ""),
        })
    return sorted(players, key=lambda p: p["name"])


def fetch_game_log(player_id: int, season: int, role: str) -> list[dict]:
    """Regular-season games the player appeared in, newest first."""
    group = "pitching" if role == "pitcher" else "hitting"
    data = get_json(f"/v1/people/{player_id}/stats?stats=gameLog&group={group}"
                    f"&season={season}&gameType=R")
    stats = data.get("stats") or [{}]
    games = [{
        "game_pk": s["game"]["gamePk"],
        "date": s.get("date", ""),
        "opponent": (s.get("opponent") or {}).get("name", ""),
    } for s in stats[0].get("splits", [])]
    return sorted(games, key=lambda g: g["date"], reverse=True)


@dataclass
class Pitch:
    """One pitch involving the player. Tracking fields are None when missing."""
    game_pk: int
    date: str
    opponent: str
    play_id: str | None  # Statcast's id for the pitch; also keys its video
    inning: int | None
    batter: str
    pitcher: str
    bat_side: str
    pitch_hand: str
    balls: int | None
    strikes: int | None
    pitch_type: str
    pitch_name: str
    call_code: str
    call_desc: str
    is_in_play: bool
    speed: float | None  # release speed, mph
    spin: float | None  # rpm
    ivb: float | None  # induced vertical break, inches
    hb: float | None  # horizontal break, inches
    extension: float | None  # feet
    px: float | None  # plate location, feet from center (catcher's view)
    pz: float | None  # plate location, feet above ground
    sz_top: float | None
    sz_bot: float | None
    zone: int | None  # 1-9 in the strike zone, 11-14 outside
    ev: float | None  # exit velocity, mph
    la: float | None  # launch angle, degrees
    dist: float | None  # feet
    trajectory: str
    hc_x: float | None  # Gameday hit coordinates (home plate ~ (125, 199))
    hc_y: float | None
    # The plate appearance's result, set only on its final pitch.
    event: str
    event_type: str

    def to_dict(self) -> dict:
        return asdict(self)


def _num(value: Any) -> float | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def extract_pitches(pbp: dict, game: dict, player_id: int, role: str) -> list[Pitch]:
    """Flatten one game's play-by-play into the pitches the player was part of."""
    out: list[Pitch] = []
    for play in pbp.get("allPlays", []):
        matchup = play.get("matchup") or {}
        who = matchup.get("pitcher" if role == "pitcher" else "batter") or {}
        if who.get("id") != player_id:
            continue
        result = play.get("result") or {}
        pitches = [e for e in play.get("playEvents", []) if e.get("isPitch")]
        for i, e in enumerate(pitches):
            details = e.get("details") or {}
            call = details.get("call") or {}
            ptype = details.get("type") or {}
            pd = e.get("pitchData") or {}
            breaks = pd.get("breaks") or {}
            coords = pd.get("coordinates") or {}
            hit = e.get("hitData") or {}
            hit_coords = hit.get("coordinates") or {}
            count = e.get("count") or {}
            last = i == len(pitches) - 1
            out.append(Pitch(
                game_pk=game["game_pk"],
                date=game["date"],
                opponent=game["opponent"],
                play_id=e.get("playId"),
                inning=(play.get("about") or {}).get("inning"),
                batter=(matchup.get("batter") or {}).get("fullName", ""),
                pitcher=(matchup.get("pitcher") or {}).get("fullName", ""),
                bat_side=(matchup.get("batSide") or {}).get("code", ""),
                pitch_hand=(matchup.get("pitchHand") or {}).get("code", ""),
                balls=count.get("balls"),
                strikes=count.get("strikes"),
                pitch_type=ptype.get("code", "UN"),
                pitch_name=ptype.get("description", "Unknown"),
                call_code=call.get("code", details.get("code", "")),
                call_desc=call.get("description", details.get("description", "")),
                is_in_play=bool(details.get("isInPlay")),
                speed=_num(pd.get("startSpeed")),
                spin=_num(breaks.get("spinRate")),
                ivb=_num(breaks.get("breakVerticalInduced")),
                hb=_num(breaks.get("breakHorizontal")),
                extension=_num(pd.get("extension")),
                px=_num(coords.get("pX")),
                pz=_num(coords.get("pZ")),
                sz_top=_num(pd.get("strikeZoneTop")),
                sz_bot=_num(pd.get("strikeZoneBottom")),
                zone=_num(pd.get("zone")),
                ev=_num(hit.get("launchSpeed")),
                la=_num(hit.get("launchAngle")),
                dist=_num(hit.get("totalDistance")),
                trajectory=hit.get("trajectory", ""),
                hc_x=_num(hit_coords.get("coordX")),
                hc_y=_num(hit_coords.get("coordY")),
                event=result.get("event", "") if last else "",
                event_type=result.get("eventType", "") if last else "",
            ))
    return out


def fetch_pitches(games: list[dict], player_id: int, role: str) -> list[Pitch]:
    """Load every game's play-by-play in parallel and collect the player's pitches."""
    def load(game: dict) -> list[Pitch]:
        try:
            pbp = get_json(f"/v1/game/{game['game_pk']}/playByPlay")
        except requests.RequestException:
            return []  # skip a game that fails to load rather than fail the request
        return extract_pitches(pbp, game, player_id, role)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        per_game = list(pool.map(load, games))
    return [p for game_pitches in per_game for p in game_pitches]
