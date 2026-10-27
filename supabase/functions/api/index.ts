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

type Body = Record<string, unknown>;

// Ошибки игровых правил приходят из базы с кодом P0001 — их текст показываем игроку.
async function rpc<T>(fn: string, args: Body): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    if (error.code === 'P0001') throw new ApiError(400, error.message);
    throw error;
  }
  return data as T;
}

function str(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== 'string') throw new ApiError(400, `Нет параметра ${key}`);
  return v;
}

function int(body: Body, key: string): number {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new ApiError(400, `Нет параметра ${key}`);
  return v;
}

async function playerId(user: TelegramUser): Promise<string> {
  const { data, error } = await db.from('players').select('id').eq('telegram_id', user.id).single();
  if (error || !data) throw new ApiError(401, 'Игрок не найден, перезапусти игру');
  return data.id;
}

const state = (id: string) => rpc<Body>('get_state', { p_player_id: id });

async function login(user: TelegramUser) {
  const player = await rpc<Body>('login_player', {
    p_telegram_id: user.id,
    p_first_name: user.first_name ?? '',
    p_username: user.username ?? null,
    p_language_code: user.language_code ?? null,
  });
  const id = player.id as string;
  const summary = !player.is_new && player.prev_seen_at
    ? await rpc<Body>('away_summary', { p_player_id: id, p_since: player.prev_seen_at })
    : null;
  const seasonResult = await rpc<Body | null>('pop_season_result', { p_player_id: id });
  return { ...(await state(id)), is_new: player.is_new, summary, season_result: seasonResult };
}

// Действие игрока → новое состояние экрана.
function action(run: (id: string, body: Body) => Promise<unknown>) {
  return async (user: TelegramUser, body: Body) => {
    const id = await playerId(user);
    const result = await run(id, body);
    return { ...(await state(id)), result };
  };
}

const actions: Record<string, (user: TelegramUser, body: Body) => Promise<unknown>> = {
  login,
  state: action(async () => null),
  open_business: action((id, b) => rpc('open_business', { p_player_id: id, p_type: str(b, 'type') })),
  restock: action((id, b) =>
    rpc('restock', { p_player_id: id, p_type: str(b, 'type'), p_qty: int(b, 'qty') })),
  transfer_bread: action((id, b) => rpc('transfer_bread', { p_player_id: id, p_qty: int(b, 'qty') })),
  set_price: action((id, b) =>
    rpc('set_price', { p_player_id: id, p_type: str(b, 'type'), p_price: int(b, 'price') })),
  collect: action((id) => rpc('collect_revenue', { p_player_id: id })),
  decide: action((id, b) => rpc('decide', { p_player_id: id, p_option: int(b, 'option') })),
  leaderboard: async (user, b) => {
    const kind = str(b, 'kind');
    if (kind !== 'capital' && kind !== 'growth') throw new ApiError(400, 'Неизвестный рейтинг');
    return { leaderboard: await rpc('leaderboard', { p_player_id: await playerId(user), p_kind: kind }) };
  },
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
    const handler = Object.hasOwn(actions, String(body.action)) ? actions[String(body.action)] : undefined;
    if (!handler) throw new ApiError(400, 'Неизвестное действие');

    return json(await handler(user, body));
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Ошибка сервера' }, 500);
  }
});
