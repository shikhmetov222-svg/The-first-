// Палитра (16 цветов на всю сцену) и процедурные спрайты.
(function () {
  const PAL = {
    ink: '#3d2e23', wall: '#e6cfa6', wallShade: '#d9bf93', wood: '#6e4a34',
    floor: '#b8794b', floorShade: '#a56a40', rug: '#c44e52', rugDark: '#8e3548',
    sky: '#86cfe6', skyLight: '#d3f1f8', cream: '#fff3dc',
    orange: '#d29262', orangeDark: '#aa704c',
    pink: '#d28c80', green: '#5aa469'
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
    ctx.fillStyle = PAL[color];
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
  // o: { head: 0..3 (на сколько пикселей голова опущена), eyes: 'open'|'closed'|'sad', tail: -2..2 }
  function cat(o) {
    const key = o.head + '|' + o.eyes + '|' + o.tail;
    if (catCache[key]) return catCache[key];
    const g = CAT.map(r => r.split(''));
    if (o.eyes !== 'open') { g[7][4] = g[7][5] = g[7][10] = g[7][11] = 'o'; }  // веки: остаётся нижняя чёрточка
    if (o.eyes === 'sad') { g[9][4] = 'b'; g[9][11] = 'b'; }                    // слёзки
    const sway = Math.round(o.tail / 2);                                        // хвост: кончик ±1
    if (sway) for (let r = 10; r <= 12; r++) {
      const row = g[r].slice(19);
      for (let c = 19; c < CAT_W; c++) g[r][c] = '.';
      row.forEach((v, i) => { const x = 19 + i + sway; if (v !== '.' && x < CAT_W) g[r][x] = v; });
    }
    const d = o.head;
    if (d) for (let c = 0; c < 18; c++) {                                       // голова вниз на d пикселей
      for (let r = 9; r >= 0; r--) g[r + d][c] = g[r][c];
      for (let r = 0; r < d; r++) g[r][c] = '.';
    }
    const B = new Buf(CAT_W + 2, CAT_H + 1);
    for (let y = 0; y < CAT_H; y++) for (let x = 0; x < CAT_W; x++)
      if (g[y][x] !== '.') B.set(x + 1, y, CAT_COL[g[y][x]]);
    const src = B.toCanvas(), cv = document.createElement('canvas');
    cv.width = src.width * CAT_SCALE; cv.height = src.height * CAT_SCALE;
    const g2 = cv.getContext('2d'); g2.imageSmoothingEnabled = false;
    g2.drawImage(src, 0, 0, cv.width, cv.height);
    return (catCache[key] = cv);
  }

  // ---- Эффекты: сердечко, пузырь, буква Z ----
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

  // ---- Предметы комнаты ----
  let plantC, bowlC;
  function plant() {
    if (plantC) return plantC;
    const B = new Buf(Math.round(16 * K), Math.round(20 * K));
    B.ellipseS(4.5, 9, 3, 5, 'green'); B.ellipseS(11.5, 8, 3, 6, 'green'); B.ellipseS(8, 5, 3, 5, 'green'); B.rectS(5, 7, 6, 6, 'green');
    B.rectS(3, 13, 10, 7, 'orangeDark'); B.rectS(2, 12, 12, 2, 'orange'); B.rectS(4, 15, 1, 3, 'orange');
    B.outline('ink'); return (plantC = B.toCanvas());
  }
  function bowl() {
    if (bowlC) return bowlC;
    const B = new Buf(Math.round(18 * K), Math.round(12 * K));
    B.rectS(1, 6, 14, 2, 'pink'); B.rectS(2, 8, 12, 2, 'pink'); B.rectS(3, 10, 10, 1, 'rug');
    B.ellipseS(8, 5, 7, 2.5, 'cream'); B.ellipseS(8, 5, 5, 1.6, 'orangeDark');
    B.outline('ink'); return (bowlC = B.toCanvas());
  }

  window.Sprites = { PAL, Buf, fillEllipse, shadow, cat, plant, bowl, heart, bubble, zed };
})();
