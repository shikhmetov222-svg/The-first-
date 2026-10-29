// Карта города: что показать по состоянию игры. Без three.js — чтобы не тянуть 3D в основной файл.
// Схема города (кварталы, районы, стадии) — как в docs/city-mockup.html; проверяет её сервер (0020_city.sql).
import type { CatalogItem, GameState } from '../api';
import type { GameType } from '../street/views';
import { LOGO_COLORS } from '../company';

export type DistrictKey = 'center' | 'sleep' | 'private' | 'business' | 'industry' | 'newres' | 'park';

/** Кварталы 3 × 4: DMAP[j][i]. */
export const DMAP: DistrictKey[][] = [
  ['industry', 'industry', 'business'],
  ['private', 'center', 'business'],
  ['private', 'park', 'newres'],
  ['sleep', 'sleep', 'newres'],
];

/** С какой стадии города открыт район. */
export const STAGE_OF: Record<DistrictKey, number> = {
  center: 1, sleep: 1, park: 1, private: 2, industry: 2, business: 3, newres: 4,
};

export const DISTRICTS: Record<Exclude<DistrictKey, 'park'>, { name: string; best: GameType; likes: string[]; note: string }> = {
  center: { name: 'Старый город', best: 'coffee', likes: ['кофе', 'выпечка', 'реклама'], note: 'туристы и прогулки' },
  sleep: { name: 'Спальный район', best: 'shop', likes: ['продукты', 'посылки', 'хлеб'], note: 'много жителей, покупают каждый день' },
  private: { name: 'Частный сектор', best: 'bakery', likes: ['хлеб', 'ремонт', 'продукты'], note: 'семьи с машинами, тихо' },
  business: { name: 'Деловой квартал', best: 'agency', likes: ['реклама', 'кофе', 'доставка'], note: 'офисы и большие бюджеты' },
  industry: { name: 'Промзона', best: 'repair', likes: ['склады', 'стройматериалы'], note: 'дешёвая земля, удобно для складов' },
  newres: { name: 'Новый район', best: 'pvz', likes: ['посылки', 'кофе', 'доставка'], note: 'молодые семьи, много онлайн-заказов' },
};

/** Лучший район для бизнеса — как best_district() на сервере. */
export const BEST_DISTRICT: Record<GameType, Exclude<DistrictKey, 'park'>> = {
  coffee: 'center', shop: 'sleep', bakery: 'private', agency: 'business', repair: 'industry', marketplace: 'industry', pvz: 'newres',
};

/** Тип бизнеса в игре → тип здания в макете. */
export const STREET_KEY: Record<GameType, string> = {
  coffee: 'coffee', shop: 'shop', bakery: 'bakery', marketplace: 'market', pvz: 'pvz', agency: 'ads', repair: 'repair',
};

export const districtOf = (i: number, j: number) => DMAP[j][i];

// ---------- Детерминированный «случай» от seed города ----------

function mix(h: number) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
/** Целое из seed и чисел — одинаковое при каждом запуске. */
export function hashInt(seed: number, ...xs: number[]) {
  let h = seed | 0;
  for (const x of xs) h = mix(h ^ Math.imul(x | 0, 0x9e3779b1));
  return h;
}
/** 0…1 из seed и чисел. */
export const hash01 = (seed: number, ...xs: number[]) => hashInt(seed, ...xs) / 4294967296;
const strHash = (s: string) => Array.from(s).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

// ---------- Участки ----------

export interface Owner {
  name: string;
  color: string;
  me?: boolean;
  bot?: boolean;
}

export interface CityPlot {
  i: number;
  j: number;
  k: number;
  /** Тип здания в макете (coffee, market, ads…) и в игре. */
  type?: string;
  game?: GameType;
  level?: number;
  owner?: Owner;
  lot?: boolean;
  /** Свободный участок: сколько стоит открыть здесь лучший для района бизнес (коп.). */
  price?: number;
}

export interface Rival {
  id: string;
  type: string;
  level: number | null;
  i: number;
  j: number;
  k: number;
  owner: string;
  color: string | null;
}

export interface CityData {
  rivals: Rival[];
  bots: { name: string; type: string }[];
}

const isGame = (t: string): t is GameType => t in STREET_KEY;

/** Стадия города (1–4) и открыт ли квартал. */
export function cityStage(game: GameState) {
  return game.city?.stage ?? 1;
}
export const blockOpen = (i: number, j: number, stage: number) => {
  const d = districtOf(i, j);
  return d !== 'park' && STAGE_OF[d] <= stage;
};

/**
 * Что стоит на участках города: свои бизнесы — где их поставил сервер; бизнесы других игроков — на их месте,
 * а если оно занято или район ещё закрыт — на свободном месте того же района; NPC — в лучшем районе своего типа;
 * в каждом открытом квартале — один свободный участок. Всё детерминированно от seed: при каждом входе одинаково.
 */
export function cityPlots(game: GameState, data: CityData | null): CityPlot[] {
  const seed = game.city?.seed ?? 1;
  const stage = cityStage(game);
  const out: CityPlot[] = [];
  const used = new Set<string>();
  const key = (i: number, j: number, k: number) => `${i}:${j}:${k}`;
  const take = (p: CityPlot) => {
    used.add(key(p.i, p.j, p.k));
    out.push(p);
  };
  const me: Owner = { name: game.company?.name ?? game.player.first_name, color: '#D4A73A', me: true };

  // Свободное место в районе: кварталы и места в порядке от seed.
  const freeIn = (d: DistrictKey, salt: number) => {
    const spots: [number, number, number][] = [];
    DMAP.forEach((row, j) => row.forEach((dd, i) => {
      if (dd === d && blockOpen(i, j, stage)) for (let k = 0; k < 4; k++) if (!used.has(key(i, j, k))) spots.push([i, j, k]);
    }));
    spots.sort((a, b) => hash01(seed, salt, ...a) - hash01(seed, salt, ...b));
    return spots[0] ?? null;
  };

  for (const p of game.city?.plots ?? []) {
    const b = game.businesses.find((x) => x.type === p.type);
    if (!b || !isGame(b.type)) continue;
    take({ i: p.i, j: p.j, k: p.k, game: b.type, type: STREET_KEY[b.type], level: Math.max(1, Math.min(5, b.level ?? 1)), owner: me });
  }

  for (const r of data?.rivals ?? []) {
    if (!isGame(r.type)) continue;
    const d = districtOf(r.i, r.j);
    let spot: [number, number, number] | null = blockOpen(r.i, r.j, stage) && !used.has(key(r.i, r.j, r.k)) ? [r.i, r.j, r.k] : null;
    if (!spot && STAGE_OF[d] <= stage) spot = freeIn(d, strHash(r.id));
    if (!spot) continue;
    const owner: Owner = { name: r.owner || 'Игрок', color: LOGO_COLORS[r.color ?? ''] ?? '#F07167' };
    take({ i: spot[0], j: spot[1], k: spot[2], game: r.type, type: STREET_KEY[r.type], level: Math.max(1, Math.min(5, r.level ?? 1)), owner });
  }

  for (const bt of data?.bots ?? []) {
    if (!isGame(bt.type)) continue;
    const spot = freeIn(BEST_DISTRICT[bt.type], strHash(bt.name));
    if (!spot) continue;
    const level = 2 + Math.floor(hash01(seed, strHash(bt.name)) * 2);
    take({ i: spot[0], j: spot[1], k: spot[2], game: bt.type, type: STREET_KEY[bt.type], level, owner: { name: bt.name, color: '#8A8F98', bot: true } });
  }

  // Свободные участки: по одному в каждом открытом квартале.
  DMAP.forEach((row, j) => row.forEach((d, i) => {
    if (!blockOpen(i, j, stage)) return;
    const spots = [0, 1, 2, 3].filter((k) => !used.has(key(i, j, k)));
    if (!spots.length) return;
    const k = spots[Math.floor(hash01(seed, 77, i, j) * spots.length)];
    const best = DISTRICTS[d as Exclude<DistrictKey, 'park'>].best;
    take({ i, j, k, lot: true, level: 0, price: openCost(game.catalog, best) });
  }));
  return out;
}

export function openCost(catalog: CatalogItem[], type: string) {
  return catalog.find((c) => c.type === type)?.open_cost ?? 0;
}

/** Сколько стоит участок для района — для подписи на табличке, в рублях. */
export const rub = (kopecks: number) => Math.round(kopecks / 100);
