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

/** Уровень здания (0 — участок «Продаётся») и сколько денег собрано на открытие, %. */
export interface SlotView {
  level: number;
  lotPct: number;
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
