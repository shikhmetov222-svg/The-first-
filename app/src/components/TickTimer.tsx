import { useEffect, useState } from 'react';

const TICK_MS = 5 * 60 * 1000;

/** Обратный отсчёт до следующего расчёта продаж (тик сервера каждые 5 минут). */
export function TickTimer({ serverTime }: { serverTime: string }) {
  const [offset] = useState(() => new Date(serverTime).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [offset]);

  const left = TICK_MS - (now % TICK_MS);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <p className="tick">
      Продажи считаются каждые 5 минут · следующий расчёт через {m}:{String(s).padStart(2, '0')}
    </p>
  );
}
