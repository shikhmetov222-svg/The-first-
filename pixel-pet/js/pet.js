// Питомец: данные (одним объектом — их потом можно хранить на сервере), потребности, действия и выбор кадра.
(function () {
  const HOUR = 3600e3;
  // изменение параметров в час
  const AWAKE = { food: -8, mood: -6, clean: -4, energy: -5 };
  const SLEEP = { food: -3, mood: -1, clean: -1, energy: 30 };
  const MAX_AWAY = 24 * HOUR;                     // дольше суток вдали не считаем
  const clamp = v => Math.max(0, Math.min(100, v));
  const CX = 192, FEET = 192;                     // где стоит кот в комнате (центр, линия лап)

  function defaults(now) {
    return Object.assign({ v: 2, type: 'cat', name: 'Мурзик', coins: 20, sleeping: false, sleepFrom: 0,
             stats: { food: 80, mood: 80, clean: 80, energy: 80 }, savedAt: now }, window.Shop.defaults());
  }

  const Pet = {
    data: null, events: [],
    fx: { pose: null, until: 0, fade: 0 },        // временная поза после действия, затемнение сна

    // ---------- данные ----------
    load(raw, now) {
      const d = defaults(now);
      try {
        const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (o && (o.v === 1 || o.v === 2)) {
          ['food', 'mood', 'clean', 'energy'].forEach(k => { if (o.stats && isFinite(o.stats[k])) d.stats[k] = clamp(+o.stats[k]); });
          if (isFinite(o.coins)) d.coins = Math.max(0, Math.floor(o.coins));
          d.sleeping = !!o.sleeping; d.sleepFrom = isFinite(o.sleepFrom) ? +o.sleepFrom : d.stats.energy;
          if (typeof o.name === 'string') d.name = o.name.slice(0, 20);
          if (isFinite(o.savedAt)) d.savedAt = Math.min(+o.savedAt, now);
          if (o.v === 2) { if (typeof o.coat === 'string') d.coat = o.coat; if (Array.isArray(o.owned)) d.owned = o.owned; if (Array.isArray(o.placed)) d.placed = o.placed; }
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
    // кадр кота: sit | happy | sad | sleep | hungry | sick | angry | play | groom
    pose(now) {
      const st = this.state();
      if (st === 'sleep') return 'sleep';
      if (this.fx.pose && now < this.fx.until) return this.fx.pose;
      return { sick: 'sick', hungry: 'hungry', cry: 'sad', angry: 'angry', ok: 'sit' }[st];
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
        this.fx.pose = 'happy'; this.fx.until = T + 3000;
      } else if (name === 'play') {
        if (s.energy < 10) return fail('Он слишком устал. Пусть поспит');
        coins = 3; s.mood = clamp(s.mood + 25); s.energy = clamp(s.energy - 12);
        s.food = clamp(s.food - 6); s.clean = clamp(s.clean - 4); msg = 'Весёлая игра! 🧶';
        this.fx.pose = 'play'; this.fx.until = T + 3500;
      } else if (name === 'wash') {
        if (s.clean >= 95) return fail(d.name + ' уже чистый');
        coins = 2; s.clean = clamp(s.clean + 40); s.mood = clamp(s.mood - 2); msg = 'Чистый и пушистый! 🫧';
        this.fx.pose = 'groom'; this.fx.until = T + 3000;
      } else return fail('Неизвестное действие');
      d.coins += coins;
      return { ok: true, msg: msg + ' · +' + coins + ' 🪙' };
    },

    // ---------- рисование ----------
    draw(ctx, t) {
      const S = window.Sprites, d = this.data, T = performance.now();
      const pose = this.pose(T), sleeping = pose === 'sleep';
      const f = this.fx, target = sleeping ? 1 : 0;
      f.fade += (target - f.fade) * 0.06;
      if (f.fade > 0.01) {                                  // ночь: затемняем комнату
        ctx.fillStyle = 'rgba(14,10,46,' + (0.32 * f.fade).toFixed(3) + ')';
        ctx.fillRect(0, 0, window.GameData.w, window.GameData.h);
      }
      const bob = Math.floor(t / 1200) % 2;                 // дыхание: покачивание на 1 пиксель
      S.shadow(ctx, CX, FEET + 2, sleeping ? 24 : 20, 4);
      S.drawCat(ctx, d.coat, pose, CX - window.GameData.frame_w / 2, FEET + 2 - window.GameData.frame_h + bob);
    }
  };
  window.Pet = Pet;
})();
