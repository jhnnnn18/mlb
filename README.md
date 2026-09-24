# mlb — Statcast Explorer

A Baseball Savant–style page for exploring MLB Statcast (pitch-tracking) data for any player,
built to make the numbers easier to understand.

## Features
- Player search (every MLB player for a season), batter or pitcher view, last 10/25/50 games or full season
- Summary tiles: exit velocity, launch angle, hard-hit %, barrel %, sweet spot %, whiff %, chase %, K %, BB % (pitchers: velocity, zone %, contact allowed)
- Spray chart and exit velocity vs. launch angle chart (with barrel zone)
- Strike-zone pitch locations (filter by swings/whiffs/called strikes/in play) and pitch movement (pitchers)
- Run value, xBA and xwOBA (from Baseball Savant) in the summary, per pitch type and per batted ball
- Pitch-type breakdown table and sortable batted-ball log
- Video: click any chart dot, or ▶ Watch in the batted-ball log, to open that pitch's clip on Baseball Savant
- Glossary explaining every stat
- Shareable URLs, e.g. `http://localhost:8000/#player=592450&role=batter&season=2026&games=25`

## Running it
```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```
Then open http://localhost:8000.

Run the tests with `pytest`.

## How it works
A small Flask server does all the data work in Python; the browser only draws the page.

```
browser (static/)  ──►  app.py (Flask)  ──►  statsapi.mlb.com       (pitch tracking, play-by-play)
   charts + UI           JSON API        └─►  baseballsavant.mlb.com  (run value, expected stats)
```

| File | Purpose |
|---|---|
| `app.py` | Flask server: serves the page and the JSON API below |
| `statcast/mlb_api.py` | Fetches players, game logs and per-game play-by-play (in parallel, cached 10 min) and flattens it into one `Pitch` record per pitch |
| `statcast/savant.py` | Downloads the player's Baseball Savant pitch-by-pitch CSV and merges its extra columns onto each `Pitch` (matched on game, at-bat and pitch number) |
| `statcast/metrics.py` | Stat definitions (barrel, hard-hit, whiff, chase…), summaries, pitch-type breakdown, glossary |
| `static/index.html`, `static/css/`, `static/js/` | The page: `app.js` handles controls and rendering, `charts.js` draws the SVG charts |
| `tests/` | pytest tests for the parser, the metrics and the API routes |

### API
| Endpoint | Returns |
|---|---|
| `GET /api/players?season=2026` | Every player that season: id, name, position, team, `is_pitcher` |
| `GET /api/statcast/<player_id>?season=2026&role=batter&games=25` | `games`, `savant_available`, `summary`, `pitch_types`, `pitches` (one record per pitch with flags like `is_barrel`), `barrel_zone` |
| `GET /api/glossary` | Stat definitions |

`role` is `batter` or `pitcher`; `games` is `10`, `25`, `50` or `all`.

### Data sources
- **[MLB Stats API](https://statsapi.mlb.com)**: players, game logs and per-pitch tracking (velocity, spin,
  movement, location, exit velocity, launch angle, hit location).
- **[Baseball Savant](https://baseballsavant.mlb.com/statcast_search) CSV export**: numbers only Savant has,
  namely run value (`delta_run_exp`), expected stats (xBA, xwOBA, xSLG), wOBA credit, the official barrel flag,
  perceived velocity, arm angle and bat tracking. This export isn't an official API. If it's unavailable, the
  page still loads, those stats show as —, and Barrel % falls back to Statcast's published EV/LA windows.

Run value is shown so that positive is good for the player you're viewing (flipped for pitchers, as on
Savant's leaderboards).
