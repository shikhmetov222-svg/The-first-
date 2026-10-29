// 3D-улица игрока на экране «Империя»: сцена, окружение и здания бизнесов — как в docs/street-mockup.js.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { HOME, createWorld, frameCamera, isDaytime, type World } from './world';
import { createSlots, type Slots } from './slots';
import { streetBus, streetDev, withDev, type GameType, type StreetLife, type StreetViews } from './views';
import { createLifeController, type LifeController } from './life';
import { feel } from '../telegram';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const noop = () => {};


interface WorldProps {
  views: StreetViews;
  life: StreetLife;
  onWorld: (w: World) => void;
  onSelect: (type: GameType, owned: boolean) => void;
  /** Чужая улица: без фургона, монеток и подмен разработчика. */
  readOnly: boolean;
  /** День/ночь из панели разработчика (undefined — по часам). */
  day?: boolean;
  instant: boolean;
}

const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Сцена: собирает мир один раз, ставит здания, камеру и управление жестами. */
function StreetWorld({ views, life, onWorld, onSelect, readOnly, day, instant }: WorldProps) {
  const { scene, gl, size, camera } = useThree();
  const target = useRef(HOME.clone());
  const world = useRef<World | null>(null);
  const slots = useRef<Slots | null>(null);
  const lifeCtl = useRef<LifeController | null>(null);
  const first = useRef(true);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const clock = useRef(0);

  if (!world.current) {
    world.current = createWorld(scene);
    slots.current = createSlots(world.current, scene, reduceMotion);
    lifeCtl.current = createLifeController(world.current, slots.current, scene, gl.getPixelRatio(), reduceMotion);
  }

  // Район, погода, щит, прохожие и монетки — по данным игры.
  const lifeKey = JSON.stringify(life);
  useEffect(() => {
    lifeCtl.current!.setData(life);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifeKey]);

  // Фургон после пополнения склада и монетки из панели разработчика.
  useEffect(() => {
    if (readOnly) return;
    const onVan = (e: Event) => lifeCtl.current!.van((e as CustomEvent<GameType>).detail);
    const onCoin = (e: Event) => {
      const d = (e as CustomEvent<{ type: GameType; amount: number }>).detail;
      lifeCtl.current!.coin(d.type, d.amount);
    };
    streetBus.addEventListener('van', onVan);
    streetBus.addEventListener('coin', onCoin);
    return () => {
      streetBus.removeEventListener('van', onVan);
      streetBus.removeEventListener('coin', onCoin);
    };
  }, [readOnly]);

  // Уровни зданий — с сервера. При первом показе без анимации, дальше улучшение — со стройкой и вибрацией.
  const viewsKey = JSON.stringify(views);
  useEffect(() => {
    const animate = !first.current && !instant;
    first.current = false;
    slots.current!.apply(views, animate, () => feel('purchase'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewsKey]);

  useEffect(() => {
    onWorld(world.current!);
  }, [onWorld]);

  // День и ночь — по часам игрока (проверяем раз в минуту) или как задал разработчик.
  useEffect(() => {
    const check = () => {
      const w = world.current!;
      const d = day ?? isDaytime();
      if (w.state.day !== d) {
        w.state.day = d;
        w.applyEnv();
      }
    };
    check();
    const id = window.setInterval(check, 60_000);
    return () => window.clearInterval(id);
  }, [day]);

  useEffect(() => {
    frameCamera(camera as THREE.OrthographicCamera, size.width, size.height);
  }, [camera, size.width, size.height]);

  // Жесты как в макете: листание пальцем, щипок — зум, колесо мыши, двойной тап — вернуть вид.
  useEffect(() => {
    const canvas = gl.domElement;
    const cam = camera as THREE.OrthographicCamera;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { moved: number } | null = null;
    let pinch: { dist: number; zoom: number } | null = null;
    let lastTap = 0;
    const zoomTo = (z: number) => {
      cam.zoom = clamp(z, 0.7, 2.4);
      cam.updateProjectionMatrix();
    };
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
        target.current.x = clamp(target.current.x - dx * wpp, -18, 18);
      } else if (pointers.size === 2 && pinch) {
        const [a, b] = Array.from(pointers.values());
        zoomTo((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist);
      }
    };
    const onEnd = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasSingle && down && down.moved < 8 && e.type === 'pointerup') {
        const now = performance.now();
        if (now - lastTap < 320) {
          target.current.copy(HOME);
          zoomTo(1);
          lastTap = 0;
        } else {
          lastTap = now;
          // Тап по зданию → его карточка (или открытие, если это участок).
          const r = canvas.getBoundingClientRect();
          const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          const hit = slots.current!.pick(ndc, cam);
          if (hit) selectRef.current(hit.game, hit.level > 0);
        }
      }
      if (pointers.size === 0) down = null;
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
  }, [gl, camera]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    clock.current += dt;
    slots.current!.update(clock.current, dt);
    lifeCtl.current!.update(clock.current, dt);
    world.current!.placeCamera(camera, target.current);
  });

  return null;
}

/**
 * Счётчик кадров: показывает FPS администратору и следит, тянет ли телефон 3D.
 * FPS ниже 25 три секунды подряд — сначала снижаем чёткость (2 → 1,5 → 1): это вдвое легче для видеокарты.
 * Если и на чёткости 1 FPS ниже 25 дольше 5 секунд — onSlow (игра переключится на простую графику).
 * Первые 3 секунды после запуска, после паузы и после смены чёткости не считаем.
 */
function FpsWatch({ el, dpr, setDpr, onSlow }: {
  el: React.RefObject<HTMLDivElement>;
  dpr: number;
  setDpr: (d: number) => void;
  onSlow?: () => void;
}) {
  const acc = useRef({ frames: 0, since: performance.now(), last: performance.now(), warm: performance.now() + 3000, slow: 0, fired: false });
  const slowRef = useRef(onSlow);
  slowRef.current = onSlow;
  useFrame(() => {
    const a = acc.current;
    const now = performance.now();
    if (now - a.last > 1000) {
      // Рендер стоял на паузе (улица не видна) — начинаем отсчёт заново.
      a.frames = 0;
      a.since = now;
      a.warm = now + 3000;
      a.slow = 0;
    }
    a.last = now;
    a.frames++;
    if (now - a.since >= 1000) {
      const fps = Math.round((a.frames * 1000) / (now - a.since));
      if (el.current) el.current.textContent = `${fps} FPS${dpr < 1.9 ? ` · ×${dpr}` : ''}`;
      if (now > a.warm) {
        a.slow = fps < 25 ? a.slow + 1 : 0;
        if (dpr > 1 && a.slow >= 3) {
          setDpr(Math.max(1, Math.round((dpr - 0.5) * 2) / 2));
          a.slow = 0;
          a.warm = now + 3000;
        } else if (dpr <= 1 && a.slow >= 5 && !a.fired && slowRef.current) {
          a.fired = true;
          slowRef.current();
        }
      }
      a.frames = 0;
      a.since = now;
    }
  });
  return null;
}

export default function Street({
  views, life, onSelect, onWorld, showFps = false, active = true, readOnly = false, onSlow, low = false,
}: {
  views: StreetViews;
  life: StreetLife;
  onSelect: (type: GameType, owned: boolean) => void;
  onWorld?: (w: World) => void;
  showFps?: boolean;
  /** Видна ли улица (вкладка «Империя» открыта). Скрытая улица не рисуется, но и не пересобирается. */
  active?: boolean;
  readOnly?: boolean;
  onSlow?: () => void;
  /** «Графика: низкая»: без теней и с обычной чёткостью. */
  low?: boolean;
}) {
  const [hint, setHint] = useState(true);
  const fpsEl = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [shown, setShown] = useState(() => document.visibilityState === 'visible');
  const dev = useSyncExternalStore(streetDev.subscribe, streetDev.get);
  // Чёткость: как у экрана, но не больше 2; на медленном телефоне FpsWatch снижает её до 1.
  const [dpr, setDpr] = useState(() => (low ? 1 : Math.min(2, Math.max(1, window.devicePixelRatio || 1))));
  const data = readOnly ? { views, life } : withDev(views, life, dev);

  useEffect(() => {
    const id = window.setTimeout(() => setHint(false), 5000);
    return () => window.clearTimeout(id);
  }, []);

  // Рендер останавливается, когда улица прокручена за экран или приложение свёрнуто.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => setInView(e[0].isIntersecting));
    io.observe(el);
    const onVis = () => setShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  const running = active && inView && shown;

  return (
    <div className="street-stage" ref={box} onPointerDown={() => setHint(false)}>
      <Canvas
        key={low ? 'low' : 'full'}
        shadows={!low}
        flat
        linear
        legacy
        dpr={dpr}
        frameloop={running ? 'always' : 'never'}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          // Как в r128: без перевода цветов из sRGB (иначе всё темнее макета).
          THREE.ColorManagement.enabled = false;
          gl.outputColorSpace = THREE.LinearSRGBColorSpace;
          gl.domElement.setAttribute('aria-label', readOnly ? '3D-улица компании' : '3D-улица с твоими бизнесами');
        }}
      >
        <OrthographicCamera makeDefault manual near={0.1} far={200} />
        <StreetWorld
          views={data.views}
          life={data.life}
          onSelect={onSelect}
          onWorld={onWorld ?? noop}
          readOnly={readOnly}
          day={readOnly ? undefined : dev.day}
          instant={!readOnly && !!dev.instant}
        />
        <FpsWatch el={fpsEl} dpr={dpr} setDpr={setDpr} onSlow={onSlow} />
      </Canvas>
      {showFps && <div className="street-fps" ref={fpsEl} />}
      {hint && <div className="street-hint">Листай пальцем · щипок — приблизить · двойной тап — вернуть вид</div>}
    </div>
  );
}
