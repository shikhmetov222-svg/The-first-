// Мир улицы: свет, туман, окружение и смена дня/ночи, района и погоды — как в docs/street-mockup.js.
// Отличие от макета только одно: three.js новее (r186 против r128), поэтому свет переводится в старые единицы
// (интенсивность × π) и цвета не проходят через управление цветом — так картинка совпадает с макетом.
import * as THREE from 'three';
import { createKit } from './gen/kit.js';
import { createEnvironment } from './gen/environment.js';
import { isDaytime } from './views';
import { findMutable, mergeSprites, mergeStatic } from './merge';

// Макет написан для r128: там цвета не переводились из sRGB в линейное пространство.
THREE.ColorManagement.enabled = false;

/** В r128 свет считался «по-старому»; в новых версиях та же яркость = интенсивность × π. */
export const LEGACY_LIGHT = Math.PI;

export type Weather = 'clear' | 'rain' | 'snow';
export interface EnvState {
  day: boolean;
  district: 0 | 1 | 2; // 0 — окраина, 1 — район, 2 — центр
  weather: Weather;
}

export const OFFSET = new THREE.Vector3(7, 11, 17);
export const HOME = new THREE.Vector3(0, 2.4, 1);
const LIGHT_OFF = new THREE.Vector3(8, 14, 10);

export { isDaytime } from './views';

export type World = ReturnType<typeof createWorld>;

export function createWorld(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x10131d);
  scene.fog = new THREE.Fog(0x10131d, 25, 48);

  const hemi = new THREE.HemisphereLight(0x6f7fb0, 0x1a1a22, 0.32 * LEGACY_LIGHT);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0x9fb0ff, 0.22 * LEGACY_LIGHT);
  dir.position.set(8, 14, 10);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  Object.assign(dir.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 60 });
  dir.shadow.bias = -0.0006;
  scene.add(dir);
  scene.add(dir.target);

  const k = createKit(scene);
  const env = createEnvironment(k, scene);
  // Разметка прячется на окраине — держим её отдельной группой, чтобы склеить и прятать целиком.
  const dashGroup = new THREE.Group();
  env.dashes.forEach((m: THREE.Object3D) => dashGroup.add(m));
  scene.add(dashGroup);
  const state: EnvState = { day: isDaytime(), district: 1, weather: 'clear' };
  /** Что ещё перекрасить при смене дня/района/погоды (прохожие, облака, дождь — см. life.ts). */
  const envHooks: Array<(s: EnvState) => void> = [];

  function applyEnv() {
    const { day, district: dk, weather: wx } = state;
    const isRain = wx === 'rain', isSnow = wx === 'snow';
    let sky = day ? 0x9cc8ea : 0x10131d;
    if (isRain) sky = day ? 0x7f8e9e : 0x0b0d13;
    if (isSnow) sky = day ? 0xc9d5e0 : 0x161a24;
    (scene.background as THREE.Color).set(sky);
    (scene.fog as THREE.Fog).color.set(sky);
    hemi.intensity = (day ? 0.78 : 0.46) * (isRain ? 0.75 : 1) * LEGACY_LIGHT;
    hemi.color.set(day ? 0xdfefff : 0x6f7fb0);
    hemi.groundColor.set(day ? 0x6b5a45 : 0x1a1a22);
    dir.intensity = (day ? 1.0 : 0.3) * (isRain ? 0.55 : 1) * LEGACY_LIGHT;
    dir.color.set(day ? 0xfff1d6 : 0x9fb0ff);
    k.winMat.color.set(day ? 0x9cc3e0 : 0x2a2a30);
    k.winMat.emissiveIntensity = day ? 0 : 1;
    k.glowMat.visible = !day;
    k.poolMat.visible = !day;
    k.bulbMat.color.set(day ? 0xd8d8d0 : 0xffe08a);
    env.groundMat.color.set(isSnow ? (day ? 0xe9eef3 : 0x5b6272) : day ? 0x6f8f57 : 0x1b2620);
    if (isSnow) env.sideMat.color.set(day ? 0xdfe4ea : 0x4e5462);
    else if (dk === 0) env.sideMat.color.set(day ? 0x8a8478 : 0x34322e);
    else if (dk === 2) env.sideMat.color.set(day ? 0xcfc4b2 : 0x45403a);
    else env.sideMat.color.set(day ? 0xb7bac0 : 0x3a3e48);
    env.roadMat.color.set(dk === 0 ? (day ? 0x7a6650 : 0x2e281f) : day ? 0x4a4d55 : 0x202227);
    if (isRain) env.roadMat.color.multiplyScalar(0.72);
    env.roadMat.roughness = isRain ? 0.25 : 0.85;
    env.roadMat.metalness = isRain ? 0.15 : 0;
    k.roofMat.color.set(isSnow ? 0xeef2f6 : 0xa8492f);
    env.skylineMat.color.set(day ? (isRain ? 0x8794a2 : isSnow ? 0xb4c2cf : 0xa9bccf) : 0x161a25);
    env.bgMats.forEach((b: { m: THREE.MeshStandardMaterial; day: THREE.Color; night: THREE.Color; roof: boolean }) => {
      if (b.roof && isSnow) {
        b.m.color.set(day ? 0xe6ebf0 : 0x6a7282);
        return;
      }
      b.m.color.copy(day ? b.day : b.night);
      if (isRain) b.m.color.multiplyScalar(0.82);
    });
    env.bgWinOn.color.set(day ? 0x8fa7bd : 0xe8b45e);
    env.bgWinOff.color.set(day ? 0x8fa7bd : 0x2b3140);
    env.farWins.visible = !day;
    // Разметка и бордюр: на окраине их нет (в макете это делает buildDecor).
    dashGroup.visible = dk > 0;
    env.curbMesh.visible = dk > 0;
    envHooks.forEach((h) => h(state));
  }
  applyEnv();

  /** Материалы, которые меняются днём/ночью, по погоде и району: их склеиваем только сами с собой. */
  const mutable = new Set<THREE.Material>();
  function probe() {
    const saved = { ...state };
    const steps: Array<() => void> = [];
    for (const day of [true, false])
      for (const weather of ['clear', 'rain', 'snow'] as Weather[])
        for (const district of [0, 1, 2] as const)
          steps.push(() => {
            Object.assign(state, { day, weather, district });
            applyEnv();
          });
    findMutable(scene, steps, mutable, [...Object.values(k), ...Object.values(env)]);
    Object.assign(state, saved);
    applyEnv();
  }
  probe();

  // Окружение неподвижно: сотни деталей задних домов, кустов и фонарей → несколько мешей по материалам.
  const keep = [dashGroup, env.curbMesh, env.farWins, env.ground];
  mergeStatic(scene, mutable, keep);
  mergeStatic(dashGroup, mutable);
  mergeStatic(env.farWins, mutable);
  const facing = new THREE.Quaternion();
  {
    const c = new THREE.PerspectiveCamera();
    c.position.copy(OFFSET);
    c.lookAt(0, 0, 0);
    facing.copy(c.quaternion);
  }
  const glows = mergeSprites(scene, k.glowMat, facing);
  if (glows) envHooks.push(() => {
    glows.visible = k.glowMat.visible;
  });
  applyEnv();

  /** Камера смотрит на target, солнце и его тени ходят вместе с ней. */
  function placeCamera(camera: THREE.Camera, target: THREE.Vector3) {
    camera.position.copy(target).add(OFFSET);
    camera.lookAt(target);
    dir.position.copy(target).add(LIGHT_OFF);
    dir.target.position.copy(target);
    dir.target.updateMatrixWorld();
  }

  return { k, env, hemi, dir, state, envHooks, applyEnv, placeCamera, mutable, probe };
}

/** Рамка ортокамеры как в макете: на узком экране ширина 18 единиц, на широком — высота 14. */
export function frameCamera(camera: THREE.OrthographicCamera, w: number, h: number) {
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
  camera.left = -hw;
  camera.right = hw;
  camera.top = hh;
  camera.bottom = -hh;
  camera.updateProjectionMatrix();
}
