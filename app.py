"""Statcast Explorer web server.

Serves the page in static/ and a small JSON API that does all the data work:

    GET /api/players?season=2026
    GET /api/statcast/<player_id>?season=2026&role=batter&games=25
    GET /api/glossary

Run with:  python app.py   then open http://localhost:8000
"""
from __future__ import annotations

import os

import requests
from flask import Flask, jsonify, request

from statcast import metrics, mlb_api, savant

app = Flask(__name__, static_folder="static", static_url_path="")

ROLES = {"batter", "pitcher"}
GAME_LIMITS = {"10", "25", "50", "all"}


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/players")
def players():
    season = request.args.get("season", type=int)
    if not season:
        return jsonify(error="season is required"), 400
    return jsonify(mlb_api.fetch_players(season))


@app.get("/api/statcast/<int:player_id>")
def statcast(player_id: int):
    season = request.args.get("season", type=int)
    role = request.args.get("role", "batter")
    games_limit = request.args.get("games", "25")
    if not season or role not in ROLES or games_limit not in GAME_LIMITS:
        return jsonify(error="expected season, role=batter|pitcher and games=10|25|50|all"), 400

    games = mlb_api.fetch_game_log(player_id, season, role)
    if games_limit != "all":
        games = games[:int(games_limit)]
    pitches = mlb_api.fetch_pitches(games, player_id, role)
    # Adds run value, expected stats and official barrels; the page still works without it.
    savant_ok = savant.add_savant_data(pitches, games, player_id, role)

    return jsonify(
        games=games,
        savant_available=savant_ok,
        summary=metrics.summarize(pitches, role),
        pitch_types=metrics.by_pitch_type(pitches, role),
        pitches=[{**p.to_dict(), **metrics.pitch_flags(p)} for p in pitches],
        barrel_zone=metrics.barrel_zone_outline(),
    )


@app.get("/api/glossary")
def glossary():
    return jsonify([{"term": t, "definition": d} for t, d in metrics.GLOSSARY])


@app.errorhandler(requests.RequestException)
def mlb_unreachable(err):
    return jsonify(error=f"Couldn’t reach the MLB Stats API ({err})."), 502


if __name__ == "__main__":
    app.run(port=int(os.environ.get("PORT", 8000)), debug=True)
