// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/* ---------- РЕКЛАМА: будка с афишами → студия → агентство → медиаофис → медиахолдинг ---------- */
export function buildAds(k, T, L){
  const { ADS, M, adScreen, add, addAnim, body, box, cyl, darkMat, front, frontSign, glassMat, megaphone, neonEdge, panel, poster, roofSign, sign, tumba, whiteMat, winMat } = k;
  const { w, h, d } = T.dims[L];
  const g = new THREE.Group();
  const wall = M(T.wall), trim = M(T.trim), acc = M(T.accentHex);
  const neon = new THREE.MeshBasicMaterial({ color: T.neonHex });
  if (L === 1) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .1, d + .1, acc), 0, h + .05, -d / 2);
    poster(g, .78, .4, 0, -.42, 1.05, .012); poster(g, .78, .4, 1, .42, 1.05, .012);
    poster(g, .78, .4, 2, -.42, .55, .012); poster(g, .78, .4, 3, .42, .55, .012);
    const side = panel(d * .7, .5, new THREE.MeshBasicMaterial({ map: ADS[2] })); side.rotation.y = Math.PI / 2; add(g, side, w / 2 + .012, .9, -d / 2);
    add(g, cyl(.04, .04, .3, darkMat, 6), 0, h + .2, -d / 2 + .2);
    const mg = megaphone(acc); mg.rotation.y = -1.15; mg.scale.setScalar(1.25); add(g, mg, 0, h + .45, -d / 2 + .2);
    tumba(g, w / 2 + .75, .65);
    g.userData.top = h + 1.1; return g;
  }
  if (L === 2) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
    adScreen(g, w * .8, w * .4, 0, .95, 0);
    neonEdge(g, w, d, h, neon, false);
    add(g, box(.4, .05, .05, darkMat), w / 2 + .2, h - .35, .1);
    const mg2 = megaphone(acc); mg2.rotation.y = 1.2; add(g, mg2, w / 2 + .42, h - .35, .15);
    add(g, box(w * .6 + .06, .4, .06, darkMat), 0, h + .3, -.3);
    add(g, sign(['РЕКЛАМА'], T.neon, w * .6, .34), 0, h + .3, -.265);
    tumba(g, -w / 2 - .55, .65);
    g.userData.top = h + .9; return g;
  }
  if (L === 3) {
    body(g, w, h, d, wall);
    add(g, box(w + .1, .12, d + .1, trim), 0, h + .06, -d / 2);
    front(g, w * .5, 1.1, winMat, -w * .18, .75);
    front(g, .6, 1.2, M(0x1c1d26), w * .32, .6);
    frontSign(g, 'РЕКЛАМА', T.neon, w * .6, 1.62);
    adScreen(g, w * .8, w * .4, 0, 2.55, 0);
    roofSign(g, 'АГЕНТСТВО', T.accent, w * .75, h + .7, -.5);
    tumba(g, w / 2 + .5, .7);
    g.userData.top = h + 1.3; return g;
  }
  if (L === 4) {
    add(g, box(w - .3, h, d - .3, wall), 0, h / 2, -d / 2);
    [1.4, 2.8].forEach(y => add(g, box(w - .04, .08, d - .04, whiteMat), 0, y, -d / 2));
    front(g, w * .7, 1.1, winMat, -.25, .7, -.138);
    front(g, .6, 1.2, M(0x1c1d26), w * .33, .6, -.138);
    for (let i = 0; i < 4; i++) front(g, .55, .5, winMat, -w / 2 + .15 + (i + .5) * (w - .3) / 4, 3.75, -.138);
    const glass = box(w, h, d, glassMat); glass.castShadow = false; glass.receiveShadow = false; add(g, glass, 0, h / 2, -d / 2);
    adScreen(g, w * .88, w * .44, 0, 2.15, .04);
    neonEdge(g, w, d, h, neon, true);
    [-w * .3, 0, w * .3].forEach(x => { const sp = cyl(.08, .13, .25, darkMat, 8); sp.rotation.x = .9; add(g, sp, x, h + .12, .12); });
    frontSign(g, 'АГЕНТСТВО', T.neon, w * .5, 1.48, -.25, .06);
    g.userData.top = h + .7; return g;
  }
  body(g, w, h, d, wall);
  for (let i = 0; i < 4; i++) front(g, .35, h - 2.4, winMat, -w / 2 + .45 + i * (w - .9) / 3, 2.1 + (h - 2.4) / 2);
  front(g, w * .75, 1.2, winMat, 0, .75);
  add(g, box(w * .82, .08, .8, acc), 0, 1.45, .4);
  frontSign(g, 'МЕДИА', T.neon, w * .45, 1.78);
  add(g, box(w + .06, .14, d + .06, trim), 0, h + .07, -d / 2);
  neonEdge(g, w, d, h, neon, true);
  add(g, cyl(.08, .08, .45, darkMat, 8), 0, h + .22, -d / 2);
  const cube = new THREE.Group(); cube.position.set(0, h + 1.15, -d / 2);
  add(cube, box(1.3, 1.3, 1.3, darkMat), 0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const holder = new THREE.Group(); holder.rotation.y = k * Math.PI / 2;
    const pn = panel(1.24, .62, new THREE.MeshBasicMaterial({ map: ADS[k] })); pn.position.z = .655; holder.add(pn); cube.add(holder);
  }
  g.add(cube);
  add(g, cyl(.03, .03, 1.3, darkMat, 6), w / 2 - .3, h + .65, -d + .4);
  const blink = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
  add(g, new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), blink), w / 2 - .3, h + 1.33, -d + .4);
  addAnim(g, t => { cube.rotation.y = t * .45; blink.visible = (t % 1.2) < .6; });
  tumba(g, w / 2 + .5, .75);
  g.userData.top = h + 2.3; return g;
}

