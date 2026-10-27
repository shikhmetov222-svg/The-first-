import type { BusinessType } from './api';

// Тексты для экрана. Только оформление — все числа приходят с сервера.
export const BUSINESS_INFO: Record<BusinessType, { icon: string; about: string }> = {
  coffee: { icon: '☕', about: 'Продаёт кофе прохожим. Быстрый оборот, хорошая наценка.' },
  shop: { icon: '🛒', about: 'Продаёт хлеб. Дешевле всего возить его из своей пекарни.' },
  bakery: { icon: '🥖', about: 'Печёт хлеб из муки и снабжает твой магазин.' },
};
