const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Копейки → «100 000 ₽». */
export function money(kopecks: number): string {
  return `${rub.format(Math.floor(kopecks / 100))}\u00A0₽`;
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

/** Короткая длительность для чипа: «6д 22ч», «5ч 12м», «12м». */
export function shortDuration(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

/** Знак и стрелка изменения: «▲ +12 300 ₽», «▼ −4 100 ₽». Цвет — не единственный признак. */
export function signedMoney(kopecks: number): string {
  if (kopecks > 0) return `▲ +${money(kopecks)}`;
  if (kopecks < 0) return `▼ −${money(-kopecks)}`;
  return money(0);
}
