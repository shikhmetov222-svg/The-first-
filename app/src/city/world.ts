// Мир карты города: свет, туман, набор деталей, сам город из макета (gen/city.js) и смена дня/ночи.
// Как и улица: цвета без управления цветом (как в r128), свет × π, ночью — только нарисованные свечения.
import * as THREE from 'three';
import { createKit } from '../street/gen/kit.js';
import { createTypes } from '../street/gen/types.js';
import { createCity } from './gen/city.js';
import { LEGACY_LIGHT } from '../street/world';
import { findMutable, instancePeople, mergeSprites, mergeStatic } from '../street/merge';
import { hash01, hashInt, rub, type CityPlot, type Owner } from './views';

THREE.ColorManagement.enabled = false;

export const CITY_OFFSET = new THREE.Vector3(56, 88, 136);
/** Слой теневых копий (shadowProxy в street/merge.ts): они рисуются только при обновлении карты теней. */
const SHADOW_LAYER = 2;
const LIGHT_OFF = new THREE.Vector3(16, 28, 20);

export interface CityBuild {
  seed: number;
  stage: number;
  /** Пороги стадий 1–4, коп. */
  caps: number[];
  plots: CityPlot[];
  me: Owner;
  camera: THREE.OrthographicCamera;
  onFinished?: (p: unknown, wasLot: boolean) => void;
}

export type CityWorld = ReturnType<typeof createCityWorld>;

/** Детерминированный генератор (как srand в макете) — на время постройки города подменяет Math.random. */
function seeded(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCityWorld(scene: THREE.Scene, b: CityBuild) {
  scene.background = new THREE.Color(0x10131d);
  scene.fog = new THREE.Fog(0x10131d, 190, 330);
  const hemi = new THREE.HemisphereLight(0x6f7fb0, 0x1a1a22, 0.32 * LEGACY_LIGHT);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0x9fb0ff, 0.22 * LEGACY_LIGHT);
  dir.castShadow = true;
  // Солнце стоит над всем городом и не ходит за камерой: город почти неподвижен, поэтому карта теней
  // перерисовывается не каждый кадр, а только когда что-то поменялось (см. updateShadows).
  dir.shadow.mapSize.set(2048, 2048);
  Object.assign(dir.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 220 });
  dir.shadow.camera.updateProjectionMatrix();
  dir.shadow.bias = -0.0008;
  dir.position.copy(LIGHT_OFF).multiplyScalar(3);
  dir.target.position.set(0, 0, 0);
  scene.add(dir, dir.target);

  const base = createKit(scene);
  // Кэш материалов, как в макете города: тысячи домов делят несколько десятков материалов.
  const cache = new Map<string, THREE.Material>();
  const M = (c: number, o?: Record<string, unknown>) => {
    const key = c + (o ? JSON.stringify(o) : '');
    let m = cache.get(key);
    if (!m) {
      m = base.M(c, o) as THREE.Material;
      cache.set(key, m);
    }
    return m;
  };
  const k = { ...base, M };
  const types = createTypes(k);
  // Материалы, которые меняются днём и ночью, склеиваем только сами с собой. Окна зданий меняются всегда,
  // земля и дороги помечают себя сами (EM в gen/city.js), остальное находит проверка после постройки.
  const mutable = new Set<THREE.Material>([base.winMat, base.bulbMat, base.glowMat, base.poolMat] as THREE.Material[]);
  let clock = 0;
  let heat = false;

  // Склейка как на улице; для кварталов (pairs) у каждого квартала свои копии материалов — чтобы он мог стать
  // прозрачным, когда закрывает твой бизнес.
  const merge = (g: THREE.Object3D, pairs?: [THREE.Material, THREE.Material][]) => {
    mergeStatic(g, mutable, [], undefined, SHADOW_LAYER);
    if (!pairs) return;
    const clones = new Map<THREE.Material, THREE.Material>();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const src = mesh.material;
      let c = clones.get(src);
      if (!c) {
        c = src.clone();
        clones.set(src, c);
        pairs.push([src, c]);
      }
      mesh.material = c;
    });
  };

  const rand = Math.random;
  Math.random = seeded(hashInt(b.seed, 1));
  let city: ReturnType<typeof createCity>;
  try {
    city = createCity(k, types, {
      scene, hemi, dir, camera: b.camera, mutable,
      seed: b.seed,
      stage: b.stage,
      stageCap: { 1: rub(b.caps[0] ?? 0), 2: rub(b.caps[1] ?? 0), 3: rub(b.caps[2] ?? 0), 4: rub(b.caps[3] ?? 0) },
      plots: b.plots,
      me: b.me,
      mergeStatic: merge,
      hash: (i: number, j: number, kk: number) => hash01(b.seed, 5, i, j, kk),
      slotSeed: (i: number, j: number, kk: number, f: number) => hashInt(b.seed, 3, i, j, kk, f),
      clock: () => clock,
      heatOn: () => heat,
      onFinished: (p: unknown, wasLot: boolean) => b.onFinished?.(p, wasLot),
    });
  } finally {
    Math.random = rand;
  }

  // Неподвижное прямо на сцене (столбы и пятна света фонарей, дорога) — в несколько мешей по материалам.
  const keep = scene.children.filter((c) => !(c as THREE.Mesh).isMesh || (c as THREE.InstancedMesh).isInstancedMesh
    || c === city.ground || c === city.getFountainJet());
  const facing = new THREE.Quaternion();
  {
    const c = new THREE.PerspectiveCamera();
    c.position.copy(CITY_OFFSET);
    c.lookAt(0, 0, 0);
    facing.copy(c.quaternion);
  }

  function applyTime(day: boolean) {
    city.applyTime(day);
    // В r128 свет считался «по-старому»: та же яркость = интенсивность × π.
    hemi.intensity *= LEGACY_LIGHT;
    dir.intensity *= LEGACY_LIGHT;
    glows.visible = !day;
  }
  // Какие материалы меняет смена дня и ночи — прогоняем оба варианта.
  findMutable(scene, [() => city.applyTime(true), () => city.applyTime(false)], mutable,
    [...Object.values(base), ...city.envMats.map((e: [THREE.Material]) => e[0]), city.WIN_ON, city.WIN_OFF]);
  mergeStatic(scene, mutable, keep, undefined, SHADOW_LAYER);
  const glows = mergeSprites(scene, base.glowMat, facing) ?? new THREE.Object3D();

  // Транспорт и прохожие — инстансами: все машины одной модели рисуются одним вызовом на деталь.
  const sig = (g: THREE.Object3D) => {
    const parts: string[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) parts.push(m.geometry.type + JSON.stringify((m.geometry as THREE.BoxGeometry).parameters ?? {}));
    });
    return parts.join('|');
  };
  const models = new Map<string, THREE.Object3D[]>();
  [...city.cars.map((c: { g: THREE.Object3D }) => c.g), ...city.walkers.map((w: { g: THREE.Object3D }) => w.g)].forEach((g) => {
    const key = sig(g);
    models.set(key, [...(models.get(key) ?? []), g]);
  });
  // Тени у машин и прохожих на общем виде размером в пиксель — не рисуем их.
  const fleets = [...models.values()].map((gs) => instancePeople(scene, gs, false, true));

  /** Камера смотрит на target. */
  function placeCamera(camera: THREE.Camera, target: THREE.Vector3) {
    camera.position.copy(target).add(CITY_OFFSET);
    camera.lookAt(target);
  }

  // Карта теней: рисуется по теневым копиям (один меш на квартал или участок) отдельным проходом в крошечную
  // картинку — так в обычных кадрах тени не стоят ни одного вызова отрисовки.
  let shadowsDirty = true;
  let shadowAge = 0;
  const tiny = new THREE.WebGLRenderTarget(1, 1);
  function updateShadows(gl: THREE.WebGLRenderer, camera: THREE.Camera, dt: number) {
    shadowAge += dt;
    if (!shadowsDirty && shadowAge < 3) return;
    shadowsDirty = false;
    shadowAge = 0;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    const mask = camera.layers.mask;
    camera.layers.enable(SHADOW_LAYER);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(tiny);
    gl.render(scene, camera);
    gl.setRenderTarget(prev);
    camera.layers.mask = mask;
  }

  return {
    city, k, types, hemi, dir, mutable, applyTime, placeCamera, updateShadows,
    /** Что-то на карте поменялось — перерисовать тени в ближайшем кадре. */
    markShadows: () => {
      shadowsDirty = true;
    },
    tick: (dt: number) => {
      clock += dt;
      return clock;
    },
    /** После движения машин и прохожих — перенести их положение в инстансы. */
    syncFleets: () => fleets.forEach((f) => f.sync()),
    setHeat: (on: boolean) => {
      heat = on;
    },
    merge,
  };
}

/** Рамка ортокамеры как в макете: на узком экране ширина 18 единиц, на широком — высота 14. */
export function frameCityCamera(camera: THREE.OrthographicCamera, w: number, h: number) {
  if (!w || !h) return;
  const a = w / h;
  let hw: number, hh: number;
  if (a < 1.3) {
    hw = 9;
    hh = hw / a;
  } else {
    hh = 7;
    hw = hh * a;
  }
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
}
