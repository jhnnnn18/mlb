import pytest

from statcast import metrics


def batted(make_pitch, ev, la, event_type="field_out"):
    return make_pitch(call_code="X", is_in_play=True, ev=ev, la=la, event_type=event_type)


@pytest.mark.parametrize("ev, la, expected", [
    (97.9, 28, False),   # just under the 98 mph floor
    (98, 26, True),      # 98 mph: 26-30 degrees
    (98, 31, False),
    (100, 24, True),     # 100 mph: 24-33 degrees
    (100, 34, False),
    (116, 8, True),      # 116 mph: 8-50 degrees
    (116, 50, True),
    (120, 7, False),     # window stops widening past 116
])
def test_barrel(make_pitch, ev, la, expected):
    assert metrics.is_barrel(batted(make_pitch, ev, la)) is expected


def test_barrel_needs_ball_in_play(make_pitch):
    assert not metrics.is_barrel(make_pitch(ev=105, la=28, is_in_play=False))


def test_hard_hit_and_sweet_spot(make_pitch):
    assert metrics.is_hard_hit(batted(make_pitch, 95, 0))
    assert not metrics.is_hard_hit(batted(make_pitch, 94.9, 0))
    assert metrics.is_sweet_spot(batted(make_pitch, 80, 8))
    assert not metrics.is_sweet_spot(batted(make_pitch, 80, 33))


def test_summarize(make_pitch):
    pitches = [
        make_pitch(call_code="S", zone=12),                     # chase + whiff
        make_pitch(call_code="B", zone=13),                     # take outside
        make_pitch(call_code="F", zone=5),                      # foul in zone
        make_pitch(call_code="S", zone=5, event_type="strikeout"),
        batted(make_pitch, 105, 28, "home_run"),                # barrel, hard hit
        batted(make_pitch, 80, -10, "field_out"),
        make_pitch(call_code="B", zone=14, event_type="walk"),
    ]
    s = metrics.summarize(pitches)
    assert s["pitches"] == 7
    assert s["pa"] == 4
    assert s["bbe"] == 2
    assert s["avg_ev"] == pytest.approx(92.5)
    assert s["max_ev"] == 105
    assert s["hard_hit"] == 0.5
    assert s["barrel"] == 0.5
    assert s["whiff"] == pytest.approx(2 / 5)   # 2 whiffs in 5 swings
    assert s["chase"] == pytest.approx(1 / 3)   # 1 swing at 3 pitches outside
    assert s["k_rate"] == 0.25
    assert s["bb_rate"] == 0.25


def test_summarize_empty_is_all_none_rates():
    s = metrics.summarize([])
    assert s["pitches"] == 0
    assert s["avg_ev"] is None and s["whiff"] is None


def test_by_pitch_type(make_pitch):
    pitches = [make_pitch(pitch_type="SL", pitch_name="Slider", speed=86.0)] * 3 + \
              [make_pitch(pitch_type="FF", speed=97.0)]
    rows = metrics.by_pitch_type(pitches)
    assert [r["code"] for r in rows] == ["SL", "FF"]   # most-used first
    assert rows[0]["usage"] == 0.75
    assert rows[1]["velo"] == 97.0


def test_barrel_zone_outline():
    rows = metrics.barrel_zone_outline()
    assert rows[0] == [98, 26, 30]
    assert rows[-1][0] == 120 and rows[-1][1:] == [8, 50]
