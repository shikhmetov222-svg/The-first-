// Магазин предметов комнаты и окрасы. В начале комната пустая: всё нужно купить.
// Данные игрока лежат в Pet.data: owned (куплено), placed (стоит в комнате), coat (окрас).
(function () {
  const D = window.GameData;
  const items = Object.keys(D.items).map(function (id) { const it = D.items[id]; return { id: id, name: it.name, price: it.price, z: it.z }; })
                .sort(function (a, b) { return a.price - b.price; });
  const Shop = {
    items,
    defaults() { return { coat: 'orange', owned: [], placed: [] }; },
    sanitize(d) {
      if (!D.coats[d.coat]) d.coat = 'orange';
      d.owned = Array.isArray(d.owned) ? d.owned.filter(function (id, i, a) { return D.items[id] && a.indexOf(id) === i; }) : [];
      d.placed = Array.isArray(d.placed) ? d.placed.filter(function (id) { return d.owned.indexOf(id) >= 0; }) : [];
    },
    owns(d, id) { return d.owned.indexOf(id) >= 0; },
    placed(d, id) { return d.placed.indexOf(id) >= 0; },
    buy(d, id) {
      const it = D.items[id];
      if (!it) return { ok: false, msg: 'Нет такого предмета' };
      if (Shop.owns(d, id)) return { ok: false, msg: 'Уже куплено' };
      if (d.coins < it.price) return { ok: false, msg: 'Не хватает ' + (it.price - d.coins) + ' 🪙' };
      d.coins -= it.price; d.owned.push(id); d.placed.push(id);        // купленное сразу ставится в комнату
      return { ok: true, msg: it.name + ' куплено · −' + it.price + ' 🪙' };
    },
    toggle(d, id) {                                                       // поставить / убрать (предмет остаётся у игрока)
      if (!Shop.owns(d, id)) return { ok: false, msg: 'Сначала купи' };
      const i = d.placed.indexOf(id);
      if (i >= 0) { d.placed.splice(i, 1); return { ok: true, msg: 'Убрали в кладовку' }; }
      d.placed.push(id); return { ok: true, msg: D.items[id].name + ' стоит в комнате' };
    },
    setCoat(d, c) { if (!D.coats[c]) return { ok: false, msg: 'Нет такого окраса' }; d.coat = c; return { ok: true, msg: D.coats[c] + ' кот' }; }
  };
  window.Shop = Shop;
})();
