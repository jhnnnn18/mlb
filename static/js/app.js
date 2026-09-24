/* Page controller: reads the controls, asks the Python server (app.py) for
 * data, and renders every panel. All stat calculations happen server-side. */
(function (S) {
  var C = S.charts;

  var PITCH_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var OTHER_COLOR = '#898781';
  var OUTCOMES = [
    { key: 'out', label: 'Out', color: '#898781' },
    { key: 'hit', label: 'Hit', color: '#2a78d6' },
    { key: 'hr', label: 'Home run', color: '#eb6834' }
  ];
  var ZONE_FILTERS = {
    all: { label: 'All pitches', test: function () { return true; } },
    swings: { label: 'Swings', test: function (p) { return p.is_swing; } },
    whiffs: { label: 'Whiffs', test: function (p) { return p.is_whiff; } },
    called: { label: 'Called strikes', test: function (p) { return p.call_code === 'C'; } },
    inplay: { label: 'Balls in play', test: function (p) { return p.is_in_play; } }
  };
  var EXAMPLES = [
    { id: 592450, name: 'Aaron Judge', role: 'batter' },
    { id: 660271, name: 'Shohei Ohtani', role: 'batter' },
    { id: 694973, name: 'Paul Skenes', role: 'pitcher' },
    { id: 669373, name: 'Tarik Skubal', role: 'pitcher' }
  ];

  var state = {
    players: [], pitches: [], summary: null, pitchTypes: [], barrelZone: [], player: null, role: 'batter',
    pitchColor: {}, hiddenTypes: {}, zoneFilter: 'all',
    sortKey: 'ev', sortDir: -1, showAllBalls: false, loadToken: 0
  };

  var $ = function (id) { return document.getElementById(id); };

  // GET a JSON endpoint on our server; rejects with the server's error message.
  function api(path) {
    return fetch(path).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Server error ' + res.status);
        return body;
      });
    });
  }

  // --- formatting --------------------------------------------------------
  function fmt(v, digits) { return v === null || v === undefined ? '—' : v.toFixed(digits === undefined ? 1 : digits); }
  function pct(v) { return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'; }
  // Rate stats like xBA/xwOBA are shown baseball-style: .312
  function rate3(v) { return v === null || v === undefined ? '—' : v.toFixed(3).replace(/^0/, ''); }
  function signed(v, digits) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(digits === undefined ? 1 : digits); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // --- status -----------------------------------------------------------
  function setStatus(msg, isError) {
    var s = $('sc-status');
    s.textContent = msg;
    s.className = 'sc-status' + (isError ? ' error' : '');
  }

  // --- player list -------------------------------------------------------
  function playerLabel(p) {
    return p.name + ' (' + p.position + (p.team ? ', ' + p.team : '') + ')';
  }

  function loadPlayerList(season) {
    setStatus('Loading ' + season + ' players…');
    return api('/api/players?season=' + season).then(function (players) {
      state.players = players;
      $('sc-player-list').innerHTML = state.players.map(function (p) {
        return '<option value="' + esc(playerLabel(p)) + '"></option>';
      }).join('');
      setStatus('');
    });
  }

  function findPlayer(value) {
    var v = value.trim().toLowerCase();
    if (!v) return null;
    return state.players.find(function (p) { return playerLabel(p).toLowerCase() === v; }) ||
      state.players.find(function (p) { return p.name.toLowerCase() === v; }) ||
      state.players.find(function (p) { return p.name.toLowerCase().indexOf(v) !== -1; }) || null;
  }

  // --- URL state (so a view can be bookmarked or shared) ------------------
  function readHash() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var parts = kv.split('=');
      if (parts[0]) out[parts[0]] = decodeURIComponent(parts[1] || '');
    });
    return out;
  }
  function writeHash() {
    if (!state.player) return;
    var h = 'player=' + state.player.id + '&role=' + state.role + '&season=' + $('sc-season').value +
      '&games=' + $('sc-games').value;
    history.replaceState(null, '', '#' + h);
  }

  // --- loading -----------------------------------------------------------
  function load(player, role) {
    var season = $('sc-season').value;
    var gamesWanted = $('sc-games').value;
    var token = ++state.loadToken;
    state.player = player;
    state.role = role;
    state.hiddenTypes = {};
    state.showAllBalls = false;
    $('sc-search').value = playerLabel(player);
    setRoleButtons(role);
    writeHash();
    $('sc-results').hidden = true;
    setStatus('Loading ' + player.name + '’s pitch data…' + (gamesWanted === 'all' ? ' (a full season can take a minute)' : ''));

    api('/api/statcast/' + player.id + '?season=' + season + '&role=' + role + '&games=' + gamesWanted).then(function (data) {
      if (token !== state.loadToken) return;
      if (!data.games.length) {
        throw new Error(player.name + ' has no ' + season + ' regular-season games as a ' + role + '.');
      }
      state.games = data.games;
      state.pitches = data.pitches;
      state.summary = data.summary;
      state.pitchTypes = data.pitch_types;
      state.barrelZone = data.barrel_zone;
      state.savant = data.savant_available;
      assignPitchColors();
      setStatus('');
      render();
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      setStatus(err.message || 'Something went wrong loading data.', true);
    });
  }

  // Colors are fixed per pitch type for the whole load (most-used pitch gets
  // the first slot), so filtering never repaints a pitch.
  function assignPitchColors() {
    state.pitchColor = {};
    state.pitchTypes.forEach(function (row, i) {
      state.pitchColor[row.code] = i < PITCH_COLORS.length ? PITCH_COLORS[i] : OTHER_COLOR;
    });
  }

  function outcomeOf(p) {
    if (p.event_type === 'home_run') return OUTCOMES[2];
    return p.is_hit ? OUTCOMES[1] : OUTCOMES[0];
  }

  // --- video ------------------------------------------------------------
  // Statcast files each pitch's broadcast clip under the pitch's playId.
  function videoUrl(p) {
    return p.play_id ? 'https://baseballsavant.mlb.com/sporty-videos?playId=' + encodeURIComponent(p.play_id) : null;
  }
  function openVideo(p) {
    var url = videoUrl(p);
    if (url) window.open(url, '_blank', 'noopener');
  }
  function videoHint(p) {
    return videoUrl(p) ? '<span class="hint">Click to watch video ▶</span>' : '';
  }

  // --- tooltips ----------------------------------------------------------
  function opponentName(p) { return state.role === 'pitcher' ? p.batter : p.pitcher; }

  function describeBall(p) {
    return '<strong>' + esc(p.event || 'In play') + '</strong>' +
      '<span>' + esc(shortDate(p.date)) + ' vs ' + esc(opponentName(p)) + '</span>' +
      '<span>EV ' + fmt(p.ev) + ' mph · LA ' + fmt(p.la, 0) + '°' + (p.dist ? ' · ' + fmt(p.dist, 0) + ' ft' : '') + '</span>' +
      '<span>' + esc(p.pitch_name) + (p.speed ? ' ' + fmt(p.speed) + ' mph' : '') + '</span>' +
      (p.xba !== null ? '<span>xBA ' + rate3(p.xba) + '</span>' : '') +
      (p.is_barrel ? '<span class="tag">Barrel</span>' : '') + videoHint(p);
  }
  function describePitch(p) {
    return '<strong>' + esc(p.pitch_name) + (p.speed ? ' · ' + fmt(p.speed) + ' mph' : '') + '</strong>' +
      '<span>' + esc(p.call_desc) + (p.event ? ' → ' + esc(p.event) : '') + '</span>' +
      '<span>' + esc(shortDate(p.date)) + ' vs ' + esc(opponentName(p)) + ' · count ' + p.balls + '-' + p.strikes + '</span>' +
      (p.spin ? '<span>Spin ' + fmt(p.spin, 0) + ' rpm · IVB ' + fmt(p.ivb) + '" · HB ' + fmt(p.hb) + '"</span>' : '') +
      videoHint(p);
  }

  // --- rendering ---------------------------------------------------------
  function render() {
    var s = state.summary;
    renderHeader(s);
    renderTiles(s);
    renderBattedBallCharts();
    renderPitchCharts();
    renderArsenal();
    renderBallTable();
    $('sc-results').hidden = false;
  }

  function renderHeader(s) {
    var p = state.player, games = state.games;
    $('sc-headshot').hidden = false;
    $('sc-headshot').src = 'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/' + p.id + '/headshot/67/current';
    $('sc-name').textContent = p.name;
    $('sc-meta').textContent = [p.position, p.team, state.role === 'pitcher' ? 'as pitcher' : 'as batter'].filter(Boolean).join(' · ');
    var range = games.length ? shortDate(games[games.length - 1].date) + ' – ' + shortDate(games[0].date) : '';
    $('sc-sample').textContent = games.length + ' games (' + range + ') · ' + s.pa + ' plate appearances · ' +
      s.pitches + ' pitches · ' + s.bbe + ' batted balls';
    $('sc-savant-note').hidden = state.savant;
  }

  function tile(label, value, help) {
    return '<div class="tile" title="' + esc(help) + '"><div class="tile-value">' + value +
      '</div><div class="tile-label">' + esc(label) + '</div></div>';
  }

  function renderTiles(s) {
    var tiles;
    if (state.role === 'pitcher') {
      tiles = [
        tile('Avg velocity', fmt(s.avg_velo) + '<small> mph</small>', 'Average release speed of all pitches'),
        tile('Max velocity', fmt(s.max_velo) + '<small> mph</small>', 'Fastest pitch in the sample'),
        tile('Whiff %', pct(s.whiff), 'Swings and misses ÷ swings'),
        tile('Chase %', pct(s.chase), 'Swings at pitches outside the zone'),
        tile('K %', pct(s.k_rate), 'Strikeouts ÷ plate appearances'),
        tile('BB %', pct(s.bb_rate), 'Walks ÷ plate appearances'),
        tile('Avg EV allowed', fmt(s.avg_ev) + '<small> mph</small>', 'Average exit velocity of batted balls allowed'),
        tile('Hard-hit % allowed', pct(s.hard_hit), 'Batted balls allowed at 95+ mph'),
        tile('Barrel % allowed', pct(s.barrel), 'Batted balls allowed in the barrel zone'),
        tile('Zone %', pct(s.zone), 'Pitches thrown in the strike zone'),
        tile('Run value', signed(s.run_value), 'Runs saved by this pitcher’s pitches (positive = good for the pitcher)'),
        tile('xwOBA allowed', rate3(s.xwoba), 'Expected wOBA allowed, based on quality of contact (actual wOBA ' + rate3(s.woba) + ')'),
        tile('xBA allowed', rate3(s.xba), 'Expected batting average allowed, based on quality of contact')
      ];
    } else {
      tiles = [
        tile('Avg exit velo', fmt(s.avg_ev) + '<small> mph</small>', 'Average exit velocity on batted balls'),
        tile('Max exit velo', fmt(s.max_ev) + '<small> mph</small>', 'Hardest-hit ball in the sample'),
        tile('Avg launch angle', fmt(s.avg_la) + '°', 'Average launch angle on batted balls'),
        tile('Hard-hit %', pct(s.hard_hit), 'Batted balls at 95+ mph'),
        tile('Barrel %', pct(s.barrel), 'Batted balls in the barrel zone'),
        tile('Sweet spot %', pct(s.sweet_spot), 'Batted balls launched 8–32°'),
        tile('Whiff %', pct(s.whiff), 'Swings and misses ÷ swings'),
        tile('Chase %', pct(s.chase), 'Swings at pitches outside the zone'),
        tile('K %', pct(s.k_rate), 'Strikeouts ÷ plate appearances'),
        tile('BB %', pct(s.bb_rate), 'Walks ÷ plate appearances'),
        tile('Run value', signed(s.run_value), 'Runs this batter added (positive = good for the batter)'),
        tile('xwOBA', rate3(s.xwoba), 'Expected wOBA, based on quality of contact (actual wOBA ' + rate3(s.woba) + ')'),
        tile('xBA', rate3(s.xba), 'Expected batting average, based on quality of contact')
      ];
    }
    $('sc-tiles').innerHTML = tiles.join('');
  }

  function battedBalls() { return state.pitches.filter(function (p) { return p.is_batted_ball; }); }

  function outcomeLegend() {
    return OUTCOMES.map(function (o) {
      return '<span class="legend-item"><span class="swatch" style="background:' + o.color + '"></span>' + o.label + '</span>';
    }).join('');
  }

  function renderBattedBallCharts() {
    var balls = battedBalls();
    var colorOf = function (p) { return outcomeOf(p).color; };
    $('sc-bb-legend').innerHTML = outcomeLegend();
    $('sc-bb-title').textContent = state.role === 'pitcher' ? 'Batted balls allowed' : 'Batted balls';
    C.spray($('sc-spray'), balls, colorOf, describeBall, openVideo);
    C.evLa($('sc-evla'), balls, colorOf, describeBall, openVideo, state.barrelZone);
  }

  function pitchLegend() {
    return state.pitchTypes.map(function (row) {
      var off = state.hiddenTypes[row.code];
      return '<button type="button" class="legend-item toggle' + (off ? ' off' : '') + '" data-type="' + esc(row.code) +
        '" aria-pressed="' + !off + '"><span class="swatch" style="background:' + state.pitchColor[row.code] + '"></span>' +
        esc(row.name) + '</button>';
    }).join('');
  }

  function renderPitchCharts() {
    var filter = ZONE_FILTERS[state.zoneFilter];
    var visible = state.pitches.filter(function (p) { return !state.hiddenTypes[p.pitch_type]; });
    var colorOf = function (p) { return state.pitchColor[p.pitch_type] || OTHER_COLOR; };
    $('sc-pitch-legend').innerHTML = pitchLegend();
    C.zone($('sc-zone'), visible.filter(filter.test), colorOf, describePitch, openVideo);
    var moveWrap = $('sc-movement-wrap');
    moveWrap.hidden = state.role !== 'pitcher';
    if (state.role === 'pitcher') C.movement($('sc-movement'), visible, colorOf, describePitch, openVideo);
  }

  function renderArsenal() {
    var rows = state.pitchTypes;
    $('sc-arsenal-title').textContent = state.role === 'pitcher' ? 'Pitch arsenal' : 'Results by pitch type faced';
    $('sc-arsenal').querySelector('tbody').innerHTML = rows.map(function (r) {
      return '<tr><td><span class="swatch" style="background:' + state.pitchColor[r.code] + '"></span>' + esc(r.name) + '</td>' +
        '<td>' + r.count + '</td><td>' + pct(r.usage) + '</td><td>' + fmt(r.velo) + '</td>' +
        '<td>' + fmt(r.spin, 0) + '</td><td>' + fmt(r.ivb) + '</td><td>' + fmt(r.hb) + '</td>' +
        '<td>' + pct(r.whiff) + '</td><td>' + r.bbe + '</td><td>' + fmt(r.ev) + '</td><td>' + pct(r.hard_hit) + '</td>' +
        '<td>' + signed(r.run_value) + '</td><td>' + signed(r.rv_per_100) + '</td><td>' + rate3(r.xwoba) + '</td></tr>';
    }).join('');
  }

  var BALL_COLUMNS = [
    { key: 'date', label: 'Date' },
    { key: 'opp', label: 'Opponent' },
    { key: 'pitch_name', label: 'Pitch' },
    { key: 'speed', label: 'Velo' },
    { key: 'ev', label: 'EV' },
    { key: 'la', label: 'LA' },
    { key: 'dist', label: 'Dist' },
    { key: 'xba', label: 'xBA' },
    { key: 'event', label: 'Result' },
    { key: null, label: 'Video' }
  ];

  function renderBallTable() {
    var balls = battedBalls().map(function (p) {
      return Object.assign({ opp: opponentName(p), barrel: p.is_barrel }, p);
    });
    var k = state.sortKey, dir = state.sortDir;
    balls.sort(function (a, b) {
      var av = a[k], bv = b[k];
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
    var shown = state.showAllBalls ? balls : balls.slice(0, 25);
    var table = $('sc-balls');
    table.querySelector('thead').innerHTML = '<tr>' + BALL_COLUMNS.map(function (c) {
      if (!c.key) return '<th scope="col">' + c.label + '</th>';
      var sorted = c.key === k;
      return '<th scope="col" aria-sort="' + (sorted ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + c.key + '">' + c.label + (sorted ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    table.querySelector('tbody').innerHTML = shown.map(function (p) {
      return '<tr' + (p.barrel ? ' class="barrel"' : '') + '><td>' + esc(shortDate(p.date)) + '</td><td>' + esc(p.opp) +
        '</td><td>' + esc(p.pitch_name) + '</td><td>' + fmt(p.speed) + '</td><td>' + fmt(p.ev) + '</td><td>' + fmt(p.la, 0) +
        '</td><td>' + fmt(p.dist, 0) + '</td><td>' + rate3(p.xba) + '</td><td>' + esc(p.event) + (p.barrel ? ' <span class="tag">Barrel</span>' : '') + '</td><td>' +
        (videoUrl(p) ? '<a href="' + esc(videoUrl(p)) + '" target="_blank" rel="noopener" aria-label="Watch video">▶ Watch</a>' : '—') + '</td></tr>';
    }).join('');
    var more = $('sc-balls-more');
    more.hidden = balls.length <= 25;
    more.textContent = state.showAllBalls ? 'Show top 25' : 'Show all ' + balls.length;
  }

  function setRoleButtons(role) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-role]'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-role') === role);
    });
  }

  // --- wiring ------------------------------------------------------------
  function init() {
    var seasonSel = $('sc-season');
    for (var y = 2026; y >= 2015; y--) seasonSel.add(new Option(y, y));

    api('/api/glossary').then(function (terms) {
      $('sc-glossary').innerHTML = terms.map(function (g) {
        return '<dt>' + esc(g.term) + '</dt><dd>' + esc(g.definition) + '</dd>';
      }).join('');
    }).catch(function () {});

    $('sc-examples').innerHTML = EXAMPLES.map(function (e) {
      return '<button type="button" class="chip" data-id="' + e.id + '" data-example-role="' + e.role + '">' + esc(e.name) + '</button>';
    }).join('');

    $('sc-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var p = findPlayer($('sc-search').value);
      if (!p) { setStatus('No player matches “' + $('sc-search').value + '”. Pick one from the list.', true); return; }
      var role = document.querySelector('[data-role][aria-pressed="true"]').getAttribute('data-role');
      load(p, role);
    });

    // Picking from the list sets the natural role (pitchers vs. hitters).
    $('sc-search').addEventListener('change', function () {
      var p = findPlayer(this.value);
      if (p) setRoleButtons(p.is_pitcher ? 'pitcher' : 'batter');
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-role]'), function (b) {
      b.addEventListener('click', function () { setRoleButtons(b.getAttribute('data-role')); });
    });

    $('sc-examples').addEventListener('click', function (e) {
      var b = e.target.closest('[data-id]');
      if (!b) return;
      var p = state.players.find(function (x) { return x.id === +b.getAttribute('data-id'); });
      if (p) load(p, b.getAttribute('data-example-role'));
      else setStatus(b.textContent + ' didn’t play in ' + seasonSel.value + '.', true);
    });

    seasonSel.addEventListener('change', function () {
      loadPlayerList(seasonSel.value).catch(function (err) { setStatus(err.message, true); });
    });

    $('sc-zone-filter').addEventListener('change', function () {
      state.zoneFilter = this.value;
      renderPitchCharts();
    });
    $('sc-pitch-legend').addEventListener('click', function (e) {
      var b = e.target.closest('[data-type]');
      if (!b) return;
      var t = b.getAttribute('data-type');
      state.hiddenTypes[t] = !state.hiddenTypes[t];
      renderPitchCharts();
    });
    $('sc-balls').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sort]');
      if (!b) return;
      var key = b.getAttribute('data-sort');
      state.sortDir = state.sortKey === key ? -state.sortDir : -1;
      state.sortKey = key;
      renderBallTable();
    });
    $('sc-headshot').addEventListener('error', function () { this.hidden = true; });
    $('sc-balls-more').addEventListener('click', function () {
      state.showAllBalls = !state.showAllBalls;
      renderBallTable();
    });

    var h = readHash();
    if (h.season) seasonSel.value = h.season;
    if (h.games) $('sc-games').value = h.games;
    loadPlayerList(seasonSel.value).then(function () {
      var id = +(h.player || EXAMPLES[0].id);
      var p = state.players.find(function (x) { return x.id === id; });
      if (p) load(p, h.role || (p.is_pitcher ? 'pitcher' : 'batter'));
    }).catch(function () {
      setStatus('Couldn’t load players. Make sure the server is running (python app.py) and open http://localhost:8000.', true);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.Statcast);
