/* Page controller: reads the controls, loads data, and renders every panel. */
(function (S) {
  var API = S.api, M = S.metrics, C = S.charts;

  var PITCH_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var OTHER_COLOR = '#898781';
  var OUTCOMES = [
    { key: 'out', label: 'Out', color: '#898781' },
    { key: 'hit', label: 'Hit', color: '#2a78d6' },
    { key: 'hr', label: 'Home run', color: '#eb6834' }
  ];
  var ZONE_FILTERS = {
    all: { label: 'All pitches', test: function () { return true; } },
    swings: { label: 'Swings', test: M.isSwing },
    whiffs: { label: 'Whiffs', test: M.isWhiff },
    called: { label: 'Called strikes', test: function (p) { return p.callCode === 'C'; } },
    inplay: { label: 'Balls in play', test: function (p) { return p.isInPlay; } }
  };
  var EXAMPLES = [
    { id: 592450, name: 'Aaron Judge', role: 'batter' },
    { id: 660271, name: 'Shohei Ohtani', role: 'batter' },
    { id: 694973, name: 'Paul Skenes', role: 'pitcher' },
    { id: 669373, name: 'Tarik Skubal', role: 'pitcher' }
  ];

  var state = {
    players: [], teams: {}, pitches: [], player: null, role: 'batter',
    pitchColor: {}, hiddenTypes: {}, zoneFilter: 'all',
    sortKey: 'ev', sortDir: -1, showAllBalls: false, loadToken: 0
  };

  var $ = function (id) { return document.getElementById(id); };

  // --- formatting --------------------------------------------------------
  function fmt(v, digits) { return v === null || v === undefined ? '—' : v.toFixed(digits === undefined ? 1 : digits); }
  function pct(v) { return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%'; }
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
    var team = state.teams[p.teamId];
    return p.name + ' (' + p.position + (team ? ', ' + team : '') + ')';
  }

  function loadPlayerList(season) {
    setStatus('Loading ' + season + ' players…');
    return Promise.all([API.fetchPlayers(season), API.fetchTeams(season)]).then(function (res) {
      state.players = res[0];
      state.teams = res[1];
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
    setStatus('Finding ' + player.name + '’s ' + season + ' games…');

    API.fetchGameLog(player.id, season, role).then(function (games) {
      if (token !== state.loadToken) return null;
      if (!games.length) {
        throw new Error(player.name + ' has no ' + season + ' regular-season games as a ' + role + '.');
      }
      if (gamesWanted !== 'all') games = games.slice(0, +gamesWanted);
      state.games = games;
      return API.fetchPitches(games, player.id, role, function (done, total) {
        if (token === state.loadToken) setStatus('Loading pitch data… ' + done + ' / ' + total + ' games');
      });
    }).then(function (pitches) {
      if (!pitches || token !== state.loadToken) return;
      state.pitches = pitches;
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
    M.byPitchType(state.pitches).forEach(function (row, i) {
      state.pitchColor[row.code] = i < PITCH_COLORS.length ? PITCH_COLORS[i] : OTHER_COLOR;
    });
  }

  function outcomeOf(p) {
    if (p.eventType === 'home_run') return OUTCOMES[2];
    return M.isHit(p) ? OUTCOMES[1] : OUTCOMES[0];
  }

  // --- tooltips ----------------------------------------------------------
  function opponentName(p) { return state.role === 'pitcher' ? p.batter : p.pitcher; }

  function describeBall(p) {
    return '<strong>' + esc(p.event || 'In play') + '</strong>' +
      '<span>' + esc(shortDate(p.date)) + ' vs ' + esc(opponentName(p)) + '</span>' +
      '<span>EV ' + fmt(p.ev) + ' mph · LA ' + fmt(p.la, 0) + '°' + (p.dist ? ' · ' + fmt(p.dist, 0) + ' ft' : '') + '</span>' +
      '<span>' + esc(p.pitchName) + (p.speed ? ' ' + fmt(p.speed) + ' mph' : '') + '</span>' +
      (M.isBarrel(p) ? '<span class="tag">Barrel</span>' : '');
  }
  function describePitch(p) {
    return '<strong>' + esc(p.pitchName) + (p.speed ? ' · ' + fmt(p.speed) + ' mph' : '') + '</strong>' +
      '<span>' + esc(p.callDesc) + (p.event ? ' → ' + esc(p.event) : '') + '</span>' +
      '<span>' + esc(shortDate(p.date)) + ' vs ' + esc(opponentName(p)) + ' · count ' + p.balls + '-' + p.strikes + '</span>' +
      (p.spin ? '<span>Spin ' + fmt(p.spin, 0) + ' rpm · IVB ' + fmt(p.ivb) + '" · HB ' + fmt(p.hb) + '"</span>' : '');
  }

  // --- rendering ---------------------------------------------------------
  function render() {
    var s = M.summarize(state.pitches);
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
    var team = state.teams[p.teamId];
    $('sc-meta').textContent = [p.position, team, state.role === 'pitcher' ? 'as pitcher' : 'as batter'].filter(Boolean).join(' · ');
    var range = games.length ? shortDate(games[games.length - 1].date) + ' – ' + shortDate(games[0].date) : '';
    $('sc-sample').textContent = games.length + ' games (' + range + ') · ' + s.pa + ' plate appearances · ' +
      s.pitches + ' pitches · ' + s.bbe + ' batted balls';
  }

  function tile(label, value, help) {
    return '<div class="tile" title="' + esc(help) + '"><div class="tile-value">' + value +
      '</div><div class="tile-label">' + esc(label) + '</div></div>';
  }

  function renderTiles(s) {
    var tiles;
    if (state.role === 'pitcher') {
      tiles = [
        tile('Avg velocity', fmt(s.avgVelo) + '<small> mph</small>', 'Average release speed of all pitches'),
        tile('Max velocity', fmt(s.maxVelo) + '<small> mph</small>', 'Fastest pitch in the sample'),
        tile('Whiff %', pct(s.whiff), 'Swings and misses ÷ swings'),
        tile('Chase %', pct(s.chase), 'Swings at pitches outside the zone'),
        tile('K %', pct(s.kRate), 'Strikeouts ÷ plate appearances'),
        tile('BB %', pct(s.bbRate), 'Walks ÷ plate appearances'),
        tile('Avg EV allowed', fmt(s.avgEV) + '<small> mph</small>', 'Average exit velocity of batted balls allowed'),
        tile('Hard-hit % allowed', pct(s.hardHit), 'Batted balls allowed at 95+ mph'),
        tile('Barrel % allowed', pct(s.barrel), 'Batted balls allowed in the barrel zone'),
        tile('Zone %', pct(s.zone), 'Pitches thrown in the strike zone')
      ];
    } else {
      tiles = [
        tile('Avg exit velo', fmt(s.avgEV) + '<small> mph</small>', 'Average exit velocity on batted balls'),
        tile('Max exit velo', fmt(s.maxEV) + '<small> mph</small>', 'Hardest-hit ball in the sample'),
        tile('Avg launch angle', fmt(s.avgLA) + '°', 'Average launch angle on batted balls'),
        tile('Hard-hit %', pct(s.hardHit), 'Batted balls at 95+ mph'),
        tile('Barrel %', pct(s.barrel), 'Batted balls in the barrel zone'),
        tile('Sweet spot %', pct(s.sweetSpot), 'Batted balls launched 8–32°'),
        tile('Whiff %', pct(s.whiff), 'Swings and misses ÷ swings'),
        tile('Chase %', pct(s.chase), 'Swings at pitches outside the zone'),
        tile('K %', pct(s.kRate), 'Strikeouts ÷ plate appearances'),
        tile('BB %', pct(s.bbRate), 'Walks ÷ plate appearances')
      ];
    }
    $('sc-tiles').innerHTML = tiles.join('');
  }

  function battedBalls() { return state.pitches.filter(M.isBattedBall); }

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
    C.spray($('sc-spray'), balls, colorOf, describeBall);
    C.evLa($('sc-evla'), balls, colorOf, describeBall);
  }

  function pitchLegend() {
    return M.byPitchType(state.pitches).map(function (row) {
      var off = state.hiddenTypes[row.code];
      return '<button type="button" class="legend-item toggle' + (off ? ' off' : '') + '" data-type="' + esc(row.code) +
        '" aria-pressed="' + !off + '"><span class="swatch" style="background:' + state.pitchColor[row.code] + '"></span>' +
        esc(row.name) + '</button>';
    }).join('');
  }

  function renderPitchCharts() {
    var filter = ZONE_FILTERS[state.zoneFilter];
    var visible = state.pitches.filter(function (p) { return !state.hiddenTypes[p.pitchType]; });
    var colorOf = function (p) { return state.pitchColor[p.pitchType] || OTHER_COLOR; };
    $('sc-pitch-legend').innerHTML = pitchLegend();
    C.zone($('sc-zone'), visible.filter(filter.test), colorOf, describePitch);
    var moveWrap = $('sc-movement-wrap');
    moveWrap.hidden = state.role !== 'pitcher';
    if (state.role === 'pitcher') C.movement($('sc-movement'), visible, colorOf, describePitch);
  }

  function renderArsenal() {
    var rows = M.byPitchType(state.pitches);
    $('sc-arsenal-title').textContent = state.role === 'pitcher' ? 'Pitch arsenal' : 'Results by pitch type faced';
    $('sc-arsenal').querySelector('tbody').innerHTML = rows.map(function (r) {
      return '<tr><td><span class="swatch" style="background:' + state.pitchColor[r.code] + '"></span>' + esc(r.name) + '</td>' +
        '<td>' + r.count + '</td><td>' + pct(r.usage) + '</td><td>' + fmt(r.velo) + '</td>' +
        '<td>' + fmt(r.spin, 0) + '</td><td>' + fmt(r.ivb) + '</td><td>' + fmt(r.hb) + '</td>' +
        '<td>' + pct(r.whiff) + '</td><td>' + r.bbe + '</td><td>' + fmt(r.ev) + '</td><td>' + pct(r.hardHit) + '</td></tr>';
    }).join('');
  }

  var BALL_COLUMNS = [
    { key: 'date', label: 'Date' },
    { key: 'opp', label: 'Opponent' },
    { key: 'pitchName', label: 'Pitch' },
    { key: 'speed', label: 'Velo' },
    { key: 'ev', label: 'EV' },
    { key: 'la', label: 'LA' },
    { key: 'dist', label: 'Dist' },
    { key: 'event', label: 'Result' }
  ];

  function renderBallTable() {
    var balls = battedBalls().map(function (p) {
      return Object.assign({ opp: opponentName(p), barrel: M.isBarrel(p) }, p);
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
      var sorted = c.key === k;
      return '<th scope="col" aria-sort="' + (sorted ? (dir > 0 ? 'ascending' : 'descending') : 'none') + '">' +
        '<button type="button" data-sort="' + c.key + '">' + c.label + (sorted ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    table.querySelector('tbody').innerHTML = shown.map(function (p) {
      return '<tr' + (p.barrel ? ' class="barrel"' : '') + '><td>' + esc(shortDate(p.date)) + '</td><td>' + esc(p.opp) +
        '</td><td>' + esc(p.pitchName) + '</td><td>' + fmt(p.speed) + '</td><td>' + fmt(p.ev) + '</td><td>' + fmt(p.la, 0) +
        '</td><td>' + fmt(p.dist, 0) + '</td><td>' + esc(p.event) + (p.barrel ? ' <span class="tag">Barrel</span>' : '') + '</td></tr>';
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

    $('sc-glossary').innerHTML = M.GLOSSARY.map(function (g) {
      return '<dt>' + esc(g[0]) + '</dt><dd>' + esc(g[1]) + '</dd>';
    }).join('');

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
      if (p) setRoleButtons(p.isPitcher ? 'pitcher' : 'batter');
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
      if (p) load(p, h.role || (p.isPitcher ? 'pitcher' : 'batter'));
    }).catch(function () {
      setStatus('Couldn’t reach the MLB Stats API. Check your connection and reload.', true);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.Statcast);
