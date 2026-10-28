// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- КОФЕЙНЯ: киоск → кафе → кафе с террасой → угловая → обжарка ---------- */
export function buildCoffee(k, T, L){
  const { M, add, awning, body, box, cafeTable, cone, cup, cyl, darkMat, doorMat, emit, flowerBox, front, frontSign, neonEdge, panel, queue, sign, whiteMat, winMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });

  if (L === 1) {
    body(g, w, h, d, wall);
    add(g, box(w + .3, .12, d + .3, acc), 0, h + .06, -d / 2);
    front(g, w * .72, .55, winMat, 0, .95);
    add(g, box(w * .82, .08, .35, whiteMat), 0, .64, .17);
    add(g, cup(.9, acc), 0, h + .12, -d / 2);
    emit(g, 0, h + .62, -d / 2, 'steam');
    const board = box(.42, .6, .06, darkMat); board.rotation.x = -.18; add(g, board, -w / 2 - .35, .3, .45);
    const t = cafeTable(T.accentHex); t.position.set(w / 2 + .8, 0, .8); g.add(t);
    g.userData.top = h + 1.0; return g;
  }
  if (L === 2) {
    body(g, w, h, d, wall);
    add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
    front(g, w * .5, 1.0, winMat, -w * .18, .75);
    front(g, .6, 1.15, doorMat, w * .32, .58);
    const aw = awning(w * .62, T.accentHex); aw.position.set(-w * .18, 1.42, 0); g.add(aw);
    frontSign(g, T.sign, T.accent, w * .68, 1.76);
    flowerBox(g, w * .5, -w * .18, .18, .12);
    add(g, cup(1.1, acc), 0, h + .14, -d / 2);
    emit(g, 0, h + .74, -d / 2, 'steam');
    const t = cafeTable(T.accentHex); t.position.set(-w * .18, 0, 1.15); g.add(t);
    g.userData.top = h + 1.1; return g;
  }
  if (L === 3) {
    body(g, w, h, d, wall);
    add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
    front(g, w * .5, 1.0, winMat, -w * .18, .75);
    front(g, .6, 1.15, doorMat, w * .32, .58);
    const aw = awning(w * .62, T.accentHex); aw.position.set(-w * .18, 1.42, 0); g.add(aw);
    frontSign(g, T.sign, T.accent, w * .7, 1.95);
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + (i + .5) * w / 3;
      front(g, .55, .6, winMat, x, 2.62);
      flowerBox(g, .62, x, 2.24, .1);
    }
    add(g, box(w, .05, .05, trim), 0, h + .45, -.08);
    for (let x = -w / 2; x <= w / 2 + .01; x += w / 4) add(g, box(.05, .45, .05, trim), x, h + .22, -.08);
    add(g, cup(.8, acc), -w / 2 + .6, h + .14, -d / 2 - .2);
    emit(g, -w / 2 + .6, h + .6, -d / 2 - .2, 'steam');
    const t1 = cafeTable(T.accentHex); t1.position.set(-1.05, 0, .95); g.add(t1);
    const t2 = cafeTable(T.accentHex); t2.position.set(.25, 0, 1.05); g.add(t2);
    g.userData.top = h + 1.0; return g;
  }
  if (L === 4) {
    body(g, w, h, d, wall);
    add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
    front(g, w * .86, 1.2, winMat, 0, .75);
    const sp = panel(d * .7, 1.2, winMat); sp.rotation.y = Math.PI / 2; add(g, sp, w / 2 + .012, .75, -d * .4);
    front(g, .6, 1.2, doorMat, -w / 2 + .55, .6, .02);
    const aw = awning(w * .9, T.accentHex); aw.position.set(0, 1.5, 0); g.add(aw);
    frontSign(g, T.sign, T.accent, w * .6, 2.08, -w * .12);
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (i + .5) * w / 4;
      front(g, .5, .6, winMat, x, 2.95);
      flowerBox(g, .58, x, 2.58, .1);
    }
    neonEdge(g, w, d, h, neon, true);
    add(g, box(.5, .06, .06, darkMat), w / 2 + .25, 2.35, .1);
    add(g, cup(.75, neon), w / 2 + .5, 1.98, .1);
    emit(g, w / 2 + .5, 2.45, .1, 'steam');
    queue(g, -w / 2 + .55, 3);
    const t = cafeTable(T.accentHex); t.position.set(w * .2, 0, 1.0); g.add(t);
    g.userData.top = h + .6; return g;
  }
  // L5 — обжарка
  body(g, w, h, d, wall);
  add(g, box(w + .14, .18, d + .14, acc), 0, h + .09, -d / 2);
  front(g, w * .78, 1.3, winMat, -.2, .8);
  front(g, .7, 1.25, doorMat, w * .36, .63, .02);
  frontSign(g, T.sign, T.accent, w * .72, 1.95);
  [2.75, 3.65, 4.55].forEach(y => { for (let i = 0; i < 4; i++) front(g, .5, .6, winMat, -w / 2 + (i + .5) * w / 4, y); });
  [-w / 2, -w / 6, w / 6, w / 2].forEach(x => add(g, box(.12, h - 2.3, .12, acc), x, 2.3 + (h - 2.3) / 2, .04));
  const copper = M(0xb87333, { metalness: .45, roughness: .4, flatShading: false });
  [0, 1].forEach(k => {
    const x = -w / 2 - .45, z = -.55 - k * .95;
    add(g, cyl(.36, .36, 2.6, copper, 14), x, 1.3, z);
    add(g, cone(.38, .45, copper, 14), x, 2.83, z);
    add(g, box(.08, .08, .5, copper), x + .3, 2.2, z);
  });
  add(g, cup(2.0, acc), w * .14, h + .18, -d / 2);
  emit(g, w * .14, h + 1.3, -d / 2, 'steam');
  const r1 = cafeTable(T.accentHex); r1.scale.setScalar(.8); r1.position.set(-w / 2 + .6, h + .18, -.5); g.add(r1);
  const r2 = cafeTable(T.accentHex); r2.scale.setScalar(.8); r2.position.set(-w / 2 + .6, h + .18, -2.2); g.add(r2);
  queue(g, w * .36, 4);
  g.userData.top = h + 2.6; return g;
}

