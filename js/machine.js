/* THE MACHINE · V2
 * An interactive archive of watching eyes — an infinite wall, a game of search, a world map of the network.
 * Canvas2D (works from file://, no server, no dependencies).
 * World model: an infinite lattice of SECTORS. Sector 0·0 is the curated wall; every other sector re-deals the
 * same photographs within tonal bands (seeded), mirrored on a checkerboard, so the wall continues forever.
 * Far zoom: cached sector bitmaps from sprite atlases (1 drawImage per sector). Mid: atlas cells. Near: real images.
 */
(() => {
'use strict';
const D = window.MACHINE_DATA, WORLD = window.MACHINE_WORLD;
const BASE = 'photos/';
const P = D.photos;
let N = P.length;
const byId = new Map(P.map(p => [p.id, p]));
const $ = s => document.querySelector(s);
const canvas = $('#stage'), ctx = canvas.getContext('2d', { alpha: false });
const fxc = $('#fx'), fx = fxc.getContext('2d');
let W = 0, H = 0, DPR = 1;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches;
const COMPACT = () => matchMedia('(max-width:900px), (max-height:500px) and (pointer:coarse)').matches;
const readLocal = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
const C = { bg: '#080B0D', scan: '149,216,183', anom: '201,116,107', admin: '232,197,71', threat: '217,83,74', white: '226,232,231' };
const MONO = '"JetBrains Mono","IBM Plex Mono","SF Mono",ui-monospace,Menlo,monospace';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const eio = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const eout = t => 1 - Math.pow(1 - t, 3);
const eoutQ = t => 1 - Math.pow(1 - t, 5);
const ein = t => t * t * t;
const pad = (n, k = 2) => String(n).padStart(k, '0');
const lerpRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t),
  c: [lerp(a.c[0], b.c[0], t), lerp(a.c[1], b.c[1], t), lerp(a.c[2], b.c[2], t), lerp(a.c[3], b.c[3], t)] });
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry(7);
const fmtT = ms => { const s = Math.max(0, ms) / 1000; return pad(Math.floor(s / 60)) + ':' + pad(Math.floor(s % 60)) + '.' + pad(Math.floor((s * 100) % 100)); };

function prepPhoto(p, i) {
  p.i = i; p.a = p.w / p.h;
  p.cams = p.cams || [];
  p.cams.forEach(c => { c.lens = c.lens || [c.bbox[0] + c.bbox[2] / 2, c.bbox[1] + c.bbox[3] / 2]; });
  p.cam = p.cams[0] || null;
  p.anchor = p.cam ? p.cam.lens : [.5, .5];
  p.img = p.img || { thumb: null, preview: null, full: null };
  p.used = { thumb: 0, preview: 0, full: 0 };
  p.span = p.span || [1, 1];
}
P.forEach(prepPhoto);
function coverCrop(p, w, h) {
  const r = w / h, a = p.a, fu = lerp(.5, p.anchor[0], .8), fv = lerp(.5, p.anchor[1], .8);
  if (a > r) { const fw = r / a; const u0 = clamp(fu - fw / 2, 0, 1 - fw); return [u0, 0, u0 + fw, 1]; }
  const fh = a / r; const v0 = clamp(fv - fh / 2, 0, 1 - fh); return [0, v0, 1, v0 + fh];
}
function proj(r, u, v) { const c = r.c; return [r.x + (u - c[0]) / (c[2] - c[0]) * r.w, r.y + (v - c[1]) / (c[3] - c[1]) * r.h]; }
function projBox(r, b) { const [x0, y0] = proj(r, b[0], b[1]); const [x1, y1] = proj(r, b[0] + b[2], b[1] + b[3]); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
function inCrop(r, u, v) { const c = r.c; return u >= c[0] && u <= c[2] && v >= c[1] && v <= c[3]; }
const fmtGeo = p => `${Math.abs(p.lat).toFixed(4)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(4)}°${p.lon >= 0 ? 'E' : 'W'}${p.geoReal ? '' : ' ≈'}`;

/* ---------- the wall: one sector ---------- */
const U = 100, GAP = 7, PITCH = U + GAP;
const L = { grid: null, atlas: null };
let SECT = null;
function buildSector() {
  P.forEach(p => p.placed = false);
  const cols = D.gridCols;
  const cells = P.reduce((s, p) => s + p.span[0] * p.span[1], 0);
  const rows = Math.ceil(cells / cols), holes = rows * cols - cells;
  const occ = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const fits = (r, c, w, h) => { if (r + h > rows || c + w > cols) return false; for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) if (occ[i][j]) return false; return true; };
  const mark = (r, c, w, h) => { for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) occ[i][j] = 1; };
  const slots = [], base = [];
  const place = (p, r, c) => { const [sw, sh] = p.span; mark(r, c, sw, sh); slots.push({ x: c * PITCH, y: r * PITCH, w: sw * U + (sw - 1) * GAP, h: sh * U + (sh - 1) * GAP, span: sw * 10 + sh, r, c }); base.push(p.i); p.placed = true; };
  const order = P.slice().sort((a, b) => a.order - b.order);
  order.forEach((p, k) => {
    if (p.span[0] * p.span[1] === 1) return;
    const lin = k / order.length * rows * cols, tr = Math.floor(lin / cols), tc = Math.floor(lin % cols);
    const moat = (r, c) => { const r0 = Math.max(0, r - 1), c0 = Math.max(0, c - 1), r1 = Math.min(rows, r + p.span[1] + 1), c1 = Math.min(cols, c + p.span[0] + 1); for (let i = r0; i < r1; i++) for (let j = c0; j < c1; j++) if (occ[i][j]) return false; return true; };
    let best = null, bd = 1e9;
    for (const strict of [true, false]) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const d = Math.abs(r - tr) * 3 + Math.abs(c - tc); if (d >= bd) continue;
        if (fits(r, c, p.span[0], p.span[1]) && (!strict || moat(r, c))) { bd = d; best = [r, c]; }
      }
      if (best) break;
    }
    if (best) place(p, best[0], best[1]); else p.span = [1, 1];
  });
  const r2 = mulberry(97); const offline = []; let guard = 0;
  while (offline.length < holes && guard++ < 50000) {
    const r = 1 + Math.floor(r2() * (rows - 2)), c = 1 + Math.floor(r2() * (cols - 2));
    if (occ[r][c]) continue;
    if (offline.some(q => Math.abs(q.r - r) + Math.abs(q.c - c) < (guard < 20000 ? 6 : 2))) continue;
    offline.push({ r, c, x: c * PITCH, y: r * PITCH }); occ[r][c] = 2;
  }
  const free = [];
  for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) if (!occ[r][c]) row.push([r, c]); if (r % 2) row.reverse(); free.push(...row); }
  let k = 0;
  for (const p of order) if (!p.placed) { const s = free[k++]; if (s) place(p, s[0], s[1]); }
  const w = cols * PITCH, h = rows * PITCH;
  SECT = { cols, rows, w, h, slots, base, offline, ox: -w / 2, oy: -h / 2 };
  slots.forEach(s => { s.band = Math.floor(s.r / 3); s.big = s.span !== 11; });
  L.grid = { w, h };
  sectorCache.clear(); sectorBitmaps.clear();
}
const sectorCache = new Map();
function sectorDeal(sx, sy) {
  const key = sx + ',' + sy;
  let d = sectorCache.get(key); if (d) return d;
  d = SECT.base.slice();
  if (sx || sy) {
    const rng = mulberry((sx * 73856093) ^ (sy * 19349663) ^ 0x5bd1e995);
    const groups = new Map();
    SECT.slots.forEach((s, i) => { const g = s.big ? 's' + s.span : 'b' + s.band; (groups.get(g) || groups.set(g, []).get(g)).push(i); });
    for (const idx of groups.values()) {
      const vals = idx.map(i => d[i]);
      for (let i = vals.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [vals[i], vals[j]] = [vals[j], vals[i]]; }
      idx.forEach((i, k) => d[i] = vals[k]);
    }
    d.mirror = (sx & 1) ^ (sy & 1);
  }
  d.index = new Map(d.map((pi, si) => [pi, si]));
  if (sectorCache.size > 400) sectorCache.delete(sectorCache.keys().next().value);
  sectorCache.set(key, d); return d;
}
function instAt(si, sx, sy) {
  const d = sectorDeal(sx, sy), s = SECT.slots[si], p = P[d[si]];
  let x = s.x; if (d.mirror) x = SECT.w - GAP - s.x - s.w;
  return { p, si, sx, sy, key: si + ':' + sx + ':' + sy, x: SECT.ox + sx * SECT.w + x, y: SECT.oy + sy * SECT.h + s.y, w: s.w, h: s.h };
}
const secName = (sx, sy) => (!sx && !sy) ? 'S·ORIGIN' : `S${sx >= 0 ? '+' : '−'}${pad(Math.abs(sx))}${sy >= 0 ? '+' : '−'}${pad(Math.abs(sy))}`;
const instCode = it => it.p.code + (it.sx || it.sy ? ' · ' + secName(it.sx, it.sy) : '');
function instOfPhotoNear(p, wx, wy) {
  let best = null, bd = 1e18;
  const sx0 = Math.floor((wx - SECT.ox) / SECT.w), sy0 = Math.floor((wy - SECT.oy) / SECT.h);
  for (let sy = sy0 - 1; sy <= sy0 + 1; sy++) for (let sx = sx0 - 1; sx <= sx0 + 1; sx++) {
    const k = sectorDeal(sx, sy).index.get(p.i); if (k == null) continue;
    const it = instAt(k, sx, sy), dd = (it.x + it.w / 2 - wx) ** 2 + (it.y + it.h / 2 - wy) ** 2;
    if (dd < bd) { bd = dd; best = it; }
  }
  return best || instAt(sectorDeal(0, 0).index.get(p.i), 0, 0);
}

/* ---------- ATLAS layout: the network on a world map ---------- */
const GX = 12, GY = 14;
const geoProj = (lon, lat) => [lon * GX, -lat * GY];
function buildAtlas() {
  const S = 13, cell = S + 1.5;
  const occ = new Set();
  const order = P.slice().sort((a, b) => (b.geoReal ? 1 : 0) - (a.geoReal ? 1 : 0));
  for (const p of order) {
    const [gx, gy] = geoProj(p.lon, p.lat);
    const cx = Math.round(gx / cell), cy = Math.round(gy / cell);
    let x = cx, y = cy, ring = 0, found = !occ.has(x + ',' + y);
    while (!found && ring < 40) {
      ring++;
      for (let dx = -ring; dx <= ring && !found; dx++) for (let dy = -ring; dy <= ring && !found; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (!occ.has((cx + dx) + ',' + (cy + dy))) { x = cx + dx; y = cy + dy; found = true; }
      }
    }
    occ.add(x + ',' + y);
    p.atlas = { x: x * cell - S / 2, y: y * cell - S / 2, w: S, h: S };
    p.atlas.c = coverCrop(p, S, S);
    p.geoPx = [gx, gy];
  }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of P) { minX = Math.min(minX, p.atlas.x); minY = Math.min(minY, p.atlas.y); maxX = Math.max(maxX, p.atlas.x + S); maxY = Math.max(maxY, p.atlas.y + S); }
  L.atlas = { w: Math.max(2600, maxX - minX + 300), h: Math.max(1200, maxY - minY + 300), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  const hubs = new Map();
  for (const p of P) { if (!p.place) continue; const h = hubs.get(p.place) || hubs.set(p.place, { name: p.place, n: 0, x: 0, y: 0 }).get(p.place); h.n++; h.x += p.geoPx[0]; h.y += p.geoPx[1]; }
  L.atlas.hubs = [...hubs.values()].filter(h => h.n >= 3).map(h => ({ ...h, x: h.x / h.n, y: h.y / h.n })).sort((a, b) => b.n - a.n);
  const dots = [];
  for (let y = 0; y < WORLD.h; y++) { const row = WORLD.rows[y]; for (let x = 0; x < WORLD.w; x++) if (row[x] === '1') dots.push(geoProj(x - 180 + .5, WORLD.lat0 - y - .5)); }
  L.atlas.dots = dots;
  worldCache = null;
}

/* ---------- images: sprite atlases + 3 tiers ---------- */
const ATL = { a64: [], a24: [] };
let atlasReady = 0, atlasTotal = 0;
const ATLAS_SPEC = { a64: [16, 64], a24: [42, 24] };
function loadAtlases() {
  for (const name of ['a24', 'a64']) {
    const [per] = ATLAS_SPEC[name], n = Math.ceil(D.atlasCount / (per * per));
    for (let k = 0; k < n; k++) { atlasTotal++; const im = new Image(); im.onload = () => { im.ok = true; atlasReady++; sectorBitmaps.clear(); sectorVer++; }; im.src = BASE + `atlas/${name}_${k}.webp`; ATL[name][k] = im; }
  }
}
function atlasCell(p, name) {
  if (p.ai == null) return null;
  const [per, cell] = ATLAS_SPEC[name], sheet = Math.floor(p.ai / (per * per)), k = p.ai % (per * per);
  const im = ATL[name][sheet]; if (!im || !im.ok) return null;
  return [im, (k % per) * cell, Math.floor(k / per) * cell, cell];
}
const queue = []; let inflight = 0; const MAXF = 6;
let thumbsLoaded = 0;
function request(p, lvl) {
  if (p.img[lvl] || p.local) return;
  const im = new Image(); im.decoding = 'async'; im.ok = false; p.img[lvl] = im;
  if (lvl === 'thumb') { im.onload = () => { im.ok = true; thumbsLoaded++; }; im.onerror = () => { thumbsLoaded++; }; im.src = BASE + 'thumb/' + p.id + '.webp'; return; }
  queue.push([p, lvl, im]); pump();
}
function pump() {
  while (inflight < MAXF && queue.length) {
    const [p, lvl, im] = queue.pop();
    if (p.img[lvl] !== im) continue;
    inflight++;
    im.onload = () => { im.ok = true; inflight--; pump(); };
    im.onerror = () => { inflight--; p.img[lvl] = null; pump(); };
    im.src = BASE + lvl + '/' + p.id + '.webp';
  }
}
function best(p) { const f = p.img.full, pv = p.img.preview, t = p.img.thumb; if (f && f.ok) return f; if (pv && pv.ok) return pv; if (t && t.ok) return t; return null; }
function want(p, pxW, now) {
  const need = pxW * DPR;
  if (need > 56) { request(p, 'thumb'); p.used.thumb = now; }
  if (need > 420) { request(p, 'preview'); p.used.preview = now; }
  if (need > 1250) { request(p, 'full'); p.used.full = now; }
}
function evict(now) {
  for (const lvl of ['thumb', 'preview', 'full']) {
    const cap = lvl === 'full' ? 8 : lvl === 'preview' ? 70 : 700;
    const live = P.filter(p => p.img[lvl] && !p.local); if (live.length <= cap) continue;
    live.sort((a, b) => a.used[lvl] - b.used[lvl]);
    for (let i = 0; i < live.length - cap; i++) { const p = live[i]; if (now - p.used[lvl] > 5000 && p !== S.sel && (!S.portal || p !== S.portal.to) && !S.routes.includes(p)) { p.img[lvl].src = ''; p.img[lvl] = null; } }
  }
}

/* ---------- state & view ---------- */
const S = {
  mode: 'BOOT', layout: 'grid', sel: null, selInst: null,
  focus: 0, focusAnim: null, morph: null, portal: null,
  trace: [], traceShow: true, traceDraw: 0,
  lastInput: performance.now(), hover: null, hoverLens: -1, relHover: -1,
  observer: false, sound: false, routes: [], focusAt: 0, nudge: 0, jumps: 0, hunt: null,
};
const view = { x: 0, y: 0, s: .3, vx: 0, vy: 0, zt: null, za: null, anim: null };
function fitScale(layout) {
  if (layout === 'atlas') return Math.min((W - 80) / L.atlas.w, (H - 120) / L.atlas.h);
  const k = Math.min((W - (W < 700 ? 24 : 120)) / SECT.w, (H - (W < 700 ? 150 : 140)) / SECT.h);
  return (W < 700 && H > W) ? Math.max(k, (H * .5) / SECT.h) : k;
}
const minScale = () => S.layout === 'atlas' ? fitScale('atlas') * .7 : fitScale('grid') * .14;
const maxScale = () => S.layout === 'atlas' ? 6 : Math.max(4, W / U * .9);
const toScreen = r => ({ x: (r.x - view.x) * view.s + W / 2, y: (r.y - view.y) * view.s + H / 2, w: r.w * view.s, h: r.h * view.s, c: r.c });
const toWorld = (sx, sy) => [(sx - W / 2) / view.s + view.x, (sy - H / 2) / view.s + view.y];
function animView(to, dur, ease = eio) { view.anim = { from: { x: view.x, y: view.y, s: view.s }, to, t0: performance.now(), dur, ease }; view.vx = view.vy = 0; view.zt = null; }

/* ---------- audio (all synthesized; off by default) ---------- */
const AU = { ctx: null, master: null };
function audioInit() {
  if (AU.ctx) return;
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const m = ac.createGain(); m.gain.value = 0; m.connect(ac.destination);
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
  o1.frequency.value = 55; o2.frequency.value = 55.4; o2.type = 'triangle';
  f.type = 'lowpass'; f.frequency.value = 240; g.gain.value = .05;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(m); o1.start(); o2.start();
  AU.ctx = ac; AU.master = m;
}
function setSound(on) {
  S.sound = on; $('#btnSound').textContent = on ? 'SOUND ON' : 'SOUND OFF'; $('#btnSound').classList.toggle('on', on);
  if (on) audioInit();
  if (AU.ctx) { AU.ctx.resume(); AU.master.gain.setTargetAtTime(on ? .9 : 0, AU.ctx.currentTime, .4); }
  try { localStorage.setItem('tm_sound', on ? '1' : '0'); } catch (e) { }
}
function blip(freq = 1800, dur = .05, vol = .04, type = 'sine') {
  if (!S.sound || !AU.ctx) return;
  const ac = AU.ctx, o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = freq; o.type = type; g.gain.value = vol;
  g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + dur);
  o.connect(g); g.connect(AU.master); o.start(); o.stop(ac.currentTime + dur + .02);
}
const chord = (fs, dur = .5, vol = .03) => fs.forEach((f, i) => setTimeout(() => blip(f, dur, vol, 'triangle'), i * 70));
function whoosh(dur = 1.6) {
  if (!S.sound || !AU.ctx) return;
  const ac = AU.ctx, len = ac.sampleRate * dur, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
  f.frequency.setValueAtTime(200, ac.currentTime); f.frequency.exponentialRampToValueAtTime(2400, ac.currentTime + dur * .48); f.frequency.exponentialRampToValueAtTime(160, ac.currentTime + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(.12, ac.currentTime + dur * .45); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(AU.master); src.start();
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, COARSE ? 1.75 : 2) * (lowPower ? .75 : 1);
  const bounds = canvas.getBoundingClientRect();
  W = bounds.width; H = bounds.height;
  for (const c of [canvas, fxc]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  sectorBitmaps.clear(); sectorVer++; worldCache = null;
}
addEventListener('resize', resize);
// Mobile browsers can update dynamic viewport units after the window resize event.
// Observe the rendered canvas so its drawing buffer follows the final layout.
new ResizeObserver(resize).observe(canvas);
let lowPower = false;

/* ---------- far zoom: sector bitmaps ---------- */
const sectorBitmaps = new Map(); let sectorVer = 0;
function sectorBitmap(sx, sy, lvl) {
  const key = sx + ',' + sy + ',' + lvl;
  let b = sectorBitmaps.get(key); if (b) return b;
  if (!atlasReady) return null;
  const k = lvl / U, cw = Math.ceil(SECT.w * k), ch = Math.ceil(SECT.h * k);
  b = document.createElement('canvas'); b.width = cw; b.height = ch;
  const g = b.getContext('2d'); g.fillStyle = C.bg; g.fillRect(0, 0, cw, ch);
  const d = sectorDeal(sx, sy), name = lvl > 26 ? 'a64' : 'a24';
  SECT.slots.forEach((s, si) => {
    const p = P[d[si]]; let x = s.x; if (d.mirror) x = SECT.w - GAP - s.x - s.w;
    const X = x * k, Y = s.y * k, Wd = s.w * k, Hd = s.h * k;
    const ac = atlasCell(p, name);
    if (ac) {
      const [im, ax, ay, cs] = ac, r = Wd / Hd; let sw = cs, sh = cs, ox = 0, oy = 0;
      if (r > 1) { sh = cs / r; oy = (cs - sh) / 2; } else if (r < 1) { sw = cs * r; ox = (cs - sw) / 2; }
      g.drawImage(im, ax + ox, ay + oy, sw, sh, X, Y, Wd, Hd);
    } else if (p.local && p.img.thumb) g.drawImage(p.img.thumb, X, Y, Wd, Hd);
    else { g.fillStyle = p.color; g.fillRect(X, Y, Wd, Hd); }
  });
  if (sectorBitmaps.size > 60) sectorBitmaps.delete(sectorBitmaps.keys().next().value);
  sectorBitmaps.set(key, b); return b;
}

/* ---------- visible instances ---------- */
let VIS = [];
function visibleSectors() {
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
  return { sx0: Math.floor((x0 - SECT.ox) / SECT.w), sx1: Math.floor((x1 - SECT.ox) / SECT.w), sy0: Math.floor((y0 - SECT.oy) / SECT.h), sy1: Math.floor((y1 - SECT.oy) / SECT.h), x0, y0, x1, y1 };
}
function collectVisible(v) {
  const out = [];
  for (let sy = v.sy0; sy <= v.sy1; sy++) for (let sx = v.sx0; sx <= v.sx1; sx++) {
    const d = sectorDeal(sx, sy), ox = SECT.ox + sx * SECT.w, oy = SECT.oy + sy * SECT.h;
    // quick reject whole sector rows via slot row range
    const rMin = Math.floor((v.y0 - oy) / PITCH) - 2, rMax = Math.ceil((v.y1 - oy) / PITCH) + 1;
    const slots = SECT.slots;
    for (let si = 0; si < slots.length; si++) {
      const s = slots[si]; if (s.r < rMin || s.r > rMax) continue;
      let x = s.x; if (d.mirror) x = SECT.w - GAP - s.x - s.w;
      const X = ox + x, Y = oy + s.y;
      if (X > v.x1 || Y > v.y1 || X + s.w < v.x0 || Y + s.h < v.y0) continue;
      out.push({ p: P[d[si]], si, sx, sy, key: si + ':' + sx + ':' + sy, x: X, y: Y, w: s.w, h: s.h });
    }
  }
  return Submit.items.length ? out.concat(Submit.visible(v)) : out;
}
function worldRectOf(it, now) {
  const g = { x: it.x, y: it.y, w: it.w, h: it.h, c: coverCrop(it.p, it.w, it.h) };
  const m = S.morph, origin = !it.sx && !it.sy;
  if (!m) return S.layout === 'grid' ? g : (origin ? it.p.atlas : null);
  const t = clamp((now - m.t0 - (origin ? it.p.mdelay || 0 : 0)) / m.dur, 0, 1), e = eio(t);
  if (!origin) return m.to === 'atlas' ? (e < 1 ? { ...g, fade: 1 - e } : null) : (e > 0 ? { ...g, fade: e } : null);
  return m.to === 'atlas' ? lerpRect(g, it.p.atlas, e) : lerpRect(it.p.atlas, g, e);
}
function focusRect(p) {
  const narrow = COMPACT(), landscape = narrow && W > H && H <= 500;
  let top = 0, bottom = H;
  if (narrow) {
    const meta = S.hunt ? $('#hunt') : $('#focusMeta');
    top = meta.getBoundingClientRect().bottom + 16;
    bottom = (landscape ? $('#credit') : $('#related')).getBoundingClientRect().top - 20;
    if (bottom <= top + 40) bottom = $('.hud-br').getBoundingClientRect().top - 28;
  }
  const mw = W * (landscape ? .72 : narrow ? .92 : .62), mh = narrow ? Math.max(40, bottom - top) : H * .7;
  let w = mw, h = w / p.a; if (h > mh) { h = mh; w = h * p.a; }
  const cx = landscape ? W * .59 : narrow ? W / 2 : W * .48, cy = narrow ? (top + bottom) / 2 : H * .53;
  return { x: cx - w / 2, y: cy - h / 2, w, h, c: [0, 0, 1, 1] };
}

/* ---------- modes ---------- */
function setMode(m) {
  S.mode = m;
  document.body.classList.toggle('focus', m === 'FOCUS' || m === 'PORTAL');
  document.body.classList.toggle('portal', m === 'PORTAL');
}
function focusOn(it, via = 'click') {
  if (S.mode === 'PORTAL' || !it) return;
  const p = it.p;
  S.sel = p; S.selInst = it; request(p, 'preview'); request(p, 'full');
  pushTrace(it, via);
  S.focusAnim = { from: S.focus, to: 1, t0: performance.now(), dur: REDUCE ? 250 : 950 };
  S.focusAt = performance.now() + (REDUCE ? 0 : 620); S.nudge = 0; S.scanT = performance.now() + 300;
  setMode('FOCUS'); fillMeta(p, it); blip(1400, .06, .05);
  if (!S.hunt) hint(p.cam ? (COARSE ? 'TAP THE CAMERA TO ENTER' : 'CLICK THE CAMERA TO ENTER  ·  ESC TO RETURN') : 'CLICK THE PHOTO TO ENTER  ·  ESC TO RETURN', 4200, 'focus');
  Hunt.onFocus(it);
}
function unfocus() {
  if (S.mode !== 'FOCUS') return;
  S.focusAnim = { from: S.focus, to: 0, t0: performance.now(), dur: REDUCE ? 250 : 800 };
  setMode('EXPLORE');
  const pts = S.trace.slice(-14).map(t => t.inst).filter(Boolean);
  if (S.layout === 'grid' && pts.length > 1 && !REDUCE && !S.hunt) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }
    const s = clamp(Math.min((W * .7) / (x1 - x0), (H * .62) / (y1 - y0)), fitScale('grid') * .3, Math.max(view.s, fitScale('grid') * 2.4));
    animView({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, s }, 1300);
    S.traceDraw = performance.now() + 500;
    if (S.jumps >= 3 && !S.saidWatched) { S.saidWatched = true; setTimeout(() => say('YOU ARE BEING WATCHED', `${pad(S.trace.length)} NODES · YOUR PATH HAS BEEN RECORDED`), 1500); }
  } else if (S.selInst && S.layout === 'grid') {
    const r = toScreen(S.selInst);
    if (r.x + r.w < 0 || r.x > W || r.y + r.h < 0 || r.y > H) animView({ x: S.selInst.x + S.selInst.w / 2, y: S.selInst.y + S.selInst.h / 2, s: view.s }, 900);
  }
}
function enter(target, camIdx = 0) {
  if (S.mode !== 'FOCUS' || !S.sel) return;
  const from = S.sel;
  const to = target || S.routes[camIdx] || nextPhoto(from);
  if (!to || to === from) return;
  request(to, 'preview'); request(to, 'full');
  const fromAnchor = from.cams[camIdx] ? from.cams[camIdx].lens : from.anchor;
  const fast = Hunt.fastPortal();
  S.portal = { from, to, fromAnchor, t0: performance.now(), dur: REDUCE ? 700 : fast ? 1050 : 1700, swapped: false, cam: camIdx, feeds: pickFeeds(to) };
  setMode('PORTAL'); whoosh(S.portal.dur / 1000); blip(900, .08, .04);
  S.jumps++;
}
function pickFeeds(to) { const out = []; for (let i = 0; i < 7; i++) out.push(P[Math.floor(rnd() * N)]); out.push(to); return out; }
function nextPhoto(p) {
  const recent = new Set(S.trace.slice(-8).map(t => t.id));
  const all = p.links.map(id => byId.get(id)).filter(Boolean);
  const pool = all.filter(q => !recent.has(q.id));
  const use = pool.length ? pool : all;
  if (!use.length) return P[(p.i + 1 + Math.floor(rnd() * (N - 1))) % N];
  const w = use.map((q, i) => (q.cam ? 1 : .35) * (i === 0 ? 1.4 : 1));
  let s = w.reduce((a, b) => a + b, 0) * rnd();
  for (let i = 0; i < use.length; i++) { s -= w[i]; if (s <= 0) return use[i]; }
  return use[0];
}
function planRoutes(p) {
  const recent = new Set(S.trace.slice(-8).map(t => t.id));
  const pool = p.links.map(id => byId.get(id)).filter(q => q && !recent.has(q.id) && q !== p);
  const n = Math.max(1, p.cams.length);
  S.routes = [];
  for (let k = 0; k < n; k++) {
    let q = (k === 0 && !S.hunt ? Observer.takeRoute() : null) || Hunt.route(p, k) || (k === 0 ? nextPhoto(p) : pool[k % Math.max(1, pool.length)]);
    if (!q || q === p || S.routes.includes(q)) q = pool.find(x => !S.routes.includes(x)) || P[Math.floor(rnd() * N)];
    S.routes.push(q); request(q, 'preview');
  }
  if (S.routes[0]) request(S.routes[0], 'full');
}
function setLayout(l) {
  if (l === S.layout || S.mode === 'BOOT' || S.mode === 'PORTAL' || S.hunt) return;
  if (S.mode === 'FOCUS') unfocus();
  const now = performance.now(), base = sectorDeal(0, 0);
  for (const p of P) {
    const it = instAt(base.index.get(p.i), 0, 0);
    p.mdelay = REDUCE ? 0 : Math.min(700, Math.hypot(it.x - view.x, it.y - view.y) * .1) + rnd() * 260;
  }
  S.morph = { from: S.layout, to: l, t0: now, dur: REDUCE ? 300 : 1400 };
  S.layout = l;
  document.body.classList.toggle('atlas', l === 'atlas');
  $('#btnGrid').classList.toggle('on', l === 'grid'); $('#btnAtlas').classList.toggle('on', l === 'atlas');
  $('#btnGrid').setAttribute('aria-selected', String(l === 'grid')); $('#btnAtlas').setAttribute('aria-selected', String(l === 'atlas'));
  if (l === 'atlas') {
    // pull out of the infinite wall first, then settle on the planet
    animView({ x: L.atlas.cx, y: L.atlas.cy, s: fitScale('atlas') }, REDUCE ? 300 : 1900);
    feedStart(); setTimeout(() => say('ANALOG INTERFACE', `${N} EYES · ${L.atlas.hubs.length} CITIES · ${countries()} COUNTRIES`), REDUCE ? 0 : 1300);
  } else animView({ x: 0, y: 0, s: fitScale('grid') }, REDUCE ? 300 : 1500);
  blip(600, .12, .03);
}
const countries = () => new Set(P.map(p => p.country).filter(Boolean)).size;

/* ---------- trace ---------- */
const traceNo = 1 + ((+readLocal('tm_traces') || 0));
try { localStorage.setItem('tm_traces', traceNo); } catch (e) { }
function pushTrace(it, via) {
  const last = S.trace[S.trace.length - 1];
  if (last && last.id === it.p.id) return;
  S.trace.push({ id: it.p.id, inst: it, at: Math.round(performance.now()), via, from: last ? last.id : null });
  it.p.visited = true;
  const strip = $('#traceStrip');
  const im = document.createElement('img'); im.src = thumbSrc(it.p); im.alt = it.p.code; im.title = instCode(it);
  im.onclick = () => { if (S.mode === 'PORTAL') return; if (S.mode === 'FOCUS' && S.sel !== it.p) enter(it.p); else if (S.mode === 'EXPLORE') focusOn(it, 'trace'); };
  strip.appendChild(im);
  while (strip.children.length > 24) strip.removeChild(strip.firstChild);
  [...strip.children].forEach(c => c.classList.toggle('cur', c === im));
  $('#traceLabel').textContent = `TRACE_${pad(traceNo, 4)} · ${pad(S.trace.length)} NODES`;
  $('#traceLabel').classList.toggle('on', S.traceShow);
  try { history.replaceState(null, '', '#trace=' + S.trace.map(t => t.id + (t.inst.sx || t.inst.sy ? '@' + t.inst.sx + '_' + t.inst.sy : '')).join('.')); } catch (e) { }
}
const thumbSrc = p => p.local ? p.dataUrl : BASE + 'thumb/' + p.id + '.webp';

/* ---------- DOM helpers ---------- */
let hintTimer = null; const hintSeen = {};
function hint(text, ms = 3000, key) {
  if (key) { if ((hintSeen[key] = (hintSeen[key] || 0) + 1) > 2) return; }
  const h = $('#hint'); h.textContent = text; h.classList.add('on');
  clearTimeout(hintTimer); hintTimer = setTimeout(() => h.classList.remove('on'), ms);
}
function say(text, sub) {
  const el = $('#say'); el.classList.remove('on'); void el.offsetWidth;
  el.textContent = text; if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
  el.classList.add('on'); blip(220, .8, .05, 'triangle');
}
function stamp(x, y, top, big, red) {
  const el = document.createElement('div'); el.className = 'stamp' + (red ? ' red' : '');
  el.innerHTML = `${top}${big ? `<b>${big}</b>` : ''}`; el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1400);
}
function classify(p) {
  if (S.hunt && S.hunt.target === p) return ['threat', 'TARGET'];
  if (p.local) return ['admin', 'CONTRIBUTED'];
  if (p.visited) return ['admin', 'KNOWN'];
  return ['', 'ASSET'];
}
function fillMeta(p, it) {
  planRoutes(p);
  const [cls, tag] = classify(p);
  const ft = $('#fmTag'); ft.className = 'fm-tag ' + cls; ft.textContent = tag;
  $('#fmId').textContent = p.code;
  $('#fmScene').textContent = (p.sceneEn || 'URBAN') + '  ·  ' + p.w + '×' + p.h + (it && (it.sx || it.sy) ? '  ·  ' + secName(it.sx, it.sy) : '');
  $('#fmGeo').textContent = p.place ? `${p.place.toUpperCase()}  ·  ${fmtGeo(p)}` : (p.lat != null && !p.local ? fmtGeo(p) : 'LOCATION UNVERIFIED');
  $('#fmAnchor').textContent = !p.cam ? 'NO ANCHOR · FULL FRAME' : (p.cams.length > 1 ? `${p.cams.length} EYES · ` : '') + (p.cam.src === 'reviewed' || p.cam.src === 'user' ? 'LENS ANCHOR · REVIEWED' : p.cam.src === 'model' ? 'LENS LOCATED' : 'BODY LOCATED · LENS ESTIMATED');
  $('#credit').textContent = p.local ? `CONTRIBUTED BY ${p.author}  ·  STORED ON THIS DEVICE` : `PHOTO  ${p.author}  ·  ${p.license}  ·  ${p.provider}`;
  const rel = $('#related'); rel.innerHTML = '<div class="rl">LINKED</div>';
  const list = [...S.routes];
  p.links.forEach(id => { const q = byId.get(id); if (q && q !== p && !list.includes(q) && list.length < 3) list.push(q); });
  list.slice(0, 3).forEach((q, k) => {
    const b = document.createElement('button'); b.title = q.code;
    const tag = k < S.routes.length && p.cam ? (p.cams.length > 1 ? `EYE ${k + 1} →` : 'NEXT →') : q.code;
    b.innerHTML = `<img src="${thumbSrc(q)}" alt=""><span>${tag}</span>`;
    b.onclick = e => { e.stopPropagation(); enter(q, k < S.routes.length ? k : 0); };
    b.onmouseenter = () => { request(q, 'preview'); S.relHover = k; };
    b.onmouseleave = () => { S.relHover = -1; };
    rel.appendChild(b);
  });
}

/* ---------- input ---------- */
const ptr = { x: -1e3, y: -1e3, down: false, moved: 0, lt: 0 };
const pointers = new Map(); let pinch = null;
const noteInput = () => { S.lastInput = performance.now(); };
canvas.addEventListener('pointerdown', e => {
  noteInput(); canvas.setPointerCapture(e.pointerId);
  if (e.pointerType !== 'mouse') { ptr.x = e.clientX; ptr.y = e.clientY; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s: view.s, world: toWorld(cx, cy) };
    ptr.moved = 99; view.vx = view.vy = 0; view.anim = null; view.zt = null; canvas.classList.remove('drag'); return;
  }
  ptr.down = true; ptr.moved = 0; ptr.x = e.clientX; ptr.y = e.clientY; ptr.lt = performance.now();
  view.vx = view.vy = 0; view.anim = null;
});
canvas.addEventListener('pointermove', e => {
  noteInput();
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    if (S.mode !== 'EXPLORE') return;
    const [a, b] = [...pointers.values()];
    view.s = clamp(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d, minScale(), maxScale());
    view.x = pinch.world[0] - ((a.x + b.x) / 2 - W / 2) / view.s;
    view.y = pinch.world[1] - ((a.y + b.y) / 2 - H / 2) / view.s; return;
  }
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.x = e.clientX; ptr.y = e.clientY;
  if (ptr.down && S.mode === 'EXPLORE') {
    ptr.moved += Math.abs(dx) + Math.abs(dy);
    if (ptr.moved > 4) canvas.classList.add('drag');
    const now = performance.now(), dt = Math.max(8, now - ptr.lt); ptr.lt = now;
    view.x -= dx / view.s; view.y -= dy / view.s;
    view.vx = lerp(view.vx, -dx / view.s / dt * 16, .5); view.vy = lerp(view.vy, -dy / view.s / dt * 16, .5);
  } else if (ptr.down) ptr.moved += Math.abs(dx) + Math.abs(dy);
});
function release(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; ptr.down = false; return; }
  if (!ptr.down) return;
  ptr.down = false; canvas.classList.remove('drag');
  if (ptr.moved < 8) click(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch = null; ptr.down = false; canvas.classList.remove('drag'); view.vx = view.vy = 0; });
canvas.addEventListener('pointerleave', () => { if (!ptr.down) ptr.x = ptr.y = -1e3; });
function zoomAt(sx, sy, k, immediate) {
  const [wx, wy] = toWorld(sx, sy);
  if (immediate) { view.s = clamp(view.s * k, minScale(), maxScale()); view.x = wx - (sx - W / 2) / view.s; view.y = wy - (sy - H / 2) / view.s; view.zt = null; return; }
  view.zt = clamp((view.zt || view.s) * k, minScale(), maxScale()); view.za = [sx, sy]; view.anim = null;
}
canvas.addEventListener('wheel', e => {
  e.preventDefault(); noteInput();
  if (S.mode !== 'EXPLORE') return;
  const trackpadPan = !e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 1.5 && Math.abs(e.deltaY) < 40;
  if (trackpadPan) { view.x += e.deltaX / view.s; view.y += e.deltaY / view.s; view.anim = null; return; }
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .012 : .0018)));
}, { passive: false });
function hitTile(x, y) {
  for (let i = VIS.length - 1; i >= 0; i--) {
    const it = VIS[i], r = it.sr; if (!r || it.alpha < .2) continue;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return it;
  }
  return null;
}
function lensHit(p, x, y) {
  if (!p.cam || !p.fr) return -1;
  const r = p.fr; let bi = -1, bd = 1e9;
  p.cams.forEach((c, k) => {
    const [lx, ly] = proj(r, c.lens[0], c.lens[1]), b = projBox(r, c.bbox);
    const rad = Math.max(COARSE ? 44 : 30, Math.min(b.w, b.h) * .55), d = Math.hypot(x - lx, y - ly);
    const inBox = x > b.x - 8 && x < b.x + b.w + 8 && y > b.y - 8 && y < b.y + b.h + 8;
    if ((d < rad || inBox) && d < bd) { bd = d; bi = k; }
  });
  return bi;
}
function click(x, y) {
  if (S.mode === 'BOOT') { skipBoot(); return; }
  if (S.mode === 'EXPLORE') {
    if (S.layout === 'grid' && view.s * U < 14) { const [wx, wy] = toWorld(x, y); animView({ x: wx, y: wy, s: Math.max(view.s * 4, fitScale('grid') * .9) }, 900); blip(700, .1, .03); return; }
    const it = hitTile(x, y); if (it) { if (!Hunt.tileClick(it, x, y)) focusOn(it); } else Hunt.miss(x, y); return;
  }
  if (S.mode === 'FOCUS') {
    const p = S.sel, r = p.fr, k = lensHit(p, x, y);
    if (k >= 0) { if (Hunt.confirm(p, k, x, y)) return; enter(null, k); return; }
    if (r && x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) {
      if (!p.cam) { if (Hunt.confirm(p, 0, x, y)) return; enter(); return; }
      S.nudge = performance.now(); blip(2200, .04, .03); Hunt.miss(x, y); return;
    }
    if (!S.hunt || S.hunt.mode !== 'dive') unfocus();
  }
}
addEventListener('keydown', e => {
  if ($('#modal').classList.contains('on')) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    if (e.key === 'Tab') {
      const items = [...$('#mBox').querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')];
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#mBox'))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (e.target && e.target.tagName === 'INPUT') return;
  noteInput();
  const k = e.key.toLowerCase();
  if (k === 'escape') { if ($('#modal').classList.contains('on')) closeModal(); else if (S.mode === 'FOCUS' && (!S.hunt || S.hunt.mode !== 'dive')) unfocus(); else if (S.mode === 'BOOT') skipBoot(); }
  else if (k === 'enter' && S.mode === 'FOCUS' && !S.hunt) enter();
  else if (k === 'g') setLayout('grid');
  else if (k === 'a') setLayout('atlas');
  else if (k === 't') toggleTrace();
  else if (k === 'm') setSound(!S.sound);
  else if (k === 'h' && !S.hunt && S.mode !== 'BOOT') Hunt.brief();
  else if (k === 'u' && S.mode !== 'BOOT' && !S.hunt) Submit.open();
  else if (S.mode === 'EXPLORE' && /^arrow/.test(k)) { const d = 160 / view.s; animView({ x: view.x + (k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0), y: view.y + (k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0), s: view.s }, 350, eout); }
  else if (S.mode === 'EXPLORE' && (k === '+' || k === '=')) zoomAt(W / 2, H / 2, 1.4);
  else if (S.mode === 'EXPLORE' && k === '-') zoomAt(W / 2, H / 2, 1 / 1.4);
});
function toggleTrace() { S.traceShow = !S.traceShow; $('#traceLabel').classList.toggle('on', S.traceShow); if (S.traceShow) S.traceDraw = performance.now(); }
$('#btnGrid').onclick = () => setLayout('grid');
$('#btnAtlas').onclick = () => setLayout('atlas');
$('#btnSound').onclick = () => setSound(!S.sound);
$('#traceLabel').onclick = toggleTrace;
$('#back').onclick = () => unfocus();
$('#btnHunt').onclick = () => Hunt.brief();
$('#btnSubmit').onclick = () => Submit.open();
$('#hQuit').onclick = () => Hunt.end(false);

/* ---------- BOOT: the machine opens its eye, then the wall never ends ---------- */
const boot = { t0: 0, revealT0: 0, typed: -1 };
const BOOT_L1 = 'CAN YOU HEAR ME?', BOOT_L2 = 'ESTABLISHING CONNECTION...';
function startBoot() {
  boot.t0 = performance.now();
  const hero = P.find(p => p.code === D.bootHero) || P[0];
  const it = instAt(sectorDeal(0, 0).index.get(hero.i), 0, 0), c = coverCrop(hero, it.w, it.h);
  view.x = it.x + (hero.anchor[0] - c[0]) / (c[2] - c[0]) * it.w; view.y = it.y + (hero.anchor[1] - c[1]) / (c[3] - c[1]) * it.h;
  view.s = Math.max(W, H) / (it.w * .9);
  request(hero, 'preview'); request(hero, 'thumb');
  for (const s of SECT.slots) s.revDelay = Math.hypot(s.x + s.w / 2 - SECT.w / 2, (s.y + s.h / 2 - SECT.h / 2) * 1.6) * .8 + rnd() * 520;
}
function skipBoot() {
  if (S.mode !== 'BOOT') return;
  if (!boot.revealT0) beginReveal(true);
  else { SECT.slots.forEach(s => s.revDelay = 0); boot.revealT0 = performance.now() - 2600; if (view.anim) view.anim.dur = 300; }
}
function beginReveal(fast) {
  boot.revealT0 = performance.now();
  $('#bootText').textContent = 'SYSTEM ACTIVE'; $('#bootSub').textContent = '';
  setTimeout(() => $('#boot').classList.add('gone'), fast ? 200 : 600);
  const quick = REDUCE || fast, dur = quick ? 600 : 3200;
  if (quick) SECT.slots.forEach(s => s.revDelay *= .15);
  animView({ x: 0, y: 0, s: fitScale('grid') }, dur, t => t < .22 ? .12 * eio(t / .22) : .12 + .88 * eio((t - .22) / .78));
  blip(320, .5, .04);
  // aha: keep pulling back — the wall is not the whole world
  if (!quick) setTimeout(() => {
    animView({ x: 0, y: 0, s: fitScale('grid') * .2 }, 2300, eio);
    say(`${N} EYES`, 'THE NETWORK DOES NOT END');
    setTimeout(() => { if (S.mode === 'EXPLORE' && view.s < fitScale('grid') * .3 && performance.now() - S.lastInput > 2000) animView({ x: 0, y: 0, s: fitScale('grid') }, 1800, eio); }, 2600);
  }, dur + 250);
  setTimeout(() => {
    setMode('EXPLORE'); document.body.classList.add('live'); S.lastInput = performance.now();
    countEyes();
    hint(COARSE ? 'DRAG  ·  PINCH  ·  TAP A PHOTO' : 'DRAG  ·  SCROLL TO ZOOM  ·  CLICK A PHOTO  ·  H  THE SEARCH', 5200, 'explore');
  }, dur + 300);
}
function countEyes() {
  const el = $('#eyeCount'), t0 = performance.now();
  const step = () => { const t = clamp((performance.now() - t0) / 1400, 0, 1); el.textContent = Math.round(eout(t) * N); if (t < 1) requestAnimationFrame(step); };
  step();
}
function bootTick(now) {
  if (boot.revealT0) return;
  const t = now - boot.t0;
  let txt;
  if (t < 250) txt = '';
  else if (t < 250 + BOOT_L1.length * 60) txt = BOOT_L1.slice(0, Math.floor((t - 250) / 60));
  else if (t < 1700) txt = BOOT_L1;
  else if (t < 1700 + BOOT_L2.length * 30) txt = BOOT_L2.slice(0, Math.floor((t - 1700) / 30));
  else txt = BOOT_L2;
  if (txt !== boot.typed) { boot.typed = txt; $('#bootText').textContent = txt; if (txt.length % 3 === 0) blip(2600, .015, .015); }
  $('#bootSub').textContent = t > 1800 ? `${pad(Math.min(N, Math.round(atlasReady / Math.max(1, atlasTotal) * N)), 3)} / ${N}  NODES` : '';
  if ((atlasReady >= atlasTotal && t > 2700) || t > 9000) beginReveal(false);
}

/* ---------- drawing primitives ---------- */
function bracket(g, x, y, w, h, len, color, lw = 1) {
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath();
  const l = Math.min(len, w / 2.2, h / 2.2);
  g.moveTo(x, y + l); g.lineTo(x, y); g.lineTo(x + l, y);
  g.moveTo(x + w - l, y); g.lineTo(x + w, y); g.lineTo(x + w, y + l);
  g.moveTo(x + w, y + h - l); g.lineTo(x + w, y + h); g.lineTo(x + w - l, y + h);
  g.moveTo(x + l, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - l);
  g.stroke();
}
function poiBox(g, x, y, w, h, rgb, a, text, dashed) {
  if (dashed) { g.setLineDash([3, 3]); g.strokeStyle = `rgba(${rgb},${a * .55})`; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1); g.setLineDash([]); }
  bracket(g, x, y, w, h, 10, `rgba(${rgb},${a})`, 1.3);
  if (text) {
    g.font = `9.5px ${MONO}`; const tw = g.measureText(text).width;
    g.fillStyle = `rgba(${rgb},${a})`; g.fillRect(x, y - 15, tw + 10, 13);
    g.fillStyle = `rgba(8,11,13,${a})`; g.fillText(text, x + 5, y - 5);
  }
}
function label(g, text, x, y, color, size = 10, bg = 'rgba(8,11,13,.72)') {
  g.font = `${size}px ${MONO}`; const w = g.measureText(text).width;
  if (bg) { g.fillStyle = bg; g.fillRect(x - 3, y - size - 2, w + 6, size + 5); }
  g.fillStyle = color; g.fillText(text, x, y);
}
function drawImgTile(p, r, alpha, preferAtlas, g = ctx) {
  if (r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0 || alpha <= .01) return;
  g.globalAlpha = alpha;
  const im = best(p), pxW = r.w * DPR;
  if (!p.local && (!im || (preferAtlas && pxW < 64))) {
    const ac = atlasCell(p, pxW > 28 ? 'a64' : 'a24');
    if (ac) {
      const [aim, ax, ay, cs] = ac, rr = r.w / r.h; let sw = cs, sh = cs, ox = 0, oy = 0;
      if (rr > 1) { sh = cs / rr; oy = (cs - sh) / 2; } else if (rr < 1) { sw = cs * rr; ox = (cs - sw) / 2; }
      g.drawImage(aim, ax + ox, ay + oy, sw, sh, r.x, r.y, r.w, r.h); g.globalAlpha = 1; return;
    }
  }
  if (!im) { g.fillStyle = p.color; g.fillRect(r.x, r.y, r.w, r.h); g.globalAlpha = 1; return; }
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, c = r.c || [0, 0, 1, 1];
  g.drawImage(im, c[0] * iw, c[1] * ih, (c[2] - c[0]) * iw, (c[3] - c[1]) * ih, r.x, r.y, r.w, r.h);
  g.globalAlpha = 1;
}
function lensRing(g, x, y, rad, a, rgb = C.scan) {
  g.strokeStyle = `rgba(${rgb},${a})`; g.lineWidth = 1;
  g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke();
  g.fillStyle = `rgba(${rgb},${Math.min(1, a * 1.4)})`; g.fillRect(x - 1, y - 1, 2, 2);
}

/* ---------- frame loop ---------- */
const pulses = []; let nextPulse = 0;
const attn = { on: 0, target: null, box: null, t0: 0, next: 0 };
let lastFrame = performance.now(), fpsAvg = 60, slowFrames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - lastFrame; lastFrame = now;
  fpsAvg = lerp(fpsAvg, 1000 / Math.max(1, dt), .05);
  // adaptive resolution: if the machine struggles, it squints
  if (fpsAvg < 40 && S.mode !== 'BOOT' && document.visibilityState === 'visible') { if (++slowFrames > 90 && !lowPower) { lowPower = true; resize(); } } else slowFrames = 0;
  if (S.mode === 'BOOT') bootTick(now);
  stepView(now);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); fx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  if (S.mode === 'PORTAL') { drawPortal(now); Hunt.draw(now); drawReticle(now); return; }
  drawWorld(now);
  drawField(now);
  drawWall(now);
  drawAtlasLayer(now);
  drawTrace(now);
  drawPulses(now);
  drawAttention(now);
  if (S.hover && S.mode === 'EXPLORE' && S.layout === 'grid') drawHover(S.hover, now);
  if (S.sel && S.focus > 0) drawFocused(S.sel, now);
  Hunt.draw(now);
  drawReticle(now);
  hudTick(now);
  if (now - (frame.ev || 0) > 1500) { frame.ev = now; evict(now); }
}
function stepView(now) {
  if (view.anim) {
    const a = view.anim, t = clamp((now - a.t0) / a.dur, 0, 1), e = a.ease(t);
    view.x = lerp(a.from.x, a.to.x, e); view.y = lerp(a.from.y, a.to.y, e);
    view.s = Math.exp(lerp(Math.log(a.from.s), Math.log(a.to.s), e));
    if (t >= 1) view.anim = null;
  } else if (!ptr.down && S.mode === 'EXPLORE') {
    view.x += view.vx; view.y += view.vy; view.vx *= .92; view.vy *= .92;
    if (view.zt) {
      const [wx, wy] = toWorld(view.za[0], view.za[1]);
      view.s = lerp(view.s, view.zt, .22); view.x = wx - (view.za[0] - W / 2) / view.s; view.y = wy - (view.za[1] - H / 2) / view.s;
      if (Math.abs(view.s - view.zt) < view.zt * .002) { view.s = view.zt; view.zt = null; }
    }
    if (S.layout === 'atlas') {
      const bx = Math.max(0, L.atlas.w / 2 - W / 2 / view.s + 200), by = Math.max(0, L.atlas.h / 2 - H / 2 / view.s + 200);
      view.x = lerp(view.x, clamp(view.x, L.atlas.cx - bx, L.atlas.cx + bx), .15); view.y = lerp(view.y, clamp(view.y, L.atlas.cy - by, L.atlas.cy + by), .15);
    }
  }
  if (S.focusAnim) {
    const a = S.focusAnim, t = clamp((now - a.t0) / a.dur, 0, 1);
    S.focus = lerp(a.from, a.to, a.to > a.from ? eoutQ(t) : eio(t));
    if (t >= 1) { S.focusAnim = null; if (S.focus === 0) { S.sel = null; S.selInst = null; } }
  }
  if (S.morph && now - S.morph.t0 > S.morph.dur + 1000) S.morph = null;
}
function drawField(now) {
  const step = 220 * view.s; if (step < 18) return;
  const a = .07 * clamp((step - 18) / 40, 0, 1) * (1 - S.focus * .8) * (S.layout === 'atlas' ? .3 : 1);
  ctx.fillStyle = `rgba(220,238,230,${a})`;
  const ox = ((-view.x * view.s + W / 2) % step + step) % step, oy = ((-view.y * view.s + H / 2) % step + step) % step;
  for (let x = ox; x < W; x += step) for (let y = oy; y < H; y += step) { ctx.fillRect(x - 3, y, 7, 1); ctx.fillRect(x, y - 3, 1, 7); }
}
const sectorScreen = (sx, sy) => toScreen({ x: SECT.ox + sx * SECT.w, y: SECT.oy + sy * SECT.h, w: SECT.w - GAP, h: SECT.h - GAP });

function drawWall(now) {
  const f = S.focus, sel = S.sel, selI = S.selInst;
  if (S.layout === 'atlas' && !S.morph) { drawAtlasTiles(now); return; }
  const unit = view.s * U, v = visibleSectors(), morphing = !!S.morph;
  const reveal = S.mode === 'BOOT' || (boot.revealT0 && now - boot.revealT0 < 6000);
  if (unit < 14 && !morphing) {
    VIS = [];
    const lvl = unit * DPR > 13 ? 24 : unit * DPR > 6.5 ? 12 : 6;
    ctx.globalAlpha = f > 0 ? 1 - f * .85 : 1;
    const m = megaBitmap(v, lvl);
    if (m) { const r = toScreen({ x: SECT.ox + m.sx0 * SECT.w, y: SECT.oy + m.sy0 * SECT.h, w: m.ns * SECT.w, h: m.nt * SECT.h }); ctx.drawImage(m.c, r.x, r.y, r.w, r.h); }
    ctx.globalAlpha = 1;
    for (let sy = v.sy0; sy <= v.sy1; sy++) for (let sx = v.sx0; sx <= v.sx1; sx++) {
      const r = sectorScreen(sx, sy), o = !sx && !sy;
      ctx.strokeStyle = o ? `rgba(${C.admin},.55)` : 'rgba(220,238,230,.1)'; ctx.lineWidth = 1; ctx.strokeRect(r.x - 2.5, r.y - 2.5, r.w + 5, r.h + 5);
      if (r.w > 120) label(ctx, `${secName(sx, sy)}  ·  ${N} EYES`, r.x, r.y - 8, o ? `rgba(${C.admin},.95)` : 'rgba(129,144,152,.8)', 9.5, null);
    }
    if (sel && f > 0) { sel.fr = lerpRect({ ...toScreen(selI), c: coverCrop(sel, selI.w, selI.h) }, focusRect(sel), f); }
    return;
  }
  VIS = morphing ? collectVisible(v).concat(originRest(v)) : collectVisible(v);
  let hov = null;
  if (S.mode === 'EXPLORE' && !ptr.down && !morphing) hov = hitTile(ptr.x, ptr.y);
  if ((hov && hov.key) !== (S.hover && S.hover.key)) { S.hover = hov; if (hov) { hov.lock = now; blip(3200, .02, .012); } }
  else if (hov && S.hover) { S.hover.sr = hov.sr; }
  canvas.classList.toggle('point', !!hov && S.mode === 'EXPLORE');
  let selCx = 0, selCy = 0;
  if (selI) { const r = toScreen(selI); selCx = r.x + r.w / 2; selCy = r.y + r.h / 2; }
  const reach = Math.max(W, H), preferAtlas = unit * DPR < 64;
  let selDrawn = false;
  for (const it of VIS) {
    const p = it.p, wr = worldRectOf(it, now);
    if (!wr) { it.sr = null; continue; }
    let r = toScreen(wr), alpha = wr.fade != null ? wr.fade : 1;
    if (reveal) {
      if (!it.sx && !it.sy) { const s = SECT.slots[it.si], rt = boot.revealT0 ? now - boot.revealT0 - s.revDelay : -1; it.rev = clamp(rt / 380, 0, 1); alpha *= it.rev; }
      else alpha *= boot.revealT0 ? clamp((now - boot.revealT0 - 2400) / 1600, 0, 1) : 0;
    }
    if (hov && hov.key === it.key) { const k = 1.045; r = { ...r, x: r.x - r.w * (k - 1) / 2, y: r.y - r.h * (k - 1) / 2, w: r.w * k, h: r.h * k }; }
    if (f > 0 && sel) {
      if (selI && it.key === selI.key) { p.fr = lerpRect(r, focusRect(sel), f); it.sr = r; it.alpha = alpha; selDrawn = true; continue; }
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let dx = cx - selCx, dy = cy - selCy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const local = clamp(f * 1.25 - d / reach * .35, 0, 1);
      const push = eout(local) * (reach * .42 * Math.exp(-d / (reach * .9)) + 40), sc = 1 - .22 * local;
      r = { x: cx + dx * push - r.w * sc / 2, y: cy + dy * push - r.h * sc / 2, w: r.w * sc, h: r.h * sc, c: r.c };
      alpha *= 1 - .9 * local;
    }
    it.sr = r; it.alpha = alpha;
    if (r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0) continue;
    if (!preferAtlas) want(p, r.w, now);
    drawImgTile(p, r, alpha, preferAtlas);
    const dn = it.denied || deniedKeys.get(it.key); if (dn && performance.now() - dn < 700) { const k2 = 1 - (performance.now() - dn) / 700; ctx.fillStyle = `rgba(${C.threat},${.45 * k2})`; ctx.fillRect(r.x, r.y, r.w, r.h); }
    if (it.rev > 0 && it.rev < 1) { ctx.strokeStyle = `rgba(${C.scan},${(1 - it.rev) * .9})`; ctx.lineWidth = 1; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1); }
    if (!morphing && r.w > 22 && alpha > .5 && (p.visited || p.local)) {
      const l = Math.min(10, r.w * .14); ctx.fillStyle = `rgba(${C.admin},${.95 * alpha})`; ctx.fillRect(r.x, r.y, l, 2); ctx.fillRect(r.x, r.y, 2, l);
    }
  }
  if (sel && selI && f > 0 && !selDrawn) sel.fr = lerpRect({ ...toScreen(selI), c: coverCrop(sel, selI.w, selI.h) }, focusRect(sel), f);
  if (!morphing) drawOffline(now, v);
  if (!morphing && unit < 46 && S.layout === 'grid') {
    for (let sy = v.sy0; sy <= v.sy1; sy++) for (let sx = v.sx0; sx <= v.sx1; sx++) {
      const r = sectorScreen(sx, sy), o = !sx && !sy;
      label(ctx, secName(sx, sy), r.x, r.y - 8, o ? `rgba(${C.admin},${.9 * (1 - f)})` : `rgba(129,144,152,${.8 * (1 - f)})`, 9.5, null);
    }
  }
}
let mega = null; const deniedKeys = new Map();
function megaBitmap(v, lvl) {
  // render a window 1 sector larger than the view so panning reuses it; rebuild incrementally from cached sector bitmaps
  const need = { sx0: v.sx0, sy0: v.sy0, sx1: v.sx1, sy1: v.sy1 };
  if (mega && mega.lvl === lvl && need.sx0 >= mega.sx0 && need.sy0 >= mega.sy0 && need.sx1 < mega.sx0 + mega.ns && need.sy1 < mega.sy0 + mega.nt && mega.ver === sectorVer) return mega;
  if (!atlasReady) return mega;
  const sx0 = need.sx0 - 1, sy0 = need.sy0 - 1, ns = need.sx1 - need.sx0 + 3, nt = need.sy1 - need.sy0 + 3;
  const k = lvl / U, sw = Math.ceil(SECT.w * k), sh = Math.ceil(SECT.h * k);
  let c = mega && mega.c.width === sw * ns && mega.c.height === sh * nt ? mega.c : document.createElement('canvas');
  if (c.width !== sw * ns || c.height !== sh * nt) { c.width = sw * ns; c.height = sh * nt; }
  if (c.width > 8192 || c.height > 8192) return mega;
  const g = c.getContext('2d'); g.fillStyle = C.bg; g.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) { const b = sectorBitmap(sx0 + i, sy0 + j, lvl); if (b) g.drawImage(b, i * sw, j * sh); }
  mega = { c, sx0, sy0, ns, nt, lvl, ver: sectorVer };
  return mega;
}
function originRest(v) {
  const out = [], seen = new Set();
  if (v.sx0 <= 0 && v.sx1 >= 0 && v.sy0 <= 0 && v.sy1 >= 0) { /* some already visible */ }
  for (let si = 0; si < SECT.slots.length; si++) {
    const it = instAt(si, 0, 0);
    if (it.x > v.x1 || it.y > v.y1 || it.x + it.w < v.x0 || it.y + it.h < v.y0) out.push(it);
  }
  return out;
}
function drawOffline(now, v) {
  let a = 1 - S.focus;
  if (boot.revealT0 && now - boot.revealT0 < 3000) a *= clamp((now - boot.revealT0 - 1800) / 1000, 0, 1);
  if (S.mode === 'BOOT' && !boot.revealT0) return;
  const w = U * view.s; if (w < 14 || a <= .01) return;
  for (let sy = v.sy0; sy <= v.sy1; sy++) for (let sx = v.sx0; sx <= v.sx1; sx++) {
    const d = sectorDeal(sx, sy);
    for (const o of SECT.offline) {
      if (Submit.restored(o, sx, sy)) continue;
      let ox = o.x; if (d.mirror) ox = SECT.w - GAP - o.x - U;
      const r = toScreen({ x: SECT.ox + sx * SECT.w + ox, y: SECT.oy + sy * SECT.h + o.y, w: U, h: U });
      if (r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0) continue;
      ctx.strokeStyle = `rgba(220,238,230,${.1 * a})`; ctx.lineWidth = 1; ctx.strokeRect(r.x + .5, r.y + .5, w - 1, w - 1);
      ctx.beginPath(); ctx.moveTo(r.x + w * .3, r.y + w * .7); ctx.lineTo(r.x + w * .7, r.y + w * .3); ctx.stroke();
      if (w > 60) { ctx.font = `${Math.min(10, w / 10)}px ${MONO}`; ctx.fillStyle = `rgba(${C.anom},${.75 * a * (.6 + .4 * Math.sin(now / 700 + o.x))})`; ctx.fillText('NO SIGNAL', r.x + 7, r.y + w - 9); }
    }
  }
  Submit.drawRestored(now, v, a);
}
function drawHover(it, now) {
  const r = it.sr; if (!r || r.w < 34) return;
  const t = clamp((now - (it.lock || now)) / 200, 0, 1), e = eout(t), p = it.p;
  ctx.strokeStyle = `rgba(226,232,231,${.55 * e})`; ctx.lineWidth = 1; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
  if (r.w > 70) label(ctx, instCode(it), r.x + 6, r.y + 15, `rgba(226,232,231,${e})`, 9.5);
  if (p.cam && r.w > 54) {
    ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    p.cams.forEach((cam, k) => {
      const b = projBox(r, cam.bbox), kk = 1 + (1 - e) * .6, cx = b.x + b.w / 2, cy = b.y + b.h / 2, bw = Math.max(b.w * kk, 14), bh = Math.max(b.h * kk, 14);
      bracket(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 7, `rgba(${k ? C.white : C.admin},${(k ? .55 : .9) * e})`);
    });
    ctx.restore();
  }
}
function drawPulses(now) {
  if (S.mode !== 'EXPLORE' || S.focus > .3 || S.layout !== 'grid') return;
  if (now > nextPulse && pulses.length < 5) {
    nextPulse = now + 220 + rnd() * 480;
    const vis = VIS.filter(it => it.p.cam && it.sr && it.alpha > .9 && it.sr.w > 26 && it.sr.x > 0 && it.sr.y > 0 && it.sr.x + it.sr.w < W && it.sr.y + it.sr.h < H && inCrop(it.sr, it.p.anchor[0], it.p.anchor[1]));
    if (vis.length) pulses.push({ key: vis[Math.floor(rnd() * vis.length)].key, t0: now, dur: 650 + rnd() * 300 });
  }
  for (let i = pulses.length - 1; i >= 0; i--) {
    const q = pulses[i], t = (now - q.t0) / q.dur, it = VIS.find(v => v.key === q.key);
    if (t >= 1 || !it || !it.sr) { pulses.splice(i, 1); continue; }
    const r = it.sr, [x, y] = proj(r, it.p.anchor[0], it.p.anchor[1]);
    lensRing(ctx, x, y, clamp(r.w * .05, 2.5, 12) * (1 + t * .8), (.2 + .35 * Math.sin(t * Math.PI)) * (1 - t * .3));
  }
}
function drawAttention(now) {
  const idle = S.mode === 'EXPLORE' && S.focus < .05 && now - S.lastInput > 7000 && !REDUCE && S.layout === 'grid' && !S.hunt && view.s * U > 14;
  attn.on = lerp(attn.on, idle ? 1 : 0, idle ? .04 : .2);
  if (attn.on < .02) { attn.target = null; attn.box = null; return; }
  const ok = it => it && it.sr && it.sr.w > 30 && it.sr.x > 40 && it.sr.y > 60 && it.sr.x + it.sr.w < W - 40 && it.sr.y + it.sr.h < H - 60;
  let it = attn.target && VIS.find(v => v.key === attn.target);
  if (idle && (!it || now > attn.next || !ok(it))) {
    const vis = VIS.filter(q => q.p.cam && ok(q) && inCrop(q.sr, q.p.anchor[0], q.p.anchor[1]));
    if (vis.length) {
      const linked = it ? vis.filter(q => it.p.links.includes(q.p.id)) : [];
      const pool = linked.length && rnd() < .7 ? linked : vis;
      it = pool[Math.floor(rnd() * pool.length)]; attn.target = it.key;
      attn.t0 = now; attn.next = now + 2600 + rnd() * 1200; blip(1200, .05, .02);
    }
  }
  if (!it || !it.sr) return;
  const p = it.p, b = projBox(it.sr, p.cam.bbox);
  const tb = { x: b.x - 8, y: b.y - 8, w: Math.max(b.w + 16, 22), h: Math.max(b.h + 16, 22), c: [0, 0, 1, 1] };
  attn.box = attn.box ? lerpRect({ ...attn.box, c: [0, 0, 1, 1] }, tb, .12) : tb;
  const B = attn.box, a = attn.on;
  poiBox(ctx, B.x, B.y, B.w, B.h, C.white, .9 * a, clamp((now - attn.t0) / 600, 0, 1) > .4 ? `${p.code} · OBSERVED` : null, true);
  const [lx, ly] = proj(it.sr, p.anchor[0], p.anchor[1]);
  ctx.setLineDash([2, 4]); ctx.lineDashOffset = -now / 40;
  p.links.forEach((id, k) => {
    const q = VIS.find(v => v.p.id === id && v.sr && v.sr.x > -50 && v.sr.x < W + 50); if (!q) return;
    const [qx, qy] = proj(q.sr, q.p.anchor[0], q.p.anchor[1]);
    const tt = clamp((now - attn.t0 - 400 - k * 180) / 700, 0, 1); if (tt <= 0) return;
    ctx.strokeStyle = `rgba(${C.admin},${.5 * a})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lerp(lx, qx, eout(tt)), lerp(ly, qy, eout(tt))); ctx.stroke();
    if (tt >= 1) ctx.strokeRect(qx - 3.5, qy - 3.5, 7, 7);
  });
  ctx.setLineDash([]);
}
function drawTrace(now) {
  if (!S.traceShow || S.trace.length < 2 || S.mode === 'BOOT') return;
  const atlas = S.layout === 'atlas' && !S.morph;
  const fade = (1 - S.focus) * (S.morph ? 0 : 1); if (fade <= .01) return;
  const pts = [], rects = [];
  for (const t of S.trace) {
    const it = t.inst; if (!it) continue;
    let r;
    if (atlas) r = toScreen(it.p.atlas);
    else { const v = VIS.find(q => q.key === it.key); r = v && v.sr ? v.sr : toScreen({ ...it, c: coverCrop(it.p, it.w, it.h) }); }
    if (!r.c) r.c = atlas ? it.p.atlas.c : coverCrop(it.p, it.w, it.h);
    pts.push(proj(r, it.p.anchor[0], it.p.anchor[1])); rects.push(r);
  }
  if (pts.length < 2) return;
  const grow = S.traceDraw ? clamp((now - S.traceDraw) / 1400, 0, 1) : 1, total = (pts.length - 1) * eio(grow);
  ctx.strokeStyle = `rgba(${C.admin},${.25 * fade})`; ctx.lineWidth = 5; tracePath(pts, total, atlas);
  ctx.strokeStyle = `rgba(${C.admin},${.9 * fade})`; ctx.lineWidth = 1.4; tracePath(pts, total, atlas);
  for (let i = 0; i < pts.length; i++) {
    if (i > total + .001) break;
    const [x, y] = pts[i], r = rects[i];
    if (r && r.w > 20) bracket(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, 8, `rgba(${C.admin},${.75 * fade})`);
    ctx.fillStyle = `rgba(${C.admin},${fade})`; ctx.fillRect(x - 3, y - 3, 6, 6);
    label(ctx, pad(i + 1), x + 7, y - 6, `rgba(${C.admin},${fade})`, 10);
  }
}
function tracePath(pts, total, curved) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const k = clamp(total - (i - 1), 0, 1); if (k <= 0) break;
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (curved) { const d = Math.hypot(x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - d * .3; const seg = 16; for (let j = 1; j <= seg * k; j++) { const u = j / seg, iu = 1 - u; ctx.lineTo(iu * iu * x0 + 2 * iu * u * mx + u * u * x1, iu * iu * y0 + 2 * iu * u * my + u * u * y1); } }
    else ctx.lineTo(lerp(x0, x1, k), lerp(y0, y1, k));
  }
  ctx.stroke();
}

/* ---------- ATLAS tiles + world map ---------- */
function drawAtlasTiles(now) {
  const f = S.focus, sel = S.sel;
  VIS = [];
  const base = sectorDeal(0, 0);
  const all = SECT.slots.map((s, si) => ({ p: P[base[si]], si, sx: 0, sy: 0, key: si + ':0:0', ...instAt(si, 0, 0) })).concat(Submit.instances());
  let hov = null;
  for (const it of all) {
    const r = toScreen(it.p.atlas); it.sr = r; it.alpha = 1 - .88 * f;
    if (r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0) continue;
    VIS.push(it);
  }
  if (S.mode === 'EXPLORE' && !ptr.down) hov = hitTile(ptr.x, ptr.y);
  if ((hov && hov.key) !== (S.hover && S.hover.key)) { S.hover = hov; if (hov) blip(3200, .02, .012); }
  canvas.classList.toggle('point', !!hov && S.mode === 'EXPLORE');
  const preferAtlas = view.s * 18 * DPR < 64;
  for (const it of VIS) {
    if (sel && it.p === sel && f > 0) continue;
    if (!preferAtlas) want(it.p, it.sr.w, now);
    drawImgTile(it.p, it.sr, it.alpha, preferAtlas);
    if (it.p.visited && it.sr.w > 8) { ctx.fillStyle = `rgba(${C.admin},${it.alpha})`; ctx.fillRect(it.sr.x, it.sr.y, Math.max(3, it.sr.w * .3), 1.5); }
  }
  if (sel && f > 0) sel.fr = lerpRect({ ...toScreen(sel.atlas), c: sel.atlas.c }, focusRect(sel), f);
  if (hov && hov.sr && S.mode === 'EXPLORE') {
    const r = hov.sr, p = hov.p;
    poiBox(ctx, r.x - 4, r.y - 4, r.w + 8, r.h + 8, C.admin, .95, `${p.code}${p.place ? ' · ' + p.place.toUpperCase() : ''}`);
    const pw = 200, ph = Math.min(150, pw / p.a), px = r.x + r.w + 16 + pw > W ? r.x - pw - 16 : r.x + r.w + 16, py = clamp(r.y - ph / 2, 20, H - ph - 40);
    const pr = { x: px, y: py, w: pw, h: ph, c: coverCrop(p, pw, ph) };
    request(p, 'thumb');
    ctx.fillStyle = 'rgba(8,11,13,.9)'; ctx.fillRect(pr.x - 5, pr.y - 5, pr.w + 10, pr.h + 30);
    drawImgTile(p, pr, 1, false);
    if (p.cam) { const b = projBox(pr, p.cam.bbox); bracket(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 6, `rgba(${C.admin},.9)`); }
    label(ctx, p.lat != null ? fmtGeo(p) : 'LOCATION UNVERIFIED', pr.x, pr.y + pr.h + 15, `rgba(${C.white},.85)`, 9, null);
  }
}
let worldCache = null;
function worldAlpha(now) {
  let a = S.layout === 'atlas' ? 1 : 0;
  if (S.morph) { const t = clamp((now - S.morph.t0) / (S.morph.dur + 500), 0, 1); a = S.morph.to === 'atlas' ? eio(t) : 1 - eio(clamp((now - S.morph.t0) / 600, 0, 1)); }
  return a;
}
function drawWorld(now) {
  const a = worldAlpha(now) * (1 - S.focus * .8); if (a <= .01) return;
  const key = Math.round(Math.log2(view.s) * 3);
  if (!worldCache || worldCache.key !== key) {
    const s = Math.pow(2, key / 3), pd = 60, x0 = -180 * GX - pd, y0 = -WORLD.lat0 * GY - pd, wW = 360 * GX + pd * 2, wH = WORLD.h * GY + pd * 2;
    const sc = Math.min(s * DPR, 8000 / wW, 4000 / wH), cw = Math.ceil(wW * sc), chh = Math.ceil(wH * sc);
    const c = document.createElement('canvas'); c.width = cw; c.height = chh; const g = c.getContext('2d');
    g.strokeStyle = 'rgba(220,238,230,.06)'; g.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 15) { const x = (lon * GX - x0) * sc; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, chh); g.stroke(); }
    for (let lat = -60; lat <= 75; lat += 15) { const y = (-lat * GY - y0) * sc; g.beginPath(); g.moveTo(0, y); g.lineTo(cw, y); g.stroke(); }
    // dot size: ~1.6 screen px at fit zoom, never a blob when zoomed in
    const cellPx = Math.min(GX, GY) * sc;
    const r = clamp(cellPx * .3, .7 * DPR, 1.6 * DPR);
    g.fillStyle = 'rgba(129,144,152,.45)';
    for (const [x, y] of L.atlas.dots) g.fillRect((x - x0) * sc - r, (y - y0) * sc - r, r * 2, r * 2);
    worldCache = { key, c, x0, y0, wW, wH };
  }
  const r = toScreen({ x: worldCache.x0, y: worldCache.y0, w: worldCache.wW, h: worldCache.wH });
  ctx.globalAlpha = a; ctx.drawImage(worldCache.c, r.x, r.y, r.w, r.h); ctx.globalAlpha = 1;
  // the machine sweeps the planet
  const lon = ((now / 55) % 360) - 180, sx = toScreen({ x: lon * GX, y: 0, w: 0, h: 0 }).x;
  const gr = ctx.createLinearGradient(sx - 160, 0, sx, 0); gr.addColorStop(0, 'rgba(149,216,183,0)'); gr.addColorStop(1, `rgba(149,216,183,${.07 * a})`);
  ctx.fillStyle = gr; ctx.fillRect(sx - 160, 0, 160, H); ctx.fillStyle = `rgba(149,216,183,${.3 * a})`; ctx.fillRect(sx, 0, 1, H);
  // equator / meridian ticks
  const eq = toScreen({ x: 0, y: 0, w: 0, h: 0 });
  ctx.font = `9px ${MONO}`; ctx.fillStyle = `rgba(129,144,152,${.6 * a})`;
  for (let lo = -150; lo <= 180; lo += 30) { const p = toScreen({ x: lo * GX, y: 0, w: 0, h: 0 }); if (p.x > 0 && p.x < W) ctx.fillText(`${Math.abs(lo)}°${lo < 0 ? 'W' : lo > 0 ? 'E' : ''}`, p.x + 3, H - 60); }
  ctx.fillRect(0, eq.y, W, .5);
}
function drawAtlasLayer(now) {
  let a = S.layout === 'atlas' ? 1 : 0;
  if (S.morph) { const t = clamp((now - S.morph.t0 - 500) / (S.morph.dur + 300), 0, 1); a = S.morph.to === 'atlas' ? t : 1 - clamp((now - S.morph.t0) / 300, 0, 1); }
  a *= 1 - S.focus; if (a <= .01) return;
  const t = now / 1000;
  ctx.lineWidth = 1;
  // network arcs (visual-similarity links that cross distance), with packets travelling along
  let drawn = 0;
  for (const p of P) {
    if (!p.atlas) continue;
    const q = byId.get(p.links[0]); if (!q || !q.atlas) continue;
    const r0 = toScreen(p.atlas), r1 = toScreen(q.atlas);
    const x0 = r0.x + r0.w / 2, y0 = r0.y + r0.h / 2, x1 = r1.x + r1.w / 2, y1 = r1.y + r1.h / 2;
    const d = Math.hypot(x1 - x0, y1 - y0); if (d < 40) continue;
    if (Math.max(x0, x1) < -50 || Math.min(x0, x1) > W + 50) continue;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - d * .3;
    ctx.strokeStyle = `rgba(${C.admin},${.1 * a})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
    const u = (t * .22 + p.i * .1373) % 1, iu = 1 - u;
    ctx.fillStyle = `rgba(${C.admin},${.9 * a})`;
    ctx.fillRect(iu * iu * x0 + 2 * iu * u * mx + u * u * x1 - 1, iu * iu * y0 + 2 * iu * u * my + u * u * y1 - 1, 2, 2);
    if (++drawn > 420) break;
  }
  // hubs
  ctx.font = `9.5px ${MONO}`;
  const hubs = L.atlas.hubs, maxH = view.s > fitScale('atlas') * 2.5 ? 60 : 18;
  for (let i = 0; i < Math.min(maxH, hubs.length); i++) {
    const h = hubs[i], r = toScreen({ x: h.x, y: h.y, w: 0, h: 0 });
    if (r.x < -120 || r.x > W + 40 || r.y < -30 || r.y > H + 30) continue;
    const ox = 22, oy = -22 - (i % 3) * 6;
    ctx.strokeStyle = `rgba(${C.white},${.45 * a})`; ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + ox - 6, r.y + oy + 4); ctx.lineTo(r.x + ox, r.y + oy + 4); ctx.stroke();
    ctx.fillStyle = `rgba(${C.white},${.9 * a})`; ctx.fillText(h.name.toUpperCase(), r.x + ox + 4, r.y + oy);
    ctx.fillStyle = `rgba(${C.admin},${.9 * a})`; ctx.fillText(`${pad(h.n, 3)} EYES`, r.x + ox + 4, r.y + oy + 11);
  }
}
let feedTimer = null;
function feedStart() {
  clearInterval(feedTimer); const el = $('#feed');
  const tick = () => {
    if (S.layout !== 'atlas') { clearInterval(feedTimer); return; }
    const p = P[Math.floor(rnd() * N)], d = document.createElement('div'), ts = new Date();
    const hh = pad(ts.getHours()) + ':' + pad(ts.getMinutes()) + ':' + pad(ts.getSeconds()) + '.' + pad(Math.floor(ts.getMilliseconds() / 10));
    const st = p.visited ? '<i>KNOWN</i>' : rnd() < .06 ? '<i>RELEVANT</i>' : rnd() < .5 ? 'NOMINAL' : 'IRRELEVANT';
    d.innerHTML = `${hh} · <b>${p.code}</b> · ${p.lat != null ? fmtGeo(p) : '—'} · ${st}`;
    el.prepend(d); while (el.children.length > 28) el.lastChild.remove();
  };
  el.innerHTML = ''; for (let i = 0; i < 14; i++) tick();
  feedTimer = setInterval(tick, 240);
}

/* ---------- FOCUS ---------- */
function drawFocused(p, now) {
  const r = p.fr; if (!r) return;
  want(p, r.w, now);
  ctx.fillStyle = `rgba(8,11,13,${.6 * S.focus})`; ctx.fillRect(r.x - 10, r.y - 10, r.w + 20, r.h + 20);
  drawImgTile(p, r, 1, false);
  if (S.focus < .85 || S.mode !== 'FOCUS') return;
  const a = clamp((S.focus - .85) / .15, 0, 1);
  // analysis sweep on arrival — the machine reads the frame
  const st = (now - (S.scanT || 0)) / 900;
  if (st > 0 && st < 1) {
    const y = r.y + r.h * eio(st);
    const g = ctx.createLinearGradient(0, y - 60, 0, y); g.addColorStop(0, 'rgba(149,216,183,0)'); g.addColorStop(1, 'rgba(149,216,183,.18)');
    ctx.fillStyle = g; ctx.fillRect(r.x, y - 60, r.w, 60); ctx.fillStyle = 'rgba(149,216,183,.7)'; ctx.fillRect(r.x, y, r.w, 1);
  }
  ctx.strokeStyle = `rgba(220,238,230,${.22 * a})`; ctx.lineWidth = 1; ctx.strokeRect(r.x - .5, r.y - .5, r.w + 1, r.h + 1);
  ctx.fillStyle = `rgba(220,238,230,${.25 * a})`;
  for (let i = 0; i <= 20; i++) ctx.fillRect(r.x + r.w * i / 20, r.y + r.h + 4, 1, i % 5 ? 3 : 7);
  for (let i = 0; i <= 14; i++) ctx.fillRect(r.x - (i % 5 ? 7 : 11), r.y + r.h * i / 14, i % 5 ? 3 : 7, 1);
  label(ctx, `ZOOM ${(r.w / p.w * 100).toFixed(1)}%  ·  T ${new Date().toISOString().slice(11, 22)}  ·  ${p.cams.length} EYE${p.cams.length === 1 ? '' : 'S'} DETECTED`, r.x, r.y + r.h + 24, `rgba(129,144,152,${.8 * a})`, 9, null);
  const inside = ptr.x > r.x && ptr.x < r.x + r.w && ptr.y > r.y && ptr.y < r.y + r.h;
  if (!p.cam) { canvas.classList.toggle('point', inside); canvas.classList.remove('lens'); return; }
  const hit = lensHit(p, ptr.x, ptr.y), over = hit >= 0;
  canvas.classList.toggle('lens', over); canvas.classList.toggle('point', !over && inside);
  if (hit !== S.hoverLens) { S.hoverLens = hit; if (over) blip(2400, .03, .02); }
  const nudge = S.nudge ? clamp(1 - (now - S.nudge) / 900, 0, 1) : 0;
  const since = S.focusAt ? now - S.focusAt : 1e4;
  const isTarget = S.hunt && S.hunt.target === p && S.hunt.mode === 'search';
  p.cams.forEach((cam, k) => {
    const b = projBox(r, cam.bbox), [lx, ly] = proj(r, cam.lens[0], cam.lens[1]);
    const lt = clamp((since - k * 160) / 520, 0, 1), le = eoutQ(lt); if (lt <= 0) return;
    const isOver = hit === k || S.relHover === k, prim = k === 0;
    const pad2 = isOver ? 4 : 10 + Math.sin(now / 520 + k) * 2;
    const tx = b.x - pad2, ty = b.y - pad2, tw = b.w + pad2 * 2, th = b.h + pad2 * 2;
    const heat = Hunt.heatOf(p, k);
    const rgb = isTarget ? C.threat : heat || (isOver ? C.admin : C.white);
    const al = (isOver ? .95 : prim ? .72 : .55) * a * (lt < 1 ? .4 + .6 * le : 1);
    if (lt < 1) { bracket(ctx, lerp(r.x, tx, le), lerp(r.y, ty, le), lerp(r.w, tw, le), lerp(r.h, th, le), 12, `rgba(${rgb},${al})`, 1.3); return; }
    const txt = isTarget ? `TARGET · ${p.code}${isOver ? ' · CONFIRM' : ''}` : (prim || isOver) ? `${prim ? p.code : p.code + '.' + (k + 1)}${isOver ? (S.hunt ? ' · ' + Hunt.heatWord(p, k) : ' · ENTER') : ''}` : null;
    poiBox(ctx, tx, ty, tw, th, rgb, al, txt, isTarget);
    const br = .5 + .5 * Math.sin(now / 450 + k * 1.7), rad = clamp(Math.min(b.w, b.h) * .22, 5, 30);
    lensRing(ctx, lx, ly, rad * (isOver ? .8 : 1 + br * .15), (isOver ? .95 : (prim ? .25 + .35 * br : .15 + .2 * br)) * a, isOver ? rgb : C.scan);
    if (isOver || (prim && nudge > 0)) {
      const btn = $('#related').children[k + 1];
      if (btn && isOver && W >= 700) {
        const br2 = btn.getBoundingClientRect();
        ctx.setLineDash([2, 4]); ctx.lineDashOffset = -now / 30;
        ctx.strokeStyle = `rgba(${rgb},.6)`; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(br2.left - 10, br2.top + br2.height / 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeRect(br2.left - .5, br2.top - .5, br2.width + 1, br2.height + 1);
      }
      const kk = isOver ? 1 : nudge;
      ctx.strokeStyle = `rgba(${C.admin},${.5 * kk})`; ctx.beginPath(); ctx.arc(lx, ly, rad * (1.8 + (1 - kk) * 3), 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx - rad * 2.6, ly); ctx.lineTo(lx - rad * 1.3, ly); ctx.moveTo(lx + rad * 1.3, ly); ctx.lineTo(lx + rad * 2.6, ly);
      ctx.moveTo(lx, ly - rad * 2.6); ctx.lineTo(lx, ly - rad * 1.3); ctx.moveTo(lx, ly + rad * 1.3); ctx.lineTo(lx, ly + rad * 2.6); ctx.stroke();
    }
  });
}

/* ---------- PORTAL: through the eye; between lenses, the machine flicks through feeds ---------- */
function drawPortal(now) {
  const pt = S.portal, T = window.__PT != null ? window.__PT : clamp((now - pt.t0) / pt.dur, 0, 1);
  const A = .46, Bd = .12, Z = 22, diag = Math.hypot(W, H), cx = W / 2, cy = H / 2;
  if (REDUCE) {
    const a = T < .5 ? 1 - T * 2 : (T - .5) * 2, p = T < .5 ? pt.from : pt.to;
    drawImgTile(p, focusRect(p), a, false); if (T >= .5 && !pt.swapped) swapPortal(); if (T >= 1) finishPortal(); return;
  }
  if (T < A) {
    const t = T / A, z = Math.exp(Math.log(Z) * ein(t)), p = pt.from, R = focusRect(p);
    const [lx, ly] = proj(R, pt.fromAnchor[0], pt.fromAnchor[1]);
    const px = lerp(lx, cx, eio(t)), py = lerp(ly, cy, eio(t));
    const rr = { x: px + (R.x - lx) * z, y: py + (R.y - ly) * z, w: R.w * z, h: R.h * z, c: R.c };
    irisDraw(p, rr, px, py, lerp(diag * .75, 0, Math.pow(t, 1.6)), 1 - t * .25, t);
    rings(px, py, t, 1);
    if (t > .1 && t < .26) glitch();
    if (t > .55) portalText(pt, (t - .55) / .45);
  } else if (T < A + Bd) {
    const t = (T - A) / Bd;
    if (!pt.swapped) swapPortal();
    // inside the network: other feeds flicker past in the pupil
    const k = Math.min(pt.feeds.length - 1, Math.floor(t * pt.feeds.length)), q = pt.feeds[k];
    const rad = 26 + 20 * Math.sin(t * Math.PI);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
    drawImgTile(q, { x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2, c: coverCrop(q, 1, 1) }, .85, true); ctx.restore();
    fx.strokeStyle = `rgba(${C.admin},${.8 * Math.sin(t * Math.PI)})`; fx.lineWidth = 1; fx.beginPath(); fx.arc(cx, cy, rad + 3, 0, Math.PI * 2); fx.stroke();
    rings(cx, cy, 1, 1 - t); portalText(pt, 1);
  } else {
    const t = (T - A - Bd) / (1 - A - Bd), e = eoutQ(t), p = pt.to, R = focusRect(p);
    const [lx, ly] = proj(R, p.anchor[0], p.anchor[1]);
    const z = Math.exp(Math.log(Z) * (1 - e)), px = lerp(cx, lx, eio(t)), py = lerp(cy, ly, eio(t));
    const rr = { x: px + (R.x - lx) * z, y: py + (R.y - ly) * z, w: R.w * z, h: R.h * z, c: R.c };
    irisDraw(p, rr, px, py, lerp(0, diag, Math.pow(e, 1.2)), .75 + .25 * e, 1 - t);
    rings(px, py, 1 - t, 1 - t);
    if (t < .4) portalText(pt, 1 - t / .4);
    if (T >= 1) finishPortal();
  }
}
function glitch() {
  try {
    for (let i = 0; i < 5; i++) {
      const y = rnd() * H, h = 2 + rnd() * 16, dx = (rnd() - .5) * 46;
      fx.globalAlpha = .7; fx.drawImage(canvas, 0, y * DPR, W * DPR, h * DPR, dx, y, W, h);
    }
  } catch (e) { }
  fx.globalAlpha = 1; fx.fillStyle = 'rgba(232,197,71,.08)'; fx.fillRect(0, rnd() * H, W, 1);
}
function irisDraw(p, r, x, y, rad, bright, t) {
  if (rad < .5) return;
  want(p, Math.min(r.w, 3000), performance.now());
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.clip();
  drawImgTile(p, r, bright, false);
  const g = ctx.createRadialGradient(x, y, rad * .45, x, y, rad);
  g.addColorStop(0, 'rgba(8,11,13,0)'); g.addColorStop(1, 'rgba(8,11,13,.92)');
  ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  ctx.restore();
  if (rad < Math.hypot(W, H) * .62) {
    // six aperture blades rotating shut
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(x, y, rad, 0, Math.PI * 2, true); ctx.clip();
    for (let k = 0; k < 6; k++) {
      const a0 = k / 6 * Math.PI * 2 + t * 1.4;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a0) * rad, y + Math.sin(a0) * rad);
      ctx.lineTo(x + Math.cos(a0 + .35) * rad * 4, y + Math.sin(a0 + .35) * rad * 4);
      ctx.lineTo(x + Math.cos(a0 + 1.2) * rad * 4, y + Math.sin(a0 + 1.2) * rad * 4);
      ctx.lineTo(x + Math.cos(a0 + 1.05) * rad, y + Math.sin(a0 + 1.05) * rad); ctx.closePath();
      ctx.fillStyle = k % 2 ? 'rgba(14,18,21,.97)' : 'rgba(10,13,15,.97)'; ctx.fill();
      ctx.strokeStyle = 'rgba(220,238,230,.07)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = `rgba(${C.admin},.5)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
  }
}
function rings(x, y, t, a) {
  if (a <= 0) return;
  for (let k = 0; k < 6; k++) {
    const ph = (t * 2.2 + k / 6) % 1, rad = 6 + Math.pow(ph, 2.2) * Math.hypot(W, H) * .6;
    fx.strokeStyle = `rgba(220,238,230,${.13 * a * (1 - ph)})`; fx.lineWidth = 1; fx.beginPath(); fx.arc(x, y, rad, 0, Math.PI * 2); fx.stroke();
  }
}
function portalText(pt, a) {
  fx.font = `10px ${MONO}`; fx.textAlign = 'center';
  fx.fillStyle = `rgba(${C.admin},${a * .95})`; fx.fillText(`${pt.from.code}  →  ${pt.to.code}`, W / 2, H / 2 + 56);
  fx.fillStyle = `rgba(129,144,152,${a * .85})`; fx.fillText(pt.to.cam ? 'ROUTING THROUGH LENS' : 'ROUTING · FULL FRAME', W / 2, H / 2 + 72);
  const geo = (pt.to.place ? pt.to.place.toUpperCase() + '  ·  ' : '') + (pt.to.lat != null ? fmtGeo(pt.to) : '');
  if (geo) fx.fillText(geo, W / 2, H / 2 + 88);
  if (pt.from.lat != null && pt.to.lat != null) { const km = haversine(pt.from, pt.to); if (km > 1) { fx.fillStyle = `rgba(${C.white},${a * .7})`; fx.fillText(`${km.toLocaleString('en-US', { maximumFractionDigits: 0 })} KM IN ${(pt.dur / 1000).toFixed(2)} S`, W / 2, H / 2 + 104); } }
  fx.textAlign = 'left';
}
function haversine(a, b) { const R = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function swapPortal() {
  const pt = S.portal; pt.swapped = true;
  const q = pt.to;
  const it = q.observer ? { p: q, si: -999, sx: 0, sy: 0, key: 'obs', x: view.x - U / 2, y: view.y - U / 2, w: U, h: U } : q.local ? Submit.instOf(q) : instOfPhotoNear(q, view.x, view.y);
  view.anim = null; view.vx = view.vy = 0; view.zt = null;
  if (S.layout === 'grid') { view.x = it.x + it.w / 2; view.y = it.y + it.h / 2; view.s = Math.max(view.s, fitScale('grid') * 2.2); }
  else { view.x = q.atlas.x + q.atlas.w / 2; view.y = q.atlas.y + q.atlas.h / 2; view.s = Math.max(view.s, fitScale('atlas') * 2); }
  S.sel = q; S.selInst = it; S.focus = 1; S.focusAnim = null;
  pushTrace(it, 'portal'); fillMeta(q, it);
  S.travel = (S.travel || 0) + (pt.from.lat != null && q.lat != null ? haversine(pt.from, q) : 0);
  if (!S.observer) { S.observer = true; setTimeout(() => $('#observer').classList.add('on'), 900); }
  q.links.map(id => byId.get(id)).filter(Boolean).slice(0, 3).forEach(n => request(n, 'preview'));
}
function finishPortal() {
  setMode('FOCUS'); S.portal = null; S.nudge = 0; S.focusAt = performance.now() - 200; S.scanT = performance.now();
  if (S.trace.length === 3 && !S.hunt) hint('ESC  ·  SEE YOUR PATH THROUGH THE MACHINE', 4200, 'trace');
  Hunt.onFocus(S.selInst);
}

/* ---------- reticle + HUD ---------- */
function drawReticle(now) {
  if (COARSE || ptr.x < 0 || S.mode === 'BOOT') return;
  const x = ptr.x, y = ptr.y, a = S.mode === 'EXPLORE' ? .6 : .35, rgb = S.hunt ? C.threat : C.white;
  fx.strokeStyle = `rgba(${rgb},${a})`; fx.lineWidth = 1; fx.beginPath();
  fx.moveTo(x - 14, y); fx.lineTo(x - 6, y); fx.moveTo(x + 6, y); fx.lineTo(x + 14, y); fx.moveTo(x, y - 14); fx.lineTo(x, y - 6); fx.moveTo(x, y + 6); fx.lineTo(x, y + 14); fx.stroke();
  if (S.mode === 'EXPLORE' && !ptr.down) {
    fx.font = `8.5px ${MONO}`; fx.fillStyle = `rgba(129,144,152,${a * 1.3})`;
    if (S.layout === 'grid') { const [wx, wy] = toWorld(x, y); fx.fillText(`${(wx / PITCH).toFixed(1)} · ${(wy / PITCH).toFixed(1)}`, x + 10, y + 20); }
    else { const [wx, wy] = toWorld(x, y); const lon = wx / GX, lat = -wy / GY; if (Math.abs(lat) < 85 && Math.abs(lon) < 180) fx.fillText(`${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`, x + 10, y + 20); }
  }
}
let hudLast = 0;
function hudTick(now) {
  if (now - hudLast < 120) return; hudLast = now;
  const d = new Date();
  $('#clock').textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (S.layout === 'grid') {
    const sx = Math.floor((view.x - SECT.ox) / SECT.w), sy = Math.floor((view.y - SECT.oy) / SECT.h);
    const sects = (2 * Math.max(Math.abs(sx), Math.abs(sy)) + 1);
    $('#coord').textContent = `${secName(sx, sy)}  ·  ZOOM ${(view.s / fitScale('grid')).toFixed(2)}×  ·  ${(view.s * U < 14 ? '∞' : '')}`;
  } else $('#coord').textContent = `ANALOG INTERFACE  ·  ${N} EYES  ·  ${L.atlas.hubs.length} CITIES`;
}

/* =====================================================================
 *  THE SEARCH — the machine gives you a number. Find the eye.
 *  SEARCH: locate the target camera in the infinite wall (warmer/colder + edge compass).
 *  DIVE:   reach the target only by travelling through lenses (each lens shows heat).
 *  Daily case (seeded by date) → same targets for everyone → comparable times. Local leaderboard.
 * ===================================================================== */
const Hunt = (() => {
  const RANKS = [[0, 'ADMIN'], [75, 'PRIMARY ASSET'], [140, 'ANALOG INTERFACE'], [240, 'ASSET'], [1e9, 'IRRELEVANT']];
  const today = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
  const caseNo = () => { const d = new Date(), s = new Date(d.getFullYear(), 0, 0); return Math.floor((d - s) / 864e5); };
  let H_ = null;
  const el = id => $(id);
  const handle = () => { try { return localStorage.getItem('tm_handle') || ''; } catch (e) { return ''; } };
  const board = key => { try { return JSON.parse(localStorage.getItem('tm_board_' + key) || '[]'); } catch (e) { return []; } };
  const saveBoard = (key, b) => { try { localStorage.setItem('tm_board_' + key, JSON.stringify(b.slice(0, 20))); } catch (e) { } };

  // graph distance (BFS over links) for DIVE heat; computed lazily from target
  function distFrom(target) {
    const rev = new Map(); P.forEach(p => p.links.forEach(id => { const q = byId.get(id); if (q) (rev.get(q) || rev.set(q, []).get(q)).push(p); }));
    const dist = new Map([[target, 0]]), qu = [target];
    while (qu.length) { const x = qu.shift(), d = dist.get(x); for (const y of (rev.get(x) || [])) if (!dist.has(y)) { dist.set(y, d + 1); qu.push(y); } }
    return dist;
  }
  function pickTargets(mode, daily) {
    const rng = mulberry(daily ? +today() * 31 + (mode === 'dive' ? 7 : 0) : (Date.now() & 0xffffff));
    const pool = P.filter(p => p.cam && !p.local && p.cam.bbox[2] * p.cam.bbox[3] > .006 && p.cam.bbox[2] * p.cam.bbox[3] < .5);
    const out = [];
    while (out.length < 5) { const p = pool[Math.floor(rng() * pool.length)]; if (!out.includes(p)) out.push(p); }
    if (mode === 'dive') return out.map((t, i) => { let s; do s = pool[Math.floor(rng() * pool.length)]; while (s === t); return { start: s, target: t }; });
    return out.map(t => ({ target: t }));
  }
  function brief() {
    if (S.mode === 'BOOT' || S.mode === 'PORTAL') return;
    if (S.mode === 'FOCUS') unfocus();
    const h = handle(), bd = board('search_' + today()), bdd = board('dive_' + today());
    const best = (b) => b.length ? fmtT(b[0].t) + ' · ' + b[0].h : '—';
    openModal(`
      <button class="m-close" data-x>ESC</button>
      <div class="m-k">THE MACHINE · CASE ${pad(caseNo(), 4)} · ${today()}</div>
      <div class="m-t">THE SEARCH</div>
      <div class="m-p">机器给你一个号码。你的任务是在这面没有尽头的墙里找到它。</div>
      <div class="m-row" style="margin-top:6px">
        <div style="flex:1;min-width:220px">
          <div class="m-k" style="color:var(--threat)">MODE 01 · SEARCH</div>
          <div class="m-p" style="margin:4px 0">看目标特写，拖动/缩放墙面找到那台摄像头，点开照片，点镜头确认。边缘的箭头和信号条会告诉你冷热。5 个目标，比总用时。</div>
          <div class="m-p" style="margin:4px 0;color:var(--muted)">今日最佳 ${best(bd)}</div>
        </div>
        <div style="flex:1;min-width:220px">
          <div class="m-k" style="color:var(--threat)">MODE 02 · DIVE</div>
          <div class="m-p" style="margin:4px 0">只能穿越镜头。从起点出发，看每台摄像头的热度（越黄越近），用最少的跳数抵达目标。5 个案件。</div>
          <div class="m-p" style="margin:4px 0;color:var(--muted)">今日最佳 ${best(bdd)}</div>
        </div>
      </div>
      <div class="m-row"><span style="letter-spacing:.2em">OPERATOR</span><input class="m-in" id="mHandle" maxlength="12" placeholder="YOUR HANDLE" value="${h}"></div>
      <div class="m-check"><input type="checkbox" id="mDaily" checked> <label for="mDaily">每日案件（今天所有人的目标相同，可以比成绩）</label></div>
      <div class="m-row">
        <button class="m-btn primary" data-go="search">▶ SEARCH</button>
        <button class="m-btn primary" data-go="dive">▶ DIVE</button>
        <button class="m-btn" data-board>LEADERBOARD</button>
      </div>`);
    $('#mBox').querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
      const hh = ($('#mHandle').value || 'ANON').toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 12) || 'ANON';
      try { localStorage.setItem('tm_handle', hh); } catch (e) { }
      start(b.dataset.go, $('#mDaily').checked, hh);
    });
    $('#mBox').querySelector('[data-board]').onclick = () => showBoard();
  }
  function showBoard() {
    const rows = (k) => board(k).map((r, i) => `<tr class="${r.h === handle() ? 'me' : ''}"><td>${pad(i + 1)}</td><td>${r.h}</td><td>${r.rank}</td><td>${r.mode === 'dive' ? r.hops + ' HOPS · ' : ''}${fmtT(r.t)}</td></tr>`).join('') || '<tr><td>—</td><td>NO RECORDS YET</td><td></td><td></td></tr>';
    openModal(`<button class="m-close" data-x>ESC</button><div class="m-k">LEADERBOARD · THIS DEVICE · ${today()}</div>
      <div class="m-t">OPERATORS</div>
      <div class="m-k" style="margin-top:8px">SEARCH</div><table class="m-table">${rows('search_' + today())}</table>
      <div class="m-k" style="margin-top:18px">DIVE</div><table class="m-table">${rows('dive_' + today())}</table>
      <div class="m-p" style="color:var(--muted)">排行榜保存在本机浏览器。成绩卡可以下载分享；同一天的每日案件目标一致。</div>
      <div class="m-row"><button class="m-btn primary" data-back>BACK</button></div>`);
    $('#mBox').querySelector('[data-back]').onclick = brief;
  }
  function start(mode, daily, h) {
    closeModal();
    clearTimeout(hintTimer); $('#hint').classList.remove('on');
    if (S.layout !== 'grid') { S.layout = 'grid'; document.body.classList.remove('atlas'); $('#btnGrid').classList.add('on'); $('#btnAtlas').classList.remove('on'); $('#btnGrid').setAttribute('aria-selected', 'true'); $('#btnAtlas').setAttribute('aria-selected', 'false'); }
    H_ = S.hunt = { mode, daily, h, rounds: pickTargets(mode, daily), round: -1, total: 0, misses: 0, hops: 0, splits: [], t0: 0, started: performance.now() };
    document.body.classList.add('hunting');
    say(mode === 'search' ? 'YOU HAVE A NEW NUMBER' : 'FOLLOW THE SIGNAL', `CASE ${pad(caseNo(), 4)} · ${mode.toUpperCase()} · OPERATOR ${h}`);
    chord([440, 554, 659]);
    setTimeout(next, 1700);
  }
  function next() {
    if (!H_) return;
    H_.round++;
    if (H_.round >= H_.rounds.length) return finish();
    const R = H_.rounds[H_.round];
    H_.target = R.target; H_.t0 = performance.now(); H_.roundHops = 0; H_.roundMiss = 0;
    H_.dist = H_.mode === 'dive' ? distFrom(R.target) : null;
    request(R.target, 'preview'); request(R.target, 'thumb');
    el('#hCase').textContent = `CASE ${pad(caseNo(), 4)} · ${H_.mode.toUpperCase()}`;
    el('#hRound').textContent = `TARGET ${H_.round + 1}/${H_.rounds.length}`;
    el('#hId').textContent = R.target.code;
    el('#hMeta').textContent = R.target.place ? `LAST SEEN · ${R.target.place.toUpperCase()}` : `LAST SEEN · ${R.target.sceneEn || 'URBAN'}`;
    drawTargetThumb();
    if (H_.mode === 'search') {
      // place the target in a sector near (but not at) the operator: the wall is the haystack
      if (S.mode === 'FOCUS') { S.focus = 0; S.focusAnim = null; S.sel = null; S.selInst = null; setMode('EXPLORE'); }
      const rng = mulberry(+today() + H_.round * 97);
      const sx = Math.round((rng() - .5) * 2), sy = Math.round((rng() - .5) * 2);
      H_.inst = instAt(sectorDeal(sx, sy).index.get(R.target.i), sx, sy);
      animView({ x: 0 + (sx * SECT.w * .3), y: (sy * SECT.h * .3), s: fitScale('grid') * .9 }, 900);
    } else {
      // DIVE: drop the operator inside the start photograph
      const it = instOfPhotoNear(R.start, view.x, view.y);
      H_.inst = null;
      if (S.mode === 'FOCUS') { S.focus = 0; S.focusAnim = null; setMode('EXPLORE'); }
      view.x = it.x + it.w / 2; view.y = it.y + it.h / 2; view.s = fitScale('grid') * 2.2;
      setTimeout(() => focusOn(it, 'hunt'), 120);
    }
    blip(880, .12, .05); blip(1320, .2, .04);
  }
  function drawTargetThumb() {
    const c = el('#hThumb'), g = c.getContext('2d'), p = H_.target;
    const tryDraw = () => {
      const im = best(p); g.fillStyle = '#080B0D'; g.fillRect(0, 0, 168, 168);
      if (!im) { setTimeout(tryDraw, 150); return; }
      // tight crop around the camera body: the operator gets a detail, not the scene
      const b = p.cam.bbox, iw = im.naturalWidth, ih = im.naturalHeight;
      const side = Math.max(b[2] * iw, b[3] * ih) * (H_.mode === 'search' ? 2.2 : 3.2);
      const cx = (b[0] + b[2] / 2) * iw, cy = (b[1] + b[3] / 2) * ih;
      g.drawImage(im, cx - side / 2, cy - side / 2, side, side, 0, 0, 168, 168);
      g.strokeStyle = 'rgba(217,83,74,.9)'; g.lineWidth = 2; const k = 168 / side;
      g.strokeRect(84 - b[2] * iw * k / 2 - 4, 84 - b[3] * ih * k / 2 - 4, b[2] * iw * k + 8, b[3] * ih * k + 8);
    };
    tryDraw();
  }
  // world distance from view centre to target instance → heat 0..1
  function searchHeat() {
    if (!H_ || !H_.inst) return 0;
    const it = H_.inst, d = Math.hypot(it.x + it.w / 2 - view.x, it.y + it.h / 2 - view.y);
    return clamp(1 - d / (SECT.w * 1.2), 0, 1);
  }
  function heatOf(p, k) {
    if (!H_ || H_.mode !== 'dive' || !H_.dist) return null;
    const to = S.routes[k]; if (!to) return null;
    if (to === H_.target) return C.admin;
    const d = H_.dist.get(to), here = H_.dist.get(p);
    if (d == null) return '120,130,140';
    if (here != null && d < here) return C.admin;
    if (here != null && d === here) return C.white;
    return '120,130,140';
  }
  function heatWord(p, k) {
    if (!H_ || H_.mode !== 'dive') return 'ENTER';
    const to = S.routes[k]; if (to === H_.target) return 'SIGNAL LOCKED';
    const d = H_.dist && H_.dist.get(to), here = H_.dist && H_.dist.get(p);
    if (d == null) return 'NO SIGNAL';
    return here != null && d < here ? `WARMER · ${d} HOPS` : here != null && d === here ? `SAME · ${d} HOPS` : `COLDER · ${d} HOPS`;
  }
  // DIVE: one lens leads towards the target, so a careful operator can always make progress
  function route(p, k) {
    if (!H_ || H_.mode !== 'dive' || !H_.dist) return null;
    if (k !== Math.floor((H_.round * 7 + p.i) % Math.max(1, p.cams.length))) return null;
    const cands = p.links.map(id => byId.get(id)).filter(q => q && H_.dist.has(q));
    if (p.links.includes(H_.target.id)) return H_.target;
    cands.sort((a, b) => H_.dist.get(a) - H_.dist.get(b));
    const here = H_.dist.get(p);
    if (cands[0] && (here == null || H_.dist.get(cands[0]) < here)) return cands[0];
    // otherwise a shortcut: the machine opens a door one hop away from the target
    const near = P.filter(q => H_.dist.get(q) === 1 && q !== p);
    return near.length && rnd() < .5 ? near[Math.floor(rnd() * near.length)] : null;
  }
  function onFocus(it) {
    if (!H_ || !it) return;
    if (H_.mode === 'dive') { H_.hops = H_.hops; if (it.p === H_.target) win(it); }
  }
  function confirm(p, k, x, y) {
    if (!H_) return false;
    if (H_.mode === 'search') {
      if (p === H_.target && k === 0 || p === H_.target && p.cams.length === 1) { win(null, x, y); return true; }
      if (p === H_.target) { win(null, x, y); return true; }
      H_.misses++; H_.roundMiss++; penalty(x, y); return true;
    }
    // dive: entering a lens is a hop
    H_.hops++; H_.roundHops++;
    return false;
  }
  function fastPortal() { return !!H_; }
  // SEARCH: clicking a wrong tile is answered instantly — no need to open it
  function tileClick(it, x, y) {
    if (!H_ || H_.mode !== 'search') return false;
    if (it.p === H_.target) return false;
    H_.misses++; H_.roundMiss++;
    H_.t0 -= 2000;
    stamp(x, y, 'NO MATCH', '+2.00 S', true);
    blip(180, .2, .05, 'square');
    deniedKeys.set(it.key, performance.now());
    return true;
  }
  function miss(x, y) { if (H_ && H_.mode === 'search' && S.mode === 'EXPLORE') { /* clicking empty space costs nothing */ } }
  function penalty(x, y) {
    H_.t0 -= 3000; // +3s
    stamp(x || W / 2, y || H / 2, 'NEGATIVE MATCH', '+3.00 S', true);
    blip(180, .25, .06, 'square');
    document.body.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }
  function win(it, x, y) {
    const t = performance.now() - H_.t0;
    H_.total += t; H_.splits.push({ p: H_.target, t, hops: H_.roundHops, miss: H_.roundMiss });
    const r = H_.target.fr || focusRect(H_.target);
    const lx = x || (r.x + r.w / 2), ly = y || (r.y + r.h / 2);
    stamp(lx, ly, `TARGET ACQUIRED · ${H_.target.code}`, fmtT(t));
    chord([660, 880, 1320], .4, .05);
    flash = performance.now();
    H_.target.visited = true;
    const was = H_.round;
    setTimeout(() => { if (H_ && H_.round === was) { if (S.mode === 'FOCUS') { S.focusAnim = { from: S.focus, to: 0, t0: performance.now(), dur: 500 }; setMode('EXPLORE'); } next(); } }, 1500);
  }
  let flash = 0;
  function finish() {
    const h = H_, total = h.total, sec = total / 1000;
    const per = sec / h.rounds.length + (h.mode === 'dive' ? h.hops * 2 / h.rounds.length : 0);
    const rank = RANKS.find(r => per * (h.mode === 'search' ? 1 : .8) < r[0] / 5 * 1 + (r[0] === 0 ? 10 : 0)) || RANKS[RANKS.length - 1];
    const rankName = per < 14 ? 'ADMIN' : per < 26 ? 'PRIMARY ASSET' : per < 45 ? 'ANALOG INTERFACE' : per < 80 ? 'ASSET' : 'IRRELEVANT';
    const key = h.mode + '_' + (h.daily ? today() : 'free');
    const b = board(key); const rec = { h: h.h, t: Math.round(total), hops: h.hops, rank: rankName, mode: h.mode, at: Date.now() };
    b.push(rec); b.sort((a, c) => (a.t + (a.hops || 0) * 2000) - (c.t + (c.hops || 0) * 2000)); saveBoard(key, b);
    const place = b.indexOf(rec) + 1;
    S.hunt = H_ = null; document.body.classList.remove('hunting');
    say(rankName === 'ADMIN' ? 'ADMIN ACCESS GRANTED' : 'CASE CLOSED', `${fmtT(total)} · ${rankName}`);
    chord([523, 659, 784, 1046], .6, .05);
    setTimeout(() => results(h, rec, place), 2400);
  }
  function results(h, rec, place) {
    openModal(`<button class="m-close" data-x>ESC</button>
      <div class="m-k">CASE ${pad(caseNo(), 4)} · ${h.mode.toUpperCase()} · ${h.daily ? 'DAILY ' + today() : 'FREE RUN'} · OPERATOR ${h.h}</div>
      <div class="m-big">${fmtT(rec.t)}</div>
      <div class="m-rank">${rec.rank}</div>
      <div class="m-p" style="color:var(--muted)">${h.mode === 'dive' ? `${rec.hops} HOPS · ` : ''}${h.misses} NEGATIVE MATCHES · #${place} ON THIS DEVICE</div>
      <div class="m-splits">${h.splits.map((s, i) => `<div><canvas data-s="${i}" width="120" height="120"></canvas>${s.p.code}<br>${fmtT(s.t)}${h.mode === 'dive' ? ' · ' + s.hops + 'H' : ''}</div>`).join('')}</div>
      <div class="m-row"><button class="m-btn primary" data-card>DOWNLOAD CARD</button><button class="m-btn" data-again>AGAIN</button><button class="m-btn" data-board>LEADERBOARD</button></div>`);
    $('#mBox').querySelectorAll('[data-s]').forEach(c => { const s = h.splits[+c.dataset.s]; const g = c.getContext('2d'); const im = best(s.p); if (im) { const sd = Math.min(im.naturalWidth, im.naturalHeight); g.drawImage(im, (im.naturalWidth - sd) * s.p.anchor[0], (im.naturalHeight - sd) * s.p.anchor[1], sd, sd, 0, 0, 120, 120); } });
    $('#mBox').querySelector('[data-again]').onclick = brief;
    $('#mBox').querySelector('[data-board]').onclick = showBoard;
    $('#mBox').querySelector('[data-card]').onclick = () => card(h, rec);
  }
  function card(h, rec) {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const g = c.getContext('2d');
    g.fillStyle = '#080B0D'; g.fillRect(0, 0, 1080, 1350);
    const n = h.splits.length, cw = 1080 - 120, cell = (cw - (n - 1) * 12) / n;
    h.splits.forEach((s, i) => { const im = best(s.p); const x = 60 + i * (cell + 12), y = 760; if (im) { const sd = Math.min(im.naturalWidth, im.naturalHeight); g.drawImage(im, (im.naturalWidth - sd) * s.p.anchor[0], (im.naturalHeight - sd) * s.p.anchor[1], sd, sd, x, y, cell, cell); } g.strokeStyle = 'rgba(232,197,71,.9)'; g.lineWidth = 2; g.strokeRect(x, y, cell, cell); g.fillStyle = '#819098'; g.font = `20px ${MONO}`; g.fillText(fmtT(s.t), x, y + cell + 30); g.fillText(s.p.code, x, y + cell + 56); });
    g.fillStyle = '#E2E8E7'; g.font = `500 30px ${MONO}`; g.fillText('T H E   M A C H I N E', 60, 110);
    g.fillStyle = '#E8C547'; g.font = `22px ${MONO}`; g.fillText(`CASE ${pad(caseNo(), 4)} · ${h.mode.toUpperCase()} · ${h.daily ? today() : 'FREE RUN'}`, 60, 160);
    g.fillStyle = '#E2E8E7'; g.font = `150px ${MONO}`; g.fillText(fmtT(rec.t), 52, 400);
    g.fillStyle = '#E8C547'; g.fillRect(60, 450, g.measureText ? (g.font = `500 34px ${MONO}`, g.measureText(rec.rank).width + 40) : 400, 58);
    g.fillStyle = '#080B0D'; g.fillText(rec.rank, 80, 491);
    g.fillStyle = '#819098'; g.font = `24px ${MONO}`; g.fillText(`OPERATOR ${h.h}${h.mode === 'dive' ? ' · ' + rec.hops + ' HOPS' : ''} · ${h.misses} NEGATIVE MATCHES`, 60, 580);
    g.fillText('YOU ARE BEING WATCHED.', 60, 1270);
    g.strokeStyle = 'rgba(232,197,71,.9)'; g.lineWidth = 2; bracket(g, 30, 30, 1020, 1290, 40, 'rgba(232,197,71,.9)', 2);
    const a = document.createElement('a'); a.download = `THE_MACHINE_CASE${pad(caseNo(), 4)}_${h.h}.png`; a.href = c.toDataURL('image/png'); a.click();
  }
  function end(done) { if (!H_) return; S.hunt = H_ = null; document.body.classList.remove('hunting'); say('CASE ABANDONED', 'THE NUMBER REMAINS'); }
  // overlay: HUD timer, heat bar, edge compass toward the target
  function draw(now) {
    const fl = flash ? clamp(1 - (now - flash) / 500, 0, 1) : 0;
    if (fl > 0) { fx.fillStyle = `rgba(232,197,71,${.18 * fl})`; fx.fillRect(0, 0, W, H); }
    if (!H_ || H_.round < 0 || H_.round >= H_.rounds.length) return;
    const t = now - H_.t0;
    el('#hTime').textContent = fmtT(t);
    if (H_.mode === 'search') {
      const h = searchHeat();
      el('#hHeat').style.width = (h * 100).toFixed(1) + '%';
      el('#hHeat').style.background = h > .85 ? 'var(--admin)' : 'var(--threat)';
      el('#hDist').textContent = h > .92 ? 'SIGNAL · VERY STRONG — 目标就在视野里' : h > .7 ? 'SIGNAL · STRONG' : h > .4 ? 'SIGNAL · WEAK' : 'SIGNAL · FAINT';
      if (S.mode !== 'EXPLORE') return;
      const it = H_.inst, r = toScreen(it), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const on = cx > 0 && cx < W && cy > 0 && cy < H;
      if (!on) {
        // edge compass
        const ang = Math.atan2(cy - H / 2, cx - W / 2), m = 46;
        const ex = clamp(W / 2 + Math.cos(ang) * W, m, W - m), ey = clamp(H / 2 + Math.sin(ang) * H, m + 40, H - m);
        fx.save(); fx.translate(ex, ey); fx.rotate(ang);
        fx.fillStyle = `rgba(${C.threat},${.6 + .4 * Math.sin(now / 200)})`; fx.beginPath(); fx.moveTo(12, 0); fx.lineTo(-6, -8); fx.lineTo(-6, 8); fx.closePath(); fx.fill();
        fx.restore();
        fx.font = `9px ${MONO}`; fx.fillStyle = `rgba(${C.threat},.9)`; fx.fillText(`${Math.round(Math.hypot(cx - W / 2, cy - H / 2) / view.s / PITCH)} CELLS`, clamp(ex - 24, 8, W - 70), ey + (ey > H / 2 ? -14 : 22));
      } else if (h > .5 && r.w > 6) {
        // close: the machine narrows the search area (a circle that doesn't give it away exactly)
        const rad = Math.max(r.w * 2.4, 60) * (1.2 - h * .4), jx = Math.sin(H_.round * 3.1) * rad * .35, jy = Math.cos(H_.round * 2.3) * rad * .35;
        fx.setLineDash([4, 6]); fx.lineDashOffset = -now / 50; fx.strokeStyle = `rgba(${C.threat},${.35 + .25 * Math.sin(now / 300)})`; fx.lineWidth = 1;
        fx.beginPath(); fx.arc(cx + jx, cy + jy, rad, 0, Math.PI * 2); fx.stroke(); fx.setLineDash([]);
        if (r.w > 50 && h > .8) { fx.strokeStyle = `rgba(${C.threat},.85)`; bracket(fx, r.x - 4, r.y - 4, r.w + 8, r.h + 8, 10, `rgba(${C.threat},.9)`, 1.5); }
      }
    } else {
      const here = S.sel && H_.dist ? H_.dist.get(S.sel) : null;
      el('#hHeat').style.width = here == null ? '4%' : clamp(100 - here * 18, 6, 100) + '%';
      el('#hHeat').style.background = here != null && here <= 1 ? 'var(--admin)' : 'var(--threat)';
      el('#hDist').textContent = `HOPS ${pad(H_.roundHops)} · ${here == null ? 'NO PATH' : here === 0 ? 'ARRIVED' : here + ' HOPS AWAY'}`;
    }
  }
  return { brief, start, end, draw, confirm, miss, tileClick, onFocus, heatOf, heatWord, route, fastPortal, onEnter: () => { } };
})();

/* =====================================================================
 *  CONTRIBUTE AN EYE — your photograph brings an offline cell back online.
 *  Stored only on this device (IndexedDB). Export a package for curators.
 * ===================================================================== */
const Submit = (() => {
  const items = [];   // { p, slot }  slot = index into SECT.offline
  let db = null;
  function idb() {
    return new Promise(res => {
      if (db) return res(db);
      try {
        const rq = indexedDB.open('the_machine', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('eyes', { keyPath: 'id' });
        rq.onsuccess = () => { db = rq.result; res(db); }; rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function load() {
    const d = await idb(); if (!d) return;
    const tx = d.transaction('eyes', 'readonly'), rq = tx.objectStore('eyes').getAll();
    rq.onsuccess = () => (rq.result || []).sort((a, b) => a.at - b.at).forEach(r => add(r, false));
  }
  function save(r) { idb().then(d => { if (!d) return; d.transaction('eyes', 'readwrite').objectStore('eyes').put(r); }); }
  function add(r, fresh) {
    if (items.length >= SECT.offline.length) return null;
    const im = new Image(); im.ok = false; im.onload = () => { im.ok = true; sectorBitmaps.clear(); sectorVer++; }; im.src = r.dataUrl;
    const p = { id: r.id, code: r.code, w: r.w, h: r.h, local: true, dataUrl: r.dataUrl, author: r.handle || 'ANON', license: 'CONTRIBUTED', provider: 'THIS DEVICE',
      sceneEn: 'CONTRIBUTED', color: r.color, lum: r.lum, cams: [{ bbox: r.bbox, lens: r.lens, src: 'user' }], links: [], lat: r.lat, lon: r.lon, geoReal: r.lat != null, place: r.lat != null ? 'CONTRIBUTED' : null };
    prepPhoto(p, P.length); p.img = { thumb: im, preview: im, full: im }; p.ai = null;
    // links: tonal neighbours
    p.links = P.filter(q => !q.local).map(q => [q, Math.abs(q.lum - r.lum) + colorDist(q.color, r.color)]).sort((a, b) => a[1] - b[1]).slice(0, 4).map(x => x[0].id);
    P.push(p); byId.set(p.id, p); N = P.length; $('#eyeCount').textContent = N;
    const lon = r.lon != null ? r.lon : 0, lat = r.lat != null ? r.lat : 0;
    const [gx, gy] = geoProj(lon, lat); p.geoPx = [gx, gy];
    p.atlas = { x: gx - 9 + items.length * 20, y: gy - 9 - 40, w: 18, h: 18, c: coverCrop(p, 18, 18) };
    const slot = items.length; items.push({ p, slot });
    if (fresh) {
      p.visited = true;
      const it = instOf(p);
      animView({ x: it.x + U / 2, y: it.y + U / 2, s: fitScale('grid') * 3 }, 1400);
      setTimeout(() => { say('SIGNAL RESTORED', `${p.code} · AN OFFLINE EYE IS BACK ONLINE`); chord([523, 784, 1046]); restoredAt[slot] = performance.now(); }, 1300);
    }
    return p;
  }
  const restoredAt = {};
  const colorDist = (a, b) => { const h = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255); const x = h(a), y = h(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  function instOf(p, sx = 0, sy = 0) {
    const k = items.findIndex(x => x.p === p), o = SECT.offline[k], d = sectorDeal(sx, sy);
    let ox = o.x; if (d.mirror) ox = SECT.w - GAP - o.x - U;
    return { p, si: -1 - k, sx, sy, key: 'u' + k + ':' + sx + ':' + sy, x: SECT.ox + sx * SECT.w + ox, y: SECT.oy + sy * SECT.h + o.y, w: U, h: U };
  }
  function visible(v) {
    const out = [];
    if (!items.length) return out;
    for (let sy = v.sy0; sy <= v.sy1; sy++) for (let sx = v.sx0; sx <= v.sx1; sx++) for (const { p } of items) {
      const it = instOf(p, sx, sy); if (it.x > v.x1 || it.y > v.y1 || it.x + U < v.x0 || it.y + U < v.y0) continue; out.push(it);
    }
    return out;
  }
  function restored(o, sx, sy) { const k = SECT.offline.indexOf(o); return k < items.length; }
  function drawRestored(now, v, a) {
    for (const it of VIS) {
      if (!it.p.local || !it.sr || it.sr.w < 30) continue;
      const k = -1 - it.si, t0 = restoredAt[k], r = it.sr;
      const pulse = t0 ? clamp(1 - (now - t0) / 2400, 0, 1) : 0;
      poiBox(ctx, r.x - 3, r.y - 3, r.w + 6, r.h + 6, C.admin, (.75 + .25 * pulse) * a, r.w > 70 ? 'CONTRIBUTED' : null);
      if (pulse > 0) { ctx.strokeStyle = `rgba(${C.admin},${pulse})`; ctx.lineWidth = 1; const e = (1 - pulse) * 60; ctx.strokeRect(r.x - e, r.y - e, r.w + e * 2, r.h + e * 2); }
    }
  }
  function instances() { return items.map(({ p }) => ({ ...instOf(p), p })); }

  // ---- UI flow
  let draft = null;
  function open() {
    if (S.mode === 'BOOT' || S.hunt) return;
    if (items.length >= SECT.offline.length) { say('NO OFFLINE CELLS LEFT', 'EVERY EYE IS ONLINE'); return; }
    draft = null;
    openModal(`<button class="m-close" data-x>ESC</button>
      <div class="m-k">CONTRIBUTE AN EYE · ${SECT.offline.length - items.length} OFFLINE CELLS REMAINING</div>
      <div class="m-t">+ EYE</div>
      <div class="m-p">投一张你拍到的监控摄像头。它会填进墙上一个 <span style="color:var(--anomaly)">NO SIGNAL</span> 的暗格，让一只离线的眼睛重新上线，并接入整个关联网络。</div>
      <div class="m-drop" id="mDrop">拖入照片 · 或点击选择<br><span style="font-size:9.5px;color:var(--muted)">JPG / PNG · 照片只保存在这台设备上</span></div>
      <div id="mStep"></div>`);
    const dz = $('#mDrop');
    dz.onclick = () => $('#fileIn').click();
    dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f); };
  }
  $('#fileIn').onchange = e => { const f = e.target.files[0]; if (f) readFile(f); e.target.value = ''; };
  function readFile(f) {
    if (!/^image\//.test(f.type)) return;
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const L2 = 1600, k = Math.min(1, L2 / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height);
      const s = document.createElement('canvas'); s.width = s.height = 8; s.getContext('2d').drawImage(c, 0, 0, 8, 8);
      const px = s.getContext('2d').getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
      r /= 64; gg /= 64; b /= 64;
      draft = { dataUrl: c.toDataURL('image/jpeg', .86), w: c.width, h: c.height, color: '#' + [r, gg, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''), lum: (.2126 * r + .7152 * gg + .0722 * b) / 255 };
      URL.revokeObjectURL(url); step2();
    };
    im.src = url;
  }
  function step2() {
    $('#mDrop').style.display = 'none';
    $('#mStep').innerHTML = `<div class="m-k" style="margin-top:12px">ANALYSING · 点击照片里的摄像头镜头</div>
      <div class="m-sub" id="mSub"><img src="${draft.dataUrl}"><div class="sweep"></div><i id="mLock"></i></div>
      <div class="m-row"><span style="letter-spacing:.2em">OPERATOR</span><input class="m-in" id="mH" maxlength="12" value="${(readLocal('tm_handle') || '')}" placeholder="HANDLE"></div>
      <div class="m-check"><input type="checkbox" id="mGeo"> <label for="mGeo">附上我当前的大致位置（精确到约 10 km，只保存在本机），让它出现在 ATLAS 地图上</label></div>
      <div class="m-check"><input type="checkbox" id="mOk"> <label for="mOk">这张照片是我拍摄的，或我有权使用；画面中没有可识别的私人面孔</label></div>
      <div class="m-row"><button class="m-btn primary" id="mGo" disabled>BRING IT ONLINE</button><span id="mWhy" style="font-size:10px;color:var(--muted)">先点出摄像头</span></div>`;
    const sub = $('#mSub'), lock = $('#mLock');
    sub.onclick = e => {
      const r = sub.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      draft.lens = [u, v]; const bw = .12, bh = .12 * draft.w / draft.h;
      draft.bbox = [clamp(u - bw / 2, 0, 1 - bw), clamp(v - bh / 2, 0, 1 - bh), bw, bh];
      lock.style.left = u * 100 + '%'; lock.style.top = v * 100 + '%'; lock.classList.remove('on'); void lock.offsetWidth; lock.classList.add('on');
      blip(2400, .05, .04); validate();
    };
    const validate = () => { const ok = draft.lens && $('#mOk').checked; $('#mGo').disabled = !ok; $('#mWhy').textContent = !draft.lens ? '先点出摄像头' : !$('#mOk').checked ? '请确认使用权' : 'READY'; };
    $('#mOk').onchange = validate;
    $('#mGo').onclick = async () => {
      const h = ($('#mH').value || 'ANON').toUpperCase().replace(/[^A-Z0-9_\-]/g, '').slice(0, 12) || 'ANON';
      try { localStorage.setItem('tm_handle', h); } catch (e) { }
      let lat = null, lon = null;
      if ($('#mGeo').checked && navigator.geolocation) {
        await new Promise(res => navigator.geolocation.getCurrentPosition(pos => { lat = Math.round(pos.coords.latitude * 10) / 10; lon = Math.round(pos.coords.longitude * 10) / 10; res(); }, () => res(), { timeout: 6000 }));
      }
      const n = items.length + 1, rec = { id: 'U-' + Date.now().toString(36), code: `CAM_U${pad(n, 3)}`, at: Date.now(), handle: h, lat, lon, ...draft };
      save(rec); closeModal();
      if (S.layout !== 'grid') setLayout('grid');
      add(rec, true);
      setTimeout(() => exportOffer(rec), 4200);
    };
  }
  function exportOffer(rec) {
    hint('U · CONTRIBUTE ANOTHER  ·  YOUR EYE IS STORED ON THIS DEVICE', 4000);
    const a = document.createElement('a');
    a.textContent = '';
    window.__exportLast = () => {
      const blob = new Blob([JSON.stringify({ ...rec, dataUrl: undefined, image: rec.code + '.jpg', schema: 'the-machine/contribution@1' }, null, 2)], { type: 'application/json' });
      const l1 = document.createElement('a'); l1.href = URL.createObjectURL(blob); l1.download = rec.code + '.json'; l1.click();
      const l2 = document.createElement('a'); l2.href = rec.dataUrl; l2.download = rec.code + '.jpg'; l2.click();
    };
  }
  return { open, load, add, instOf, visible, restored, drawRestored, instances, items };
})();

/* =====================================================================
 *  +1 OBSERVER — opt-in. The lens you are looking through looks back.
 *  Live webcam frame becomes a node in the wall; next portal routes into you.
 *  Nothing is recorded or transmitted.
 * ===================================================================== */
const Observer = (() => {
  let on = false, video = null, p = null, pending = false;
  function ask() {
    if (on) { stop(); return; }
    openModal(`<button class="m-close" data-x>ESC</button>
      <div class="m-k">+1 OBSERVER</div><div class="m-t">THE MACHINE CAN SEE YOU</div>
      <div class="m-p">你一直在通过这些镜头观看。允许机器用你的摄像头看你一眼吗？你的实时画面会作为一只眼睛接入这面墙，下一次穿越镜头时，你会从另一端看到自己。</div>
      <div class="m-p" style="color:var(--muted)">画面只在这台设备上实时显示，不录制、不保存、不上传。随时可以再次点击 +1 OBSERVER 关闭。</div>
      <div class="m-row"><button class="m-btn primary" id="oYes">ALLOW</button><button class="m-btn" data-x>NOT NOW</button></div>`);
    $('#oYes').onclick = start;
  }
  async function start() {
    closeModal();
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
      video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = st; await video.play();
      video.ok = true; video.naturalWidth = video.videoWidth; video.naturalHeight = video.videoHeight;
      const w = video.videoWidth || 1280, h = video.videoHeight || 720;
      p = { id: 'OBSERVER', code: 'CAM_YOU', w, h, local: true, observer: true, dataUrl: '', author: 'YOU', license: 'LIVE · NOT RECORDED', provider: 'THIS DEVICE', sceneEn: 'OBSERVER', color: '#333333', lum: .3,
        cams: [{ bbox: [.36, .22, .28, .5], lens: [.5, .42], src: 'user' }], links: P.filter(q => q.cam && !q.local).slice(0, 4).map(q => q.id), lat: 0, lon: 0, geoReal: false, place: null };
      prepPhoto(p, P.length); p.img = { thumb: video, preview: video, full: video }; p.ai = null;
      Object.defineProperty(video, 'naturalWidth', { get: () => video.videoWidth }); Object.defineProperty(video, 'naturalHeight', { get: () => video.videoHeight });
      P.push(p); byId.set(p.id, p); N = P.length;
      p.atlas = { x: -9, y: -9, w: 22, h: 22, c: [0, 0, 1, 1] }; p.geoPx = [0, 0];
      on = true; pending = true; $('#observer').textContent = '● OBSERVER LIVE';
      say('I SEE YOU', 'ENTER ANY LENS');
    } catch (e) { say('NO CAMERA ACCESS', 'THE MACHINE WILL KEEP WATCHING ANYWAY'); }
  }
  function stop() {
    if (video && video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const i = P.indexOf(p); if (i >= 0) P.splice(i, 1); byId.delete('OBSERVER'); N = P.length;
    on = false; p = null; $('#observer').textContent = '+1 OBSERVER';
  }
  // next portal goes to you, once
  function takeRoute() { if (on && pending && p) { pending = false; return p; } return null; }
  return { ask, takeRoute, get on() { return on; }, get p() { return p; } };
})();
$('#observer').style.pointerEvents = 'auto'; $('#observer').style.cursor = 'pointer';
$('#observer').onclick = () => Observer.ask();
$('#observer').title = '点击：让机器看见你（可选）';

/* ---------- modal ---------- */
let modalReturnFocus = null;
function openModal(html) {
  const m = $('#modal');
  if (!m.classList.contains('on')) modalReturnFocus = document.activeElement;
  $('#mBox').innerHTML = html; $('#mBox').scrollTop = 0; m.inert = false; m.classList.add('on');
  $('#mBox').querySelectorAll('[data-x]').forEach(b => b.onclick = closeModal);
  $('#mBox').querySelectorAll('[data-x]').forEach(b => { if (b.textContent === 'ESC') b.textContent = 'CLOSE ×'; });
  $('#mBox').focus({ preventScroll: true });
}
function closeModal() { $('#modal').classList.remove('on'); $('#modal').inert = true; modalReturnFocus?.focus?.({ preventScroll: true }); }
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeModal(); });

/* ---------- go ---------- */
P.forEach((p, i) => { p.ai = i; });
resize();
buildSector(); buildAtlas();
loadAtlases();
setMode('BOOT');
startBoot();
Submit.load();
requestAnimationFrame(frame);
try {
  const m = location.hash.match(/trace=([\w.@_\-]+)/);
  if (m) setTimeout(() => {
    m[1].split('.').forEach(tok => {
      const [id, sec] = tok.split('@'), p = byId.get(id); if (!p) return;
      const [sx, sy] = sec ? sec.split('_').map(Number) : [0, 0];
      const k = sectorDeal(sx, sy).index.get(p.i); if (k == null) return;
      pushTrace(instAt(k, sx, sy), 'replay');
    });
    S.traceDraw = performance.now() + 6500;
  }, 10);
} catch (e) { }
window.__MACHINE = { S, view, P, SECT, Hunt, Submit, VIS: () => VIS, toScreen, instAt, sectorDeal, fitScale };
})();
