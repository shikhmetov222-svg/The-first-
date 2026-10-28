// 3D-улица игрока на экране «Империя». Этап 1: сцена, камера, управление и окружение — как в макете.
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { HOME, createWorld, frameCamera, isDaytime, type World } from './world';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const noop = () => {};

/** Сцена: собирает мир один раз, ставит камеру и управление жестами. */
function StreetWorld({ onWorld }: { onWorld: (w: World) => void }) {
  const { scene, gl, size, camera } = useThree();
  const target = useRef(HOME.clone());
  const world = useRef<World | null>(null);

  if (!world.current) {
    world.current = createWorld(scene);
  }

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

  useFrame(() => {
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

export default function Street({ onWorld, showFps = false }: { onWorld?: (w: World) => void; showFps?: boolean }) {
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
        <StreetWorld onWorld={onWorld ?? noop} />
        {showFps && <FpsMeter el={fpsEl} />}
      </Canvas>
      {showFps && <div className="street-fps" ref={fpsEl} />}
      {hint && <div className="street-hint">Листай пальцем · щипок — приблизить · двойной тап — вернуть вид</div>}
    </div>
  );
}
