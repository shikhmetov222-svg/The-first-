// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/** Оформление района и рекламный щит. env — окружение (разметка, бордюр, фонари), types — для disposeGroup. */
export function createDecor(k, scene, env, types) {
  const { dashes, curbMesh, LAMPS } = env;
  const { disposeGroup } = types;
  const { M, add, box, cone, cyl, darkMat, front, pick, rand, sign, tree } = k;
  /* ---------- district decor ---------- */
  const DM = { stone: M(0x9a968e), garage: M(0x6b6f78), garageDoor: M(0x4a4e57), tire: M(0x1a1a1a), weed: M(0x6b7a3a), bench: M(0x6b4a2f), dry: M(0x5a4a3a), stripe: M(0xe8e8e8) };
  const waterMat = new THREE.MeshBasicMaterial({ color: 0x5fb7e8, transparent: true, opacity: .8 });
  function garage(x, z){
    const g = new THREE.Group();
    add(g, box(2.2, 1.5, 2.4, DM.garage), 0, .75, -1.2);
    add(g, box(2.3, .1, 2.5, M(0x55585f)), 0, 1.55, -1.2);
    front(g, 1.7, 1.2, DM.garageDoor, 0, .6);
    for (let i = 0; i < 5; i++) add(g, box(1.7, .03, .02, M(0x5a5f6b)), 0, .15 + i * .24, .02);
    g.position.set(x, 0, z); return g;
  }
  function tireStack(x, z){
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(.28, .11, 6, 12), DM.tire); t.rotation.x = Math.PI / 2; t.castShadow = true; add(g, t, rand(-.04, .04), .23 + i * .2, 0); }
    g.position.set(x, 0, z); return g;
  }
  function weeds(x, z){
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) add(g, cone(.08, .35, DM.weed, 5), rand(-.3, .3), .29, rand(-.2, .2));
    g.position.set(x, 0, z); return g;
  }
  function pothole(x, z){
    const m = new THREE.Mesh(new THREE.CircleGeometry(rand(.25, .45), 10), M(0x1d1912));
    m.rotation.x = -Math.PI / 2; m.position.set(x, .043, z); return m;
  }
  function dryTree(x, z){
    const g = new THREE.Group();
    add(g, cyl(.06, .1, 1.6, DM.dry, 6), 0, .8, 0);
    [[.5, .3], [-.6, -.4], [.3, 2.4]].forEach(([r, ry]) => { const b = cyl(.025, .04, .7, DM.dry, 5); b.rotation.z = r; b.rotation.y = ry; add(g, b, 0, 1.3, 0); });
    g.position.set(x, 0, z); return g;
  }
  function bench(x, z, ry){
    const g = new THREE.Group();
    add(g, box(1.1, .08, .35, DM.bench), 0, .42, 0);
    add(g, box(1.1, .3, .06, DM.bench), 0, .66, -.16);
    add(g, box(.06, .4, .3, darkMat), -.48, .2, 0); add(g, box(.06, .4, .3, darkMat), .48, .2, 0);
    g.rotation.y = ry || 0; g.position.set(x, .12, z); return g;
  }
  function flowerBed(x, z){
    const g = new THREE.Group();
    add(g, box(1.2, .25, .5, M(0x55585f)), 0, .125, 0);
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 5), M(pick([0xe07a9a, 0xf2c46b, 0xffffff, 0xd63c3c])));
      add(g, f, -.5 + i * (1 / 6), .3, rand(-.12, .12));
    }
    g.position.set(x, .12, z); return g;
  }
  let fountainJet = null;
  function fountain(x, z){
    const g = new THREE.Group();
    add(g, cyl(1.0, 1.05, .35, DM.stone, 16), 0, .3, 0);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .04, 16), waterMat); add(g, w, 0, .48, 0);
    add(g, cyl(.1, .14, .9, DM.stone, 8), 0, .9, 0);
    add(g, cyl(.42, .3, .12, DM.stone, 12), 0, 1.35, 0);
    fountainJet = new THREE.Mesh(new THREE.ConeGeometry(.16, .7, 8), waterMat); add(g, fountainJet, 0, 1.75, 0);
    g.position.set(x, .12, z); return g;
  }
  function garland(x1, x2, z){
    const g = new THREE.Group();
    const cols = [0xffd36b, 0xff8f6b, 0x6cb4ee, 0x7be0a6];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const b = new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 5), new THREE.MeshBasicMaterial({ color: cols[i % 4] }));
      add(g, b, x1 + (x2 - x1) * t, 2.5 - Math.sin(t * Math.PI) * .45, z);
    }
    return g;
  }
  function billboard(lines, color, x, z){
    const g = new THREE.Group();
    add(g, cyl(.06, .06, 3, darkMat, 6), -1.2, 1.5, 0); add(g, cyl(.06, .06, 3, darkMat, 6), 1.2, 1.5, 0);
    add(g, box(3.2, 1.3, .1, darkMat), 0, 3.4, 0);
    add(g, sign(lines, color, 3.1, 1.2), 0, 3.4, .06);
    g.rotation.y = .25; g.position.set(x, 0, z); return g;
  }
  function crossing(x){
    const g = new THREE.Group();
    for (let i = 0; i < 7; i++) add(g, box(1.8, .012, .3, DM.stripe), x, .047, 2.5 + i * .6);
    return g;
  }
  let decor = new THREE.Group(); scene.add(decor);
  function buildDecor(k){
    scene.remove(decor); disposeGroup(decor); fountainJet = null;
    decor = new THREE.Group();
    dashes.forEach(m => { m.visible = k > 0; });
    curbMesh.visible = k > 0;
    if (k === 0) {
      decor.add(garage(-24.6, -.4), garage(24.6, -.4), tireStack(22.6, .8));
      decor.add(weeds(-10.2, 1.0), weeds(9.4, 6.9), weeds(-4.1, 7.0), weeds(1.6, 1.9), weeds(-19, 6.9), weeds(16.5, 1.0));
      decor.add(pothole(-6, 3.9), pothole(4, 5.1), pothole(10, 3.4), pothole(-1.5, 4.6), pothole(-16, 5.0), pothole(18, 3.8));
      decor.add(dryTree(-3, 7.1), dryTree(6.5, 7.1), dryTree(-14, 7.1));
    } else {
      const treeXs = k === 2 ? [-21, -16.5, -12, -7.5, -3, 1.5, 6, 10.5, 15, 19.5] : [-20, -13, -3, 3.2, 10.5, 17];
      treeXs.forEach(x => { const t = tree(); t.position.set(x, .12, 7.2); decor.add(t); });
      decor.add(bench(-6.5, 6.95, Math.PI), bench(6.6, 6.95, Math.PI), bench(-15, 6.95, Math.PI), bench(15, 6.95, Math.PI));
      if (k === 2) {
        decor.add(crossing(3));
        for (let i = 0; i < LAMPS.length - 1; i++) decor.add(garland(LAMPS[i] - .42, LAMPS[i + 1] - .42, 2.05));
        decor.add(flowerBed(-16, 6.9), flowerBed(-8, 6.9), flowerBed(1, 6.9), flowerBed(9.2, 6.9), flowerBed(17, 6.9));
        decor.add(fountain(24.2, 1.0));
      }
    }
    scene.add(decor);
  }

  return { buildDecor, billboard, getFountainJet: () => fountainJet };
}
