// Страница для render-street2d.mjs: рендерит каждое здание на каждом уровне теми же строителями,
// что и 3D-улица (src/street/gen), тем же светом и тем же ракурсом камеры. Результат — PNG с прозрачным фоном.
import * as THREE from 'three';
import { createKit } from '../../src/street/gen/kit.js';
import { createTypes } from '../../src/street/gen/types.js';
import { LEGACY_LIGHT, OFFSET } from '../../src/street/world';
import { SLOT_TYPES } from '../../src/street/views';

THREE.ColorManagement.enabled = false;
const PX = 64; // пикселей на единицу мира — одинаково для всех зданий, чтобы уровни были в одном масштабе

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Дневной свет — как applyEnv() днём в ясную погоду.
scene.add(new THREE.HemisphereLight(0xdfefff, 0x6b5a45, 0.78 * LEGACY_LIGHT));
const dir = new THREE.DirectionalLight(0xfff1d6, 1.0 * LEGACY_LIGHT);
dir.position.set(8, 14, 10);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
Object.assign(dir.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 60 });
dir.shadow.bias = -0.0006;
scene.add(dir, dir.target);
// Тени на прозрачной «земле».
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.28 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const k = createKit(scene);
k.glowMat.visible = false;
k.poolMat.visible = false;
k.winMat.color.set(0x9cc3e0);
k.winMat.emissiveIntensity = 0;
k.bulbMat.color.set(0xd8d8d0);
const types = createTypes(k);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.copy(OFFSET);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();

function lot() {
  const g = types.makeFor('market', 0, 0) as THREE.Group;
  // Участок: на табличке только «ПРОДАЁТСЯ» — сколько собрано, игра пишет поверх картинки.
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (m && m.map && m.type === 'MeshBasicMaterial') m.map = k.signTex(['ПРОДАЁТСЯ'], '#D4A73A', 512, 220);
  });
  return g;
}

/** Рамка кадра: границы здания в координатах камеры. */
function bounds(g: THREE.Object3D) {
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const inv = camera.matrixWorldInverse;
  const b = { l: Infinity, r: -Infinity, t: -Infinity, bt: Infinity };
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
    b.l = Math.min(b.l, p.x); b.r = Math.max(b.r, p.x); b.t = Math.max(b.t, p.y); b.bt = Math.min(b.bt, p.y);
  }
  return b;
}

const jobs: { name: string; make: () => THREE.Group }[] = [{ name: 'lot', make: lot }];
for (const s of SLOT_TYPES) for (let L = 1; L <= 5; L++) jobs.push({ name: `${s.game}-${L}`, make: () => types.makeFor(s.street, L, 0) });

// Общая высота кадра снизу (уровень земли у фасада) — чтобы здания стояли на одной линии.
const groundY = new THREE.Vector3(0, 0, 1.2).applyMatrix4(camera.matrixWorldInverse).y;

(window as unknown as { render2d: () => Record<string, string> }).render2d = () => {
  const out: Record<string, string> = {};
  for (const j of jobs) {
    const g = j.make();
    scene.add(g);
    const b = bounds(g);
    const pad = 0.15;
    const left = b.l - pad, right = b.r + pad, top = b.t + pad, bottom = Math.min(b.bt, groundY) - pad;
    Object.assign(camera, { left, right, top, bottom });
    camera.updateProjectionMatrix();
    const w = Math.round((right - left) * PX), h = Math.round((top - bottom) * PX);
    renderer.setSize(w, h, false);
    renderer.render(scene, camera);
    out[j.name] = renderer.domElement.toDataURL('image/png');
    // Где в картинке «земля» у фасада — по ней 2D-улица ставит здание на тротуар.
    out[j.name + ':ground'] = String((top - groundY) / (top - bottom));
    out[j.name + ':x'] = String((0 - left) / (right - left));
    out[j.name + ':w'] = String(w);
    out[j.name + ':h'] = String(h);
    scene.remove(g);
    types.disposeGroup(g);
  }
  return out;
};
(window as unknown as { ready: boolean }).ready = true;
