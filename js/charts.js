/* Hand-built SVG charts (no libraries). Every dot gets a data-i attribute
 * pointing into the chart's record list so one shared tooltip can describe it. */
window.Statcast = window.Statcast || {};

(function (S) {
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(node);
    return node;
  }
  function text(parent, x, y, str, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls || 'axis-label', 'text-anchor': anchor || 'middle' }, parent);
    t.textContent = str;
    return t;
  }
  function scale(d0, d1, r0, r1) {
    return function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
  }
  function svgRoot(container, w, h, label) {
    container.innerHTML = '';
    return el('svg', { viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label': label }, container);
  }

  // Shared tooltip (and optional click handler): attach once per chart container.
  function bindTooltip(container, records, describe, onPick) {
    var tip = document.getElementById('sc-tooltip');
    container.onpointermove = function (e) {
      var i = e.target.getAttribute && e.target.getAttribute('data-i');
      if (i === null || i === undefined) { tip.hidden = true; return; }
      tip.innerHTML = describe(records[+i]);
      tip.hidden = false;
      var x = e.clientX + 14, y = e.clientY + 14;
      var r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    };
    container.onpointerleave = function () { tip.hidden = true; };
    container.onclick = function (e) {
      var i = e.target.getAttribute && e.target.getAttribute('data-i');
      if (i !== null && i !== undefined && onPick) onPick(records[+i]);
    };
  }

  // Smaller dots once a chart gets crowded (e.g. a full season of pitches).
  var dotRadius = 4.5;
  function sizeFor(n) { dotRadius = n > 1500 ? 2.5 : n > 400 ? 3.5 : 4.5; }

  function dot(parent, x, y, color, i) {
    return el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: dotRadius, fill: color, 'class': 'dot', 'data-i': i }, parent);
  }

  // --- Spray chart -------------------------------------------------------
  // Uses MLB's Gameday hit coordinates: home plate sits near (125, 199) and
  // one unit is roughly 2.5 feet.
  var HOME = { x: 125, y: 199 };
  var FT = 1 / 2.5;

  function fieldPoint(angleDeg, feet) {
    var a = angleDeg * Math.PI / 180;
    return { x: HOME.x + Math.sin(a) * feet * FT, y: HOME.y - Math.cos(a) * feet * FT };
  }

  function sprayChart(container, balls, colorOf, describe, onPick) {
    sizeFor(balls.length);
    var svg = svgRoot(container, 250, 215, 'Spray chart of batted balls');
    var g = el('g', { transform: 'translate(0,8)' }, svg);
    // Outfield wall: 330 ft down the lines to 400 ft in center.
    var wall = [];
    for (var a = -45; a <= 45; a += 3) wall.push(fieldPoint(a, 330 + 70 * Math.cos(a * 2 * Math.PI / 180)));
    var path = 'M' + HOME.x + ',' + HOME.y + wall.map(function (p) { return ' L' + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join('') + ' Z';
    el('path', { d: path, 'class': 'field-grass' }, g);
    var infield = [];
    for (var b = -45; b <= 45; b += 5) infield.push(fieldPoint(b, 155));
    el('path', { d: 'M' + HOME.x + ',' + HOME.y + infield.map(function (p) { return ' L' + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join('') + ' Z', 'class': 'field-dirt' }, g);
    var bases = [fieldPoint(45, 90), fieldPoint(0, 127.3), fieldPoint(-45, 90)];
    el('path', { d: 'M' + HOME.x + ',' + HOME.y + bases.map(function (p) { return ' L' + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join('') + ' Z', 'class': 'field-line' }, g);
    [330, 400].forEach(function (ft) {
      var p = fieldPoint(ft === 400 ? 0 : -45, ft);
      text(g, p.x + (ft === 400 ? 0 : -2), p.y - 4, ft + ' ft', 'axis-label small', ft === 400 ? 'middle' : 'start');
    });
    balls.forEach(function (p, i) {
      if (p.hcX === null || p.hcY === null) return;
      dot(g, p.hcX, p.hcY, colorOf(p), i);
    });
    bindTooltip(container, balls, describe, onPick);
  }

  // --- Exit velocity vs launch angle --------------------------------------
  function evLaChart(container, balls, colorOf, describe, onPick) {
    sizeFor(balls.length);
    var W = 360, H = 260, m = { l: 44, r: 12, t: 12, b: 36 };
    var svg = svgRoot(container, W, H, 'Exit velocity versus launch angle');
    var x = scale(-60, 80, m.l, W - m.r);
    var y = scale(40, 120, H - m.b, m.t);
    [-60, -40, -20, 0, 20, 40, 60, 80].forEach(function (v) {
      el('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, 'class': 'grid' }, svg);
      text(svg, x(v), H - m.b + 14, v + '°');
    });
    [40, 60, 80, 100, 120].forEach(function (v) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), 'class': 'grid' }, svg);
      text(svg, m.l - 6, y(v) + 4, v, 'axis-label', 'end');
    });
    // Barrel zone
    var upper = [], lower = [];
    for (var ev = 98; ev <= 120; ev += 1) {
      var w = S.metrics.barrelWindow(ev);
      lower.push(x(w[0]).toFixed(1) + ',' + y(ev).toFixed(1));
      upper.unshift(x(w[1]).toFixed(1) + ',' + y(ev).toFixed(1));
    }
    el('polygon', { points: lower.concat(upper).join(' '), 'class': 'barrel-zone' }, svg);
    text(svg, x(28), y(111), 'Barrel zone', 'zone-label');
    el('line', { x1: m.l, x2: W - m.r, y1: y(95), y2: y(95), 'class': 'ref-line' }, svg);
    text(svg, W - m.r - 2, y(95) - 4, 'Hard hit (95+ mph)', 'zone-label', 'end');
    text(svg, (m.l + W - m.r) / 2, H - 4, 'Launch angle');
    var yl = text(svg, 12, (m.t + H - m.b) / 2, 'Exit velocity (mph)');
    yl.setAttribute('transform', 'rotate(-90 12 ' + (m.t + H - m.b) / 2 + ')');
    balls.forEach(function (p, i) {
      if (p.la < -60 || p.la > 80 || p.ev < 40) return;
      dot(svg, x(p.la), y(Math.min(p.ev, 120)), colorOf(p), i);
    });
    bindTooltip(container, balls, describe, onPick);
  }

  // --- Strike zone (catcher's view) ---------------------------------------
  function zoneChart(container, pitches, colorOf, describe, onPick) {
    sizeFor(pitches.length);
    var W = 300, H = 320, m = { l: 30, r: 10, t: 10, b: 30 };
    var svg = svgRoot(container, W, H, 'Pitch locations from the catcher’s view');
    // Keep feet square: 5 ft wide (-2.5..2.5), 5.5 ft tall (-0.25..5.25)
    var x = scale(-2.5, 2.5, m.l, W - m.r);
    var y = scale(-0.25, 5.25, H - m.b, m.t);
    var tops = pitches.map(function (p) { return p.szTop; }).filter(Boolean);
    var bots = pitches.map(function (p) { return p.szBot; }).filter(Boolean);
    var top = tops.length ? tops.reduce(function (a, b) { return a + b; }) / tops.length : 3.4;
    var bot = bots.length ? bots.reduce(function (a, b) { return a + b; }) / bots.length : 1.6;
    var half = 17 / 24; // plate is 17 inches wide
    el('rect', { x: x(-half), y: y(top), width: x(half) - x(-half), height: y(bot) - y(top), 'class': 'zone-box' }, svg);
    for (var k = 1; k < 3; k++) {
      var vx = -half + k * 2 * half / 3;
      var hz = bot + k * (top - bot) / 3;
      el('line', { x1: x(vx), x2: x(vx), y1: y(top), y2: y(bot), 'class': 'zone-grid' }, svg);
      el('line', { x1: x(-half), x2: x(half), y1: y(hz), y2: y(hz), 'class': 'zone-grid' }, svg);
    }
    // Home plate
    var py = y(-0.05);
    el('polygon', {
      points: [x(-half), py, x(half), py, x(half), py + 5, x(0), py + 10, x(-half), py + 5].join(' '),
      'class': 'plate'
    }, svg);
    text(svg, W / 2, H - 4, 'Catcher’s view', 'axis-label small');
    pitches.forEach(function (p, i) {
      if (p.px === null || p.pz === null) return;
      if (Math.abs(p.px) > 2.5 || p.pz < -0.25 || p.pz > 5.25) return;
      dot(svg, x(p.px), y(p.pz), colorOf(p), i);
    });
    bindTooltip(container, pitches, describe, onPick);
  }

  // --- Pitch movement ----------------------------------------------------
  function movementChart(container, pitches, colorOf, describe, onPick) {
    sizeFor(pitches.length);
    var W = 320, H = 320, m = { l: 40, r: 12, t: 12, b: 36 };
    var svg = svgRoot(container, W, H, 'Pitch movement: horizontal versus induced vertical break');
    var x = scale(-25, 25, m.l, W - m.r);
    var y = scale(-25, 25, H - m.b, m.t);
    [-20, -10, 0, 10, 20].forEach(function (v) {
      el('line', { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, 'class': v === 0 ? 'axis' : 'grid' }, svg);
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), 'class': v === 0 ? 'axis' : 'grid' }, svg);
      text(svg, x(v), H - m.b + 14, v + '"');
      text(svg, m.l - 6, y(v) + 4, v + '"', 'axis-label', 'end');
    });
    text(svg, (m.l + W - m.r) / 2, H - 4, 'Horizontal break (in, catcher’s view)');
    var yl = text(svg, 12, (m.t + H - m.b) / 2, 'Induced vertical break (in)');
    yl.setAttribute('transform', 'rotate(-90 12 ' + (m.t + H - m.b) / 2 + ')');
    pitches.forEach(function (p, i) {
      if (p.hb === null || p.ivb === null) return;
      if (Math.abs(p.hb) > 25 || Math.abs(p.ivb) > 25) return;
      dot(svg, x(p.hb), y(p.ivb), colorOf(p), i);
    });
    bindTooltip(container, pitches, describe, onPick);
  }

  S.charts = {
    spray: sprayChart,
    evLa: evLaChart,
    zone: zoneChart,
    movement: movementChart
  };
})(window.Statcast);
