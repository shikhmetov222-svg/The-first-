// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- МАРКЕТПЛЕЙС: гараж → мини-склад → склад с конвейером → фулфилмент → хаб ---------- */
export function buildMarket(k, T, L){
  const { M, add, addAnim, body, box, concreteMat, cyl, darkMat, doorMat, drone, front, frontSign, neonEdge, pallet, panel, parcel, parcelStack, ribMat, ribs, rollDoor, roofSign, sign, steelMat, van, winMat, woodMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
  if (L === 1) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .1, d + .1, trim), 0, h + .05, -d / 2);
    front(g, w * .78, 1.15, M(0x2a2633), 0, .58);
    add(g, box(w * .8, .32, .08, acc), 0, 1.32, .04);
    parcelStack(g, -.7, .45, 3); parcelStack(g, -.25, .55, 2); parcelStack(g, .25, .4, 3, .34);
    add(g, box(.8, .05, .45, woodMat), w / 2 + .6, .62, .6);
    add(g, box(.05, .6, .4, darkMat), w / 2 + .25, .3, .6); add(g, box(.05, .6, .4, darkMat), w / 2 + .95, .3, .6);
    add(g, box(.3, .02, .22, darkMat), w / 2 + .6, .66, .62);
    const scr = panel(.3, .2, neon); scr.rotation.x = -.3; add(g, scr, w / 2 + .6, .77, .52);
    add(g, box(w * .9 + .06, .44, .06, darkMat), 0, h + .33, -.3);
    add(g, sign(['МАРКЕТ'], T.accent, w * .9, .38), 0, h + .33, -.265);
    g.userData.top = h + .9; return g;
  }
  if (L === 2) {
    body(g, w, h, d, wall);
    ribs(g, w, h - .45, .02, ribMat);
    add(g, box(w + .12, .12, d + .12, trim), 0, h + .06, -d / 2);
    add(g, box(w + .04, .42, .08, acc), 0, h - .25, .04);
    add(g, sign(['СКЛАД'], T.neon, w * .45, .34), 0, h - .25, .085);
    rollDoor(g, w * .5, 1.45, -w * .17, 0, .04);
    front(g, .55, 1.1, doorMat, w * .3, .55, .04);
    pallet(g, w / 2 + .6, .6); parcelStack(g, w / 2 + .45, .45, 2, .34); parcelStack(g, w / 2 + .8, .75, 3);
    g.userData.top = h + .6; return g;
  }
  if (L === 3) {
    body(g, w, h, d, wall);
    ribs(g, w, h - .5, .02, ribMat);
    add(g, box(w + .12, .12, d + .12, trim), 0, h + .06, -d / 2);
    frontSign(g, 'МАРКЕТПЛЕЙС', T.accent, w * .62, h - .3, 0, .04);
    add(g, box(w * .45, .6, .9, concreteMat), -w * .2, .3, .45);
    rollDoor(g, w * .38, 1.3, -w * .2, .6, .04);
    rollDoor(g, w * .25, 1.6, w * .3, 0, .04);
    add(g, box(.42, .06, 1.3, darkMat), -w * .2, .63, .6);
    const moving = [];
    for (let i = 0; i < 3; i++) { const p = new THREE.Group(); parcel(p, 0, 0, 0, .26); add(g, p, -w * .2, .66, 0); moving.push(p); }
    addAnim(g, t => { moving.forEach((p, i) => { p.position.z = .05 + ((t * .3 + i / 3) % 1) * 1.15; }); });
    parcelStack(g, -w * .2, 1.6, 2);
    add(g, box(.5, .35, .5, steelMat), -w * .25, h + .3, -1.2); add(g, box(.5, .35, .5, steelMat), w * .2, h + .3, -1.6);
    g.userData.top = h + .7; return g;
  }
  if (L === 4) {
    body(g, w, h, d, wall);
    let i = 0;
    for (let x = -w / 2 + .25; x < w / 2; x += .5, i++) add(g, box(.48, h - .2, .04, i % 4 === 0 ? acc : ribMat), x, (h - .2) / 2, .02);
    add(g, box(w + .12, .14, d + .12, trim), 0, h + .07, -d / 2);
    add(g, box(w * .5, .6, .9, concreteMat), -w * .18, .3, .45);
    rollDoor(g, w * .19, 1.3, -w * .3, .6, .05); rollDoor(g, w * .19, 1.3, -w * .06, .6, .05);
    rollDoor(g, w * .22, 1.8, w * .3, 0, .05);
    neonEdge(g, w, d, h, neon, true);
    roofSign(g, 'ФУЛФИЛМЕНТ', T.neon, w * .85, h + .75, -.4);
    const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .2, 0, 1.6);
    parcelStack(g, w * .3, 1.0, 3);
    g.userData.top = h + 1.4; return g;
  }
  const bh = 2.2;
  body(g, w, bh, d, wall);
  const s = new THREE.Shape(); s.absellipse(0, 0, w / 2 + .05, 1.25, 0, Math.PI, false);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d + .1, bevelEnabled: false, curveSegments: 16 }); geo.translate(0, 0, -d - .05);
  const arch = new THREE.Mesh(geo, M(0xc7cbd3)); arch.castShadow = true; arch.receiveShadow = true; add(g, arch, 0, bh, 0);
  const s2 = new THREE.Shape(); s2.absellipse(0, 0, w * .3, .85, 0, Math.PI, false);
  add(g, new THREE.Mesh(new THREE.ShapeGeometry(s2, 12), winMat), 0, bh + .05, .06);
  add(g, box(w + .04, .4, .08, acc), 0, bh - .12, .04);
  add(g, sign(['МАРКЕТПЛЕЙС'], T.neon, w * .62, .32), 0, bh - .12, .085);
  for (let k = 0; k < 3; k++) rollDoor(g, w * .22, 1.4, -w * .3 + k * w * .3, 0, .04);
  add(g, cyl(.5, .5, .05, M(0x3a3e48), 16), 0, bh + 1.28, -d / 2);
  const dr = drone(T.accentHex); dr.scale.setScalar(1.9); add(g, dr, 0, bh + 1.9, -d / 2);
  addAnim(g, t => { dr.position.y = bh + 1.95 + Math.sin(t * 2) * .2; dr.position.x = Math.sin(t * .7) * .5; dr.rotation.y = t * .6; });
  const v = van(0xf0ece4, T.accentHex); add(g, v, -w * .22, 0, 1.6);
  pallet(g, w * .33, 1.1); parcelStack(g, w * .3, 1.0, 3); parcelStack(g, w * .38, 1.25, 2);
  g.userData.top = bh + 2.6; return g;
}

