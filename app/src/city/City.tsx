// 3D-карта города (вкладка «Карта»): город из docs/city-mockup.html, участки — из данных сервера.
// Управление и цикл кадра — как в макете; пауза, FPS и снижение чёткости — как у улицы (street/Street.tsx).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Lock } from 'lucide-react';
import * as THREE from 'three';
import { createCityWorld, frameCityCamera, type CityWorld } from './world';
import { DISTRICTS, districtOf, type CityPlot, type DistrictKey, type Owner } from './views';
import { isDaytime, streetDev } from '../street/views';
import { money } from '../format';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOME_C = new THREE.Vector3(-8, 2.4, 6);

/** Участок макета (поля из gen/city.js). */
export interface MapPlot extends CityPlot {
  x: number;
  z: number;
  cx: number;
  cz: number;
  demand: number;
  group: THREE.Group;
  pin?: THREE.Sprite;
  ped?: THREE.Group;
  /** Стройка в макете (gen/city.js): этап, леса, плашка прогресса. */
  build?: { brigade: string; owner?: Owner; idx: number };
  heat?: THREE.Mesh;
  /** Сервер сказал, что стройка закончена, — доводим визуал до конца. */
  srvDone?: boolean;
  /** Срок стройки, которую карта уже довела до конца (пока сервер не прислал новое состояние). */
  finishedEnds?: string;
}

/** Что выбрано на карте — карточку показывает React. */
export type MapPick =
  | { kind: 'plot'; plot: CityPlot; district: Exclude<DistrictKey, 'park'>; demand: number }
  | { kind: 'home'; info: { kind: string; floors?: number; residents?: number; workers?: number; note?: string; stats?: [string, string][] }; district: DistrictKey | null }
  | { kind: 'site'; district: Exclude<DistrictKey, 'park'> };

export interface CityRequest {
  /** Наехать камерой на участок. */
  focus?: { i: number; j: number; k: number; zoom?: number; district?: boolean };
  /** Вернуть общий вид. */
  home?: boolean;
  n: number;
}

interface Props {
  seed: number;
  stage: number;
  caps: number[];
  plots: CityPlot[];
  me: Owner;
  onPick: (p: MapPick | null) => void;
  request?: CityRequest;
  heat: boolean;
  /** Монетка над своим бизнесом: тип и сумма (коп.). */
  coin?: { type: string; amount: number; n: number };
  /** Разница часов телефона и сервера, мс — стройка идёт по времени сервера. */
  serverOffset: number;
  /** Стройка на участке закончилась на карте (конфетти уже показаны). */
  onFinished?: (p: CityPlot, wasLot: boolean) => void;
  /** «Графика: низкая»: без теней, велосипедистов, конфетти и с половиной машин. */
  low?: boolean;
  /** События в городе: отметка на названии района. */
  events?: { district: string; text: string; bad: boolean }[];
}

const slotKey = (plots: CityPlot[]) => plots.map((p) => `${p.i}:${p.j}:${p.k}`).sort().join('|');
/** Облик участка на карте сейчас (у объекта из gen/city.js те же поля). */
const plotKey = (p: CityPlot) => `${p.type ?? ''}:${p.level ?? 0}:${p.lot ? 1 : 0}:${p.owner?.name ?? ''}:${p.owner?.me ? 1 : 0}:${p.price ?? 0}`;

function CityScene({ seed, stage, caps, plots, me, onPick, request, heat, coin, serverOffset, onFinished, low = false, events }: Props) {
  const { scene, camera, gl, size } = useThree();
  const cam = camera as THREE.OrthographicCamera;
  const world = useRef<CityWorld | null>(null);
  const target = useRef(HOME_C.clone());
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const dev = useSyncExternalStore(streetDev.subscribe, streetDev.get);
  const [day, setDay] = useState(isDaytime);
  const homeZoom = () => (size.width / Math.max(1, size.height) < 1 ? 0.5 : 0.4);
  const timers = useRef({ occ: 0, smoke: 0 });

  const offsetRef = useRef(serverOffset);
  offsetRef.current = serverOffset;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  if (!world.current) {
    world.current = createCityWorld(scene, {
      seed, stage, caps, plots, me, camera: cam,
      progress: (pp) => {
        const p = pp as MapPlot;
        if (p.srvDone || !p.srv) return 1;
        if (p.srv.queued) return 0;
        const a = new Date(p.srv.started_at).getTime(), e = new Date(p.srv.ends_at).getTime();
        return Math.max(0, Math.min(1, (Date.now() + offsetRef.current - a) / Math.max(1, e - a)));
      },
      onFinished: (pp, wasLot) => {
        const p = pp as MapPlot;
        p.game = p.srv?.game ?? p.game;
        p.finishedEnds = p.srv?.ends_at;
        p.srv = undefined;
        p.srvDone = false;
        p.price = undefined;
        finishedRef.current?.(p, wasLot);
      },
    });
    world.current.applyTime(dev.day ?? isDaytime());
    world.current.setLow(low);
    // Для замеров на стенде (только в режиме разработки, в игру не попадает).
    if (import.meta.env.DEV) (window as unknown as { __city: unknown }).__city = { world: world.current, scene, gl, cam, THREE, target: target.current };
  }
  // Сгенерированный модуль макета (gen/city.js) — без типов.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const city = world.current.city as unknown as Record<string, any>;

  useEffect(() => () => {
    // Карта закрыта — освобождаем видеопамять.
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
  }, [scene]);

  useEffect(() => {
    frameCityCamera(cam, size.width, size.height);
    zoomTo(homeZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam, size.width, size.height]);

  function zoomTo(z: number) {
    cam.zoom = clamp(z, 0.22, 2.2);
    cam.updateProjectionMatrix();
  }

  // День и ночь — по часам игрока или как задал разработчик.
  useEffect(() => {
    const id = window.setInterval(() => setDay(isDaytime()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const isDay = dev.day ?? day;
  useEffect(() => {
    world.current!.applyTime(isDay);
  }, [isDay]);

  // Рост города: открылись новые районы — стройплощадки сменяются кварталами.
  const shownStage = useRef(stage);
  useEffect(() => {
    if (stage === shownStage.current) return;
    const up = stage > shownStage.current;
    shownStage.current = stage;
    city.setStage(stage);
    city.applyStage(up && !reduceMotion);
    world.current!.markShadows();
  }, [stage, city]);

  // Участки: тот же набор мест — перерисовываем только изменившиеся (новый уровень, владелец, куплен участок);
  // идёт стройка — на участке забор, леса и плашка с этапом и процентом (визуал — из gen/city.js).
  useEffect(() => {
    plots.forEach((np) => {
      const p = (city.plots as MapPlot[]).find((q) => q.i === np.i && q.j === np.j && q.k === np.k);
      if (!p) return; // нового места в этом городе нет — появится при следующем открытии карты
      if (np.srv) {
        // Эту стройку карта уже показала законченной — ждём, пока сервер пришлёт новое состояние.
        if (np.srv.ends_at === p.finishedEnds) return;
        p.srv = np.srv;
        p.srvDone = false;
        if (!p.build) {
          city.startConstruction(p, np.srv.type, np.srv.level);
          p.build!.brigade = np.srv.brigade;
          p.build!.owner = np.srv.owner;
          world.current!.markShadows();
        }
        return;
      }
      if (p.build) {
        // Сервер уже достроил — визуал доходит до конца сам (с конфетти).
        p.srvDone = true;
        return;
      }
      if (plotKey(p) === plotKey(np)) return;
      scene.remove(p.group);
      world.current!.types.disposeGroup(p.group);
      if (!np.owner?.me) {
        if (p.ped) {
          scene.remove(p.ped);
          p.ped = undefined;
        }
        if (p.pin) {
          scene.remove(p.pin);
          p.pin = undefined;
        }
      }
      Object.assign(p, { type: np.type, game: np.game, level: np.level ?? 0, owner: np.owner, lot: np.lot, price: np.price });
      const g = city.buildPlotVisual(p) as THREE.Group;
      if (p.heat) p.heat.visible = heat;
      const s0 = g.scale.x;
      g.scale.y = 0.01;
      city.tween(0.6, (q: number) => {
        g.scale.y = Math.max(0.01, s0 * q);
      }, () => world.current!.markShadows());
    });
  }, [plots, city, scene, heat]);

  // Карта спроса.
  useEffect(() => {
    world.current!.setHeat(heat);
    (city.plots as MapPlot[]).forEach((p) => {
      if (p.heat) p.heat.visible = heat;
    });
  }, [heat, city]);

  // Монетка над своим бизнесом — по настоящей выручке.
  useEffect(() => {
    if (!coin) return;
    const p = (city.plots as MapPlot[]).find((q) => q.owner?.me && q.type === coin.type);
    if (!p || p.build || !p.group.visible) return;
    const sp = city.coinSprite(Math.round(coin.amount / 100)) as THREE.Sprite;
    const y0 = (p.group.userData.top ?? 2) + 2.8;
    sp.position.set(p.cx, y0, p.cz);
    scene.add(sp);
    city.tween(1.6, (q: number) => {
      sp.position.y = y0 + q * 1.4;
      sp.material.opacity = q < 0.6 ? 1 : 1 - (q - 0.6) / 0.4;
    }, () => {
      scene.remove(sp);
      sp.material.map?.dispose();
      sp.material.dispose();
    });
  }, [coin?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Запросы из интерфейса: наехать на участок, вернуть общий вид.
  useEffect(() => {
    if (!request) return;
    if (request.home) {
      target.current.copy(HOME_C);
      zoomTo(homeZoom());
    }
    const f = request.focus;
    if (f) {
      const p = f.district ? undefined : (city.plots as MapPlot[]).find((q) => q.i === f.i && q.j === f.j && q.k === f.k);
      // Участка нет (событие в районе) — едем к центру района, туда, где его название.
      const b = p ? null : (city.blocks as { i: number; j: number; x: number; z: number }[]).find((q) => q.i === f.i && q.j === f.j);
      if (p) {
        target.current.set(p.cx + 2, 2.4, p.cz + 4);
        zoomTo(f.zoom ?? 1.1);
      } else if (b) {
        const [x, z] = city.districtCenter(districtOf(f.i, f.j)) as [number, number];
        target.current.set(x, 1.5, z);
        zoomTo(f.zoom ?? 0.6);
      }
    }
  }, [request?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Жесты как в макете: перетаскивание — по карте, щипок — зум, двойной тап — общий вид, тап — карточка.
  useEffect(() => {
    const canvas = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { moved: number } | null = null;
    let pinch: { dist: number; zoom: number } | null = null;
    let lastTap = 0;
    const vR = new THREE.Vector3(), vU = new THREE.Vector3();
    const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const { cityW, cityD, BW, BD, SW, PW } = city;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) down = { moved: 0 };
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: cam.zoom };
        if (down) down.moved = 99;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        const dx = cur.x - prev.x, dy = cur.y - prev.y;
        if (down) down.moved += Math.abs(dx) + Math.abs(dy);
        const wpp = (cam.right - cam.left) / cam.zoom / canvas.clientWidth;
        vR.setFromMatrixColumn(cam.matrix, 0);
        vR.y = 0;
        vR.normalize();
        vU.setFromMatrixColumn(cam.matrix, 1);
        vU.y = 0;
        const L = vU.length() || 1;
        vU.normalize();
        const t = target.current;
        t.addScaledVector(vR, -dx * wpp).addScaledVector(vU, (dy * wpp) / L);
        t.x = clamp(t.x, -cityW / 2, cityW / 2);
        t.z = clamp(t.z, -cityD / 2, cityD / 2 + 10);
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = Array.from(pointers.values());
        zoomTo((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist);
      }
    };
    const select = (o: { x: number; y: number; z: number } | null) => city.setSelected(o ? [o.x, o.y, o.z] : null);
    const pickPlot = (p: MapPlot) => {
      city.showRing(p.x, p.z - 0.85, PW - 0.2, 5.7);
      select({ x: p.cx, y: 1.2, z: p.z + 0.3 });
      const d = districtOf(p.i, p.j) as Exclude<DistrictKey, 'park'>;
      pickRef.current({ kind: 'plot', plot: p, district: d, demand: p.demand });
    };
    const onEnd = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasSingle && down && down.moved < 8 && e.type === 'pointerup') {
        const now = performance.now();
        if (now - lastTap < 320) {
          target.current.copy(HOME_C);
          zoomTo(homeZoom());
          lastTap = 0;
        } else {
          lastTap = now;
          const r = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          raycaster.setFromCamera(ndc, cam);
          const hits = raycaster.intersectObjects(scene.children, true)
            .filter((h) => (h.object as THREE.Mesh).isMesh && h.object !== city.ground && h.object.visible);
          const hp = hits.find((h) => h.object.userData.plot);
          if (hp && (hits[0] === hp || hits[0].distance > hp.distance - 0.5)) pickPlot(hp.object.userData.plot);
          else if (hits.length) {
            const pt = hits[0].point;
            const hm = (city.homes as Array<{ x: number; z: number; hw: number; hd: number; b: unknown; info: never; px: number; pz: number }>)
              .find((h) => !city.isLocked(h.b) && Math.abs(pt.x - h.x) <= h.hw && Math.abs(pt.z - h.z) <= h.hd);
            const lb = (city.blocks as Array<{ d: DistrictKey; x: number; z: number }>)
              .find((b) => b.d !== 'park' && city.isLocked(b) && Math.abs(pt.x - b.x) <= BW / 2 + SW && Math.abs(pt.z - b.z) <= BD / 2 + SW);
            if (hm) {
              city.showRing(hm.x, hm.z, hm.hw * 2 + 0.3, hm.hd * 2 + 0.2);
              select({ x: hm.x, y: 1, z: hm.pz + 0.3 });
              const b = (hm as { b?: { d: DistrictKey } }).b;
              pickRef.current({ kind: 'home', info: hm.info, district: b?.d ?? null });
            } else if (lb) {
              city.showRing(lb.x, lb.z, BW + 2 * SW, BD + 2 * SW);
              select(null);
              pickRef.current({ kind: 'site', district: lb.d as Exclude<DistrictKey, 'park'> });
            } else if (hp) pickPlot(hp.object.userData.plot);
            else clear();
          } else clear();
        }
      }
      if (pointers.size === 0) down = null;
    };
    const clear = () => {
      city.selRing.visible = false;
      select(null);
      pickRef.current(null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onEnd);
    canvas.addEventListener('pointercancel', onEnd);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onEnd);
      canvas.removeEventListener('pointercancel', onEnd);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, cam, city, scene]);

  // Цикл кадра — как frameLoop() в макете.
  const tmpV = useRef(new THREE.Vector3());
  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const clock = world.current!.tick(dt);
    const tw = city.tweens as Array<{ t: number; dur: number; fn: (q: number) => void; done?: () => void }>;
    for (let i = tw.length - 1; i >= 0; i--) {
      const t = tw[i];
      t.t += dt;
      const q = Math.min(1, t.t / t.dur);
      t.fn(q);
      if (q >= 1) {
        tw.splice(i, 1);
        t.done?.();
      }
    }
    city.blocks.forEach((b: { site?: THREE.Object3D; pairs?: unknown[]; op?: number }) => {
      if (b.site && b.site.visible && b.site.userData.anims) b.site.userData.anims.forEach((fn: (c: number, d: number) => void) => fn(clock, dt));
      if (!b.pairs) return;
      const tgt = city.occl.has(b) ? 0.2 : 1, cur = b.op === undefined ? 1 : b.op;
      if (Math.abs(cur - tgt) > 0.005) {
        const nx = Math.abs(tgt - cur) < 0.02 ? tgt : cur + (tgt - cur) * Math.min(1, dt * 7);
        b.op = nx;
        city.setBlockOpacity(b, nx);
      }
    });
    const T = timers.current;
    T.occ += dt;
    if (T.occ > 0.25) {
      T.occ = 0;
      city.checkOcclusion();
    }
    city.updateConstruction(dt);
    (city.plots as MapPlot[]).forEach((p) => {
      const u = p.group.userData;
      if (u.anims) u.anims.forEach((fn: (c: number, d: number) => void) => fn(clock, dt));
      if (u.flicker) u.flicker.forEach((m: THREE.MeshBasicMaterial, i: number) => m.color.setRGB(1, 0.42 + 0.1 * Math.sin(clock * 11 + i * 2), 0.12));
    });
    if (!reduceMotion) {
      const halfW = city.cityW / 2, halfD = city.cityD / 2;
      city.cars.forEach((c: { g: THREE.Object3D; vertical: boolean; dir: number; speed: number; lim?: number }) => {
        if (!c.g.visible) return;
        if (c.vertical) {
          c.g.position.z += c.dir * c.speed * dt;
          if (c.g.position.z > halfD) c.g.position.z = -halfD;
          if (c.g.position.z < -halfD) c.g.position.z = halfD;
        } else {
          const L = c.lim || halfW;
          c.g.position.x += c.dir * c.speed * dt;
          if (c.g.position.x > L) c.g.position.x = -L;
          if (c.g.position.x < -L) c.g.position.x = L;
        }
      });
      const { BW, SW } = city;
      city.walkers.forEach((w: { g: THREE.Object3D; b: { x: number }; dir: number; speed: number; ph: number }) => {
        if (!w.g.visible) return;
        w.g.position.x += w.dir * w.speed * dt;
        const lo = w.b.x - BW / 2 - SW + 0.3, hi = w.b.x + BW / 2 + SW - 0.3;
        if (w.g.position.x > hi) w.g.position.x = lo;
        if (w.g.position.x < lo) w.g.position.x = hi;
        w.g.position.y = 0.12 + Math.abs(Math.sin(clock * 7 + w.ph)) * 0.05;
      });
      city.myPins.forEach((m: { pin: THREE.Sprite; base: number; ph: number }) => {
        m.pin.position.y = m.base + Math.sin(clock * 2.2 + m.ph) * 0.18;
      });
      const jet = city.getFountainJet();
      if (jet) jet.scale.y = 1 + 0.18 * Math.sin(clock * 6);
      T.smoke += dt;
      if (T.smoke > 0.9) {
        T.smoke = 0;
        (city.plots as MapPlot[]).forEach((p) => {
          if (!p.group.visible || p.build) return;
          (p.group.userData.smoke || []).forEach((e: { x: number; y: number; z: number; kind: string }) => {
            const v = tmpV.current.set(e.x, e.y, e.z);
            p.group.localToWorld(v);
            if (e.kind === 'steam') city.puff(v.x, v.y, v.z, 0xf2f2f4, 0.1, 0.9, 1.6);
            else city.puff(v.x, v.y, v.z, 0x8f8a86, 0.16, 1.6, 2.4);
          });
        });
        city.smokeSpots.forEach((e: { x: number; y: number; z: number; b: unknown }) => {
          if (!city.isLocked(e.b)) city.puff(e.x, e.y, e.z, 0x8f8a86, 0.3, 2.4, 3);
        });
      }
    }
    world.current!.syncFleets();
    world.current!.placeCamera(cam, target.current);
    world.current!.updateShadows(gl, cam, dt);
  });

  return <DistrictLabels city={city} stage={stage} caps={caps} cam={cam} events={events} />;
}

/**
 * Названия районов — обычными элементами страницы поверх карты: текст чёткий на любом экране,
 * а не картинка в 3D, которая размывается при уменьшении. Картинки-названия из макета прячем.
 */
function DistrictLabels({ city, stage, caps, cam, events = [] }: {
  city: Record<string, any>;
  stage: number;
  caps: number[];
  cam: THREE.OrthographicCamera;
  events?: Props['events'];
}) {
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const ndc = useRef(new THREE.Vector3());
  const items = (Object.keys(DISTRICTS) as Exclude<DistrictKey, 'park'>[]).map((key) => {
    const [x, z] = city.districtCenter(key) as [number, number];
    const need = city.STAGE_OF[key] as number;
    const locked = need > stage;
    return {
      key, x, z, locked,
      title: DISTRICTS[key].name,
      sub: locked ? `откроется при ${money(caps[need - 1] ?? 0)}` : `спрос: ${DISTRICTS[key].likes.slice(0, 2).join(', ')}`,
    };
  });
  const park = (city.blocks as { d: string; x: number; z: number }[]).find((b) => b.d === 'park');
  if (park) items.push({ key: 'park' as never, x: park.x, z: park.z, locked: false, title: 'Городской парк', sub: 'кубок лучших за сезон' });
  useFrame(() => {
    // Макет пересоздаёт картинки-названия при открытии района — держим их на невидимом слое.
    (city.labels as THREE.Sprite[]).forEach((l) => l.layers.set(31));
    const display = cam.zoom < 0.8 ? '' : 'none';
    const transform = `scale(${Math.round(Math.max(0.7, Math.min(1, cam.zoom / 0.65)) * 20) / 20})`;
    els.current.forEach((el, n) => {
      if (!el) return;
      if (el.style.display !== display) el.style.display = display;
      if (el.style.transform !== transform) el.style.transform = transform;
      // У края карты название не обрезаем, а плавно прячем.
      const it = items[n];
      const v = ndc.current.set(it.x, 1.5, it.z).project(cam);
      const opacity = Math.abs(v.x) < 0.62 && Math.abs(v.y) < 0.8 ? '1' : '0';
      if (el.style.opacity !== opacity) el.style.opacity = opacity;
    });
  });
  return (
    <>
      {items.map((it, n) => (
        <Html key={it.key} position={[it.x, 1.5, it.z]} center zIndexRange={[3, 1]} style={{ pointerEvents: 'none' }}>
          <div className={`district-label ${it.locked ? 'locked' : ''}`} ref={(el) => (els.current[n] = el)}>
            <b>{it.title}</b>
            <span>{it.locked && <Lock size={10} aria-hidden />}{it.sub}</span>
            {events
              .filter((e) => e.district === it.key)
              .map((e) => (
                <em key={e.text} className={e.bad ? 'bad' : ''}>
                  {e.bad ? '▼' : '▲'} {e.text}
                </em>
              ))}
          </div>
        </Html>
      ))}
    </>
  );
}

/** Счётчик кадров и снижение чёткости на медленном телефоне — как у улицы. */
function FpsWatch({ el, dpr, setDpr, onSlow }: {
  el: React.RefObject<HTMLDivElement>;
  dpr: number;
  setDpr: (d: number) => void;
  onSlow?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ frames: 0, since: performance.now(), last: performance.now(), warm: performance.now() + 3000, slow: 0, fired: false });
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (now - a.last > 1000) {
      a.frames = 0;
      a.since = now;
      a.warm = now + 3000;
      a.slow = 0;
    }
    a.last = now;
    a.frames++;
    if (now - a.since >= 1000) {
      const fps = Math.round((a.frames * 1000) / (now - a.since));
      if (el.current) el.current.textContent = `${fps} FPS · ${gl.info.render.calls} DC${dpr < 1.9 ? ` · ×${dpr}` : ''}`;
      if (now > a.warm) {
        a.slow = fps < 25 ? a.slow + 1 : 0;
        if (dpr > 1 && a.slow >= 3) {
          setDpr(Math.max(1, Math.round((dpr - 0.5) * 2) / 2));
          a.slow = 0;
          a.warm = now + 3000;
        } else if (dpr <= 1 && a.slow >= 5 && !a.fired && onSlow) {
          a.fired = true;
          onSlow();
        }
      }
      a.frames = 0;
      a.since = now;
    }
  });
  return null;
}

export default function City(props: Props & { active?: boolean; showFps?: boolean; onSlow?: () => void }) {
  const { active = true, showFps = false, onSlow, ...scene } = props;
  const fpsEl = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [shown, setShown] = useState(() => document.visibilityState === 'visible');
  const [dpr, setDpr] = useState(() => (props.low ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1))));
  const [hint, setHint] = useState(true);
  // Город пересобирается, только когда меняется набор мест под участки (новый конкурент) или seed —
  // и только пока карта не на экране, чтобы ничего не прыгало на глазах.
  const [built, setBuilt] = useState(() => ({ key: `${props.seed}|${slotKey(props.plots)}`, n: 0 }));
  const wantKey = `${props.seed}|${slotKey(props.plots)}`;
  useEffect(() => {
    if (!active && wantKey !== built.key) setBuilt({ key: wantKey, n: built.n + 1 });
  }, [active, wantKey, built]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setInView(e[0].isIntersecting));
    io.observe(el);
    const onVis = () => setShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    const id = window.setTimeout(() => setHint(false), 5000);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(id);
    };
  }, []);
  const running = active && inView && shown;

  return (
    <div className="city-stage" ref={box} onPointerDown={() => setHint(false)}>
      <Canvas
        key={`${built.n}${props.low ? 'low' : ''}`}
        shadows={!props.low}
        flat
        linear
        legacy
        orthographic
        camera={{ manual: true, near: 1, far: 600, position: [56, 88, 136] }}
        dpr={dpr}
        frameloop={running ? 'always' : 'never'}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          THREE.ColorManagement.enabled = false;
          gl.outputColorSpace = THREE.LinearSRGBColorSpace;
          gl.domElement.setAttribute('aria-label', '3D-карта твоего города');
        }}
      >
        <CityScene {...scene} />
        <FpsWatch el={fpsEl} dpr={dpr} setDpr={setDpr} onSlow={onSlow} />
      </Canvas>
      {showFps && <div className="street-fps" ref={fpsEl} />}
      {hint && <div className="street-hint">Веди пальцем по карте · щипок — приблизить · тап — что здесь</div>}
    </div>
  );
}

export { DISTRICTS };
