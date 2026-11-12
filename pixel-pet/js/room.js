// Комната 160×120: стена с окном, полка, картина, пол, ковёр, миска.
(function () {
  const W = 160, H = 120, FLOOR = 78;
  const S = () => window.Sprites;

  function draw(ctx, t) {
    const P = S().PAL;
    const r = (x, y, w, h, c) => { ctx.fillStyle = P[c]; ctx.fillRect(x, y, w, h); };
    const box = (x, y, w, h, c) => { r(x, y, w, h, 'ink'); r(x + 1, y + 1, w - 2, h - 2, c); };

    // стена в полоску + плинтус
    r(0, 0, W, FLOOR, 'wall');
    for (let x = 4; x < W; x += 12) r(x, 0, 3, 73, 'wallShade');
    r(0, 73, W, 5, 'wood'); r(0, 73, W, 1, 'ink');

    // пол: доски со стыками вразбежку
    r(0, FLOOR, W, H - FLOOR, 'floor');
    [86, 95, 105, 116].forEach((y, row) => {
      r(0, y, W, 1, 'floorShade');
      const prev = row === 0 ? FLOOR : [86, 95, 105, 116][row - 1];
      for (let x = (row % 2) * 20 + 14; x < W; x += 40) r(x, prev + 1, 1, y - prev - 1, 'floorShade');
    });

    // окно
    r(96, 13, 36, 40, 'ink'); r(97, 14, 34, 38, 'cream'); r(100, 17, 28, 32, 'sky');
    ctx.save(); ctx.beginPath(); ctx.rect(100, 17, 28, 32); ctx.clip();
    const cx = Math.floor(((t / 450) % 48)) + 78;
    r(cx, 24, 12, 3, 'skyLight'); r(cx + 2, 22, 7, 2, 'skyLight');
    r(cx + 20, 38, 9, 2, 'skyLight'); r(cx + 22, 36, 5, 2, 'skyLight');
    ctx.restore();
    r(113, 17, 2, 32, 'cream'); r(100, 31, 28, 2, 'cream');
    r(94, 52, 40, 3, 'cream'); r(94, 55, 40, 1, 'ink');
    r(88, 12, 52, 2, 'wood');
    r(90, 14, 9, 40, 'pink'); r(94, 14, 1, 40, 'rug');
    r(129, 14, 9, 40, 'pink'); r(133, 14, 1, 40, 'rug');

    // картина
    box(59, 16, 22, 18, 'cream'); r(62, 19, 16, 12, 'sky'); r(62, 26, 16, 5, 'green'); r(70, 21, 3, 3, 'orange');

    // полка с книгами и цветком
    box(12, 27, 5, 11, 'rug'); box(17, 29, 4, 9, 'green'); box(21, 26, 5, 12, 'sky');
    ctx.drawImage(S().plant(), 34, 18);
    r(8, 38, 46, 3, 'wood'); r(8, 41, 46, 1, 'ink'); r(8, 38, 46, 1, 'ink');
    r(12, 42, 2, 5, 'wood'); r(48, 42, 2, 5, 'wood');

    // ковёр
    const f = S().fillEllipse;
    f(ctx, 80, 102, 47, 13, 'ink'); f(ctx, 80, 102, 45, 11, 'rugDark');
    f(ctx, 80, 102, 40, 8, 'rug'); f(ctx, 80, 102, 30, 5, 'rugDark'); f(ctx, 80, 102, 28, 4, 'rug');

    // миска
    S().shadow(ctx, 138, 109, 11, 2.5);
    ctx.drawImage(S().bowl(), 129, 98);
  }

  window.Room = { W, H, draw };
})();
