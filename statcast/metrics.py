"""Stat definitions, following Baseball Savant's published glossary.

Every function works on the Pitch records built in mlb_api.py.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Callable, Iterable

from .mlb_api import Pitch

SWING_CODES = {"S", "W", "M", "Q", "T", "F", "L", "O", "R", "X", "D", "E"}
WHIFF_CODES = {"S", "W", "M", "Q"}
HIT_EVENTS = {"single", "double", "triple", "home_run"}
STRIKEOUT_EVENTS = {"strikeout", "strikeout_double_play"}
WALK_EVENTS = {"walk", "intent_walk"}

# Savant PA results that don't count as at-bats (for xBA).
NON_AT_BAT_EVENTS = {"walk", "intent_walk", "hit_by_pitch", "sac_fly", "sac_bunt",
                     "sac_fly_double_play", "sac_bunt_double_play", "catcher_interf", "truncated_pa"}
OFFICIAL_BARREL = 6  # Savant launch_speed_angle class for a barrel

HARD_HIT_MPH = 95
SWEET_SPOT_DEGREES = (8, 32)


def is_swing(p: Pitch) -> bool:
    return p.call_code in SWING_CODES


def is_whiff(p: Pitch) -> bool:
    return p.call_code in WHIFF_CODES


def is_batted_ball(p: Pitch) -> bool:
    return p.is_in_play and p.ev is not None and p.la is not None


def in_zone(p: Pitch) -> bool:
    return p.zone is not None and 1 <= p.zone <= 9


def out_of_zone(p: Pitch) -> bool:
    return p.zone is not None and p.zone > 9


def is_hit(p: Pitch) -> bool:
    return p.event_type in HIT_EVENTS


def barrel_window(ev: float) -> tuple[float, float] | None:
    """Launch-angle range that counts as a barrel at this exit velocity.

    A barrel is an EV/LA combination that has historically produced at least
    a .500 AVG and 1.500 SLG. It starts at 98 mph with a 26-30 degree window
    that widens as EV rises, reaching 8-50 degrees at 116+ mph.
    """
    if ev < 98:
        return None
    lo = max(8.0, 26 - (ev - 98))
    hi = 30 + (ev - 98) if ev < 100 else min(50.0, 33 + (ev - 100) * 17 / 16)
    return lo, hi


def is_barrel(p: Pitch) -> bool:
    """Savant's official barrel flag when we have it, else the EV/LA window above."""
    if p.launch_speed_angle is not None:
        return p.launch_speed_angle == OFFICIAL_BARREL
    if not is_batted_ball(p):
        return False
    window = barrel_window(p.ev)
    return window is not None and window[0] <= p.la <= window[1]


def is_hard_hit(p: Pitch) -> bool:
    return is_batted_ball(p) and p.ev >= HARD_HIT_MPH


def is_sweet_spot(p: Pitch) -> bool:
    lo, hi = SWEET_SPOT_DEGREES
    return is_batted_ball(p) and lo <= p.la <= hi


def _avg(pitches: Iterable[Pitch], field: str) -> float | None:
    values = [getattr(p, field) for p in pitches if getattr(p, field) is not None]
    return mean(values) if values else None


def _max(pitches: Iterable[Pitch], field: str) -> float | None:
    values = [getattr(p, field) for p in pitches if getattr(p, field) is not None]
    return max(values) if values else None


def _rate(pitches: list[Pitch], test: Callable[[Pitch], bool]) -> float | None:
    """Share of pitches passing test, or None when there are none to judge."""
    if not pitches:
        return None
    return sum(1 for p in pitches if test(p)) / len(pitches)


def has_savant_data(pitches: list[Pitch]) -> bool:
    return any(p.run_value is not None or p.savant_event for p in pitches)


def run_value(pitches: list[Pitch], role: str) -> float | None:
    """Total run value, signed so positive is good for the player being viewed.

    Savant's delta_run_exp is from the batting team's side, so a pitcher's
    run value is its negative (the same convention Savant's leaderboards use).
    """
    values = [p.run_value for p in pitches if p.run_value is not None]
    if not values:
        return None
    total = sum(values)
    return -total if role == "pitcher" else total


def run_value_per_100(pitches: list[Pitch], role: str) -> float | None:
    total = run_value(pitches, role)
    return None if total is None else total / len(pitches) * 100


def xwoba(pitches: list[Pitch]) -> float | None:
    """Expected wOBA: batted balls use their xwOBA, other PA results their actual wOBA credit."""
    pa = [p for p in pitches if p.woba_denom]
    if not pa:
        return None
    credit = sum(p.xwoba if p.xwoba is not None else (p.woba_value or 0) for p in pa)
    return credit / sum(p.woba_denom for p in pa)


def woba(pitches: list[Pitch]) -> float | None:
    pa = [p for p in pitches if p.woba_denom]
    if not pa:
        return None
    return sum(p.woba_value or 0 for p in pa) / sum(p.woba_denom for p in pa)


def xba(pitches: list[Pitch]) -> float | None:
    """Expected batting average: expected hits (xBA of each batted ball) per at-bat."""
    at_bats = [p for p in pitches if p.savant_event and p.savant_event not in NON_AT_BAT_EVENTS]
    if not at_bats:
        return None
    expected_hits = sum(p.xba if p.xba is not None else float(p.savant_event in HIT_EVENTS)
                        for p in at_bats)
    return expected_hits / len(at_bats)


def summarize(pitches: list[Pitch], role: str = "batter") -> dict:
    """Headline numbers for the stat tiles."""
    batted = [p for p in pitches if is_batted_ball(p)]
    swings = [p for p in pitches if is_swing(p)]
    tracked = [p for p in pitches if p.zone is not None]
    pa_ends = [p for p in pitches if p.event_type]
    return {
        "pitches": len(pitches),
        "pa": len(pa_ends),
        "bbe": len(batted),
        "avg_ev": _avg(batted, "ev"),
        "max_ev": _max(batted, "ev"),
        "avg_la": _avg(batted, "la"),
        "hard_hit": _rate(batted, is_hard_hit),
        "barrel": _rate(batted, is_barrel),
        "sweet_spot": _rate(batted, is_sweet_spot),
        "whiff": _rate(swings, is_whiff),
        "chase": _rate([p for p in pitches if out_of_zone(p)], is_swing),
        "zone_swing": _rate([p for p in pitches if in_zone(p)], is_swing),
        "zone": _rate(tracked, in_zone),
        "k_rate": _rate(pa_ends, lambda p: p.event_type in STRIKEOUT_EVENTS),
        "bb_rate": _rate(pa_ends, lambda p: p.event_type in WALK_EVENTS),
        "avg_velo": _avg(pitches, "speed"),
        "max_velo": _max(pitches, "speed"),
        # Savant-only (None when Savant data is unavailable)
        "run_value": run_value(pitches, role),
        "xba": xba(pitches),
        "xwoba": xwoba(pitches),
        "woba": woba(pitches),
    }


def by_pitch_type(pitches: list[Pitch], role: str = "batter") -> list[dict]:
    """One row per pitch type, most-used first."""
    groups: dict[str, list[Pitch]] = defaultdict(list)
    for p in pitches:
        groups[p.pitch_type].append(p)
    rows = []
    for code, group in groups.items():
        batted = [p for p in group if is_batted_ball(p)]
        rows.append({
            "code": code,
            "name": group[0].pitch_name,
            "count": len(group),
            "usage": len(group) / len(pitches),
            "velo": _avg(group, "speed"),
            "spin": _avg(group, "spin"),
            "ivb": _avg(group, "ivb"),
            "hb": _avg(group, "hb"),
            "whiff": _rate([p for p in group if is_swing(p)], is_whiff),
            "bbe": len(batted),
            "ev": _avg(batted, "ev"),
            "hard_hit": _rate(batted, is_hard_hit),
            "run_value": run_value(group, role),
            "rv_per_100": run_value_per_100(group, role),
            "xwoba": xwoba(group),
        })
    return sorted(rows, key=lambda r: r["count"], reverse=True)


def pitch_flags(p: Pitch) -> dict:
    """Per-pitch yes/no labels the page uses for filtering and coloring."""
    return {
        "is_swing": is_swing(p),
        "is_whiff": is_whiff(p),
        "is_batted_ball": is_batted_ball(p),
        "is_barrel": is_barrel(p),
        "is_hit": is_hit(p),
    }


def barrel_zone_outline(max_ev: int = 120) -> list[list[float]]:
    """[ev, min_la, max_la] rows the page draws as the barrel zone."""
    return [[ev, *barrel_window(ev)] for ev in range(98, max_ev + 1)]


GLOSSARY = [
    ("Exit Velocity (EV)", "How fast the ball comes off the bat, in mph. Harder-hit balls become hits far more often."),
    ("Launch Angle (LA)", "The vertical angle the ball leaves the bat. Below 10° is a ground ball, 10–25° a line drive, 25–50° a fly ball, above 50° a pop-up."),
    ("Hard-Hit %", "Share of batted balls hit 95 mph or harder — the speed where outcomes start to improve sharply."),
    ("Barrel %", "Share of batted balls with the ideal EV + LA combination (starting at 98 mph and 26–30°). Barrels historically hit at least .500 with a 1.500 slugging percentage. Uses Savant's official barrel flag when available."),
    ("Sweet Spot %", "Share of batted balls launched between 8° and 32° — the band that produces the most line drives."),
    ("Run Value", "How many runs a pitch (or group of pitches) was worth, based on how each one changed the count, outs and base runners. Shown so that positive is good for the player you're viewing. RV/100 is run value per 100 pitches, for comparing pitches thrown different amounts."),
    ("wOBA", "Weighted on-base average: like on-base percentage, but each result is weighted by how many runs it's worth (a home run counts more than a single). League average is usually around .310–.320."),
    ("xBA / xwOBA", "Expected batting average and expected wOBA. They judge each batted ball by its exit velocity and launch angle (and sometimes the batter's speed) rather than whether it found a hole, so they strip out luck and defense."),
    ("Whiff %", "Swings and misses divided by total swings."),
    ("Chase %", "How often the batter swings at pitches outside the strike zone."),
    ("Zone %", "Share of pitches thrown inside the strike zone."),
    ("Spin Rate", "How fast the pitch spins, in revolutions per minute. More spin generally means more movement."),
    ("Induced Vertical Break (IVB)", "How many inches a pitch rises or drops compared with a spinless pitch, ignoring gravity. High-IVB fastballs appear to \"rise\"."),
    ("Horizontal Break (HB)", "Side-to-side movement in inches, measured from the catcher’s view."),
    ("Extension", "How far in front of the rubber the pitcher releases the ball, in feet. More extension makes a pitch look faster."),
]
