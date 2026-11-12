// Комната 192×144: стена с окном, полка, картина, пол, ковёр, миска и предметы интерьера.
// Окно, полка, картина нарисованы в масштабе K = 1.2 относительно прежней сетки 160×120.
(function () {
  const W = 192, H = 144, FLOOR = 94, K = 1.2;
  const S = () => window.Sprites;

  function draw(ctx, t, cfg) {
    const P = S().PAL, SH = window.Shop, R = (cfg || SH.defaults().room);
    const wall = SH.byId[R.wall], floor = SH.byId[R.floor], rug = SH.byId[R.rug];
    const col = c => P[c] || c;
    const r = (x, y, w, h, c) => { ctx.fillStyle = col(c); ctx.fillRect(x, y, w, h); };
    const F = (x, y, w, h, c) => {
      const x0 = Math.round(x * K), y0 = Math.round(y * K);
      r(x0, y0, Math.round((x + w) * K) - x0, Math.round((y + h) * K) - y0, c);
    };
    const box = (x, y, w, h, c) => { F(x, y, w, h, 'ink'); F(x + 1, y + 1, w - 2, h - 2, c); };

    // стена + плинтус
    r(0, 0, W, FLOOR, wall.c1);
    if (wall.pat === 'stripes') for (let x = 4; x < W; x += 12) r(x, 0, 3, FLOOR - 5, wall.c2);
    else for (let y = 3; y < FLOOR - 5; y += 8) for (let x = ((y / 8) % 2) * 4 + 2; x < W; x += 8) r(x, y, 2, 2, wall.c2);
    r(0, FLOOR - 5, W, 5, 'wood'); r(0, FLOOR - 5, W, 1, 'ink');

    // пол
    r(0, FLOOR, W, H - FLOOR, floor.c1);
    const ROWS = [102, 111, 121, 132, 143];
    ROWS.forEach((y, row) => {
      r(0, y, W, 1, floor.c2);
      const prev = row === 0 ? FLOOR : ROWS[row - 1];
      if (floor.pat === 'tiles') for (let x = 16; x < W; x += 32) r(x, prev + 1, 1, y - prev - 1, floor.c2);
      else for (let x = (row % 2) * 20 + 14; x < W; x += 40) r(x, prev + 1, 1, y - prev - 1, floor.c2);
    });

    // окно
    F(112, 21, 36, 40, 'ink'); F(113, 22, 34, 38, 'cream'); F(116, 25, 28, 32, 'sky');
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(116 * K), Math.round(25 * K), Math.round(28 * K), Math.round(32 * K));
    ctx.clip();
    const cx = Math.floor((t / 450) % 48) + 78 + 16;
    F(cx, 32, 12, 3, 'skyLight'); F(cx + 2, 30, 7, 2, 'skyLight');
    F(cx + 20, 46, 9, 2, 'skyLight'); F(cx + 22, 44, 5, 2, 'skyLight');
    ctx.restore();
    F(129, 25, 2, 32, 'cream'); F(116, 39, 28, 2, 'cream');
    F(110, 60, 40, 3, 'cream'); F(110, 63, 40, 1, 'ink');
    F(104, 20, 52, 2, 'wood');
    F(106, 22, 9, 40, 'pink'); F(110, 22, 1, 40, 'rug');
    F(145, 22, 9, 40, 'pink'); F(149, 22, 1, 40, 'rug');

    // картина
    box(75, 24, 22, 18, 'cream'); F(78, 27, 16, 12, 'sky'); F(78, 34, 16, 5, 'green'); F(86, 29, 3, 3, 'orange');

    // полка: книги, растение
    box(28, 35, 5, 11, 'rug'); box(33, 37, 4, 9, 'green'); box(37, 34, 5, 12, 'sky');
    F(24, 46, 46, 3, 'wood'); F(24, 49, 46, 1, 'ink'); F(24, 46, 46, 1, 'ink');
    F(28, 50, 2, 5, 'wood'); F(64, 50, 2, 5, 'wood');
    const plant = (id, cxp, bottom) => {
      if (!id) return;
      const img = S().plantImg(SH.byId[id].idx);
      ctx.drawImage(img, Math.round(cxp - img.width / 2), bottom - img.height);
    };
    plant(R.shelf, 76, 55);
    plant(R.sill, 143, 72);

    // ковёр
    if (rug.c1) {
      const f = S().fillEllipse;
      f(ctx, 96, 122, 54, 14, 'ink'); f(ctx, 96, 122, 52, 12, rug.c2);
      f(ctx, 96, 122, 47, 9, rug.c1); f(ctx, 96, 122, 36, 6, rug.c2); f(ctx, 96, 122, 34, 5, rug.c1);
    }

    // мебель у стены
    const furn = (id, x, bottom) => {
      if (!id) return;
      const img = S().itemImg(SH.byId[id].asset);
      S().shadow(ctx, x + img.width / 2, bottom - 1, img.width / 2 - 2, 3);
      ctx.drawImage(img, x, bottom - img.height);
    };
    furn(R.left, 4, 124);
    furn(R.right, 154, 126);

    // миска
    S().shadow(ctx, 139, 128, 11, 2.5);
    ctx.drawImage(S().bowl(), 128, 116);
  }

  window.Room = { W, H, draw };
})();
