/* Buck Ledger: a hunter's logbook that fills itself in from your SD card.
 * Everything is stored on the device (IndexedDB). No accounts, no server, works offline. */
(function () {
  'use strict';
  var C = window.BUCKLEDGER_CONFIG || {};
  var APP = C.APP_NAME || 'Buck Ledger';
  var SCHEMA = 1;
  var KINDS = [
    { id: 'buck', label: 'Buck' }, { id: 'doe', label: 'Doe' }, { id: 'fawn', label: 'Fawn' },
    { id: 'other', label: 'Other' }, { id: 'empty', label: 'Empty' }
  ];
  var KIND_LABEL = {}; KINDS.forEach(function (t) { KIND_LABEL[t.id] = t.label; });
  /* ---------------- utils ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function plural(n, w, pl) { return n + ' ' + (n === 1 ? w : (pl || w + 's')); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clampStr(s, n) { return String(s == null ? '' : s).slice(0, n); }
  // Local wall-clock times are stored as "YYYY-MM-DDTHH:MM:SS" strings (trail cams have no time zone).
  function parseLocal(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d) ? null : d;
  }
  function toLocalStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function fmtTime(d) { var h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + ':' + pad(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function fmtHour(h) { return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; }
  function fmtHourLong(h) { h = ((h % 24) + 24) % 24; return ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(d) { return MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''); }
  function fmtDT(d) { return d ? fmtDate(d) + ' · ' + fmtTime(d) : 'No time'; }
  function fmtDay(ms) { return fmtDate(new Date(ms)); }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }

  var toastTimer;
  function toast(msg, ms) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }
  function sheet(html, onClick) {
    var root = $('#sheet-root');
    root.innerHTML = '<div class="sheet-back"><div class="sheet" role="dialog" aria-modal="true">' + html + '</div></div>';
    var back = $('.sheet-back', root);
    return new Promise(function (resolve) {
      function close(v) { root.innerHTML = ''; resolve(v); }
      back.addEventListener('click', function (e) {
        if (e.target === back) return close(null);
        var b = e.target.closest('[data-x]'); if (!b) return;
        var x = b.getAttribute('data-x');
        if (onClick) { var r = onClick(x, b, close); if (r === false) return; }
        if (x === 'close' || x === 'no') close(null); else if (x === 'yes') close(true);
      });
    });
  }
  function closeSheet() { $('#sheet-root').innerHTML = ''; }
  function confirmSheet(title, body, yes, danger) {
    return sheet('<h2>' + esc(title) + '</h2><p class="muted">' + esc(body) + '</p><div class="btn-row"><button class="btn" data-x="no">Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-x="yes">' + esc(yes || 'OK') + '</button></div>');
  }

  /* ---------------- storage (IndexedDB) ---------------- */
  var DB = null;
  function openDB() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('no-idb'));
      var r = indexedDB.open('buckledger', 1);
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = function () { DB = r.result; res(DB); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (res, rej) {
      var t = DB.transaction(store, mode), s = t.objectStore(store), out;
      out = fn(s);
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error || new Error('abort')); };
    });
  }
  function kvGet(k) { return tx('kv', 'readonly', function (s) { return s.get(k); }); }
  function kvPut(k, v) { return tx('kv', 'readwrite', function (s) { s.put(v, k); }); }
  function photoPut(p) { return tx('photos', 'readwrite', function (s) { s.put(p); }); }
  function photosPutMany(arr) { return tx('photos', 'readwrite', function (s) { arr.forEach(function (p) { s.put(p); }); }); }
  function photoDel(ids) { return tx('photos', 'readwrite', function (s) { ids.forEach(function (id) { s.delete(id); }); }); }
  function photosAll() { return tx('photos', 'readonly', function (s) { return s.getAll(); }); }
  function photosClear() { return tx('photos', 'readwrite', function (s) { s.clear(); }); }

  /* ---------------- state ---------------- */
  var S = null;       // { schema, cameras:[], deer:[], pulls:[], settings:{} }
  var P = [];         // photo records (with thumb Blobs)
  var PI = {};        // id -> photo
  function defaults() {
    return { schema: SCHEMA, cameras: [], deer: [], pulls: [], settings: { lat: null, lng: null, shootMin: 30, gapMin: 20, license: null, deviceId: null, lastBackup: null, lastCam: null, installDismissed: false, createdAt: Date.now() } };
  }
  function num(v, lo, hi, def) { v = Number(v); return (v !== null && v !== '' && isFinite(v) && v >= lo && v <= hi) ? v : def; }
  function migrate(s) {
    var d = defaults();
    if (!s || typeof s !== 'object') return d;
    var out = { schema: SCHEMA, cameras: [], deer: [], pulls: [], settings: d.settings };
    var st = (s.settings && typeof s.settings === 'object') ? s.settings : {};
    ['license', 'deviceId', 'lastBackup', 'lastCam', 'installDismissed', 'createdAt'].forEach(function (k) { if (st[k] !== undefined) out.settings[k] = st[k]; });
    out.settings.lat = (st.lat === null || st.lat === undefined || st.lat === '') ? null : num(st.lat, -90, 90, null);
    out.settings.lng = (st.lng === null || st.lng === undefined || st.lng === '') ? null : num(st.lng, -180, 180, null);
    if (out.settings.lat === null || out.settings.lng === null) { out.settings.lat = null; out.settings.lng = null; }
    out.settings.shootMin = num(st.shootMin, 0, 90, 30);
    out.settings.gapMin = num(st.gapMin, 1, 240, 20);
    out.settings.lastCam = typeof out.settings.lastCam === 'string' ? out.settings.lastCam.slice(0, 40) : null;
    var seen = {};
    (Array.isArray(s.cameras) ? s.cameras : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var id = clampStr(c.id || uid(), 40); if (seen[id]) return; seen[id] = 1;
      out.cameras.push({ id: id, name: clampStr(c.name || 'Camera', 60), offsetMin: Math.round(num(c.offsetMin, -5256000, 5256000, 0)), created: num(c.created, 0, 1e14, Date.now()) });
    });
    (Array.isArray(s.deer) ? s.deer : []).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      var id = clampStr(b.id || uid(), 40); if (seen[id]) return; seen[id] = 1;
      out.deer.push({ id: id, name: clampStr(b.name || 'Buck', 60), notes: clampStr(b.notes, 2000), created: num(b.created, 0, 1e14, Date.now()) });
    });
    (Array.isArray(s.pulls) ? s.pulls : []).forEach(function (u) {
      if (!u || typeof u !== 'object') return;
      out.pulls.push({ id: clampStr(u.id || uid(), 40), cam: clampStr(u.cam, 40), at: num(u.at, 0, 1e14, Date.now()), count: num(u.count, 0, 1e7, 0), noTime: num(u.noTime, 0, 1e7, 0) });
    });
    var L = out.settings.license;
    if (L && (typeof L !== 'object' || (L.ok && (!L.source || (L.source === 'dev' && !C.DEV_MODE))))) out.settings.license = null;
    return out;
  }
  function cleanPhoto(p, camIds, deerIds) {
    if (!p || typeof p !== 'object' || !p.id) return null;
    var tags = (Array.isArray(p.tags) ? p.tags : []).filter(function (t) { return KIND_LABEL[t]; });
    var dr = (Array.isArray(p.deer) ? p.deer : []).filter(function (d) { return deerIds[d]; });
    return {
      id: clampStr(p.id, 40), cam: camIds[p.cam] ? p.cam : null, pull: clampStr(p.pull, 40), name: clampStr(p.name, 200), size: num(p.size, 0, 1e11, 0),
      t: parseLocal(p.t) ? clampStr(p.t, 19) : null, tsrc: ['exif', 'stamp', 'file'].indexOf(p.tsrc) >= 0 ? p.tsrc : null,
      fileT: parseLocal(p.fileT) ? clampStr(p.fileT, 19) : null,
      tags: tags, deer: dr, done: !!p.done && (tags.length + dr.length > 0),
      thumb: p.thumb instanceof Blob ? p.thumb : null, added: num(p.added, 0, 1e14, Date.now())
    };
  }
  var saveTimer = null;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 120); }
  function flush() { clearTimeout(saveTimer); saveTimer = null; return DB ? kvPut('state', S).catch(function () { toast('Couldn’t save. Is your phone storage full?', 4000); }) : Promise.resolve(); }
  function cam(id) { for (var i = 0; i < S.cameras.length; i++) if (S.cameras[i].id === id) return S.cameras[i]; return null; }
  function deer(id) { for (var i = 0; i < S.deer.length; i++) if (S.deer[i].id === id) return S.deer[i]; return null; }
  function camName(id) { var c = cam(id); return c ? c.name : 'No camera'; }
  // Corrected time of a photo: recorded time + its camera's Clock Check correction.
  function eff(p) {
    var d = parseLocal(p.t); if (!d) return null;
    // The time printed on the photo comes from the same camera clock, so the correction applies to every source.
    var c = cam(p.cam); if (c && c.offsetMin) d = new Date(d.getTime() + c.offsetMin * 60000);
    return d;
  }
  function isSorted(p) { return p.done; }

  /* thumbnails: object URLs cached by id */
  var urlCache = {};
  function thumbURL(p) {
    if (!p || !p.thumb) return '';
    if (!urlCache[p.id]) { try { urlCache[p.id] = URL.createObjectURL(p.thumb); } catch (e) { return ''; } }
    return urlCache[p.id];
  }
  function dropURL(id) { if (urlCache[id]) { URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; } }
  /* ---------------- EXIF (JPEG) date/time reader ---------------- */
  // Returns { dt: "YYYY-MM-DDTHH:MM:SS"|null, make, model } or null if no EXIF.
  function readExif(buf) {
    try {
      var v = new DataView(buf), len = v.byteLength;
      if (len < 4 || v.getUint16(0) !== 0xFFD8) return null;
      var off = 2;
      while (off + 4 <= len) {
        var marker = v.getUint16(off);
        if ((marker & 0xFF00) !== 0xFF00) return null;
        if (marker === 0xFFD9 || marker === 0xFFDA) return null;
        var segLen = v.getUint16(off + 2);
        if (marker === 0xFFE1 && off + 10 <= len && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) return parseTiff(v, off + 10, Math.min(len, off + 2 + segLen));
        off += 2 + segLen;
      }
    } catch (e) {}
    return null;
  }
  function parseTiff(v, t, end) {
    var bo = v.getUint16(t); if (bo !== 0x4949 && bo !== 0x4D4D) return null;
    var le = bo === 0x4949;
    function u16(o) { return v.getUint16(o, le); }
    function u32(o) { return v.getUint32(o, le); }
    if (u16(t + 2) !== 42) return null;
    function ascii(entry) {
      var type = u16(entry + 2), count = u32(entry + 4);
      if (type !== 2 || count > 200) return '';
      var start = count <= 4 ? entry + 8 : t + u32(entry + 8), s = '';
      for (var i = 0; i < count && start + i < end; i++) { var ch = v.getUint8(start + i); if (ch === 0) break; s += String.fromCharCode(ch); }
      return s.trim();
    }
    function readIFD(o, want) {
      var out = {};
      if (o + 2 > end) return out;
      var n = u16(o); if (n > 500) return out;
      for (var i = 0; i < n; i++) {
        var e = o + 2 + i * 12; if (e + 12 > end) break;
        var tag = u16(e);
        if (want.indexOf(tag) >= 0) out[tag] = (tag === 0x8769) ? u32(e + 8) : ascii(e);
      }
      return out;
    }
    var ifd0 = readIFD(t + u32(t + 4), [0x010F, 0x0110, 0x0132, 0x8769]);
    var ex = ifd0[0x8769] ? readIFD(t + ifd0[0x8769], [0x9003, 0x9004]) : {};
    var dt = exifDate(ex[0x9003]) || exifDate(ex[0x9004]) || exifDate(ifd0[0x0132]);
    return { dt: dt, make: ifd0[0x010F] || '', model: ifd0[0x0110] || '' };
  }
  function exifDate(s) {
    var m = /^(\d{4})[:\-\/](\d{2})[:\-\/](\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/.exec(s || '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +(m[6] || 0);
    if (y < 1995 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + pad(se);
  }

  /* ---------------- sunrise / sunset (computed on the phone) ---------------- */
  // Sunrise/sunset (standard -0.833° altitude), after the well-known suncalc formulas.
  var RAD = Math.PI / 180, DAYMS = 864e5, J1970 = 2440588, J2000 = 2451545, OBL = RAD * 23.4397;
  function toDays(date) { return date.valueOf() / DAYMS - 0.5 + J1970 - J2000; }
  function fromJulian(j) { return new Date((j + 0.5 - J1970) * DAYMS); }
  var sunCache = {};
  function sunTimes(date, lat, lng) {
    var key = date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate() + '|' + lat + '|' + lng;
    if (sunCache[key]) return sunCache[key];
    var noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    var lw = RAD * -lng, phi = RAD * lat, d = toDays(noon);
    var n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    var ds = 0.0009 + lw / (2 * Math.PI) + n;
    var M = RAD * (357.5291 + 0.98560028 * ds);
    var Cc = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + Cc + RAD * 102.9372 + Math.PI;
    var dec = Math.asin(Math.sin(OBL) * Math.sin(L));
    var Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    var cosw = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    var r;
    if (cosw > 1) r = { rise: null, set: null, polar: 'night' };
    else if (cosw < -1) r = { rise: null, set: null, polar: 'day' };
    else {
      var w = Math.acos(cosw);
      var a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
      var Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      r = { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
    }
    sunCache[key] = r; return r;
  }
  function hasLoc() { return S.settings.lat !== null && S.settings.lng !== null; }
  // 'day' (sunrise..sunset), 'light' (shooting light: shootMin before sunrise / after sunset), 'dark', or null (no location set)
  function lightOf(d) {
    if (!d || !hasLoc()) return null;
    var st = sunTimes(d, S.settings.lat, S.settings.lng);
    if (st.polar) return st.polar === 'day' ? 'day' : 'dark';
    var t = d.getTime(), m = S.settings.shootMin * 60000;
    if (t >= st.rise.getTime() && t <= st.set.getTime()) return 'day';
    if ((t >= st.rise.getTime() - m && t < st.rise.getTime()) || (t > st.set.getTime() && t <= st.set.getTime() + m)) return 'light';
    return 'dark';
  }
  function sunNote(d) {
    if (!d || !hasLoc()) return '';
    var st = sunTimes(d, S.settings.lat, S.settings.lng); if (st.polar) return '';
    var t = d.getTime(), toR = Math.round((t - st.rise.getTime()) / 60000), toS = Math.round((t - st.set.getTime()) / 60000);
    function hm(x) { x = Math.abs(x); return x >= 60 ? Math.floor(x / 60) + 'h ' + (x % 60) + 'm' : x + 'm'; }
    if (Math.abs(toR) <= Math.abs(toS)) return hm(toR) + (toR < 0 ? ' before' : ' after') + ' sunrise (' + fmtTime(st.rise) + ')';
    return hm(toS) + (toS < 0 ? ' before' : ' after') + ' sunset (' + fmtTime(st.set) + ')';
  }
  var LIGHT_LABEL = { day: 'Daylight', light: 'Shooting light', dark: 'Dark' };
  /* ---------------- Pro / license key (Gumroad, same approach as Rowbin) ---------------- */
  function maskKey(k) { k = String(k || ''); return k.length > 8 ? k.slice(0, 4) + '…' + k.slice(-4) : k; }
  function isPro() { return !!(S.settings.license && S.settings.license.ok); }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function proOnSale() { return !!C.GUMROAD_PRODUCT_ID; }
  function camLimit() { return isPro() ? 0 : (C.FREE_CAMERA_LIMIT || 0); }
  function buckLimit() { return isPro() ? 0 : (C.FREE_BUCK_LIMIT || 0); }
  function canAddCam() { var l = camLimit(); return !l || S.cameras.length < l; }
  function canAddBuck() { var l = buckLimit(); return !l || S.deer.length < l; }
  function sha256Hex(str) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    return Promise.resolve('');
  }
  function deviceId() { if (!S.settings.deviceId) { S.settings.deviceId = uid() + uid(); save(); } return S.settings.deviceId; }
  function supportLine() { return ' For help, contact the seller through your Gumroad receipt.'; }
  function gumroadVerify(key, increment) {
    var body = new URLSearchParams();
    body.set('product_id', C.GUMROAD_PRODUCT_ID || '');
    body.set('license_key', key);
    body.set('increment_uses_count', increment ? 'true' : 'false');
    var ctrl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(C.LICENSE_VERIFY_URL || 'https://api.gumroad.com/v2/licenses/verify', { method: 'POST', body: body, signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function (r) { clearTimeout(to); return r.json().catch(function () { return { success: false, message: 'Unexpected reply from Gumroad (HTTP ' + r.status + ').', _http: r.status }; }).then(function (j) { j._http = r.status; return j; }); })
      .catch(function (e) { clearTimeout(to); return { _network: true, message: String(e && e.message || e) }; });
  }
  function judge(j) {
    if (!j || j._network) return { state: 'network', msg: 'Couldn’t reach Gumroad. Connect to the internet once to activate your key, then Pro works offline.' };
    if (!j.success) {
      if (j._http >= 500) return { state: 'network', msg: 'Gumroad is having trouble right now. Please try again in a few minutes.' };
      var m = String(j.message || '');
      var disabled = /disabled|revoked/i.test(m);
      return { state: disabled ? 'revoked' : 'invalid', msg: (disabled ? 'This license key has been disabled.' : 'That key wasn’t recognized for ' + APP + ' Pro. Check it against your Gumroad receipt.') + supportLine() };
    }
    var pu = j.purchase || {};
    if (pu.refunded) return { state: 'revoked', msg: 'This purchase was refunded, so the key no longer unlocks Pro.' + supportLine() };
    if (pu.chargebacked || (pu.disputed && !pu.dispute_won)) return { state: 'revoked', msg: 'This purchase was disputed or charged back, so the key no longer unlocks Pro.' + supportLine() };
    if (pu.subscription_ended_at || pu.subscription_cancelled_at || pu.subscription_failed_at) return { state: 'revoked', msg: 'This purchase is no longer active.' + supportLine() };
    if (C.GUMROAD_PRODUCT_ID && pu.product_id && pu.product_id !== C.GUMROAD_PRODUCT_ID) return { state: 'invalid', msg: 'That key belongs to a different product.' };
    return { state: 'valid', uses: typeof j.uses === 'number' ? j.uses : null, sale: pu.sale_id || pu.id || null, test: !!pu.test };
  }
  function devUnlock(n) {
    if (!C.DEV_MODE) return Promise.resolve(false);
    return sha256Hex('buckledger:' + n).then(function (h) { return (C.DEV_UNLOCK_CODE_SHA256 || []).map(function (x) { return String(x).toLowerCase(); }).indexOf(h) !== -1; });
  }
  function tryUnlock(code) {
    var key = String(code || '').trim(), n = normCode(key);
    if (n.length < 4) return Promise.resolve({ ok: false, msg: 'Please enter your license key.' });
    return devUnlock(n).then(function (isDev) {
      if (isDev) { S.settings.license = { ok: true, key: key.toUpperCase(), at: Date.now(), source: 'dev', verifiedAt: Date.now() }; flush(); return { ok: true, msg: 'Dev unlock (DEV_MODE is on).' }; }
      if (!C.GUMROAD_PRODUCT_ID) return { ok: false, msg: 'Pro isn’t on sale yet, so keys can’t be checked. Please check back soon.' };
      if (navigator.onLine === false) return { ok: false, msg: 'You’re offline. Connect to the internet once to activate your key; after that Pro works offline.' };
      var cur = S.settings.license;
      var sameDevice = cur && cur.ok && cur.source === 'gumroad' && normCode(cur.key) === n;
      return gumroadVerify(key, !sameDevice).then(function (j) {
        var r = judge(j);
        if (r.state !== 'valid') {
          if (r.state === 'revoked' && sameDevice) { S.settings.license = null; save(); }
          return { ok: false, msg: r.msg };
        }
        var max = C.MAX_ACTIVATIONS || 0;
        if (!sameDevice && max && r.uses !== null && r.uses > max) {
          return { ok: false, msg: 'This key has already been activated on ' + r.uses + ' devices (limit ' + max + '). If you got a new phone, ' + 'contact the seller through your Gumroad receipt to reset it.' };
        }
        S.settings.license = { ok: true, key: key.toUpperCase(), at: (sameDevice && cur.at) || Date.now(), source: 'gumroad', verifiedAt: Date.now(), uses: r.uses, sale: r.sale, device: deviceId() };
        flush();
        return { ok: true, msg: sameDevice ? 'Key re-checked. Pro is active.' : 'Pro unlocked. Good luck this season! 🦌' };
      });
    });
  }
  function recheckLicense() {
    var L = S.settings.license, days = C.RECHECK_DAYS;
    if (!L || !L.ok || L.source !== 'gumroad' || !days || !C.GUMROAD_PRODUCT_ID || navigator.onLine === false) return Promise.resolve(null);
    if (L.verifiedAt && Date.now() - L.verifiedAt < days * DAYMS) return Promise.resolve(null);
    return gumroadVerify(L.key, false).then(function (j) {
      var r = judge(j);
      if (r.state === 'valid') { L.verifiedAt = Date.now(); if (r.uses !== null) L.uses = r.uses; save(); }
      else if (r.state === 'revoked') { S.settings.license = { ok: false, key: L.key, revokedAt: Date.now(), reason: r.msg }; save(); render(); toast(r.msg, 6000); }
      return r.state;
    });
  }

  /* ---------------- visits + reads ---------------- */
  var SUBJECTS = [['all', 'All deer'], ['bucks', 'All bucks'], ['doe', 'Does'], ['fawn', 'Fawns'], ['other', 'Other animals'], ['any', 'Everything']];
  function subjectLabel(sub) {
    if (sub.indexOf('deer:') === 0) { var b = deer(sub.slice(5)); return b ? b.name : 'Buck'; }
    for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i][0] === sub) return SUBJECTS[i][1];
    return sub;
  }
  function matches(p, sub) {
    if (!p.done) return false;
    if (sub.indexOf('deer:') === 0) return p.deer.indexOf(sub.slice(5)) >= 0;
    if (sub === 'any') return p.tags.indexOf('empty') < 0;
    if (sub === 'all') return p.deer.length > 0 || p.tags.indexOf('buck') >= 0 || p.tags.indexOf('doe') >= 0 || p.tags.indexOf('fawn') >= 0;
    if (sub === 'bucks') return p.deer.length > 0 || p.tags.indexOf('buck') >= 0;
    return p.tags.indexOf(sub) >= 0;
  }
  // A visit = matching photos at one camera, each within gapMin minutes of the one before.
  function visits(sub, camFilter) {
    var gap = S.settings.gapMin * 60000, byCam = {}, noTime = 0;
    P.forEach(function (p) {
      if (!matches(p, sub) || (camFilter && p.cam !== camFilter)) return;
      var d = eff(p); if (!d) { noTime++; return; }
      (byCam[p.cam || '_'] = byCam[p.cam || '_'] || []).push({ p: p, d: d });
    });
    var out = [];
    Object.keys(byCam).forEach(function (k) {
      var cur = null;
      byCam[k].sort(function (a, b) { return a.d - b.d; }).forEach(function (x) {
        if (cur && x.d - cur.end <= gap) { cur.photos.push(x.p); cur.end = x.d; }
        else { cur = { cam: x.p.cam, d: x.d, end: x.d, photos: [x.p] }; out.push(cur); }
      });
    });
    out.forEach(function (v) { v.light = lightOf(v.d); });
    out.sort(function (a, b) { return b.d - a.d; });
    out.noTime = noTime;
    return out;
  }
  function whoOf(v) {
    var names = {}, kinds = {};
    v.photos.forEach(function (p) { p.deer.forEach(function (d) { var b = deer(d); if (b) names[b.name] = 1; }); p.tags.forEach(function (t) { if (t !== 'empty') kinds[t] = 1; }); });
    var n = Object.keys(names);
    if (n.length) { delete kinds.buck; }
    return n.concat(Object.keys(kinds).map(function (k) { return KIND_LABEL[k]; })).join(', ') || 'Unsorted';
  }
  function tally(vs) {
    var t = { n: vs.length, photos: 0, light: { day: 0, light: 0, dark: 0, none: 0 }, byCam: {}, litByCam: {}, mins: [] };
    vs.forEach(function (v) {
      t.photos += v.photos.length;
      t.light[v.light || 'none']++;
      var k = v.cam || '_';
      t.byCam[k] = (t.byCam[k] || 0) + 1;
      if (v.light === 'day' || v.light === 'light') t.litByCam[k] = (t.litByCam[k] || 0) + 1;
      t.mins.push(v.d.getHours() * 60 + v.d.getMinutes());
    });
    return t;
  }
  // Busiest window of `w` minutes (wrapping past midnight), counted from visit start times.
  function busiest(mins, w) {
    if (!mins.length) return null;
    var best = null;
    mins.forEach(function (m0) {
      var c = 0; mins.forEach(function (m) { var dd = (m - m0 + 1440) % 1440; if (dd < w) c++; });
      if (!best || c > best.c) best = { start: m0, c: c };
    });
    // tighten: end = last visit inside the window
    var end = best.start; mins.forEach(function (m) { var dd = (m - best.start + 1440) % 1440; if (dd < w && dd > (end - best.start + 1440) % 1440) end = m; });
    return { start: best.start, end: end, count: best.c };
  }
  function fmtMin(m) { m = ((m % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ':' + pad(mi) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function topKey(o) { var b = null; Object.keys(o).forEach(function (k) { if (b === null || o[k] > o[b]) b = k; }); return b; }
  function daysAgo(d) { var a = new Date(d); a.setHours(12, 0, 0, 0); var b = new Date(); b.setHours(12, 0, 0, 0); var n = Math.round((b - a) / DAYMS); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; }
  // The plain-English read for a buck (or any subject).
  function plainRead(vs) {
    var out = [];
    if (!vs.length) return out;
    var t = tally(vs), last = vs[0];
    out.push('Last on camera <b>' + esc(fmtDate(last.d)) + ' at ' + esc(fmtTime(last.d)) + '</b>, ' + esc(camName(last.cam)) + ' (' + daysAgo(last.d) + ').');
    out.push(plural(t.n, 'visit') + ' logged from ' + plural(t.photos, 'photo') + ', first ' + esc(fmtDate(vs[vs.length - 1].d)) + '.');
    if (hasLoc()) {
      var lit = t.light.day + t.light.light;
      out.push('<b>' + lit + ' of ' + t.n + '</b> in legal light' + (t.light.light ? ' (' + t.light.light + ' in the ' + S.settings.shootMin + '-minute edges around sunrise/sunset)' : '') + '; ' + t.light.dark + ' after dark.');
      var litV = vs.filter(function (v) { return v.light === 'day' || v.light === 'light'; });
      if (litV.length >= 2) {
        var lt = tally(litV), bw = busiest(lt.mins, 120), lc = topKey(lt.byCam);
        out.push('His daylight pattern: ' + (bw.count >= 2 ? '<b>' + bw.count + ' of ' + litV.length + '</b> daylight visits between <b>' + fmtMin(bw.start) + ' and ' + fmtMin(bw.end) + '</b>' : 'no repeat time yet') + (lc ? ', most at <b>' + esc(camName(lc === '_' ? null : lc)) + '</b>' : '') + '.');
      } else if (litV.length === 1) out.push('Only one daylight visit so far: ' + esc(fmtDate(litV[0].d)) + ' at ' + esc(fmtTime(litV[0].d)) + ', ' + esc(camName(litV[0].cam)) + '.');
      else out.push('No daylight visits yet. He’s been a night deer on your cameras.');
    } else {
      var bw2 = busiest(t.mins, 120);
      if (bw2 && bw2.count >= 2) out.push('Most visits between <b>' + fmtMin(bw2.start) + ' and ' + fmtMin(bw2.end) + '</b> (' + bw2.count + ' of ' + t.n + ').');
      out.push('<span class="muted">Add your property location in More to split daylight from dark.</span>');
    }
    var cams = Object.keys(t.byCam);
    if (cams.length > 1) { var tc = topKey(t.byCam); out.push('Shows up most at <b>' + esc(camName(tc === '_' ? null : tc)) + '</b> (' + t.byCam[tc] + ' of ' + t.n + ').'); }
    if (t.n < 5) out.push('<span class="muted">Fewer than 5 visits: treat this as an early hint, not a pattern.</span>');
    return out;
  }

  /* Day Ring: 24-hour dial. Midnight at the bottom, noon at the top. Night shaded from real sunrise/sunset. */
  function ringXY(cx, cy, r, min) { var a = min / 1440 * 2 * Math.PI; return [cx - r * Math.sin(a), cy + r * Math.cos(a)]; }
  function arcPath(cx, cy, r, m1, m2) {
    var p1 = ringXY(cx, cy, r, m1), p2 = ringXY(cx, cy, r, m2), large = ((m2 - m1 + 1440) % 1440) > 720 ? 1 : 0;
    return 'M' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
  }
  function dayRing(vs) {
    var cx = 150, cy = 150, R = 112, h = '<svg viewBox="0 0 300 300" role="img" aria-label="Day Ring: visits by time of day" id="day-ring">';
    var refDate = vs.length ? vs[Math.floor(vs.length / 2)].d : new Date();
    // light band: 96 slots of 15 minutes
    for (var i = 0; i < 96; i++) {
      var m = i * 15, cat = null;
      if (hasLoc()) cat = lightOf(new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), Math.floor((m + 7) / 60), (m + 7) % 60));
      var col = cat === 'day' ? '#f3d98b' : cat === 'light' ? '#e7a35c' : cat === 'dark' ? '#3b4c7e' : '#d9cfb3';
      h += '<path d="' + arcPath(cx, cy, R, m, m + 15.5) + '" stroke="' + col + '" stroke-width="26" fill="none"/>';
    }
    [0, 360, 720, 1080].forEach(function (m, k) {
      var p = ringXY(cx, cy, R + 27, m);
      h += '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + 4).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#6b6553">' + ['12a', '6a', '12p', '6p'][k] + '</text>';
    });
    for (var t = 0; t < 24; t++) { var a1 = ringXY(cx, cy, R - 14, t * 60), a2 = ringXY(cx, cy, R - (t % 6 ? 18 : 22), t * 60); h += '<line x1="' + a1[0].toFixed(1) + '" y1="' + a1[1].toFixed(1) + '" x2="' + a2[0].toFixed(1) + '" y2="' + a2[1].toFixed(1) + '" stroke="#b3a988" stroke-width="1.5"/>'; }
    // visit dots, stacked inward when close together
    var placed = [];
    vs.slice().sort(function (a, b) { return (a.d.getHours() * 60 + a.d.getMinutes()) - (b.d.getHours() * 60 + b.d.getMinutes()); }).forEach(function (v) {
      var m = v.d.getHours() * 60 + v.d.getMinutes(), lane = 0;
      while (placed.some(function (q) { return q.lane === lane && Math.min(Math.abs(q.m - m), 1440 - Math.abs(q.m - m)) < 22; })) lane++;
      placed.push({ m: m, lane: lane });
      var p = ringXY(cx, cy, R - 34 - Math.min(lane, 6) * 11, m);
      var fill = v.light === 'day' ? '#b8860b' : v.light === 'light' ? '#c4621a' : v.light === 'dark' ? '#1f2c55' : '#4a4a3c';
      h += '<circle class="dot" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5.5" fill="' + fill + '" stroke="#fffaf0" stroke-width="1.5"><title>' + esc(fmtDate(v.d) + ' ' + fmtTime(v.d) + ' · ' + camName(v.cam)) + '</title></circle>';
    });
    h += '<text x="150" y="146" text-anchor="middle" font-size="30" font-weight="800" fill="#2a2b22" font-family="Georgia,serif">' + vs.length + '</text>';
    h += '<text x="150" y="166" text-anchor="middle" font-size="12" fill="#6b6553">' + (vs.length === 1 ? 'visit' : 'visits') + '</text></svg>';
    return h;
  }
  /* Season Strip: one square per day, gold if he showed in legal light that day, navy if only after dark. */
  function seasonStrip(vs) {
    if (!vs.length) return '';
    var byDay = {};
    vs.forEach(function (v) {
      var k = v.d.getFullYear() + '-' + v.d.getMonth() + '-' + v.d.getDate();
      var lit = v.light === 'day' || v.light === 'light';
      byDay[k] = byDay[k] === 'lit' || lit ? 'lit' : (v.light === 'dark' ? 'dk' : (byDay[k] || 'seen'));
    });
    var last = vs[0].d, first = vs[vs.length - 1].d;
    var end = new Date(Math.max(last, Math.min(Date.now(), last.getTime() + 14 * DAYMS))); end.setHours(12, 0, 0, 0);
    var start = new Date(first); start.setHours(12, 0, 0, 0); start = new Date(start.getTime() - 3 * DAYMS);
    if ((end - start) / DAYMS > 150) start = new Date(end.getTime() - 150 * DAYMS);
    var h = '<div class="strip" id="season-strip">', prevMo = -1;
    for (var d = new Date(start); d <= end; d = new Date(d.getTime() + DAYMS)) {
      d.setHours(12, 0, 0, 0);
      var k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(), c = byDay[k];
      h += '<div class="sday ' + (c || '') + '" title="' + esc(fmtDate(d)) + '">' + (d.getMonth() !== prevMo ? '<span class="mo">' + MON[d.getMonth()] + '</span>' : '') + d.getDate() + '</div>';
      prevMo = d.getMonth();
    }
    return h + '</div>';
  }
  function lightMark(l) { return '<i class="mk ' + (l || 'none') + '"></i>'; }
  function legend() {
    return hasLoc() ? '<div class="legend"><span>' + lightMark('day') + 'Daylight</span><span>' + lightMark('light') + 'Shooting light (' + S.settings.shootMin + ' min edge)</span><span>' + lightMark('dark') + 'Dark</span></div>'
      : '<div class="legend"><span>' + lightMark(null) + 'Set your property location in <a href="#/more">More</a> to mark daylight, shooting light and dark.</span></div>';
  }

  /* ---------------- router ---------------- */
  var R = { view: '', id: '', q: {} };
  function parseHash() {
    var h = (location.hash || '#/').slice(1), qi = h.indexOf('?'), q = {};
    if (qi >= 0) { h.slice(qi + 1).split('&').forEach(function (kv) { var a = kv.split('='); if (a[0]) { try { q[decodeURIComponent(a[0])] = decodeURIComponent(a[1] || ''); } catch (e) {} } }); h = h.slice(0, qi); }
    var parts = h.replace(/^\/+/, '').split('/');
    var id = ''; try { id = parts[1] ? decodeURIComponent(parts[1]) : ''; } catch (e) {}
    return { view: parts[0] || 'ledger', id: id, q: q };
  }
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  var VIEWS = {};
  function render() {
    if (!S) return;
    R = parseHash();
    var v = VIEWS[R.view] || VIEWS.ledger, html;
    try { html = v(); } catch (e) { if (window.console) console.error(e); html = '<div class="panel">Something went wrong showing this screen. <a href="#/">Back to the Ledger</a></div>'; }
    $('#app').innerHTML = v.full ? html : '<main class="wrap">' + html + '</main>';
    renderNav(!!v.full);
    document.body.classList.toggle('full', !!v.full);
    if (v.after) v.after();
  }
  function unsortedCount() { var n = 0; P.forEach(function (p) { if (!p.done) n++; }); return n; }
  function noTimeCount() { var n = 0; P.forEach(function (p) { if (!p.t) n++; }); return n; }
  var ICONS = {
    ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M11 8h6M11 12h6M11 16h4"/></svg>',
    sort: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M6 20h4M14 20h4"/></svg>',
    bucks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3c-2 2-2 5 0 7M16 3c2 2 2 5 0 7M8 10c1 1 2 1.5 4 1.5s3-.5 4-1.5M9 12c0 4 1.3 8 3 8s3-4 3-8"/></svg>',
    cams: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M10 16h4"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>'
  };
  function renderNav(hidden) {
    var nav = $('#nav'); nav.className = hidden ? 'hide' : '';
    if (hidden) { nav.innerHTML = ''; return; }
    var u = unsortedCount();
    var items = [['ledger', '#/', 'Ledger'], ['sort', '#/sort', 'Sort Pass'], ['bucks', '#/bucks', 'Bucks'], ['cams', '#/cams', 'Cameras'], ['more', '#/more', 'More']];
    var on = { buck: 'bucks', photo: 'ledger', pull: 'ledger', stamp: 'ledger', clock: 'cams', cam: 'cams' }[R.view] || R.view;
    nav.innerHTML = items.map(function (it) {
      return '<a href="' + it[1] + '" class="' + (on === it[0] ? 'on' : '') + '" data-nav="' + it[0] + '">' + ICONS[it[0]] + it[2] + (it[0] === 'sort' && u ? '<span class="badge">' + (u > 999 ? '999+' : u) + '</span>' : '') + '</a>';
    }).join('');
  }
  function head(title, back, cls) { return '<div class="head">' + (back ? '<a class="back" href="' + back + '">‹ Back</a>' : '') + '<h1 class="' + (cls || '') + '">' + esc(title) + '</h1></div>'; }
  function filesTip() {
    return '<div class="tip" id="files-tip"><b>Keep each photo’s date &amp; time:</b> ' + (isIOS()
      ? 'on iPhone, tap <b>Choose Files</b> or <b>Browse</b> and pick from the <b>Files</b> app or your SD card reader. Picking from the Photos library can strip the time.'
      : 'pick from your <b>Files</b> app or SD card reader when you can. Some gallery pickers strip the time.') +
      ' If a camera only prints the time on the picture, the Stamp Reader helps you type it in.</div>';
  }

  /* ---------------- The Ledger (main screen) ---------------- */
  var ledgerF = { who: 'all', cam: '' }, ledgerLimit = 80;
  VIEWS.ledger = function () {
    var h = '<div class="head"><h1 class="brand">' + esc(APP) + '</h1></div>';
    if (!P.length) {
      return h + '<div class="paper welcome"><div class="big">📒</div><h2 style="font-family:Georgia,serif">Your trail cam logbook</h2>' +
        '<p class="muted">It fills itself in from your SD card. Photos never leave this phone. No account, no subscription.</p>' +
        '<ol class="steps"><li><b>Log a Pull:</b> pick a camera and the photos from its card.</li><li><b>Sort Pass:</b> one photo at a time, tap who it is.</li><li><b>Read the Ledger:</b> every visit, when and where, in daylight or dark.</li></ol>' +
        '<a class="btn go block" href="#/pull" data-act="first-pull">Log your first Pull</a></div>' + filesTip() + installNote();
    }
    var u = unsortedCount(), nt = noTimeCount();
    h += '<div class="actions"><a class="act main" href="#/pull"><b>Log a Pull</b><span>add photos</span></a>' +
      '<a class="act ' + (u ? 'hot' : '') + '" href="#/sort" id="act-sort"><b>Sort Pass</b><span>' + (u ? u + ' waiting' : 'all sorted ✓') + '</span></a>' +
      '<a class="act ' + (nt ? 'hot' : '') + '" href="#/stamp" id="act-stamp"><b>Stamp Reader</b><span>' + (nt ? nt + ' need a time' : 'all timed ✓') + '</span></a></div>';
    var whoOpts = SUBJECTS.concat(S.deer.map(function (b) { return ['deer:' + b.id, '★ ' + b.name]; }));
    if (!whoOpts.some(function (o) { return o[0] === ledgerF.who; })) ledgerF.who = 'all';
    if (ledgerF.cam && !cam(ledgerF.cam)) ledgerF.cam = '';
    h += '<div class="filters"><select id="f-who" aria-label="Who">' + whoOpts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === ledgerF.who ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' +
      '<select id="f-cam" aria-label="Camera"><option value="">All cameras</option>' + S.cameras.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === ledgerF.cam ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></div>';
    var vs = visits(ledgerF.who, ledgerF.cam);
    h += legend();
    // interleave Pull entries (by when they were logged) with visits (by when they happened)
    var pulls = S.pulls.filter(function (u2) { return !ledgerF.cam || u2.cam === ledgerF.cam; }).map(function (u2) { return { pull: u2, d: new Date(u2.at) }; });
    var rows = vs.slice(0, ledgerLimit).map(function (v) { return { v: v, d: v.d }; }).concat(pulls).sort(function (a, b) { return b.d - a.d; });
    if (!vs.length) {
      h += '<div class="paper"><p style="margin:0">' + (u ? 'No visits yet for <b>' + esc(subjectLabel(ledgerF.who)) + '</b>. <a href="#/sort">Run a Sort Pass</a> to tag the ' + plural(u, 'photo') + ' waiting.' : 'No visits for <b>' + esc(subjectLabel(ledgerF.who)) + '</b>' + (ledgerF.cam ? ' at this camera' : '') + ' yet.') + '</p></div>';
    }
    h += '<div class="ledger" id="ledger">';
    var lastDay = '';
    rows.forEach(function (r) {
      if (r.pull) {
        h += '<div class="lpull" data-pull="' + esc(r.pull.id) + '">📥 <span><b>Pull logged</b> · ' + esc(camName(r.pull.cam)) + ' · ' + plural(r.pull.count, 'photo') + ' · ' + esc(fmtDate(r.d)) + '</span></div>';
        lastDay = ''; return;
      }
      var v = r.v, dk = fmtDate(v.d);
      if (dk !== lastDay) { h += '<div class="lday">' + esc(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][v.d.getDay()] + ', ' + dk) + '</div>'; lastDay = dk; }
      var cover = v.photos[0];
      h += '<button class="lrow" data-visit="' + esc(cover.id) + '" data-sub="' + esc(ledgerF.who) + '"><span class="tm">' + esc(fmtTime(v.d).replace(' ', '')) + '</span>' + lightMark(v.light) +
        '<span class="who"><b>' + esc(whoOf(v)) + '</b><span>' + esc(camName(v.cam)) + (v.light ? ' · ' + LIGHT_LABEL[v.light] : '') + '</span></span>' +
        '<span class="n">' + (v.photos.length > 1 ? '×' + v.photos.length : '') + '</span>' + (cover.thumb ? '<img alt="" loading="lazy" src="' + thumbURL(cover) + '">' : '') + '</button>';
    });
    h += '</div>';
    if (vs.length > ledgerLimit) h += '<button class="btn block" style="margin-top:10px" data-act="more-rows">Show older visits (' + (vs.length - ledgerLimit) + ' more)</button>';
    if (vs.noTime) h += '<p class="small muted" style="margin-top:8px">' + plural(vs.noTime, 'tagged photo') + ' left out: no time yet. <a href="#/stamp">Stamp Reader</a></p>';
    if (!S.settings.lastBackup && P.length >= 25) h += '<div class="panel small" style="margin-top:12px">💾 Your ledger lives only on this phone. <a href="#/more">Save a backup file</a> now and then.</div>';
    return h + installNote();
  };
  VIEWS.ledger.after = function () {
    var fw = $('#f-who'), fc = $('#f-cam');
    if (fw) fw.addEventListener('change', function () { ledgerF.who = fw.value; ledgerLimit = 80; render(); });
    if (fc) fc.addEventListener('change', function () { ledgerF.cam = fc.value; ledgerLimit = 80; render(); });
  };
  function visitSheet(coverId, sub) {
    var vs = visits(sub || 'any'), v = null;
    vs.some(function (x) { if (x.photos.some(function (p) { return p.id === coverId; })) { v = x; return true; } return false; });
    if (!v) return;
    var note = sunNote(v.d);
    sheet('<h2 style="font-family:Georgia,serif">' + esc(whoOf(v)) + '</h2><p class="muted" style="margin-bottom:6px">' + esc(fmtDate(v.d)) + ' · ' + esc(fmtTime(v.d)) + (v.photos.length > 1 ? '–' + esc(fmtTime(v.end)) : '') + ' · ' + esc(camName(v.cam)) + '</p>' +
      '<p class="small">' + lightMark(v.light) + ' ' + (v.light ? LIGHT_LABEL[v.light] : 'Light unknown (no property location)') + (note ? ' · ' + esc(note) : '') + '</p>' +
      '<div class="pgrid">' + v.photos.map(function (p) { var d = eff(p); return '<a href="#/photo/' + encodeURIComponent(p.id) + '" data-x="close">' + (p.thumb ? '<img alt="" src="' + thumbURL(p) + '">' : '') + '<span class="cap">' + esc(d ? fmtTime(d) : '') + '</span></a>'; }).join('') + '</div>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn ink" data-x="close">Close</button></div>', function (x) { if (x === 'close') { closeSheet(); return false; } });
  }
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; });
  function installNote() {
    if (isStandalone() || S.settings.installDismissed) return '';
    return '<div class="panel small" id="install-note" style="margin-top:12px"><b>Put it on your home screen</b> so it opens like an app and works with no signal. ' +
      (isIOS() ? 'In Safari tap <b>Share</b> → <b>Add to Home Screen</b>.' : (deferredInstall ? '<button class="btn sm" data-act="install">Install</button>' : 'Browser menu (⋮) → <b>Add to Home screen</b>.')) +
      ' <button class="btn sm plain" data-act="install-dismiss">Got it</button></div>';
  }

  /* ---------------- Log a Pull ---------------- */
  var pullState = null; // { running, finished, total, done, added, dup, skipped, noTime, failedThumb, pull, cam }
  VIEWS.pull = function () {
    var h = head('Log a Pull', '#/');
    if (pullState && pullState.running) {
      return h + '<div class="paper"><h3>Logging the pull…</h3><p class="muted small" id="pull-status">' + pullState.done + ' of ' + pullState.total + '</p><div class="progress"><i id="pull-bar" style="width:' + (pullState.total ? pullState.done / pullState.total * 100 : 0) + '%"></i></div><p class="small muted" style="margin:0">Keep this screen open. Photos are shrunk and kept on this phone only.</p></div>';
    }
    if (pullState && pullState.finished) {
      var r = pullState;
      return h + '<div class="paper" id="pull-result"><h3 style="font-family:Georgia,serif">Pull logged: ' + plural(r.added, 'photo') + ' from ' + esc(camName(r.cam)) + '</h3><ul class="small" style="padding-left:18px;margin:6px 0 12px">' +
        (r.dup ? '<li>' + plural(r.dup, 'duplicate') + ' skipped (already in your ledger)</li>' : '') +
        (r.skipped ? '<li>' + plural(r.skipped, 'file') + ' skipped (videos or not photos)</li>' : '') +
        (r.failedThumb ? '<li>' + plural(r.failedThumb, 'photo') + ' couldn’t be opened by this browser (kept without a picture)</li>' : '') +
        (r.noTime ? '<li><b>' + plural(r.noTime, 'photo') + ' had no date/time in the file.</b> Use the Stamp Reader to type the time printed on them.</li>' : (r.added ? '<li>Every photo had a date and time ✓</li>' : '')) + '</ul>' +
        (r.added ? '<a class="btn go block" href="#/sort">Start the Sort Pass</a>' : '') +
        '<div class="btn-row" style="margin-top:8px">' + (r.noTime ? '<a class="btn ink" href="#/stamp">Stamp Reader</a>' : '') + (r.added ? '<a class="btn ink" href="#/clock/' + encodeURIComponent(r.cam) + '">Clock Check</a>' : '') + '<button class="btn ink" data-act="pull-again">Log another</button></div>' +
        (r.added ? '<p class="tiny muted" style="margin:8px 0 0">Clock Check: if this camera’s clock was off (batteries pulled, daylight saving), fix the whole camera from one photo.</p>' : '') + '</div>';
    }
    var opts = S.cameras.map(function (c) { return '<option value="' + esc(c.id) + '"' + (S.settings.lastCam === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    var canNew = canAddCam();
    h += '<div class="paper"><label class="field"><span>Which camera is this card from?</span><select id="pull-cam">' + opts + (canNew ? '<option value="__new"' + (!S.cameras.length ? ' selected' : '') + '>＋ New camera…</option>' : '') + '</select></label>' +
      '<label class="field" id="pull-new-wrap" style="display:' + (!S.cameras.length ? 'block' : 'none') + '"><span>Camera name</span><input type="text" id="pull-new" maxlength="60" placeholder="e.g. Creek crossing, Food plot, Stand East"></label>' +
      (!canNew ? '<p class="small muted">' + freeLine('cam') + '</p>' : '') +
      '<button class="btn go block" data-act="pick-photos">Choose photos</button><input type="file" id="pull-file" accept="image/*" multiple hidden>' +
      '<p class="small muted" style="margin:10px 0 0">Select all the photos from this card at once. Nothing is uploaded. Duplicates are skipped, so re-picking the same card is safe.</p></div>' + filesTip();
    return h;
  };
  VIEWS.pull.after = function () {
    var sel = $('#pull-cam'); if (!sel) return;
    sel.addEventListener('change', function () { $('#pull-new-wrap').style.display = sel.value === '__new' ? 'block' : 'none'; });
    $('#pull-file').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
      if (!files.length) return;
      var camId = sel.value;
      if (camId === '__new') {
        var name = ($('#pull-new').value || '').trim();
        if (!name) { toast('Name the camera first'); return; }
        camId = addCamera(name); if (!camId) return;
      }
      runPull(files, camId);
    });
  };
  function freeLine(kind) {
    return kind === 'cam' ? 'The free version keeps ' + plural(camLimit(), 'camera') + '. <a href="#/more">Pro</a> unlocks unlimited cameras.'
      : 'The free version keeps ' + plural(buckLimit(), 'named buck') + '. <a href="#/more">Pro</a> unlocks unlimited bucks.';
  }
  function addCamera(name) {
    if (!canAddCam()) { proSheet('cam'); return null; }
    var c = { id: uid(), name: clampStr(String(name).trim() || 'Camera', 60), offsetMin: 0, created: Date.now() };
    S.cameras.push(c); save(); return c.id;
  }
  function addBuck(name) {
    if (!canAddBuck()) { proSheet('buck'); return null; }
    var b = { id: uid(), name: clampStr(String(name).trim() || 'Buck', 60), notes: '', created: Date.now() };
    S.deer.push(b); save(); return b.id;
  }
  function readHead(file, n) {
    var blob = file.slice(0, n);
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsArrayBuffer(blob); });
  }
  function makeThumb(file) {
    return new Promise(function (res) {
      var url; try { url = URL.createObjectURL(file); } catch (e) { return res(null); }
      var img = new Image(), done = false;
      var to = setTimeout(function () { if (!done) { done = true; URL.revokeObjectURL(url); res(null); } }, 20000);
      img.onload = function () {
        if (done) return; done = true; clearTimeout(to);
        try {
          var max = 1280, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob(function (b) { res(b); }, 'image/jpeg', 0.8);
        } catch (e) { URL.revokeObjectURL(url); res(null); }
      };
      img.onerror = function () { if (done) return; done = true; clearTimeout(to); URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }
  function isImageFile(f) { return /^image\//.test(f.type || '') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name || ''); }
  function runPull(files, camId) {
    S.settings.lastCam = camId; save();
    var pull = { id: uid(), cam: camId, at: Date.now(), count: 0, noTime: 0 };
    var seen = {}; P.forEach(function (p) { seen[p.name + '|' + p.size + '|' + (p.tsrc === 'exif' ? p.t : '')] = 1; });
    pullState = { running: true, total: files.length, done: 0, added: 0, dup: 0, skipped: 0, noTime: 0, failedThumb: 0, pull: pull.id, cam: camId };
    if (R.view !== 'pull') go('#/pull'); else render();
    var pending = [];
    function upd() { var s = $('#pull-status'), b = $('#pull-bar'); if (s) s.textContent = pullState.done + ' of ' + pullState.total; if (b) b.style.width = (pullState.done / pullState.total * 100) + '%'; }
    function flushPending() { if (!pending.length) return Promise.resolve(); var chunk = pending; pending = []; return photosPutMany(chunk); }
    var i = 0;
    function next() {
      if (i >= files.length) return flushPending().then(finish);
      var f = files[i++];
      if (!isImageFile(f)) { pullState.skipped++; pullState.done++; upd(); return next(); }
      return readHead(f, 262144).then(function (buf) { return readExif(buf); }, function () { return null; }).then(function (ex) {
        var dt = ex && ex.dt;
        var key = f.name + '|' + f.size + '|' + (dt || '');
        if (seen[key]) { pullState.dup++; return null; }
        seen[key] = 1;
        return makeThumb(f).then(function (thumb) {
          if (!thumb) pullState.failedThumb++;
          if (!dt) pullState.noTime++;
          var fd = f.lastModified ? new Date(f.lastModified) : null;
          var p = { id: uid(), cam: camId, pull: pull.id, name: clampStr(f.name, 200), size: f.size || 0, t: dt || null, tsrc: dt ? 'exif' : null,
            fileT: fd && !isNaN(fd) ? toLocalStr(fd) : null, tags: [], deer: [], done: false, thumb: thumb, added: Date.now() };
          P.push(p); PI[p.id] = p; pending.push(p); pullState.added++;
          if (pending.length >= 10) return flushPending();
        });
      }).then(function () { pullState.done++; upd(); return next(); }, function () { pullState.done++; upd(); return next(); });
    }
    function finish() {
      pull.count = pullState.added; pull.noTime = pullState.noTime;
      if (pull.count) S.pulls.push(pull);
      save(); pullState.running = false; pullState.finished = true;
      if (R.view === 'pull') render(); else renderNav();
    }
    requestPersist();
    return next().catch(function () { pullState.running = false; pullState.finished = true; save(); toast('The pull stopped early. Is your phone storage full?', 5000); render(); });
  }
  function requestPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); }).catch(function () {}); } catch (e) {}
  }

  /* ---------------- Sort Pass ---------------- */
  // One photo at a time; the tray at the bottom is within thumb reach.
  var sortSel = null, sortCur = null, sortLast = null, sortUndo = [], sortSkip = {};
  function sortQueue() {
    return P.filter(function (p) { return !p.done && !sortSkip[p.id]; }).sort(function (a, b) {
      if (a.cam !== b.cam) return String(a.cam).localeCompare(String(b.cam));
      if (a.t && b.t) return a.t < b.t ? -1 : a.t > b.t ? 1 : 0;
      if (a.t !== b.t) return a.t ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  }
  VIEWS.sort = function () {
    var q = sortQueue();
    if (!q.length && Object.keys(sortSkip).length) { sortSkip = {}; q = sortQueue(); }
    if (!q.length) {
      sortCur = null;
      return '<main class="wrap">' + head('Sort Pass', '#/') + '<div class="paper welcome"><div class="big">✅</div><h2 style="font-family:Georgia,serif">' + (P.length ? 'Everything is sorted' : 'Nothing to sort yet') + '</h2><p class="muted">' + (P.length ? 'New photos land here after you log a pull.' : 'Log a pull first, then sort the photos here.') + '</p>' +
        '<div class="btn-row">' + (sortUndo.length ? '<button class="btn ink" data-act="sort-undo">Undo last</button>' : '') + '<a class="btn go" href="' + (P.length ? '#/' : '#/pull') + '">' + (P.length ? 'Open the Ledger' : 'Log a Pull') + '</a></div></div></main>';
    }
    var p = (sortCur && PI[sortCur] && !PI[sortCur].done) ? PI[sortCur] : q[0];
    if (sortCur !== p.id) { sortCur = p.id; sortSel = { tags: p.tags.slice(), deer: p.deer.slice() }; }
    var d = eff(p), idx = q.indexOf(p);
    var h = '<div class="sp" id="sort-pass"><div class="sp-top"><a href="#/" aria-label="Close Sort Pass">✕ Done</a><span class="grow muted">' + (idx + 1) + ' of ' + q.length + ' · ' + esc(camName(p.cam)) + '</span>' +
      (sortUndo.length ? '<button data-act="sort-undo">↶ Undo</button>' : '') + '<button data-act="sort-skip">Skip ›</button></div>' +
      '<div class="sp-photo">' + (p.thumb ? '<img id="sp-img" alt="Trail camera photo" src="' + thumbURL(p) + '">' : '<span class="muted">No picture (this browser couldn’t open the file)</span>') + '</div>' +
      '<div class="sp-meta"><span class="mono">' + esc(d ? fmtDate(d) + ' ' + fmtTime(d) : 'No time yet') + '</span>' + (d && lightOf(d) ? ' ' + lightMark(lightOf(d)) + ' ' + LIGHT_LABEL[lightOf(d)] : '') +
      (!p.t ? ' · <a href="#/stamp/' + encodeURIComponent(p.id) + '">Read the stamp</a>' : '') + '<span class="grow"></span><span class="tiny">' + esc(p.name) + '</span></div>' +
      '<div class="tray"><div class="bucks">' + S.deer.map(function (b) { return '<button class="tok named' + (sortSel.deer.indexOf(b.id) >= 0 ? ' on' : '') + '" data-deer="' + esc(b.id) + '">★ ' + esc(b.name) + '</button>'; }).join('') +
      '<button class="tok add" data-act="sort-newbuck">＋ Name a buck</button></div>' +
      '<div class="kinds">' + KINDS.slice(0, 4).map(function (k) { return '<button class="tok' + (sortSel.tags.indexOf(k.id) >= 0 ? ' on' : '') + '" data-kind="' + k.id + '">' + k.label + '</button>'; }).join('') + '</div>' +
      '<div class="commit"><button class="tok empty" data-act="sort-empty">Empty ⏭</button><button class="tok" data-act="sort-same"' + (sortLast ? '' : ' disabled') + '>Same as last</button><button class="tok on" data-act="sort-file" id="sort-file">File it ✓</button></div></div></div>';
    return h;
  };
  VIEWS.sort.full = true;
  function sortCommit(sel) {
    var p = PI[sortCur]; if (!p) return;
    if (!sel.tags.length && !sel.deer.length) { toast('Tap who’s in the photo, or Empty'); return; }
    sortUndo.push({ id: p.id, tags: p.tags.slice(), deer: p.deer.slice(), done: p.done });
    if (sortUndo.length > 50) sortUndo.shift();
    p.tags = sel.tags.slice(); p.deer = sel.deer.slice(); p.done = true;
    if (p.tags.indexOf('empty') < 0) sortLast = { tags: p.tags.slice(), deer: p.deer.slice() };
    photoPut(p); sortCur = null; render();
  }
  function sortClick(e) {
    var t = e.target.closest('[data-deer],[data-kind],[data-act]'); if (!t || !$('#sort-pass')) return false;
    var dId = t.getAttribute('data-deer'), kind = t.getAttribute('data-kind'), act = t.getAttribute('data-act');
    if (dId) { var i = sortSel.deer.indexOf(dId); if (i >= 0) sortSel.deer.splice(i, 1); else sortSel.deer.push(dId); sortSel.tags = sortSel.tags.filter(function (x) { return x !== 'empty'; }); render(); return true; }
    if (kind) { var j = sortSel.tags.indexOf(kind); if (j >= 0) sortSel.tags.splice(j, 1); else sortSel.tags.push(kind); render(); return true; }
    if (act === 'sort-file') { sortCommit(sortSel); return true; }
    if (act === 'sort-empty') { sortCommit({ tags: ['empty'], deer: [] }); return true; }
    if (act === 'sort-same') { if (sortLast) sortCommit(sortLast); return true; }
    if (act === 'sort-skip') { if (sortCur) sortSkip[sortCur] = 1; sortCur = null; render(); return true; }
    if (act === 'sort-newbuck') {
      if (!canAddBuck()) { proSheet('buck'); return true; }
      promptSheet('Name a buck', 'Something you’ll recognize, like “Big 8” or “Split G2”.', 'Add buck').then(function (name) {
        if (!name) return; var id = addBuck(name); if (id && sortSel) { sortSel.deer.push(id); render(); }
      });
      return true;
    }
    return false;
  }
  function sortUndoLast() {
    var u = sortUndo.pop(); if (!u) return; var p = PI[u.id]; if (!p) return;
    p.tags = u.tags; p.deer = u.deer; p.done = u.done; photoPut(p);
    delete sortSkip[p.id]; sortCur = p.id; sortSel = { tags: p.tags.slice(), deer: p.deer.slice() }; go('#/sort'); render();
  }

  /* ---------------- Stamp Reader ---------------- */
  // For photos with no time in the file: zoom into the strip where cams print the time, and type it.
  var stampBand = 'bottom', stampLastDate = '';
  VIEWS.stamp = function () {
    var q = P.filter(function (p) { return !p.t; }).sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    var p = R.id && PI[R.id] && !PI[R.id].t ? PI[R.id] : q[0];
    var h = head('Stamp Reader', '#/');
    if (!p) return h + '<div class="paper welcome"><div class="big">🕑</div><h2 style="font-family:Georgia,serif">Every photo has a time</h2><p class="muted">When a camera doesn’t save the time in the file, those photos show up here so you can type the time printed on them.</p><a class="btn go" href="#/">Back to the Ledger</a></div>';
    var url = thumbURL(p), fd = parseLocal(p.fileT);
    h += '<p class="small muted" style="margin-top:-4px">' + plural(q.length, 'photo') + ' without a time · ' + esc(camName(p.cam)) + ' · <span class="mono">' + esc(p.name) + '</span></p>' +
      (url ? '<div class="stamp" id="stamp-zoom"><img alt="Zoomed time stamp" src="' + url + '" style="' + (stampBand === 'bottom' ? 'bottom:0;transform:translateX(' + stampShift + '%)' : 'top:0;transform:translateX(' + stampShift + '%)') + '"></div>' +
        '<div class="btn-row" style="margin:8px 0"><button class="btn sm" data-act="stamp-band">' + (stampBand === 'bottom' ? 'Stamp is at the top' : 'Stamp is at the bottom') + '</button><button class="btn sm" data-act="stamp-pan">Slide ⇆</button></div>' +
        '<img class="stamp-full" alt="Full photo" src="' + url + '">' : '<div class="panel">No picture for this file.</div>') +
      '<div class="paper"><div class="dt2"><label class="field"><span>Date on the photo</span><input type="date" id="stamp-date" value="' + esc(stampLastDate) + '"></label><label class="field"><span>Time on the photo</span><input type="time" id="stamp-time" step="1"></label></div>' +
      '<button class="btn go block" data-act="stamp-save" data-id="' + esc(p.id) + '">Save time &amp; next</button>' +
      '<div class="btn-row" style="margin-top:8px">' + (fd ? '<button class="btn ink sm" data-act="stamp-filedate" data-id="' + esc(p.id) + '">Use file date (' + esc(fmtDate(fd) + ' ' + fmtTime(fd)) + ')</button>' : '') + '<button class="btn ink sm" data-act="stamp-skip" data-id="' + esc(p.id) + '">Skip</button></div>' +
      '<p class="tiny muted" style="margin:8px 0 0">The file date is often when the card was copied, not when the photo was taken. Only use it if you know it’s right.</p></div>';
    return h;
  };
  var stampShift = 0;
  VIEWS.stamp.after = function () { var d = $('#stamp-date'); if (d && !d.value) d.focus(); };
  function stampSave(id, useFile) {
    var p = PI[id]; if (!p) return;
    var v;
    if (useFile) { v = p.fileT; if (!v) return; p.tsrc = 'file'; }
    else {
      var dv = ($('#stamp-date') || {}).value, tv = ($('#stamp-time') || {}).value;
      if (!dv || !tv) { toast('Type both the date and the time'); return; }
      v = dv + 'T' + (tv.length === 5 ? tv + ':00' : tv.slice(0, 8));
      if (!parseLocal(v)) { toast('That date/time doesn’t look right'); return; }
      stampLastDate = dv; p.tsrc = 'stamp';
    }
    p.t = v; photoPut(p); toast('Time saved'); go('#/stamp');
  }

  /* ---------------- Clock Check ---------------- */
  // Fix a whole camera's clock from ONE photo whose real time you know.
  function fmtOffset(m) {
    var a = Math.abs(m), d = Math.floor(a / 1440), h = Math.floor((a % 1440) / 60), mi = a % 60, parts = [];
    if (d) parts.push(plural(d, 'day')); if (h) parts.push(h + ' hr'); if (mi || !parts.length) parts.push(mi + ' min');
    return parts.join(' ');
  }
  VIEWS.clock = function () {
    var c = cam(R.id);
    if (!c) return head('Clock Check', '#/cams') + '<div class="panel">Pick a camera on the <a href="#/cams">Cameras</a> screen first.</div>';
    var photos = P.filter(function (p) { return p.cam === c.id && p.t; }).sort(function (a, b) { return a.t < b.t ? 1 : -1; });
    var h = head('Clock Check', '#/cam/' + encodeURIComponent(c.id)) + '<p class="muted small" style="margin-top:-4px">' + esc(c.name) + (c.offsetMin ? ' · current fix: clock ' + fmtOffset(c.offsetMin) + (c.offsetMin > 0 ? ' behind' : ' ahead') : ' · no clock fix') + '</p>';
    var sel = R.q.p && PI[R.q.p] && PI[R.q.p].cam === c.id && PI[R.q.p].t ? PI[R.q.p] : null;
    if (!sel) {
      h += '<div class="paper"><h3>1. Pick a photo you know the real time of</h3><p class="small muted">Tip: the last photo on a card is often you walking up to pull it, and you know when that was. Or snap the cam with your phone’s clock in view when you set it.</p>';
      if (!photos.length) h += '<p class="small">No photos with a time from this camera yet.</p>';
      h += '<div class="pgrid" id="clock-grid">' + photos.slice(0, 30).map(function (p) { var d = parseLocal(p.t); return '<a href="#/clock/' + encodeURIComponent(c.id) + '?p=' + encodeURIComponent(p.id) + '">' + (p.thumb ? '<img alt="" loading="lazy" src="' + thumbURL(p) + '">' : '') + '<span class="cap">' + esc(fmtDate(d) + ' ' + fmtTime(d)) + '</span></a>'; }).join('') + '</div>';
      if (photos.length > 30) h += '<p class="tiny muted" style="margin:6px 0 0">Showing the 30 newest.</p>';
      h += (c.offsetMin ? '<hr><button class="btn ink block" data-act="clock-clear" data-cam="' + esc(c.id) + '">Remove the clock fix</button>' : '') + '</div>';
      return h;
    }
    var rec = parseLocal(sel.t);
    h += '<div class="paper">' + (sel.thumb ? '<img class="photo-big" alt="" src="' + thumbURL(sel) + '">' : '') +
      '<p style="margin:10px 0 6px">The camera recorded: <b class="mono">' + esc(fmtDate(rec) + ' ' + fmtTime(rec)) + '</b></p>' +
      '<h3>2. When was it really taken?</h3><div class="dt2"><label class="field"><span>Real date</span><input type="date" id="clock-date" value="' + esc(sel.t.slice(0, 10)) + '"></label><label class="field"><span>Real time</span><input type="time" id="clock-time" value="' + esc(sel.t.slice(11, 16)) + '"></label></div>' +
      '<p id="clock-preview" class="small"></p>' +
      '<button class="btn go block" data-act="clock-apply" data-cam="' + esc(c.id) + '" data-p="' + esc(sel.id) + '">Fix this camera’s clock</button>' +
      '<a class="btn ink block" style="margin-top:8px" href="#/clock/' + encodeURIComponent(c.id) + '">Pick a different photo</a></div>';
    return h;
  };
  function clockOffsetFromInputs(p) {
    var dv = ($('#clock-date') || {}).value, tv = ($('#clock-time') || {}).value;
    var real = dv && tv ? parseLocal(dv + 'T' + tv.slice(0, 5) + ':' + (p.t.slice(17, 19) || '00')) : null, rec = parseLocal(p.t);
    if (!real || !rec) return null;
    return Math.round((real - rec) / 60000);
  }
  VIEWS.clock.after = function () {
    var p = R.q.p && PI[R.q.p]; if (!p || !$('#clock-date')) return;
    function upd() {
      var o = clockOffsetFromInputs(p), el = $('#clock-preview'), n = P.filter(function (x) { return x.cam === p.cam; }).length;
      if (!el) return;
      el.innerHTML = o === null ? 'Type the real date and time.' : o === 0 ? 'That matches: the clock was right. Applying removes any fix.' :
        'This camera’s clock was <b>' + fmtOffset(o) + (o > 0 ? ' behind' : ' ahead') + '</b>. All ' + plural(n, 'photo') + ' from it will be corrected.';
    }
    ['clock-date', 'clock-time'].forEach(function (id) { $('#' + id).addEventListener('input', upd); });
    upd();
  };

  /* ---------------- Photo ---------------- */
  VIEWS.photo = function () {
    var p = PI[R.id];
    if (!p) return head('Photo', '#/') + '<div class="panel">That photo isn’t here anymore.</div>';
    var d = eff(p), rec = parseLocal(p.t), c = cam(p.cam), l = lightOf(d), note = sunNote(d);
    var src = { exif: 'from the photo file', stamp: 'typed from the stamp', file: 'file date' }[p.tsrc] || '';
    var h = head('Photo', '#/') + (p.thumb ? '<img class="photo-big" alt="Trail camera photo" src="' + thumbURL(p) + '" style="margin-bottom:12px">' : '');
    h += '<div class="paper"><p style="margin:0 0 4px"><b class="mono">' + esc(d ? fmtDate(d) + ' ' + fmtTime(d) : 'No time yet') + '</b> · ' + esc(camName(p.cam)) + '</p>' +
      '<p class="small muted" style="margin:0 0 6px">' + (src ? 'Time ' + src : '') + (c && c.offsetMin && rec ? ' · camera said ' + esc(fmtTime(rec)) + ', clock fix applied' : '') + '</p>' +
      (l ? '<p class="small" style="margin:0 0 6px">' + lightMark(l) + ' ' + LIGHT_LABEL[l] + (note ? ' · ' + esc(note) : '') + '</p>' : '') +
      '<hr><h3>Who’s in it</h3><div style="display:flex;flex-wrap:wrap;gap:6px">' + S.deer.map(function (b) { return '<button class="tok named' + (p.deer.indexOf(b.id) >= 0 ? ' on' : '') + '" data-ptoggle="deer:' + esc(b.id) + '">★ ' + esc(b.name) + '</button>'; }).join('') +
      KINDS.map(function (k) { return '<button class="tok' + (p.tags.indexOf(k.id) >= 0 ? ' on' : '') + '" data-ptoggle="' + k.id + '">' + k.label + '</button>'; }).join('') + '</div>' +
      '<hr><h3>Fix the time</h3><div class="dt2"><label class="field"><span>Date on the photo</span><input type="date" id="ph-date" value="' + esc(p.t ? p.t.slice(0, 10) : '') + '"></label><label class="field"><span>Time on the photo</span><input type="time" id="ph-time" step="1" value="' + esc(p.t ? p.t.slice(11, 19) : '') + '"></label></div>' +
      '<button class="btn ink block" data-act="ph-time" data-id="' + esc(p.id) + '">Save time</button>' +
      '<p class="tiny muted" style="margin:6px 0 0">Type what the camera recorded. A Clock Check fix for the camera is added on top.</p>' +
      '<hr><button class="btn danger block" data-act="ph-del" data-id="' + esc(p.id) + '">Delete this photo</button><p class="tiny muted" style="margin:6px 0 0">' + esc(p.name) + '</p></div>';
    return h;
  };

  /* ---------------- Bucks ---------------- */
  VIEWS.bucks = function () {
    var h = head('Your bucks');
    h += '<div class="paper">';
    if (!S.deer.length) h += '<p class="muted" style="margin:0 0 10px">Name the bucks you recognize. Tag them in the Sort Pass and each one gets his own page: Day Ring, Season Strip and a plain-English read.</p>';
    h += '<ul class="list">' + S.deer.map(function (b) {
      var vs = visits('deer:' + b.id), last = vs[0], cover = last ? last.photos[0] : null, t = tally(vs);
      return '<li><a class="item" href="#/buck/' + encodeURIComponent(b.id) + '">' + (cover && cover.thumb ? '<img class="thumb" alt="" src="' + thumbURL(cover) + '">' : '<span class="thumb">★</span>') +
        '<span class="t"><b>' + esc(b.name) + '</b><span>' + plural(vs.length, 'visit') + (last ? ' · last ' + esc(fmtDate(last.d)) + (hasLoc() ? ' · ' + (t.light.day + t.light.light) + ' in daylight' : '') : '') + '</span></span><span>›</span></a></li>';
    }).join('') + '</ul>';
    h += (canAddBuck() ? '<div style="display:flex;gap:8px;margin-top:10px"><input type="text" id="new-buck" maxlength="60" placeholder="New buck name, e.g. Big 8"><button class="btn go" data-act="add-buck">Add</button></div>' : '<p class="small muted" style="margin:10px 0 0">' + freeLine('buck') + '</p>') + '</div>';
    var allB = visits('bucks'), unnamed = allB.filter(function (v) { return v.photos.every(function (p) { return !p.deer.length; }); });
    if (unnamed.length) h += '<div class="panel small">' + plural(unnamed.length, 'buck visit') + ' tagged just “Buck”. Open them from the <a href="#/">Ledger</a> to name him later.</div>';
    return h;
  };
  VIEWS.buck = function () {
    var b = deer(R.id);
    if (!b) return head('Buck', '#/bucks') + '<div class="panel">That buck isn’t in your ledger anymore.</div>';
    var vs = visits('deer:' + b.id), t = tally(vs);
    var h = head(b.name, '#/bucks', 'brand');
    if (!vs.length) {
      h += '<div class="paper"><p style="margin:0">No visits yet' + (vs.noTime ? ' (' + plural(vs.noTime, 'photo') + ' still need a time: <a href="#/stamp">Stamp Reader</a>)' : '') + '. Tag him in the <a href="#/sort">Sort Pass</a> and his pattern builds here.</p></div>';
    } else {
      h += '<div class="paper"><h3>Day Ring</h3><div class="ring-wrap">' + dayRing(vs) + '</div>' + legend() + '<p class="tiny muted" style="margin:4px 0 0">Midnight at the bottom, noon at the top. Each dot is one visit.' + (hasLoc() ? ' Shading uses real sunrise/sunset for ' + esc(fmtDate(vs[Math.floor(vs.length / 2)].d)) + '.' : '') + '</p></div>';
      h += '<div class="paper"><h3>Season Strip</h3>' + seasonStrip(vs) + '<p class="tiny muted" style="margin:4px 0 0">' + (hasLoc() ? 'Gold: seen in legal light that day. Navy: only after dark.' : 'Tan: seen that day. Add your property location to split daylight from dark.') + '</p></div>';
      h += '<div class="paper" id="plain-read"><h3>The read</h3><ul class="read">' + plainRead(vs).map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul></div>';
      h += '<div class="paper"><h3>By camera</h3>' + Object.keys(t.byCam).sort(function (a, c2) { return t.byCam[c2] - t.byCam[a]; }).map(function (k) {
        return '<div class="camcount"><span>' + esc(camName(k === '_' ? null : k)) + '</span><b>' + plural(t.byCam[k], 'visit') + (hasLoc() ? ' <span class="muted" style="font-weight:400">· ' + (t.litByCam[k] || 0) + ' daylight</span>' : '') + '</b></div>';
      }).join('') + '</div>';
      h += '<div class="ledger">' + vs.slice(0, 40).map(function (v) {
        var cover = v.photos[0];
        return '<button class="lrow" data-visit="' + esc(cover.id) + '" data-sub="deer:' + esc(b.id) + '"><span class="tm">' + esc(fmtTime(v.d).replace(' ', '')) + '</span>' + lightMark(v.light) + '<span class="who"><b>' + esc(fmtDate(v.d)) + '</b><span>' + esc(camName(v.cam)) + '</span></span><span class="n">' + (v.photos.length > 1 ? '×' + v.photos.length : '') + '</span>' + (cover.thumb ? '<img alt="" loading="lazy" src="' + thumbURL(cover) + '">' : '') + '</button>';
      }).join('') + '</div>';
    }
    h += '<div class="paper" style="margin-top:12px"><label class="field"><span>Name</span><input type="text" id="buck-name" maxlength="60" value="' + esc(b.name) + '"></label><label class="field"><span>Notes</span><textarea id="buck-notes" maxlength="2000" placeholder="Rack, marks, where he beds…">' + esc(b.notes) + '</textarea></label>' +
      '<button class="btn ink block" data-act="buck-save" data-id="' + esc(b.id) + '">Save</button><button class="btn danger block" style="margin-top:8px" data-act="buck-del" data-id="' + esc(b.id) + '">Remove this buck</button></div>';
    return h;
  };
  VIEWS.buck.after = function () { var s = $('#season-strip'); if (s) s.scrollLeft = s.scrollWidth; };

  /* ---------------- Cameras ---------------- */
  VIEWS.cams = function () {
    var h = head('Cameras') + '<div class="paper">';
    if (!S.cameras.length) h += '<p class="muted" style="margin:0 0 10px">Cameras are added when you log a pull.</p>';
    h += '<ul class="list">' + S.cameras.map(function (c) {
      var n = P.filter(function (p) { return p.cam === c.id; }).length, pulls = S.pulls.filter(function (u) { return u.cam === c.id; }).length;
      return '<li><a class="item" href="#/cam/' + encodeURIComponent(c.id) + '"><span class="thumb">📷</span><span class="t"><b>' + esc(c.name) + '</b><span>' + plural(n, 'photo') + ' · ' + plural(pulls, 'pull') + (c.offsetMin ? ' · clock fixed' : '') + '</span></span><span>›</span></a></li>';
    }).join('') + '</ul>';
    h += '<a class="btn go block" style="margin-top:10px" href="#/pull">Log a Pull</a>' + (!canAddCam() ? '<p class="small muted" style="margin:8px 0 0">' + freeLine('cam') + '</p>' : '') + '</div>';
    return h;
  };
  VIEWS.cam = function () {
    var c = cam(R.id);
    if (!c) return head('Camera', '#/cams') + '<div class="panel">That camera isn’t here anymore.</div>';
    var vs = visits('all', c.id), t = tally(vs), bucksHere = {};
    vs.forEach(function (v) { v.photos.forEach(function (p) { p.deer.forEach(function (d) { bucksHere[d] = (bucksHere[d] || 0) + 1; }); }); });
    var h = head(c.name, '#/cams', 'brand');
    h += '<div class="paper"><p style="margin:0 0 6px"><b>' + plural(t.n, 'deer visit') + '</b>' + (hasLoc() && t.n ? ' · ' + (t.light.day + t.light.light) + ' in daylight' : '') + '</p>' +
      (Object.keys(bucksHere).length ? '<p class="small" style="margin:0 0 6px">Named bucks here: ' + Object.keys(bucksHere).map(function (d) { var b = deer(d); return b ? '<a href="#/buck/' + encodeURIComponent(d) + '">' + esc(b.name) + '</a>' : ''; }).join(', ') + '</p>' : '') +
      '<p class="small muted" style="margin:0">Clock: ' + (c.offsetMin ? 'fixed, it was ' + fmtOffset(c.offsetMin) + (c.offsetMin > 0 ? ' behind' : ' ahead') : 'no fix applied') + '</p>' +
      '<a class="btn ink block" style="margin-top:10px" href="#/clock/' + encodeURIComponent(c.id) + '">Clock Check</a></div>';
    if (vs.length) h += '<div class="paper"><h3>Deer visits by time of day</h3><div class="ring-wrap">' + dayRing(vs) + '</div>' + legend() + '</div>';
    h += '<div class="paper"><label class="field"><span>Camera name</span><input type="text" id="cam-name" maxlength="60" value="' + esc(c.name) + '"></label><button class="btn ink block" data-act="cam-save" data-id="' + esc(c.id) + '">Save name</button>' +
      '<button class="btn danger block" style="margin-top:8px" data-act="cam-del" data-id="' + esc(c.id) + '">Delete camera and its photos</button></div>';
    return h;
  };

  /* ---------------- More: location, settings, backup, Pro ---------------- */
  VIEWS.more = function () {
    var st = S.settings, pro = isPro();
    var h = head('More');
    h += '<div class="paper" id="pro"><h3>' + esc(APP) + ' Pro</h3>';
    if (pro) {
      h += '<p style="margin:0 0 6px">✓ Pro is unlocked on this phone' + (st.license.source === 'dev' ? ' (dev test code)' : '') + '.</p><p class="small muted">License key: <b>' + esc(maskKey(st.license.key)) + '</b>' + (st.license.verifiedAt ? ' · checked ' + fmtDay(st.license.verifiedAt) : '') + '. Keep your Gumroad receipt so you can enter the key again on a new phone.</p>';
    } else {
      h += (st.license && st.license.revokedAt ? '<p class="small" style="color:#9a2f1c">' + esc(st.license.reason || 'Your license is no longer active.') + '</p>' : '') +
        '<p class="small" style="margin:0 0 8px">Free: ' + plural(C.FREE_CAMERA_LIMIT || 0, 'camera') + ' and ' + plural(C.FREE_BUCK_LIMIT || 0, 'named buck') + '. Pro: unlimited cameras and bucks. ' + esc(C.PRO_PRICE_NOTE || '') + '</p>' +
        (C.CHECKOUT_URL && proOnSale() ? '<a class="btn go block" id="buy-pro" href="' + esc(C.CHECKOUT_URL) + '" target="_blank" rel="noopener">Get Pro' + (C.PRO_PRICE ? ' · ' + esc(C.PRO_PRICE) : '') + '</a>' : '<button class="btn go block" id="buy-pro" disabled>Pro: coming soon</button>');
    }
    if (proOnSale() || st.license) {
      h += '<label class="field" style="margin-top:12px"><span>' + (pro ? 'Re-enter or change license key' : 'Have a license key?') + '</span><input type="text" id="lic" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="From your Gumroad receipt"></label>' +
        '<button class="btn ink block" data-act="unlock">' + (pro ? 'Check key' : 'Unlock Pro') + '</button><p class="small" id="lic-msg" style="margin:8px 0 0"></p>' +
        '<p class="tiny muted" style="margin:4px 0 0">Activating needs internet once. Your key is sent only to Gumroad to check it. Purchases, support and refunds are handled through Gumroad.</p>';
    } else if (C.DEV_MODE) {
      h += '<label class="field" style="margin-top:12px"><span>Test code</span><input type="text" id="lic"></label><button class="btn ink block" data-act="unlock">Unlock</button><p class="small" id="lic-msg"></p>';
    }
    h += '</div>';
    h += '<div class="paper" id="location"><h3>Property location</h3><p class="small muted" style="margin:0 0 8px">Used only on this phone to work out sunrise, sunset and shooting light for each visit. Nothing is sent anywhere.</p>' +
      '<div class="dt2" style="grid-template-columns:1fr 1fr"><label class="field"><span>Latitude</span><input type="text" inputmode="decimal" id="lat" value="' + (st.lat === null ? '' : st.lat) + '" placeholder="e.g. 30.12"></label><label class="field"><span>Longitude</span><input type="text" inputmode="decimal" id="lng" value="' + (st.lng === null ? '' : st.lng) + '" placeholder="e.g. -96.45"></label></div>' +
      '<div class="btn-row"><button class="btn ink" data-act="loc-here">Use my location</button><button class="btn ink" data-act="loc-save">Save</button></div>' +
      '<p class="tiny muted" style="margin:6px 0 0">Tip: stand on your property and tap “Use my location”. West longitudes are negative.</p></div>';
    h += '<div class="paper"><h3>Ledger settings</h3><label class="field"><span>Shooting light: minutes before sunrise and after sunset</span><input type="number" id="shoot" min="0" max="90" value="' + st.shootMin + '"></label>' +
      '<p class="tiny muted" style="margin:-6px 0 10px">Most states allow 30 minutes. Check your state’s rules.</p>' +
      '<label class="field"><span>Visit gap: photos this many minutes apart or less count as one visit</span><input type="number" id="gap" min="1" max="240" value="' + st.gapMin + '"></label>' +
      '<button class="btn ink block" data-act="settings-save">Save settings</button></div>';
    h += '<div class="paper" id="backup"><h3>Backup &amp; export</h3><p class="small muted" style="margin:0 0 8px">Everything lives only on this phone. A backup file is yours to keep (Files, iCloud Drive, Google Drive…).' + (st.lastBackup ? ' Last backup: ' + fmtDay(st.lastBackup) + '.' : '') + '</p>' +
      '<button class="btn go block" data-act="backup-full">Save backup (with photos)</button>' +
      '<div class="btn-row" style="margin-top:8px"><button class="btn ink" data-act="backup-data">Backup without photos</button><button class="btn ink" data-act="restore">Restore a backup</button></div>' +
      '<button class="btn ink block" style="margin-top:8px" data-act="csv">Export the Ledger (CSV)</button>' +
      '<input type="file" id="restore-file" accept="application/json,.json" hidden></div>';
    var empties = P.filter(function (p) { return p.done && p.tags.indexOf('empty') >= 0; }).length;
    h += '<div class="paper"><h3>Storage</h3><p class="small" style="margin:0 0 8px">' + plural(P.length, 'photo') + ' stored · ' + plural(empties, 'empty photo') + '</p>' +
      (empties ? '<button class="btn ink block" data-act="del-empties">Delete the ' + plural(empties, 'empty photo') + '</button>' : '') +
      '<button class="btn danger block" style="margin-top:8px" data-act="erase">Erase everything</button></div>';
    h += '<div class="paper small"><h3>About</h3><p>' + esc(APP) + ' is a trail cam logbook built by a hunter. No account, no ads, no trackers, no subscription. Photos are shrunk and kept in this browser’s storage on this phone; they are never uploaded. Works offline after the first visit.</p><p style="margin:0"><a href="privacy.html">Privacy</a> · Version 1.0.0</p></div>';
    return h + installNote();
  };

  /* ---------------- sheets ---------------- */
  function promptSheet(title, body, yes, val) {
    return sheet('<h2>' + esc(title) + '</h2><p class="muted">' + esc(body) + '</p><input type="text" id="prompt-in" maxlength="60" value="' + esc(val || '') + '" style="margin-bottom:12px"><div class="btn-row"><button class="btn ink" data-x="no">Cancel</button><button class="btn go" data-x="ok">' + esc(yes) + '</button></div>', function (x, b, close) {
      if (x === 'ok') { var v = ($('#prompt-in').value || '').trim(); if (!v) { toast('Type a name'); return false; } close(v); return false; }
    }).then(function (v) { return typeof v === 'string' ? v : null; });
  }
  function proSheet(kind) {
    var on = proOnSale() && C.CHECKOUT_URL;
    sheet('<h2>Free version limit</h2><p>' + (kind === 'cam' ? 'The free version keeps ' + plural(camLimit(), 'camera') + '.' : 'The free version keeps ' + plural(buckLimit(), 'named buck') + '.') + ' Pro unlocks unlimited cameras and named bucks. ' + esc(C.PRO_PRICE_NOTE || '') + '</p>' +
      (on ? '<a class="btn go block" href="' + esc(C.CHECKOUT_URL) + '" target="_blank" rel="noopener">Get Pro' + (C.PRO_PRICE ? ' · ' + esc(C.PRO_PRICE) : '') + '</a><a class="btn ink block" style="margin-top:8px" href="#/more" data-x="close">I have a license key</a>'
        : '<button class="btn go block" disabled>Pro: coming soon</button>') +
      '<button class="btn ink block" style="margin-top:8px" data-x="close">Not now</button>');
  }

  /* ---------------- backup / restore / CSV ---------------- */
  function blobToDataURL(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(b); }); }
  function dataURLToBlob(u) {
    var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(u || '')); if (!m) return null;
    try { var bin = atob(m[2]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: m[1] }); } catch (e) { return null; }
  }
  function saveFile(blob, name, mime) {
    var file = null; try { file = new File([blob], name, { type: mime }); } catch (e) {}
    var share = (isIOS() && file && navigator.canShare && navigator.canShare({ files: [file] }))
      ? navigator.share({ files: [file], title: name }).then(function () { return true; }).catch(function (e) { return e && e.name === 'AbortError' ? 'abort' : false; })
      : Promise.resolve(false);
    return share.then(function (ok) {
      if (ok === 'abort') return false;
      if (!ok) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
      return true;
    });
  }
  function stamp() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function exportBackup(withPhotos) {
    toast('Building backup…', 1500);
    var st = JSON.parse(JSON.stringify(S)); st.settings.license = null; st.settings.deviceId = null;
    var photos = [];
    return P.reduce(function (pr, p) {
      return pr.then(function () {
        var o = { id: p.id, cam: p.cam, pull: p.pull, name: p.name, size: p.size, t: p.t, tsrc: p.tsrc, fileT: p.fileT, tags: p.tags, deer: p.deer, done: p.done, added: p.added };
        photos.push(o);
        if (withPhotos && p.thumb) return blobToDataURL(p.thumb).then(function (u) { o.thumb = u; });
      });
    }, Promise.resolve()).then(function () {
      var data = { app: 'buckledger', schema: SCHEMA, exportedAt: new Date().toISOString(), withPhotos: !!withPhotos, state: st, photos: photos };
      var name = 'buck-ledger-backup-' + stamp() + (withPhotos ? '' : '-data') + '.json';
      return saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), name, 'application/json').then(function (ok) {
        if (ok) { S.settings.lastBackup = Date.now(); save(); toast('Backup saved: ' + name, 3000); }
      });
    }).catch(function () { toast('Backup failed. Try “Backup without photos”.', 4000); });
  }
  function restoreFrom(file) {
    var r = new FileReader();
    r.onload = function () {
      var data; try { data = JSON.parse(r.result); } catch (e) { toast('That file isn’t a Buck Ledger backup.'); return; }
      if (!data || data.app !== 'buckledger' || !data.state || !Array.isArray(data.photos)) { toast('That file isn’t a Buck Ledger backup.'); return; }
      confirmSheet('Restore this backup?', 'It has ' + plural(data.photos.length, 'photo') + ' from ' + (data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date') + '. It replaces everything on this phone.', 'Restore').then(function (ok) {
        if (!ok) return;
        var next = migrate(data.state);
        next.settings.license = S.settings.license; next.settings.deviceId = S.settings.deviceId; // licenses never come from files
        var camIds = {}, deerIds = {}; next.cameras.forEach(function (c) { camIds[c.id] = 1; }); next.deer.forEach(function (b) { deerIds[b.id] = 1; });
        var list = [], ids = {};
        data.photos.forEach(function (o) {
          if (!o || typeof o !== 'object') return;
          var thumb = o.thumb ? dataURLToBlob(o.thumb) : null;
          var p = cleanPhoto(Object.assign({}, o, { thumb: thumb }), camIds, deerIds);
          if (p && !ids[p.id]) { ids[p.id] = 1; list.push(p); }
        });
        photosClear().then(function () { return list.length ? photosPutMany(list) : null; }).then(function () {
          Object.keys(urlCache).forEach(dropURL);
          S = next; P = list; PI = {}; P.forEach(function (p) { PI[p.id] = p; });
          return flush();
        }).then(function () { toast('Backup restored: ' + plural(list.length, 'photo')); go('#/'); }).catch(function () { toast('Restore failed. Nothing was changed.', 4000); });
      });
    };
    r.readAsText(file);
  }
  function csvCell(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCSV() {
    var vs = visits('any');
    var rows = [['date', 'time', 'end_time', 'camera', 'who', 'light', 'sun', 'photos', 'time_source', 'files']];
    vs.slice().reverse().forEach(function (v) {
      var srcs = {}; v.photos.forEach(function (p) { srcs[p.tsrc || ''] = 1; });
      rows.push([v.d.getFullYear() + '-' + pad(v.d.getMonth() + 1) + '-' + pad(v.d.getDate()), pad(v.d.getHours()) + ':' + pad(v.d.getMinutes()), pad(v.end.getHours()) + ':' + pad(v.end.getMinutes()),
        camName(v.cam), whoOf(v), v.light ? LIGHT_LABEL[v.light] : '', sunNote(v.d), v.photos.length, Object.keys(srcs).join('+'), v.photos.map(function (p) { return p.name; }).join(' ')]);
    });
    var csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    return saveFile(new Blob(['\ufeff' + csv], { type: 'text/csv' }), 'buck-ledger-' + stamp() + '.csv', 'text/csv').then(function (ok) { if (ok) toast('Exported ' + plural(vs.length, 'visit')); });
  }

  /* ---------------- actions ---------------- */
  function deletePhotos(ids) {
    var set = {}; ids.forEach(function (id) { set[id] = 1; dropURL(id); });
    P = P.filter(function (p) { return !set[p.id]; }); ids.forEach(function (id) { delete PI[id]; });
    return photoDel(ids);
  }
  document.addEventListener('click', function (e) {
    if (sortClick(e)) return;
    var vis = e.target.closest('[data-visit]');
    if (vis && !e.target.closest('.sheet')) { visitSheet(vis.getAttribute('data-visit'), vis.getAttribute('data-sub')); return; }
    var pt = e.target.closest('[data-ptoggle]');
    if (pt) {
      var p0 = PI[R.id]; if (!p0) return; var v = pt.getAttribute('data-ptoggle');
      if (v.indexOf('deer:') === 0) { var did = v.slice(5), i = p0.deer.indexOf(did); if (i >= 0) p0.deer.splice(i, 1); else p0.deer.push(did); p0.tags = p0.tags.filter(function (x) { return x !== 'empty'; }); }
      else if (v === 'empty') { p0.tags = p0.tags.indexOf('empty') >= 0 ? [] : ['empty']; p0.deer = []; }
      else { var j = p0.tags.indexOf(v); if (j >= 0) p0.tags.splice(j, 1); else { p0.tags.push(v); p0.tags = p0.tags.filter(function (x) { return x !== 'empty'; }); } }
      p0.done = p0.tags.length + p0.deer.length > 0; photoPut(p0); render(); return;
    }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var act = a.getAttribute('data-act'), id = a.getAttribute('data-id');
    switch (act) {
      case 'pick-photos': {
        var sel = $('#pull-cam');
        if (sel && sel.value === '__new' && !($('#pull-new').value || '').trim()) { toast('Name the camera first'); $('#pull-new').focus(); return; }
        $('#pull-file').click(); return;
      }
      case 'pull-again': pullState = null; render(); return;
      case 'more-rows': ledgerLimit += 200; render(); return;
      case 'sort-undo': sortUndoLast(); return;
      case 'stamp-band': stampBand = stampBand === 'bottom' ? 'top' : 'bottom'; render(); return;
      case 'stamp-pan': stampShift = stampShift <= -60 ? 0 : stampShift - 30; var im = $('#stamp-zoom img'); if (im) im.style.transform = 'translateX(' + stampShift + '%)'; return;
      case 'stamp-save': stampSave(id, false); return;
      case 'stamp-filedate': stampSave(id, true); return;
      case 'stamp-skip': {
        var q = P.filter(function (p) { return !p.t; }).sort(function (x, y) { return x.name.localeCompare(y.name, undefined, { numeric: true }); });
        var k = q.findIndex(function (p) { return p.id === id; }), nx = q[(k + 1) % q.length];
        go('#/stamp/' + encodeURIComponent(nx ? nx.id : '')); return;
      }
      case 'clock-apply': {
        var c = cam(a.getAttribute('data-cam')), pp = PI[a.getAttribute('data-p')]; if (!c || !pp) return;
        var o = clockOffsetFromInputs(pp); if (o === null) { toast('Type the real date and time'); return; }
        c.offsetMin = o; save(); toast(o ? 'Clock fixed: ' + fmtOffset(o) + (o > 0 ? ' behind' : ' ahead') : 'Clock was right. No fix needed.', 3000); go('#/cam/' + encodeURIComponent(c.id)); return;
      }
      case 'clock-clear': { var c2 = cam(a.getAttribute('data-cam')); if (c2) { c2.offsetMin = 0; save(); toast('Clock fix removed'); render(); } return; }
      case 'ph-time': {
        var ph = PI[id]; if (!ph) return; var dv = $('#ph-date').value, tv = $('#ph-time').value;
        if (!dv || !tv) { toast('Type both the date and the time'); return; }
        var val = dv + 'T' + (tv.length === 5 ? tv + ':00' : tv.slice(0, 8)); if (!parseLocal(val)) { toast('That date/time doesn’t look right'); return; }
        if (val !== ph.t) { ph.t = val; ph.tsrc = 'stamp'; photoPut(ph); toast('Time saved'); render(); }
        return;
      }
      case 'ph-del': confirmSheet('Delete this photo?', 'It’s removed from this phone and your ledger.', 'Delete', true).then(function (ok) { if (ok) deletePhotos([id]).then(function () { toast('Photo deleted'); history.length > 1 ? history.back() : go('#/'); }); }); return;
      case 'add-buck': { var nm = ($('#new-buck').value || '').trim(); if (!nm) { toast('Type a name'); return; } if (addBuck(nm)) { toast('Added ' + nm); render(); } return; }
      case 'buck-save': { var b = deer(id); if (!b) return; var n2 = ($('#buck-name').value || '').trim(); if (n2) b.name = clampStr(n2, 60); b.notes = clampStr($('#buck-notes').value, 2000); save(); toast('Saved'); render(); return; }
      case 'buck-del': confirmSheet('Remove this buck?', 'His photos stay in the ledger, just without his name.', 'Remove', true).then(function (ok) {
        if (!ok) return; S.deer = S.deer.filter(function (x) { return x.id !== id; });
        var ch = []; P.forEach(function (p) { var i2 = p.deer.indexOf(id); if (i2 >= 0) { p.deer.splice(i2, 1); if (p.tags.indexOf('buck') < 0) p.tags.push('buck'); ch.push(p); } });
        save(); (ch.length ? photosPutMany(ch) : Promise.resolve()).then(function () { go('#/bucks'); });
      }); return;
      case 'cam-save': { var c3 = cam(id); if (!c3) return; var n3 = ($('#cam-name').value || '').trim(); if (n3) { c3.name = clampStr(n3, 60); save(); toast('Saved'); render(); } return; }
      case 'cam-del': {
        var c4 = cam(id); if (!c4) return; var ids = P.filter(function (p) { return p.cam === id; }).map(function (p) { return p.id; });
        confirmSheet('Delete ' + c4.name + '?', 'This deletes the camera and its ' + plural(ids.length, 'photo') + ' from this phone. Save a backup first if you might want them.', 'Delete', true).then(function (ok) {
          if (!ok) return; S.cameras = S.cameras.filter(function (x) { return x.id !== id; }); S.pulls = S.pulls.filter(function (u) { return u.cam !== id; }); save();
          deletePhotos(ids).then(function () { toast('Camera deleted'); go('#/cams'); });
        }); return;
      }
      case 'unlock': {
        var msg = $('#lic-msg'), key = ($('#lic') || {}).value; a.disabled = true; if (msg) msg.textContent = 'Checking…';
        tryUnlock(key).then(function (r) { a.disabled = false; if (r.ok) { toast(r.msg, 3500); render(); } else if ($('#lic-msg')) $('#lic-msg').textContent = r.msg; });
        return;
      }
      case 'loc-here':
        if (!navigator.geolocation) { toast('Location isn’t available here. Type it in.'); return; }
        toast('Finding you…', 4000);
        navigator.geolocation.getCurrentPosition(function (pos) { $('#lat').value = pos.coords.latitude.toFixed(4); $('#lng').value = pos.coords.longitude.toFixed(4); toast('Got it. Tap Save.'); }, function () { toast('Couldn’t get your location. Type it in.'); }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
        return;
      case 'loc-save': {
        var la = $('#lat').value.trim(), lo = $('#lng').value.trim();
        if (!la && !lo) { S.settings.lat = null; S.settings.lng = null; save(); sunCache = {}; toast('Location cleared'); render(); return; }
        var lan = Number(la), lon = Number(lo);
        if (!la || !lo || !isFinite(lan) || !isFinite(lon) || Math.abs(lan) > 90 || Math.abs(lon) > 180) { toast('Latitude −90…90 and longitude −180…180, please'); return; }
        S.settings.lat = Math.round(lan * 10000) / 10000; S.settings.lng = Math.round(lon * 10000) / 10000; sunCache = {}; save(); toast('Location saved'); render(); return;
      }
      case 'settings-save': {
        var sm = Number($('#shoot').value), gm = Number($('#gap').value);
        if (!isFinite(sm) || sm < 0 || sm > 90 || !isFinite(gm) || gm < 1 || gm > 240) { toast('Shooting light 0–90 min, visit gap 1–240 min'); return; }
        S.settings.shootMin = Math.round(sm); S.settings.gapMin = Math.round(gm); save(); toast('Settings saved'); render(); return;
      }
      case 'backup-full': exportBackup(true); return;
      case 'backup-data': exportBackup(false); return;
      case 'restore': $('#restore-file').click(); return;
      case 'csv': exportCSV(); return;
      case 'del-empties': {
        var em = P.filter(function (p) { return p.done && p.tags.indexOf('empty') >= 0; }).map(function (p) { return p.id; });
        confirmSheet('Delete ' + plural(em.length, 'empty photo') + '?', 'Frees up space. They’re already left out of your ledger.', 'Delete', true).then(function (ok) { if (ok) deletePhotos(em).then(function () { toast('Deleted ' + plural(em.length, 'photo')); render(); }); });
        return;
      }
      case 'erase': confirmSheet('Erase everything?', 'All photos, cameras, bucks and tags on this phone will be deleted. This can’t be undone.', 'Erase', true).then(function (ok) {
        if (!ok) return; var lic = S.settings.license, dev = S.settings.deviceId;
        photosClear().then(function () { Object.keys(urlCache).forEach(dropURL); P = []; PI = {}; S = defaults(); S.settings.license = lic; S.settings.deviceId = dev; return flush(); }).then(function () { toast('Erased'); go('#/'); });
      }); return;
      case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } return;
      case 'install-dismiss': S.settings.installDismissed = true; save(); var n = $('#install-note'); if (n) n.remove(); return;
    }
  });
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'restore-file') { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) restoreFrom(f); } });
  document.addEventListener('keydown', function (e) {
    if (!$('#sort-pass') || /input|textarea|select/i.test((e.target.tagName || ''))) return;
    if (e.key === 'Enter') { e.preventDefault(); sortCommit(sortSel); } else if (e.key === 'e' || e.key === 'E') sortCommit({ tags: ['empty'], deer: [] });
  });

  window.addEventListener('pagehide', function () { if (saveTimer) flush(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && saveTimer) flush(); });

  /* ---------------- start ---------------- */
  function boot() {
    openDB().then(function () { return Promise.all([kvGet('state'), photosAll()]); }).then(function (r) {
      S = migrate(r[0]);
      var camIds = {}, deerIds = {}; S.cameras.forEach(function (c) { camIds[c.id] = 1; }); S.deer.forEach(function (b) { deerIds[b.id] = 1; });
      P = (r[1] || []).map(function (p) { return cleanPhoto(p, camIds, deerIds); }).filter(Boolean);
      PI = {}; P.forEach(function (p) { PI[p.id] = p; });
      render();
      setTimeout(function () { recheckLicense().catch(function () {}); }, 3000);
      readyResolve();
    }).catch(function (e) {
      $('#app').innerHTML = '<main class="wrap"><div class="panel"><h2>Storage isn’t available</h2><p>' + esc(APP) + ' keeps your photos in this browser’s storage, and it’s turned off here (private browsing does this). Open it in a normal browser tab.</p></div></main>';
      readyResolve();
    });
  }
  var readyResolve; var ready = new Promise(function (r) { readyResolve = r; });
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  window.BuckLedger = {
    ready: ready, state: function () { return S; }, photos: function () { return P; },
    readExif: readExif, sunTimes: sunTimes, lightOf: function (d) { return lightOf(d); }, visits: function (s, c) { return visits(s || 'any', c); },
    plainRead: function (s) { return plainRead(visits(s)); }, flush: flush, isPro: function () { return isPro(); }
  };
  boot();
})();
