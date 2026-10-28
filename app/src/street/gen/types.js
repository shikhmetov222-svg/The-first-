// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';
import { buildCoffee } from './coffee.js';
import { buildShop } from './shop.js';
import { buildBakery } from './bakery.js';
import { buildMarket } from './market.js';
import { buildPvz } from './pvz.js';
import { buildAds } from './ads.js';
import { buildRepair } from './repair.js';

/** Типы бизнесов (облик, размеры и описания уровней), участок и сборка здания нужного уровня. */
export function createTypes(k) {
  const { M, add, box, cyl, darkMat, poolMat, sign, woodMat } = k;
  /* ---------- business types ---------- */
  const TYPES = {
    coffee: { name: 'Кофейня', sign: 'КОФЕЙНЯ', wall: 0x7a4e34, trim: 0x5a3826, accent: '#D4A73A', accentHex: 0xd4a73a, neon: '#FFB347', neonHex: 0xffb347, base: 169, minLevel: 1, build: (T, L) => buildCoffee(k, T, L),
      dims: [null, { w: 1.9, h: 1.4, d: 1.5 }, { w: 2.6, h: 2.0, d: 2.2 }, { w: 3, h: 3.3, d: 2.4 }, { w: 3.6, h: 3.6, d: 3 }, { w: 3.8, h: 5.4, d: 3 }],
      desc: ['', 'Киоск с чашкой на крыше и зонтиком', 'Кафе с полосатым навесом и цветами', 'Двухэтажное кафе с летней террасой', 'Угловая кофейня с неоновой чашкой', 'Обжарка: медные силосы и гигантская чашка на крыше'] },
    shop: { name: 'Магазин', sign: 'МАГАЗИН', wall: 0x2f4a6b, trim: 0x22364f, accent: '#6CB4EE', accentHex: 0x6cb4ee, neon: '#56C8FF', neonHex: 0x56c8ff, base: 86, minLevel: 1, build: (T, L) => buildShop(k, T, L),
      dims: [null, { w: 1.8, h: 1.3, d: 1.4 }, { w: 2.8, h: 2.1, d: 2.2 }, { w: 3.8, h: 2.4, d: 2.8 }, { w: 4.0, h: 3.4, d: 3.0 }, { w: 4.2, h: 5.6, d: 3.2 }],
      desc: ['', 'Ларёк с ящиками фруктов', 'Магазин у дома с витриной и тележками', 'Супермаркет со стеклянным фасадом', 'Сетевой магазин с логотипом на крыше и доставкой', 'Торговый центр со стеклянным атриумом и флагами'] },
    bakery: { name: 'Пекарня', sign: 'ПЕКАРНЯ', wall: 0xdcc6a0, trim: 0x6b4a2f, accent: '#F2C46B', accentHex: 0xf2c46b, neon: '#FF8F6B', neonHex: 0xff8f6b, base: 120, minLevel: 0, build: (T, L) => buildBakery(k, T, L),
      dims: [{ w: 3.6, h: 1.2, d: 2.6 }, { w: 1.8, h: 1.6, d: 1.4 }, { w: 2.6, h: 2.9, d: 2.2 }, { w: 3, h: 4.0, d: 2.4 }, { w: 3.8, h: 4.0, d: 2.6 }, { w: 4.2, h: 3.4, d: 3.2 }],
      desc: ['Участок продаётся · собрано 88%', 'Хлебный прилавок под черепичной крышей', 'Домик-пекарня с трубой и витриной', 'Дом-пекарня с террасой и кренделем', 'Пекарня-кафе с дровяной печью', 'Хлебозавод: трубы, силос и батон на крыше'] },
    market: { name: 'Магазин на маркетплейсе', sign: 'МАРКЕТ', wall: 0xb9bec8, trim: 0x3b2f5c, accent: '#A78BFA', accentHex: 0x8b5cf6, neon: '#C4B5FD', neonHex: 0xc4b5fd, base: 140, build: (T, L) => buildMarket(k, T, L),
      dims: [null, { w: 2.4, h: 1.6, d: 2.2 }, { w: 2.8, h: 2.2, d: 2.4 }, { w: 3.6, h: 2.6, d: 2.8 }, { w: 4.0, h: 3.2, d: 3.0 }, { w: 4.4, h: 3.5, d: 3.2 }],
      desc: ['Участок продаётся', 'Склад в гараже: коробки и ноутбук', 'Мини-склад с рольставней', 'Склад с рампой и конвейером', 'Фулфилмент-центр с неоновой вывеской', 'Логистический хаб: ангар и дрон-доставка'] },
    pvz: { name: 'Пункт выдачи заказов', sign: 'ПВЗ', wall: 0xe8e4dc, trim: 0x0f766e, accent: '#2DD4BF', accentHex: 0x14b8a6, neon: '#5EEAD4', neonHex: 0x5eead4, base: 60, build: (T, L) => buildPvz(k, T, L),
      dims: [null, { w: 1.9, h: 2.3, d: 1.0 }, { w: 2.2, h: 2.0, d: 1.8 }, { w: 3.0, h: 2.6, d: 2.4 }, { w: 3.4, h: 3.6, d: 2.6 }, { w: 4.2, h: 3.4, d: 3.2 }],
      desc: ['Участок продаётся', 'Постамат под навесом', 'Пункт выдачи в киоске', 'Пункт выдачи с полками посылок и постаматом', 'Двухэтажный ПВЗ и курьер на самокате', 'Сортировочный центр: конвейер и курьеры'] },
    ads: { name: 'Рекламное агентство', sign: 'РЕКЛАМА', wall: 0x2b2d3a, trim: 0x1a1b24, accent: '#F472B6', accentHex: 0xec4899, neon: '#F9A8D4', neonHex: 0xf9a8d4, base: 210, build: (T, L) => buildAds(k, T, L),
      dims: [null, { w: 1.8, h: 1.6, d: 1.4 }, { w: 2.6, h: 2.2, d: 2.0 }, { w: 3.0, h: 3.3, d: 2.4 }, { w: 3.4, h: 4.2, d: 2.8 }, { w: 3.6, h: 6.0, d: 3.0 }],
      desc: ['Участок продаётся', 'Будка с афишами, рупор и тумба', 'Студия с рекламной витриной', 'Агентство с LED-экраном', 'Медиаофис с гигантским экраном', 'Медиахолдинг с вращающимся билбордом'] },
    repair: { name: 'Ремонтная бригада', sign: 'РЕМОНТ', wall: 0x8a8f98, trim: 0x4b5563, accent: '#FB923C', accentHex: 0xf97316, neon: '#FDBA74', neonHex: 0xfdba74, base: 190, build: (T, L) => buildRepair(k, T, L),
      dims: [null, { w: 2.4, h: 1.5, d: 1.1 }, { w: 2.8, h: 2.0, d: 2.2 }, { w: 3.6, h: 2.2, d: 2.8 }, { w: 3.8, h: 3.0, d: 3.0 }, { w: 4.4, h: 5.4, d: 3.2 }],
      desc: ['Участок продаётся', 'Бытовка, конусы и песок', 'Мастерская с верстаком и кирпичами', 'Стройдвор с экскаватором', 'Стройкомпания с башенным краном', 'Девелопер: офис, стройка и бетономешалка'] }
  };
  Object.values(TYPES).forEach(T => { T.minLevel = 0; if (!T.desc[0]) T.desc[0] = 'Участок продаётся'; });

  function buildLot(){
    const g = new THREE.Group();
    add(g, box(3.6, .04, 2.6, M(0x3a3226)), 0, .02, -1.3);
    for (let x = -1.8; x <= 1.81; x += .6) add(g, box(.07, .6, .07, woodMat), x, .3, -.05);
    add(g, box(3.6, .05, .05, woodMat), 0, .45, -.05);
    add(g, box(3.6, .05, .05, woodMat), 0, .2, -.05);
    add(g, box(.05, .05, 2.6, woodMat), -1.8, .45, -1.3);
    add(g, box(.05, .05, 2.6, woodMat), 1.8, .45, -1.3);
    add(g, cyl(.04, .04, 1.6, darkMat, 6), 0, .8, -1.05);
    add(g, box(1.98, .9, .06, darkMat), 0, 1.72, -1.04);
    add(g, sign(['ПРОДАЁТСЯ', '88% собрано'], '#D4A73A', 1.9, .82), 0, 1.72, -1.005);
    g.userData.top = 2.6;
    return g;
  }
  function makeFor(type, L){
    const T = TYPES[type];
    if (L === 0) return buildLot();
    const g = T.build(T, L);
    const pw = T.dims[L].w + 1.4;
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(pw, 2.0), poolMat);
    pl.rotation.x = -Math.PI / 2; pl.position.set(0, .135, 1.0); g.add(pl);
    return g;
  }
  function dimsFor(type, L){ return L === 0 ? { w: 3.6, h: 1.2, d: 2.6 } : TYPES[type].dims[L]; }
  function disposeGroup(g){ g.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

  return { TYPES, buildLot, makeFor, dimsFor, disposeGroup };
}
