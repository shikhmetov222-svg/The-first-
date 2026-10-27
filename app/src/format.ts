const rub = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** Копейки → «100 000 ₽». */
export function money(kopecks: number): string {
  return `${rub.format(Math.floor(kopecks / 100))} ₽`;
}
