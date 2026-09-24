import pytest

import app as server
from statcast import mlb_api
from tests.test_mlb_api import PBP


@pytest.fixture
def client(monkeypatch):
    def fake_get_json(path):
        if "/sports/1/players" in path:
            return {"people": [{"id": 10, "fullName": "Our Guy",
                                "primaryPosition": {"abbreviation": "RF", "type": "Outfielder"},
                                "currentTeam": {"id": 147}}]}
        if "/v1/teams" in path:
            return {"teams": [{"id": 147, "abbreviation": "NYY"}]}
        if "gameLog" in path:
            return {"stats": [{"splits": [
                {"date": f"2026-08-{d:02d}", "game": {"gamePk": d}, "opponent": {"name": "BOS"}}
                for d in range(1, 31)]}]}
        return PBP

    monkeypatch.setattr(mlb_api, "get_json", fake_get_json)
    return server.app.test_client()


def test_players(client):
    assert client.get("/api/players?season=2026").get_json() == [
        {"id": 10, "name": "Our Guy", "position": "RF", "is_pitcher": False, "team": "NYY"}]


def test_statcast(client):
    data = client.get("/api/statcast/10?season=2026&role=batter&games=10").get_json()
    assert len(data["games"]) == 10
    assert data["games"][0]["date"] == "2026-08-30"      # newest first
    assert data["summary"]["pitches"] == 20              # 2 pitches x 10 games
    homer = data["pitches"][1]
    assert homer["is_barrel"] and homer["is_hit"] and homer["play_id"] == "p2"
    assert data["pitch_types"][0]["code"] == "SL"


def test_statcast_rejects_bad_params(client):
    assert client.get("/api/statcast/10?season=2026&role=umpire").status_code == 400


def test_index_served(client):
    assert b"Statcast Explorer" in client.get("/").data
