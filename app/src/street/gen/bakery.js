// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- ПЕКАРНЯ: прилавок → домик → дом с террасой → кафе с печью → хлебозавод ---------- */
export function buildBakery(k, T, L){
  const { M, add, body, box, brickMat, cafeTable, cone, cyl, darkMat, eaveRoof, emit, flowerBox, front, frontSign, gable, loaf, queue, rand, roofMat, sign, van, whiteMat, winMat, woodMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
  const doorWood = M(0x5a3a22);

  if (L === 1) {
    add(g, box(w, .85, .8, woodMat), 0, .425, -.4);
    add(g, box(w, 1.5, .1, wall), 0, .75, -d + .05);
    [[-w / 2, -.05], [w / 2, -.05], [-w / 2, -d + .1], [w / 2, -d + .1]].forEach(([x, z]) => add(g, cyl(.05, .05, 1.6, woodMat, 6), x, .8, z));
    add(g, gable(w + .3, d + .3, .55, roofMat), 0, 1.6, .15);
    add(g, sign(['ХЛЕБ · ВЫПЕЧКА'], T.accent, 1.5, .32), 0, .5, .012);
    [-.55, .05, .6].forEach(x => {
      add(g, cyl(.22, .17, .14, woodMat, 10), x, .92, -.38);
      const l1 = loaf(.36); l1.rotation.y = rand(-.6, .6); add(g, l1, x, 1.02, -.38);
    });
    const big = loaf(.5, 0xb4733a); add(g, big, -.3, .95, -.12);
    g.userData.top = 2.6; return g;
  }
  if (L === 2) {
    body(g, w, h, d, wall);
    add(g, box(.12, h, .12, trim), -w / 2, h / 2, .0); add(g, box(.12, h, .12, trim), w / 2, h / 2, .0);
    add(g, box(w + .04, .1, .1, trim), 0, h, .02);
    add(g, gable(w + .3, d + .3, 1.0, roofMat), 0, h, .15);
    add(g, new THREE.Mesh(new THREE.CircleGeometry(.22, 16), winMat), 0, h + .38, .16);
    add(g, box(.32, .9, .32, brickMat), w * .28, h + .75, -d * .6);
    emit(g, w * .28, h + 1.25, -d * .6, 'smoke');
    front(g, w * .5, .9, winMat, -w * .18, .8);
    add(g, box(w * .55, .06, .25, woodMat), -w * .18, .38, .12);
    for (let i = 0; i < 3; i++) { const l = loaf(.3); l.rotation.y = .3; add(g, l, -w * .18 - .4 + i * .4, .45, .14); }
    front(g, .6, 1.2, doorWood, w * .3, .6);
    frontSign(g, T.sign, T.accent, w * .6, 1.72, -w * .05);
    add(g, box(.5, .05, .05, darkMat), w / 2 + .25, 1.6, .08);
    const hs = sign(['ХЛЕБ'], T.accent, .55, .3); hs.rotation.y = Math.PI / 2; add(g, hs, w / 2 + .38, 1.38, .08);
    g.userData.top = h + 1.7; return g;
  }
  if (L === 3) {
    body(g, w, h, d, wall);
    add(g, box(.12, h, .12, trim), -w / 2, h / 2, .0); add(g, box(.12, h, .12, trim), w / 2, h / 2, .0);
    add(g, box(w + .04, .1, .1, trim), 0, 1.5, .03);
    add(g, eaveRoof(w + .3, d + .3, 1.1, roofMat), 0, h, -d / 2);
    add(g, box(.34, 1.0, .34, brickMat), w * .3, h + .8, -d * .55);
    emit(g, w * .3, h + 1.35, -d * .55, 'smoke');
    front(g, w * .45, .8, winMat, -w * .2, .72);
    front(g, .6, 1.2, doorWood, w * .3, .6);
    frontSign(g, T.sign, T.accent, w * .62, 1.82, 0);
    [-w * .22, w * .22].forEach(x => {
      front(g, .55, .6, winMat, x, 2.6);
      add(g, box(.14, .6, .04, trim), x - .36, 2.6, .03); add(g, box(.14, .6, .04, trim), x + .36, 2.6, .03);
      flowerBox(g, .62, x, 2.23, .1);
    });
    add(g, box(w + .2, .1, 1.5, woodMat), 0, .15, .85);
    add(g, box(w + .2, .05, .05, woodMat), 0, .55, 1.58);
    for (let x = -w / 2 - .1; x <= w / 2 + .11; x += (w + .2) / 4) add(g, box(.05, .4, .05, woodMat), x, .35, 1.58);
    const t1 = cafeTable(T.accentHex); t1.position.set(-.9, .2, .85); g.add(t1);
    const t2 = cafeTable(T.accentHex); t2.position.set(.45, .2, .95); g.add(t2);
    add(g, box(.45, .05, .05, darkMat), w / 2 + .22, 1.95, .08);
    const pz = new THREE.Mesh(new THREE.TorusGeometry(.2, .06, 8, 18), acc); pz.castShadow = true; add(g, pz, w / 2 + .42, 1.72, .08);
    g.userData.top = h + 1.7; return g;
  }
  if (L === 4) {
    const mx = .4, mw = 3.0, mh = 2.8, md = 2.6;
    body(g, mw, mh, md, wall, mx);
    add(g, box(.12, mh, .12, trim), mx - mw / 2, mh / 2, .0); add(g, box(.12, mh, .12, trim), mx + mw / 2, mh / 2, .0);
    add(g, gable(mw + .3, md + .3, 1.2, roofMat), mx, mh, .15);
    const pz = new THREE.Mesh(new THREE.TorusGeometry(.28, .07, 8, 20), neon); add(g, pz, mx, mh + .45, .17);
    front(g, mw * .5, 1.0, winMat, mx - .45, .75);
    add(g, box(mw * .55, .06, .25, woodMat), mx - .45, .23, .12);
    for (let i = 0; i < 3; i++) { const l = loaf(.3); add(g, l, mx - .85 + i * .4, .3, .14); }
    front(g, .6, 1.2, doorWood, mx + 1.0, .6);
    frontSign(g, 'ПЕКАРНЯ·КАФЕ', T.accent, mw * .72, 1.72, mx - .25);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), brickMat);
    dome.castShadow = true; dome.receiveShadow = true; add(g, dome, -1.45, 0, -.9);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, side: THREE.DoubleSide });
    add(g, new THREE.Mesh(new THREE.CircleGeometry(.32, 16, 0, Math.PI), fireMat), -1.45, .01, -.08);
    g.userData.flicker = [fireMat];
    add(g, cyl(.1, .1, 1.0, brickMat, 8), -1.45, 1.1, -1.05);
    emit(g, -1.45, 1.65, -1.05, 'smoke');
    add(g, box(.5, .4, .3, woodMat), -1.9, .2, .2);
    queue(g, mx + 1.0, 3);
    const t = cafeTable(T.accentHex); t.position.set(mx - .45, 0, 1.15); g.add(t);
    g.userData.top = mh + 1.8; return g;
  }
  // L5 — хлебозавод
  add(g, box(w, 1.2, d, brickMat), 0, .6, -d / 2);
  add(g, box(w, h - 1.2, d, wall), 0, 1.2 + (h - 1.2) / 2, -d / 2);
  for (let i = 0; i < 3; i++) add(g, gable(1.4, d + .2, .8, roofMat), -w / 2 + .7 + i * 1.4, h, .1);
  for (let i = 0; i < 4; i++) {
    const x = -w / 2 + (i + .5) * w / 4;
    front(g, .75, .7, winMat, x, 2.35);
    add(g, box(.04, .7, .03, darkMat), x, 2.35, .03);
  }
  front(g, 1.3, 1.1, M(0x3a3e48), w * .25, .55);
  for (let i = 0; i < 4; i++) add(g, box(1.3, .03, .02, M(0x5a5f6b)), w * .25, .15 + i * .27, .03);
  front(g, .55, 1.0, doorWood, -w * .12, .5);
  add(g, cyl(.04, .04, .7, darkMat, 6), -1.2, h + 1.0, .2); add(g, cyl(.04, .04, .7, darkMat, 6), 1.2, h + 1.0, .2);
  add(g, box(2.96, .66, .06, darkMat), 0, h + 1.2, .17);
  add(g, sign(['ХЛЕБОЗАВОД'], T.accent, 2.9, .6), 0, h + 1.2, .205);
  const giant = loaf(2.6, 0xc98a45); giant.scale.set(2.6, .45, .5); add(g, giant, 0, h + 1.82, .2);
  for (let i = 0; i < 4; i++) add(g, box(.08, .1, .52, M(0xe8c38a)), -.9 + i * .6, h + 1.95, .2);
  [[-w / 2 + .5, -d + .6], [-w / 2 + 1.15, -d + .5]].forEach(([x, z]) => {
    add(g, cyl(.22, .26, 2.8, brickMat, 12), x, h + 1.4, z);
    add(g, cyl(.235, .235, .12, whiteMat, 12), x, h + 2.2, z);
    emit(g, x, h + 2.9, z, 'smoke');
  });
  const gold = M(0xd9b56a);
  add(g, cyl(.55, .55, 3.6, gold, 16), w / 2 + .4, 1.8, -1.6);
  add(g, cone(.6, .5, gold, 16), w / 2 + .4, 3.85, -1.6);
  add(g, box(.06, 3.4, .14, darkMat), w / 2 + .4, 1.8, -1.0);
  const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .22, 0, 1.3);
  g.userData.top = h + 2.6; return g;
}

