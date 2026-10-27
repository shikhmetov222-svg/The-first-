// Единая точка входа для всех действий игрока.
// Клиент присылает { action, ...params } и initData в заголовке X-Telegram-Init-Data.
// Каждый запрос заново проверяет подпись Telegram — клиенту не доверяем ничего.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verifyInitData, type TelegramUser } from '../_shared/telegram.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
// Администраторы — только из секрета сервера (через запятую): ADMIN_TELEGRAM_IDS=123,456.
const ADMIN_IDS = new Set(
  (Deno.env.get('ADMIN_TELEGRAM_IDS') ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number),
);
const isAdmin = (user: TelegramUser) => ADMIN_IDS.has(user.id);
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

function companyArgs(id: string, b: Body) {
  return {
    p_player_id: id,
    p_name: str(b, 'name'),
    p_icon: str(b, 'icon'),
    p_color: str(b, 'color'),
    p_motto: typeof b.motto === 'string' ? b.motto : '',
  };
}

// Имя бота для ссылки-приглашения — спрашиваем у Telegram один раз.
let botUsername: string | null = null;
async function getBotUsername(): Promise<string | null> {
  if (botUsername) return botUsername;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const data = await res.json();
    botUsername = data?.result?.username ?? null;
  } catch (e) {
    console.error('getMe failed', e);
  }
  return botUsername;
}

function bool(body: Body, key: string): boolean | null {
  const v = body[key];
  return typeof v === 'boolean' ? v : null;
}

/** Игрок-администратор: проверка по секрету сервера + обновление флага в базе. */
async function adminId(user: TelegramUser): Promise<string> {
  if (!isAdmin(user)) throw new ApiError(403, 'Нет доступа');
  const id = await playerId(user);
  await rpc('set_admin_flag', { p_player_id: id, p_is_admin: true });
  return id;
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
  // Флаг администратора в базе всегда отражает текущий секрет сервера.
  // Не мешает входу, даже если что-то пошло не так.
  await rpc('set_admin_flag', { p_player_id: id, p_is_admin: isAdmin(user) }).catch((e) => console.error('admin flag', e));
  // Новичок пришёл по ссылке друга: t.me/<бот>?startapp=ref_<код>.
  const ref = user.start_param?.match(/^ref_([a-f0-9]{8})$/)?.[1];
  if (player.is_new && ref) {
    // Приглашение — приятный бонус, вход из-за него ломаться не должен.
    await rpc('apply_referral', { p_player_id: id, p_code: ref }).catch((e) => console.error('referral', e));
  }
  const summary = !player.is_new && player.prev_seen_at
    ? await rpc<Body>('away_summary', { p_player_id: id, p_since: player.prev_seen_at })
    : null;
  const seasonResult = await rpc<Body | null>('pop_season_result', { p_player_id: id });
  return {
    ...(await state(id)),
    is_new: player.is_new,
    summary,
    season_result: seasonResult,
    is_admin: isAdmin(user),
  };
}

// Действие игрока → новое состояние экрана.
function action(run: (id: string, body: Body) => Promise<unknown>) {
  return async (user: TelegramUser, body: Body) => {
    const id = await playerId(user);
    const result = await run(id, body);
    return { ...(await state(id)), result, is_admin: isAdmin(user) };
  };
}

// Действие на рынке → новое состояние экрана и рынка.
function marketAction(run: (id: string, body: Body) => Promise<unknown>) {
  return async (user: TelegramUser, body: Body) => {
    const id = await playerId(user);
    const result = await run(id, body);
    const [st, market] = await Promise.all([state(id), rpc('market_view', { p_player_id: id })]);
    return { ...st, result, market, is_admin: isAdmin(user) };
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
  create_company: action((id, b) => rpc('create_company', companyArgs(id, b))),
  update_company: action((id, b) => rpc('update_company', companyArgs(id, b))),
  tutorial: action((id, b) => rpc('set_tutorial_step', { p_player_id: id, p_step: int(b, 'step') })),
  profile: async (user) => {
    const [profile, bot] = await Promise.all([
      playerId(user).then((id) => rpc('my_profile', { p_player_id: id })),
      getBotUsername(),
    ]);
    return { profile, bot_username: bot };
  },
  settings: action((id, b) =>
    rpc('update_settings', { p_player_id: id, p_notify: bool(b, 'notify'), p_haptics: bool(b, 'haptics') })),
  company: async (user, b) => {
    const id = str(b, 'id');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(400, 'Компания не найдена');
    await playerId(user); // смотреть карточки могут только игроки
    return { company: await rpc('company_card', { p_player_id: id }) };
  },
  // ---------- Рынок между игроками: каждое действие — одна транзакция в базе ----------
  market: async (user) => ({ market: await rpc('market_view', { p_player_id: await playerId(user) }) }),
  create_lot: marketAction((id, b) =>
    rpc('create_lot', {
      p_player: id,
      p_product: str(b, 'product'),
      p_source: str(b, 'source'),
      p_qty: int(b, 'qty'),
      p_price: int(b, 'price'),
    })),
  cancel_lot: marketAction((id, b) => rpc('cancel_lot', { p_player: id, p_lot: int(b, 'lot') })),
  buy_lot: marketAction((id, b) => rpc('buy_lot', { p_buyer: id, p_lot: int(b, 'lot'), p_qty: int(b, 'qty') })),
  sell_wholesale: marketAction((id, b) =>
    rpc('sell_wholesale', {
      p_player: id,
      p_product: str(b, 'product'),
      p_source: str(b, 'source'),
      p_qty: int(b, 'qty'),
    })),
  // ---------- Режим разработчика: каждый вызов перепроверяет администратора по подписи Telegram ----------
  dev_info: async (user) => {
    const id = await adminId(user);
    return { dev: await rpc('dev_info', { p_admin: id }) };
  },
  dev: async (user, b) => {
    const id = await adminId(user);
    const op = str(b, 'op');
    const optInt = (key: string) => (b[key] === null || b[key] === undefined ? null : int(b, key));
    const ops: Record<string, () => Promise<unknown>> = {
      cash_add: () => rpc('dev_cash', { p_admin: id, p_mode: 'add', p_amount: int(b, 'amount') }),
      cash_set: () => rpc('dev_cash', { p_admin: id, p_mode: 'set', p_amount: int(b, 'amount') }),
      stock_fill: () => rpc('dev_stock', { p_admin: id, p_mode: 'fill', p_product: null, p_qty: null }),
      stock_clear: () => rpc('dev_stock', { p_admin: id, p_mode: 'clear', p_product: null, p_qty: null }),
      stock_add: () =>
        rpc('dev_stock', { p_admin: id, p_mode: 'add', p_product: str(b, 'product'), p_qty: int(b, 'qty') }),
      open_business: () => rpc('dev_open_business', { p_admin: id, p_type: str(b, 'type') }),
      ticks: () => rpc('dev_ticks', { p_admin: id, p_n: int(b, 'n') }),
      new_decision: () => rpc('dev_new_decision', { p_admin: id }),
      test_create: () => rpc('dev_test_players', { p_admin: id, p_mode: 'create' }),
      test_delete_all: () => rpc('dev_test_players', { p_admin: id, p_mode: 'delete_all' }),
      bots: () => rpc('dev_bots', { p_admin: id, p_market: str(b, 'market'), p_count: optInt('count') }),
      befriend: () => rpc('dev_befriend', { p_admin: id, p_test: str(b, 'player') }),
      badge: () => rpc('dev_badge', { p_admin: id, p_show: bool(b, 'show') }),
      reset_me: () => rpc('dev_reset_me', { p_admin: id }),
    };
    if (!Object.hasOwn(ops, op)) throw new ApiError(400, 'Неизвестное действие разработчика');
    const result = await ops[op]();
    const [st, dev] = await Promise.all([state(id), rpc('dev_info', { p_admin: id })]);
    return { ...st, result, dev, is_admin: true };
  },
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
