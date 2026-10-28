// 3D-улица игрока на экране «Империя»: сцена, окружение и здания бизнесов — как в docs/street-mockup.js.
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { HOME, createWorld, frameCamera, isDaytime, type World } from './world';
import { createSlots, type Slots } from './slots';
import type { GameType, StreetViews } from './views';
import { feel } from '../telegram';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const noop = () => {};


interface WorldProps {
  views: StreetViews;
  onWorld: (w: World) => void;
  onSelect: (type: GameType, owned: boolean) => void;
}

const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Сцена: собирает мир один раз, ставит здания, камеру и управление жестами. */
function StreetWorld({ views, onWorld, onSelect }: WorldProps) {
  const { scene, gl, size, camera } = useThree();
  const target = useRef(HOME.clone());
  const world = useRef<World | null>(null);
  const slots = useRef<Slots | null>(null);
  const first = useRef(true);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const clock = useRef(0);

  if (!world.current) {
    world.current = createWorld(scene);
    slots.current = createSlots(world.current, scene, reduceMotion);
  }

  // Уровни зданий — с сервера. При первом показе без анимации, дальше улучшение — со стройкой и вибрацией.
  const viewsKey = JSON.stringify(views);
  useEffect(() => {
    const animate = !first.current;
    first.current = false;
    slots.current!.apply(views, animate, () => feel('purchase'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewsKey]);

  useEffect(() => {
    onWorld(world.current!);
    // День и ночь — по часам игрока; проверяем раз в минуту.
    const id = window.setInterval(() => {
      const w = world.current!;
      const day = isDaytime();
      if (w.state.day !== day) {
        w.state.day = day;
        w.applyEnv();
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, [onWorld]);

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
    world.current!.placeCamera(camera, target.current);
  });

  return null;
}

/** Счётчик кадров в секунду (виден администратору). */
function FpsMeter({ el }: { el: React.RefObject<HTMLDivElement> }) {
  const acc = useRef({ frames: 0, since: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.since >= 1000) {
      if (el.current) el.current.textContent = `${Math.round((a.frames * 1000) / (now - a.since))} FPS`;
      a.frames = 0;
      a.since = now;
    }
  });
  return null;
}

export default function Street({
  views, onSelect, onWorld, showFps = false,
}: {
  views: StreetViews;
  onSelect: (type: GameType, owned: boolean) => void;
  onWorld?: (w: World) => void;
  showFps?: boolean;
}) {
  const [hint, setHint] = useState(true);
  const fpsEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => setHint(false), 5000);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="street-stage" onPointerDown={() => setHint(false)}>
      <Canvas
        shadows
        flat
        linear
        legacy
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          // Как в r128: без перевода цветов из sRGB (иначе всё темнее макета).
          THREE.ColorManagement.enabled = false;
          gl.outputColorSpace = THREE.LinearSRGBColorSpace;
          gl.domElement.setAttribute('aria-label', '3D-улица с твоими бизнесами');
        }}
      >
        <OrthographicCamera makeDefault manual near={0.1} far={200} />
        <StreetWorld views={views} onSelect={onSelect} onWorld={onWorld ?? noop} />
        {showFps && <FpsMeter el={fpsEl} />}
      </Canvas>
      {showFps && <div className="street-fps" ref={fpsEl} />}
      {hint && <div className="street-hint">Листай пальцем · щипок — приблизить · двойной тап — вернуть вид</div>}
    </div>
  );
}
