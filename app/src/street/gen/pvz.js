// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- ПВЗ: постамат → киоск → пункт выдачи → двухэтажный → сортировочный центр ---------- */
export function buildPvz(k, T, L){
  const { M, add, addAnim, bladeSign, body, box, cyl, darkMat, front, holding, locker, neonEdge, parcel, person, rand, rollDoor, scooter, sign, steelMat, whiteMat, winMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
  if (L === 1) {
    locker(g, 1.4, 1.8, 0, 0, T.accentHex);
    add(g, box(1.9, .08, 1.3, M(0x3a3e48)), 0, 1.98, -.15);
    add(g, cyl(.03, .03, 1.95, darkMat, 6), -.88, .975, .4); add(g, cyl(.03, .03, 1.95, darkMat, 6), .88, .975, .4);
    add(g, box(1.66, .34, .05, darkMat), 0, 2.24, .4);
    add(g, sign(['ПОСТАМАТ'], T.neon, 1.6, .3), 0, 2.24, .43);
    const p = holding(person()); add(g, p, .5, 0, .8);
    g.userData.top = 2.9; return g;
  }
  const shelves = (x0, ww, ys, n) => ys.forEach(y => {
    add(g, box(ww, .03, .08, whiteMat), x0, y, .05);
    for (let i = 0; i < n; i++) parcel(g, x0 - ww / 2 + (i + .5) * ww / n, y + .015, .07, .18);
  });
  if (L === 2) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
    add(g, box(w + .04, .45, .08, acc), 0, h - .25, .04);
    add(g, sign(['ПВЗ'], T.neon, w * .62, .38), 0, h - .25, .085);
    front(g, w * .55, 1.0, winMat, -w * .17, .8);
    shelves(-w * .17, w * .55, [.5, .9], 4);
    front(g, .55, 1.15, M(0x1c2a3a), w * .32, .58);
    const p = holding(person()); add(g, p, w * .32, 0, .95);
    g.userData.top = h + .6; return g;
  }
  if (L === 3 || L === 4) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
    const bandY = L === 3 ? h - .3 : 2.02;
    add(g, box(w + .04, .48, .08, acc), 0, bandY, .04);
    add(g, sign(['ПУНКТ ВЫДАЧИ'], T.neon, w * .72, .38), 0, bandY, .085);
    front(g, w * .62, 1.5, winMat, -w * .16, .9);
    shelves(-w * .16, w * .62, [.4, .8, 1.2], 5);
    front(g, .6, 1.4, M(0x1c2a3a), w * .33, .7);
    locker(g, .8, 1.6, -w / 2 - .55, .6, T.accentHex);
    if (L === 4) {
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + (i + .5) * w / 4;
        add(g, box(.62, .7, .04, acc), x, 2.9, .02); front(g, .5, .58, winMat, x, 2.9, .045);
      }
      neonEdge(g, w, d, h, neon, true);
      bladeSign(g, 'ПВЗ', T.neon, w / 2 + .03, 2.6, -.4);
      scooter(g, w * .05, 1.6, T.accentHex);
    }
    for (let i = 0; i < (L === 3 ? 2 : 3); i++) { const p = holding(person()); p.rotation.y = Math.PI; add(g, p, w * .33 + rand(-.06, .06), 0, .6 + i * .5); }
    g.userData.top = h + .6; return g;
  }
  body(g, w, h, d, wall);
  add(g, box(w + .1, .14, d + .1, trim), 0, h + .07, -d / 2);
  for (let k = 0; k < 3; k++) rollDoor(g, w * .2, 1.6, -w * .34 + k * w * .23, 0, .03);
  front(g, w * .2, 1.4, winMat, w * .37, .9);
  add(g, box(w + .04, .5, .08, acc), 0, h - .35, .04);
  add(g, sign(['СОРТИРОВКА'], T.neon, w * .62, .4), 0, h - .35, .085);
  add(g, box(w * .78, .08, .38, darkMat), -w * .1, .58, .6);
  [-w * .45, w * .25].forEach(x => add(g, box(.06, .54, .3, steelMat), x, .27, .6));
  const moving = [];
  for (let i = 0; i < 4; i++) { const p = new THREE.Group(); parcel(p, 0, 0, 0, .24); add(g, p, 0, .62, .6); moving.push(p); }
  addAnim(g, t => { moving.forEach((p, i) => { p.position.x = -w * .48 + ((t * .25 + i / 4) % 1) * w * .76; }); });
  for (let i = 0; i < 3; i++) scooter(g, -w * .32 + i * 1.0, 1.65, T.accentHex);
  add(g, cyl(.03, .03, 1.4, darkMat, 6), w / 2 - .4, h + .7, -d + .5);
  add(g, cyl(.04, .04, .4, darkMat, 6), -w / 2 + .6, h + .2, -1.0);
  const dish = cyl(.36, .2, .08, whiteMat, 16); dish.rotation.x = .9; add(g, dish, -w / 2 + .6, h + .45, -.95);
  add(g, cyl(.015, .015, .3, darkMat, 5), -w / 2 + .6, h + .55, -.8);
  neonEdge(g, w, d, h, neon, false);
  g.userData.top = h + 1.2; return g;
}

