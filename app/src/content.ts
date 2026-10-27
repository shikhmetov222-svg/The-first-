import type { BusinessType } from './api';

// Тексты для экрана. Только оформление — все числа приходят с сервера.
export const BUSINESS_INFO: Record<BusinessType, { icon: string; about: string }> = {
  coffee: { icon: '☕', about: 'Продаёт кофе прохожим. Быстрый оборот, хорошая наценка.' },
  shop: { icon: '🛒', about: 'Продаёт хлеб. Дешевле всего возить его из своей пекарни.' },
  bakery: { icon: '🥖', about: 'Печёт хлеб из муки и снабжает твой магазин.' },
};

export const BOT_KIND: Record<'dumper' | 'premium' | 'careful', string> = {
  dumper: 'Демпингер',
  premium: 'Премиум',
  careful: 'Осторожный',
};

export function demandLabel(level: number): string {
  if (level < 0.5) return 'низкий';
  if (level < 1.0) return 'средний';
  if (level < 1.4) return 'высокий';
  return 'пиковый';
}
