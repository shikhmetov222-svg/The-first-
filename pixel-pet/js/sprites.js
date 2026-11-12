// Палитра (16 цветов на всю сцену) и процедурные спрайты.
(function () {
  const PAL = {
    ink: '#2a2033', wall: '#e6cfa6', wallShade: '#d9bf93', wood: '#6e4230',
    floor: '#b8794b', floorShade: '#a56a40', rug: '#c44e52', rugDark: '#8e3548',
    sky: '#86cfe6', skyLight: '#d3f1f8', cream: '#fff3dc',
    orange: '#e8923c', orangeLight: '#f8c987', orangeDark: '#b35d2a',
    pink: '#f29ab0', green: '#5aa469'
  };
  const NAMES = Object.keys(PAL);
  const IDX = {};
  NAMES.forEach((n, i) => (IDX[n] = i + 1)); // 0 = пусто

  // Буфер пикселей с индексами палитры + автоматический тёмный контур.
  function Buf(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h); }
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

  // ---- Кот (сидит, анфас, пропорции «чиби»: большая голова, маленькое тело) ----
  const catCache = {};
  function cat(o) {
    const key = (o.breath ? 1 : 0) + '|' + (o.blink ? 1 : 0) + '|' + o.tail;
    if (catCache[key]) return catCache[key];
    const B = new Buf(44, 44), hb = o.breath ? 1 : 0;
    // тонкий хвост (2×2), загибается вверх, кончик светлый и качается
    const pts = [[26, 37], [28, 37], [30, 36], [31, 34], [32, 32], [32, 30], [31, 28], [30, 27]];
    pts.forEach((p, i) => {
      const dx = Math.round(o.tail * (i >= 3 ? (i - 2) / 5 : 0));
      B.rect(p[0] + dx, p[1], 2, 2, i >= 6 ? 'orangeLight' : 'orange');
    });
    // маленькое тело
    B.ellipse(20, 32, 6.5, 7, 'orange');
    B.ellipse(14, 36, 3, 3.5, 'orange'); B.ellipse(26, 36, 3, 3.5, 'orange');
    B.ellipse(20, 34, 3.5, 4, 'orangeLight');
    B.rect(16, 34, 3, 6, 'orange'); B.rect(21, 34, 3, 6, 'orange');
    B.rect(16, 38, 3, 2, 'orangeLight'); B.rect(21, 38, 3, 2, 'orangeLight');
    B.rect(14, 30, 2, 1, 'orangeDark'); B.rect(24, 30, 2, 1, 'orangeDark');
    // острые ушки
    [[10, 11], [10, 12], [10, 13], [10, 14], [10, 15], [10, 16], [10, 17]].forEach((r, i) => {
      const y = 3 + i + hb;
      B.rect(r[0], y, r[1] - r[0] + 1, 1, 'orange');
      B.rect(39 - r[1], y, r[1] - r[0] + 1, 1, 'orange');
    });
    [[5, 11, 11], [6, 11, 12], [7, 11, 13], [8, 11, 13]].forEach(e => {
      B.rect(e[1], e[0] + hb, e[2] - e[1] + 1, 1, 'pink');
      B.rect(39 - e[2], e[0] + hb, e[2] - e[1] + 1, 1, 'pink');
    });
    // широкая голова
    B.ellipse(20, 17 + hb, 11, 7.5, 'orange');
    B.rect(19, 10 + hb, 2, 2, 'orangeDark'); B.rect(16, 11 + hb, 2, 1, 'orangeDark'); B.rect(22, 11 + hb, 2, 1, 'orangeDark');
    B.ellipse(20, 21.5 + hb, 3.5, 2.5, 'orangeLight');
    // большие глаза с бликами
    [13, 25].forEach(x => {
      if (o.blink) B.rect(x, 18 + hb, 3, 1, 'ink');
      else { B.rect(x, 16 + hb, 3, 4, 'ink'); B.set(x, 16 + hb, 'cream'); B.set(x + 2, 19 + hb, 'cream'); }
    });
    B.rect(11, 20 + hb, 2, 1, 'pink'); B.rect(27, 20 + hb, 2, 1, 'pink'); // румянец
    B.rect(19, 20 + hb, 2, 1, 'pink');                                      // носик
    B.set(18, 21 + hb, 'ink'); B.set(21, 21 + hb, 'ink');                   // ротик «w»
    B.set(19, 22 + hb, 'ink'); B.set(20, 22 + hb, 'ink');
    B.outline('ink');
    return (catCache[key] = B.toCanvas());
  }

  // ---- Предметы комнаты ----
  let plantC, bowlC;
  function plant() {
    if (plantC) return plantC;
    const B = new Buf(16, 20);
    B.ellipse(4.5, 9, 3, 5, 'green'); B.ellipse(11.5, 8, 3, 6, 'green'); B.ellipse(8, 5, 3, 5, 'green'); B.rect(5, 7, 6, 6, 'green');
    B.rect(3, 13, 10, 7, 'orangeDark'); B.rect(2, 12, 12, 2, 'orange'); B.rect(4, 15, 1, 3, 'orange');
    B.outline('ink'); return (plantC = B.toCanvas());
  }
  function bowl() {
    if (bowlC) return bowlC;
    const B = new Buf(18, 12);
    B.rect(1, 6, 14, 2, 'pink'); B.rect(2, 8, 12, 2, 'pink'); B.rect(3, 10, 10, 1, 'rug');
    B.ellipse(8, 5, 7, 2.5, 'cream'); B.ellipse(8, 5, 5, 1.6, 'orangeDark');
    B.outline('ink'); return (bowlC = B.toCanvas());
  }

  window.Sprites = { PAL, Buf, fillEllipse, shadow, cat, plant, bowl };
})();
