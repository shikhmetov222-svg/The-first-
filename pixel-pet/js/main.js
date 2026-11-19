(function () {
  const $ = id => document.getElementById(id);
  const canvas = $('scene'), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const KEY = 'pixelpet.v1', D = window.GameData, S = window.Sprites;

  // ---------- Telegram ----------
  let tg = null;
  try {
    tg = window.Telegram && window.Telegram.WebApp;
    if (tg) {
      tg.ready(); tg.expand();
      try { tg.setHeaderColor('#21170f'); tg.setBackgroundColor('#21170f'); } catch (e) {}
    }
  } catch (e) { tg = null; }
  const haptic = kind => { try { tg && tg.HapticFeedback && (kind === 'light' ? tg.HapticFeedback.impactOccurred('light') : tg.HapticFeedback.notificationOccurred(kind)); } catch (e) {} };

  // ---------- сохранение ----------
  function save() { try { localStorage.setItem(KEY, Pet.serialize(Date.now())); } catch (e) {} }
  let raw = null; try { raw = localStorage.getItem(KEY); } catch (e) {}
  Pet.load(raw, Date.now());

  // ---------- масштаб: целый, если места хватает ----------
  function fit() {
    const availW = Math.min(innerWidth - 8, 1000), availH = innerHeight - 380;
    let k = Math.min(availW / D.w, availH / D.h);
    k = k >= 1 ? Math.floor(k) : Math.max(0.7, k);
    canvas.style.width = Math.round(D.w * k) + 'px'; canvas.style.height = Math.round(D.h * k) + 'px';
  }
  addEventListener('resize', fit); fit();

  // ---------- интерфейс ----------
  const KEYS = ['food', 'mood', 'clean', 'energy'];
  const segs = {};
  KEYS.forEach(k => { const b = $('b-' + k); segs[k] = []; for (let i = 0; i < 10; i++) { const c = document.createElement('i'); b.appendChild(c); segs[k].push(c); } });
  let toastT = 0;
  function toast(msg, bad) {
    const el = $('toast'); el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { el.className = 'toast'; }, 2200);
  }
  let lastCoins = null;
  function refresh() {
    const d = Pet.data;
    KEYS.forEach(k => {
      const v = Math.round(d.stats[k]), n = Math.ceil(v / 10);
      segs[k].forEach((c, i) => c.classList.toggle('on', i < n));
      const st = $('s-' + k); st.classList.toggle('low', v < 25); st.classList.toggle('mid', v >= 25 && v < 50);
      $('v-' + k).textContent = v + (v < 25 ? ' ▼' : '');
    });
    $('coins').textContent = d.coins; $('shop-coins').textContent = d.coins;
    if (lastCoins !== null && d.coins > lastCoins) { const pill = $('coins-pill'); pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); }
    lastCoins = d.coins;
    if (resetAsk && performance.now() - resetAsk > 3000) { $('t-reset').textContent = 'Начать заново'; resetAsk = 0; }
    const st = Pet.state(); $('status').textContent = Pet.status(); $('status').classList.toggle('alert', st !== 'ok' && st !== 'sleep');
    $('btn-sleep').querySelector('b').textContent = d.sleeping ? 'Будить' : 'Спать';
    $('btn-sleep').querySelector('span').textContent = d.sleeping ? '☀️' : '🌙';
    document.querySelectorAll('[data-act]').forEach(b => b.classList.toggle('busy', d.sleeping && b.dataset.act !== 'sleep'));
  }
  // всплывающий текст над котом («+2 🪙»)
  function floatText(text) {
    const a = Pet.actor; if (!a) return;
    const el = document.createElement('span'); el.className = 'float'; el.textContent = text;
    el.style.left = (a.x / D.w * 100) + '%'; el.style.top = ((a.floorY - 62) / D.h * 100) + '%';
    el.addEventListener('animationend', () => el.remove()); $('fx').appendChild(el);
  }
  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const before = Pet.data.coins;
    const r = Pet.act(btn.dataset.act, Date.now());
    toast(r.msg, !r.ok); haptic(r.ok ? 'light' : 'error');
    if (Pet.data.coins > before) floatText('+' + (Pet.data.coins - before) + ' 🪙');
    refresh(); save();
  }));

  // ---------- магазин и окрас (нижний лист) ----------
  let mode = 'items';
  function thumb(img, sx, sy, sw, sh, boxW, boxH) {           // предпросмотр: картинка целиком в рамку
    const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const k = Math.min(boxW / sw, boxH / sh); const ki = k >= 1 ? Math.floor(k) : k;
    cv.style.width = Math.round(sw * ki) + 'px'; cv.style.height = Math.round(sh * ki) + 'px'; cv.style.padding = '4px'; cv.style.boxSizing = 'content-box';
    return cv;
  }
  function btn(text, cls, fn, disabled) {
    const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls;
    b.disabled = !!disabled; b.addEventListener('click', fn); return b;
  }
  function renderSheet() {
    const d = Pet.data, list = $('shop-list'); list.textContent = '';
    $('tabs').hidden = true;
    if (mode === 'coat') {
      $('sheet-title').textContent = 'Окрас кота';
      const grid = document.createElement('div'); grid.className = 'coats';
      Object.keys(D.coats).forEach(c => {
        const b = document.createElement('button'); b.className = 'coat' + (d.coat === c ? ' on' : '');
        const sh = S.coat(c);
        if (sh) b.appendChild(thumb(sh, 0, 0, D.frame_w, D.frame_h, 128, 112));
        const l = document.createElement('span'); l.textContent = D.coats[c] + (d.coat === c ? ' ✓' : ''); b.appendChild(l);
        b.addEventListener('click', () => { const r = Shop.setCoat(d, c); toast(r.msg, !r.ok); haptic('light'); renderSheet(); save(); });
        grid.appendChild(b);
      });
      list.appendChild(grid); return;
    }
    $('sheet-title').textContent = 'Магазин комнаты';
    Shop.items.forEach(it => {
      const row = document.createElement('div'); row.className = 'item';
      const im = S.item(it.id), cd = D.items[it.id];
      if (im) row.appendChild(thumb(im, 0, 0, cd.w, cd.h, 84, 60));
      const owned = Shop.owns(d, it.id), put = Shop.placed(d, it.id);
      const info = document.createElement('div'); info.className = 'info';
      info.innerHTML = '<b></b><span></span>'; info.firstChild.textContent = it.name;
      info.lastChild.textContent = owned ? (put ? 'Стоит в комнате ✓' : 'Куплено · в кладовке') : (it.price + ' 🪙');
      row.appendChild(info);
      const btns = document.createElement('div'); btns.className = 'btns';
      const act = res => { toast(res.msg, !res.ok); haptic(res.ok ? 'light' : 'error'); refresh(); renderSheet(); save(); };
      if (!owned) btns.appendChild(btn('Купить ' + it.price + ' 🪙', 'buy', () => act(Shop.buy(d, it.id)), d.coins < it.price));
      else btns.appendChild(btn(put ? 'Убрать' : 'Поставить', put ? 'on' : '', () => act(Shop.toggle(d, it.id))));
      row.appendChild(btns); list.appendChild(row);
    });
  }
  function openSheet(m) {
    mode = m; $('sheet').hidden = false;
    const need = m === 'coat' ? Object.keys(D.coats).map(c => S.loadCoat(c)) : [];
    renderSheet(); Promise.all(need).then(() => { if (!$('sheet').hidden) renderSheet(); });
  }
  $('open-shop').addEventListener('click', () => openSheet('items'));
  $('open-coat').addEventListener('click', () => openSheet('coat'));
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { $('sheet').hidden = true; }));

  // ---------- тестовая панель (адрес с #test или тестовая сборка) ----------
  let speed = 1, resetAsk = 0;
  if (location.hash === '#test' || window.PET_TEST) $('test').hidden = false;
  document.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    const d = Pet.data, s = d.stats, t = b.dataset.t;
    const norm = () => { Object.assign(s, { food: 80, mood: 80, clean: 80, energy: 80 }); d.sleeping = false; Pet.fx.anim = null; };
    if (t === 'ok') norm();
    else if (['food', 'mood', 'clean', 'energy'].indexOf(t) >= 0) { norm(); s[t] = t === 'food' || t === 'mood' ? 10 : 5; }
    else if (t === 'sleep') { norm(); s.energy = 40; d.sleeping = true; d.sleepFrom = 40; }
    else if (t === 'coins') { d.coins += 100; floatText('+100 🪙'); }
    else if (t === 'speed') { speed = speed === 1 ? 60 : speed === 60 ? 600 : 1; b.textContent = 'Время ×' + speed; b.classList.toggle('on', speed > 1); }
    else if (t === 'reset') {
      if (performance.now() - resetAsk > 3000) { resetAsk = performance.now(); b.textContent = 'Точно? Нажми ещё раз'; return; }
      try { localStorage.removeItem(KEY); } catch (e) {}
      Pet.load(null, Date.now()); Pet.actor = null; b.textContent = 'Начать заново'; resetAsk = 0; toast('Начали заново');
    }
    haptic('light'); refresh(); save();
  }));

  // ---------- цикл ----------
  let last = performance.now(), acc = 0, lastSave = 0;
  function frame(t) {
    const dt = Math.min(t - last, 5000); last = t; acc += dt;
    if (acc >= 1000) { Pet.advance(acc * speed, false); acc = 0; refresh(); }
    Pet.events.splice(0).forEach(e => { toast(e.msg, e.kind === 'bad'); haptic('success'); });
    Room.draw(ctx, Pet.data);
    Pet.draw(ctx, t);
    if (t - lastSave > 5000) { lastSave = t; save(); }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);

  // ---------- старт: ждём картинки ----------
  const d0 = Pet.data;
  Promise.all([S.loadRoom(), S.loadCoat(d0.coat)].concat(Object.keys(D.items).map(id => S.loadItem(id)))).then(() => {
    Pet.events.splice(0).forEach(e => toast(e.msg));      // например «пока тебя не было…»
    refresh(); requestAnimationFrame(frame);
  }).catch(e => { $('status').textContent = 'Не удалось загрузить картинки: ' + e.message; });
  // смена окраса подгружает его картинки
  const setCoat = Shop.setCoat; Shop.setCoat = function (d, c) { const r = setCoat(d, c); if (r.ok) S.loadCoat(c); return r; };
})();
