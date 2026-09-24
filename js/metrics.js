/* Metric definitions. Each function takes the flat pitch records built in
 * api.js; definitions follow Baseball Savant's published glossary. */
window.Statcast = window.Statcast || {};

(function (S) {
  var SWING_CODES = ['S', 'W', 'M', 'Q', 'T', 'F', 'L', 'O', 'R', 'X', 'D', 'E'];
  var WHIFF_CODES = ['S', 'W', 'M', 'Q'];
  var HIT_EVENTS = ['single', 'double', 'triple', 'home_run'];
  var K_EVENTS = ['strikeout', 'strikeout_double_play'];
  var BB_EVENTS = ['walk', 'intent_walk'];

  function isSwing(p) { return SWING_CODES.indexOf(p.callCode) !== -1; }
  function isWhiff(p) { return WHIFF_CODES.indexOf(p.callCode) !== -1; }
  function isBattedBall(p) { return p.isInPlay && p.ev !== null && p.la !== null; }
  function inZone(p) { return p.zone !== null && p.zone >= 1 && p.zone <= 9; }
  function outOfZone(p) { return p.zone !== null && p.zone > 9; }
  function isHit(p) { return HIT_EVENTS.indexOf(p.eventType) !== -1; }

  // Statcast "barrel": the exit velocity / launch angle combinations that have
  // historically produced at least a .500 AVG and 1.500 SLG. Starts at 98 mph
  // with a 26-30 degree window that widens as EV rises, to 8-50 at 116+ mph.
  function barrelWindow(ev) {
    if (ev < 98) return null;
    var lo = Math.max(8, 26 - (ev - 98));
    var hi = ev < 100 ? 30 + (ev - 98) : Math.min(50, 33 + (ev - 100) * 17 / 16);
    return [lo, hi];
  }
  function isBarrel(p) {
    if (!isBattedBall(p)) return false;
    var w = barrelWindow(p.ev);
    return !!w && p.la >= w[0] && p.la <= w[1];
  }
  function isHardHit(p) { return isBattedBall(p) && p.ev >= 95; }
  function isSweetSpot(p) { return isBattedBall(p) && p.la >= 8 && p.la <= 32; }

  function avg(list, key) {
    var vals = list.map(function (p) { return p[key]; }).filter(function (v) { return v !== null; });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  function max(list, key) {
    var vals = list.map(function (p) { return p[key]; }).filter(function (v) { return v !== null; });
    return vals.length ? Math.max.apply(null, vals) : null;
  }
  function rate(list, test) {
    if (!list.length) return null;
    return list.filter(test).length / list.length;
  }

  function summarize(pitches) {
    var bbe = pitches.filter(isBattedBall);
    var swings = pitches.filter(isSwing);
    var chaseOpps = pitches.filter(outOfZone);
    var zonePitches = pitches.filter(inZone);
    var paEnds = pitches.filter(function (p) { return p.eventType; });
    return {
      pitches: pitches.length,
      pa: paEnds.length,
      bbe: bbe.length,
      avgEV: avg(bbe, 'ev'),
      maxEV: max(bbe, 'ev'),
      avgLA: avg(bbe, 'la'),
      hardHit: rate(bbe, isHardHit),
      barrel: rate(bbe, isBarrel),
      sweetSpot: rate(bbe, isSweetSpot),
      whiff: rate(swings, isWhiff),
      chase: rate(chaseOpps, isSwing),
      zoneSwing: rate(zonePitches, isSwing),
      zone: pitches.filter(function (p) { return p.zone !== null; }).length
        ? zonePitches.length / pitches.filter(function (p) { return p.zone !== null; }).length : null,
      kRate: rate(paEnds, function (p) { return K_EVENTS.indexOf(p.eventType) !== -1; }),
      bbRate: rate(paEnds, function (p) { return BB_EVENTS.indexOf(p.eventType) !== -1; }),
      avgVelo: avg(pitches, 'speed'),
      maxVelo: max(pitches, 'speed')
    };
  }

  // One row per pitch type, most-used first.
  function byPitchType(pitches) {
    var groups = {};
    pitches.forEach(function (p) {
      (groups[p.pitchType] = groups[p.pitchType] || []).push(p);
    });
    return Object.keys(groups).map(function (code) {
      var list = groups[code];
      var bbe = list.filter(isBattedBall);
      return {
        code: code,
        name: list[0].pitchName,
        count: list.length,
        usage: list.length / pitches.length,
        velo: avg(list, 'speed'),
        spin: avg(list, 'spin'),
        ivb: avg(list, 'ivb'),
        hb: avg(list, 'hb'),
        whiff: rate(list.filter(isSwing), isWhiff),
        bbe: bbe.length,
        ev: avg(bbe, 'ev'),
        hardHit: rate(bbe, isHardHit)
      };
    }).sort(function (a, b) { return b.count - a.count; });
  }

  var GLOSSARY = [
    ['Exit Velocity (EV)', 'How fast the ball comes off the bat, in mph. Harder-hit balls become hits far more often.'],
    ['Launch Angle (LA)', 'The vertical angle the ball leaves the bat. Below 10° is a ground ball, 10–25° a line drive, 25–50° a fly ball, above 50° a pop-up.'],
    ['Hard-Hit %', 'Share of batted balls hit 95 mph or harder — the speed where outcomes start to improve sharply.'],
    ['Barrel %', 'Share of batted balls with the ideal EV + LA combination (starting at 98 mph and 26–30°). Barrels historically hit at least .500 with a 1.500 slugging percentage.'],
    ['Sweet Spot %', 'Share of batted balls launched between 8° and 32° — the band that produces the most line drives.'],
    ['Whiff %', 'Swings and misses divided by total swings.'],
    ['Chase %', 'How often the batter swings at pitches outside the strike zone.'],
    ['Zone %', 'Share of pitches thrown inside the strike zone.'],
    ['Spin Rate', 'How fast the pitch spins, in revolutions per minute. More spin generally means more movement.'],
    ['Induced Vertical Break (IVB)', 'How many inches a pitch rises or drops compared with a spinless pitch, ignoring gravity. High-IVB fastballs appear to "rise".'],
    ['Horizontal Break (HB)', 'Side-to-side movement in inches, measured from the catcher’s view.'],
    ['Extension', 'How far in front of the rubber the pitcher releases the ball, in feet. More extension makes a pitch look faster.']
  ];

  S.metrics = {
    summarize: summarize,
    byPitchType: byPitchType,
    isBattedBall: isBattedBall,
    isBarrel: isBarrel,
    isHardHit: isHardHit,
    isSwing: isSwing,
    isWhiff: isWhiff,
    isHit: isHit,
    barrelWindow: barrelWindow,
    GLOSSARY: GLOSSARY
  };
})(window.Statcast);
