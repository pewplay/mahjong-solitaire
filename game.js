// ================================================================
//  MAHJONG SOLITAIRE — PewPlay
//  @bg #0f2a22
//  @accent #e0b45a
//  Tre disposizioni, distribuzione sempre risolvibile (costruita al
//  contrario), suggerimento, mescola, annulla. In verticale il tavolo
//  viene ruotato per tenere le tessere grandi.
// ================================================================
(function () {
  'use strict';
  const { clamp, sfx, store } = PP;

  const GAME_ID = 'mahjong-solitaire';
  const LAYOUT_NAMES = ['Turtle', 'Pyramid', 'Fortress'];

  // Coordinate in mezze tessere: ogni tessera occupa 2×2 unità. [x, y, z]
  function turtle() {
    const t = [];
    const rows = [12, 8, 10, 12, 12, 10, 8, 12];
    rows.forEach((w, r) => { const s = 1 + (12 - w) / 2; for (let i = 0; i < w; i++) t.push([(s + i) * 2, r * 2, 0]); });
    t.push([0, 7, 0], [26, 7, 0], [28, 7, 0]);
    for (let r = 1; r <= 6; r++) for (let c = 4; c <= 9; c++) t.push([c * 2, r * 2, 1]);
    for (let r = 2; r <= 5; r++) for (let c = 5; c <= 8; c++) t.push([c * 2, r * 2, 2]);
    for (let r = 3; r <= 4; r++) for (let c = 6; c <= 7; c++) t.push([c * 2, r * 2, 3]);
    t.push([13, 7, 4]);
    return t; // 144
  }
  function pyramid() {
    const t = [];
    for (let z = 0; z < 4; z++) { const n = 8 - z * 2; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) t.push([(c + z) * 2, (r + z) * 2, z]); }
    return t; // 120
  }
  function fortress() {
    const t = [];
    const L0 = ['##########', '#........#', '#.######.#', '#.#....#.#', '#.#....#.#', '#.######.#', '#........#', '##########'];
    L0.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') t.push([c * 2, r * 2, 0]); }));
    for (let r = 2; r <= 5; r++) for (let c = 2; c <= 7; c++) if (r === 2 || r === 5 || c === 2 || c === 7) t.push([c * 2, r * 2, 1]);
    for (const [c, r] of [[0, 0], [9, 0], [0, 7], [9, 7]]) t.push([c * 2, r * 2, 1], [c * 2, r * 2, 2]);
    for (let r = 3; r <= 4; r++) for (let c = 3; c <= 6; c++) t.push([c * 2, r * 2, 0]);
    for (let r = 3; r <= 4; r++) for (let c = 4; c <= 5; c++) t.push([c * 2, r * 2, 1]);
    return t;
  }
  const LAYOUTS = [turtle, pyramid, fortress];

  // ── TIPI DI TESSERA ─────────────────────────────
  // suit: d (cerchi), b (bambù), n (numeri), w (venti), g (gemme), f (fiori), s (stagioni)
  const KINDS = [];
  for (const suit of ['d', 'b', 'n']) for (let v = 1; v <= 9; v++) KINDS.push({ suit, v });
  for (let v = 0; v < 4; v++) KINDS.push({ suit: 'w', v });
  for (let v = 0; v < 3; v++) KINDS.push({ suit: 'g', v });
  const FLOWERS = [0, 1, 2, 3].map(v => ({ suit: 'f', v }));
  const SEASONS = [0, 1, 2, 3].map(v => ({ suit: 's', v }));
  const match = (a, b) => a.suit === b.suit && (a.suit === 'f' || a.suit === 's' || a.v === b.v);

  let layoutIdx = 0;
  let tiles = [];        // { x, y, z, kind, gone }
  let rotated = false;
  let selected = null, hint = null, hintT = 0;
  let history = [];
  let time = 0, shuffles = 0, won = false, stuck = false;
  let geo = { tw: 40, th: 52, d: 4, ox: 0, oy: 0 };
  let anim = [];         // tessere che volano via
  let toolbar = [];

  const bestKey = () => `best-${layoutIdx}`;

  // ── DISTRIBUZIONE RISOLVIBILE ───────────────────
  function blocks(list, t) {
    let left = false, right = false;
    for (const o of list) {
      if (o === t || o.gone) continue;
      if (o.z === t.z + 1 && Math.abs(o.x - t.x) < 2 && Math.abs(o.y - t.y) < 2) return true;
      if (o.z === t.z && Math.abs(o.y - t.y) < 2) { if (o.x === t.x - 2) left = true; if (o.x === t.x + 2) right = true; }
    }
    return left && right;
  }
  const isFree = (list, t) => !t.gone && !blocks(list, t);

  function pairsPool(n) {
    const pairs = [];
    for (const k of KINDS) pairs.push([k, k], [k, k]);
    pairs.push([FLOWERS[0], FLOWERS[1]], [FLOWERS[2], FLOWERS[3]], [SEASONS[0], SEASONS[1]], [SEASONS[2], SEASONS[3]]);
    PP.shuffle(pairs);
    return pairs.slice(0, n);
  }

  function assign(list) {
    // simula la partita al contrario: ogni coppia libera riceve lo stesso tipo
    for (let attempt = 0; attempt < 200; attempt++) {
      const work = list.map(t => ({ ...t, gone: false }));
      const pool = pairsPool(work.length / 2);
      let ok = true;
      for (const pair of pool) {
        let free = work.filter(t => isFree(work, t));
        if (free.length < 2) { ok = false; break; }
        // preferisci le tessere più in alto per non bloccare la fine
        free.sort((a, b) => b.z - a.z || Math.random() - 0.5);
        const a = free[Math.floor(Math.random() * Math.min(free.length, 6))];
        a.gone = true;
        free = work.filter(t => isFree(work, t));
        if (!free.length) { ok = false; break; }
        const b = free[Math.floor(Math.random() * free.length)];
        b.gone = true;
        a.kind = pair[0]; b.kind = pair[1];
      }
      if (ok) { list.forEach((t, i) => { t.kind = work[i].kind; t.gone = false; }); return true; }
    }
    return false;
  }

  function deal() {
    rotated = PP.H > PP.W * 1.1;
    let pos = LAYOUTS[layoutIdx]();
    if (rotated) pos = pos.map(([x, y, z]) => [y, x, z]);
    tiles = pos.map(([x, y, z]) => ({ x, y, z, kind: null, gone: false }));
    assign(tiles);
    sortTiles();
  }
  function sortTiles() { tiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y); }

  function start() {
    deal();
    selected = null; hint = null; history = []; anim = [];
    time = 0; shuffles = 0; won = false; stuck = false;
    layoutGeo();
  }

  // ── GEOMETRIA ───────────────────────────────────
  function layoutGeo() {
    const live = tiles.length ? tiles : [];
    let maxX = 0, maxY = 0, maxZ = 0;
    for (const t of live) { maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y); maxZ = Math.max(maxZ, t.z); }
    const unitsW = maxX + 2, unitsH = maxY + 2;
    const top = 64, bottom = 76;
    const availW = PP.W - 20, availH = PP.H - top - bottom;
    // tessera: larghezza 2 unità, altezza 2 unità ma disegnata più alta (rapporto 0.78)
    const ratio = 1.28;
    let u = Math.min(availW / (unitsW + maxZ * 0.25), availH / (unitsH * ratio + maxZ * 0.25));
    u = Math.max(8, u);
    const tw = u * 2, th = u * 2 * ratio;
    const d = Math.max(3, u * 0.22);
    const totalW = unitsW * u + maxZ * d, totalH = unitsH * u * ratio + maxZ * d;
    geo = { u, tw, th, d, ox: (PP.W - totalW) / 2 + maxZ * d, oy: top + (availH - totalH) / 2 + maxZ * d, ratio };
    // barra strumenti in basso
    const names = ['Undo', 'Hint', 'Shuffle', 'New'];
    const bw = Math.min(110, (PP.W - 40) / 4 - 8), bh = 46;
    const bx = PP.W / 2 - (bw * 4 + 24) / 2;
    toolbar = names.map((n, i) => ({ n, x: bx + i * (bw + 8), y: PP.H - bh - 14, w: bw, h: bh }));
  }

  function tileRect(t) {
    const x = geo.ox + t.x * geo.u - t.z * geo.d;
    const y = geo.oy + t.y * geo.u * geo.ratio - t.z * geo.d;
    return { x, y, w: geo.tw - 2, h: geo.th - 2 };
  }

  // ── AZIONI ──────────────────────────────────────
  function freeTiles() { return tiles.filter(t => isFree(tiles, t)); }
  function findMove() {
    const f = freeTiles();
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (match(f[i].kind, f[j].kind)) return [f[i], f[j]];
    return null;
  }

  function remove(a, b) {
    a.gone = b.gone = true;
    history.push([a, b]);
    for (const t of [a, b]) {
      const r = tileRect(t);
      anim.push({ t, x: r.x, y: r.y, vy: -260, vx: (t === a ? -1 : 1) * 120, life: 0.6, rot: 0 });
      PP.burst(r.x + r.w / 2, r.y + r.h / 2, ['#e0b45a', '#fff6d8', '#7de0b0'], 10, 160, 3, 0.5, 200);
    }
    sfx.tone(660, 0.08, 'triangle', 0.14); sfx.tone(990, 0.1, 'triangle', 0.12, null, 0.06);
    selected = null; hint = null;
    checkEnd();
  }

  function checkEnd() {
    if (tiles.every(t => t.gone)) {
      won = true;
      const b = store.get(bestKey(), 0);
      const rec = !b || time < b;
      if (rec) store.set(bestKey(), Math.floor(time));
      sfx.win();
      PP.burst(PP.W / 2, PP.H / 2, ['#e0b45a', '#fff', '#7de0b0', '#ff7a8a'], 60, 420, 5, 1.4, 300);
      PP.over(rec ? 'New best time!' : 'Board cleared!', `${LAYOUT_NAMES[layoutIdx]} · Time ${fmt(time)}${shuffles ? ` · ${shuffles} shuffle${shuffles > 1 ? 's' : ''}` : ''}\nBest: ${fmt(rec ? time : b)}`);
      return;
    }
    stuck = !findMove();
  }

  function undo() {
    const last = history.pop();
    if (!last) return;
    last.forEach(t => { t.gone = false; });
    selected = null; stuck = false;
    sfx.tone(420, 0.08, 'sine', 0.1, 300);
  }

  function showHint() {
    const m = findMove();
    if (!m) { stuck = true; return; }
    hint = m; hintT = 2.2; time += 15;
    PP.floatText('+15s', PP.W / 2, 50, '#ffd98a', 16);
    sfx.tone(880, 0.12, 'sine', 0.1);
  }

  function shuffle() {
    const live = tiles.filter(t => !t.gone);
    if (!live.length) return;
    const kinds = live.map(t => t.kind);
    // riassegna risolvibile sulle posizioni rimaste
    const copy = live.map(t => ({ x: t.x, y: t.y, z: t.z }));
    for (let attempt = 0; attempt < 100; attempt++) {
      const work = copy.map(t => ({ ...t, gone: false }));
      // coppie dai tipi presenti
      const bySuit = {};
      kinds.forEach(k => { const key = k.suit === 'f' || k.suit === 's' ? k.suit : k.suit + k.v; (bySuit[key] = bySuit[key] || []).push(k); });
      const pairs = [];
      Object.values(bySuit).forEach(arr => { for (let i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]); });
      PP.shuffle(pairs);
      let ok = true;
      for (const pair of pairs) {
        let free = work.filter(t => isFree(work, t));
        if (free.length < 2) { ok = false; break; }
        const a = PP.pick(free); a.gone = true;
        free = work.filter(t => isFree(work, t));
        if (!free.length) { ok = false; break; }
        const b = PP.pick(free); b.gone = true;
        a.kind = pair[0]; b.kind = pair[1];
      }
      if (ok) { live.forEach((t, i) => { t.kind = work[i].kind; }); break; }
    }
    shuffles++; time += 30; selected = null; hint = null; stuck = !findMove();
    PP.floatText('Shuffled +30s', PP.W / 2, 50, '#ffd98a', 16);
    sfx.noise(0.25, 0.15, 3000);
  }

  function clickTile(t) {
    if (!isFree(tiles, t)) { sfx.tone(160, 0.08, 'square', 0.06); t.shakeT = 0.25; return; }
    if (selected === t) { selected = null; sfx.click(); return; }
    if (selected && match(selected.kind, t.kind)) { remove(selected, t); return; }
    selected = t; sfx.tone(560, 0.05, 'triangle', 0.1);
  }

  function update(dt) {
    if (!won) time += dt;
    hintT = Math.max(0, hintT - dt); if (!hintT) hint = null;
    for (let i = anim.length - 1; i >= 0; i--) {
      const a = anim[i]; a.life -= dt; a.vy += 900 * dt; a.x += a.vx * dt; a.y += a.vy * dt; a.rot += dt * 4 * Math.sign(a.vx);
      if (a.life <= 0) anim.splice(i, 1);
    }
    for (const t of tiles) if (t.shakeT) t.shakeT = Math.max(0, t.shakeT - dt);
  }

  // ── DISEGNO TESSERE ─────────────────────────────
  const SUIT_COL = ['#c8413a', '#1f7a4c', '#2a5aa8'];
  function face(c, k, x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2, m = Math.min(w, h);
    c.save();
    if (k.suit === 'd') {
      const n = k.v, cols = n <= 3 ? 1 : n <= 6 ? 2 : 3, rows = Math.ceil(n / cols);
      const r = m * (n === 1 ? 0.28 : n <= 4 ? 0.14 : 0.11);
      for (let i = 0; i < n; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const px = x + w * (0.5 + (col - (cols - 1) / 2) * 0.3);
        const py = y + h * (0.5 + (row - (rows - 1) / 2) * (rows > 2 ? 0.24 : 0.3));
        c.beginPath(); c.arc(px, py, r, 0, 7); c.fillStyle = SUIT_COL[(i + n) % 3]; c.fill();
        c.beginPath(); c.arc(px, py, r * 0.45, 0, 7); c.fillStyle = '#fff8ea'; c.fill();
      }
    } else if (k.suit === 'b') {
      const n = k.v, cols = n <= 3 ? n : n <= 6 ? 3 : 3, rows = Math.ceil(n / cols);
      const bw = w * 0.12, bh = h * (rows === 1 ? 0.5 : rows === 2 ? 0.3 : 0.2);
      for (let i = 0; i < n; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const px = x + w * (0.5 + (col - (Math.min(cols, n) - 1) / 2) * 0.26) - bw / 2;
        const py = y + h * (0.5 + (row - (rows - 1) / 2) * (bh / h + 0.05)) - bh / 2;
        c.fillStyle = i === 0 && n === 1 ? '#c8413a' : '#1f7a4c';
        c.beginPath(); c.roundRect(px, py, bw, bh, bw / 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(px, py + bh / 2 - 1, bw, 2);
      }
    } else if (k.suit === 'n') {
      c.fillStyle = '#2a5aa8'; c.font = `900 ${h * 0.46}px ${PP.FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(k.v), cx, cy - h * 0.06);
      // piccola corona
      c.fillStyle = '#c8413a';
      const cw = w * 0.5, ch = h * 0.12, cyy = y + h * 0.8;
      c.beginPath(); c.moveTo(cx - cw / 2, cyy + ch / 2); c.lineTo(cx - cw / 2, cyy - ch / 2); c.lineTo(cx - cw / 4, cyy); c.lineTo(cx, cyy - ch / 2); c.lineTo(cx + cw / 4, cyy); c.lineTo(cx + cw / 2, cyy - ch / 2); c.lineTo(cx + cw / 2, cyy + ch / 2); c.fill();
    } else if (k.suit === 'w') {
      c.fillStyle = '#23324a'; c.font = `900 ${h * 0.44}px ${PP.FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('NESW'[k.v], cx, cy + h * 0.04);
      c.beginPath(); c.arc(cx, cy - h * 0.3, m * 0.05, 0, 7); c.fillStyle = '#c8413a'; c.fill();
    } else if (k.suit === 'g') {
      const col = ['#c8413a', '#1f7a4c', '#2a5aa8'][k.v];
      c.fillStyle = col; c.strokeStyle = col; c.lineWidth = m * 0.08;
      if (k.v === 0) { c.beginPath(); c.arc(cx, cy, m * 0.28, 0, 7); c.stroke(); c.beginPath(); c.arc(cx, cy, m * 0.1, 0, 7); c.fill(); }
      if (k.v === 1) { c.beginPath(); c.moveTo(cx, cy - m * 0.34); c.lineTo(cx + m * 0.26, cy); c.lineTo(cx, cy + m * 0.34); c.lineTo(cx - m * 0.26, cy); c.closePath(); c.fill(); }
      if (k.v === 2) { c.strokeRect(cx - m * 0.24, cy - m * 0.24, m * 0.48, m * 0.48); c.fillRect(cx - m * 0.08, cy - m * 0.08, m * 0.16, m * 0.16); }
    } else if (k.suit === 'f') {
      const col = ['#e0558a', '#e08a2a', '#9a5ad8', '#d84a4a'][k.v];
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + k.v * 0.3; c.beginPath(); c.ellipse(cx + Math.cos(a) * m * 0.16, cy + Math.sin(a) * m * 0.16, m * 0.13, m * 0.08, a, 0, 7); c.fillStyle = col; c.fill(); }
      c.beginPath(); c.arc(cx, cy, m * 0.08, 0, 7); c.fillStyle = '#f0c040'; c.fill();
    } else if (k.suit === 's') {
      c.lineWidth = m * 0.06; c.lineCap = 'round';
      if (k.v === 0) { c.strokeStyle = '#1f9a5a'; c.beginPath(); c.moveTo(cx, cy + m * 0.3); c.lineTo(cx, cy - m * 0.05); c.stroke(); c.fillStyle = '#2fbf72'; c.beginPath(); c.ellipse(cx - m * 0.1, cy - m * 0.1, m * 0.12, m * 0.06, -0.6, 0, 7); c.fill(); c.beginPath(); c.ellipse(cx + m * 0.1, cy - m * 0.16, m * 0.12, m * 0.06, 0.6, 0, 7); c.fill(); }
      if (k.v === 1) { c.fillStyle = '#f0a020'; c.beginPath(); c.arc(cx, cy, m * 0.16, 0, 7); c.fill(); c.strokeStyle = '#f0a020'; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(cx + Math.cos(a) * m * 0.23, cy + Math.sin(a) * m * 0.23); c.lineTo(cx + Math.cos(a) * m * 0.32, cy + Math.sin(a) * m * 0.32); c.stroke(); } }
      if (k.v === 2) { c.fillStyle = '#c8602a'; c.beginPath(); c.moveTo(cx, cy - m * 0.32); c.quadraticCurveTo(cx + m * 0.32, cy, cx, cy + m * 0.3); c.quadraticCurveTo(cx - m * 0.32, cy, cx, cy - m * 0.32); c.fill(); c.strokeStyle = '#7a3a18'; c.lineWidth = m * 0.03; c.beginPath(); c.moveTo(cx, cy - m * 0.25); c.lineTo(cx, cy + m * 0.3); c.stroke(); }
      if (k.v === 3) { c.strokeStyle = '#3a8ad8'; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(cx - Math.cos(a) * m * 0.3, cy - Math.sin(a) * m * 0.3); c.lineTo(cx + Math.cos(a) * m * 0.3, cy + Math.sin(a) * m * 0.3); c.stroke(); } }
    }
    c.restore();
  }

  function drawTile(c, t, r, state) {
    const { d } = geo;
    // lati (spessore)
    c.fillStyle = '#b89c6a';
    c.beginPath(); c.roundRect(r.x + d * 0.2, r.y + d * 0.2, r.w + d * 0.8, r.h + d * 0.8, r.w * 0.12); c.fill();
    c.fillStyle = '#8a6f42';
    c.beginPath(); c.roundRect(r.x + d * 0.6, r.y + d * 0.6, r.w + d * 0.4, r.h + d * 0.4, r.w * 0.12); c.fill();
    // faccia
    const g = c.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, '#fffdf4'); g.addColorStop(1, '#efe5cc');
    c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, r.w * 0.12); c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(120,95,50,.35)'; c.lineWidth = 1; c.stroke();
    face(c, t.kind, r.x + r.w * 0.06, r.y + r.h * 0.05, r.w * 0.88, r.h * 0.9);
    if (state === 'sel' || state === 'hint') {
      c.save();
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, r.w * 0.12);
      c.fillStyle = state === 'sel' ? 'rgba(255,196,60,.35)' : 'rgba(80,220,150,.35)'; c.fill();
      c.lineWidth = Math.max(2, r.w * 0.07); c.strokeStyle = state === 'sel' ? '#ffb400' : '#2fd47a'; c.stroke();
      c.restore();
    } else if (state === 'blocked') {
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, r.w * 0.12); c.fillStyle = 'rgba(30,30,20,.14)'; c.fill();
    }
  }

  function draw(ctx, W, H) {
    // tavolo
    const g = ctx.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#1d5a45'); g.addColorStop(1, '#0b2219');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (PP.state === 'menu') { drawMenu(ctx, W, H); return; }

    const hintSet = hint && Math.sin(PP.time * 10) > -0.3 ? hint : [];
    for (const t of tiles) {
      if (t.gone) continue;
      const r = tileRect(t);
      if (t.shakeT) r.x += Math.sin(t.shakeT * 60) * 3;
      const free = isFree(tiles, t);
      drawTile(ctx, t, r, t === selected ? 'sel' : hintSet.includes(t) ? 'hint' : free ? '' : 'blocked');
    }
    for (const a of anim) {
      ctx.save(); ctx.globalAlpha = Math.max(0, a.life / 0.6);
      ctx.translate(a.x + geo.tw / 2, a.y + geo.th / 2); ctx.rotate(a.rot); ctx.translate(-geo.tw / 2, -geo.th / 2);
      drawTile(ctx, a.t, { x: 0, y: 0, w: geo.tw - 2, h: geo.th - 2 }, '');
      ctx.restore();
    }
    PP.drawFx();

    // HUD
    const left = tiles.filter(t => !t.gone).length;
    PP.text(fmt(time), 16, 30, 22, '#fff', 'left', 800);
    PP.text(`${left} tiles · ${countMoves()} moves`, 16, 54, 12, 'rgba(255,255,255,.7)', 'left', 600);
    for (const b of toolbar) {
      const disabled = (b.n === 'Undo' && !history.length);
      PP.rr(b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = b.n === 'Shuffle' && stuck ? '#e0b45a' : 'rgba(255,255,255,.12)'; ctx.fill();
      PP.text(b.n, b.x + b.w / 2, b.y + b.h / 2 + 1, 15, disabled ? 'rgba(255,255,255,.35)' : b.n === 'Shuffle' && stuck ? '#1b1405' : '#fff', 'center', 700);
    }
    if (stuck) {
      const msg = 'No more moves — shuffle or undo';
      ctx.font = `700 15px ${PP.FONT}`;
      const w = ctx.measureText(msg).width + 30;
      PP.rr(W / 2 - w / 2, toolbar[0].y - 52, w, 38, 19); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
      PP.text(msg, W / 2, toolbar[0].y - 33, 15, '#ffd98a', 'center', 700);
    }
  }

  function countMoves() {
    const f = freeTiles(); let n = 0;
    for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (match(f[i].kind, f[j].kind)) n++;
    return n;
  }

  let menuTiles = null;
  function drawMenu(ctx, W, H) {
    if (!menuTiles) menuTiles = Array.from({ length: 14 }, (_, i) => ({ kind: i < 9 ? KINDS[i * 3] : PP.pick(KINDS.concat(FLOWERS)), a: i / 14 * Math.PI * 2 }));
    const keepGeo = geo;
    const u = Math.min(W, H) / 22;
    geo = { u, tw: u * 2, th: u * 2.56, d: u * 0.22, ratio: 1.28 };
    for (const m of menuTiles) {
      const a = m.a + PP.time * 0.15;
      const x = W / 2 + Math.cos(a) * W * 0.4 - geo.tw / 2, y = H / 2 + Math.sin(a) * H * 0.38 - geo.th / 2;
      ctx.globalAlpha = 0.55;
      drawTile(ctx, m, { x, y, w: geo.tw, h: geo.th }, '');
    }
    ctx.globalAlpha = 1;
    geo = keepGeo;
  }

  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ── INPUT ───────────────────────────────────────
  function pointerDown(p) {
    for (const b of toolbar) if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      if (b.n === 'Undo') undo(); else if (b.n === 'Hint') showHint(); else if (b.n === 'Shuffle') shuffle(); else { start(); }
      return;
    }
    for (let i = tiles.length - 1; i >= 0; i--) {
      const t = tiles[i];
      if (t.gone) continue;
      const r = tileRect(t);
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { clickTile(t); return; }
    }
    selected = null;
  }
  function keyDown(code) { if (code === 'KeyH') showHint(); if (code === 'KeyZ' || code === 'Backspace') undo(); if (code === 'KeyS') shuffle(); }

  function demo(n) {
    layoutIdx = [0, 0, 1, 2][n];
    start();
    // gioca automaticamente qualche mossa
    const moves = [0, 22, 30, 12][n];
    for (let i = 0; i < moves; i++) { const m = findMove(); if (!m) break; m[0].gone = m[1].gone = true; history.push(m); }
    anim = [];
    time = [0, 312, 455, 128][n];
    const f = freeTiles();
    if (n === 1) { const m = findMove(); if (m) selected = m[0]; }
    if (n === 2) { const m = findMove(); if (m) { hint = m; hintT = 99; } }
    if (n === 3 && f.length) { const m = findMove(); if (m) { const r = tileRect(m[0]); PP.burst(r.x + r.w / 2, r.y, ['#e0b45a', '#fff6d8', '#7de0b0'], 18, 160, 3, 2, 0); } }
  }

  function icon(c, S) {
    const g = c.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.7);
    g.addColorStop(0, '#1f6a50'); g.addColorStop(1, '#0b2219');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    const keep = geo;
    geo = { u: S * 0.1, tw: S * 0.2, th: S * 0.26, d: S * 0.025, ratio: 1.3 };
    const tilesI = [[0.24, 0.32, KINDS[0]], [0.44, 0.32, KINDS[22]], [0.34, 0.47, KINDS[31]], [0.54, 0.47, FLOWERS[0]]];
    for (const [x, y, k] of tilesI) drawTile(c, { kind: k }, { x: x * S, y: y * S, w: geo.tw, h: geo.th }, x === 0.54 ? 'sel' : '');
    geo = keep;
  }

  PP.run({
    id: GAME_ID,
    title: 'Mahjong Solitaire',
    intro: 'Match pairs of free tiles until the board is empty.\nA tile is free if nothing is on top of it and its left or right side is open.',
    bestText: () => { const b = store.get(bestKey(), 0); return b ? `Best time (${LAYOUT_NAMES[layoutIdx]}): ${fmt(b)}` : ''; },
    choices: () => [{ label: 'Layout', options: LAYOUT_NAMES, value: layoutIdx, onChange: i => { layoutIdx = i; store.set('layout', i); PP.showMain(); } }],
    pauseText: () => `${LAYOUT_NAMES[layoutIdx]} · ${fmt(time)}`,
    init() { layoutIdx = store.get('layout', 0); },
    start, update, draw, pointerDown, keyDown, demo, icon,
    resize() { if (tiles.length) layoutGeo(); },
  });
})();
