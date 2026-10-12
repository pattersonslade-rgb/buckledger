/* Buck Ledger Movement Simulator (Elite).
 * A simple, transparent model of where a whitetail buck is LIKELY to be on a property, by hour,
 * built from published GPS-collar research averages plus clearly labeled assumptions.
 * It is a thinking tool, not a forecast. Rules + sources: see buckledger-sim-research.md.
 * Self-contained: window.BuckSim.mount(el, host). No network, no dependencies. */
(function () {
  'use strict';
  var COLS = 20, ROWS = 26, N = COLS * ROWS;
  var ZONES = {
    '.': { name: 'Open / mixed', color: '#d8cfa6' },
    'B': { name: 'Bedding cover', color: '#4d6a37' },
    'F': { name: 'Food plot / ag field', color: '#c3c957' },
    'W': { name: 'Water', color: '#3f86c0' },
    'C': { name: 'Creek / slough', color: '#79acd6' },
    'N': { name: 'Funnel / pinch', color: '#9b7440' },
    'R': { name: 'Road / trail', color: '#9d9d98' },
    'X': { name: 'Neighbor boundary', color: '#c8553d' }
  };
  var ZKEYS = Object.keys(ZONES);
  var SEASONS = [
    { id: 'early', label: 'Early season' }, { id: 'prerut', label: 'Pre-rut' },
    { id: 'rut', label: 'Rut' }, { id: 'postrut', label: 'Post-rut' }
  ];
  var WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  var MAX_STANDS = 12, MAX_CAMS = 20;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, lo, hi, d) { v = Number(v); return isFinite(v) && v >= lo && v <= hi ? v : d; }

  /* ---------- example property (clearly labeled; not anyone's real land) ---------- */
  function example() {
    var g = []; for (var i = 0; i < N; i++) g.push('.');
    function rect(x0, y0, x1, y1, z) { for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < COLS && y < ROWS) g[y * COLS + x] = z; }
    rect(0, 0, 19, 0, 'X');                    // neighbor line north
    rect(1, 2, 7, 8, 'B');                     // NW bedding thicket
    rect(12, 15, 18, 21, 'B');                 // SE bedding (cedar/CRP)
    rect(11, 3, 17, 8, 'F');                   // NE ag field
    rect(2, 16, 7, 20, 'F');                   // SW food plot
    for (var y = 1; y < ROWS; y++) { var x = Math.round(9 + 2.2 * Math.sin(y / 4)); g[y * COLS + x] = 'C'; }   // creek N-S
    rect(8, 11, 11, 12, 'N');                  // creek-crossing funnel
    rect(13, 11, 14, 13, 'N');                 // saddle between field + SE bedding
    rect(0, 24, 19, 24, 'R');                  // county road south
    rect(15, 9, 15, 23, 'R');                  // farm lane
    rect(4, 11, 5, 12, 'W');                   // pond
    rect(0, 25, 19, 25, 'X');
    return {
      v: 1, name: 'Example: 160-acre farm', example: true, acres: 160, cols: COLS, rows: ROWS, cells: g.join(''),
      stands: [{ x: 8, y: 9, name: 'Creek Stand' }, { x: 12, y: 13, name: 'Saddle' }, { x: 10, y: 6, name: 'Field Edge' }, { x: 6, y: 15, name: 'Plot Box' }],
      cams: []
    };
  }
  function blank() { var c = ''; for (var i = 0; i < N; i++) c += '.'; return { v: 1, name: 'My property', example: false, acres: 80, cols: COLS, rows: ROWS, cells: c, stands: [], cams: [] }; }
  // Sanitize anything that comes from storage or a backup file.
  function clean(m) {
    if (!m || typeof m !== 'object') return null;
    var cells = typeof m.cells === 'string' ? m.cells : '';
    if (cells.length !== N) return null;
    cells = cells.replace(/[^.BFWCNRX]/g, '.');
    function pt(o) { return o && typeof o === 'object' && Number.isInteger(o.x) && Number.isInteger(o.y) && o.x >= 0 && o.y >= 0 && o.x < COLS && o.y < ROWS; }
    return {
      v: 1, name: String(m.name || 'My property').slice(0, 60), example: !!m.example, acres: num(m.acres, 1, 100000, 80), cols: COLS, rows: ROWS, cells: cells,
      stands: (Array.isArray(m.stands) ? m.stands : []).filter(pt).slice(0, MAX_STANDS).map(function (s, i) { return { x: s.x, y: s.y, name: String(s.name || ('Stand ' + (i + 1))).slice(0, 30) }; }),
      cams: (Array.isArray(m.cams) ? m.cams : []).filter(pt).slice(0, MAX_CAMS).map(function (c) { return { x: c.x, y: c.y, cam: String(c.cam || '').slice(0, 40) }; })
    };
  }

  /* ---------- geometry fields ---------- */
  function distField(cells, pred) {        // multi-source BFS, 8-neighbour, in cells
    var d = new Float32Array(N).fill(1e9), q = [];
    for (var i = 0; i < N; i++) if (pred(cells[i])) { d[i] = 0; q.push(i); }
    for (var h = 0; h < q.length; h++) {
      var i0 = q[h], x = i0 % COLS, y = (i0 / COLS) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; var nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        var j = ny * COLS + nx, nd = d[i0] + (dx && dy ? 1.414 : 1);
        if (nd < d[j] - 1e-6) { d[j] = nd; q.push(j); }
      }
    }
    return d;
  }
  /* Route rule (MSU P3927): bucks "avoid navigating through areas with open understory" and pick routes that keep cover.
     No study gives a cost per cover type, so routes use RANK ORDER ONLY: first fewest open squares, then fewest
     mixed squares, then fewest cover squares (lexicographic). The tier sizes below just keep the ranks apart; they are
     not deer data. No slope cost (none published). */
  var TIER = { 'B': 0, 'N': 0, 'C': 0, '.': 1, 'X': 1, 'F': 2, 'R': 2, 'W': 2 };   // 0 cover < 1 mixed < 2 open
  var TIER_STEP = [1, 1e4, 1e8];                                                       // rank separators only
  function costField(cells, pred) {        // Dijkstra with a simple binary heap
    var d = new Float64Array(N).fill(1e300), heap = [];
    function push(i, v) { heap.push([v, i]); var k = heap.length - 1; while (k > 0) { var p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; var t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var k = 0; for (;;) { var l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; var t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m; } } return top; }
    for (var i = 0; i < N; i++) if (pred(cells[i])) { d[i] = 0; push(i, 0); }
    while (heap.length) {
      var it = pop(), i0 = it[1]; if (it[0] > d[i0]) continue;
      var x = i0 % COLS, y = (i0 / COLS) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; var nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        var j = ny * COLS + nx, nd = d[i0] + TIER_STEP[TIER[cells[j]] == null ? 1 : TIER[cells[j]]];
        if (nd < d[j]) { d[j] = nd; push(j, nd); }
      }
    }
    return d;
  }
  function prepare(map) {
    var c = map.cells, has = {}; for (var i = 0; i < N; i++) has[c[i]] = 1;
    var route = new Uint8Array(N), haveRoute = !!(has.B && has.F);
    if (haveRoute) {
      var cB = costField(c, function (z) { return z === 'B'; }), cF = costField(c, function (z) { return z === 'F'; }), minS = 1e300;
      for (i = 0; i < N; i++) { var sm = cB[i] + cF[i]; if (c[i] !== 'B' && c[i] !== 'F' && sm < minS) minS = sm; }
      for (i = 0; i < N; i++) if (c[i] !== 'B' && c[i] !== 'F' && cB[i] + cF[i] <= minS * (1 + 1e-12)) route[i] = 1;   // the best route(s) only, no spread
    }
    return { map: map, has: has, route: route, haveRoute: haveRoute };
  }

  /* ---------- the model: sourced values only ---------- */
  // Share of buck movement in daylight: about 1/3 in Oct-Nov, over 40% in the rut (MSU Extension 2020; MSU P3927).
  // Post-rut: no published number, so none is used.
  var DAY_SHARE = { early: { lo: 0.33, hi: 0.33 }, prerut: { lo: 0.33, hi: 0.33 }, rut: { lo: 0.40, hi: null }, postrut: null };   // rut: "more than 40%" (no upper value published)
  // Daily distance vs pre-rut (MSU P3927: about 4,800 yd pre-rut, 7,000-7,500+ yd early/peak rut, about 5,000 yd post-rut;
  // net 24-h distance 1.7x at peak/late rut). Early season: no number published, so none is used.
  var DIST_RATIO = { early: null, prerut: { lo: 1.0, hi: 1.0 }, rut: { lo: 1.46, hi: 1.56 }, postrut: { lo: 1.04, hi: 1.04 } };   // 7,000 / 4,800, 7,500 / 4,800, 5,000 / 4,800
  // Hunting pressure: bucks used winter food plots 5x more at night than by day (MSU P3927) -> daytime food x0.2.
  var FOOD_DAY_UNDER_PRESSURE = 0.2;
  function lightOf(cond) {   // peaks tied to the sunrise / sunset hour itself (no peak width is published)
    var h = cond.hour;
    if (Math.abs(h - cond.rise) <= 0.5) return 'dawn';
    if (Math.abs(h - cond.set) <= 0.5) return 'dusk';
    return h > cond.rise && h < cond.set ? 'day' : 'night';
  }
  // Which deer areas are active (MSU P3927, direction only): night = food + routes; sunrise/sunset hour = bedding, routes and
  // food ("flurry of activity", food-plot entries peak around sunset); daylight = bedding (bedded most by day) + routes
  // ("bucks move every day, and they move during daylight hours").
  var ACTIVE = { night: { F: 1, R: 1 }, dawn: { B: 1, F: 1, R: 1 }, dusk: { B: 1, F: 1, R: 1 }, day: { B: 1, R: 1 } };
  function weights(cond) {
    var light = lightOf(cond);
    return { light: light, active: ACTIVE[light], dayShare: DAY_SHARE[cond.season], ratio: DIST_RATIO[cond.season], act: 1 };
  }
  function kindOf(P, i) { var z = P.map.cells[i]; return z === 'B' ? 'B' : z === 'F' ? 'F' : P.route[i] ? 'R' : ''; }
  function heat(P, cond) {
    // DISPLAY ONLY: the shading levels and blur below are a color scale, not deer data. Ratings never read them.
    var SHOW_ACTIVE = 0.6, SHOW_QUIET = 0.2;   // display only
    var W = weights(cond), H = new Float32Array(N), c = P.map.cells, i, mx = 0;
    var avoid = cond.pressure === 'high' && W.light !== 'night';
    for (i = 0; i < N; i++) {
      var k = kindOf(P, i); if (!k) continue;
      var v = W.active[k] ? SHOW_ACTIVE : SHOW_QUIET;
      if ((k === 'R') && W.ratio) v *= (W.ratio.lo + W.ratio.hi) / 2;                 // more daily travel in the rut (sourced ratio)
      if (k === 'F' && avoid) v *= FOOD_DAY_UNDER_PRESSURE;                            // sourced
      if (k === 'B' && avoid) v = 1;   // DISPLAY ONLY: thick cover drawn darker by day under pressure (direction from MSU P3927 / Stewart 2022; no size)
      H[i] = v;
    }
    if (avoid) {   // bucks avoid hunted places by day (MSU P3927, Henderson 2023): on/off, no size or radius published
      for (i = 0; i < N; i++) if (c[i] === 'R') H[i] = 0;
      P.map.stands.forEach(function (s) { H[s.y * COLS + s.x] = 0; });
    }
    var B = new Float32Array(N);   // display-only blur
    for (i = 0; i < N; i++) { var x = i % COLS, y = (i / COLS) | 0, sm = 0, n = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= COLS || Y >= ROWS) continue; sm += H[Y * COLS + X] * (dx || dy ? 0.5 : 1); n += dx || dy ? 0.5 : 1; } B[i] = Math.max(H[i], sm / n); if (B[i] > mx) mx = B[i]; }
    if (mx > 0) for (i = 0; i < N; i++) B[i] /= mx;
    return { H: B, W: W };
  }
  var WIND_VEC = { N: [0, 1], NE: [-0.707, 0.707], E: [-1, 0], SE: [-0.707, -0.707], S: [0, -1], SW: [0.707, -0.707], W: [1, 0], NW: [0.707, 0.707] }; // direction scent travels (wind FROM N blows south = +y)
  // Stand colors, no distance (same rule as the 3D sim): follow your air downwind from the stand until it leaves the
  // property; it fans +/- 22.5 deg, the width of one of the 8 wind choices. Red = it crosses an active deer area this hour;
  // yellow = it crosses only quiet deer areas, or it's the hour after sunrise when slope air is still turning over
  // (Farina et al. 2023: 45-60 min in fall); green = it crosses no deer area. (NDA: keep scent from blowing toward deer.)
  function standsEval(P, R, cond) {
    var v = WIND_VEC[cond.wind] || [0, 1], act = R.W.active, h = cond.hour;
    var flip = h >= cond.rise && h <= cond.rise + 1;
    return P.map.stands.map(function (s, k) {
      var now = 0, quiet = 0, hitBed = false, hitRoute = false;
      for (var i = 0; i < N; i++) {
        var ddx = (i % COLS) - s.x, ddy = ((i / COLS) | 0) - s.y, d = Math.sqrt(ddx * ddx + ddy * ddy);
        if (d < 0.5) continue;
        if ((ddx * v[0] + ddy * v[1]) / d < 0.9239) continue;            // cos 22.5 deg: inside the downwind fan, any distance
        var kind = kindOf(P, i); if (!kind) continue;
        if (act[kind]) { now++; if (kind === 'B') hitBed = true; if (kind === 'R') hitRoute = true; } else quiet++;
      }
      var color = now ? 'red' : (quiet || flip) ? 'yellow' : 'green';
      return { i: k, name: s.name, x: s.x, y: s.y, riskBed: hitBed, riskRoute: hitRoute, quiet: quiet, flip: flip && !now, color: color };
    });
  }
  function fmtHour(h) { var hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60); if (mm === 60) { hh = (hh + 1) % 24; mm = 0; } return ((hh % 12) || 12) + ':' + (mm < 10 ? '0' : '') + mm + ' ' + (hh < 12 ? 'AM' : 'PM'); }
  var WIND_NAME = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };
  var TOWARD = { N: 'south', NE: 'southwest', E: 'west', SE: 'northwest', S: 'north', SW: 'northeast', W: 'east', NW: 'southeast' };
  function why(P, R, cond, stands) {
    var W = R.W, out = [], tag = function (t) { return ' <span class="bs-src">' + t + '</span>'; };
    var pct = function (r) { return r.hi == null ? 'over ' + Math.round(r.lo * 100) + '%' : 'about a third'; };
    out.push('Most movement comes around dawn and dusk; bucks bed most at midday.' + tag('MSU Deer Lab'));
    if (W.light === 'dawn' || W.light === 'dusk') out.push('<b>' + (W.light === 'dawn' ? 'Sunrise' : 'Sunset') + ' hour:</b> collared bucks show a flurry of activity at dawn and dusk' + (W.light === 'dusk' ? ', and they enter food plots most right around sunset' : '') + '. Bedding, the route and food are all shown as active. Research gives no width for this peak, so only the sunrise and sunset hours are marked.' + tag('MSU Deer Lab'));
    else if (W.light === 'day') out.push('<b>Daylight:</b> bucks are bedded most by day, but they move every day in daylight too. Bedding and the route are shown as active.' + (W.dayShare ? ' About ' + pct(W.dayShare) + ' of buck movement happens in daylight in this phase.' : ' Research doesn\u2019t give a daylight share for the post-rut.') + tag('MSU Deer Lab'));
    else out.push('<b>Night:</b> most buck movement happens at night, so food and the route are shown as active.' + tag('MSU Deer Lab'));
    if (cond.season === 'early') out.push('<b>Early season:</b> about a third of movement in daylight (Oct-Nov). No early-season daily-distance number is published, so travel is not scaled.' + tag('MSU Deer Lab'));
    if (cond.season === 'prerut') out.push('<b>Pre-rut:</b> bucks travel about 4,800 yards (2.7 mi) a day. This is the baseline for the other phases.' + tag('MSU Deer Lab'));
    if (cond.season === 'rut') out.push('<b>Rut:</b> bucks travel about 1.5x farther each day (7,000-7,500+ yards vs 4,800 pre-rut), and where they end each day is 1.7x farther from where they started. Over 40% of movement is in daylight. The route is drawn stronger to match.' + tag('MSU Deer Lab'));
    if (cond.season === 'postrut') out.push('<b>Post-rut:</b> daily travel drops back to about 5,000 yards, close to pre-rut. Research doesn\u2019t give a post-rut daylight share, so none is used.' + tag('MSU Deer Lab'));
    if (cond.pressure === 'high') out.push('<b>High pressure:</b> Pressured bucks shift into thick cover by day and avoid hunted spots and open food in daylight; they don\u2019t simply move less. In one Oklahoma study, daytime use of cover rose 240% and hunters saw 62% fewer collared bucks by the second gun weekend. The map shades thick cover darker by day and shows roads, your stand spots and open food as avoided (no study gives how far).' + tag('MSU P3927, Henderson 2023, Stewart 2022'));
    if (cond.temp) out.push('<b>' + (cond.temp < 0 ? 'Colder' : 'Warmer') + ' than normal:</b> Temperature swings may nudge movement, but in the South studies found the effect small and inconsistent. The map does not change for temperature.' + tag('Webb 2010, Goethlich 2020'));
    if (!P.haveRoute) out.push('<b>Add bedding cover and a food source</b> in Edit map to see the route between them.' + tag('model note'));
    else out.push('The route keeps to cover where it can: bucks avoid open understory when moving (no study gives a cost per cover type, so only that order is used).' + tag('MSU Deer Lab'));
    var reds = stands.filter(function (s) { return s.color === 'red'; });
    if (P.map.stands.length) out.push('<b>Wind from the ' + WIND_NAME[cond.wind] + '</b> carries your scent ' + TOWARD[cond.wind] + '. ' + (reds.length ? reds.map(function (s) { return esc(s.name); }).join(', ') + (reds.length > 1 ? ' are' : ' is') + ' red: your air blows over ' + (reds.some(function (s) { return s.riskBed; }) ? 'bedding cover' : 'a deer area') + ' where deer likely are now.' : 'No stand\u2019s air blows over a deer area where deer likely are now.') + ' Stands are rated by whether your air crosses bedding, the route or food anywhere on the property, not by any smell distance. Wind changes which stand to hunt; in this model it does not move the deer.' + tag('NDA: keep scent off deer'));
    if (cond.hour >= cond.rise && cond.hour <= cond.rise + 1) out.push('<b>First hour after sunrise:</b> slope air is turning over from downhill to uphill (45-60 min in fall in one field study), so stands are yellow at best. No study for the evening turnover was found, so none is used.' + tag('Farina et al. 2023'));
    return out;
  }
  function simulate(map, cond) { var P = prepare(map), R = heat(P, cond), st = standsEval(P, R, cond); return { P: P, R: R, stands: st, why: why(P, R, cond, st) }; }

  /* ---------- UI ---------- */
  var CSS = '.bsim{color:inherit}.bsim .bs-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}' +
    '.bsim .bs-tab{min-height:44px;border-radius:10px;border:1px solid #3a4331;background:#252b20;color:#eee9da;font:inherit;font-weight:700}.bsim .bs-tab.on{background:#d9822b;border-color:#d9822b;color:#1d1407}' +
    '.bsim .bs-wrap{display:block}.bsim canvas{width:100%;display:block;border-radius:12px;background:#d8cfa6;touch-action:pan-y}.bsim.editing canvas{touch-action:none}' +
    '.bsim .bs-card{background:#f2ead6;color:#2a2b22;border-radius:14px;padding:12px;margin:10px 0}.bsim .bs-card h3{margin:0 0 8px;font-size:16px}' +
    '.bsim .bs-row{margin:0 0 12px}.bsim .bs-lab{display:flex;justify-content:space-between;font-size:13.5px;color:#6b6553;margin-bottom:4px}.bsim .bs-lab b{color:#2a2b22}' +
    '.bsim input[type=range]{width:100%;accent-color:#c4621a;height:30px}' +
    '.bsim .bs-seg{display:grid;gap:5px}.bsim .bs-seg button,.bsim .bs-btn{min-height:42px;border-radius:9px;border:2px solid #cbbf9f;background:#fffaf0;color:#2a2b22;font:inherit;font-size:13.5px;font-weight:700;padding:4px 6px}' +
    '.bsim .bs-seg button.on{background:#2a2b22;border-color:#2a2b22;color:#f2ead6}.bsim .bs-btn.go{background:#d9822b;border-color:#d9822b;color:#1d1407}' +
    '.bsim .bs-why{margin:0;padding-left:18px;line-height:1.45;font-size:14.5px}.bsim .bs-why li{margin-bottom:6px}.bsim .bs-src{display:inline-block;font-size:10.5px;font-weight:700;color:#7a3d14;border:1px solid #d6b48a;border-radius:8px;padding:0 5px;margin-left:2px;vertical-align:1px;white-space:nowrap}' +
    '.bsim .bs-stand{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed #cbbf9f;font-size:14.5px}.bsim .bs-stand:last-child{border-bottom:0}.bsim .bs-dot{width:14px;height:14px;border-radius:50%;flex:none;border:2px solid #2a2b22}' +
    '.bsim .c-green{background:#3f9b3a}.bsim .c-yellow{background:#e3c02f}.bsim .c-red{background:#cf3b2b}.bsim .bs-tools{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.bsim .bs-tools button{min-height:44px;border-radius:9px;border:2px solid #cbbf9f;background:#fffaf0;font:inherit;font-size:12px;font-weight:700;color:#2a2b22;display:flex;align-items:center;gap:5px;padding:3px 5px;text-align:left;line-height:1.1}' +
    '.bsim .bs-tools button.on{border-color:#2a2b22;box-shadow:0 0 0 2px #2a2b22 inset}.bsim .bs-sw{width:14px;height:14px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.3)}' +
    '.bsim .bs-note{font-size:12.5px;color:#6b6553;margin:6px 0 0}.bsim .bs-in{width:100%;min-height:44px;border-radius:9px;border:1px solid #cbbf9f;background:#fffaf0;color:#2a2b22;font:inherit;font-size:16px;padding:8px 10px}' +
    '.bsim .bs-legend{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:11.5px;color:#d9d4c4;margin:6px 2px 0}.bsim .bs-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:3px;vertical-align:-1px}' +
    '.bsim .bs-flag{background:#33291b;border:1px solid #d9822b;color:#f7d9b5;border-radius:10px;padding:7px 10px;font-size:13px;margin:0 0 8px}' +
    '@media (min-width:820px){.bsim .bs-wrap{display:grid;grid-template-columns:1.1fr 1fr;gap:14px;align-items:start}}';

  function mount(root, host) {
    host = host || {};
    if (!document.getElementById('bsim-css')) { var st = document.createElement('style'); st.id = 'bsim-css'; st.textContent = CSS; document.head.appendChild(st); }
    var map = clean(host.getMap && host.getMap()) || example();
    var sun = (host.sun && host.sun()) || null;
    var cond = { hour: 17.5, season: 'prerut', wind: 'NW', temp: 0, pressure: 'low', rise: sun ? sun.rise : 6.75, set: sun ? sun.set : 18.5 };
    var layers = { heat: true, trails: true, visits: false };
    var mode = 'sim', tool = 'B', brush = 1, camPick = '', undo = [];
    var result = null, agents = [], raf = null, last = 0, playing = false, dead = false, canvas, ctx, cw = 0;
    function saveMap() { if (host.saveMap) host.saveMap(map); }
    function recompute() { result = simulate(map, cond); }
    function shell() {
      root.innerHTML = '<div class="bsim" id="bsim"><div class="bs-tabs"><button class="bs-tab" data-bs="mode-sim">Simulate</button><button class="bs-tab" data-bs="mode-edit">Edit map</button></div>' +
        (map.example ? '<div class="bs-flag" id="bs-example">Showing the <b>example property</b> (not your land). Tap <b>Edit map</b> to draw yours.</div>' : '') +
        '<div class="bs-wrap"><div><canvas id="bs-canvas" aria-label="Property map"></canvas><div class="bs-legend" id="bs-legend"></div></div><div id="bs-side"></div></div></div>';
      canvas = root.querySelector('#bs-canvas'); ctx = canvas.getContext('2d');
      canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
      root.querySelector('#bsim').classList.toggle('editing', mode === 'edit');
      Array.prototype.forEach.call(root.querySelectorAll('.bs-tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-bs') === 'mode-' + mode); });
      size(); side(); legend(); draw();
    }
    function size() { var w = Math.min(root.clientWidth || 360, 560), dpr = window.devicePixelRatio || 1; cw = w / COLS; canvas.style.height = (cw * ROWS) + 'px'; canvas.width = Math.round(w * dpr); canvas.height = Math.round(cw * ROWS * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function legend() {
      var el = root.querySelector('#bs-legend'); if (!el) return;
      el.innerHTML = ZKEYS.filter(function (k) { return k !== '.'; }).map(function (k) { return '<span><i style="background:' + ZONES[k].color + '"></i>' + ZONES[k].name + '</span>'; }).join('') +
        (mode === 'sim' ? '<span><i style="background:rgba(214,40,20,.75)"></i>Active deer areas this hour</span>' : '');
    }
    function tempLabel(t) { return t === 0 ? 'Normal' : (t > 0 ? '+' : '\u2212') + Math.abs(t) + '\u00b0F' + (t <= -10 ? ' \u00b7 cold front' : t >= 10 ? ' \u00b7 heat' : ''); }
    function seg(name, items, cur, cols) { return '<div class="bs-seg" style="grid-template-columns:repeat(' + cols + ',1fr)">' + items.map(function (it) { return '<button data-bs="' + name + ':' + it[0] + '" class="' + (it[0] === cur ? 'on' : '') + '">' + it[1] + '</button>'; }).join('') + '</div>'; }
    function side() {
      var el = root.querySelector('#bs-side'); if (!el) return;
      if (mode === 'edit') { el.innerHTML = editPanel(); bindEdit(); return; }
      recompute();
      var W = result.R.W;
      el.innerHTML = '<div class="bs-card" id="bs-controls">' +
        '<div class="bs-row"><div class="bs-lab"><span>Time of day</span><b id="bs-hour-lab">' + fmtHour(cond.hour) + ' · ' + W.light + '</b></div><input type="range" id="bs-hour" min="0" max="23.5" step="0.5" value="' + cond.hour + '" aria-label="Time of day">' +
        '<button class="bs-btn" data-bs="play" id="bs-play" style="width:100%;margin-top:4px">' + (playing ? '❚❚ Pause' : '▶ Run the day') + '</button></div>' +
        '<div class="bs-row"><div class="bs-lab"><span>Season phase</span></div>' + seg('season', SEASONS.map(function (s) { return [s.id, s.label]; }), cond.season, 4) + '</div>' +
        '<div class="bs-row"><div class="bs-lab"><span>Wind from</span><b>' + cond.wind + '</b></div>' + seg('wind', WINDS.map(function (w) { return [w, w]; }), cond.wind, 8) + '</div>' +
        '<div class="bs-row"><div class="bs-lab"><span>Temperature vs normal</span><b id="bs-temp-lab">' + tempLabel(cond.temp) + '</b></div><input type="range" id="bs-temp" min="-20" max="20" step="5" value="' + cond.temp + '" aria-label="Temperature versus normal"></div>' +
        '<div class="bs-row"><div class="bs-lab"><span>Hunting pressure</span></div>' + seg('pressure', [['low', 'Low'], ['high', 'High']], cond.pressure, 2) + '</div>' +
        '<div class="bs-row" style="margin:0"><div class="bs-lab"><span>Show</span></div>' + seg('layer', [['heat', (layers.heat ? '✓ ' : '') + 'Heat map'], ['trails', (layers.trails ? '✓ ' : '') + 'Buck trails']].concat(host.visitCount ? [['visits', (layers.visits ? '✓ ' : '') + 'My cam visits']] : []), '', host.visitCount ? 3 : 2) + '</div></div>' +
        '<div class="bs-card" id="bs-stands"><h3>Stands right now</h3>' + (result.stands.length ? result.stands.map(function (s) {
          return '<div class="bs-stand" data-stand="' + s.i + '"><span class="bs-dot c-' + s.color + '"></span><span style="flex:1"><b>' + esc(s.name) + '</b><br><span style="font-size:12.5px;color:#6b6553">' +
            (s.color === 'red' ? 'Bad wind: your air blows over ' + (s.riskBed ? 'bedding' : s.riskRoute ? 'the deer route' : 'the food') : s.color === 'green' ? 'Good wind: your air misses deer areas' : s.flip ? 'Air can flip near sunrise/sunset' : 'Air crosses deer areas that are likely quiet now') + '</span></span></div>';
        }).join('') + '<p class="bs-note">Color comes only from where your air goes. No odds number: no study supports one.</p>' : '<p class="bs-note">No stands yet. Add them in Edit map.</p>') + '</div>' +
        '<div class="bs-card" id="bs-whycard"><h3>Why the map looks like this</h3><ul class="bs-why" id="bs-why">' + result.why.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>' +
        '<p class="bs-note"><b>This is a simple model, not a forecast.</b> It uses only published numbers from GPS-collar studies of whitetails; the shading is a color scale, not data. Real bucks on your land will differ. Use it to think through setups, and trust your own camera data first.</p></div>';
      bindSim();
    }
    function editPanel() {
      var camOpts = (host.cameras ? host.cameras() : []);
      return '<div class="bs-card" id="bs-editor"><h3>Draw your property</h3>' +
        '<div class="bs-tools">' + ZKEYS.map(function (k) { return '<button data-bs="tool:' + k + '" class="' + (tool === k ? 'on' : '') + '"><span class="bs-sw" style="background:' + ZONES[k].color + '"></span>' + (k === '.' ? 'Erase' : ZONES[k].name) + '</button>'; }).join('') +
        '<button data-bs="tool:stand" class="' + (tool === 'stand' ? 'on' : '') + '"><span class="bs-sw" style="background:#fff;border-radius:50%"></span>Stand</button>' +
        (host.cameras ? '<button data-bs="tool:cam" class="' + (tool === 'cam' ? 'on' : '') + '"><span class="bs-sw" style="background:#2a2b22"></span>Camera</button>' : '') + '</div>' +
        '<div class="bs-seg" style="grid-template-columns:1fr 1fr;margin-top:8px"><button data-bs="brush:1" class="' + (brush === 1 ? 'on' : '') + '">Fine brush</button><button data-bs="brush:2" class="' + (brush === 2 ? 'on' : '') + '">Wide brush</button></div>' +
        (tool === 'cam' ? '<label class="bs-lab" style="margin-top:8px"><span>Which Buck Ledger camera?</span></label><select class="bs-in" id="bs-campick">' + (camOpts.length ? camOpts.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === camPick ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') : '<option value="">No cameras yet</option>') + '</select>' : '') +
        '<p class="bs-note">Tap or drag on the map to paint. ' + (host.cameras ? 'Stand / Camera' : 'Stand') + ': tap to place, tap again to remove. North is up.' + (host.cameras ? ' Placing your cameras lets “My cam visits” show your logged buck visits near the chosen hour.' : '') + '</p></div>' +
        '<div class="bs-card"><label class="bs-lab"><span>Property name</span></label><input class="bs-in" id="bs-name" maxlength="60" value="' + esc(map.name) + '">' +
        '<label class="bs-lab" style="margin-top:8px"><span>Acres (sets the scale)</span><b id="bs-scale">' + scaleText() + '</b></label><input class="bs-in" id="bs-acres" type="number" min="1" max="100000" value="' + map.acres + '">' +
        '<div class="bs-seg" style="grid-template-columns:1fr 1fr 1fr;margin-top:10px"><button data-bs="undo">↶ Undo</button><button data-bs="clear">Blank map</button><button data-bs="example">Example</button></div>' +
        '<p class="bs-note">Saved on this phone automatically, and included in your Buck Ledger backup file.</p></div>';
    }
    function scaleText() { var sq = map.acres / N, side = Math.sqrt(map.acres * 43560 / N); return 'each square ≈ ' + (sq < 1 ? sq.toFixed(2) : sq.toFixed(1)) + ' ac (' + Math.round(side) + ' ft)'; }
    function bindSim() {
      var hr = root.querySelector('#bs-hour'), tp = root.querySelector('#bs-temp');
      tp.addEventListener('input', function () { cond.temp = Number(tp.value); root.querySelector('#bs-temp-lab').textContent = tempLabel(cond.temp); refresh(); });
      hr.addEventListener('input', function () { cond.hour = Number(hr.value); refresh(); });
    }
    function refresh() {    // light update without rebuilding sliders (keeps the thumb under your finger)
      recompute(); var W = result.R.W;
      var hl = root.querySelector('#bs-hour-lab'); if (hl) hl.textContent = fmtHour(cond.hour) + ' · ' + W.light;
      var sd = root.querySelector('#bs-stands'), wy = root.querySelector('#bs-why');
      if (wy) wy.innerHTML = result.why.map(function (l) { return '<li>' + l + '</li>'; }).join('');
      if (sd) sd.innerHTML = '<h3>Stands right now</h3>' + (result.stands.length ? result.stands.map(function (s) {
        return '<div class="bs-stand" data-stand="' + s.i + '"><span class="bs-dot c-' + s.color + '"></span><span style="flex:1"><b>' + esc(s.name) + '</b><br><span style="font-size:12.5px;color:#6b6553">' +
          (s.color === 'red' ? 'Bad wind: your air blows over ' + (s.riskBed ? 'bedding' : s.riskRoute ? 'the deer route' : 'the food') : s.color === 'green' ? 'Good wind: your air misses deer areas' : s.flip ? 'Air can flip near sunrise/sunset' : 'Air crosses deer areas that are likely quiet now') + '</span></span></div>';
      }).join('') + '<p class="bs-note">Color comes only from where your air goes. No odds number: no study supports one.</p>' : '<p class="bs-note">No stands yet. Add them in Edit map.</p>');
      draw();
    }
    function bindEdit() {
      var nm = root.querySelector('#bs-name'), ac = root.querySelector('#bs-acres'), cp = root.querySelector('#bs-campick');
      nm.addEventListener('change', function () { map.name = String(nm.value || 'My property').slice(0, 60); map.example = false; saveMap(); });
      ac.addEventListener('change', function () { map.acres = num(ac.value, 1, 100000, map.acres); ac.value = map.acres; root.querySelector('#bs-scale').textContent = scaleText(); saveMap(); });
      if (cp) { if (!camPick && cp.value) camPick = cp.value; cp.addEventListener('change', function () { camPick = cp.value; }); }
    }
    /* drawing */
    function draw() {
      if (!ctx) return; var c = map.cells, W2 = cw * COLS, H2 = cw * ROWS;
      ctx.clearRect(0, 0, W2, H2);
      for (var i = 0; i < N; i++) { var x = i % COLS, y = (i / COLS) | 0; ctx.fillStyle = ZONES[c[i]].color; ctx.fillRect(x * cw, y * cw, cw + 0.5, cw + 0.5); }
      if (mode === 'sim' && layers.heat && result) {
        var H = result.R.H, a = result.R.W.act;
        for (i = 0; i < N; i++) { var v = H[i] * (0.35 + 0.65 * a); if (v < 0.06) continue; ctx.fillStyle = 'rgba(214,40,20,' + (Math.min(0.82, v * 0.85)).toFixed(3) + ')'; ctx.fillRect((i % COLS) * cw, ((i / COLS) | 0) * cw, cw + 0.5, cw + 0.5); }
      }
      ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 1;
      for (var gx = 1; gx < COLS; gx++) { ctx.beginPath(); ctx.moveTo(gx * cw, 0); ctx.lineTo(gx * cw, H2); ctx.stroke(); }
      for (var gy = 1; gy < ROWS; gy++) { ctx.beginPath(); ctx.moveTo(0, gy * cw); ctx.lineTo(W2, gy * cw); ctx.stroke(); }
      if (mode === 'sim' && layers.trails) agents.forEach(function (ag) {
        for (var k = 1; k < ag.trail.length; k++) { ctx.strokeStyle = 'rgba(40,24,8,' + (k / ag.trail.length * 0.7).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ag.trail[k - 1][0] * cw, ag.trail[k - 1][1] * cw); ctx.lineTo(ag.trail[k][0] * cw, ag.trail[k][1] * cw); ctx.stroke(); }
        ctx.fillStyle = '#2b1a0b'; ctx.strokeStyle = '#fffaf0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ag.x * cw, ag.y * cw, Math.max(3, cw * 0.22), 0, 6.283); ctx.fill(); ctx.stroke();
      });
      var colors = { green: '#3f9b3a', yellow: '#e3c02f', red: '#cf3b2b' };
      map.stands.forEach(function (s, k) {
        var st = mode === 'sim' && result ? result.stands[k] : null, px = (s.x + 0.5) * cw, py = (s.y + 0.5) * cw, r = Math.max(7, cw * 0.42);
        ctx.fillStyle = st ? colors[st.color] : '#fffaf0'; ctx.strokeStyle = '#1d1d17'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, r, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1d1d17'; ctx.font = 'bold ' + Math.round(r * 1.1) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k + 1), px, py + 0.5);
      });
      map.cams.forEach(function (cm) {
        var px = cm.x * cw, py = cm.y * cw; ctx.fillStyle = '#2a2b22'; ctx.fillRect(px + cw * 0.18, py + cw * 0.18, cw * 0.64, cw * 0.64);
        if (mode === 'sim' && layers.visits && host.visitCount) { var n = host.visitCount(cm.cam, cond.hour - 1, cond.hour + 1); ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#2a2b22'; var bw = Math.max(16, cw * 0.9); ctx.fillRect(px + cw * 0.5, py - cw * 0.45, bw, cw * 0.75); ctx.strokeRect(px + cw * 0.5, py - cw * 0.45, bw, cw * 0.75); ctx.fillStyle = '#2a2b22'; ctx.font = 'bold ' + Math.round(cw * 0.5) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(n), px + cw * 0.5 + bw / 2, py - cw * 0.07); }
      });
      // north + wind arrows
      ctx.fillStyle = 'rgba(29,29,23,.8)'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N ↑', W2 - 18, 12);
      if (mode === 'sim') { var v = WIND_VEC[cond.wind]; ctx.save(); ctx.translate(22, 22); ctx.fillStyle = 'rgba(255,250,240,.9)'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 6.283); ctx.fill(); ctx.rotate(Math.atan2(v[1], v[0])); ctx.strokeStyle = '#1d4e89'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(10, 0); ctx.lineTo(4, -5); ctx.moveTo(10, 0); ctx.lineTo(4, 5); ctx.stroke(); ctx.restore(); }
    }
    /* buck dots (DISPLAY ONLY): wander between the shaded deer areas; not a prediction */
    function pickTarget() {
      var H = result.R.H, tot = 0, i; for (i = 0; i < N; i++) tot += H[i] * H[i] * H[i];
      var r = Math.random() * tot; for (i = 0; i < N; i++) { r -= H[i] * H[i] * H[i]; if (r <= 0) break; }
      i = Math.min(i, N - 1); return [(i % COLS) + 0.5, ((i / COLS) | 0) + 0.5];
    }
    function initAgents() { agents = []; if (!result) return; for (var k = 0; k < 5; k++) { var t = pickTarget(); agents.push({ x: t[0], y: t[1], tx: t[0], ty: t[1], trail: [], wait: 0 }); } }
    function step(dt) {
      if (!result) return; var act = result.R.W.act, H = result.R.H;
      agents.forEach(function (ag) {
        if (ag.wait > 0) { ag.wait -= dt; return; }
        var dx = ag.tx - ag.x, dy = ag.ty - ag.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.3) { var t = pickTarget(); ag.tx = t[0]; ag.ty = t[1]; ag.wait = (1 - act) * 2500 * Math.random(); return; }
        var best = null, bs = -1e9;
        for (var a = 0; a < 8; a++) {
          var ang = a * Math.PI / 4, nx = ag.x + Math.cos(ang) * 0.6, ny = ag.y + Math.sin(ang) * 0.6;
          if (nx < 0.1 || ny < 0.1 || nx > COLS - 0.1 || ny > ROWS - 0.1) continue;
          var cell = H[(ny | 0) * COLS + (nx | 0)] || 0, prog = (Math.cos(ang) * dx + Math.sin(ang) * dy) / d;
          var sc = 0.55 * prog + 0.45 * cell + Math.random() * 0.1; if (sc > bs) { bs = sc; best = ang; }
        }
        var sp = (0.6 + 2.4 * act) * dt / 1000; ag.x += Math.cos(best) * sp; ag.y += Math.sin(best) * sp;
        ag.trail.push([ag.x, ag.y]); if (ag.trail.length > 40) ag.trail.shift();
      });
    }
    function loop(ts) {
      if (dead) return; if (!root.isConnected) { destroy(); return; }
      var dt = last ? Math.min(100, ts - last) : 16; last = ts;
      if (mode === 'sim') {
        if (playing) { cond.hour = (cond.hour + dt / 1000 * 0.75) % 24; var hr = root.querySelector('#bs-hour'); if (hr) hr.value = Math.round(cond.hour * 2) / 2; if (Math.abs(cond.hour * 2 - Math.round(cond.hour * 2)) < 0.03) refresh(); }
        step(dt); draw();
      }
      raf = requestAnimationFrame(loop);
    }
    /* editing */
    var painting = false, lastCell = -1;
    function cellAt(e) { var r = canvas.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / (r.width / COLS)), y = Math.floor((e.clientY - r.top) / (r.height / ROWS)); return x >= 0 && y >= 0 && x < COLS && y < ROWS ? [x, y] : null; }
    function pushUndo() { undo.push(JSON.stringify(map)); if (undo.length > 30) undo.shift(); }
    function paintAt(p) {
      var arr = map.cells.split(''), changed = false;
      for (var dy = 0; dy < brush; dy++) for (var dx = 0; dx < brush; dx++) { var x = p[0] + dx, y = p[1] + dy; if (x < COLS && y < ROWS && arr[y * COLS + x] !== tool) { arr[y * COLS + x] = tool; changed = true; } }
      if (changed) { map.cells = arr.join(''); map.example = false; draw(); }
    }
    function placePoint(p) {
      var list = tool === 'stand' ? map.stands : map.cams, k = -1;
      list.forEach(function (o, i) { if (o.x === p[0] && o.y === p[1]) k = i; });
      pushUndo();
      if (k >= 0) list.splice(k, 1);
      else if (tool === 'stand') { if (map.stands.length >= MAX_STANDS) { if (host.toast) host.toast('Up to ' + MAX_STANDS + ' stands'); undo.pop(); return; } map.stands.push({ x: p[0], y: p[1], name: 'Stand ' + (map.stands.length + 1) }); }
      else { if (!camPick) { if (host.toast) host.toast('Log a pull first so you have a camera to place'); undo.pop(); return; } if (map.cams.length >= MAX_CAMS) { undo.pop(); return; } map.cams.push({ x: p[0], y: p[1], cam: camPick }); }
      map.example = false; saveMap(); draw();
    }
    function onDown(e) {
      if (mode !== 'edit') return; var p = cellAt(e); if (!p) return; e.preventDefault();
      if (tool === 'stand' || tool === 'cam') { placePoint(p); return; }
      pushUndo(); painting = true; lastCell = -1; try { canvas.setPointerCapture(e.pointerId); } catch (x) {} paintAt(p);
    }
    function onMove(e) { if (!painting) return; var p = cellAt(e); if (!p) return; var id = p[1] * COLS + p[0]; if (id === lastCell) return; lastCell = id; paintAt(p); }
    function onUp() { if (!painting) return; painting = false; saveMap(); var f = root.querySelector('#bs-example'); if (f) f.remove(); }
    function onClick(e) {
      var b = e.target.closest('[data-bs]'); if (!b || !root.contains(b)) return;
      var a = b.getAttribute('data-bs'), kv = a.split(':'), k = kv[0], v = kv[1];
      if (a === 'mode-sim' || a === 'mode-edit') { mode = a === 'mode-sim' ? 'sim' : 'edit'; playing = false; shell(); if (mode === 'sim') initAgents(); return; }
      if (k === 'season' || k === 'wind' || k === 'pressure') { cond[k] = v; side(); draw(); return; }
      if (k === 'layer') { layers[v] = !layers[v]; side(); draw(); return; }
      if (a === 'play') { playing = !playing; b.textContent = playing ? '❚❚ Pause' : '▶ Run the day'; return; }
      if (k === 'tool') { tool = v; side(); return; }
      if (k === 'brush') { brush = Number(v); side(); return; }
      if (a === 'undo') { var u = undo.pop(); if (u) { var old = clean(JSON.parse(u)); if (old) { map.cells = old.cells; map.stands = old.stands; map.cams = old.cams; } saveMap(); shell(); } return; }   // undo the drawing, keep name + acres
      if (a === 'clear') { pushUndo(); var nm = map.example ? 'My property' : map.name, ac = map.example ? 80 : map.acres; map = blank(); map.name = nm; map.acres = ac; saveMap(); shell(); return; }
      if (a === 'example') { pushUndo(); map = example(); saveMap(); shell(); return; }
    }
    function onResize() { if (!canvas) return; size(); draw(); }
    function destroy() { dead = true; if (raf) cancelAnimationFrame(raf); root.removeEventListener('click', onClick); window.removeEventListener('resize', onResize); }
    root.addEventListener('click', onClick);
    window.addEventListener('resize', onResize);
    shell();
    recompute(); initAgents(); raf = requestAnimationFrame(loop);
    var api = {
      destroy: destroy, getMap: function () { return JSON.parse(JSON.stringify(map)); },
      state: function () { return { cond: JSON.parse(JSON.stringify(cond)), mode: mode, tool: tool, stands: result ? result.stands.map(function (s) { return { name: s.name, color: s.color }; }) : [], heatSum: result ? Array.prototype.reduce.call(result.R.H, function (a, b) { return a + b; }, 0) : 0, heat: result ? Array.prototype.slice.call(result.R.H) : [], why: result ? result.why.slice() : [], act: result ? result.R.W.act : 0, agents: agents.length }; },
      set: function (o) { Object.keys(o || {}).forEach(function (k) { if (k in cond) cond[k] = o[k]; }); if (mode === 'sim') side(); draw(); }
    };
    root.__bsim = api;
    return api;
  }
  window.BuckSim = { mount: mount, example: example, blank: blank, clean: clean, simulate: simulate, ZONES: ZONES, COLS: COLS, ROWS: ROWS };
})();
