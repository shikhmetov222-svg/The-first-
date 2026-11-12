(function () {
  const $ = id => document.getElementById(id);
  const canvas = $('scene'), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const KEY = 'pixelpet.v1';

  // ---------- Telegram ----------
  let tg = null;
  try {
    tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready(); tg.expand();
      const p = tg.themeParams || {}, st = document.documentElement.style;
      if (p.bg_color) st.setProperty('--bg', p.bg_color);
      if (p.text_color) st.setProperty('--text', p.text_color);
      if (p.hint_color) st.setProperty('--hint', p.hint_color);
    }
  } catch (e) { tg = null; }
  const haptic = kind => { try { tg && tg.HapticFeedback && (kind === 'light' ? tg.HapticFeedback.impactOccurred('light') : tg.HapticFeedback.notificationOccurred(kind)); } catch (e) {} };

  // ---------- сохранение ----------
  function save() { try { localStorage.setItem(KEY, Pet.serialize(Date.now())); } catch (e) {} }
  let raw = null; try { raw = localStorage.getItem(KEY); } catch (e) {}
  Pet.load(raw, Date.now());

  // ---------- масштаб: целый, если места хватает ----------
  function fit() {
    const availW = innerWidth - 8, availH = innerHeight - 330;
    let k = Math.min(availW / Room.W, availH / Room.H);
    k = k >= 2 ? Math.floor(k) : Math.max(1, k);
    canvas.style.width = Math.round(Room.W * k) + 'px'; canvas.style.height = Math.round(Room.H * k) + 'px';
  }
  addEventListener('resize', fit); fit();

  // ---------- интерфейс ----------
  const bars = { food: $('b-food'), mood: $('b-mood'), clean: $('b-clean'), energy: $('b-energy') };
  const vals = { food: $('v-food'), mood: $('v-mood'), clean: $('v-clean'), energy: $('v-energy') };
  let toastT = 0;
  function toast(msg, bad) {
    const el = $('toast'); el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'toast'; }, 2200);
  }
  function refresh() {
    const d = Pet.data;
    for (const k in bars) {
      const v = Math.round(d.stats[k]);
      bars[k].style.width = v + '%'; vals[k].textContent = v;
      bars[k].parentNode.classList.toggle('low', v < 25);
      vals[k].textContent = v + (v < 25 ? ' ▼' : '');
    }
    $('coins').textContent = d.coins;
    $('status').textContent = Pet.status();
    $('btn-sleep').querySelector('b').textContent = d.sleeping ? 'Будить' : 'Спать';
  }
  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const r = Pet.act(btn.dataset.act, Date.now());
    toast(r.msg, !r.ok); haptic(r.ok ? 'light' : 'error');
    refresh(); save();
  }));

  // ---------- цикл ----------
  let last = performance.now(), acc = 0, lastSave = 0;
  function frame(t) {
    const dt = Math.min(t - last, 5000); last = t; acc += dt;
    if (acc >= 1000) { Pet.advance(acc, false); acc = 0; refresh(); }
    Pet.events.splice(0).forEach(e => { toast(e.msg, e.kind === 'bad'); haptic('success'); });
    Room.draw(ctx, t);
    Pet.draw(ctx, t);
    Pet.drawFx(ctx, t);
    Pet.drawSleep(ctx, t, Room.W, Room.H);
    if (t - lastSave > 5000) { lastSave = t; save(); }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
  Pet.events.splice(0).forEach(e => toast(e.msg));   // например «пока тебя не было…»
  refresh(); requestAnimationFrame(frame);
})();
