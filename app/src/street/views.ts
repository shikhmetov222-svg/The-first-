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
