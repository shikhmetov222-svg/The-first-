// Ускорение улицы: неподвижные детали склеиваются в несколько больших мешей, свечения — в один,
// прохожие рисуются через InstancedMesh. Геометрия и цвета не меняются — только число вызовов отрисовки.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type AnyMat = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  map?: THREE.Texture | null;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
};

/** Снимок того, что игра может менять у материала (день/ночь, погода, анимации). */
function matSnap(m: AnyMat): string {
  return [
    m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.opacity, m.visible,
    m.map?.uuid, m.roughness, m.metalness,
  ].join('|');
}

function collectMaterials(root: THREE.Object3D, out: Set<AnyMat>) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as AnyMat | AnyMat[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => out.add(x));
    else if (m) out.add(m);
  });
}

/**
 * Какие материалы меняются на ходу: прогоняем шаги (например, все сочетания дня, погоды и района)
 * и после каждого смотрим, у каких материалов что-то поменялось. Такие материалы склеиваем только сами с собой.
 */
export function findMutable(
  root: THREE.Object3D, steps: Array<() => void>, out = new Set<THREE.Material>(), extra: unknown[] = [],
) {
  const mats = new Set<AnyMat>();
  collectMaterials(root, mats);
  extra.forEach((m) => {
    if (m instanceof THREE.Material) mats.add(m as AnyMat);
  });
  const before = new Map<AnyMat, string>();
  mats.forEach((m) => before.set(m, matSnap(m)));
  steps.forEach((step) => {
    step();
    mats.forEach((m) => {
      if (before.get(m) !== matSnap(m)) out.add(m);
    });
  });
  return out;
}

/**
 * Что в здании двигается: прогоняем его анимации на нескольких моментах времени и запоминаем объекты,
 * у которых поменялось положение, поворот, масштаб или видимость. Их не склеиваем, всё возвращаем как было.
 */
function findAnimated(g: THREE.Object3D, mutable: Set<THREE.Material>) {
  const anims = (g.userData.anims || []) as Array<(t: number, dt: number) => void>;
  const flicker = (g.userData.flicker || []) as THREE.Material[];
  flicker.forEach((m) => mutable.add(m));
  const moving = new Set<THREE.Object3D>();
  if (!anims.length) return moving;
  const objs: THREE.Object3D[] = [];
  g.traverse((o) => objs.push(o));
  const snap = (o: THREE.Object3D) =>
    [o.position.toArray(), o.quaternion.toArray(), o.scale.toArray(), o.visible].join('|');
  const saved = objs.map((o) => ({
    o, s: snap(o), p: o.position.clone(), q: o.quaternion.clone(), sc: o.scale.clone(), v: o.visible,
  }));
  const mats = new Set<AnyMat>();
  collectMaterials(g, mats);
  const savedMats = new Map<AnyMat, { s: string; map: THREE.Texture | null | undefined }>();
  mats.forEach((m) => savedMats.set(m, { s: matSnap(m), map: m.map }));
  for (const t of [0.37, 1.13, 2.9, 4.4, 7.7, 13.1]) {
    anims.forEach((fn) => fn(t, 0.2));
    saved.forEach((x) => {
      if (snap(x.o) !== x.s) moving.add(x.o);
    });
    mats.forEach((m) => {
      if (savedMats.get(m)!.s !== matSnap(m)) mutable.add(m);
    });
  }
  saved.forEach((x) => {
    x.o.position.copy(x.p);
    x.o.quaternion.copy(x.q);
    x.o.scale.copy(x.sc);
    x.o.visible = x.v;
  });
  mats.forEach((m) => {
    const s = savedMats.get(m)!;
    if ('map' in m) m.map = s.map ?? null;
  });
  return moving;
}

/** Материалы без текстуры, у которых различается только цвет, склеиваем в один — цвет уходит в вершины. */
function bakeSignature(m: AnyMat, mutable: Set<THREE.Material>): string | null {
  if (mutable.has(m) || m.map || m.vertexColors) return null;
  const common = [m.transparent, m.opacity, m.side, m.depthWrite, m.depthTest, m.blending, (m as { fog?: boolean }).fog].join('|');
  if (m instanceof THREE.MeshBasicMaterial) {
    if (m.alphaMap || m.aoMap || m.envMap) return null;
    return `basic|${common}`;
  }
  if (!(m instanceof THREE.MeshStandardMaterial)) return null;
  if (m.emissiveMap || m.alphaMap || m.normalMap || m.roughnessMap || m.metalnessMap) return null;
  return [m.flatShading, m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity, common].join('|');
}

const bakedMats = new Map<string, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>();
function bakedMaterial(sig: string, like: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial) {
  let m = bakedMats.get(sig);
  if (!m) {
    m = like.clone();
    m.color.setRGB(1, 1, 1);
    m.vertexColors = true;
    bakedMats.set(sig, m);
  }
  return m;
}

interface Item {
  mesh: THREE.Mesh;
  matrix: THREE.Matrix4;
  color: THREE.Color | null;
}

/** Геометрия детали в координатах контейнера, только position/normal/uv (+ цвет). */
function prepare(it: Item, indexed: boolean): THREE.BufferGeometry {
  let g = it.mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!indexed && g.index) g = g.toNonIndexed();
  g.applyMatrix4(it.matrix);
  // Зеркальный масштаб выворачивает треугольники — разворачиваем обход обратно.
  if (it.matrix.determinant() < 0) {
    if (g.index) {
      const a = g.index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    } else {
      for (const name of Object.keys(g.attributes)) {
        const at = g.attributes[name] as THREE.BufferAttribute;
        const s = at.itemSize, arr = at.array as Float32Array;
        for (let i = 0; i < at.count; i += 3) {
          for (let k = 0; k < s; k++) {
            const p = (i + 1) * s + k, q = (i + 2) * s + k;
            [arr[p], arr[q]] = [arr[q], arr[p]];
          }
        }
      }
    }
  }
  if (it.color) {
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = it.color.r;
      c[i * 3 + 1] = it.color.g;
      c[i * 3 + 2] = it.color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

/**
 * Склеить неподвижные меши внутри root. keep — объекты (с потомками), которые трогать нельзя:
 * двигаются, прячутся или нужны коду по ссылке. Возвращает, сколько мешей было и стало.
 */
export function mergeStatic(
  root: THREE.Object3D,
  mutable: Set<THREE.Material>,
  keep: Iterable<THREE.Object3D> = [],
  /** Какие материалы можно запечь в цвет вершин (по умолчанию — любые неизменяемые). */
  bakeable: (m: THREE.Material) => boolean = () => true,
  /** Слой «теневой копии»: если задан, все неподвижные тени контейнера рисуются одним мешем (см. shadowProxy). */
  proxyLayer?: number,
) {
  const skip = new Set(keep);
  findAnimated(root, mutable).forEach((o) => skip.add(o));
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<string, { mat: THREE.Material; items: Item[]; baked: boolean }>();
  let before = 0;

  const visit = (o: THREE.Object3D) => {
    if (skip.has(o) || !o.visible) return;
    o.children.forEach(visit);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || o === root) return;
    const mat = mesh.material as AnyMat;
    if (!mesh.geometry || Array.isArray(mat) || mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    if (Object.keys(mesh.geometry.morphAttributes).length) return;
    before++;
    const sig = bakeable(mat) ? bakeSignature(mat, mutable) : null;
    // С теневой копией тени рисует она, поэтому «отбрасывает тень» больше не разделяет детали.
    const flags = `${proxyLayer === undefined && mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}${mesh.renderOrder}`;
    const key = sig ? `b${flags}|${sig}` : `m${flags}|${mat.uuid}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, items: [], baked: !!sig }));
    b.items.push({
      mesh,
      matrix: inv.clone().multiply(mesh.matrixWorld),
      color: sig ? (mat as THREE.MeshBasicMaterial).color.clone() : null,
    });
  };
  visit(root);

  let after = before;
  buckets.forEach((b) => {
    if (b.items.length < 2) return;
    const indexed = b.items.every((it) => it.mesh.geometry.index);
    const geos = b.items.map((it) => prepare(it, indexed));
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const first = b.items[0].mesh;
    const mat = b.baked ? bakedMaterial(bakeSignature(b.mat as AnyMat, mutable)!, b.mat as THREE.MeshStandardMaterial) : b.mat;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = b.items.some((it) => it.mesh.castShadow);
    m.receiveShadow = first.receiveShadow;
    m.renderOrder = first.renderOrder;
    m.name = 'merged';
    root.add(m);
    b.items.forEach((it) => {
      it.mesh.parent?.remove(it.mesh);
      it.mesh.geometry.dispose();
    });
    after -= b.items.length - 1;
  });
  pruneEmpty(root, skip);
  if (proxyLayer !== undefined) shadowProxy(root, skip, proxyLayer);
  return { before, after };
}

const proxyMat = new THREE.MeshBasicMaterial();
/**
 * Теневая копия: вся неподвижная геометрия контейнера, которая отбрасывает тень, — одним мешем на отдельном слое.
 * Этот слой видит только камера теней, поэтому в картинке копии нет, а тени стоят один вызов вместо десятков.
 */
function shadowProxy(root: THREE.Object3D, skip: Set<THREE.Object3D>, layer: number) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const casters: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o) || !o.visible) return;
    o.children.forEach(visit);
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && m.castShadow && m.geometry?.attributes.position) casters.push(m);
  };
  visit(root);
  if (casters.length < 2) return;
  const geos = casters.map((m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', m.geometry.attributes.position.clone());
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    g.applyMatrix4(inv.clone().multiply(m.matrixWorld));
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) return;
  casters.forEach((m) => {
    m.castShadow = false;
  });
  const proxy = new THREE.Mesh(merged, proxyMat);
  proxy.castShadow = true;
  proxy.layers.set(layer);
  proxy.name = 'shadow-proxy';
  root.add(proxy);
}

/** Убрать опустевшие группы, чтобы сцену не приходилось обходить зря. */
function pruneEmpty(o: THREE.Object3D, skip: Set<THREE.Object3D>) {
  [...o.children].forEach((c) => {
    if (skip.has(c)) return;
    pruneEmpty(c, skip);
    if (!c.children.length && c.type === 'Group') o.remove(c);
  });
}

/**
 * Свечения-спрайты → один меш из квадратов, повёрнутых к камере. Камера на улице никогда не вращается
 * (только сдвиг и зум), поэтому квадраты всегда смотрят на неё так же, как спрайты.
 */
export function mergeSprites(scene: THREE.Object3D, spriteMat: THREE.SpriteMaterial, facing: THREE.Quaternion) {
  const sprites: THREE.Sprite[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Sprite).isSprite && (o as THREE.Sprite).material === spriteMat) sprites.push(o as THREE.Sprite);
  });
  if (sprites.length < 2) return null;
  scene.updateMatrixWorld(true);
  const geos = sprites.map((s) => {
    const g = new THREE.PlaneGeometry(1, 1);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    s.matrixWorld.decompose(p, q, sc);
    g.applyMatrix4(new THREE.Matrix4().compose(p, facing, new THREE.Vector3(sc.x, sc.y, 1)));
    return g;
  });
  const mat = new THREE.MeshBasicMaterial({
    map: spriteMat.map, blending: spriteMat.blending, depthWrite: false, transparent: true, fog: spriteMat.fog,
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, mat);
  geos.forEach((g) => g.dispose());
  mesh.name = 'glows';
  mesh.renderOrder = 1;
  sprites.forEach((s) => s.parent?.remove(s));
  scene.add(mesh);
  return mesh;
}

/**
 * Прохожие через InstancedMesh. Логика движения остаётся прежней и двигает невидимые «скелеты»;
 * sync() каждый кадр переносит их положение в инстансы. Все люди должны быть собраны одинаково.
 */
export function instancePeople(scene: THREE.Scene, people: THREE.Object3D[], shadows = true, mergeUniform = false) {
  const HIDDEN_LAYER = 31;
  const leaves = people.map((p) => {
    const out: THREE.Mesh[] = [];
    p.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  });
  const n = leaves[0]?.length ?? 0;
  if (!n || leaves.some((l) => l.length !== n)) return { sync: () => {} };
  const colorOf = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color;

  // mergeUniform: детали, одинаковые по цвету у всех (колёса, кабина, фары), склеиваются в одну деталь модели;
  // отдельными инстансами остаются только детали, цвет которых у каждого свой (кузов, рубашка).
  // Только для моделей, у которых детали не прячутся по отдельности (у прохожих на улице есть зонтики).
  const uniform = leaves[0].map((proto, j) => mergeUniform && leaves.every((l) => colorOf(l[j]).equals(colorOf(proto))));
  const empty = new Set<THREE.Material>();
  const shared = new Map<string, number[]>();
  leaves[0].forEach((proto, j) => {
    if (!uniform[j]) return;
    const sig = bakeSignature(proto.material as AnyMat, empty);
    const key = sig ?? `part${j}`;
    shared.set(key, [...(shared.get(key) ?? []), j]);
  });

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cast: boolean, recv: boolean) => {
    const im = new THREE.InstancedMesh(geo, mat, people.length);
    im.castShadow = shadows && cast;
    im.receiveShadow = recv;
    im.frustumCulled = false;
    scene.add(im);
    return im;
  };
  // Отдельные детали: матрица — сама деталь, цвет — свой у каждого.
  const single = leaves[0].map((proto, j) => {
    if (uniform[j]) return null;
    const base = (proto.material as THREE.MeshStandardMaterial).clone();
    base.color.setRGB(1, 1, 1);
    const im = mk(proto.geometry, base, proto.castShadow, proto.receiveShadow);
    people.forEach((_, i) => im.setColorAt(i, colorOf(leaves[i][j])));
    return im;
  });
  // Склеенные одинаковые детали: геометрия в координатах модели, цвет — в вершинах, матрица — вся модель.
  const root0 = people[0];
  root0.updateMatrixWorld(true);
  const inv0 = root0.matrixWorld.clone().invert();
  const groups = [...shared.values()].map((js) => {
    const proto = leaves[0][js[0]];
    const items = js.map((jj) => ({ mesh: leaves[0][jj], matrix: inv0.clone().multiply(leaves[0][jj].matrixWorld), color: colorOf(leaves[0][jj]).clone() }));
    const indexed = items.every((it) => it.mesh.geometry.index);
    const geos = items.map((it) => prepare(it, indexed));
    const geo = js.length > 1 ? mergeGeometries(geos, false)! : geos[0];
    const mat = (proto.material as THREE.MeshStandardMaterial).clone();
    mat.color.setRGB(1, 1, 1);
    mat.vertexColors = true;
    return { js, im: mk(geo, mat, items.some((it) => it.mesh.castShadow), proto.receiveShadow) };
  });
  leaves.forEach((l) => l.forEach((m) => m.layers.set(HIDDEN_LAYER)));

  const shown = (o: THREE.Object3D, top: THREE.Object3D) => {
    for (let x: THREE.Object3D | null = o; x; x = x.parent) {
      if (!x.visible) return false;
      if (x === top) return true;
    }
    return true;
  };
  const all = [...single.filter(Boolean), ...groups.map((g) => g.im)] as THREE.InstancedMesh[];
  function sync() {
    people.forEach((p, i) => {
      const vis = p.visible;
      if (vis) p.updateMatrixWorld(true);
      leaves[i].forEach((m, j) => single[j]?.setMatrixAt(i, vis && shown(m, p) ? m.matrixWorld : zero));
      groups.forEach((g) => g.im.setMatrixAt(i, vis ? p.matrixWorld : zero));
    });
    all.forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
    });
  }
  sync();
  return { sync };
}
