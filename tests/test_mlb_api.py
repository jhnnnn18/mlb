from statcast import mlb_api

GAME = {"game_pk": 777, "date": "2026-08-01", "opponent": "Boston Red Sox"}


def pitch_event(code, desc, in_play=False, hit=None, play_id="pid"):
    event = {
        "isPitch": True,
        "playId": play_id,
        "count": {"balls": 0, "strikes": 1},
        "details": {"call": {"code": code, "description": desc}, "isInPlay": in_play,
                    "type": {"code": "SL", "description": "Slider"}},
        "pitchData": {"startSpeed": 87.1, "zone": 14, "strikeZoneTop": 3.5, "strikeZoneBottom": 1.6,
                      "coordinates": {"pX": 1.1, "pZ": 1.2},
                      "breaks": {"spinRate": 2500, "breakVerticalInduced": 2.0, "breakHorizontal": 6.0}},
    }
    if hit:
        event["hitData"] = hit
    return event


PBP = {"allPlays": [
    {   # our batter: two pitches, then a home run
        "about": {"inning": 3, "atBatIndex": 4},
        "matchup": {"batter": {"id": 10, "fullName": "Our Guy"}, "pitcher": {"id": 20, "fullName": "Their Ace"},
                    "batSide": {"code": "R"}, "pitchHand": {"code": "L"}},
        "result": {"event": "Home Run", "eventType": "home_run"},
        "playEvents": [
            pitch_event("S", "Swinging Strike", play_id="p1"),
            {"isPitch": False, "details": {"description": "Mound visit"}},
            pitch_event("X", "In play, run(s)", in_play=True, play_id="p2", hit={
                "launchSpeed": 108.2, "launchAngle": 27, "totalDistance": 421,
                "trajectory": "fly_ball", "coordinates": {"coordX": 100.5, "coordY": 40.2}}),
        ],
    },
    {   # someone else batting: ignored
        "about": {"inning": 3},
        "matchup": {"batter": {"id": 11}, "pitcher": {"id": 20}},
        "result": {"eventType": "strikeout"},
        "playEvents": [pitch_event("S", "Swinging Strike")],
    },
]}


def test_extract_pitches_for_batter():
    pitches = mlb_api.extract_pitches(PBP, GAME, player_id=10, role="batter")
    assert [p.play_id for p in pitches] == ["p1", "p2"]   # non-pitch events skipped
    first, last = pitches
    assert first.event_type == ""                        # result only on the final pitch
    assert last.event_type == "home_run" and last.event == "Home Run"
    assert last.ev == 108.2 and last.la == 27 and last.dist == 421
    assert last.hc_x == 100.5 and last.hc_y == 40.2
    assert first.pitch_type == "SL" and first.spin == 2500 and first.ivb == 2.0
    assert first.pitcher == "Their Ace" and first.inning == 3 and first.game_pk == 777
    assert (first.at_bat_number, first.pitch_number) == (5, 1)   # 1-based, like Savant
    assert last.pitch_number == 2                                 # non-pitch events not counted


def test_extract_pitches_for_pitcher():
    pitches = mlb_api.extract_pitches(PBP, GAME, player_id=20, role="pitcher")
    assert len(pitches) == 3


def test_fetch_pitches_skips_failed_games(monkeypatch):
    def fake_get_json(path):
        if "/v1/game/2/" in path:
            raise mlb_api.requests.ConnectionError("boom")
        return PBP

    monkeypatch.setattr(mlb_api, "get_json", fake_get_json)
    games = [{**GAME, "game_pk": 1}, {**GAME, "game_pk": 2}]
    pitches = mlb_api.fetch_pitches(games, 10, "batter")
    assert len(pitches) == 2 and {p.game_pk for p in pitches} == {1}
