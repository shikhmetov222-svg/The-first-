import { useEffect, useState } from 'react';

export const TICK_MS = 5 * 60 * 1000;

/** Сколько миллисекунд до следующего расчёта рынка (тик сервера каждые 5 минут). */
export function useTickCountdown(serverOffset: number): number {
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + serverOffset), 1000);
    return () => window.clearInterval(id);
  }, [serverOffset]);
  return TICK_MS - (now % TICK_MS);
}

export function useNow(serverOffset: number, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + serverOffset), everyMs);
    return () => window.clearInterval(id);
  }, [serverOffset, everyMs]);
  return now;
}
