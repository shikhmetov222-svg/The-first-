import { useEffect, useRef, useState } from 'react';

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Плавно «докручивает» число до нового значения.
 * Возвращает текущее отображаемое число и направление последнего изменения.
 */
export function useCountUp(value: number, durationMs = 900): [number, 'up' | 'down' | null] {
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const from = useRef(value);
  const frame = useRef(0);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setDir(value > start ? 'up' : 'down');
    const clearDir = window.setTimeout(() => setDir(null), durationMs + 500);

    if (reduceMotion()) {
      from.current = value;
      setShown(value);
      return () => window.clearTimeout(clearDir);
    }

    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const current = Math.round(start + (value - start) * eased);
      from.current = current;
      setShown(current);
      if (p < 1) frame.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(clearDir);
    };
  }, [value, durationMs]);

  return [shown, dir];
}
