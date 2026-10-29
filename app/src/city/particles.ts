// Дым, пыль и конфетти на карте: две InstancedMesh на всё (вместо меша и материала на каждую частицу).
// Прозрачность у каждой частицы своя — через атрибут aAlpha в шейдере.
import * as THREE from 'three';

interface P {
  alive: boolean;
  t: number;
  life: number;
  x: number;
  y: number;
  z: number;
  size: number;
  rise: number;
  drift: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
}

/** MeshBasicMaterial с прозрачностью из атрибута aAlpha (у каждого инстанса своя). */
function alphaMaterial(opacity: number) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  return m;
}

function pool(scene: THREE.Scene, geo: THREE.BufferGeometry, n: number, opacity: number) {
  const g = geo.clone();
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  g.setAttribute('aAlpha', alpha);
  const im = new THREE.InstancedMesh(g, alphaMaterial(opacity), n);
  im.frustumCulled = false;
  im.renderOrder = 2;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) {
    im.setMatrixAt(i, zero);
    im.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  scene.add(im);
  const ps: P[] = Array.from({ length: n }, () => ({
    alive: false, t: 0, life: 1, x: 0, y: 0, z: 0, size: 1, rise: 0, drift: 0, vx: 0, vy: 0, vz: 0, spin: 0,
  }));
  let next = 0;
  const take = () => {
    const i = next;
    next = (next + 1) % n;
    return i;
  };
  return { im, alpha, ps, zero, take };
}

export function createParticles(scene: THREE.Scene) {
  const puffs = pool(scene, new THREE.SphereGeometry(1, 7, 5), 360, 1);
  const bits = pool(scene, new THREE.BoxGeometry(1, 1, 1), 240, 1);
  const col = new THREE.Color();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const e = new THREE.Euler();
  let confettiOn = true;
  let dirty = false;

  /** Облачко дыма или пыли — как puff() в макете: поднимается, растёт и тает. */
  function puff(x: number, y: number, z: number, color: number, size: number, rise: number, life: number) {
    const i = puffs.take();
    Object.assign(puffs.ps[i], { alive: true, t: 0, life, x, y, z, size, rise, drift: 0.2 + Math.random() * 0.3 });
    puffs.im.setColorAt(i, col.set(color));
    puffs.im.instanceColor!.needsUpdate = true;
    dirty = true;
  }

  /** Конфетти — как confetti() в макете. */
  function confetti(x: number, y: number, z: number) {
    if (!confettiOn) return;
    const cols = [0xd4a73a, 0xf07167, 0x3fbf8f, 0x60a5fa, 0xffffff];
    for (let k = 0; k < 36; k++) {
      const i = bits.take();
      Object.assign(bits.ps[i], {
        alive: true, t: 0, life: 1.8, x, y, z,
        vx: -2.5 + Math.random() * 5, vy: 3 + Math.random() * 3, vz: -2.5 + Math.random() * 5, spin: 4 + Math.random() * 6,
      });
      bits.im.setColorAt(i, col.set(cols[Math.floor(Math.random() * cols.length)]));
    }
    bits.im.instanceColor!.needsUpdate = true;
    dirty = true;
  }

  function update(dt: number) {
    if (!dirty) return;
    let any = false;
    puffs.ps.forEach((p, i) => {
      if (!p.alive) return;
      p.t += dt;
      const k = Math.min(1, p.t / p.life);
      if (k >= 1) {
        p.alive = false;
        puffs.im.setMatrixAt(i, puffs.zero);
        puffs.alpha.setX(i, 0);
        return;
      }
      any = true;
      const s = p.size * (1 + k * 1.6);
      m.compose(v.set(p.x + k * p.drift, p.y + k * p.rise, p.z), q.identity(), sc.set(s, s, s));
      puffs.im.setMatrixAt(i, m);
      puffs.alpha.setX(i, 0.45 * (1 - k));
    });
    bits.ps.forEach((p, i) => {
      if (!p.alive) return;
      p.t += dt;
      const k = Math.min(1, p.t / p.life);
      if (k >= 1) {
        p.alive = false;
        bits.im.setMatrixAt(i, bits.zero);
        bits.alpha.setX(i, 0);
        return;
      }
      any = true;
      const t = p.t;
      m.compose(
        v.set(p.x + p.vx * t, p.y + p.vy * t - 4.5 * t * t, p.z + p.vz * t),
        q.setFromEuler(e.set(t * p.spin, 0, 0)),
        sc.set(0.18, 0.06, 0.18),
      );
      bits.im.setMatrixAt(i, m);
      bits.alpha.setX(i, 1 - k * k);
    });
    [puffs, bits].forEach((pl) => {
      pl.im.instanceMatrix.needsUpdate = true;
      pl.alpha.needsUpdate = true;
    });
    dirty = any;
  }

  return {
    puff,
    confetti,
    update,
    /** «Графика: низкая» — без конфетти. */
    setConfetti: (on: boolean) => {
      confettiOn = on;
    },
  };
}
