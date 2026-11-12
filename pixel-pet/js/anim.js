// Анимация кота. Кадры берутся из PNG-набора, движение, значки и «Zzz» — кодом.
// Время — только от requestAnimationFrame (метка t в миллисекундах), без setInterval.
(function () {
  const S = window.Sprites, FW = S.FW, FH = S.FH;
  // Кадр = [имя файла кадра, запасной кадр из набора | null]. Пока файла нет, показывается запасной кадр
  // (null — ничего не показывать). Положил PNG с нужным именем в набор → анимация подхватит его сама.
  const ANIMS = {
    idle:  { ms: 500, loop: true,  frames: [['sit', 'sit'], ['idle_2', 'sit']] },
    tail:  { ms: 250, loop: true,  frames: [['sit', 'sit'], ['tail_1', 'sit'], ['tail_2', 'sit']] },
    blink: { ms: 120, loop: false, frames: [['blink_1', null], ['blink_2', null]] },
    eat:   { ms: 300, loop: false, frames: [['eat_1', 'hungry'], ['eat_2', 'sit'], ['eat_3', 'hungry'], ['eat_4', 'sit']] },
    sleep: { ms: 700, loop: true,  frames: [['sleep', 'sleep'], ['sleep_2', 'sleep']] },
    play:  { ms: 0,   loop: true,  frames: [['play_1', 'play'], ['play_2', 'happy'], ['play_3', 'play']] },   // кадры меняются по высоте прыжка
    sad:   { ms: 600, loop: true,  frames: [['sad', 'sad'], ['sad_2', 'sad']] },
    angry: { ms: 80,  loop: true,  frames: [['angry', 'angry'], ['angry_2', 'angry']] },
    hungry: { ms: 1e9, loop: true, frames: [['hungry', 'hungry']] },
    sick:   { ms: 1e9, loop: true, frames: [['sick', 'sick']] },
    groom:  { ms: 1e9, loop: true, frames: [['groom', 'groom']] },
    happy:  { ms: 1e9, loop: true, frames: [['happy', 'happy']] }
  };
  const SPEED = 16;               // px/с при ходьбе
  const JUMP_MS = 1000, JUMP_H = 16;
  // знак «!» рисуется кодом
  const EXCL = ['##', '##', '##', '##', '..', '##'];

  // какие кадры нужны и каких нет (для страницы проверки)
  function framesReport(coats) {
    const out = {};
    Object.keys(ANIMS).forEach(function (a) {
      ANIMS[a].frames.forEach(function (f) {
        if (S.D.poses.indexOf(f[0]) >= 0 || out[f[0]]) return;
        const have = coats.filter(function (c) { return S.has(c, f[0]); });
        out[f[0]] = { anim: a, fallback: f[1], have: have, missing: coats.filter(function (c) { return have.indexOf(c) < 0; }) };
      });
    });
    return out;
  }

  // ---- кот ----
  function Actor(coat, x, floorY) {
    this.coat = coat; this.x = x; this.floorY = floorY; this.facing = 1;      // 1: кот смотрит влево, как в наборе; -1: отражён
    this.anim = 'idle'; this.t0 = 0; this.target = null; this.parts = [];
    this.nextBlink = null; this.blinkAt = -1e9; this.lastT = null; this.spawnAt = {}; this.once = null;
  }
  Actor.prototype.set = function (anim, t) {
    if (this.anim === anim) return;
    this.anim = anim; this.t0 = t; this.once = null;                           // сразу переходим к нужной анимации
  };
  Actor.prototype.restart = function (t) { this.t0 = t; this.once = null; };
  Actor.prototype.blinkNow = function (t) { this.blinkAt = t; };
  Actor.prototype.moving = function () { return this.target !== null && Math.abs(this.x - this.target) > 0.5; };

  // кадр по времени
  function pick(coat, def, i) {
    const f = def.frames[i % def.frames.length];
    if (S.has(coat, f[0])) return { id: f[0], real: true };
    return f[1] ? { id: f[1], real: false } : null;
  }

  // детали-значки, поднимающиеся и тающие (координаты комнаты)
  Actor.prototype.spawn = function (type, x, y, t, extra) {
    this.parts.push(Object.assign({ type: type, x: x, y: y, born: t }, extra || {}));
  };
  Actor.prototype.hearts = function (t) {                                       // сердечки над головой
    const p = S.part(this.coat, 'heart'), ox = this.frameX(), oy = this.frameY();
    for (let i = 0; i < 3; i++) this.spawn('heart', ox + this.mx(p ? p.x : 44, p ? p.w : 7) + (i - 1) * 5, oy + (p ? p.y : 12) + i * 2, t + i * 260, { life: 1100, rise: 14 });
  };
  Actor.prototype.frameX = function () { return Math.round(this.x - FW / 2); };
  Actor.prototype.frameY = function () { return this.floorY + 2 - FH; };
  Actor.prototype.mx = function (x, w) { return this.facing < 0 ? FW - x - w : x; };   // координата детали с учётом отражения

  Actor.prototype.draw = function (ctx, t) {
    const dt = this.lastT === null ? 0 : Math.min(t - this.lastT, 100); this.lastT = t;
    // ходьба
    let walking = false;
    if (this.target !== null && this.anim !== 'sleep') {
      const d = this.target - this.x;
      if (Math.abs(d) > 0.5) { const step = Math.sign(d) * Math.min(Math.abs(d), SPEED * dt / 1000); this.x += step; this.facing = d > 0 ? -1 : 1; walking = true; }
    }
    const A = ANIMS[this.anim] || ANIMS.idle;
    const base = this.anim === 'idle' || this.anim === 'tail' || (walking && (this.anim === 'hungry' || this.anim === 'happy'));
    const def = walking ? (S.has(this.coat, 'tail_1') ? ANIMS.tail : ANIMS.idle) : A;
    const age = t - this.t0;
    let frame, bob = 0, dx = 0, hop = 0;

    if (this.anim === 'play' && !walking) {                       // прыжок: высота кодом, кадры меняются в воздухе
      const p = (age % JUMP_MS) / JUMP_MS; hop = Math.round(JUMP_H * 4 * p * (1 - p));
      frame = pick(this.coat, A, p < 0.34 ? 0 : p < 0.66 ? 1 : 2);
    } else if (this.anim === 'eat') {
      const i = Math.min(Math.floor(age / A.ms), A.frames.length - 1); frame = pick(this.coat, A, i);
      if (age >= A.ms * A.frames.length && !this.once) { this.once = 'done'; this.hearts(t); }
    } else {
      const i = Math.floor((walking ? t : age) / (walking ? 250 : A.ms));
      frame = pick(this.coat, def, i % def.frames.length);
    }
    if (base || walking) bob = Math.floor((walking ? t / 150 : age / 500)) % 2;      // покачивание на 1 пиксель
    if (this.anim === 'sleep') bob = Math.floor(age / 700) % 2;
    if (this.anim === 'angry') dx = A.frames[1] && S.has(this.coat, A.frames[1][0]) ? 0 : (Math.floor(age / 80) % 2 ? 1 : -1);   // тряска, если нет второго кадра

    // моргание (только в покое): 2 кадра по 120 мс раз в 3–5 с
    if (base && !walking) {
      if (this.nextBlink === null) this.nextBlink = t + 3000 + Math.random() * 2000;
      if (t >= this.nextBlink) { this.blinkAt = t; this.nextBlink = t + 3000 + Math.random() * 2000; }
      const bi = Math.floor((t - this.blinkAt) / 120);
      if (bi >= 0 && bi < 2) { const b = pick(this.coat, ANIMS.blink, bi); if (b && b.real) frame = b; }
    }

    // тень на полу и кот
    const flip = this.facing < 0, fx = this.frameX() + dx, fy = this.frameY() + bob - hop;
    S.shadow(ctx, Math.round(this.x), this.floorY + 2, this.anim === 'sleep' ? 24 : 20 - Math.round(hop / 4), 4);
    if (frame) S.drawFrame(ctx, this.coat, frame.id, fx, fy, flip);

    // значки кодом
    const T = t, ox = this.frameX(), oy = this.frameY();
    const every = (key, ms, fn) => { if (T - (this.spawnAt[key] || -1e9) >= ms) { this.spawnAt[key] = T; fn(); } };
    if (this.anim === 'sleep') every('zzz', 1100, () => {
      const i = this.zi = ((this.zi || 0) + 1) % 2, z = S.part(this.coat, 'zzz' + i);
      if (z) this.spawn('zzz' + i, ox + this.mx(z.x, z.w), oy + z.y, T, { life: 2200, rise: 20, drift: this.facing * -5 });
    });
    if (this.anim === 'sad') every('drop', 650, () => {
      const info = S.info(this.coat), top = info.top || 13, t2 = info.tears && info.tears.length === 2 ? info.tears : [[20, top + 22], [33, top + 22]];
      t2.forEach((p, k) => this.spawn('drop', ox + this.mx(p[0], 1), oy + p[1], T + k * 300, { life: 900, fall: 14 }));
    });
    if (this.anim === 'hungry') every('excl', 1400, () => {
      const info = S.info(this.coat); this.spawn('excl', ox + this.mx(46, 6), oy + (info.top || 13) - 8, T, { life: 1200, rise: 8 });
    });
    if (this.anim === 'play') every('heart', 1000, () => this.hearts(T));
    this.drawParts(ctx, T);
    // знак злости: появляется кодом
    if (this.anim === 'angry') {
      const m = S.part(this.coat, 'mark');
      if (m && Math.floor(age / 420) % 2 === 0) ctx.drawImage(m.img, ox + this.mx(m.x, m.w) + dx, oy + m.y + bob, m.w, m.h);
    }
  };

  Actor.prototype.drawParts = function (ctx, t) {
    const self = this; this.parts = this.parts.filter(function (p) { return t - p.born < p.life; });
    this.parts.forEach(function (p) {
      const age = t - p.born; if (age < 0) return;
      const k = age / p.life, alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      let x = p.x + (p.drift || 0) * k, y = p.y - (p.rise || 0) * k + (p.fall || 0) * k * k;
      x = Math.round(x); y = Math.round(y);
      ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
      if (p.type === 'heart') { const h = S.part(self.coat, 'heart'); if (h) ctx.drawImage(h.img, x, y, h.w, h.h); else { ctx.fillStyle = '#dd5e5c'; ctx.fillRect(x, y, 5, 4); } }
      else if (p.type.indexOf('zzz') === 0) { const z = S.part(self.coat, p.type); if (z) ctx.drawImage(z.img, x, y, z.w, z.h); }
      else if (p.type === 'drop') { ctx.fillStyle = '#96c3eb'; ctx.fillRect(x, y, 2, 3); ctx.fillStyle = '#d6ecff'; ctx.fillRect(x, y, 1, 1); }
      else if (p.type === 'excl') { ctx.fillStyle = '#c8502f'; EXCL.forEach(function (row, j) { row.split('').forEach(function (ch, i) { if (ch === '#') ctx.fillRect(x + i * 2, y + j * 2, 2, 2); }); }); }
      ctx.restore();
    });
  };

  window.Anim = { ANIMS, Actor, framesReport, SPEED, JUMP_MS, JUMP_H };
})();
