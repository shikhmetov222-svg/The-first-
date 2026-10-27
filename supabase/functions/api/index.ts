// Единая точка входа для всех действий игрока.
// Клиент присылает { action, ...params } и initData в заголовке X-Telegram-Init-Data.
// Каждый запрос заново проверяет подпись Telegram — клиенту не доверяем ничего.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verifyInitData, type TelegramUser } from '../_shared/telegram.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-telegram-init-data',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function login(user: TelegramUser) {
  const { data, error } = await db.rpc('login_player', {
    p_telegram_id: user.id,
    p_first_name: user.first_name ?? '',
    p_username: user.username ?? null,
    p_language_code: user.language_code ?? null,
  });
  if (error) throw error;
  return { player: data };
}

const actions: Record<string, (user: TelegramUser, body: Record<string, unknown>) => Promise<unknown>> = {
  login,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);

  try {
    if (!BOT_TOKEN) throw new ApiError(500, 'Сервер не настроен: нет токена бота');

    const initData = req.headers.get('x-telegram-init-data') ?? '';
    const user = await verifyInitData(initData, BOT_TOKEN);
    if (!user) throw new ApiError(401, 'Не удалось подтвердить вход через Telegram');

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const handler = actions[String(body.action)];
    if (!handler) throw new ApiError(400, 'Неизвестное действие');

    return json(await handler(user, body));
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Ошибка сервера' }, 500);
  }
});
