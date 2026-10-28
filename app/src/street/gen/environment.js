// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/** Окружение улицы. Всё добавляется в scene; возвращает то, что меняется днём/ночью и по району. */
export function createEnvironment(k, scene) {
  const { M, add, box, bulbMat, cyl, darkMat, eaveRoof, gable, glow, panel, pick, pool, rand, tree } = k;
  /* ---------- environment ---------- */
  const groundMat = M(0x1b2620), sideMat = M(0x3a3e48), roadMat = M(0x202227), curbMat = M(0x5a5f6b);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x8d929b });
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x181c28 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  add(scene, box(52, .05, 9, sideMat), 0, .025, -5.2);
  add(scene, box(64, .12, 2.2, sideMat), 0, .06, 1.1);
  const curbMesh = add(scene, box(64, .16, .12, curbMat), 0, .08, 2.2);
  add(scene, box(64, .04, 4, roadMat), 0, .02, 4.2);
  const dashes = [];
  for (let x = -32; x <= 32; x += 2) dashes.push(add(scene, box(1, .01, .12, dashMat), x, .045, 4.2));
  add(scene, box(64, .12, 1.4, sideMat), 0, .06, 6.9);

  /* background: a quiet back street of houses, then a hazy skyline */
  const bgMats = [];
  function bgMat(dayHex, roof){
    const m = M(dayHex);
    const night = new THREE.Color(dayHex).multiplyScalar(.28).lerp(new THREE.Color(0x1a2030), .35);
    bgMats.push({ m, day: new THREE.Color(dayHex), night, roof: !!roof });
    return m;
  }
  const bgWalls = [0xd9a38f, 0xe3cf9e, 0x9fb7c9, 0xb9c9a7, 0xe6ddd0, 0xc9a6b5].map(c => bgMat(c));
  const bgRoofs = [0x9c4a35, 0x4f5b66, 0x6b4a3a, 0x5d6f5a].map(c => bgMat(c, true));
  const bgFrame = bgMat(0xefe9df), bgPlinth = bgMat(0x6f6a66), bgRail = bgMat(0x3a3d44);
  const bgDoors = [bgMat(0x4a5d72), bgMat(0x6b3f2e), bgMat(0x3f5e4a)];
  const bgWinOn = new THREE.MeshBasicMaterial({ color: 0xffc66b });
  const bgWinOff = new THREE.MeshBasicMaterial({ color: 0x2b3140 });
  function nb(w, h, d, m){ const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.receiveShadow = true; return me; }
  function bgWindow(x, y, zf){
    add(scene, nb(.48, .56, .04, bgFrame), x, y, zf + .02);
    add(scene, panel(.36, .44, Math.random() < .35 ? bgWinOn : bgWinOff), x, y, zf + .045);
    add(scene, nb(.56, .05, .1, bgFrame), x, y - .3, zf + .05);
  }
  function bgHouse(x0, w, h, style){
    const d = 2.5, z = -8.6, zf = z + d / 2, cx = x0 + w / 2;
    const wall = pick(bgWalls), roof = pick(bgRoofs);
    add(scene, nb(w, h, d, wall), cx, h / 2, z);
    add(scene, nb(w + .04, .45, .06, bgPlinth), cx, .225, zf + .03);
    const floors = Math.max(2, Math.floor((h - .4) / 1.05)), cols = w < 2.6 ? 2 : 3;
    const doorCol = Math.floor(rand(0, cols));
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const x = x0 + (c + .5) * w / cols, y = .95 + f * 1.05;
      if (f === 0 && c === doorCol) {
        const door = pick(bgDoors);
        add(scene, nb(1.0, .12, .5, bgPlinth), x, .06, zf + .25);
        add(scene, nb(1.0, .12, .28, bgPlinth), x, .18, zf + .14);
        add(scene, nb(.8, 1.14, .04, bgFrame), x, .87, zf + .02);
        add(scene, panel(.32, 1.0, door), x - .17, .87, zf + .045);
        add(scene, panel(.32, 1.0, door), x + .17, .87, zf + .045);
        add(scene, nb(1.1, .07, .62, roof), x, 1.55, zf + .31);
        add(scene, nb(.04, .3, .04, bgRail), x - .5, 1.38, zf + .58);
        add(scene, nb(.04, .3, .04, bgRail), x + .5, 1.38, zf + .58);
        add(scene, new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 5), bulbMat), x, 1.45, zf + .08);
        glow(x, 1.45, zf + .12, .7);
        add(scene, nb(.12, .18, .03, bgRail), x + .52, .95, zf + .02);
      } else {
        bgWindow(x, y, zf);
        if (style === 'flat' && f > 0 && c === Math.floor(cols / 2)) {
          add(scene, nb(.8, .06, .4, bgFrame), x, y - .38, zf + .2);
          add(scene, nb(.8, .3, .03, bgRail), x, y - .22, zf + .39);
        }
      }
    }
    if (style === 'gable') {
      add(scene, gable(w + .15, d + .15, .9, roof), cx, h, zf + .075);
      add(scene, new THREE.Mesh(new THREE.CircleGeometry(.17, 14), Math.random() < .5 ? bgWinOn : bgWinOff), cx, h + .33, zf + .08);
      add(scene, nb(.28, .7, .28, bgPlinth), cx + w * .25, h + .55, z - .3);
    } else if (style === 'flat') {
      add(scene, nb(w + .2, .18, d + .2, bgFrame), cx, h + .09, z);
      add(scene, nb(w + .2, .22, .1, wall), cx, h + .29, zf + .05);
    } else {
      add(scene, eaveRoof(w + .2, d + .2, .85, roof), cx, h, z);
      add(scene, nb(.7, .5, .6, wall), cx, h + .3, zf - .5);
      add(scene, gable(.85, .7, .35, roof), cx, h + .55, zf - .15);
      add(scene, panel(.3, .3, Math.random() < .5 ? bgWinOn : bgWinOff), cx, h + .3, zf - .19);
    }
  }
  for (let x = -25; x < 25;) {
    const w = rand(2.2, 3.4), h = rand(3.1, 5.1);
    bgHouse(x, w, h, pick(['gable', 'flat', 'eave']));
    x += w + rand(.15, .45);
  }
  /* promenade along the back houses */
  const pathMat = bgMat(0xcdbfa8, true);
  add(scene, nb(54, .06, 1.2, pathMat), 0, .06, -6.6);
  add(scene, nb(54, .09, .08, bgPlinth), 0, .07, -5.98);
  for (let x = -21; x <= 21; x += 6) {
    add(scene, cyl(.035, .045, 1.5, darkMat, 6), x, .8, -6.05);
    add(scene, new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), bulbMat), x, 1.6, -6.05);
    glow(x, 1.6, -6.0, 1.0); pool(x, -6.45, 2.8, .1);
  }
  [-9.6, 1.6, 10.6].forEach(x => {
    const b = new THREE.Group();
    add(b, nb(1.1, .08, .35, bgDoors[1]), 0, .42, 0);
    add(b, nb(1.1, .3, .06, bgDoors[1]), 0, .66, .16);
    add(b, nb(.06, .4, .3, bgRail), -.48, .2, 0); add(b, nb(.06, .4, .3, bgRail), .48, .2, 0);
    b.position.set(x, .06, -6.12); scene.add(b);
  });
  const bushMats = [M(0x3f8f5a), M(0x4f9a62), M(0x356f48)];
  for (let x = -24; x < 24; x += rand(1.6, 2.6)) {
    if (Math.random() < .25) continue;
    const n = 2 + Math.floor(rand(0, 2));
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(.28, .46), 1), pick(bushMats));
      b.castShadow = true; b.receiveShadow = true; b.scale.y = rand(.75, .95);
      b.position.set(x + i * rand(.35, .5), rand(.22, .3), -4.75 + rand(-.15, .15)); scene.add(b);
    }
    if (Math.random() < .35) for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(.06, 5, 4), M(pick([0xe07a9a, 0xffffff, 0xf2c46b])));
      f.position.set(x + rand(0, .8), rand(.42, .56), -4.55 + rand(-.1, .1)); scene.add(f);
    }
  }
  const farWins = new THREE.Group(); scene.add(farWins);
  const farWinMat = new THREE.MeshBasicMaterial({ color: 0x6b5a3a });
  for (let x = -30; x < 30;) {
    const w = rand(2.4, 4.2), h = rand(6, 13);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), skylineMat);
    const z = rand(-21, -18);
    b.position.set(x + w / 2, h / 2, z); scene.add(b);
    for (let i = 0; i < 4; i++) {
      const p = panel(.3, .3, farWinMat);
      p.position.set(x + rand(.4, w - .4), rand(2, h - 1), z + 1.51); farWins.add(p);
    }
    x += w + rand(.3, 1.2);
  }
  [-22, -17.5, -13.5, -9, -4.5, 4.5, 9, 13.5, 17.5, 22].forEach(x => { const t = tree(); t.position.set(x + rand(-.4, .4), 0, -5.45); t.scale.setScalar(rand(1, 1.3)); scene.add(t); });

  const LAMPS = [-21, -15, -9, -3, 3, 9, 15, 21];
  LAMPS.forEach(x => {
    add(scene, cyl(.05, .07, 2.6, darkMat, 6), x, 1.3, 2.05);
    add(scene, box(.5, .05, .05, darkMat), x - .2, 2.6, 2.05);
    add(scene, new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), bulbMat), x - .42, 2.5, 2.05);
    glow(x - .42, 2.5, 2.1, 1.6);
    pool(x - .42, 2.0, 4.2);
  });


  return { groundMat, sideMat, roadMat, curbMat, dashMat, skylineMat, ground, curbMesh, dashes, bgMats, bgWinOn, bgWinOff, farWins, LAMPS, nb };
}
