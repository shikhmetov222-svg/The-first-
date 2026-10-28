// Сгенерировано скриптом app/scripts/port-street.py из docs/street-mockup.js — не править руками.
import * as THREE from 'three';

/** Твины и эффекты стройки (леса, кран, пыль, дым). */
export function createAnim(k, scene) {
  const { M, add, box, darkMat, rand, woodMat } = k;
  /* ---------- tweens ---------- */
  const tweens = [];
  function tween(dur, fn, done){ tweens.push({ t: 0, dur, fn, done }); }
  const easeOutBack = p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };

  function scaffold(D){
    const g = new THREE.Group();
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(D.w + .2, D.h, D.d + .2)), new THREE.LineBasicMaterial({ color: 0xd4a73a }));
    edges.position.set(0, D.h / 2, -D.d / 2); g.add(edges);
    for (let y = .8; y < D.h; y += .8) add(g, box(D.w + .3, .05, .25, woodMat), 0, y, .15);
    const mastH = D.h + 2;
    const yellow = M(0xd4a73a);
    add(g, box(.2, mastH, .2, yellow), D.w / 2 + .7, mastH / 2, -D.d / 2);
    const arm = new THREE.Group(); arm.position.set(D.w / 2 + .7, mastH, -D.d / 2);
    const a = box(3.2, .16, .16, yellow); a.position.x = -1.1; arm.add(a);
    const hook = box(.04, 1, .04, darkMat); hook.position.set(-2.3, -.5, 0); arm.add(hook);
    g.add(arm); g.userData.arm = arm;
    return g;
  }
  const puffGeo = new THREE.SphereGeometry(1, 7, 5);
  function puff(x, y, z, color, size, rise, life){
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .5, depthWrite: false });
    const s = new THREE.Mesh(puffGeo, m); s.scale.setScalar(size); s.position.set(x, y, z); scene.add(s);
    const drift = rand(.2, .5);
    tween(life, p => { s.position.y = y + p * rise; s.position.x = x + p * drift; s.scale.setScalar(size * (1 + p * 1.6)); m.opacity = .5 * (1 - p); },
      () => { scene.remove(s); m.dispose(); });
  }
  function dust(x){
    for (let i = 0; i < 14; i++) puff(x + rand(-2, 2), .2, rand(-2.4, .6), 0x9a948a, .18, .8, 1.1);
  }

  return { tweens, tween, easeOutBack, scaffold, puffGeo, puff, dust };
}
