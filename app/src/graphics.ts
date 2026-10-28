// Режим графики улицы на этом телефоне: 3D или простая (картинки зданий). Хранится только на устройстве.
import { useSyncExternalStore } from 'react';

/** auto — 3D, но если телефон не тянет, игра сама переключит на простую; 3d — всегда 3D; 2d — простая. */
export type GraphicsMode = 'auto' | '3d' | '2d';

const KEY = 'capital.graphics';
const listeners = new Set<() => void>();

function read(): GraphicsMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === '3d' || v === '2d' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

let mode: GraphicsMode = read();

export function setGraphics(m: GraphicsMode) {
  mode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // приватный режим — настройка проживёт до закрытия игры
  }
  listeners.forEach((f) => f());
}

export function useGraphics(): GraphicsMode {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => mode,
  );
}

let webgl: boolean | null = null;
/** Есть ли на устройстве WebGL — без него 3D-улица не запустится. */
export function hasWebGL(): boolean {
  if (webgl === null) {
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/** Показывать простую улицу: выбрана в настройках или 3D недоступно. */
export function useSimpleStreet(): boolean {
  const m = useGraphics();
  return m === '2d' || !hasWebGL();
}
