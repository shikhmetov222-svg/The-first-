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

  // ---- Кот (сидит прямо, как на референсе: вытянутое тело, острые уши, усы, хвост столбиком) ----
  const catCache = {};
  function cat(o) {
    const key = (o.breath ? 1 : 0) + '|' + (o.blink ? 1 : 0) + '|' + o.tail;
    if (catCache[key]) return catCache[key];
    const B = new Buf(44, 46), hb = o.breath ? 1 : 0;
    const mir = x => 39 - x; // зеркало относительно оси головы

    // хвост (3×3 звенья), поднимается вверх; верхняя часть качается
    const pts = [[31, 38], [33, 37], [34, 35], [34, 33], [34, 31], [34, 29], [34, 27], [34, 25], [34, 23]];
    pts.forEach((p, i) => {
      const dx = Math.round(o.tail * (i >= 3 ? (i - 2) / 6 : 0));
      B.rect(p[0] + dx, p[1], 3, 3, i >= 7 || i === 4 || i === 5 ? 'orangeDark' : 'orange');
    });

    // тело: торс, бёдра, грудка
    B.ellipse(20, 31, 8, 9, 'orange');
    B.rect(13, 19, 14, 8, 'orange');
    B.ellipse(27, 35, 5, 6, 'orange'); B.ellipse(13, 37, 3, 4, 'orange');
    B.ellipse(20, 26, 3.5, 5.5, 'orangeLight');
    // передние лапы + тень между ними
    B.rect(16, 30, 3, 11, 'orange'); B.rect(21, 30, 3, 11, 'orange');
    B.rect(19, 33, 2, 8, 'orangeDark');
    B.rect(16, 40, 3, 2, 'orangeLight'); B.rect(21, 40, 3, 2, 'orangeLight');
    // полоски
    [[13, 26], [14, 28], [13, 30], [28, 30], [29, 32], [28, 34], [30, 36], [29, 38]].forEach(p => B.rect(p[0], p[1], 2, 1, 'orangeDark'));
    B.set(16, 34, 'orangeDark'); B.set(17, 36, 'orangeDark'); B.set(22, 35, 'orangeDark'); B.set(23, 37, 'orangeDark');

    // уши
    [[11, 12], [11, 13], [11, 14], [11, 15], [11, 16], [11, 16]].forEach((r, i) => {
      const y = 3 + i + hb, w = r[1] - r[0] + 1;
      B.rect(r[0], y, w, 1, 'orange'); B.rect(mir(r[1]), y, w, 1, 'orange');
    });
    [[5, 12, 12], [6, 12, 13], [7, 12, 14]].forEach(e => {
      const w = e[2] - e[1] + 1;
      B.rect(e[1], e[0] + hb, w, 1, 'pink'); B.rect(mir(e[2]), e[0] + hb, w, 1, 'pink');
    });
    // голова (чуть квадратная)
    B.rect(13, 8 + hb, 14, 1, 'orange');
    B.rect(11, 9 + hb, 18, 9, 'orange');
    B.rect(12, 18 + hb, 16, 1, 'orange'); B.rect(14, 19 + hb, 12, 1, 'orange');
    // лоб и щёки в полоску
    B.rect(19, 9 + hb, 2, 3, 'orangeDark'); B.rect(16, 10 + hb, 1, 2, 'orangeDark'); B.rect(23, 10 + hb, 1, 2, 'orangeDark');
    [[11, 14], [11, 16], [27, 14], [27, 16]].forEach(p => B.rect(p[0], p[1] + hb, 2, 1, 'orangeDark'));
    // светлая мордочка
    [[15, 17, 22], [16, 16, 23], [17, 16, 23], [18, 17, 22]].forEach(m => B.rect(m[1], m[0] + hb, m[2] - m[1] + 1, 1, 'orangeLight'));
    // глаза: 2×3 с бликом
    [14, 24].forEach(x => {
      if (o.blink) B.rect(x, 14 + hb, 2, 1, 'ink');
      else { B.rect(x, 12 + hb, 2, 3, 'ink'); B.set(x + 1, 12 + hb, 'cream'); }
    });
    B.rect(19, 16 + hb, 2, 1, 'pink');                         // нос
    B.set(19, 17 + hb, 'ink'); B.set(20, 17 + hb, 'ink');      // рот

    B.outline('ink');
    // усы — поверх контура
    [[9, 15], [8, 15], [7, 14], [9, 17], [8, 17], [7, 18]].forEach(p => {
      B.set(p[0], p[1] + hb, 'ink'); B.set(mir(p[0]), p[1] + hb, 'ink');
    });
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
