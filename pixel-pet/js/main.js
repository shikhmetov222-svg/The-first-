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
    $('coins').textContent = d.coins; $('shop-coins').textContent = d.coins;
    $('status').textContent = Pet.status();
    $('btn-sleep').querySelector('b').textContent = d.sleeping ? 'Будить' : 'Спать';
  }
  document.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => {
    const r = Pet.act(btn.dataset.act, Date.now());
    toast(r.msg, !r.ok); haptic(r.ok ? 'light' : 'error');
    refresh(); save();
  }));

  // ---------- интерьер: лист магазина ----------
  const TABS = [['plant', 'Растения'], ['furn', 'Мебель'], ['wall', 'Стены'], ['floor', 'Пол'], ['rug', 'Ковёр']];
  let tab = 'plant';
  function preview(it) {
    const cv = document.createElement('canvas');
    if (it.cat === 'plant' || it.cat === 'furn') {
      const img = it.cat === 'plant' ? Sprites.plantImg(it.idx) : Sprites.itemImg(it.asset);
      const k = it.cat === 'plant' ? 3 : 1.5;
      cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0);
      cv.style.width = Math.round(img.width * k) + 'px'; cv.style.height = Math.round(img.height * k) + 'px';
      cv.style.padding = '4px'; cv.style.boxSizing = 'content-box';
    } else {
      cv.width = 16; cv.height = 12; const g = cv.getContext('2d');
      if (it.cat === 'rug' && !it.c1) { g.fillStyle = '#e6cfa6'; g.fillRect(0, 0, 16, 12); }
      else if (it.cat === 'rug') { g.fillStyle = '#b8794b'; g.fillRect(0, 0, 16, 12); g.fillStyle = it.c2; g.fillRect(1, 3, 14, 6); g.fillStyle = it.c1; g.fillRect(3, 4, 10, 4); }
      else { g.fillStyle = it.c1; g.fillRect(0, 0, 16, 12); g.fillStyle = it.c2;
        for (let x = 1; x < 16; x += 4) g.fillRect(x, 0, 1, 12); if (it.pat === 'tiles' || it.pat === 'planks') g.fillRect(0, 6, 16, 1); }
      cv.style.width = '64px'; cv.style.height = '48px';
    }
    return cv;
  }
  function btn(text, cls, fn, disabled) {
    const b = document.createElement('button'); b.textContent = text; if (cls) b.className = cls;
    b.disabled = !!disabled; b.addEventListener('click', fn); return b;
  }
  function renderShop() {
    const d = Pet.data, list = $('shop-list'); list.textContent = '';
    $('tabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    Shop.items.filter(it => it.cat === tab).forEach(it => {
      const row = document.createElement('div'); row.className = 'item';
      row.appendChild(preview(it));
      const info = document.createElement('div'); info.className = 'info';
      const owned = Shop.owns(d, it.id), where = Shop.placedIn(d, it.id);
      info.innerHTML = '<b></b><span></span>'; info.firstChild.textContent = it.name;
      info.lastChild.textContent = owned ? (where.length ? 'Стоит в комнате ✓' : 'Куплено') : (it.price + ' 🪙');
      row.appendChild(info);
      const btns = document.createElement('div'); btns.className = 'btns';
      const act = (res) => { toast(res.msg, !res.ok); haptic(res.ok ? 'light' : 'error'); refresh(); renderShop(); save(); };
      if (!owned) btns.appendChild(btn('Купить ' + it.price + ' 🪙', 'buy', () => act(Shop.buy(d, it.id)), d.coins < it.price));
      else if (it.cat === 'plant') {
        btns.appendChild(btn('Полка', where.indexOf('shelf') >= 0 ? 'on' : '', () => act(Shop.use(d, it.id, 'shelf'))));
        btns.appendChild(btn('Окно', where.indexOf('sill') >= 0 ? 'on' : '', () => act(Shop.use(d, it.id, 'sill'))));
      } else if (it.cat === 'furn') btns.appendChild(btn(where.length ? 'Убрать' : 'Поставить', where.length ? 'on' : '', () => act(Shop.use(d, it.id))));
      else btns.appendChild(btn(where.length ? 'Выбрано' : 'Выбрать', where.length ? 'on' : '', () => act(Shop.use(d, it.id)), where.length > 0));
      row.appendChild(btns); list.appendChild(row);
    });
  }
  TABS.forEach(([id, name]) => {
    const b = document.createElement('button'); b.textContent = name; b.dataset.tab = id;
    b.addEventListener('click', () => { tab = id; renderShop(); }); $('tabs').appendChild(b);
  });
  $('open-shop').addEventListener('click', () => { $('sheet').hidden = false; renderShop(); });
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => { $('sheet').hidden = true; }));

  // ---------- цикл ----------
  let last = performance.now(), acc = 0, lastSave = 0;
  function frame(t) {
    const dt = Math.min(t - last, 5000); last = t; acc += dt;
    if (acc >= 1000) { Pet.advance(acc, false); acc = 0; refresh(); }
    Pet.events.splice(0).forEach(e => { toast(e.msg, e.kind === 'bad'); haptic('success'); });
    Room.draw(ctx, t, Pet.data.room);
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
