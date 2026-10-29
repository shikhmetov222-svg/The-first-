// Сгенерировано скриптом app/scripts/port-city.py из docs/city-mockup.html — не править руками.
import * as THREE from 'three';

/**
 * Город игрока: дома, районы, разметка, детали, участки, транспорт, стройка, день/ночь, рост города.
 * k — набор деталей (street/gen/kit.js, с кэшем материалов), types — здания бизнесов (street/gen/types.js),
 * ctx — связь с игрой: scene, camera, hemi, dir, seed, stage, stageCap, plots, me, mergeStatic, hash, slotSeed,
 * clock, heatOn, onFinished.
 */
export function createCity(k, types, ctx) {
  const { scene, hemi, dir } = ctx;
  const { M, add, addAnim, box, brickMat, bricks, bulbMat, cafeTable, clamp, concreteMat, cone, cyl, darkMat, eaveRoof, excavator, front, gable, glassMat, glow, glowMat, leafMat, mixerTruck, pallet, panel, parcelStack, person, pool, poolMat, poster, rand, ribs, rollDoor, roofSign, rr, sandPile, sign, signTex, steelMat, towerCrane, tree, van, wheel, whiteMat, winMat, woodMat } = k;
  const { TYPES, buildLot, makeFor, disposeGroup } = types;
  /* ===================== YOUR CITY ===================== */
  let seed = ctx.seed;
  const srand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const spick = a => a[Math.floor(srand() * a.length)];
  const fmt = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';

  const mergeStatic = ctx.mergeStatic;

  /* ---------- palettes & shared parts for houses ---------- */
  const PASTEL = [0xd9a38f, 0xe3cf9e, 0x9fb7c9, 0xb9c9a7, 0xe6ddd0, 0xc9a6b5, 0xf0d9b5, 0xb7c4d6];
  const PANEL = [0xd9d6cf, 0xc9c6be, 0xe2e0da, 0xbfc3c7, 0xd6cdbf];
  const ACCENT = [0x3f6fbf, 0xb5543c, 0x3fbf8f, 0xf2a65a, 0x8b5cf6, 0xe07a9a, 0x14b8a6];
  const ROOFS = [0x9c4a35, 0x4f5b66, 0x6b4a3a, 0x5d6f5a, 0x7a3b2e];
  const STALIN = [0xe8c98f, 0xd9b48a, 0xe3d3b0, 0xc9a07a, 0xd7b9a0];
  const WOOD = [0x7a5236, 0x5d7a4a, 0x6b7fa0, 0x8a6a45];
  const DOORS = [0x4a5d72, 0x6b3f2e, 0x3f5e4a, 0x8a2f2f];
  const CARCOL = [0xd4a73a, 0xe5e7eb, 0xb5543c, 0x3f6fbf, 0x3fbf8f, 0xf0ece4, 0x6c7bd9, 0x2b2d33];
  const FRAME = M(0xefe9df), DARKF = M(0x2b2d33), RAIL = M(0x3a3d44), PLINTH = M(0x6f6a66), FLATROOF = M(0x55585f), GLASSP = M(0x9fc4dd, { roughness: .2 });
  const WIN_ON = new THREE.MeshBasicMaterial({ color: 0xffc66b }), WIN_OFF = new THREE.MeshBasicMaterial({ color: 0x2b3140 });
  ctx.mutable.add(WIN_ON); ctx.mutable.add(WIN_OFF);
  const winPick = p => srand() < (p === undefined ? .35 : p) ? WIN_ON : WIN_OFF;

  function wgrid(g, x0, x1, y0, rows, fh, cols, pw, ph, z, frame, skip){
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (skip && skip(r, c)) continue;
      const x = x0 + (c + .5) * (x1 - x0) / cols, y = y0 + r * fh;
      if (frame) add(g, panel(pw + .1, ph + .1, frame), x, y, z + .006);
      add(g, panel(pw, ph, winPick()), x, y, z + .012);
    }
  }
  function sideGrid(g, xFace, zA, zB, y0, rows, fh, cols, pw, ph){
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const p = panel(pw, ph, winPick()); p.rotation.y = Math.PI / 2;
      add(g, p, xFace + .012, y0 + r * fh, zA + (c + .5) * (zB - zA) / cols);
    }
  }
  function entrance(g, x, z, roofM){
    add(g, panel(.55, .9, M(spick(DOORS))), x, .45, z + .012);
    add(g, box(.9, .06, .5, roofM || FLATROOF), x, 1.05, z + .25);
    add(g, box(.9, .12, .4, PLINTH), x, .06, z + .2);
    add(g, new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 5), bulbMat), x, .98, z + .06);
  }
  function bush(g, x, y, z, r){
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), M(spick([0x3f8f5a, 0x4f9a62, 0x356f48])));
    b.castShadow = true; b.scale.y = .85; add(g, b, x, y, z);
  }

  /* ---------- house types ---------- */
  function cottage(){
    const g = new THREE.Group();
    const two = srand() < .35, w = 2.6 + srand() * .7, d = 2.6, h = two ? 2.5 : 1.5, hz = -1.1;
    const wall = M(spick(PASTEL)), roof = M(spick(ROOFS));
    add(g, box(w, h, d, wall), 0, h / 2, hz - d / 2);
    if (srand() < .5) add(g, gable(w + .3, d + .3, .95, roof), 0, h, hz + .15);
    else add(g, eaveRoof(w + .3, d + .3, .9, roof), 0, h, hz - d / 2);
    const dx = w * .22;
    add(g, panel(.5, .95, M(spick(DOORS))), dx, .48, hz + .012);
    add(g, box(.8, .06, .5, roof), dx, 1.08, hz + .25);
    add(g, panel(.56, .5, FRAME), -w * .2, .85, hz + .006); add(g, panel(.46, .4, winPick(.45)), -w * .2, .85, hz + .012);
    if (two) [-w * .2, dx].forEach(x => { add(g, panel(.56, .5, FRAME), x, 1.9, hz + .006); add(g, panel(.46, .4, winPick(.45)), x, 1.9, hz + .012); });
    if (srand() < .6) add(g, box(.28, .7, .28, PLINTH), w * .28, h + .55, hz - d * .6);
    if (srand() < .4) { add(g, box(.12, .3, .12, M(0x2b2d33)), -w / 2 + .3, h - .1, hz + .2); }
    const fm = srand() < .5 ? FRAME : woodMat;
    for (let x = -2.7; x <= 2.71; x += .3) if (Math.abs(x - dx) > .35) add(g, box(.05, .45, .05, fm), x, .225, .25);
    add(g, box(5.5, .05, .04, fm), 0, .36, .25);
    add(g, box(.7, .02, 1.25, M(0xcdbfa8)), dx, .03, -.45);
    for (let k = 0; k < 3; k++) bush(g, -2.4 + srand() * 1.6, .22, -.25 - srand() * .6, .2 + srand() * .2);
    if (srand() < .35) { const c = carMesh(spick(CARCOL)); c.rotation.y = Math.PI / 2; add(g, c, w / 2 + .85, .02, -.9); }
    g.userData.info = { kind: two ? 'Частный дом в два этажа' : 'Частный дом', floors: two ? 2 : 1, residents: 3 + Math.floor(srand() * 3) };
    g.userData.trees = srand() < .7 ? [[-2.3, -3.2], [2.3, -3.4]] : [[2.4, -3.3]];
    g.userData.fw = 5.8;
    return g;
  }
  function woodHouse(){
    const g = new THREE.Group();
    const w = 3.4, d = 3, h = 2.4, hz = -.9;
    const wall = M(spick(WOOD)), roof = M(spick([0x4f5b66, 0x5d6f5a, 0x7a3b2e]));
    add(g, box(w, h, d, wall), 0, h / 2, hz - d / 2);
    for (let y = .3; y < h; y += .3) add(g, box(w + .02, .03, .02, M(0x3a2a1c)), 0, y, hz + .012);
    add(g, gable(w + .3, d + .3, 1.2, roof), 0, h, hz + .15);
    add(g, new THREE.Mesh(new THREE.CircleGeometry(.2, 12), winPick(.4)), 0, h + .45, hz + .16);
    [[-1.05, .85], [1.05, .85], [-1.05, 1.85], [0, 1.85], [1.05, 1.85]].forEach(([x, y]) => {
      add(g, panel(.62, .66, FRAME), x, y, hz + .02);
      add(g, panel(.44, .5, winPick(.4)), x, y, hz + .026);
      const top = gable(.72, .05, .2, FRAME); top.castShadow = false; add(g, top, x, y + .34, hz + .07);
    });
    add(g, panel(.55, 1.0, M(0x5a3a22)), 0, .5, hz + .012);
    add(g, box(5.6, .65, .06, M(0x6b4a2f)), 0, .33, .2);
    add(g, panel(.7, .6, M(0x4a321f)), 0, .33, .235);
    bush(g, -2.2, .25, -.5, .3); bush(g, 2.2, .25, -.4, .28);
    g.userData.info = { kind: 'Старый деревянный дом', floors: 2, residents: 4 + Math.floor(srand() * 5) };
    g.userData.trees = [[2.4, -3.4]];
    g.userData.fw = 5.8;
    return g;
  }
  function townHouse(g, x0, w, h, style){
    const d = 2.5, zf = 0, cx = x0 + w / 2;
    const wall = M(spick(PASTEL)), roof = M(spick(ROOFS));
    add(g, box(w, h, d, wall), cx, h / 2, -d / 2);
    add(g, box(w + .04, .45, .06, PLINTH), cx, .225, .03);
    const floors = Math.max(2, Math.floor((h - .4) / 1.05)), cols = 2, doorCol = Math.floor(srand() * cols);
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const x = x0 + (c + .5) * w / cols, y = .95 + f * 1.05;
      if (f === 0 && c === doorCol) {
        add(g, box(.9, .12, .4, PLINTH), x, .06, .2);
        add(g, panel(.5, .9, M(spick(DOORS))), x, .6, zf + .012);
        add(g, box(.8, .06, .45, roof), x, 1.2, .22);
        add(g, new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 5), bulbMat), x, 1.12, .06);
      } else {
        add(g, panel(.48, .56, FRAME), x, y, zf + .006);
        add(g, panel(.36, .44, winPick()), x, y, zf + .012);
        if (style === 'flat' && f > 0 && c === 1) { add(g, box(.8, .06, .4, FRAME), x, y - .38, .2); add(g, box(.8, .3, .03, RAIL), x, y - .22, .39); }
      }
    }
    if (style === 'gable') {
      add(g, gable(w + .15, d + .15, .9, roof), cx, h, .075);
      add(g, new THREE.Mesh(new THREE.CircleGeometry(.17, 14), winPick(.5)), cx, h + .33, .08);
      add(g, box(.28, .7, .28, PLINTH), cx + w * .25, h + .55, -1.5);
    } else if (style === 'flat') {
      add(g, box(w + .2, .18, d + .2, FRAME), cx, h + .09, -d / 2);
    } else {
      add(g, eaveRoof(w + .2, d + .2, .85, roof), cx, h, -d / 2);
      add(g, box(.7, .5, .6, wall), cx, h + .3, -.5);
      add(g, gable(.85, .7, .35, roof), cx, h + .55, -.15);
      add(g, panel(.3, .3, winPick(.5)), cx, h + .3, -.19);
    }
  }
  function townhousePair(){
    const g = new THREE.Group(); let x = -2.95, fl = 0;
    for (let k = 0; k < 2; k++) { const w = 2.75 + srand() * .15, h = 3.1 + srand() * 2; townHouse(g, x, w, h, spick(['gable', 'flat', 'eave'])); fl = Math.max(fl, Math.floor((h - .4) / 1.05)); x += w + .1; }
    g.userData.info = { kind: 'Городские дома', floors: fl, residents: 14 + Math.floor(srand() * 12) };
    g.userData.fw = 5.9;
    return g;
  }
  function khrushchevka(){
    const g = new THREE.Group();
    const w = 5.7, d = 3.2, floors = 5, fh = .85, h = floors * fh + .25;
    const wall = M(spick(srand() < .3 ? [0xb46a4e, 0xa85f45] : PANEL));
    add(g, box(w, h, d, wall), 0, h / 2, -d / 2);
    add(g, box(w + .1, .12, d + .1, FLATROOF), 0, h + .06, -d / 2);
    const cols = 7, ent = [1, 5];
    wgrid(g, -w / 2, w / 2, .55, floors, fh, cols, .38, .42, 0, null, (r, c) => r === 0 && ent.includes(c));
    ent.forEach(c => entrance(g, -w / 2 + (c + .5) * w / cols, 0));
    [2, 4].forEach(c => {
      const x = -w / 2 + (c + .5) * w / cols;
      for (let r = 1; r < floors; r++) { const y = .55 + r * fh - .28; add(g, box(.66, .05, .32, FLATROOF), x, y, .16); add(g, box(.66, .22, .03, srand() < .5 ? wall : RAIL), x, y + .13, .31); }
    });
    sideGrid(g, w / 2, -d + .4, -.4, .55, floors, fh, 2, .38, .42);
    add(g, box(.4, .3, .4, FLATROOF), -1.5, h + .27, -1.5);
    g.userData.info = { kind: 'Пятиэтажка', floors, residents: 60 + Math.floor(srand() * 20) };
    g.userData.fw = 5.8;
    return g;
  }
  function panelTower(tall){
    const g = new THREE.Group();
    const floors = tall ? 12 + Math.floor(srand() * 5) : 9 + Math.floor(srand() * 2), fh = .78;
    const w = 4.2, d = 3.6, h = floors * fh + .3, wall = M(spick(PANEL)), acc = M(spick(ACCENT));
    add(g, box(w, h, d, wall), 0, h / 2, -d / 2);
    add(g, box(w + .08, .14, d + .08, FLATROOF), 0, h + .07, -d / 2);
    add(g, box(1.3, .7, 1.3, wall), -.6, h + .35, -d / 2);
    add(g, cyl(.02, .02, 1.2, RAIL, 4), 1.2, h + .6, -d / 2);
    const lx = w / 2 - .7;
    for (let r = 1; r < floors; r++) { const y = .5 + r * fh; add(g, box(1.1, .5, .12, acc), lx, y - .05, .06); add(g, panel(.8, .32, winPick()), lx, y - .02, .125); }
    wgrid(g, -w / 2, w / 2 - 1.4, .5, floors, fh, 3, .38, .44, 0, null, (r, c) => r === 0 && c === 1);
    entrance(g, -w / 2 + 1.5 * (w - 1.4) / 3, 0, acc);
    sideGrid(g, w / 2, -d + .4, -.4, .5, floors, fh, 3, .34, .42);
    g.userData.info = { kind: floors + '-этажный панельный дом', floors, residents: floors * 16 };
    g.userData.fw = 4.4;
    return g;
  }
  function stalinka(){
    const g = new THREE.Group();
    const w = 5.7, d = 3.4, floors = 5 + Math.floor(srand() * 2), fh = 1.0, h = floors * fh + .3;
    const wall = M(spick(STALIN)), base = M(0x8a7a66);
    add(g, box(w, h, d, wall), 0, h / 2, -d / 2);
    add(g, box(w + .04, 1.0, .06, base), 0, .5, .03);
    add(g, box(w + .3, .22, d + .3, FRAME), 0, h + .11, -d / 2);
    add(g, box(w + .1, .1, .1, FRAME), 0, 1.05, .05);
    [-w / 2 + .2, -w / 6, w / 6, w / 2 - .2].forEach(x => add(g, box(.16, h - 1.1, .06, FRAME), x, 1.1 + (h - 1.1) / 2, .03));
    const cols = 5;
    wgrid(g, -w / 2, w / 2, 1.6, floors - 1, fh, cols, .42, .6, .06, FRAME);
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (c + .5) * w / cols;
      const m = c === 2 ? M(spick(DOORS)) : winPick(.55);
      add(g, panel(.5, .52, m), x, .46, .07);
      add(g, new THREE.Mesh(new THREE.CircleGeometry(.25, 12, 0, Math.PI), m), x, .72, .07);
    }
    if (srand() < .4) add(g, eaveRoof(w + .1, d + .1, .7, M(0x4f5b66)), 0, h + .22, -d / 2);
    if (srand() < .3) {
      add(g, box(1.1, 1.4, 1.1, wall), w / 2 - .7, h + .92, -.7);
      add(g, box(1.2, .12, 1.2, FRAME), w / 2 - .7, h + 1.66, -.7);
      add(g, cyl(.35, .35, .5, wall, 8), w / 2 - .7, h + 1.97, -.7);
      add(g, cone(.38, 1.4, M(0xd4a73a, { metalness: .4, roughness: .4 }), 8), w / 2 - .7, h + 2.92, -.7);
      add(g, new THREE.Mesh(new THREE.OctahedronGeometry(.16, 0), new THREE.MeshBasicMaterial({ color: 0xff4d4d })), w / 2 - .7, h + 3.75, -.7);
    }
    sideGrid(g, w / 2, -d + .4, -.4, 1.6, floors - 1, fh, 2, .42, .6);
    g.userData.info = { kind: 'Сталинка', floors, residents: floors * 12 };
    g.userData.fw = 5.9;
    return g;
  }
  function modernTower(){
    const g = new THREE.Group();
    const floors = 10 + Math.floor(srand() * 8), fh = .8, w = 4.4, d = 3.6, h = floors * fh + .5;
    const wall = M(spick([0xf0efe9, 0x3a3d44, 0xe8e2d6, 0x9aa3ad])), acc = M(spick(ACCENT));
    add(g, box(w, h, d, wall), 0, h / 2, -d / 2);
    add(g, panel(w * .9, .8, winPick(.75)), 0, .5, .012);
    add(g, box(w + .1, .08, .6, acc), 0, 1.0, .3);
    for (let r = 1; r < floors; r++) {
      const y = .6 + r * fh;
      for (let c = 0; c < 4; c++) {
        const x = -w / 2 + (c + .5) * w / 4;
        add(g, panel(.55, .5, winPick()), x, y, .012);
        if ((c + r) % 3 === 0) add(g, panel(.22, .5, acc), x + .41, y, .008);
      }
      if (r % 2 === 0) { add(g, box(1.7, .05, .42, FLATROOF), -w / 2 + 1.05, y - .3, .21); add(g, box(1.7, .26, .02, GLASSP), -w / 2 + 1.05, y - .15, .42); }
    }
    add(g, box(w, .3, .04, RAIL), 0, h + .15, -.02);
    bush(g, -1.2, h + .25, -1.2, .3); bush(g, 1, h + .25, -2, .35);
    sideGrid(g, w / 2, -d + .4, -.4, .6 + fh, floors - 1, fh, 3, .4, .5);
    g.userData.info = { kind: 'Новостройка, ' + floors + ' этажей', floors, residents: floors * 18 };
    g.userData.fw = 4.6;
    return g;
  }
  function loft(){
    const g = new THREE.Group();
    const floors = 3 + Math.floor(srand() * 2), fh = 1.15, w = 5.7, d = 3.2, h = floors * fh + .3;
    const wall = M(spick([0x9a4b35, 0x7f3f2c, 0xa85f45]));
    add(g, box(w, h, d, wall), 0, h / 2, -d / 2);
    add(g, box(w + .12, .18, d + .12, DARKF), 0, h + .09, -d / 2);
    wgrid(g, -w / 2, w / 2, .75, floors, fh, 4, .75, .8, 0, DARKF, (r, c) => r === 0 && c === 2);
    entrance(g, -w / 2 + 2.5 * w / 4, 0, DARKF);
    if (srand() < .6) {
      const tx = -w / 4, tz = -d / 2, wood = M(0x6b4a2f);
      [[-.4, -.4], [.4, -.4], [-.4, .4], [.4, .4]].forEach(([a, b]) => add(g, cyl(.04, .04, 1, DARKF, 5), tx + a, h + .5, tz + b));
      add(g, cyl(.55, .55, .9, wood, 12), tx, h + 1.45, tz);
      add(g, cone(.6, .45, DARKF, 12), tx, h + 2.12, tz);
    }
    sideGrid(g, w / 2, -d + .4, -.4, .75, floors, fh, 2, .6, .7);
    g.userData.info = { kind: 'Кирпичный лофт', floors, residents: floors * 8 };
    g.userData.fw = 5.9;
    return g;
  }
  function office(){
    const g = new THREE.Group();
    const kind = srand(), floors = 10 + Math.floor(srand() * 9), fh = .8;
    let info;
    if (kind < .45) {
      const w = 4.4, d = 3.6, h = floors * fh + .4;
      add(g, box(w - .3, h, d - .3, M(0x2b2f38)), 0, h / 2, -d / 2);
      wgrid(g, -w / 2 + .15, w / 2 - .15, .6, floors, fh, 5, .6, .55, -.15);
      sideGrid(g, w / 2 - .15, -d + .5, -.5, .6, floors, fh, 4, .5, .55);
      const gl = box(w, h, d, glassMat); gl.castShadow = false; add(g, gl, 0, h / 2, -d / 2);
      add(g, box(w + .1, .25, d + .1, M(spick(ACCENT))), 0, h + .12, -d / 2);
      add(g, cyl(.9, .9, .06, FLATROOF, 16), 0, h + .28, -d / 2);
      info = 'Стеклянный офисный центр';
    } else if (kind < .7) {
      const r = 1.75, h = floors * fh + .4;
      add(g, cyl(r, r, h, M(0x7f9bb5, { roughness: .25, metalness: .3 }), 16), 0, h / 2, -r - .05);
      for (let f = 1; f <= floors; f++) add(g, cyl(r + .02, r + .02, .18, winPick(.5), 16), 0, f * fh, -r - .05);
      add(g, cyl(r * .6, r * .8, 1.2, M(0x2b2f38), 16), 0, h + .6, -r - .05);
      add(g, cyl(.03, .03, 2, RAIL, 4), 0, h + 2.2, -r - .05);
      info = 'Башня бизнес-центра';
    } else {
      const w = 5.2, d = 3.4, h1 = 6 * fh, h2 = (floors - 6) * fh;
      add(g, box(w, h1, d, M(0xd8dde3)), 0, h1 / 2, -d / 2);
      wgrid(g, -w / 2, w / 2, .5, 6, fh, 6, .55, .5, 0);
      add(g, box(w * .6, h2, d * .75, M(0x9fb0c3)), -.4, h1 + h2 / 2, -d / 2);
      wgrid(g, -w * .3 - .4, w * .3 - .4, h1 + .4, floors - 6, fh, 4, .5, .5, -d * .125);
      add(g, box(w * .6 + .1, .2, d * .75 + .1, M(spick(ACCENT))), -.4, h1 + h2 + .1, -d / 2);
      info = 'Деловой центр';
    }
    g.userData.info = { kind: info, floors, residents: 0, workers: floors * 40 };
    g.userData.fw = 5.4;
    return g;
  }
  function warehouseInd(){
    const g = new THREE.Group();
    const w = 5.6, h = 2.4, d = 3.6, wall = M(spick([0xb9bec8, 0x9aa3ad, 0x8a8f98, 0x7f8f7a]));
    add(g, box(w, h, d, wall), 0, h / 2, -d / 2);
    ribs(g, w, h - .1, .02, M(0x8f949c));
    add(g, box(w + .12, .12, d + .12, FLATROOF), 0, h + .06, -d / 2);
    rollDoor(g, 1.5, 1.6, -1.4, 0, .04); rollDoor(g, 1.5, 1.6, .6, 0, .04);
    add(g, box(.5, .35, .5, steelMat), 1.8, h + .3, -1.5);
    if (srand() < .5) { const t = van(0xf0ece4, spick(ACCENT)); add(g, t, -.6, 0, 1.0); }
    else { parcelStack(g, 2.1, .5, 3); pallet(g, 2.4, .9); }
    g.userData.info = { kind: 'Склад', floors: 1, residents: 0, workers: 25 };
    g.userData.fw = 5.8;
    return g;
  }
  function plant(){
    const g = new THREE.Group();
    const w = 5, h = 3, d = 3.4;
    add(g, box(w, h, d, brickMat), 0, h / 2, -d / 2);
    wgrid(g, -w / 2, w / 2, 1.6, 1, 1, 5, .6, .9, 0, DARKF);
    rollDoor(g, 1.4, 1.2, 1.4, 0, .02);
    [[-1.4, -2.4], [-.4, -2.6]].forEach(([x, z]) => {
      add(g, cyl(.28, .34, 6, brickMat, 12), x, 3, z);
      add(g, cyl(.3, .3, .3, whiteMat, 12), x, 5.1, z); add(g, cyl(.3, .3, .3, M(0xd63c3c), 12), x, 5.6, z);
      g.userData.smoke = (g.userData.smoke || []).concat([{ x, y: 6.1, z, kind: 'smoke' }]);
    });
    add(g, cyl(.12, .12, 3.4, steelMat, 8), 1.6, h + .6, -2.2);
    g.userData.info = { kind: 'Завод', floors: 2, residents: 0, workers: 120 };
    g.userData.fw = 5.4;
    return g;
  }
  function tanks(){
    const g = new THREE.Group();
    [-1.4, 1.4].forEach(x => {
      add(g, cyl(1.2, 1.2, 2.4, M(0xe5e7eb), 18), x, 1.2, -1.6);
      add(g, new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(0xe5e7eb)), x, 2.4, -1.6);
      add(g, cyl(1.22, 1.22, .2, M(spick(ACCENT)), 18), x, 1.6, -1.6);
    });
    add(g, box(5.6, .05, .05, RAIL), 0, .6, .1);
    for (let x = -2.8; x <= 2.81; x += .7) add(g, box(.05, .7, .05, RAIL), x, .35, .1);
    g.userData.info = { kind: 'Нефтебаза', floors: 0, residents: 0, workers: 15 };
    g.userData.fw = 5.8;
    return g;
  }
  function garages(){
    const g = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const x = -2.4 + k * 1.2;
      add(g, box(1.15, 1.0, 2.6, M(0x8a8f98)), x, .5, -1.6);
      add(g, panel(.9, .8, M(spick([0x6b7280, 0x3f6fbf, 0x5d6f5a, 0x8a2f2f, 0xb5543c]))), x, .42, -.29);
    }
    add(g, box(6.1, .08, 2.8, FLATROOF), 0, 1.04, -1.6);
    g.userData.info = { kind: 'Гаражный кооператив', floors: 1, residents: 0, workers: 3 };
    g.userData.fw = 6;
    return g;
  }
  function containers(){
    const g = new THREE.Group();
    const cols = [0xb5543c, 0x3f6fbf, 0x3fbf8f, 0xf2a65a, 0x6b7280];
    for (let layer = 0; layer < 3; layer++) for (let k = 0; k < 2; k++) for (let r = 0; r < 2; r++) {
      if (layer === 2 && srand() < .5) continue;
      const m = M(spick(cols)), x = -1.3 + k * 2.6, z = -1 - r * 1.1, y = .5 + layer * 1.0;
      add(g, box(2.5, .98, 1.05, m), x, y, z);
      for (let xx = x - 1.1; xx < x + 1.2; xx += .3) add(g, box(.03, .9, .02, m), xx, y, z + .53);
    }
    g.userData.info = { kind: 'Контейнерный склад', floors: 0, residents: 0, workers: 10 };
    g.userData.fw = 5.4;
    return g;
  }

  /* ---------- landmarks: each one changes demand around it ---------- */
  function crossSign(g, x, y, z){
    add(g, panel(.9, .9, M(0xffffff)), x, y, z);
    add(g, panel(.6, .18, new THREE.MeshBasicMaterial({ color: 0xe03131 })), x, y, z + .005);
    add(g, panel(.18, .6, new THREE.MeshBasicMaterial({ color: 0xe03131 })), x, y, z + .006);
  }
  function school(){
    const g = new THREE.Group(), wall = M(0xe8d5b0), acc = M(0xb5543c);
    add(g, box(7, 2.8, 3.2, wall), -2.3, 1.4, -1.6);
    add(g, box(7.2, .16, 3.4, acc), -2.3, 2.88, -1.6);
    wgrid(g, -5.8, 1.2, .75, 3, .85, 7, .62, .55, 0, FRAME, (r, c) => r === 0 && c === 3);
    add(g, panel(.8, 1.0, M(0x4a5d72)), -2.3, .5, .012);
    add(g, box(1.6, .08, .8, acc), -2.3, 1.15, .4); add(g, box(1.6, .12, .6, PLINTH), -2.3, .06, .3);
    add(g, box(3.2, .5, .06, darkMat), -2.3, 2.45, .04); add(g, sign(['ШКОЛА №7'], '#F2C46B', 3.1, .44), -2.3, 2.45, .075);
    add(g, box(4.2, .04, 3.4, M(0x4f9a62)), 3.6, .14, -1.8);
    [[3.6, -1.8, 4.0, .04], [3.6, -.15, 4.0, .04], [3.6, -3.45, 4.0, .04]].forEach(([x, z, w]) => add(g, box(w, .02, .05, whiteMat), x, .17, z));
    add(g, box(.05, .02, 3.3, whiteMat), 1.6, .17, -1.8); add(g, box(.05, .02, 3.3, whiteMat), 5.6, .17, -1.8);
    [1.7, 5.5].forEach(x => { add(g, box(.05, .5, .05, whiteMat), x, .4, -1.3); add(g, box(.05, .5, .05, whiteMat), x, .4, -2.3); add(g, box(.05, .05, 1.0, whiteMat), x, .65, -1.8); });
    add(g, cyl(.03, .03, 2.6, RAIL, 5), 1.3, 1.3, .3);
    add(g, box(.6, .4, .02, M(0xffffff)), 1.6, 2.3, .3); add(g, box(.6, .13, .021, M(0x3f6fbf)), 1.6, 2.24, .3); add(g, box(.6, .13, .022, M(0xd63c3c)), 1.6, 2.11, .3);
    g.userData.info = { kind: 'Школа №7', floors: 3, residents: 0, workers: 620, stats: [['Учеников', '≈ 620'], ['Спрос утром', '+20%']], note: 'Утром дети и родители берут выпечку и кофе. Пекарне и кофейне рядом выгодно.' };
    g.userData.fw = 11.6; return g;
  }
  function hospital(){
    const g = new THREE.Group(), wall = M(0xf2f2ee), acc = M(0xd63c3c);
    add(g, box(8, 3.6, 3.4, wall), -1.6, 1.8, -1.7);
    add(g, box(8.1, .25, .08, acc), -1.6, 1.2, .04);
    wgrid(g, -5.6, 2.4, .7, 4, .85, 8, .55, .5, 0, null, (r, c) => r === 0 && (c === 3 || c === 4));
    add(g, panel(1.4, 1.0, winPick(.8)), -1.6, .5, .012); add(g, box(2.4, .08, 1.0, acc), -1.6, 1.1, .5);
    crossSign(g, -1.6, 3.1, .02);
    add(g, cyl(1.0, 1.0, .05, M(0x55585f), 16), -1.6, 3.63, -1.7);
    const hp = panel(1.2, 1.2, new THREE.MeshBasicMaterial({ map: signTex(['H'], '#ffffff', 256, 256), transparent: false }));
    hp.rotation.x = -Math.PI / 2; add(g, hp, -1.6, 3.66, -1.7);
    const amb = van(0xf2f2ee, 0xd63c3c); add(g, amb, 4.3, 0, -.9);
    add(g, box(.5, .08, .2, new THREE.MeshBasicMaterial({ color: 0x3b82f6 })), 4.9, 1.0, -.9);
    g.userData.info = { kind: 'Городская больница', floors: 4, residents: 0, workers: 900, stats: [['Посетителей в день', '≈ 900'], ['Работает', 'круглосуточно']], note: 'Врачи и посетители покупают кофе и продукты круглые сутки, даже ночью.' };
    g.userData.fw = 11.6; return g;
  }
  function mall(){
    const g = new THREE.Group(), wall = M(0xd8dde3), acc = M(0x8b5cf6);
    add(g, box(11.2, 2.9, 3.5, wall), 0, 1.45, -1.75);
    add(g, panel(4.5, 2.1, winPick(.85)), 0, 1.15, .012);
    for (let x = -5; x <= 5; x += 1) if (Math.abs(x) > 2.4) add(g, box(.18, 2.9, .2, acc), x, 1.45, .05);
    add(g, box(5, .1, 1.2, acc), 0, 2.25, .6);
    roofSign(g, 'ТРЦ ГОРОД', '#C4B5FD', 4.6, 3.75, -.4);
    for (let k = 0; k < 7; k++) add(g, box(.05, .01, 1.2, whiteMat), -4.6 + k * 1.3, 2.91, -2.2);
    for (let k = 0; k < 6; k++) if (srand() < .7) { const c = carMesh(spick(CARCOL)); c.rotation.y = Math.PI / 2; add(g, c, -4 + k * 1.3, 2.92, -2.2); }
    g.userData.info = { kind: 'ТРЦ «Город»', floors: 2, residents: 0, workers: 3000, stats: [['Посетителей в день', '≈ 3 000'], ['Магазинам рядом', 'тяжело']], note: 'Сам торгует продуктами, поэтому магазину рядом трудно. Но приводит толпы: кофейне и ПВЗ рядом выгодно.' };
    g.userData.fw = 11.6; return g;
  }
  function theatre(){
    const g = new THREE.Group(), wall = M(0xe9dcc0), trim = M(0xf7f2e6), roofG = M(0x6f7f8f), gold = M(0xd4a73a, { metalness: .5, roughness: .35 });
    add(g, box(8.6, 3.4, 3.0, wall), 0, 1.7, -2.2);
    add(g, box(8.8, .25, 3.2, trim), 0, 3.5, -2.2);
    add(g, eaveRoof(8.8, 3.2, .7, roofG), 0, 3.62, -2.2);
    add(g, box(4.6, .3, 1.5, trim), 0, .15, -.1);
    add(g, box(4.4, .14, 1.3, trim), 0, .37, -.15);
    for (let k = 0; k < 6; k++) add(g, cyl(.16, .18, 2.6, trim, 10), -1.9 + k * .76, 1.74, -.15);
    add(g, box(4.6, .3, 1.5, trim), 0, 3.15, -.15);
    const ped = gable(4.6, 1.5, .9, trim); add(g, ped, 0, 3.3, .6);
    add(g, new THREE.Mesh(new THREE.CircleGeometry(.28, 16), gold), 0, 3.62, .62);
    [-1.5, 0, 1.5].forEach(x => { add(g, panel(.7, 1.6, winPick(.85)), x, 1.25, -.69); add(g, new THREE.Mesh(new THREE.CircleGeometry(.35, 12, 0, Math.PI), winPick(.85)), x, 2.05, -.69); });
    [-3.6, 3.6].forEach(x => { wgrid(g, x - .9, x + .9, 1.0, 2, 1.2, 2, .45, .7, -.7, trim); });
    add(g, box(4.0, .55, .06, darkMat), 0, 2.85, -.64 + .76);
    add(g, sign(['ТЕАТР'], '#F2C46B', 3.9, .48), 0, 2.85, -.64 + .8);
    [[-3.2, 2], [3.2, 3]].forEach(([x, i]) => { add(g, box(.95, 1.4, .06, darkMat), x, .9, .2); poster(g, .85, .45, i, x, 1.2, .24); poster(g, .85, .45, i + 1, x, .7, .24); });
    [-2.6, 2.6].forEach(x => { add(g, cyl(.04, .05, 1.8, darkMat, 6), x, .9, .7); add(g, new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), bulbMat), x, 1.85, .7); });
    g.userData.info = { kind: 'Драмтеатр', floors: 2, residents: 0, workers: 120, stats: [['Зрителей вечером', '≈ 600'], ['Спрос вечером', '+30%']], note: 'Вечером перед спектаклем и после него у кофейни и пекарни рядом очередь.' };
    g.userData.fw = 11.6; return g;
  }
  function metroPavilion(g, x, z){
    add(g, box(1.6, 1.1, 1.2, GLASSP), x, .67, z);
    add(g, box(1.8, .12, 1.4, M(0x2b2d33)), x, 1.28, z);
    add(g, panel(1.0, .9, M(0x1c2a3a)), x, .56, z + .61);
    add(g, cyl(.04, .04, 1.6, darkMat, 6), x + 1.1, .8, z + .4);
    const m = panel(.6, .6, new THREE.MeshBasicMaterial({ map: signTex(['М'], '#ff4d4d', 256, 256) }));
    add(g, m, x + 1.1, 1.75, z + .42);
  }

  /* ---------- courtyard fillers ---------- */
  function playground(g, x, z){
    add(g, box(1.3, .1, 1.3, woodMat), x - 1.2, .17, z);
    add(g, box(1.1, .06, 1.1, M(0xe8d3a0)), x - 1.2, .21, z);
    const ramp = box(.4, .05, 1.4, M(0xd63c3c)); ramp.rotation.x = .55; add(g, ramp, x + .4, .55, z + .3);
    add(g, box(.5, .9, .5, M(0x3f6fbf)), x + .4, .45, z - .5);
    [[1.2, -.4], [2.4, -.4]].forEach(([a, b]) => { add(g, box(.06, 1.2, .06, M(0xf2c94c)), x + a, .6, z + b); add(g, box(.06, 1.2, .06, M(0xf2c94c)), x + a, .6, z + b + .9); });
    add(g, box(1.3, .06, .06, M(0xf2c94c)), x + 1.8, 1.2, z - .4); add(g, box(1.3, .06, .06, M(0xf2c94c)), x + 1.8, 1.2, z + .5);
    add(g, box(.06, .06, .96, M(0xf2c94c)), x + 1.8, 1.2, z + .05);
    add(g, box(.35, .04, .2, woodMat), x + 1.6, .45, z + .05); add(g, box(.35, .04, .2, woodMat), x + 2.05, .45, z + .05);
  }
  function parking(g, x, z, n){
    for (let k = 0; k < n; k++) {
      add(g, box(.05, .01, 1.4, whiteMat), x - n * .55 + k * 1.1, .14, z);
      if (srand() < .75) { const c = carMesh(spick(CARCOL)); c.rotation.y = Math.PI / 2; add(g, c, x - n * .55 + k * 1.1 + .55, .1, z); }
    }
  }
  function benchesPlaza(g, x, z){
    add(g, box(6, .03, 2.4, M(0xcdbfa8)), x, .14, z);
    [-1.6, 1.6].forEach(dx => {
      add(g, box(1.1, .08, .35, M(0x6b4a2f)), x + dx, .42, z - .7); add(g, box(1.1, .3, .06, M(0x6b4a2f)), x + dx, .66, z - .86);
      add(g, box(.06, .4, .3, darkMat), x + dx - .48, .2, z - .7); add(g, box(.06, .4, .3, darkMat), x + dx + .48, .2, z - .7);
    });
    add(g, cyl(.6, .6, .3, M(0x5a4636), 12), x, .25, z + .3);
    for (let k = 0; k < 6; k++) add(g, new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), M(spick([0xe07a9a, 0xf2c46b, 0xffffff]))), x + rand(-.4, .4), .45, z + .3 + rand(-.4, .4));
  }

  /* ---------- districts ---------- */
  const DISTRICTS = {
    center: { bt: 'coffee', name: 'Старый город', note: 'туристы и прогулки, дорогая земля', likes: ['кофе', 'выпечка', 'реклама'], base: .9, mix: [stalinka, stalinka, stalinka, townhousePair, townhousePair, loft] },
    sleep: { bt: 'shop', name: 'Спальный район', note: 'много жителей, покупают каждый день', likes: ['продукты', 'посылки', 'хлеб'], base: .8, mix: [panelTower, () => panelTower(true), () => panelTower(true), khrushchevka, khrushchevka, khrushchevka] },
    private: { bt: 'bakery', name: 'Частный сектор', note: 'семьи с машинами, тихо', likes: ['хлеб', 'ремонт', 'продукты'], base: .45, mix: [cottage, cottage, cottage, cottage, woodHouse, woodHouse] },
    business: { bt: 'ads', name: 'Деловой квартал', note: 'офисы и большие бюджеты', likes: ['реклама', 'кофе', 'доставка'], base: .75, mix: [office, office, office, office, loft, modernTower] },
    industry: { bt: 'repair', name: 'Промзона', note: 'дешёвая земля, удобно для складов', likes: ['склады', 'стройматериалы'], base: .3, mix: [warehouseInd, warehouseInd, plant, tanks, garages, containers] },
    newres: { bt: 'pvz', name: 'Новый район', note: 'молодые семьи, много онлайн-заказов', likes: ['посылки', 'кофе', 'доставка'], base: .7, mix: [modernTower, modernTower, modernTower, modernTower, townhousePair, () => panelTower(true)] }
  };
  const DMAP = [['industry', 'industry', 'business'], ['private', 'center', 'business'], ['private', 'park', 'newres'], ['sleep', 'sleep', 'newres']];
  // the city grows with the player's capital: districts open stage by stage
  const STAGE_OF = { center: 1, sleep: 1, park: 1, private: 2, industry: 2, business: 3, newres: 4 };
  const STAGE_CAP = ctx.stageCap;
  let cityStage = ctx.stage;
  const isLocked = b => !!b && STAGE_OF[b.d] > cityStage;
  // landmarks take two back-row slots (k and k+1)
  const LANDMARKS = [{ i: 1, j: 1, k: 0, fn: () => theatre() }, { i: 1, j: 3, k: 1, fn: () => school() }, { i: 2, j: 2, k: 2, fn: () => hospital() }, { i: 2, j: 0, k: 0, fn: () => mall() }];

  /* ---------- layout ---------- */
  const PW = 6, BW = 24, BD = 11, SW = 2.2, ST = 5;
  const SX = BW + 2 * SW + ST, SZ = BD + 2 * SW + ST;
  const COLS = 3, ROWS = 4;
  const cityW = COLS * SX + ST, cityD = ROWS * SZ + ST;
  const blocks = [];
  for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) blocks.push({ i, j, x: (i - 1) * SX, z: (j - 1.5) * SZ, d: DMAP[j][i] });
  const blk = (i, j) => blocks.find(b => b.i === i && b.j === j);

  const envMats = [];
  function EM(day, night){ const m = new THREE.MeshStandardMaterial({ color: day, roughness: .9, flatShading: true }); envMats.push([m, day, night]); ctx.mutable.add(m); return m; }
  const grassMat = EM(0x6f8f57, 0x1b2620), asphaltMat = EM(0x4a4d55, 0x202227), walkMat = EM(0xb9bcc2, 0x3a3e48), dirtMat = EM(0x9a9486, 0x34322e);
  const parkMat = EM(0x7fa565, 0x1f2e22), pathMat = EM(0xd8cdb6, 0x4a463e), stoneMat = EM(0x9a968e, 0x45433f), riverMat = EM(0x4f8fc0, 0x14243a), sandMat = EM(0xd9c79a, 0x3a352a);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), grassMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  add(scene, box(cityW, .04, cityD, asphaltMat), 0, .02, 0);
  const rz = cityD / 2 + 11;
  add(scene, box(500, .05, 3, sandMat), 0, .03, rz - 5.2);
  add(scene, box(500, .05, 8, riverMat), 0, .025, rz);
  add(scene, box(500, .05, 3, sandMat), 0, .03, rz + 5.2);
  add(scene, box(6, .3, 13, stoneMat), 0, .5, rz - .3);
  [-2.8, 2.8].forEach(x => add(scene, box(.12, .5, 13, RAIL), x, .9, rz - .3));
  add(scene, box(6, .04, 6, asphaltMat), 0, .03, cityD / 2 + 3);

  const dashGeo = new THREE.BoxGeometry(1, .01, .12), dashMatC = new THREE.MeshBasicMaterial({ color: 0x9a9fa8 });
  const dashSpots = [];
  for (let j = 0; j <= ROWS; j++) { if (j === 2) continue; const z = (j - 2) * SZ; for (let x = -cityW / 2 + 1; x < cityW / 2; x += 2) dashSpots.push([x, z, 0]); }
  for (let i = 0; i <= COLS; i++) { const x = (i - 1.5) * SX; for (let z = -cityD / 2 + 1; z < cityD / 2; z += 2) dashSpots.push([x, z, 1]); }
  const dashes = new THREE.InstancedMesh(dashGeo, dashMatC, dashSpots.length);
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(1, 1, 1), tmpP = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  dashSpots.forEach(([x, z, v], k) => { tmpQ.setFromAxisAngle(UP, v ? Math.PI / 2 : 0); tmpM.compose(tmpP.set(x, .045, z), tmpQ, tmpS); dashes.setMatrixAt(k, tmpM); });
  scene.add(dashes);

  const treeSpots = [];
  for (let k = 0; k < 170; k++) {
    const a = srand() * Math.PI * 2, r = srand();
    const x = Math.cos(a) * (cityW / 2 + 5 + r * 34), z = Math.sin(a) * (cityD / 2 + 5 + r * 26);
    if (Math.abs(z - rz) < 7) continue;
    if (x > cityW / 2 + 8 && x < cityW / 2 + 42 && z > -30 && z < 5) continue;   // stadium
    if (Math.abs(z) < 4 && Math.abs(x) > cityW / 2) continue;                       // highway
    if (x < -cityW / 2 - 6 && x > -cityW / 2 - 40 && z > -16 && z < -2) continue;     // roadside stop
    if (x < -cityW / 2 - 6 && z < -cityD / 2 - 4) continue;                          // fields
    if (x > cityW / 2 + 4 && z < -cityD / 2 - 4) continue;                           // dachas
    treeSpots.push([x, z, .9 + srand() * .6]);
  }

  /* ---------- boulevard with a tree-lined median and a monument ---------- */
  const outskirts = new THREE.Group();
  for (let i = 0; i < COLS; i++) {
    const x0 = (i - 1.5) * SX + 3.6, x1 = (i - .5) * SX - 3.6;
    add(outskirts, box(x1 - x0, .16, 1.3, parkMat), (x0 + x1) / 2, .08, 0);
    for (let x = x0 + 1; x < x1; x += 3) treeSpots.push([x, 0, .7]);
  }
  (function monument(){
    const mx = 0, gold = M(0xd4a73a, { metalness: .5, roughness: .35 });
    add(outskirts, box(1.2, 1.2, 1.2, stoneMat), mx, .7, 0);
    add(outskirts, cyl(.25, .3, 1.2, gold, 10), mx, 1.9, 0);
    add(outskirts, new THREE.Mesh(new THREE.SphereGeometry(.22, 10, 8), gold), mx, 2.7, 0);
  })();

  /* ---------- highway out of town ---------- */
  [-1, 1].forEach(s => {
    const len = 200, cx = s * (cityW / 2 + len / 2);
    add(outskirts, box(len, .05, 5, asphaltMat), cx, .03, 0);
    for (let x = cityW / 2 + 1; x < cityW / 2 + len; x += 3) add(outskirts, box(1.4, .01, .14, M(0xe8e8e8)), s * x, .06, 0);
  });

  /* ---------- fields and dachas ---------- */
  const fieldCols = [0xd9c26a, 0x8fbf5a, 0x6f8f3a, 0xc9a96a, 0xa3c46a], fieldMats = {};
  for (let a = 0; a < 3; a++) for (let c = 0; c < 2; c++) {
    const fx = -cityW / 2 - 18 - a * 15, fz = -cityD / 2 - 14 - c * 13, col = spick(fieldCols);
    if (!fieldMats[col]) fieldMats[col] = [EM(col, new THREE.Color(col).multiplyScalar(.25).getHex()), EM(new THREE.Color(col).multiplyScalar(.8).getHex(), 0x15201a)];
    add(outskirts, box(13, .06, 11, fieldMats[col][0]), fx, .04, fz);
    for (let r = -4.5; r <= 4.5; r += 1) add(outskirts, box(12.6, .02, .12, fieldMats[col][1]), fx, .08, fz + r);
  }
  for (let k = 0; k < 12; k++) {
    const dx = cityW / 2 + 10 + (k % 4) * 7, dz = -cityD / 2 - 12 - Math.floor(k / 4) * 8;
    const hw = 1.6 + srand() * .6, hh = 1.0 + srand() * .4, wall = M(spick(PASTEL)), roof = M(spick(ROOFS));
    add(outskirts, box(hw, hh, 1.8, wall), dx, hh / 2, dz);
    add(outskirts, gable(hw + .2, 2.0, .7, roof), dx, hh, dz + 1.0);
    add(outskirts, panel(.4, .35, winPick(.4)), dx - .3, .65, dz + .91);
    for (let x = -2.6; x <= 2.61; x += .4) add(outskirts, box(.04, .35, .04, woodMat), dx + x, .18, dz + 2.4);
    add(outskirts, box(5.2, .03, 3.6, M(0x6b5a3a)), dx, .05, dz + .4);
    for (let r = 0; r < 3; r++) treeSpots.push([dx - 2 + r * 2 + srand() * .6, dz - 1.8, .7 + srand() * .3]);
  }
  for (let x = -12; x < 30; x += 1) if (srand() < .9) treeSpots.push([-cityW / 2 - 14 - srand() * 30, -20 + x * 1.5, 1 + srand() * .5]);

  /* ---------- stadium on the edge of town ---------- */
  let stadiumHome = null;
  (function stadium(){
    const sx = cityW / 2 + 25, sz = -13;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.12, 2.6, 36, 1, true), M(0x9fb0c3, { side: THREE.DoubleSide }));
    bowl.scale.set(13, 1, 8.5); bowl.position.set(sx, 1.3, sz); bowl.castShadow = true; bowl.receiveShadow = true; outskirts.add(bowl);
    const seats = new THREE.Mesh(new THREE.CylinderGeometry(.95, .78, 2.2, 36, 1, true), M(0xd63c3c, { side: THREE.DoubleSide }));
    seats.scale.set(13, 1, 8.5); seats.position.set(sx, 1.25, sz); outskirts.add(seats);
    const track = new THREE.Mesh(new THREE.CylinderGeometry(9.9, 9.9, .05, 36), M(0xb5543c)); track.scale.z = 8.5 / 13 * 1.0; track.position.set(sx, .12, sz); outskirts.add(track);
    const pitch = box(13, .06, 6.6, M(0x4f9a62)); pitch.position.set(sx, .15, sz); pitch.castShadow = false; outskirts.add(pitch);
    for (let k = -2; k <= 2; k++) add(outskirts, box(2.6, .01, 6.6, M(k % 2 ? 0x5aa86d : 0x4f9a62)), sx + k * 2.6, .19, sz);
    add(outskirts, box(.06, .02, 6.6, whiteMat), sx, .2, sz);
    [[-9.5, -6], [9.5, -6], [-9.5, 6], [9.5, 6]].forEach(([a, c]) => {
      add(outskirts, cyl(.12, .16, 6, darkMat, 6), sx + a, 3, sz + c);
      add(outskirts, box(1.2, .6, .2, M(0xe5e7eb)), sx + a, 6.1, sz + c);
      glow(sx + a, 6.1, sz + c, 3.2);
    });
    add(outskirts, box(5, .7, .1, darkMat), sx, 3.2, sz + 8.7);
    add(outskirts, sign(['СТАДИОН'], '#F2C46B', 4.8, .6), sx, 3.2, sz + 8.76);
    stadiumHome = { x: sx, z: sz, hw: 13, hd: 8.5, front: true, info: { kind: 'Стадион', floors: 0, residents: 0, workers: 0, stats: [['Зрителей в матч', '≈ 25 000'], ['Спрос в дни матчей', '×3']], note: 'В дни матчей толпа идёт через весь город: кофе, продукты и выпечка продаются в несколько раз лучше.' }, dist: { name: 'Окраина', likes: [] }, px: sx, pz: sz + 8.5, b: null, box: new THREE.Box3(new THREE.Vector3(sx - 13, 0, sz - 8.5), new THREE.Vector3(sx + 13, 3, sz + 8.5)) };
    add(outskirts, box(28, .05, 6, asphaltMat), sx, .03, sz - 11.8);
    add(outskirts, box(4, .05, 9, asphaltMat), sx, .03, sz + 7.5);
  })();
  mergeStatic(outskirts); scene.add(outskirts);

  /* ---------- small details, placed a little irregularly ---------- */
  const details = new THREE.Group();
  function busStop(x, z){
    add(details, box(1.7, .06, .75, M(0x3a3d44)), x, 1.35, z);
    add(details, box(1.7, 1.1, .04, GLASSP), x, .8, z - .32);
    add(details, box(.05, 1.3, .05, RAIL), x - .82, .7, z - .32); add(details, box(.05, 1.3, .05, RAIL), x + .82, .7, z - .32);
    add(details, box(1.1, .06, .3, M(0x6b4a2f)), x, .45, z - .15);
    add(details, cyl(.03, .03, 1.9, RAIL, 5), x + 1.15, .95, z + .2);
    add(details, panel(.42, .42, new THREE.MeshBasicMaterial({ map: signTex(['А'], '#2DD4BF', 128, 128) })), x + 1.15, 1.85, z + .23);
  }
  function roadSign(x, z, kind){
    add(details, cyl(.025, .025, 1.6, RAIL, 5), x, .85, z);
    if (kind === 0) { add(details, cyl(.22, .22, .03, new THREE.MeshBasicMaterial({ color: 0xd63c3c }), 14).rotateX(Math.PI / 2), x, 1.6, z + .02); add(details, cyl(.16, .16, .035, new THREE.MeshBasicMaterial({ color: 0xffffff }), 14).rotateX(Math.PI / 2), x, 1.6, z + .03); }
    else if (kind === 1) add(details, box(.36, .36, .03, new THREE.MeshBasicMaterial({ color: 0x3f6fbf })), x, 1.6, z + .02);
    else { const t = new THREE.Mesh(new THREE.CircleGeometry(.24, 3), new THREE.MeshBasicMaterial({ color: 0xf2c94c })); t.rotation.z = Math.PI / 2; add(details, t, x, 1.6, z + .03); }
  }
  blocks.forEach(b => {
    if (b.d === 'park' || STAGE_OF[b.d] > 1) return;
    if (srand() < .8) { const kk = 1 + Math.floor(srand() * 3); busStop(b.x - BW / 2 + kk * PW + rand(-.4, .4), b.z + BD / 2 + 1.2); }
  });
  for (let i = 0; i <= COLS; i++) for (let j = 0; j <= ROWS; j++) {
    if (srand() < .55) continue;
    const x = (i - 1.5) * SX + (srand() < .5 ? -3.2 : 3.2), z = (j - 2) * SZ + 3.1 + rand(-.2, .2);
    if (Math.abs(x) < cityW / 2 && Math.abs(z) < cityD / 2) roadSign(x, z, Math.floor(srand() * 3));
  }
  // roadside stop on the highway: gas station, car wash and an all-night cafe
  (function roadside(){
    const rx = -cityW / 2 - 22, rz2 = -8;
    add(details, box(7, .04, 9, asphaltMat), rx, .04, rz2 + .5);
    add(details, box(6, .22, 3.6, M(0xf0ece4)), rx, 2.4, rz2);
    add(details, box(6.04, .14, 3.64, M(0xd63c3c)), rx, 2.25, rz2);
    [[-2.6, -1.5], [2.6, -1.5], [-2.6, 1.5], [2.6, 1.5]].forEach(([a, c]) => add(details, box(.18, 2.3, .18, M(0xf0ece4)), rx + a, 1.15, rz2 + c));
    [-1.2, 1.2].forEach(a => { add(details, box(.5, 1.0, .35, M(0xd63c3c)), rx + a, .5, rz2); add(details, panel(.3, .2, new THREE.MeshBasicMaterial({ color: 0x9fe6ff })), rx + a, .8, rz2 + .18); });
    add(details, box(4, 2, 2.6, M(0xe5e7eb)), rx, 1, rz2 - 3.6);
    add(details, panel(2.4, 1.0, winPick(.9)), rx - .4, .8, rz2 - 2.29);
    add(details, box(2.6, .5, .06, darkMat), rx, 1.75, rz2 - 2.27); add(details, sign(['АЗС 24'], '#F07167', 2.5, .44), rx, 1.75, rz2 - 2.23);
    add(details, cyl(.06, .06, 3.2, RAIL, 6), rx + 3.2, 1.6, rz2 + 2.4);
    add(details, box(1.1, 1.2, .1, darkMat), rx + 3.2, 3.3, rz2 + 2.4); add(details, sign(['95', '58,90'], '#F2C46B', 1.0, 1.1), rx + 3.2, 3.3, rz2 + 2.46);
    const wx = rx + 8;
    add(details, box(3.4, 2.2, 3.2, M(0x9fc4dd)), wx, 1.1, rz2 - 1);
    add(details, panel(2.2, 1.7, M(0x1c2a3a)), wx, .85, rz2 + .61);
    add(details, box(3, .5, .06, darkMat), wx, 2.45, rz2 + .62); add(details, sign(['МОЙКА'], '#60A5FA', 2.9, .44), wx, 2.45, rz2 + .66);
    const cx2 = rx - 8;
    add(details, box(3.6, 1.8, 2.8, M(0xf2c94c)), cx2, .9, rz2 - 1);
    add(details, eaveRoof(3.8, 3.0, .6, M(0xd63c3c)), cx2, 1.8, rz2 - 1);
    add(details, panel(2.6, .9, winPick(.9)), cx2, .9, rz2 + .41);
    add(details, box(2.8, .5, .06, darkMat), cx2, 2.75, rz2 + .4); add(details, sign(['КАФЕ 24'], '#F2C46B', 2.7, .44), cx2, 2.75, rz2 + .44);
    for (let k = 0; k < 3; k++) { const t = cafeTable(0xd63c3c); t.scale.setScalar(.8); t.position.set(cx2 - 1.2 + k * 1.2, .04, rz2 + 1.6); details.add(t); }
    for (let k = 0; k < 4; k++) { const c = carMesh(spick(CARCOL)); c.rotation.y = Math.PI / 2; c.position.set(rx - 2.4 + k * 1.6, .04, rz2 + 3.6); details.add(c); }
    glow(rx, 2.2, rz2, 3.5); pool(rx, rz2, 7);
  })();
  mergeStatic(details); scene.add(details);

  /* ---------- business plots ---------- */
  const BIZ = ctx.plots;
  const plots = BIZ.map(bz => {
    const b = blk(bz.i, bz.j), D = DISTRICTS[b.d];
    const p = Object.assign({ block: b, x: b.x - BW / 2 + PW / 2 + bz.k * PW, z: b.z + BD / 2, rot: 0, dist: D }, bz);
    p.cx = p.x; p.cz = p.z - 1.6;
    p.demand = clamp(D.base + (ctx.hash(bz.i, bz.j, bz.k) - .5) * .2, .05, 1);
    if (p.lot) { p.level = 0; p.price = bz.price || 0; }
    return p;
  });
  const isBiz = (b, k, front) => front && plots.some(p => p.block === b && p.k === k);

  /* ---------- construction site for districts that are not open yet ---------- */
  function siteFor(b){
    const g = new THREE.Group(), cap = STAGE_CAP[STAGE_OF[b.d]];
    add(g, box(BW + 2 * SW - .4, .05, BD + 2 * SW - .4, M(0x8a7a5e)), b.x, .14, b.z);
    const fm = M(0xf97316), wm = M(0xf0ece4);
    for (let x = -BW / 2; x <= BW / 2 + .01; x += 1.2) add(g, box(.06, .9, .06, fm), b.x + x, .55, b.z + BD / 2 + .9);
    for (let x = -BW / 2; x < BW / 2; x += 1.2) add(g, box(1.2, .18, .04, Math.round(x / 1.2) % 2 ? fm : wm), b.x + x + .6, .75, b.z + BD / 2 + .9);
    towerCrane(g, b.x + 7, b.z - 2.5, 8, 0xf97316);
    sandPile(g, b.x - 4, b.z - 1); sandPile(g, b.x + 1, b.z + 1.5);
    bricks(g, b.x - 8, b.z + 1); bricks(g, b.x - 7, b.z + 1.2);
    add(g, box(4.6, 1.5, .08, darkMat), b.x - 3, 2.3, b.z + BD / 2 - .2);
    add(g, cyl(.06, .06, 1.6, darkMat, 6), b.x - 4.8, .8, b.z + BD / 2 - .2); add(g, cyl(.06, .06, 1.6, darkMat, 6), b.x - 1.2, .8, b.z + BD / 2 - .2);
    add(g, sign(['СТРОЙКА', 'откроется при ' + fmt(cap)], '#FB923C', 4.5, 1.4), b.x - 3, 2.3, b.z + BD / 2 - .15);
    mergeStatic(g); g.userData.siteOf = b;
    return g;
  }

  /* ---------- build the blocks ---------- */
  const homes = [];   // footprints of residential & industrial buildings for tapping
  const smokeSpots = [];
  blocks.forEach(b => {
    add(scene, box(BW + 2 * SW, .12, BD + 2 * SW, b.d === 'park' ? parkMat : b.d === 'industry' ? dirtMat : walkMat), b.x, .06, b.z);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const x = b.x + sx * (BW / 2 + SW - .35), z = b.z + sz * (BD / 2 + SW - .35);
      add(scene, cyl(.05, .07, 2.4, darkMat, 6), x, 1.2, z);
      add(scene, new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 6), bulbMat), x, 2.45, z);
      glow(x, 2.45, z, 1.7); pool(x, z, 4.5);
    });
    if (b.d === 'park') return;
    for (let k = 0; k <= 4; k++) treeSpots.push([b.x - BW / 2 + k * PW, b.z + BD / 2 + SW - .45, .75, b]);
    const G = new THREE.Group();
    const D = DISTRICTS[b.d];
    [true, false].forEach(front => {
      for (let k = 0; k < 4; k++) {
        seed = ctx.slotSeed(b.i, b.j, k, front ? 1 : 0);
        if (isBiz(b, k, front)) continue;
        const lm = front ? null : LANDMARKS.find(l => l.i === b.i && l.j === b.j && (k === l.k || k === l.k + 1));
        if (lm && k === lm.k + 1) continue;
        const h = lm ? lm.fn() : spick(D.mix)();
        // both rows face the camera: the back row opens onto the courtyard, like real city blocks
        const x = b.x - BW / 2 + PW / 2 + k * PW + (lm ? PW / 2 : 0), z = b.z + (front ? BD / 2 : -BD / 2 + 3.8);
        h.position.set(x, 0, z); G.add(h);
        (h.userData.trees || []).forEach(([tx, tz]) => treeSpots.push([x + tx, z + tz, .8 + srand() * .4, b]));
        (h.userData.smoke || []).forEach(e => smokeSpots.push({ x: x + e.x, y: e.y, z: z + e.z, kind: e.kind, b }));
        const fd = 3.8;
        h.updateMatrixWorld(true);
        homes.push({ x, z: z - fd / 2, hw: (h.userData.fw || 5.6) / 2, hd: fd / 2 + .4, front, info: h.userData.info, dist: D, px: x, pz: z, b, box: new THREE.Box3().setFromObject(h) });
      }
    });
    if ((b.i === 1 && b.j === 1) || (b.i === 0 && b.j === 3)) {
      const mx = b.x + BW / 2 + .9, mz = b.z + BD / 2 + 1.0;
      metroPavilion(G, mx, mz);
      homes.push({ x: mx, z: mz, hw: 1.2, hd: 1.0, front: true, info: { kind: 'Станция метро', floors: 1, residents: 0, workers: 30, stats: [['Пассажиров в день', '≈ 12 000'], ['Час пик', '8:00 и 18:00']], note: 'Поток людей утром и вечером: кофе с собой и ПВЗ у метро зарабатывают больше.' }, dist: D, px: mx, pz: mz + .7, b, box: new THREE.Box3(new THREE.Vector3(mx - 1, 0, mz - .7), new THREE.Vector3(mx + 1, 2, mz + .7)) });
    }
    seed = ctx.slotSeed(b.i, b.j, 9, 0);
    // courtyard between the two rows
    const cz = b.z;
    if ((b.d === 'sleep' || b.d === 'newres') && (b.i + b.j) % 2 === 1) {
      add(G, box(5.6, .04, 3.0, M(0xd9813b)), b.x + 6, .14, cz); add(G, box(5.2, .02, .05, whiteMat), b.x + 6, .17, cz);
      add(G, box(.05, .02, 2.8, whiteMat), b.x + 6, .17, cz);
      [-2.6, 2.6].forEach(dx => { add(G, cyl(.04, .04, 1.6, RAIL, 5), b.x + 6 + dx, .8, cz); add(G, box(.06, .45, .6, whiteMat), b.x + 6 + dx * .95, 1.5, cz); add(G, new THREE.Mesh(new THREE.TorusGeometry(.14, .02, 5, 10), M(0xd63c3c)), b.x + 6 + dx * .88, 1.32, cz); });
      playground(G, b.x - 6, cz); for (let k = 0; k < 4; k++) treeSpots.push([b.x - 11 + k * 1.6, cz + (k % 2 ? .9 : -.9), .8, b]);
    }
    else if (b.d === 'sleep' || b.d === 'newres') { playground(G, b.x - 6, cz); parking(G, b.x + 6, cz, 6); for (let k = 0; k < 4; k++) treeSpots.push([b.x - 11 + k * 1.6, cz + (k % 2 ? .9 : -.9), .8, b]); }
    else if (b.d === 'center') { benchesPlaza(G, b.x - 6, cz); benchesPlaza(G, b.x + 6, cz); }
    else if (b.d === 'business') { benchesPlaza(G, b.x, cz); parking(G, b.x - 8, cz, 4); parking(G, b.x + 8, cz, 4); }
    else if (b.d === 'industry') { parking(G, b.x - 5, cz, 6); const t = van(0xe5e7eb, 0xf97316); add(G, t, b.x + 7, 0, cz); }
    else { for (let k = 0; k < 6; k++) treeSpots.push([b.x - 10 + k * 4, cz + (srand() - .5) * 1.5, .9 + srand() * .4, b]); }
    b.pairs = []; mergeStatic(G, b.pairs); G.userData.block = b; scene.add(G); b.G = G;
    b.site = siteFor(b); scene.add(b.site);
  });

  seed = ctx.slotSeed(9, 9, 9, 9);
  // city park with a pond and the season trophy
  let fountainJet = null;
  (function park(){
    const b = blocks.find(q => q.d === 'park'), { x, z } = b;
    add(scene, box(BW + 2 * SW - .6, .03, 1.4, pathMat), x, .135, z);
    add(scene, box(1.4, .03, BD + 2 * SW - .6, pathMat), x - 6, .135, z);
    const pond = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, .05, 24), new THREE.MeshBasicMaterial({ color: 0x5fb7e8 }));
    pond.scale.z = .55; add(scene, pond, x + 5.5, .14, z + 2.2);
    add(scene, cyl(1.4, 1.5, .4, stoneMat, 20), x - 6, .32, z);
    const water = new THREE.MeshBasicMaterial({ color: 0x5fb7e8, transparent: true, opacity: .85 });
    add(scene, new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, .05, 20), water), x - 6, .53, z);
    add(scene, cyl(.12, .16, 1.0, stoneMat, 8), x - 6, .95, z);
    fountainJet = new THREE.Mesh(new THREE.ConeGeometry(.18, .8, 8), water); add(scene, fountainJet, x - 6, 1.75, z);
    const tx = x + 4, tz = z - 2.6;
    add(scene, box(1.2, .9, 1.2, stoneMat), tx, .57, tz);
    const goldM = M(0xd4a73a, { metalness: .5, roughness: .35 });
    add(scene, cyl(.32, .18, .55, goldM, 16), tx, 1.45, tz); add(scene, cyl(.08, .08, .25, goldM, 8), tx, 1.07, tz); add(scene, cyl(.25, .25, .06, goldM, 12), tx, .99, tz);
    [-1, 1].forEach(s => { const h = new THREE.Mesh(new THREE.TorusGeometry(.15, .035, 6, 12), goldM); h.rotation.y = Math.PI / 2; add(scene, h, tx + s * .36, 1.5, tz); });
    add(scene, box(1.0, .3, .04, darkMat), tx, .62, tz + .62);
    add(scene, sign(['ТОП-3', 'сезона'], '#D4A73A', .95, .28), tx, .62, tz + .645);
    [[-10, 3.5], [-10, -3.5], [-2, 4], [-2, -4], [9, -3.5], [10.5, -1], [-13, 0], [1, 4.6], [12, 4], [-4.5, 4.5], [-8, -4.6], [7, -4.8], [2.5, -4.2]].forEach(([a, c]) => treeSpots.push([x + a, z + c, 1 + srand() * .4]));
    const bn = new THREE.Group();
    [[-2.5, -1.2], [-9.5, -1.2], [1.5, 1.2]].forEach(([a, c]) => {
      add(bn, box(1.1, .08, .35, M(0x6b4a2f)), x + a, .42, z + c); add(bn, box(1.1, .3, .06, M(0x6b4a2f)), x + a, .66, z + c - .16);
    });
    mergeStatic(bn); scene.add(bn);
  })();

  const trunkI = new THREE.InstancedMesh(new THREE.CylinderGeometry(.08, .11, .9, 6), M(0x5a4030), treeSpots.length);
  const crownI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.62, 0), leafMat, treeSpots.length);
  const treeRot = treeSpots.map(() => srand() * 3);
  function writeTrees(){
    treeSpots.forEach(([x, z, s, b], k) => {
      const sc = b && isLocked(b) ? .0001 : s;
      tmpQ.identity(); tmpS.set(sc, sc, sc);
      tmpM.compose(tmpP.set(x, .45 * sc + .12, z), tmpQ, tmpS); trunkI.setMatrixAt(k, tmpM);
      tmpQ.setFromAxisAngle(UP, treeRot[k]);
      tmpM.compose(tmpP.set(x, 1.25 * sc + .12, z), tmpQ, tmpS); crownI.setMatrixAt(k, tmpM);
    });
    trunkI.instanceMatrix.needsUpdate = crownI.instanceMatrix.needsUpdate = true;
    tmpS.set(1, 1, 1);
  }
  writeTrees();
  trunkI.castShadow = crownI.castShadow = true; scene.add(trunkI, crownI);

  /* ---------- district labels ---------- */
  function labelSprite(title, sub){
    const c = document.createElement('canvas'); c.width = 1024; c.height = 200;
    const g = c.getContext('2d');
    g.font = '700 64px Unbounded, Manrope, sans-serif';
    const tw = Math.max(g.measureText(title).width, 400) + 90;
    rr(g, (1024 - tw) / 2, 10, tw, 180, 36); g.fillStyle = 'rgba(11,12,15,.78)'; g.fill();
    g.fillStyle = '#F2F2F4'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(title, 512, 78);
    g.font = '800 42px Manrope, sans-serif'; g.fillStyle = '#D4A73A'; g.fillText(sub, 512, 146);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(16, 3.1, 1); s.renderOrder = 15; return s;
  }
  const labels = [];
  const dLabels = {};
  const districtCenter = key => { const bs = blocks.filter(b => b.d === key); return [bs.reduce((a, b) => a + b.x, 0) / bs.length, bs.reduce((a, b) => a + b.z, 0) / bs.length]; };
  function placeLabel(key){
    const old = dLabels[key];
    if (old) { scene.remove(old); labels.splice(labels.indexOf(old), 1); old.material.map.dispose(); old.material.dispose(); }
    const [x, z] = districtCenter(key), locked = STAGE_OF[key] > cityStage;
    const s = labelSprite(DISTRICTS[key].name, locked ? 'откроется при ' + fmt(STAGE_CAP[STAGE_OF[key]]) : 'спрос: ' + DISTRICTS[key].likes.slice(0, 2).join(', '));
    s.position.set(x, 1.5, z); s.visible = ctx.camera.zoom < .8; scene.add(s); labels.push(s); dLabels[key] = s;
  }
  Object.keys(DISTRICTS).forEach(placeLabel);
  const parkLabel = labelSprite('Городской парк', 'кубок лучших за сезон');
  const pb = blocks.find(b => b.d === 'park'); parkLabel.position.set(pb.x, 1.5, pb.z); scene.add(parkLabel); labels.push(parkLabel);

  /* ---------- markers ---------- */
  function pinSprite(color, label){
    const c = document.createElement('canvas'); c.width = 128; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = color; g.beginPath(); g.arc(64, 58, 50, Math.PI * .82, Math.PI * 2.18); g.lineTo(64, 152); g.closePath(); g.fill();
    g.lineWidth = 6; g.strokeStyle = 'rgba(11,12,15,.85)'; g.stroke();
    g.fillStyle = '#0B0C0F'; g.beginPath(); g.arc(64, 58, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = color; g.font = '800 40px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 64, 60);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.center.set(.5, 0); s.scale.set(1.8, 2.25, 1); s.renderOrder = 20;
    return s;
  }
  function frameRect(g, w, z0, z1, mat, t){
    const y = .17;
    add(g, box(w, .05, t, mat), 0, y, z1); add(g, box(w, .05, t, mat), 0, y, z0);
    add(g, box(t, .05, z1 - z0, mat), -w / 2, y, (z0 + z1) / 2); add(g, box(t, .05, z1 - z0, mat), w / 2, y, (z0 + z1) / 2);
  }
  const goldLine = new THREE.MeshBasicMaterial({ color: 0xd4a73a });
  const selRing = new THREE.Group(); frameRect(selRing, 1, -.5, .5, new THREE.MeshBasicMaterial({ color: 0xffffff }), .02); selRing.visible = false; scene.add(selRing);
  function showRing(x, z, w, d){ selRing.visible = true; selRing.position.set(x, 0, z); selRing.scale.set(w, 1, d); }

  const myPins = [];
  function buildPlotVisual(p){
    const g = p.level === 0 ? buildLot(fmt(p.price)) : makeFor(p.type, p.level);
    g.position.set(p.x, 0, p.z); scene.add(g); p.group = g;
    g.traverse(o => { o.userData.plot = p; });
    if (p.owner && !p.owner.me) {
      const fl = new THREE.Group();
      add(fl, cyl(.03, .03, 1.5, darkMat, 5), 0, .75, 0);
      add(fl, box(.55, .32, .03, M(0x8a8f98)), .29, 1.32, 0);
      fl.position.set(-PW / 2 + .35, 0, .35); g.add(fl);
    }
    if (p.owner && p.owner.me) {
      // your businesses stand on a raised golden plinth and are a bit larger, so they read among the towers
      g.scale.setScalar(1.12); g.position.y = .26;
      const ped = new THREE.Group();
      add(ped, box(PW - .2, .26, 5.9, M(0xe2d3a6)), p.x, .13, p.z - .9);
      add(ped, box(PW - .1, .06, 5.98, M(0xd4a73a, { metalness: .3, roughness: .5 })), p.x, .27, p.z - .9);
      if (!p.ped) { mergeStatic(ped); scene.add(ped); p.ped = ped; }
      const fr = new THREE.Group(); frameRect(fr, PW - .5, -3.6, 1.9, goldLine, .08); g.add(fr);
      const top = g.userData.top * 1.12 + .56;
      if (!p.pin) { const pin = pinSprite('#D4A73A', 'Я'); scene.add(pin); p.pin = pin; p.pinRec = { pin, base: top, ph: rand(0, 6) }; myPins.push(p.pinRec); }
      p.pin.position.set(p.cx, top, p.cz); p.pinRec.base = top;
    }
    mergeStatic(g); g.traverse(o => { o.userData.plot = p; });
    const heat = new THREE.Mesh(new THREE.PlaneGeometry(PW - .5, 1.9), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(.62 - p.demand * .62, .85, .52), transparent: true, opacity: .62, depthWrite: false }));
    heat.rotation.x = -Math.PI / 2; heat.position.set(0, .16, 1.05); heat.visible = false; g.add(heat); p.heat = heat;
    return g;
  }
  plots.forEach(buildPlotVisual);

  /* ---------- traffic ---------- */
  function carMesh(color){
    const g = new THREE.Group();
    add(g, box(1.3, .35, .66, M(color)), 0, .32, 0);
    add(g, box(.72, .3, .6, M(0x1d2230)), -.08, .62, 0);
    [[.42, .33], [.42, -.33], [-.42, .33], [-.42, -.33]].forEach(([x, z]) => { const wh = cyl(.14, .14, .1, darkMat, 10); wh.rotation.x = Math.PI / 2; add(g, wh, x, .14, z); });
    const hl = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    add(g, box(.04, .08, .14, hl), .66, .36, .2); add(g, box(.04, .08, .14, hl), .66, .36, -.2);
    return g;
  }
  function busMesh(color){
    const g = new THREE.Group();
    add(g, box(3.2, .95, .9, M(color)), 0, .62, 0);
    add(g, box(3.0, .32, .92, M(0x1d2230)), -.05, .82, 0);
    add(g, box(.04, .5, .7, M(0x1d2230)), 1.61, .75, 0);
    [1.0, -1.0].forEach(x => { wheel(g, x, .18, .43, .18); wheel(g, x, .18, -.43, .18); });
    return g;
  }
  function truckMesh(color){
    const g = new THREE.Group();
    add(g, box(.7, .8, .8, M(color)), 1.1, .6, 0);
    add(g, box(.04, .32, .62, M(0x1d2230)), 1.46, .78, 0);
    add(g, box(2.2, 1.0, .85, M(spick([0xe5e7eb, 0x6b7280, 0x3f6fbf]))), -.5, .72, 0);
    [1.1, -.1, -1.2].forEach(x => { wheel(g, x, .18, .42, .18); wheel(g, x, .18, -.42, .18); });
    return g;
  }
  function bikeMesh(){
    const g = new THREE.Group();
    [-.32, .32].forEach(x => { const w = new THREE.Mesh(new THREE.TorusGeometry(.2, .025, 5, 12), darkMat); add(g, w, x, .22, 0); });
    add(g, box(.62, .04, .04, M(spick([0xd63c3c, 0x3f6fbf, 0x3fbf8f]))), 0, .36, 0);
    add(g, box(.04, .3, .04, darkMat), .26, .4, 0);
    const r = person(); r.scale.setScalar(.8); add(g, r, -.05, .26, 0);
    return g;
  }
  const cars = [];
  for (let k = 0; k < 20; k++) {
    const vertical = k % 2 === 1, dirn = srand() < .5 ? 1 : -1;
    const road = vertical ? (Math.floor(srand() * (COLS + 1)) - 1.5) * SX : (Math.floor(srand() * (ROWS + 1)) - 2) * SZ;
    const lane = road + dirn * (vertical ? -1.2 : 1.2);
    const c = carMesh(CARCOL[k % CARCOL.length]);
    if (vertical) { c.position.set(lane, .04, rand(-cityD / 2, cityD / 2)); c.rotation.y = dirn > 0 ? -Math.PI / 2 : Math.PI / 2; }
    else { c.position.set(rand(-cityW / 2, cityW / 2), .04, lane); c.rotation.y = dirn > 0 ? 0 : Math.PI; }
    scene.add(c); cars.push({ g: c, vertical, dir: dirn, speed: rand(3, 4.5) });
  }
  for (let k = 0; k < 8; k++) {
    const dirn = k % 2 ? 1 : -1, c = carMesh(CARCOL[(k + 3) % CARCOL.length]);
    c.position.set(rand(-140, 140), .04, dirn * 1.2); c.rotation.y = dirn > 0 ? 0 : Math.PI;
    scene.add(c); cars.push({ g: c, vertical: false, dir: dirn, speed: rand(5, 7), lim: 140 });
  }
  // buses on the boulevard and main streets, trucks around the industrial zone, bikes along the kerb
  [[0, 1.2, 1], [0, -1.2, -1], [-SZ, 1.2, 1], [SZ, -1.2, -1]].forEach(([z, off, d], k) => {
    const c = busMesh(k % 2 ? 0xf2c94c : 0x3f6fbf); c.position.set(rand(-cityW / 2, cityW / 2), .04, z + off); c.rotation.y = d > 0 ? 0 : Math.PI;
    scene.add(c); cars.push({ g: c, vertical: false, dir: d, speed: 2.6 });
  });
  [[-2 * SZ, 1.2, 1], [-2 * SZ, -1.2, -1], [-SZ, -1.2, -1]].forEach(([z, off, d]) => {
    const c = truckMesh(0xf97316); c.position.set(rand(-cityW / 2, cityW / 2), .04, z + off); c.rotation.y = d > 0 ? 0 : Math.PI;
    scene.add(c); cars.push({ g: c, vertical: false, dir: d, speed: 2.8 });
  });
  for (let k = 0; k < 8; k++) {
    const vertical = k % 2 === 0, d = srand() < .5 ? 1 : -1;
    const road = vertical ? (Math.floor(srand() * (COLS + 1)) - 1.5) * SX : (Math.floor(srand() * (ROWS + 1)) - 2) * SZ;
    const c = bikeMesh();
    if (vertical) { c.position.set(road + d * -2.1, .04, rand(-cityD / 2, cityD / 2)); c.rotation.y = d > 0 ? -Math.PI / 2 : Math.PI / 2; }
    else { c.position.set(rand(-cityW / 2, cityW / 2), .04, road + d * 2.1); c.rotation.y = d > 0 ? 0 : Math.PI; }
    scene.add(c); cars.push({ g: c, vertical, dir: d, speed: rand(1.4, 2) });
  }
  const walkers = [];
  blocks.forEach(b => {
    for (let k = 0; k < 3; k++) {
      const p = person(); const dirn = srand() < .5 ? 1 : -1;
      const z = b.d === 'park' ? b.z + (srand() - .5) * .8 : b.z + BD / 2 + SW - .9;
      p.position.set(b.x + rand(-BW / 2, BW / 2), .12, z); p.rotation.y = dirn > 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(p); walkers.push({ g: p, b, dir: dirn, speed: rand(.5, .9), ph: rand(0, 6) });
    }
  });

  /* ---------- effects ---------- */
  const tweens = [];
  function tween(dur, fn, done){ tweens.push({ t: 0, dur, fn, done }); }
  const puffGeo = new THREE.SphereGeometry(1, 7, 5);
  function puff(x, y, z, color, size, rise, life){ ctx.particles.puff(x, y, z, color, size, rise, life); }
  function coinSprite(amount){
    const c = document.createElement('canvas'); c.width = 256; c.height = 96;
    const g = c.getContext('2d');
    rr(g, 4, 8, 248, 80, 40); g.fillStyle = 'rgba(11,12,15,.88)'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#D4A73A'; g.stroke();
    g.beginPath(); g.arc(48, 48, 26, 0, Math.PI * 2); g.fillStyle = '#D4A73A'; g.fill();
    g.fillStyle = '#0B0C0F'; g.font = '800 30px Manrope, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('₽', 48, 50);
    g.fillStyle = '#F7D774'; g.font = '800 40px Manrope, sans-serif'; g.textAlign = 'left'; g.fillText('+' + amount.toLocaleString('ru-RU'), 88, 50);
    const t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(2.4, .9, 1); s.renderOrder = 21; s.userData.t = t; return s;
  }
  const myPlots = plots.filter(p => p.owner && p.owner.me);

  /* ---------- construction by stages ---------- */
  const BUILD_STAGES = [['Котлован', .19], ['Фундамент', .19], ['Каркас', .27], ['Фасад и окна', .23], ['Благоустройство', .12]];
  const BUILD_TOTAL = BUILD_STAGES.reduce((a, s2) => a + s2[1], 0);
  const BRIGADES = ['Прораб Плюс', 'СтройКом', 'Мастер и Ко'];
  function progressSprite(){
    const c = document.createElement('canvas'); c.width = 512; c.height = 120;
    const g = c.getContext('2d'), t = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(4.6, 1.08, 1); s.renderOrder = 22;
    return { sprite: s, draw(name, pct){
      g.clearRect(0, 0, 512, 120); rr(g, 4, 4, 504, 112, 26); g.fillStyle = 'rgba(11,12,15,.9)'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#FB923C'; g.stroke();
      g.fillStyle = '#F2F2F4'; g.font = '800 34px Manrope, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(name, 26, 40);
      g.textAlign = 'right'; g.fillStyle = '#FB923C'; g.fillText(Math.round(pct * 100) + '%', 486, 40);
      rr(g, 26, 72, 460, 22, 11); g.fillStyle = '#2b2d33'; g.fill();
      rr(g, 26, 72, Math.max(22, 460 * pct), 22, 11); g.fillStyle = '#FB923C'; g.fill();
      t.needsUpdate = true;
    }, dispose(){ t.dispose(); s.material.dispose(); } };
  }
  function startConstruction(p, type, level){
    if (p.build) return;
    const T = TYPES[type];
    if (p.group) p.group.visible = false;
    if (p.heat) p.heat.visible = false;
    const site = new THREE.Group(); site.position.set(p.x, 0, p.z); scene.add(site);
    const fm = M(0xf97316), wm = M(0xf0ece4), fence = new THREE.Group();
    for (let x = -2.8; x <= 2.81; x += .7) add(fence, box(.05, .8, .05, fm), x, .45, .4);
    for (let x = -2.8; x < 2.8; x += .7) add(fence, box(.7, .16, .03, Math.round((x + 2.8) / .7) % 2 ? fm : wm), x + .35, .62, .4);
    [-2.8, 2.8].forEach(x => add(fence, box(.05, .16, 4, fm), x, .62, -1.6));
    mergeStatic(fence); site.add(fence);
    const prog = progressSprite(); scene.add(prog.sprite);
    p.build = { type, level, t: 0, idx: -1, lastPct: -1, brigade: spick(BRIGADES), site, prog, sg: null };
    prog.sprite.position.set(p.cx, 5.6, p.cz);
    for (let i = 0; i < 10; i++) puff(p.x + rand(-2.4, 2.4), .3, p.z - rand(.5, 3.5), 0xb5a68a, .4, 1.2, 1.2);
  }
  function stageVisual(p, idx){
    const B = p.build;
    if (B.sg) { B.site.remove(B.sg); disposeGroup(B.sg); }
    const g = new THREE.Group(); B.sg = g; B.site.add(g); B.slabs = null; B.fb = null;
    const D = TYPES[B.type].dims[B.level], w = Math.min(D.w, 4.6), d = Math.min(D.d, 3.4), h = Math.min(D.h, 6);
    if (idx === 0) {
      add(g, box(w + .4, .05, d + .4, M(0x4a3a28)), 0, .14, -d / 2 - .2);
      add(g, cone(.8, .7, M(0x7a6248), 8), w / 2 + .3, .35, -d - .2); add(g, cone(.6, .5, M(0x7a6248), 8), -w / 2 - .1, .25, -d - .1);
      excavator(g, -.3, -d / 2, 0xf97316);
      const ex = g.children[g.children.length - 1];
      addAnim(g, t => { ex.rotation.y = Math.sin(t * 1.4) * .5; });
    } else if (idx === 1) {
      add(g, box(w, .3, d, concreteMat), 0, .15, -d / 2);
      for (let x = -w / 2 + .3; x < w / 2; x += .6) for (let z = -d + .3; z < 0; z += .6) add(g, box(.04, .6, .04, M(0x8a4a2a)), x, .6, z);
      mixerTruck(g, w / 2 + .2, .9, 0xf97316);
    } else if (idx === 2) {
      add(g, box(w, .3, d, concreteMat), 0, .15, -d / 2);
      [[-1, -1], [1, -1], [-1, 0], [1, 0], [0, -1], [0, 0]].forEach(([sx, sz]) => add(g, box(.18, h, .18, concreteMat), sx * (w / 2 - .1), h / 2, sz * (d - .1) - (sz ? 0 : .1) + (sz ? 0 : 0)));
      B.slabs = [];
      for (let y = 1.1; y < h; y += 1.1) { const sl = box(w, .12, d, concreteMat); sl.position.set(0, y, -d / 2); sl.visible = false; g.add(sl); B.slabs.push(sl); }
      towerCrane(g, w / 2 + .9, -d + .3, h + 2.5, 0xf97316);
    } else if (idx === 3) {
      const fb = makeFor(B.type, B.level); g.add(fb); B.fb = fb; fb.scale.y = .3;
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + .3, h, d + .3)), new THREE.LineBasicMaterial({ color: 0xfb923c }));
      lines.position.set(0, h / 2, -d / 2); g.add(lines);
      for (let y = .8; y < h; y += .8) add(g, box(w + .4, .05, .25, woodMat), 0, y, .2);
      towerCrane(g, w / 2 + .9, -d + .3, h + 2.5, 0xf97316);
    } else {
      const fb = makeFor(B.type, B.level); g.add(fb); B.fb = fb;
      for (let k = 0; k < 3; k++) { const pr = person(); pr.position.set(-2 + k * 1.6, 0, .9); g.add(pr); }
      add(g, cone(.35, .5, M(0x5a4636), 8), 2.3, .25, .8);
    }
  }
  function confetti(x, y, z){ ctx.particles.confetti(x, y, z); }
  function finishConstruction(p){
    const B = p.build;
    scene.remove(B.site); disposeGroup(B.site); scene.remove(B.prog.sprite); B.prog.dispose();
    const wasLot = p.level === 0;
    if (wasLot) { p.owner = B.owner || ctx.me; p.lot = false; if (p.owner.me) myPlots.push(p); }
    p.type = B.type; p.level = B.level; p.build = null;
    const old = p.group; scene.remove(old); disposeGroup(old);
    const g = buildPlotVisual(p);
    p.heat.visible = ctx.heatOn();
    const s0 = g.scale.x; g.scale.y = .01;
    tween(.9, q => { const c1 = 1.70158, c3 = c1 + 1, e = 1 + c3 * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2); g.scale.y = Math.max(.01, s0 * e); });
    confetti(p.cx, g.userData.top * 1.12 + 1, p.cz);
    ctx.onFinished(p, wasLot);
  }
  function updateConstruction(dt){
    plots.forEach(p => {
      const B = p.build; if (!B) return;
      B.t = Math.min(1, ctx.progress(p)) * BUILD_TOTAL;
      let acc = 0, idx = 0;
      for (; idx < BUILD_STAGES.length; idx++) { if (B.t < acc + BUILD_STAGES[idx][1]) break; acc += BUILD_STAGES[idx][1]; }
      if (idx >= BUILD_STAGES.length) { finishConstruction(p); return; }
      if (idx !== B.idx) {
        if (B.idx >= 0) for (let i = 0; i < 8; i++) puff(p.x + rand(-2.4, 2.4), .3, p.z - rand(.5, 3.5), 0xb5a68a, .35, 1.0, 1.0);
        B.idx = idx; stageVisual(p, idx); ctx.onStage(p, idx);
      }
      const local = (B.t - acc) / BUILD_STAGES[idx][1], pct = B.t / BUILD_TOTAL;
      if (B.slabs) { const n = Math.floor(local * (B.slabs.length + 1)); B.slabs.forEach((sl, i) => { sl.visible = i < n; }); }
      if (B.fb && idx === 3) B.fb.scale.y = .3 + .7 * local;
      if (B.sg && B.sg.userData.anims) B.sg.userData.anims.forEach(fn => fn(ctx.clock(), dt));
      if (Math.round(pct * 100) !== B.lastPct) { B.lastPct = Math.round(pct * 100); B.prog.draw(BUILD_STAGES[idx][0], pct); }
    });
  }

  /* ---------- day / night ---------- */
  function applyTime(day){
    const sky = day ? 0x9cc8ea : 0x10131d;
    scene.background.set(sky); scene.fog.color.set(sky);
    hemi.intensity = day ? .8 : .46; hemi.color.set(day ? 0xdfefff : 0x6f7fb0); hemi.groundColor.set(day ? 0x6b5a45 : 0x1a1a22);
    dir.intensity = day ? 1.0 : .3; dir.color.set(day ? 0xfff1d6 : 0x9fb0ff);
    winMat.color.set(day ? 0x9cc3e0 : 0x2a2a30); winMat.emissiveIntensity = day ? 0 : 1;
    WIN_ON.color.set(day ? 0x8fa7bd : 0xffc66b); WIN_OFF.color.set(day ? 0x8fa7bd : 0x2b3140);
    glowMat.visible = !day; poolMat.visible = !day;
    bulbMat.color.set(day ? 0xd8d8d0 : 0xffe08a);
    envMats.forEach(([m, d, n]) => m.color.set(day ? d : n));
    syncClones();
  }
  /* ---------- see-through: blocks that hide your business (or the selected building) turn translucent ---------- */
  let selected = null;
  const occl = new Set(), occRay = new THREE.Raycaster(), occV = new THREE.Vector3(), occHit = new THREE.Vector3(), occNdc = new THREE.Vector2();
  function setBlockOpacity(b, o){
    const fade = o < .999;
    b.pairs.forEach(([src, m]) => {
      const tr = fade || src.transparent;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = (src.transparent ? src.opacity : 1) * o; m.depthWrite = !fade && src.depthWrite !== false;
    });
  }
  function checkOcclusion(){
    occl.clear();
    const pts = myPlots.filter(p => p.group.visible).map(p => [p.cx, 1.4, p.z + .3]);
    if (selected) pts.push(selected);
    pts.forEach(([x, y, z]) => {
      occV.set(x, y, z).project(ctx.camera); occNdc.set(occV.x, occV.y);
      occRay.setFromCamera(occNdc, ctx.camera);
      const dist = occRay.ray.origin.distanceTo(occV.set(x, y, z));
      homes.forEach(h => {
        if (isLocked(h.b) || occl.has(h.b)) return;
        if (occRay.ray.intersectBox(h.box, occHit) && occRay.ray.origin.distanceTo(occHit) < dist - .8) occl.add(h.b);
      });
    });
  }
  function syncClones(){ blocks.forEach(b => (b.pairs || []).forEach(([src, m]) => { m.color.copy(src.color); if (src.emissive) { m.emissive.copy(src.emissive); m.emissiveIntensity = src.emissiveIntensity; } m.visible = src.visible; })); }

  /* ---------- city growth ---------- */
  const easeOut = q => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(q - 1, 3) + c1 * Math.pow(q - 1, 2); };
  function applyStage(animate){
    let k = 0;
    blocks.forEach(b => {
      if (b.d === 'park') return;
      const locked = isLocked(b);
      if (locked) { b.site.visible = true; b.G.visible = false; return; }
      const wasHidden = !b.G.visible;
      b.G.visible = true;
      if (animate && wasHidden) {
        const delay = k++ * .25, G = b.G, site = b.site;
        G.scale.y = .01;
        for (let i = 0; i < 16; i++) puff(b.x + rand(-11, 11), .4, b.z + rand(-4, 4), 0xb5a68a, .45, 1.4, 1.4);
        tween(.5 + delay, () => {}, () => { site.visible = false; tween(1.0, q => { G.scale.y = Math.max(.01, easeOut(q)); }); });
      } else { b.site.visible = false; b.G.scale.y = 1; }
    });
    plots.forEach(p => {
      const L = isLocked(p.block);
      if (!L && animate && !p.group.visible) { const g = p.group, s0 = g.scale.x; g.scale.y = .01; tween(1.6, q => { g.scale.y = Math.max(.01, s0 * easeOut(q)); }); }
      p.group.visible = !L; if (p.ped) p.ped.visible = !L; if (p.pin) p.pin.visible = !L;
    });
    walkers.forEach(w => { w.g.visible = !isLocked(w.b); });
    writeTrees();
    Object.keys(DISTRICTS).forEach(placeLabel);
  }
  applyStage(false);
  function setStage(s){ cityStage = s; }
  function setSelected(v){ selected = v; }
  return {
    blocks,
    plots,
    myPlots,
    homes,
    cars,
    walkers,
    labels,
    placeLabel,
    districtCenter,
    DISTRICTS,
    STAGE_OF,
    isLocked,
    buildPlotVisual,
    startConstruction,
    finishConstruction,
    updateConstruction,
    applyTime,
    writeTrees,
    tweens,
    tween,
    puff,
    confetti,
    myPins,
    smokeSpots,
    selRing,
    showRing,
    pinSprite,
    coinSprite,
    applyStage,
    checkOcclusion,
    setBlockOpacity,
    occl,
    syncClones,
    ground,
    BUILD_STAGES,
    BUILD_TOTAL,
    cityW,
    cityD,
    BW,
    BD,
    SW,
    PW,
    SX,
    SZ,
    COLS,
    ROWS,
    envMats,
    WIN_ON,
    WIN_OFF,
    trunkI,
    crownI,
    details,
    outskirts,
    stadiumHome,
    setStage,
    setSelected,
    getStage: () => cityStage,
    getFountainJet: () => fountainJet,
  };
}
