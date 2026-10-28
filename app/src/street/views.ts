// Что показать на 3D-улице по состоянию игры. Без three.js — чтобы не тянуть 3D в основной файл.
import type { GameState } from '../api';

/** Тип бизнеса в игре → тип здания в макете и место на улице. Порядок — как в макете. */
export const SLOT_TYPES = [
  { game: 'marketplace', street: 'market', x: -18 },
  { game: 'pvz', street: 'pvz', x: -12 },
  { game: 'coffee', street: 'coffee', x: -6 },
  { game: 'shop', street: 'shop', x: 0 },
  { game: 'bakery', street: 'bakery', x: 6 },
  { game: 'agency', street: 'ads', x: 12 },
  { game: 'repair', street: 'repair', x: 18 },
] as const;

export type GameType = (typeof SLOT_TYPES)[number]['game'];

/** Уровень здания (0 — участок «Продаётся») и сколько денег собрано на открытие, % (null — не показывать). */
export interface SlotView {
  level: number;
  lotPct: number | null;
}

export type StreetViews = Record<GameType, SlotView>;

export function streetViews(game: GameState): StreetViews {
  const out = {} as StreetViews;
  for (const s of SLOT_TYPES) {
    const b = game.businesses.find((x) => x.type === s.game);
    const item = game.catalog.find((c) => c.type === s.game);
    const pct = item ? Math.min(100, Math.floor((game.player.cash / item.open_cost) * 100)) : 0;
    out[s.game] = { level: b ? Math.max(1, Math.min(5, b.level ?? 1)) : 0, lotPct: pct };
  }
  return out;
}

// ---------- Жизнь улицы ----------

/** Цвет вывески каждого бизнеса (как accent в макете) — для рекламного щита. */
const ACCENT: Record<GameType, string> = {
  coffee: '#D4A73A', shop: '#6CB4EE', bakery: '#F2C46B', marketplace: '#A78BFA', pvz: '#2DD4BF', agency: '#F472B6', repair: '#FB923C',
};

export type Weather = 'clear' | 'rain' | 'snow';

export interface StreetLife {
  district: 0 | 1 | 2;
  weather: Weather;
  /** Что на рекламном щите у дороги. */
  billboard: { lines: [string, string]; color: string };
  /** Сколько прохожих у бизнеса (0–3) — по спросу на его товар. */
  crowd: Record<GameType, number>;
  /** Последняя выручка на тике: когда и сколько (коп.) — для монеток. */
  sales: Record<GameType, { at: string | null; amount: number }>;
}

export function streetLife(game: GameState, now = Date.now()): StreetLife {
  const cfg = game.street;
  const [d1, d2] = cfg?.district ?? [30_000_000, 150_000_000];
  const district = game.capital >= d2 ? 2 : game.capital >= d1 ? 1 : 0;
  const weather = (cfg?.weather?.kind ?? 'clear') as Weather;

  const crowd = {} as StreetLife['crowd'];
  const sales = {} as StreetLife['sales'];
  const demand = (m: 'coffee' | 'bread') => game.markets.find((x) => x.market === m)?.demand_level ?? 1;
  let ad: StreetLife['billboard'] | null = null;
  for (const s of SLOT_TYPES) {
    const b = game.businesses.find((x) => x.type === s.game);
    sales[s.game] = { at: b?.last_sale_at ?? null, amount: b?.last_revenue ?? 0 };
    if (!b) {
      crowd[s.game] = 0;
      continue;
    }
    const level =
      s.game === 'coffee' ? demand('coffee') * 2
      : s.game === 'shop' || s.game === 'bakery' ? demand('bread') * 2
      : s.game === 'marketplace' || s.game === 'pvz' ? (b.last_sold ?? 0) / 4
      : 1;
    crowd[s.game] = Math.max(0, Math.min(3, Math.round(level)));
    const running = (b.ads ?? []).some((u) => new Date(u).getTime() > now);
    if (running && !ad) {
      const name = game.catalog.find((c) => c.type === s.game)?.name ?? '';
      ad = { lines: [name.toUpperCase(), 'реклама · +25% спроса'], color: ACCENT[s.game] };
    }
  }
  return {
    district,
    weather,
    billboard: ad ?? { lines: ['РЕКЛАМА', 'место свободно'], color: '#9EA3AD' },
    crowd,
    sales,
  };
}

/** События улицы из игры: фургон после пополнения склада, монетка (для панели разработчика). */
export const streetBus = new EventTarget();
export function streetVan(type: GameType) {
  streetBus.dispatchEvent(new CustomEvent('van', { detail: type }));
}
export function streetCoin(type: GameType, amount: number) {
  streetBus.dispatchEvent(new CustomEvent('coin', { detail: { type, amount } }));
}

/** День — с 7:00 до 19:00 по часам телефона. */
export function isDaytime(date = new Date()): boolean {
  const h = date.getHours();
  return h >= 7 && h < 19;
}

// ---------- Панель разработчика: что показать на улице вместо данных сервера (только вид, игра не меняется) ----------

export interface StreetDev {
  day?: boolean;
  district?: 0 | 1 | 2;
  weather?: Weather;
  /** Уровни зданий вместо серверных (0 — участок). */
  levels?: Partial<Record<GameType, number>>;
  /** Менять уровень без анимации стройки. */
  instant?: boolean;
}

let dev: StreetDev = {};
const devListeners = new Set<() => void>();
export const streetDev = {
  get: () => dev,
  set(patch: Partial<StreetDev>) {
    dev = { ...dev, ...patch };
    devListeners.forEach((f) => f());
  },
  reset() {
    dev = { instant: dev.instant };
    devListeners.forEach((f) => f());
  },
  subscribe(f: () => void) {
    devListeners.add(f);
    return () => {
      devListeners.delete(f);
    };
  },
};

/** Данные сервера с подменами из панели разработчика. */
export function withDev(views: StreetViews, life: StreetLife, d: StreetDev): { views: StreetViews; life: StreetLife } {
  const v = { ...views };
  for (const [type, level] of Object.entries(d.levels ?? {}) as [GameType, number][]) v[type] = { ...v[type], level };
  return {
    views: v,
    life: { ...life, district: d.district ?? life.district, weather: d.weather ?? life.weather },
  };
}

// ---------- Улица другого игрока (только просмотр) ----------

export interface CompanyStreetData {
  businesses: { type: string; level: number | null }[];
  ad: string | null;
}

/** Что показать на чужой улице: её здания и щит, район по её капиталу, погода и спрос — общие для города. */
export function companyStreet(data: CompanyStreetData, capital: number, game: GameState) {
  const views = {} as StreetViews;
  const crowd = {} as StreetLife['crowd'];
  const sales = {} as StreetLife['sales'];
  const demand = (m: 'coffee' | 'bread') => game.markets.find((x) => x.market === m)?.demand_level ?? 1;
  for (const s of SLOT_TYPES) {
    const b = data.businesses.find((x) => x.type === s.game);
    views[s.game] = { level: b ? Math.max(1, Math.min(5, b.level ?? 1)) : 0, lotPct: null };
    sales[s.game] = { at: null, amount: 0 };
    const level = !b ? 0
      : s.game === 'coffee' ? demand('coffee') * 2
      : s.game === 'shop' || s.game === 'bakery' ? demand('bread') * 2
      : 1;
    crowd[s.game] = Math.max(0, Math.min(3, Math.round(level)));
  }
  const [d1, d2] = game.street?.district ?? [30_000_000, 150_000_000];
  const adType = SLOT_TYPES.find((s) => s.game === data.ad)?.game;
  const name = adType ? game.catalog.find((c) => c.type === adType)?.name ?? '' : '';
  const life: StreetLife = {
    district: capital >= d2 ? 2 : capital >= d1 ? 1 : 0,
    weather: (game.street?.weather?.kind ?? 'clear') as Weather,
    billboard: adType
      ? { lines: [name.toUpperCase(), 'реклама · +25% спроса'], color: ACCENT[adType] }
      : { lines: ['РЕКЛАМА', 'место свободно'], color: '#9EA3AD' },
    crowd,
    sales,
  };
  return { views, life };
}
