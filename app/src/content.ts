import {
  Hammer,
  Megaphone,
  PackageCheck,
  ShoppingBag,
  Wheat,
  Building2, CalendarCheck, Coffee, Croissant, Gem, Medal, Package, Scale, ShieldAlert, Store, Trophy,
  UserPlus, type LucideIcon,
} from 'lucide-react';
import type { BusinessType, Product, Source } from './api';

// Тексты и иконки для экрана. Только оформление — все числа приходят с сервера.
export const BUSINESS_INFO: Record<BusinessType, { icon: LucideIcon; about: string }> = {
  coffee: { icon: Coffee, about: 'Продаёт кофе прохожим. Быстрый оборот, хорошая наценка.' },
  shop: { icon: Store, about: 'Продаёт хлеб. Дешевле всего возить его из своей пекарни.' },
  bakery: { icon: Croissant, about: 'Печёт хлеб из муки и снабжает твой магазин.' },
  marketplace: { icon: ShoppingBag, about: 'Продаёт твои товары на всю страну.' },
  pvz: { icon: PackageCheck, about: 'Выдаёт посылки и получает плату за каждую.' },
  agency: { icon: Megaphone, about: 'Делает рекламные кампании для бизнесов.' },
  repair: { icon: Hammer, about: 'Ремонтирует и улучшает бизнесы.' },
};

export const CATEGORIES: { id: 'classic' | 'online' | 'services'; title: string }[] = [
  { id: 'classic', title: 'Классика' },
  { id: 'online', title: 'Онлайн' },
  { id: 'services', title: 'Услуги' },
];

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

export const TIPS = [
  'Пустой склад — ноль продаж. Пополняй запасы до того, как уйдёшь из игры.',
  'Свой хлеб из пекарни в магазине обходится втрое дешевле закупки у оптовика.',
  'Утром кофе берут больше всего, а вечером — хлеб. Ночью город спит.',
  'Цена чуть ниже рынка забирает покупателей у конкурентов, но съедает прибыль с каждой продажи.',
  'Демпингер всегда дешевле рынка. Не гонись за ним — бери качеством и запасами.',
  'Выручка копится в кассах, пока тебя нет. Не забывай забирать её в капитал.',
  'Решение дня обновляется каждые сутки. Иногда рискнуть выгоднее, чем перестраховаться.',
  'Чем больше живых игроков в городе, тем меньше ботов и жёстче конкуренция.',
  'Капитал в рейтинге — это деньги, выручка в кассах, товар на складах и стоимость бизнесов.',
  'Сезон длится 7 дней. В конце все начинают заново с одинаковыми 100 000 ₽.',
];

export const ACHIEVEMENTS: { code: string; title: string; hint: string; icon: LucideIcon }[] = [
  { code: 'first_business', title: 'Первый бизнес', hint: 'Открой любой бизнес.', icon: Store },
  { code: 'all_businesses', title: 'Полный набор', hint: 'Открой кофейню, магазин и пекарню.', icon: Building2 },
  { code: 'capital_500k', title: 'Полмиллиона', hint: 'Доведи капитал до 500 000 ₽.', icon: Gem },
  { code: 'top10', title: 'Десятка лучших', hint: 'Закончи сезон в топ-10 по капиталу.', icon: Medal },
  { code: 'top3', title: 'Пьедестал', hint: 'Закончи сезон в топ-3 по капиталу.', icon: Trophy },
  { code: 'streak7', title: 'Неделя в деле', hint: 'Заходи в игру 7 дней подряд.', icon: CalendarCheck },
  { code: 'decisions10', title: 'Решала', hint: 'Прими 10 решений дня.', icon: Scale },
  { code: 'sold1000', title: 'Тысяча продаж', hint: 'Продай 1000 единиц товара за неделю.', icon: Package },
  { code: 'invite', title: 'Друг в деле', hint: 'Пригласи друга по своей ссылке.', icon: UserPlus },
  { code: 'crisis', title: 'Антикризисный', hint: 'Доиграй сезон «Кризис», сохранив больше половины стартового капитала.', icon: ShieldAlert },
];

export const PRODUCTS: Record<Product, { name: string; icon: LucideIcon; color: string }> = {
  coffee: { name: 'Кофе', icon: Coffee, color: 'coffee' },
  bread: { name: 'Хлеб', icon: Croissant, color: 'bakery' },
  flour: { name: 'Мука', icon: Wheat, color: 'shop' },
  campaign: { name: 'Реклама', icon: Megaphone, color: 'agency' },
};

/** Каким бизнесам можно запустить рекламу (у них есть покупатели). */
export const ADVERTISABLE: BusinessType[] = ['coffee', 'shop', 'marketplace', 'pvz'];

/** Откуда можно выставить товар: товар + склад бизнеса. */
export const SELL_SOURCES: { product: Product; source: Source; label: string }[] = [
  { product: 'coffee', source: 'coffee', label: 'Кофе · кофейня' },
  { product: 'bread', source: 'shop', label: 'Хлеб · магазин' },
  { product: 'bread', source: 'bakery', label: 'Хлеб · пекарня' },
  { product: 'flour', source: 'bakery', label: 'Мука · пекарня' },
  { product: 'campaign', source: 'agency', label: 'Кампании · агентство' },
];
