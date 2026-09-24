# mlb — Statcast Explorer

A Baseball Savant–style page for exploring MLB Statcast (pitch-tracking) data for any player,
built to make the numbers easier to understand.

## Features
- Player search (every MLB player for a season), batter or pitcher view, last 10/25/50 games or full season
- Summary tiles: exit velocity, launch angle, hard-hit %, barrel %, sweet spot %, whiff %, chase %, K %, BB % (pitchers: velocity, zone %, contact allowed)
- Spray chart and exit velocity vs. launch angle chart (with barrel zone)
- Strike-zone pitch locations (filter by swings/whiffs/called strikes/in play) and pitch movement (pitchers)
- Pitch-type breakdown table and sortable batted-ball log
- Video: click any chart dot, or ▶ Watch in the batted-ball log, to open that pitch's clip on Baseball Savant
- Glossary explaining every stat
- Shareable URLs, e.g. `index.html#player=592450&role=batter&season=2026&games=25`

## Running it
No build step or server needed — open `index.html` in a browser. It also works as-is on GitHub Pages.

## How it works
Data comes live from the public [MLB Stats API](https://statsapi.mlb.com) (the same pitch-tracking
data Baseball Savant uses), which can be called directly from the browser:

| File | Purpose |
|---|---|
| `js/api.js` | Fetches players, game logs and per-game play-by-play, flattens it into one record per pitch |
| `js/metrics.js` | Stat definitions (barrel, hard-hit, whiff, chase…) and the glossary |
| `js/charts.js` | Hand-drawn SVG charts |
| `js/app.js` | Page controls and rendering |

Barrel % uses Statcast's published exit-velocity / launch-angle windows, so it may differ slightly
from Baseball Savant's official numbers.
