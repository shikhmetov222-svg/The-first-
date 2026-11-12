// Палитра (16 цветов на всю сцену) и процедурные спрайты.
(function () {
  const PAL = {
    ink: '#3d2e23', wall: '#e6cfa6', wallShade: '#d9bf93', wood: '#6e4a34',
    floor: '#b8794b', floorShade: '#a56a40', rug: '#c44e52', rugDark: '#8e3548',
    sky: '#86cfe6', skyLight: '#d3f1f8', cream: '#fff3dc',
    orange: '#d29262', orangeDark: '#aa704c',
    pink: '#d28c80', green: '#5aa469', red: '#d9453f'
  };
  const NAMES = Object.keys(PAL);
  const IDX = {};
  NAMES.forEach((n, i) => (IDX[n] = i + 1)); // 0 = пусто

  // Буфер пикселей с индексами палитры + автоматический тёмный контур.
  const K = 1.2; // масштаб мебели относительно прежней сетки
  function Buf(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h); }
  // те же вызовы, что rect/ellipse, но координаты и размеры умножаются на K
  Buf.prototype.rectS = function (x, y, w, h, c) {
    const x0 = Math.round(x * K), y0 = Math.round(y * K);
    this.rect(x0, y0, Math.round((x + w) * K) - x0, Math.round((y + h) * K) - y0, c);
  };
  Buf.prototype.ellipseS = function (cx, cy, rx, ry, c) { this.ellipse(cx * K, cy * K, rx * K, ry * K, c); };
  Buf.prototype.set = function (x, y, c) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = IDX[c];
  };
  Buf.prototype.rect = function (x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  };
  Buf.prototype.ellipse = function (cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  };
  Buf.prototype.outline = function (c) {
    const src = this.d.slice(), w = this.w, h = this.h, ic = IDX[c];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      if ((x > 0 && src[y * w + x - 1]) || (x < w - 1 && src[y * w + x + 1]) ||
          (y > 0 && src[(y - 1) * w + x]) || (y < h - 1 && src[(y + 1) * w + x])) this.d[y * w + x] = ic;
    }
  };
  Buf.prototype.toCanvas = function () {
    const cv = document.createElement('canvas'); cv.width = this.w; cv.height = this.h;
    const g = cv.getContext('2d');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const v = this.d[y * this.w + x];
      if (v) { g.fillStyle = PAL[NAMES[v - 1]]; g.fillRect(x, y, 1, 1); }
    }
    return cv;
  };

  // Эллипс прямо на canvas (для ковра и теней).
  function fillEllipse(ctx, cx, cy, rx, ry, color, dither) {
    ctx.fillStyle = PAL[color] || color;   // имя из палитры или готовый #hex
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && (!dither || (x + y) % 2 === 0)) ctx.fillRect(x, y, 1, 1);
      }
  }
  // Тень на полу: плотное ядро + пунктирный край.
  function shadow(ctx, cx, cy, rx, ry) {
    fillEllipse(ctx, cx, cy, rx, ry, 'wood', true);
    fillEllipse(ctx, cx, cy, rx * 0.65, ry * 0.6, 'wood', false);
  }

  // ---- Кот: попиксельная копия референса (рыжий полосатый, вид слегка сбоку) ----
  // K — контур, d — тёмный (нос, тени), m — тёмная шерсть, o — шерсть, p — розовое, w — блик
  const CAT = [
    '..KK.........KK.........',
    '.KomK.......KmoK........',
    '.KppdK.....KdwpK........',
    '.KpmmKKKKKKKoopK........',
    '.KodoomomomommoK........',
    '.KdooomomomooodK........',
    '.KoooooooooooooK........',
    '.KooKwoooowKoooK........',
    '.KmmKKooooKKmmmK........',
    'KKoooooddooooooKK.......',
    '.KdooooodooooodK.....KK.',
    '..KmmodddmooodK.....KooK',
    '...KdmmoooomddmK...KoooK',
    '...KmmmmmmmmmmmmK..KmoK.',
    '...KoooooooomoommK.KooK.',
    '...KmmoooooooommmK.KooK.',
    '...KmmoooooooommmdKKmmK.',
    '...KmmooooooooomddKKmmmK',
    '....KmommooomdoommmKoomK',
    '....KoodKmmmKoommmmKdooK',
    '....KmodKoooKoooommKKooK',
    '....KmddKoooKooommmKKooK',
    '....KoodKoomKddommmKoodK',
    '...dKooddoomKddmmmmKmmK.',
    '...KoomKooomKoommmdKdd..'
  ];
  const CAT_COL = { K: 'ink', d: 'wood', m: 'orangeDark', o: 'orange', p: 'pink', w: 'cream', b: 'sky' };
  const CAT_SCALE = 2; // кот крупнее комнаты в целое число раз
  const CAT_W = 24, CAT_H = CAT.length;
  const catCache = {};
  function scaled(src, k) {
    const cv = document.createElement('canvas'); cv.width = src.width * k; cv.height = src.height * k;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }
  // o: { head: на сколько пикселей опущена голова, tail: -2..2,
  //      eyes: 'open' | 'closed' | 'cry' | 'hungry' | 'sick' | 'angry', tear: 0|1 }
  function cat(o) {
    const key = o.head + '|' + o.eyes + '|' + o.tail + '|' + (o.tear || 0);
    if (catCache[key]) return catCache[key];
    const g = CAT.map(r => r.split(''));
    const lids = () => { g[7][4] = g[7][5] = g[7][10] = g[7][11] = 'o'; };        // веки: остаётся нижняя чёрточка
    if (o.eyes === 'closed' || o.eyes === 'sick') lids();
    if (o.eyes === 'cry') {                                                       // плачет: глаза закрыты, ручьи слёз
      lids();
      const n = 3 + (o.tear || 0);
      for (let i = 0; i < n; i++) { g[9 + i][4] = 'b'; g[9 + i][11] = 'b'; }
    }
    if (o.eyes === 'hungry') { g[7][5] = 'K'; g[7][10] = 'K'; }                   // тусклые глаза без блика
    if (o.eyes === 'angry') { g[7][4] = 'o'; g[7][11] = 'o'; g[7][5] = 'K'; g[7][10] = 'K'; } // сердитый прищур
    if (o.eyes === 'sick') { g[11][14] = 'b'; }                                   // капелька пота у щеки
    const sway = Math.round(o.tail / 2);                                          // хвост: кончик ±1
    if (sway) for (let r = 10; r <= 12; r++) {
      const row = g[r].slice(19);
      for (let c = 19; c < CAT_W; c++) g[r][c] = '.';
      row.forEach((v, i) => { const x = 19 + i + sway; if (v !== '.' && x < CAT_W) g[r][x] = v; });
    }
    const d = o.head;
    if (d) for (let c = 0; c < 18; c++) {                                         // голова вниз на d пикселей
      for (let r = 9; r >= 0; r--) g[r + d][c] = g[r][c];
      for (let r = 0; r < d; r++) g[r][c] = '.';
    }
    const B = new Buf(CAT_W + 2, CAT_H + 1);
    for (let y = 0; y < CAT_H; y++) for (let x = 0; x < CAT_W; x++)
      if (g[y][x] !== '.') B.set(x + 1, y, CAT_COL[g[y][x]]);
    return (catCache[key] = scaled(B.toCanvas(), CAT_SCALE));
  }

  // ---- Спящий кот клубком (рисуется процедурно слоями: тело, хвост, голова; у каждого свой контур) ----
  Buf.prototype.paste = function (L) { for (let i = 0; i < L.d.length; i++) if (L.d[i]) this.d[i] = L.d[i]; };
  const sleepCache = {};
  function catSleep(breath) {
    const key = breath ? 1 : 0;
    if (sleepCache[key]) return sleepCache[key];
    const W = 38, H = 22;
    // тело-«буханка» (дыхание: верх поднимается на 1 пиксель)
    const body = new Buf(W, H);
    if (breath) body.ellipse(22, 10.5, 13, 6.5, 'orange'); else body.ellipse(22, 11, 13, 6, 'orange');
    for (let x = 16; x <= 31; x += 3) for (let y = 4; y <= 7; y++) if (body.d[y * W + x]) body.set(x, y, 'orangeDark');
    body.outline('ink');
    // хвост лежит спереди и обвивает тело
    const tail = new Buf(W, H);
    tail.ellipse(26, 15.5, 11, 2.8, 'orange'); tail.ellipse(35, 14, 2, 2.5, 'orange');
    for (let x = 20; x <= 32; x += 3) for (let y = 13; y <= 18; y++) if (tail.d[y * W + x]) tail.set(x, y, 'orangeDark');
    tail.outline('ink');
    // передние лапы, голова с ушами
    const head = new Buf(W, H);
    head.rect(3, 15, 6, 3, 'orange'); head.rect(10, 15, 6, 3, 'orange');
    head.ellipse(9, 11, 7, 5.5, 'orange');
    [[1, 3, 3], [2, 3, 4], [3, 3, 5], [4, 3, 6], [5, 3, 7]].forEach(r => head.rect(r[1], r[0], r[2] - r[1] + 1, 1, 'orange'));
    [[1, 14, 14], [2, 13, 14], [3, 12, 14], [4, 11, 14], [5, 10, 14]].forEach(r => head.rect(r[1] - 1, r[0], r[2] - r[1] + 1, 1, 'orange'));
    head.rect(4, 3, 1, 1, 'pink'); head.rect(4, 4, 2, 1, 'pink'); head.rect(12, 3, 1, 1, 'pink'); head.rect(11, 4, 2, 1, 'pink');
    head.rect(9, 6, 1, 2, 'orangeDark'); head.rect(6, 7, 1, 1, 'orangeDark'); head.rect(12, 7, 1, 1, 'orangeDark');
    head.rect(5, 11, 2, 1, 'ink'); head.rect(11, 11, 2, 1, 'ink');             // закрытые глаза
    head.rect(8, 12, 2, 1, 'pink'); head.set(8, 13, 'ink'); head.set(9, 13, 'ink');
    head.outline('ink');
    body.paste(tail); body.paste(head);
    return (sleepCache[key] = scaled(body.toCanvas(), CAT_SCALE));
  }

  // ---- Значки состояний: «!», завиток, значок злости, капля, Zzz, сердечко, пузырь ----
  const fxCache = {};
  function icon(name, rows, col, outline) {
    if (fxCache[name]) return fxCache[name];
    const w = Math.max.apply(null, rows.map(r => r.length)), B = new Buf(w + 2, rows.length + 2);
    rows.forEach((row, y) => row.split('').forEach((ch, x) => { if (ch === '#') B.set(x + 1, y + 1, col); }));
    if (outline) B.outline(outline);
    return (fxCache[name] = scaled(B.toCanvas(), 2));
  }
  const excl = () => icon('excl', ['##', '##', '##', '##', '..', '##'], 'red', 'ink');
  const swirl = () => icon('swirl', ['.####.', '#....#', '#.##.#', '#.#..#', '#.####', '.#....'], 'wood');
  const anger = () => icon('anger', ['##...##', '#.....#', '.......', '.......', '#.....#', '##...##'], 'red');
  let heartC, bubbleC;
  function heart() {
    if (heartC) return heartC;
    const B = new Buf(9, 8);
    ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'].forEach((row, y) =>
      row.split('').forEach((ch, x) => { if (ch === '#') B.set(x + 1, y + 1, 'pink'); }));
    B.outline('ink'); return (heartC = B.toCanvas());
  }
  function bubble() {
    if (bubbleC) return bubbleC;
    const B = new Buf(8, 8); B.ellipse(4, 4, 2.5, 2.5, 'skyLight'); B.outline('sky');
    return (bubbleC = B.toCanvas());
  }
  function zed(ctx, x, y, k, color) {
    ctx.fillStyle = PAL[color || 'cream'];
    ['####', '..#.', '.#..', '#...', '####'].forEach((row, j) =>
      row.split('').forEach((ch, i) => { if (ch === '#') ctx.fillRect(x + i * k, y + j * k, k, k); }));
  }

  // ---- Миска ----
  let bowlC;
  function bowl() {
    if (bowlC) return bowlC;
    const B = new Buf(Math.round(18 * K), Math.round(12 * K));
    B.rectS(1, 6, 14, 2, 'pink'); B.rectS(2, 8, 12, 2, 'pink'); B.rectS(3, 10, 10, 1, 'rug');
    B.ellipseS(8, 5, 7, 2.5, 'cream'); B.ellipseS(8, 5, 5, 1.6, 'orangeDark');
    B.outline('ink'); return (bowlC = B.toCanvas());
  }

  // ---- Картинки из assets.js (растения, мебель) ----
  const assetCache = {};
  function fromRows(key, rows, pal) {
    if (assetCache[key]) return assetCache[key];
    const h = rows.length, w = rows[0].length, cv = document.createElement('canvas');
    cv.width = w; cv.height = h; const g = cv.getContext('2d');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = rows[y][x]; if (ch === '.') continue;
      g.fillStyle = pal[ch.charCodeAt(0) - 65]; g.fillRect(x, y, 1, 1);
    }
    return (assetCache[key] = cv);
  }
  const plantImg = i => fromRows('p' + i, window.Assets.plants.list[i], window.Assets.plants.pal);
  const itemImg = n => fromRows('i' + n, window.Assets.items[n], window.Assets.items.pal);

  window.Sprites = { PAL, Buf, fillEllipse, shadow, cat, catSleep, excl, swirl, anger, heart, bubble, zed, bowl, plantImg, itemImg };
})();
