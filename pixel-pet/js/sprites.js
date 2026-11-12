// Загрузка картинок игры: пустая комната, предметы и коты (спрайтлист из 9 кадров на окрас).
// Всё нарисовано заранее (assets/game/), кодом ничего не рисуется.
(function () {
  const D = window.GameData, cache = {};
  function img(src) {
    if (!cache[src]) {
      cache[src] = new Promise(function (ok, fail) {
        const im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { fail(new Error('Не загрузилось: ' + src)); }; im.src = src;
      });
    }
    return cache[src];
  }
  const loaded = {};                                   // готовые Image по ключу
  function load(key, src) { return img(src).then(function (im) { loaded[key] = im; return im; }); }

  const Sprites = {
    D,
    loadRoom() { return load('room', 'assets/game/room.png'); },
    loadItem(id) { return load('item:' + id, 'assets/game/items/' + id + '.png'); },
    loadCoat(c) { return load('coat:' + c, 'assets/game/cats/' + c + '.png'); },
    room() { return loaded.room; },
    item(id) { return loaded['item:' + id]; },
    coat(c) { return loaded['coat:' + c]; },
    poseIndex(pose) { return D.poses.indexOf(pose); },
    // кадр кота: pose ∈ D.poses
    drawCat(ctx, coat, pose, x, y) {
      const sh = loaded['coat:' + coat]; if (!sh) return;
      ctx.drawImage(sh, Sprites.poseIndex(pose) * D.frame_w, 0, D.frame_w, D.frame_h, x, y, D.frame_w, D.frame_h);
    },
    // мягкая тень под котом (полупрозрачный эллипс из целых пикселей)
    shadow(ctx, cx, cy, rx, ry) {
      ctx.fillStyle = 'rgba(70,40,25,0.28)';
      for (let y = -ry; y <= ry; y++) {
        const w = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
        ctx.fillRect(cx - w, cy + y, w * 2, 1);
      }
    }
  };
  window.Sprites = Sprites;
})();
