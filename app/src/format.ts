const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Копейки → «100 000 ₽». */
export function money(kopecks: number): string {
  return `${rub.format(Math.floor(kopecks / 100))} ₽`;
}

export function count(n: number): string {
  return rub.format(n);
}

/** «3 ч 20 мин», «45 мин», «2 дн 4 ч». */
export function duration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d} дн ${h} ч`;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  return `${m} мин`;
}
