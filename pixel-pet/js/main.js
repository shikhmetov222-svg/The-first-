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
    const availW = Math.min(innerWidth - 8, 1000), availH = innerHeight - 380;
    let k = Math.min(availW / D.w, availH / D.h);
    k = k >= 1 ? Math.floor(k) : Math.max(0.7, k);
    canvas.style.width = Math.round(D.w * k) + 'px'; canvas.style.height = Math.round(D.h * k) + 'px';
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
      bars[k].style.width = v + '%';
      bars[k].parentNode.classList.toggle('low', v < 25);
      vals[k].textContent = v + (v < 25 ? ' ▼' : '');
    }
    $('coins').textContent = d.coins; $('shop-coins').textContent = d.coins;
    $('status').textContent = Pet.status();
    $('btn-sleep').querySelector('b').textContent = d.sleeping ? 'Будить' : 'Спать';
  }
  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const r = Pet.act(btn.dataset.act, Date.now());
    toast(r.msg, !r.ok); haptic(r.ok ? 'light' : 'error');
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

  // ---------- цикл ----------
  let last = performance.now(), acc = 0, lastSave = 0;
  function frame(t) {
    const dt = Math.min(t - last, 5000); last = t; acc += dt;
    if (acc >= 1000) { Pet.advance(acc, false); acc = 0; refresh(); }
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
