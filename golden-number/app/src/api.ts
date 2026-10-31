// Запросы к Edge Function. Подпись Telegram (initData) уходит в каждом запросе.
import { initData } from './tg.ts';
import type { Api } from './types.ts';

export class ApiError extends Error {}

const URL_ = import.meta.env.VITE_API_URL as string | undefined;

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!URL_) throw new ApiError('Не задан адрес сервера (VITE_API_URL)');
  let res: Response;
  try {
    res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData() },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new ApiError('Нет связи с сервером');
  }
  const data = await res.json().catch(() => ({ error: 'Ошибка сервера' }));
  if (!res.ok) throw new ApiError(data.error ?? 'Ошибка сервера');
  return data as T;
}

export const serverApi: Api = {
  login: () => call('login'),
  spin: (country, stake, o) => call('spin', { country, stake, free: o.free, autosell_ok: o.autosellOk }),
  sell: () => call('sell'),
  keep: (replaceId) => call('keep', replaceId ? { replace_id: replaceId } : {}),
  buySlot: () => call('buy_slot'),
  daily: () => call('daily'),
  sellNumber: (id) => call('sell_number', { id }),
  collect: () => call('collect'),
  bailout: () => call('bailout'),
  collection: () => call('collection'),
  leaderboard: () => call('leaderboard'),
  friends: () => call('friends'),
  stats: () => call('stats'),
  claim: (id) => call('claim', { id }),
  market: (mine) => call('market', { mine }),
  lotCreate: (id, price) => call('lot_create', { id, price }),
  lotCancel: (id) => call('lot_cancel', { id }),
  lotBuy: (id) => call('lot_buy', { id }),
  setKeepRule: (rule) => call('keep_rule', { rule }),
};
