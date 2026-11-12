// Каталог интерьера и покупки. Данные игрока хранятся в Pet.data: owned (что куплено) и room (что стоит в комнате).
(function () {
  const PLANTS = ['Подсолнух', 'Кустик', 'Фиалки', 'Подвесной цветок', 'Кактус', 'Фикус', 'Роза', 'Бонсай',
                  'Папоротник', 'Цветущий куст', 'Росток', 'Двулистник', 'Алоэ', 'Тюльпан', 'Белые цветы', 'Ромашка'];
  const PLANT_PRICE = [30, 0, 35, 40, 15, 25, 30, 35, 25, 40, 10, 20, 20, 25, 35, 30];

  const items = [];
  PLANTS.forEach((n, i) => items.push({ id: 'plant.' + i, cat: 'plant', name: n, price: PLANT_PRICE[i], idx: i }));
  items.push(
    { id: 'furn.tunnel', cat: 'furn', slot: 'left', name: 'Домик-тоннель', price: 60, asset: 'tunnel' },
    { id: 'furn.box', cat: 'furn', slot: 'left', name: 'Домик-коробка', price: 55, asset: 'box' },
    { id: 'furn.post', cat: 'furn', slot: 'right', name: 'Когтеточка', price: 45, asset: 'post' },
    { id: 'wall.stripes', cat: 'wall', name: 'Полоска', price: 0, c1: '#e6cfa6', c2: '#d9bf93', pat: 'stripes' },
    { id: 'wall.mint', cat: 'wall', name: 'Мята', price: 20, c1: '#c9dfcb', c2: '#b3cdb7', pat: 'stripes' },
    { id: 'wall.rose', cat: 'wall', name: 'Розовая', price: 20, c1: '#f0cdd2', c2: '#e2b7c0', pat: 'stripes' },
    { id: 'wall.sky', cat: 'wall', name: 'Горошек', price: 25, c1: '#c6d5ec', c2: '#a9bddd', pat: 'dots' },
    { id: 'floor.wood', cat: 'floor', name: 'Светлое дерево', price: 0, c1: '#b8794b', c2: '#a56a40', pat: 'planks' },
    { id: 'floor.dark', cat: 'floor', name: 'Тёмное дерево', price: 25, c1: '#8c5a3c', c2: '#764a31', pat: 'planks' },
    { id: 'floor.tile', cat: 'floor', name: 'Плитка', price: 25, c1: '#cfc7b6', c2: '#b4ac9b', pat: 'tiles' },
    { id: 'rug.red', cat: 'rug', name: 'Красный ковёр', price: 0, c1: '#c44e52', c2: '#8e3548' },
    { id: 'rug.blue', cat: 'rug', name: 'Синий ковёр', price: 15, c1: '#4f77b0', c2: '#35557f' },
    { id: 'rug.green', cat: 'rug', name: 'Зелёный ковёр', price: 15, c1: '#5aa469', c2: '#3b7348' },
    { id: 'rug.none', cat: 'rug', name: 'Без ковра', price: 0 }
  );
  const byId = {}; items.forEach(it => (byId[it.id] = it));

  const DEF_OWNED = ['wall.stripes', 'floor.wood', 'rug.red', 'rug.none', 'plant.1'];
  const DEF_ROOM = { wall: 'wall.stripes', floor: 'floor.wood', rug: 'rug.red', shelf: 'plant.1', sill: null, left: null, right: null };

  const Shop = {
    items, byId,
    defaults() { return { owned: DEF_OWNED.slice(), room: Object.assign({}, DEF_ROOM) }; },
    // приводит данные из сохранения к допустимому виду (на случай старой или повреждённой записи)
    sanitize(d) {
      const owned = Array.isArray(d.owned) ? d.owned.filter(id => byId[id]) : [];
      DEF_OWNED.forEach(id => { if (owned.indexOf(id) < 0) owned.push(id); });
      const room = Object.assign({}, DEF_ROOM, d.room || {});
      ['wall', 'floor', 'rug', 'shelf', 'sill', 'left', 'right'].forEach(slot => {
        const id = room[slot];
        if (id && (!byId[id] || owned.indexOf(id) < 0)) room[slot] = DEF_ROOM[slot];
      });
      d.owned = owned; d.room = room;
    },
    owns(d, id) { return d.owned.indexOf(id) >= 0; },
    buy(d, id) {
      const it = byId[id];
      if (!it) return { ok: false, msg: 'Нет такого предмета' };
      if (Shop.owns(d, id)) return { ok: false, msg: 'Уже куплено' };
      if (d.coins < it.price) return { ok: false, msg: 'Не хватает ' + (it.price - d.coins) + ' 🪙' };
      d.coins -= it.price; d.owned.push(id);
      return { ok: true, msg: it.name + ' куплено · −' + it.price + ' 🪙' };
    },
    // поставить / убрать; slot нужен только растениям ('shelf' | 'sill')
    use(d, id, slot) {
      const it = byId[id];
      if (!it || !Shop.owns(d, id)) return { ok: false, msg: 'Сначала купи' };
      const r = d.room;
      if (it.cat === 'plant') { r[slot] = r[slot] === id ? null : id; return { ok: true, msg: r[slot] ? it.name + ' поставлено' : 'Убрали' }; }
      if (it.cat === 'furn') { r[it.slot] = r[it.slot] === id ? null : id; return { ok: true, msg: r[it.slot] ? it.name + ' стоит в комнате' : 'Убрали' }; }
      r[it.cat] = id; return { ok: true, msg: it.name };
    },
    placedIn(d, id) {       // где сейчас стоит предмет
      const r = d.room, out = [];
      for (const k in r) if (r[k] === id) out.push(k);
      return out;
    }
  };
  window.Shop = Shop;
})();
