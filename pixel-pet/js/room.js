// Комната 192×144: стена с окном, полка, картина, пол, ковёр, миска.
// Мебель нарисована в масштабе K = 1.2 относительно прежней сетки 160×120,
// чтобы её пропорции к коту и комнате остались прежними.
(function () {
  const W = 192, H = 144, FLOOR = 94, K = 1.2;
  const S = () => window.Sprites;

  function draw(ctx, t) {
    const P = S().PAL;
    const r = (x, y, w, h, c) => { ctx.fillStyle = P[c]; ctx.fillRect(x, y, w, h); };
    // мебель: координаты в прежней сетке, края округляются при масштабе K
    const F = (x, y, w, h, c) => {
      const x0 = Math.round(x * K), y0 = Math.round(y * K);
      r(x0, y0, Math.round((x + w) * K) - x0, Math.round((y + h) * K) - y0, c);
    };
    const box = (x, y, w, h, c) => { F(x, y, w, h, 'ink'); F(x + 1, y + 1, w - 2, h - 2, c); };

    // стена в полоску + плинтус (полного размера)
    r(0, 0, W, FLOOR, 'wall');
    for (let x = 4; x < W; x += 12) r(x, 0, 3, FLOOR - 5, 'wallShade');
    r(0, FLOOR - 5, W, 5, 'wood'); r(0, FLOOR - 5, W, 1, 'ink');

    // пол: доски со стыками вразбежку
    r(0, FLOOR, W, H - FLOOR, 'floor');
    const ROWS = [102, 111, 121, 132, 143];
    ROWS.forEach((y, row) => {
      r(0, y, W, 1, 'floorShade');
      const prev = row === 0 ? FLOOR : ROWS[row - 1];
      for (let x = (row % 2) * 20 + 14; x < W; x += 40) r(x, prev + 1, 1, y - prev - 1, 'floorShade');
    });

    // окно (координаты уже со сдвигом +16, +8 прежней раскладки)
    F(112, 21, 36, 40, 'ink'); F(113, 22, 34, 38, 'cream'); F(116, 25, 28, 32, 'sky');
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(116 * K), Math.round(25 * K), Math.round(28 * K), Math.round(32 * K));
    ctx.clip();
    const cx = Math.floor((t / 450) % 48) + 78 + 16;               // облако плывёт внутри окна
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

    // полка с книгами и цветком
    box(28, 35, 5, 11, 'rug'); box(33, 37, 4, 9, 'green'); box(37, 34, 5, 12, 'sky');
    ctx.drawImage(S().plant(), Math.round(50 * K), Math.round(26 * K));
    F(24, 46, 46, 3, 'wood'); F(24, 49, 46, 1, 'ink'); F(24, 46, 46, 1, 'ink');
    F(28, 50, 2, 5, 'wood'); F(64, 50, 2, 5, 'wood');

    // ковёр
    const f = S().fillEllipse;
    f(ctx, 96, 122, 54, 14, 'ink'); f(ctx, 96, 122, 52, 12, 'rugDark');
    f(ctx, 96, 122, 47, 9, 'rug'); f(ctx, 96, 122, 36, 6, 'rugDark'); f(ctx, 96, 122, 34, 5, 'rug');

    // миска (спрайт уже в масштабе K)
    S().shadow(ctx, 166, 128, 11, 2.5);
    ctx.drawImage(S().bowl(), 155, 116);
  }

  window.Room = { W, H, draw };
})();
