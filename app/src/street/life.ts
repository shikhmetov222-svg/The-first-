// Жизнь улицы: прохожие у бизнесов, машины, собака, погода, фургон, монетки, дым и район.
// Движение — из цикла frame() в docs/street-mockup.js; что показывать — из данных игры (views.ts → StreetLife).
import * as THREE from 'three';
import { createLife } from './gen/life.js';
import { createDecor } from './gen/decor.js';
import type { World, EnvState } from './world';
import type { Slots } from './slots';
import { SLOT_TYPES, type GameType, type StreetLife } from './views';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const PER_SLOT = 3; // прохожих у одного бизнеса максимум

interface Walker {
  g: THREE.Group;
  dir: number;
  speed: number;
  phase: number;
  um: THREE.Object3D;
  y0: number;
  lim: number;
}

interface Crowd extends Walker {
  slot: number;
}

export function createLifeController(world: World, slots: Slots, scene: THREE.Scene, pixelRatio: number, reduce: boolean) {
  const { k } = world;
  const life = createLife(k, scene, pixelRatio);
  // Состояние фургона из макета: idle → in → stop → out; target — слот, к которому он едет.
  const vanState = life.vanState as { mode: string; t: number; target: { x: number; street: string } | null };
  const VAN_LABEL = life.VAN_LABEL as Record<string, string>;
  const decor = createDecor(k, scene, world.env, slots.types);

  // Прохожие на ближнем тротуаре из макета (первые 7) заменяем на «толпу у бизнесов» — её размер зависит от спроса.
  const ambient: Walker[] = life.walkers.slice(7);
  life.walkers.slice(0, 7).forEach((w: Walker) => scene.remove(w.g));

  const umbrella = () => {
    const um = new THREE.Group();
    k.add(um, k.cyl(0.015, 0.015, 0.5, k.darkMat, 5), 0, 0.25, 0);
    k.add(um, k.cone(0.38, 0.18, k.M(k.pick(k.shirts)), 8), 0, 0.55, 0);
    um.position.set(0.12, 0.75, 0);
    um.visible = false;
    return um;
  };
  const crowd: Crowd[] = [];
  SLOT_TYPES.forEach((s, i) => {
    for (let j = 0; j < PER_SLOT; j++) {
      const p = k.person() as THREE.Group;
      const dirn = Math.random() < 0.5 ? 1 : -1;
      p.position.set(s.x + rand(-2, 2), 0.12, rand(1.65, 1.9));
      p.rotation.y = dirn > 0 ? Math.PI / 2 : -Math.PI / 2;
      const um = umbrella();
      p.add(um);
      p.visible = false;
      scene.add(p);
      crowd.push({ g: p, dir: dirn, speed: rand(0.35, 0.6), phase: rand(0, 6), um, y0: 0.12, lim: 2.4, slot: i });
    }
  });

  // Погода и облака — часть смены окружения.
  world.envHooks.push((st: EnvState) => {
    const day = st.day, isRain = st.weather === 'rain', isSnow = st.weather === 'snow';
    life.snow.material.opacity = day ? 0.4 : 0.35;
    life.clouds.forEach((c: THREE.Object3D) => {
      c.visible = day;
    });
    life.cloudMat.color.set(isRain ? 0x9aa3ad : 0xffffff);
    life.cloudMat.emissive.set(isRain ? 0x6a727c : 0xffffff);
    life.rain.visible = isRain;
    life.snow.visible = isSnow;
    [...ambient, ...crowd].forEach((w) => {
      w.um.visible = isRain;
    });
  });

  // Район: декор строится заново только при смене.
  let builtDistrict = -1;
  let billboard: THREE.Group | null = null;
  let billboardKey = '';
  const lastSale: Partial<Record<GameType, string | null>> = {};
  let firstData = true;

  function setData(data: StreetLife) {
    const st = world.state;
    let changed = false;
    if (data.district !== builtDistrict) {
      builtDistrict = data.district;
      decor.buildDecor(data.district);
      st.district = data.district;
      changed = true;
    }
    if (st.weather !== data.weather) {
      st.weather = data.weather;
      changed = true;
    }
    if (changed) world.applyEnv();

    // Рекламный щит у дороги: активная кампания игрока или «место свободно».
    const key = data.billboard.lines.join('|') + data.billboard.color;
    if (key !== billboardKey) {
      billboardKey = key;
      if (billboard) {
        scene.remove(billboard);
        slots.types.disposeGroup(billboard);
      }
      billboard = decor.billboard(data.billboard.lines, data.billboard.color, -22.6, 1.0) as THREE.Group;
      scene.add(billboard);
    }

    // Прохожие у бизнесов — по спросу.
    SLOT_TYPES.forEach((s, i) => {
      const n = data.crowd[s.game] ?? 0;
      crowd.filter((c) => c.slot === i).forEach((c, j) => {
        c.g.visible = j < n;
      });
    });

    // Монетки: у бизнеса появилась новая выручка на тике (первый показ — без монеток).
    SLOT_TYPES.forEach((s) => {
      const sale = data.sales[s.game];
      if (!firstData && sale.at && sale.at !== lastSale[s.game] && sale.amount > 0) coin(s.game, sale.amount);
      lastSale[s.game] = sale.at;
    });
    firstData = false;
  }

  /** Монетка «+X ₽» над зданием (сумма в копейках). */
  function coin(type: GameType, kopecks: number) {
    const s = slots.slots.find((x) => x.game === type);
    if (!s || s.level === 0) return;
    const sp = life.coinSprite(Math.round(kopecks / 100)) as THREE.Sprite;
    const y0 = s.group.userData.top ?? 2;
    sp.position.set(s.x, y0, 0.3);
    scene.add(sp);
    slots.anim.tween(
      1.5,
      (p: number) => {
        sp.position.y = y0 + p * 1.3;
        sp.material.opacity = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      },
      () => {
        scene.remove(sp);
        sp.userData.dispose();
      },
    );
  }

  /** Фургон приезжает к бизнесу (после пополнения склада). Пока он в пути — следующий ждёт. */
  const vanQueue: GameType[] = [];
  function van(type: GameType) {
    const s = slots.slots.find((x) => x.game === type);
    if (!s || s.level === 0) return;
    if (vanState.mode === 'idle') startVan(type);
    else if (vanQueue.length < 3) vanQueue.push(type);
  }
  function startVan(type: GameType) {
    const s = slots.slots.find((x) => x.game === type)!;
    vanState.target = s;
    life.dv.position.x = -28;
    vanState.mode = 'in';
  }

  let smokeT = 0;
  function update(clock: number, dt: number) {
    if (reduce) return;
    [...ambient, ...crowd].forEach((w) => {
      if (!w.g.visible) return;
      w.g.position.x += w.dir * w.speed * dt;
      if ('slot' in w) {
        // Прохожие у бизнеса гуляют туда-обратно возле него.
        const cx = SLOT_TYPES[(w as Crowd).slot].x;
        if (Math.abs(w.g.position.x - cx) > w.lim) {
          w.dir = -w.dir;
          w.g.position.x = cx + Math.sign(w.g.position.x - cx) * w.lim;
          w.g.rotation.y = w.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      } else {
        if (w.g.position.x > w.lim) w.g.position.x = -w.lim;
        if (w.g.position.x < -w.lim) w.g.position.x = w.lim;
      }
      w.g.position.y = w.y0 + Math.abs(Math.sin(clock * 7 + w.phase)) * 0.05;
    });
    const o = life.dogOwner;
    life.dog.position.set(o.g.position.x + o.dir * 0.75, 0.06 + Math.abs(Math.sin(clock * 11)) * 0.04, o.g.position.z + 0.3);
    life.dog.rotation.y = o.dir > 0 ? 0 : Math.PI;
    life.cars.forEach((c: { g: THREE.Object3D; dir: number; speed: number }) => {
      c.g.position.x += c.dir * c.speed * dt;
      if (c.g.position.x > 27) c.g.position.x = -27;
      if (c.g.position.x < -27) c.g.position.x = 27;
    });
    if (life.rain.visible) {
      const rp = life.rainPos;
      for (let i = 0; i < life.RN; i++) {
        const q = i * 6;
        rp[q + 1] -= 13 * dt;
        rp[q + 4] -= 13 * dt;
        if (rp[q + 4] < 0) {
          const y = 12 + Math.random() * 2;
          rp[q + 1] = y;
          rp[q + 4] = y - 0.45;
        }
      }
      life.rainGeo.attributes.position.needsUpdate = true;
    }
    if (life.snow.visible) {
      const sp = life.snowPos;
      for (let i = 0; i < life.SN; i++) {
        const q = i * 3;
        sp[q + 1] -= 0.7 * dt;
        sp[q] += Math.sin(clock * 1.2 + i) * 0.2 * dt;
        if (sp[q + 1] < 0) sp[q + 1] = 10;
      }
      life.snowGeo.attributes.position.needsUpdate = true;
    }
    life.clouds.forEach((c: THREE.Object3D, i: number) => {
      c.position.x += (0.25 + i * 0.05) * dt;
      if (c.position.x > 32) c.position.x = -32;
    });
    const jet = decor.getFountainJet();
    if (jet) jet.scale.y = 1 + 0.18 * Math.sin(clock * 6);

    // Фургон: въезжает, стоит у бизнеса с подписью, уезжает.
    const vs = vanState, dv = life.dv;
    if (vs.mode === 'idle') {
      const next = vanQueue.shift();
      if (next) startVan(next);
    } else if (vs.mode === 'in' && vs.target) {
      dv.position.x += 4 * dt;
      if (dv.position.x >= vs.target.x - 0.2) {
        dv.position.x = vs.target.x - 0.2;
        vs.mode = 'stop';
        vs.t = 2.4;
        const lb = life.labelSprite(VAN_LABEL[vs.target.street] || 'Склад пополнен') as THREE.Sprite;
        const y0 = 1.6;
        lb.position.set(dv.position.x, y0, 2.75);
        scene.add(lb);
        slots.anim.tween(
          2.2,
          (p: number) => {
            lb.position.y = y0 + p * 0.8;
            lb.material.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          },
          () => {
            scene.remove(lb);
            lb.userData.dispose();
          },
        );
      }
    } else if (vs.mode === 'stop') {
      vs.t -= dt;
      if (vs.t <= 0) vs.mode = 'out';
    } else {
      dv.position.x += 4 * dt;
      if (dv.position.x > 28) {
        dv.position.x = -30;
        vs.mode = 'idle';
      }
    }

    // Пар над кофейнями, дым из труб пекарни.
    smokeT += dt;
    if (smokeT > 0.5) {
      smokeT = 0;
      slots.slots.forEach((s) => {
        if (s.busy) return;
        (s.group.userData.smoke || []).forEach((e: { x: number; y: number; z: number; kind: string }) => {
          if (e.kind === 'steam') slots.anim.puff(s.x + e.x, e.y, e.z, 0xf2f2f4, 0.1, 0.9, 1.6);
          else slots.anim.puff(s.x + e.x, e.y, e.z, 0x8f8a86, 0.16, 1.6, 2.4);
        });
      });
    }
  }

  return { setData, coin, van, update };
}

export type LifeController = ReturnType<typeof createLifeController>;
