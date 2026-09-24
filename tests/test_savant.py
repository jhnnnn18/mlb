import pytest

from statcast import metrics, savant

CSV = (
    "﻿pitch_type,game_date,game_pk,at_bat_number,pitch_number,events,delta_run_exp,"
    "estimated_ba_using_speedangle,estimated_woba_using_speedangle,woba_value,woba_denom,"
    "launch_speed_angle,effective_speed,bat_speed\n"
    "SL,2026-08-01,777,5,2,home_run,1.35,0.812,1.62,2.0,1,6,86.5,77.1\n"
    "SL,2026-08-01,777,5,1,,-0.05,,,,,,85.9,70.2\n"
)


def test_parse_csv_strips_bom_and_blanks():
    rows = savant.parse_csv(CSV)
    assert rows[0]["pitch_type"] == "SL"
    assert rows[1]["events"] is None and rows[1]["estimated_ba_using_speedangle"] is None


def test_csv_url():
    url = savant.csv_url(694973, "pitcher", "2026-08-01", "2026-08-31")
    assert "pitchers_lookup%5B%5D=694973" in url and "player_type=pitcher" in url
    assert "game_date_gt=2026-08-01" in url and "type=details" in url
    assert "batters_lookup" in savant.csv_url(1, "batter", "a", "b")


def test_merge(make_pitch):
    swing = make_pitch(game_pk=777, at_bat_number=5, pitch_number=1, call_code="S")
    homer = make_pitch(game_pk=777, at_bat_number=5, pitch_number=2, call_code="X",
                       is_in_play=True, ev=90.0, la=10.0)  # not a barrel by EV/LA...
    other = make_pitch(game_pk=778, at_bat_number=1, pitch_number=1)
    assert savant.merge([swing, homer, other], savant.parse_csv(CSV)) == 2
    assert homer.run_value == 1.35 and homer.xba == 0.812 and homer.savant_event == "home_run"
    assert homer.launch_speed_angle == 6 and homer.bat_speed == 77.1
    assert metrics.is_barrel(homer)          # ...but Savant's official flag wins
    assert swing.run_value == -0.05 and swing.savant_event == ""
    assert other.run_value is None


def test_add_savant_data_handles_outage(monkeypatch, make_pitch):
    def boom(*args):
        raise savant.requests.ConnectionError("down")
    monkeypatch.setattr(savant, "fetch_rows", boom)
    games = [{"game_pk": 777, "date": "2026-08-01", "opponent": "BOS"}]
    assert savant.add_savant_data([make_pitch()], games, 1, "batter") is False


def pa_end(make_pitch, event, woba_value, xba=None, xwoba=None, rv=0.0):
    return make_pitch(savant_event=event, woba_value=woba_value, woba_denom=1.0,
                      xba=xba, xwoba=xwoba, run_value=rv)


def test_expected_stats(make_pitch):
    pitches = [
        pa_end(make_pitch, "single", 0.9, xba=0.4, xwoba=0.5, rv=0.5),
        pa_end(make_pitch, "field_out", 0.0, xba=0.2, xwoba=0.3, rv=-0.3),
        pa_end(make_pitch, "strikeout", 0.0, rv=-0.4),
        pa_end(make_pitch, "walk", 0.7, rv=0.3),
        make_pitch(run_value=-0.1),                      # mid-PA pitch
    ]
    assert metrics.xba(pitches) == pytest.approx((0.4 + 0.2 + 0) / 3)       # walk isn't an at-bat
    assert metrics.xwoba(pitches) == pytest.approx((0.5 + 0.3 + 0 + 0.7) / 4)
    assert metrics.woba(pitches) == pytest.approx((0.9 + 0.7) / 4)
    assert metrics.run_value(pitches, "batter") == pytest.approx(0.0)
    pitches[0].run_value = 1.0
    assert metrics.run_value(pitches, "batter") == pytest.approx(0.5)
    assert metrics.run_value(pitches, "pitcher") == pytest.approx(-0.5)    # flipped for pitchers
    assert metrics.run_value_per_100(pitches, "batter") == pytest.approx(10.0)


def test_savant_stats_none_without_data(make_pitch):
    s = metrics.summarize([make_pitch()], "pitcher")
    assert s["run_value"] is None and s["xwoba"] is None and s["xba"] is None
