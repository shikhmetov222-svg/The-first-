// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- РЕМОНТ: бытовка → мастерская → стройдвор → стройкомпания → девелопер ---------- */
export function buildRepair(k, T, L){
  const { M, add, body, box, bricks, concreteMat, cont, cyl, darkMat, dumpTruck, excavator, front, glassMat, mixerTruck, panel, roofSign, sandPile, sign, steelMat, towerCrane, trafficCone, wheel, whiteMat, winMat, woodMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  if (L === 1) {
    const bh = h - .2;
    add(g, box(w, bh, d, acc), 0, .2 + bh / 2, -d / 2);
    for (let x = -w / 2 + .15; x < w / 2; x += .3) add(g, box(.03, bh - .1, .03, acc), x, .2 + bh / 2, .015);
    [-w / 2 + .3, w / 2 - .3].forEach(x => add(g, box(.25, .2, .8, concreteMat), x, .1, -d / 2));
    front(g, .6, .4, winMat, -w * .2, .2 + bh * .62, .035);
    front(g, .45, .95, M(0x4b5563), w * .3, .7, .035);
    add(g, box(.5, .1, .3, concreteMat), w * .3, .1, .2);
    add(g, box(w * .6 + .06, .36, .06, darkMat), 0, .2 + bh + .25, -.3);
    add(g, sign(['РЕМОНТ'], T.accent, w * .6, .3), 0, .2 + bh + .25, -.265);
    trafficCone(g, -w / 2 - .25, .6); trafficCone(g, -w / 2 + .25, 1.0); trafficCone(g, w / 2 + .3, .9);
    sandPile(g, w / 2 + .75, -.3);
    g.userData.top = h + 1.0; return g;
  }
  if (L === 2) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
    add(g, box(w + .04, .42, .08, acc), 0, h - .25, .04);
    add(g, sign(['МАСТЕРСКАЯ'], T.accent, w * .7, .34), 0, h - .25, .085);
    front(g, w * .5, 1.4, M(0x22252b), -w * .15, .7);
    const px = -w * .15;
    add(g, panel(w * .42, .62, M(0xc9b48a)), px, 1.05, .02);
    add(g, box(.04, .34, .03, woodMat), px - .32, 1.02, .04); add(g, box(.2, .07, .04, steelMat), px - .32, 1.2, .04);
    add(g, box(.05, .3, .03, steelMat), px - .05, 1.05, .04); add(g, new THREE.Mesh(new THREE.TorusGeometry(.06, .02, 6, 10), steelMat), px - .05, 1.22, .04);
    add(g, box(.34, .12, .02, steelMat), px + .27, 1.12, .04); add(g, box(.08, .12, .04, acc), px + .48, 1.12, .04);
    [[-.3, 0xd63c3c], [-.12, 0x3f6fbf], [.06, 0xf2c94c]].forEach(([dx, c]) => add(g, cyl(.08, .08, .16, M(c), 10), px + dx, .08, .12));
    add(g, box(1.0, .06, .45, woodMat), -w * .15, .75, .55);
    add(g, box(.06, .72, .4, darkMat), -w * .15 - .45, .36, .55); add(g, box(.06, .72, .4, darkMat), -w * .15 + .45, .36, .55);
    bricks(g, w * .33, .6);
    const wb = new THREE.Group();
    add(wb, box(.5, .22, .36, acc), 0, .35, 0); wheel(wb, .3, .12, 0, .12);
    add(wb, box(.5, .03, .03, darkMat), -.4, .4, .14); add(wb, box(.5, .03, .03, darkMat), -.4, .4, -.14);
    wb.position.set(w / 2 + .55, 0, 1.0); g.add(wb);
    g.userData.top = h + .6; return g;
  }
  if (L === 3) {
    const cx = -w / 2 + .95;
    cont(g, 1.8, .95, 1.2, cx, 0, 0, acc);
    cont(g, 1.8, .95, 1.2, cx, .95, 0, M(0x6b7280));
    front(g, .5, .4, winMat, cx - .4, .55, .03); front(g, .4, .8, M(0x4b5563), cx + .5, .42, .03);
    front(g, .5, .4, winMat, cx - .4, 1.5, .03); front(g, .5, .4, winMat, cx + .3, 1.5, .03);
    add(g, box(1.66, .34, .05, darkMat), cx, 2.1, -.3);
    add(g, sign(['СТРОЙДВОР'], T.accent, 1.6, .3), cx, 2.1, -.27);
    const fx0 = cx + 1.0, fx1 = w / 2;
    for (let x = fx0; x <= fx1 + .01; x += .4) add(g, box(.05, .9, .05, acc), x, .45, .05);
    [.3, .8].forEach(y => add(g, box(fx1 - fx0, .04, .04, acc), (fx0 + fx1) / 2, y, .05));
    [.3, .8].forEach(y => add(g, box(.04, .04, d, acc), fx1, y, -d / 2 + .05));
    excavator(g, fx0 + .7, -.9, T.accentHex);
    bricks(g, fx0 + .4, -2.0); bricks(g, fx1 - .5, -2.1);
    sandPile(g, fx1 - .5, -1.0);
    trafficCone(g, fx0 - .2, .55); trafficCone(g, fx0 + .3, .7);
    g.userData.top = 2.7; return g;
  }
  if (L === 4) {
    const ox = -w / 2 + .95;
    body(g, 1.9, h, 2.6, wall, ox);
    add(g, box(2.0, .12, 2.7, trim), ox, h + .06, -1.3);
    front(g, .55, 1.15, M(0x4b5563), ox + .5, .58); front(g, .6, .6, winMat, ox - .45, .9);
    roofSign(g, 'СТРОЙКОМПАНИЯ', T.accent, 1.9, h + .7, -.6, ox);
    [ox - .45, ox + .45].forEach(x => front(g, .6, .6, winMat, x, 2.4));
    add(g, box(1.94, .14, .08, acc), ox, h - .1, .04);
    towerCrane(g, w / 2 - .4, -2.2, 4.6, T.accentHex);
    bricks(g, .6, -1.9); sandPile(g, 1.4, -1.0);
    dumpTruck(g, .7, 1.0, T.accentHex);
    trafficCone(g, -w / 2 + .2, 1.6);
    g.userData.top = 5.4; return g;
  }
  const ox = -w / 2 + 1.1;
  add(g, box(2.0, h, 2.8, wall), ox, h / 2, -1.5);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) front(g, .5, .7, winMat, ox - .65 + c * .65, 1.8 + r * .95, -.088);
  front(g, 1.4, 1.1, winMat, ox, .7, -.088);
  [1.35, 2.3, 3.25, 4.2].forEach(y => add(g, box(2.16, .07, 2.96, whiteMat), ox, y, -1.5));
  [[-1, 0], [1, 0], [-1, -1], [1, -1]].forEach(([sx, sz]) => add(g, box(.1, h, .1, acc), ox + sx * 1.1, h / 2, sz * 3));
  const gl = box(2.2, h, 3.0, glassMat); gl.castShadow = false; gl.receiveShadow = false; add(g, gl, ox, h / 2, -1.5);
  roofSign(g, 'ДЕВЕЛОПЕР', T.accent, 2.0, h + .7, -1.4, ox);
  const fx = 1.4;
  [[-.7, -.4], [.7, -.4], [-.7, -2.4], [.7, -2.4]].forEach(([dx, z]) => add(g, box(.14, 3.9, .14, concreteMat), fx + dx, 1.95, z));
  [[.7, 2.4], [-.7, 2.4]].forEach(([dx]) => add(g, box(.14, .7, .14, concreteMat), fx + dx, 4.25, -.4));
  [1.3, 2.6, 3.9].forEach(y => add(g, box(1.6, .12, 2.2, concreteMat), fx, y, -1.4));
  for (let y = .65; y < 3.9; y += 1.3) add(g, box(1.65, .04, .04, M(0xd4a73a)), fx, y, -.25);
  towerCrane(g, w / 2 - .1, -2.9, 6.2, T.accentHex);
  mixerTruck(g, -.6, 1.45, T.accentHex);
  trafficCone(g, 1.0, 1.0); trafficCone(g, 1.6, .8);
  g.userData.top = 7.0; return g;
}

