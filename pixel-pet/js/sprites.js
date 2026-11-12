// Загрузка картинок игры: пустая комната, предметы и коты. Всё нарисовано заранее (assets/game/), кодом ничего не рисуется.
// У каждого окраса: спрайтлист из 9 поз (sit, happy, sad, sleep, hungry, sick, angry, play, groom) и необязательные
// дополнительные кадры анимаций (idle_2, blink_1, … — см. GameData.extra_names). Значки «Zzz», сердечко и знак злости
// вынуты из кадров в отдельные детали (GameData.parts), чтобы ими управлял код.
(function () {
  const D = window.GameData, cache = {}, loaded = {};
  function img(src) {
    if (!cache[src]) {
      cache[src] = new Promise(function (ok, fail) {
        const im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { fail(new Error('Не загрузилось: ' + src.slice(0, 60))); }; im.src = src;
      });
    }
    return cache[src];
  }
  function load(key, src) { return img(src).then(function (im) { loaded[key] = im; return im; }); }
  const FW = D.frame_w, FH = D.frame_h;

  const Sprites = {
    D, FW, FH,
    loadRoom() { return load('room', 'assets/game/room.png'); },
    loadItem(id) { return load('item:' + id, 'assets/game/items/' + id + '.png'); },
    // всё для одного окраса: спрайтлист, дополнительные кадры, детали (значки)
    loadCoat(c) {
      const jobs = [load('coat:' + c, 'assets/game/cats/' + c + '.png')];
      (D.extra[c] || []).forEach(function (n) { jobs.push(load('f:' + c + ':' + n, 'assets/game/cats/' + c + '/' + n + '.png')); });
      const p = D.parts[c] || {};
      [['heart', p.heart], ['mark', p.mark]].forEach(function (a) { if (a[1]) jobs.push(load('part:' + c + ':' + a[0], a[1].src)); });
      (p.zzz || []).forEach(function (z, i) { jobs.push(load('part:' + c + ':zzz' + i, z.src)); });
      return Promise.all(jobs);
    },
    room() { return loaded.room; },
    item(id) { return loaded['item:' + id]; },
    coat(c) { return loaded['coat:' + c]; },
    poseIndex(pose) { return D.poses.indexOf(pose); },
    // есть ли такой кадр: позы — всегда, остальные — только если файл положили в набор
    has(c, id) { return D.poses.indexOf(id) >= 0 || (D.extra[c] || []).indexOf(id) >= 0; },
    // нарисовать кадр (id) с левым верхним углом (x, y); flip — отражение по горизонтали вокруг центра кадра
    drawFrame(ctx, c, id, x, y, flip) {
      let im, sx = 0;
      if (D.poses.indexOf(id) >= 0) { im = loaded['coat:' + c]; sx = D.poses.indexOf(id) * FW; } else im = loaded['f:' + c + ':' + id];
      if (!im) return;
      if (flip) { ctx.save(); ctx.translate(x + FW, y); ctx.scale(-1, 1); ctx.drawImage(im, sx, 0, FW, FH, 0, 0, FW, FH); ctx.restore(); }
      else ctx.drawImage(im, sx, 0, FW, FH, x, y, FW, FH);
    },
    // деталь-значок: 'heart' | 'mark' | 'zzz0' | 'zzz1' → { img, x, y, w, h } (координаты внутри кадра)
    part(c, name) {
      const p = D.parts[c] || {}, src = name.indexOf('zzz') === 0 ? (p.zzz || [])[+name.slice(3)] : p[name];
      const im = loaded['part:' + c + ':' + name];
      return src && im ? { img: im, x: src.x, y: src.y, w: src.w, h: src.h } : null;
    },
    info(c) { return D.parts[c] || {}; },
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
