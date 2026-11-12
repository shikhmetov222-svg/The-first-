// Питомец: данные (отдельным объектом — их потом можно хранить на сервере),
// потребности, действия, анимации и эффекты.
(function () {
  const HOUR = 3600e3;
  // изменение параметров в час
  const AWAKE = { food: -8, mood: -6, clean: -4, energy: -5 };
  const SLEEP = { food: -3, mood: -1, clean: -1, energy: 30 };
  const MAX_AWAY = 24 * HOUR;                     // дольше суток вдали не считаем
  const clamp = v => Math.max(0, Math.min(100, v));

  function defaults(now) {
    return Object.assign({ v: 1, type: 'cat', name: 'Мурзик', coins: 20, sleeping: false, sleepFrom: 0,
             stats: { food: 80, mood: 80, clean: 80, energy: 80 }, savedAt: now }, window.Shop.defaults());
  }

  const Pet = {
    data: null, events: [],
    x: 68, y: 74,                                  // левый верхний угол спрайта
    fx: { jumpAt: -1000, parts: [], fade: 0 },

    // ---------- данные ----------
    load(raw, now) {
      const d = defaults(now);
      try {
        const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (o && o.v === 1) {
          ['food', 'mood', 'clean', 'energy'].forEach(k => {
            if (o.stats && isFinite(o.stats[k])) d.stats[k] = clamp(+o.stats[k]);
          });
          if (isFinite(o.coins)) d.coins = Math.max(0, Math.floor(o.coins));
          d.sleeping = !!o.sleeping; d.sleepFrom = isFinite(o.sleepFrom) ? +o.sleepFrom : d.stats.energy;
          if (typeof o.name === 'string') d.name = o.name.slice(0, 20);
          if (isFinite(o.savedAt)) d.savedAt = Math.min(+o.savedAt, now);
          if (Array.isArray(o.owned)) d.owned = o.owned;
          if (o.room && typeof o.room === 'object') d.room = o.room;
        }
      } catch (e) {}
      window.Shop.sanitize(d);
      this.data = d;
      const away = Math.min(now - d.savedAt, MAX_AWAY);
      if (away > 60e3) this.advance(away, true);  // время, пока приложение было закрыто
      d.savedAt = now;
      return this;
    },
    serialize(now) { this.data.savedAt = now; return JSON.stringify(this.data); },

    // ---------- время ----------
    advance(ms, offline) {
      const d = this.data, s = d.stats;
      let h = ms / HOUR;
      const apply = (rate, t) => { for (const k in rate) s[k] = clamp(s[k] + rate[k] * t); };
      if (d.sleeping) {
        const need = (100 - s.energy) / SLEEP.energy, t = Math.min(h, need);
        apply(SLEEP, t); h -= t;
        if (s.energy >= 99.99) this.wake(offline ? 'Пока тебя не было, ' + d.name + ' выспался' : 'Выспался');
      }
      if (!d.sleeping && h > 0) apply(AWAKE, h);
    },
    wake(msg) {
      const d = this.data, gain = Math.floor((d.stats.energy - d.sleepFrom) / 10);
      d.sleeping = false; d.coins += gain;
      this.events.push({ msg: (msg || 'Проснулся') + (gain > 0 ? ' · +' + gain + ' 🪙' : ''), kind: 'ok' });
    },

    // ---------- состояние ----------
    // sleep | sick | hungry | cry | angry | ok  (по важности)
    state() {
      const d = this.data, s = d.stats;
      if (d.sleeping) return 'sleep';
      if (s.clean < 15) return 'sick';
      if (s.food < 25) return 'hungry';
      if (s.mood < 25) return 'cry';
      if (s.energy < 15) return 'angry';
      return 'ok';
    },
    status() {
      const n = this.data.name;
      return { sleep: n + ' спит 💤', sick: n + ' заболел — помой его 🤒', hungry: n + ' голодный — покорми 🍖',
               cry: n + ' плачет — поиграй с ним 😿', angry: n + ' злится от усталости — уложи спать 😾',
               ok: n + ': всё хорошо' }[this.state()];
    },

    // ---------- действия ----------
    act(name, now) {
      const d = this.data, s = d.stats, T = performance.now();
      const fail = msg => ({ ok: false, msg });
      if (name === 'sleep') {
        if (d.sleeping) { this.wake('Проснулся'); return { ok: true, msg: this.events.pop().msg }; }
        if (s.energy >= 95) return fail(d.name + ' не хочет спать');
        d.sleeping = true; d.sleepFrom = s.energy;
        return { ok: true, msg: d.name + ' засыпает… 🌙' };
      }
      if (d.sleeping) return fail('Он спит. Нажми «Будить»');
      let coins = 0, msg = '';
      if (name === 'feed') {
        if (s.food >= 95) return fail(d.name + ' сыт');
        coins = 2; s.food = clamp(s.food + 30); s.clean = clamp(s.clean - 3); msg = 'Ням-ням! 🍖';
        for (let i = 0; i < 6; i++) this.fx.parts.push({ type: 'crumb', x: 158 + Math.random() * 14, y: 100 + Math.random() * 6, vx: 0, vy: 0.04, t0: T + i * 70, life: 480 });
      } else if (name === 'play') {
        if (s.energy < 10) return fail('Он слишком устал. Пусть поспит');
        coins = 3; s.mood = clamp(s.mood + 25); s.energy = clamp(s.energy - 12);
        s.food = clamp(s.food - 6); s.clean = clamp(s.clean - 4); msg = 'Весёлая игра! 🎾';
        this.fx.jumpAt = T;
        for (let i = 0; i < 4; i++) this.fx.parts.push({ type: 'heart', x: this.x + 12 + i * 8, y: this.y + 2, vx: 0, vy: -0.02, t0: T + i * 180, life: 900 });
      } else if (name === 'wash') {
        if (s.clean >= 95) return fail(d.name + ' уже чистый');
        coins = 2; s.clean = clamp(s.clean + 40); s.mood = clamp(s.mood - 2); msg = 'Чистый и пушистый! 🫧';
        for (let i = 0; i < 9; i++) this.fx.parts.push({ type: 'bubble', x: this.x + 6 + Math.random() * 34, y: this.y + 20 + Math.random() * 26, vx: 0, vy: -0.015, t0: T + i * 90, life: 800 });
      } else return fail('Неизвестное действие');
      d.coins += coins;
      return { ok: true, msg: msg + ' · +' + coins + ' 🪙' };
    },

    // ---------- анимации ----------
    anim(t) {
      const st = this.state(), breath = Math.floor(t / 1200) % 2;
      if (st !== 'ok') return { st, breath };              // позы с картинок: сидит, плачет, спит…
      return { st, head: breath, eyes: (t % 3600) > 3400 ? 'closed' : 'open', tail: Math.round(Math.sin(t / 450) * 2) };
    },
    // положение позы: по центру, лапы на полу
    poseBox(name) {
      const img = window.Sprites.pose(name);
      return { img, x: Math.round(94 - img.width / 2), y: 124 - img.height };
    },
    draw(ctx, t) {
      const a = this.anim(t), f = this.fx, S = window.Sprites;
      if (a.st !== 'ok') {
        const name = a.st === 'cry' ? 'cry' : a.st, bx = this.poseBox(name);
        S.shadow(ctx, 94, 125, bx.img.width / 2, 4.5);
        ctx.drawImage(bx.img, bx.x, bx.y + (a.breath ? 1 : 0));
        return;
      }
      // прыжок при игре: два подскока
      const jp = (t - f.jumpAt) / 900;
      const hop = jp >= 0 && jp < 1 ? Math.round(Math.abs(Math.sin(jp * Math.PI * 2)) * 10) : 0;
      S.shadow(ctx, this.x + 26, this.y + 51, 22 - hop * 0.6, 5 - hop * 0.2);
      ctx.drawImage(S.cat(a), this.x, this.y - hop);
    },
    drawFx(ctx, t) {
      const S = window.Sprites, f = this.fx;
      f.parts = f.parts.filter(p => t - p.t0 < p.life);
      f.parts.forEach(p => {
        const age = t - p.t0; if (age < 0) return;
        const x = Math.round(p.x + p.vx * age), y = Math.round(p.y + p.vy * age);
        if (p.type === 'crumb') { ctx.fillStyle = S.PAL.orangeDark; ctx.fillRect(x, y, 2, 2); }
        else ctx.drawImage(p.type === 'heart' ? S.heart() : S.bubble(), x, y);
      });
      // значки состояния рядом с котом (позы берутся с картинок, значки рисуются поверх)
      const st = this.state(), bob = Math.floor(t / 400) % 2;
      if (st === 'hungry' || st === 'sick' || st === 'angry') {
        const bx = this.poseBox(st), X = bx.x, Y = bx.y;
        if (st === 'hungry') { ctx.drawImage(S.excl(), X + 40, Y + 4 - bob); ctx.drawImage(S.excl(), X + 49, Y + 10 + bob); }
        if (st === 'sick') ctx.drawImage(S.swirl(), X + 2, Y - 14 + bob);
        if (st === 'angry' && Math.floor(t / 450) % 2 === 0) ctx.drawImage(S.anger(), X + 28, Y - 12);
      }
    },
    // затемнение и Zzz для сна
    drawSleep(ctx, t, W, H) {
      const f = this.fx, target = this.data.sleeping ? 1 : 0;
      f.fade += (target - f.fade) * 0.06;
      if (f.fade < 0.01) return;
      ctx.fillStyle = 'rgba(14,10,46,' + (0.5 * f.fade).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
      if (!this.data.sleeping) return;
      const S = window.Sprites, ph = (t / 1400) % 1, bx = 84, by = 72;
      [[0, 1], [0.33, 2], [0.66, 2]].forEach(([off, k], i) => {
        const p = (ph + off) % 1;
        S.zed(ctx, Math.round(bx + i * 6 + p * 6), Math.round(by - p * 22 - i * 2), k);
      });
    }
  };
  window.Pet = Pet;
})();
