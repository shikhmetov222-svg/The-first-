// Все запросы к серверу идут через одну функцию `api`.
// Клиент отправляет только действие; все числа считает и возвращает сервер.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { tg } from './telegram';

export interface Player {
  id: string;
  telegram_id: number;
  first_name: string;
  username: string | null;
  cash: number; // в копейках
  created_at: string;
  last_seen_at: string;
  is_new: boolean;
}

export class ApiError extends Error {}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'X-Telegram-Init-Data': tg?.initData ?? '',
      },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверь интернет.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Ошибка сервера (${res.status})`);
  return data as T;
}

export const api = {
  login: () => call<{ player: Player }>('login'),
};
