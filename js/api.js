/* Data layer: talks to the public MLB Stats API (statsapi.mlb.com), which
 * serves the same pitch-tracking (Statcast) numbers Baseball Savant uses and,
 * unlike Savant's CSV export, allows requests from a browser page. */
window.Statcast = window.Statcast || {};

(function (S) {
  var BASE = 'https://statsapi.mlb.com/api';
  var memo = {};

  function getJSON(path) {
    if (!memo[path]) {
      memo[path] = fetch(BASE + path).then(function (res) {
        if (!res.ok) throw new Error('MLB API ' + res.status + ' for ' + path);
        return res.json();
      }).catch(function (err) {
        delete memo[path];
        throw err;
      });
    }
    return memo[path];
  }

  // Every MLB player on a roster during the season (~1,500 people).
  function fetchPlayers(season) {
    return getJSON('/v1/sports/1/players?season=' + season).then(function (data) {
      return (data.people || []).map(function (p) {
        var pos = p.primaryPosition || {};
        return {
          id: p.id,
          name: p.fullName,
          position: pos.abbreviation || '',
          isPitcher: pos.type === 'Pitcher' || pos.abbreviation === 'P',
          teamId: p.currentTeam ? p.currentTeam.id : null
        };
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    });
  }

  function fetchTeams(season) {
    return getJSON('/v1/teams?sportId=1&season=' + season).then(function (data) {
      var byId = {};
      (data.teams || []).forEach(function (t) { byId[t.id] = t.abbreviation; });
      return byId;
    });
  }

  // One row per game the player appeared in, newest first.
  function fetchGameLog(playerId, season, role) {
    var group = role === 'pitcher' ? 'pitching' : 'hitting';
    return getJSON('/v1/people/' + playerId + '/stats?stats=gameLog&group=' + group +
      '&season=' + season + '&gameType=R').then(function (data) {
      var splits = (data.stats && data.stats[0] && data.stats[0].splits) || [];
      return splits.map(function (s) {
        return {
          gamePk: s.game.gamePk,
          date: s.date,
          opponent: s.opponent ? s.opponent.name : '',
          isHome: s.isHome
        };
      }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    });
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  // Flattens a game's play-by-play into one record per pitch that involved
  // the player (as batter or pitcher).
  function extractPitches(pbp, game, playerId, role) {
    var out = [];
    (pbp.allPlays || []).forEach(function (play) {
      var m = play.matchup || {};
      var who = role === 'pitcher' ? m.pitcher : m.batter;
      if (!who || who.id !== playerId) return;

      var pitches = (play.playEvents || []).filter(function (e) { return e.isPitch; });
      pitches.forEach(function (e, i) {
        var d = e.details || {};
        var pd = e.pitchData || {};
        var br = pd.breaks || {};
        var co = pd.coordinates || {};
        var hd = e.hitData || {};
        var hc = hd.coordinates || {};
        var last = i === pitches.length - 1;
        out.push({
          gamePk: game.gamePk,
          date: game.date,
          opponent: game.opponent,
          inning: play.about ? play.about.inning : null,
          playId: e.playId || null, // Statcast pitch id; also keys the pitch's video
          paId: game.gamePk + '-' + (play.about ? play.about.atBatIndex : ''),
          batter: m.batter ? m.batter.fullName : '',
          pitcher: m.pitcher ? m.pitcher.fullName : '',
          batSide: m.batSide ? m.batSide.code : '',
          pitchHand: m.pitchHand ? m.pitchHand.code : '',
          balls: e.count ? e.count.balls : null,
          strikes: e.count ? e.count.strikes : null,
          pitchType: d.type ? d.type.code : 'UN',
          pitchName: d.type ? d.type.description : 'Unknown',
          callCode: d.call ? d.call.code : (d.code || ''),
          callDesc: d.call ? d.call.description : (d.description || ''),
          isInPlay: !!d.isInPlay,
          speed: num(pd.startSpeed),
          spin: num(br.spinRate),
          ivb: num(br.breakVerticalInduced),
          hb: num(br.breakHorizontal),
          extension: num(pd.extension),
          px: num(co.pX),
          pz: num(co.pZ),
          szTop: num(pd.strikeZoneTop),
          szBot: num(pd.strikeZoneBottom),
          zone: num(pd.zone),
          ev: num(hd.launchSpeed),
          la: num(hd.launchAngle),
          dist: num(hd.totalDistance),
          trajectory: hd.trajectory || '',
          hcX: num(hc.coordX),
          hcY: num(hc.coordY),
          // The plate appearance's result belongs to its final pitch.
          event: last && play.result ? (play.result.event || '') : '',
          eventType: last && play.result ? (play.result.eventType || '') : '',
          description: last && play.result ? (play.result.description || '') : ''
        });
      });
    });
    return out;
  }

  // Loads pitches from a list of games, a few requests at a time.
  function fetchPitches(games, playerId, role, onProgress) {
    var results = new Array(games.length);
    var next = 0;
    var done = 0;
    function worker() {
      if (next >= games.length) return Promise.resolve();
      var idx = next++;
      var game = games[idx];
      return getJSON('/v1/game/' + game.gamePk + '/playByPlay').then(function (pbp) {
        results[idx] = extractPitches(pbp, game, playerId, role);
      }, function () {
        results[idx] = []; // skip a game that fails to load rather than abort
      }).then(function () {
        done++;
        if (onProgress) onProgress(done, games.length);
        return worker();
      });
    }
    var workers = [];
    for (var i = 0; i < Math.min(6, games.length); i++) workers.push(worker());
    return Promise.all(workers).then(function () {
      return [].concat.apply([], results);
    });
  }

  S.api = {
    fetchPlayers: fetchPlayers,
    fetchTeams: fetchTeams,
    fetchGameLog: fetchGameLog,
    fetchPitches: fetchPitches,
    extractPitches: extractPitches
  };
})(window.Statcast);
