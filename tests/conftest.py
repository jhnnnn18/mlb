import pytest

from statcast.mlb_api import Pitch

DEFAULTS = dict(
    game_pk=1, date="2026-08-01", opponent="Boston Red Sox", play_id="abc",
    at_bat_number=1, pitch_number=1, inning=1,
    batter="Batter", pitcher="Pitcher", bat_side="R", pitch_hand="R", balls=0, strikes=0,
    pitch_type="FF", pitch_name="Four-Seam Fastball", call_code="B", call_desc="Ball",
    is_in_play=False, speed=95.0, spin=2300.0, ivb=16.0, hb=-8.0, extension=6.5,
    px=0.0, pz=2.5, sz_top=3.4, sz_bot=1.6, zone=5, ev=None, la=None, dist=None,
    trajectory="", hc_x=None, hc_y=None, event="", event_type="",
)


@pytest.fixture
def make_pitch():
    """Build a Pitch with sensible defaults; override any field by keyword."""
    def make(**overrides):
        return Pitch(**{**DEFAULTS, **overrides})
    return make
