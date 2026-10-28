import type { Business, CatalogItem, GameState, Product, Source } from './api';

/** Склад бизнеса с учётом уровня (старый сервер уровней не знает — тогда как в справочнике). */
export function capOf(item: CatalogItem, b: Business | undefined): number {
  return b?.capacity ?? item.capacity;
}

export function rawCapOf(item: CatalogItem, b: Business | undefined): number {
  return b?.raw_capacity ?? item.raw_capacity;
}

// Подсказки для экрана. Окончательно всё проверяет сервер.

/** Сколько товара лежит на складе бизнеса. */
export function available(game: GameState, product: Product, source: Source): number {
  const b = game.businesses.find((x) => x.type === source);
  if (!b) return 0;
  return product === 'flour' ? b.raw_stock : b.stock;
}

/** Куда попадёт купленный товар (как на сервере) и сколько там места. */
export function freeSpace(game: GameState, product: Product): { dest: Source | null; free: number } {
  const owned = (t: Source) => game.businesses.find((b) => b.type === t);
  const dest: Source | null =
    product === 'coffee' ? (owned('coffee') ? 'coffee' : null)
    : product === 'flour' ? (owned('bakery') ? 'bakery' : null)
    : owned('shop') ? 'shop' : owned('bakery') ? 'bakery' : null;
  if (!dest) return { dest: null, free: 0 };
  const b = owned(dest)!;
  const t = game.catalog.find((c) => c.type === dest)!;
  const free = product === 'flour' ? rawCapOf(t, b) - b.raw_stock : capOf(t, b) - b.stock;
  return { dest, free: Math.max(0, free) };
}

/** Коридор цены лота: 50–150% оптовой цены, в целых рублях. */
export function priceCorridor(market: number): [number, number] {
  return [Math.ceil((market * 0.5) / 100) * 100, Math.floor((market * 1.5) / 100) * 100];
}

export const FEE = 0.05;

/** «на 12% дешевле рынка» / «на 5% дороже рынка». */
export function vsMarket(price: number, market: number): { pct: number; cheaper: boolean } {
  const pct = Math.round((price / market - 1) * 100);
  return { pct: Math.abs(pct), cheaper: pct < 0 };
}

/** Свободное место на складе маркетплейса. */
export function marketplaceSpace(game: GameState): { dest: 'marketplace' | null; free: number } {
  const mp = game.businesses.find((b) => b.type === 'marketplace');
  if (!mp) return { dest: null, free: 0 };
  const item = game.catalog.find((c) => c.type === 'marketplace');
  const cap = item ? capOf(item, mp) : 0;
  const g = mp.goods ?? {};
  return { dest: 'marketplace', free: Math.max(0, cap - ((g.coffee ?? 0) + (g.bread ?? 0) + (g.flour ?? 0))) };
}
