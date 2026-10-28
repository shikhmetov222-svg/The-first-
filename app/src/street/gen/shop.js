// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- МАГАЗИН: ларёк → у дома → супермаркет → сетевой → ТЦ ---------- */
export function buildShop(k, T, L){
  const { M, add, awning, bladeSign, body, box, cart, crate, cyl, darkMat, front, glassMat, neonEdge, pick, queue, sign, steelMat, van, whiteMat, winMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });

  if (L === 1) {
    add(g, box(w, .85, .8, wall), 0, .425, -.4);
    add(g, box(w, 1.7, .12, wall), 0, .85, -d + .06);
    [[-w / 2, -.05], [w / 2, -.05], [-w / 2, -d + .1], [w / 2, -d + .1]].forEach(([x, z]) => add(g, cyl(.04, .04, 1.75, darkMat, 6), x, .87, z));
    const aw = awning(w + .3, T.accentHex, d + .5); aw.rotation.x = .18; aw.position.set(0, 1.85, -d - .1); g.add(aw);
    add(g, box(w * .95 + .06, .44, .05, darkMat), 0, 2.27, -d + .08);
    add(g, sign(['ПРОДУКТЫ'], T.accent, w * .95, .38), 0, 2.27, -d + .11);
    add(g, cyl(.03, .03, .3, darkMat, 6), -w * .38, 1.95, -d + .08); add(g, cyl(.03, .03, .3, darkMat, 6), w * .38, 1.95, -d + .08);
    crate(g, -.55, .85, -.38, 0xf28c28); crate(g, 0, .85, -.38, 0x6bbf4a); crate(g, .55, .85, -.38, 0xd63c3c);
    crate(g, -.5, 0, .38, 0xf2c94c); crate(g, .35, 0, .42, 0x6bbf4a);
    g.userData.top = 2.8; return g;
  }
  if (L === 2) {
    body(g, w, h, d, wall);
    add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
    const sx = -w * .15, sw = w * .55;
    front(g, sw, 1.1, winMat, sx, .8);
    [.55, .95].forEach(y => {
      add(g, box(sw, .04, .06, whiteMat), sx, y, .04);
      for (let i = 0; i < 6; i++) add(g, box(.1, .14, .05, M(pick([0xd63c3c, 0xf2c94c, 0x6bbf4a, 0x56a3c9, 0xf0ece4]))), sx - sw / 2 + .15 + i * (sw - .3) / 5, y + .09, .05);
    });
    front(g, .7, 1.25, M(0x1c2a3a), w * .33, .63);
    add(g, box(w + .04, .5, .1, acc), 0, 1.72, .05);
    add(g, sign([T.sign], T.accent, w * .7, .4), 0, 1.72, .105);
    const c1 = cart(); c1.rotation.y = .3; add(g, c1, -w * .35, 0, .9);
    const c2 = cart(); c2.rotation.y = .1; add(g, c2, -w * .35 + .55, 0, 1.0);
    crate(g, w / 2 - .2, 0, .45, 0xf28c28);
    g.userData.top = h + .6; return g;
  }
  if (L === 3) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .25, d + .1, trim), 0, h + .12, -d / 2);
    front(g, w * .84, 1.5, winMat, 0, .85);
    front(g, .55, 1.4, M(0x1c2a3a), -.3, .72, .02);
    front(g, .55, 1.4, M(0x1c2a3a), .3, .72, .02);
    add(g, box(1.8, .08, .9, acc), 0, 1.75, .45);
    add(g, box(w + .04, .5, .1, acc), 0, 2.05, .05);
    add(g, sign(['СУПЕРМАРКЕТ'], T.accent, w * .7, .4), 0, 2.05, .105);
    [[-1, -1], [.2, -1.9], [1.1, -1.2]].forEach(([x, z]) => { add(g, box(.5, .35, .5, steelMat), x, h + .42, z); add(g, cyl(.16, .16, .03, darkMat, 10), x, h + .61, z); });
    const cx = w / 2 - .45;
    add(g, box(.05, .5, .05, steelMat), cx - .3, .25, .55); add(g, box(.05, .5, .05, steelMat), cx - .3, .25, 1.45);
    add(g, box(.05, .05, .9, steelMat), cx - .3, .5, 1.0);
    for (let i = 0; i < 3; i++) { const c = cart(); c.rotation.y = Math.PI / 2; add(g, c, cx, 0, .7 + i * .25); }
    queue(g, -.9, 2);
    g.userData.top = h + .9; return g;
  }
  if (L === 4) {
    body(g, w, h, d, wall);
    add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
    front(g, w * .86, 1.4, winMat, 0, .8);
    front(g, .8, 1.35, M(0x1c2a3a), .4, .7, .02);
    add(g, box(w + .04, 1.3, .08, acc), 0, 2.4, .04);
    add(g, sign([T.sign], T.accent, w * .6, .5), -w * .1, 2.4, .085);
    neonEdge(g, w, d, h, neon, true);
    add(g, box(.95, .95, .95, acc), w / 2 - .65, h + .55, -.75);
    add(g, box(.97, .08, .97, neon), w / 2 - .65, h + .14, -.75);
    add(g, sign(['М'], T.neon, .82, .82), w / 2 - .65, h + .55, -.75 + .48);
    bladeSign(g, T.sign, T.neon, w / 2 + .03, 2.3, -.4);
    const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .22, 0, 1.3);
    const c1 = cart(); add(g, c1, w * .32, 0, .7);
    queue(g, .4, 2);
    g.userData.top = h + 1.6; return g;
  }
  // L5 — торговый центр
  add(g, box(w, 2.4, d, wall), 0, 1.2, -d / 2);
  front(g, w * .9, 1.8, winMat, 0, 1.05);
  const d2 = d - .4, w2 = w - .6;
  add(g, box(w2, 1.8, d2, wall), 0, 2.4 + .9, -d2 / 2 - .2);
  for (let i = 0; i < 5; i++) front(g, .45, .7, winMat, -w2 / 2 + (i + .5) * w2 / 5, 3.3, -.2 + .012);
  const d3 = d - .9, w3 = w - 1.4;
  add(g, box(w3, 1.4, d3, trim), 0, 4.2 + .7, -d3 / 2 - .45);
  add(g, box(w + .1, .07, .07, neon), 0, 2.43, .05);
  add(g, box(w2 + .1, .07, .07, neon), 0, 4.23, -.15);
  const atrium = cyl(.85, .85, 3.4, glassMat, 20); atrium.castShadow = false; add(g, atrium, 0, 1.7, .25);
  add(g, cyl(.7, .7, 3.3, winMat, 20), 0, 1.65, .25);
  add(g, cyl(.92, .92, .12, acc, 20), 0, 3.46, .25);
  const sy = 5.6 + .65, sz = -d3 / 2 - .45;
  add(g, cyl(.04, .04, .6, darkMat, 6), -1.1, 5.9, sz); add(g, cyl(.04, .04, .6, darkMat, 6), 1.1, 5.9, sz);
  add(g, box(3.06, .76, .06, darkMat), 0, sy, sz - .03);
  add(g, sign(['ТЦ МАГАЗИН'], T.neon, 3.0, .7), 0, sy, sz + .005);
  [[-w / 2 + .25, 0xd63c3c], [-w / 2 + .75, 0xf2c94c], [w / 2 - .25, 0x6cb4ee]].forEach(([x, col]) => {
    add(g, cyl(.03, .03, 2.3, steelMat, 6), x, 1.15, .6);
    add(g, box(.02, .32, .5, M(col)), x, 2.1, .85);
  });
  queue(g, 1.3, 4);
  g.userData.top = 7.2; return g;
}

