// Единая точка входа «Золотого номера».
// Клиент присылает { action, ...params } и initData в заголовке X-Telegram-Init-Data.
// Каждый запрос заново проверяет подпись Telegram. Номер генерирует и оценивает только сервер,
// деньги меняются только в SQL-функциях (одна транзакция, строка игрока заблокирована).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verifyInitData, type TelegramUser } from '../_shared/telegram.ts';
import {
  AVG_BET_WEIGHT, BAILOUT_COOLDOWN_H, BAILOUT_RUB, BASE_COST_RUB, DAILY_BASE_RUB, DAILY_MAX_STREAK, DAILY_STEP_RUB,
  FREE_SPIN_EVERY_H, FREE_SPIN_MAX, HAPPY_HOURS_MSK, HAPPY_SPINS, LUCKY_EVERY, SELL_BACK, SLOTS_MAX, SLOTS_START,
  STAKES, STAKE_LEVEL, XP_BASE, XP_POW, countryById, slotPriceRub,
} from '../_shared/game/config.ts';
import {
  drawLucky, formatLabel, guaranteeRank, spinCostKop, spinLuck, valueByBetKop, xpForSpin, type Rng,
} from '../_shared/game/logic.ts';

const BOT_TOKEN = Deno.env.get('GN_TELEGRAM_BOT_TOKEN') ?? '';
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
  if (typeof v !== 'string' || v.length > 64) throw new ApiError(400, `Нет параметра ${key}`);
  return v;
}

// Криптостойкая случайность: Math.random на сервере можно предсказать.
const cryptoRng: Rng = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
};

const FREE = { p_free_every_h: FREE_SPIN_EVERY_H, p_free_max: FREE_SPIN_MAX };
const HAPPY = { p_happy_hours: HAPPY_HOURS_MSK, p_happy_spins: HAPPY_SPINS };
const UUID = /^[0-9a-f-]{36}$/;

const isRetry = (e: unknown) => e instanceof ApiError && e.message === 'GN_RETRY';

// Снимок → номер с удачей → атомарное применение. Если снимок устарел (параллельный запрос,
// сменился час), SQL отвечает GN_RETRY — повторяем с новым снимком.
async function spin(user: TelegramUser, body: Body) {
  const country = countryById(str(body, 'country'));
  if (!country) throw new ApiError(400, 'Нет такой страны');
  const stake = body.stake;
  if (typeof stake !== 'number' || !(STAKES as readonly number[]).includes(stake)) {
    throw new ApiError(400, 'Нет такой ставки');
  }
  const wantFree = body.free !== false;
  const autosellOk = body.autosell_ok === true;

  for (let attempt = 0; attempt < 3; attempt++) {
    const ctx = await rpc<Body>('gn_spin_context', { p_telegram_id: user.id, ...FREE, ...HAPPY });
    if (!ctx) throw new ApiError(401, 'Игрок не найден, перезапусти игру');
    const spinNo = ctx.spin_no as number;
    const useFree = wantFree && (ctx.free as number) > 0;
    const st = useFree ? 1 : stake;
    const required = Math.max(country.lvl, STAKE_LEVEL[st]);
    if ((ctx.level as number) < required) {
      throw new ApiError(400, country.lvl > (ctx.level as number)
        ? `${country.name} откроется на уровне ${country.lvl}`
        : `Ставка ×${st} откроется на уровне ${STAKE_LEVEL[st]}`);
    }
    const luck = spinLuck(spinNo, ctx.happy_left as number);
    const nominal = spinCostKop(country, st);
    // Удача не даёт выгоды от резкого подъёма ставки: ставка не выше средней за последние ~100 прокруток.
    const bet = luck.luck > 1 ? Math.min(nominal, ctx.avg_bet as number) : nominal;
    const cost = useFree ? 0 : bet;
    const d = drawLucky(cryptoRng, country, luck.luck, guaranteeRank(spinNo));
    try {
      return await rpc<Body>('gn_spin', {
        p_telegram_id: user.id,
        p_spin_no: spinNo,
        p_required_level: required,
        p_use_free: useFree,
        p_lucky: luck.lucky,
        p_happy_used: luck.happyUsed,
        p_luck: luck.luck,
        p_cost: cost,
        p_bet: bet,
        p_xp: xpForSpin(d.ev.mul, st),
        p_autosell_ok: autosellOk,
        p_country: country.id,
        p_operator: d.op.name,
        p_prefix: d.prefix,
        p_sub: d.sub,
        p_label: formatLabel(country, d.prefix, d.sub),
        p_mul: d.ev.mul,
        p_tier: d.ev.tier.id,
        p_tags: d.ev.tags,
        p_stake: st,
        p_value: valueByBetKop(bet, d.ev.mul),
        p_xp_base: XP_BASE,
        p_xp_pow: XP_POW,
        p_avg_weight: AVG_BET_WEIGHT,
        p_lucky_every: LUCKY_EVERY,
        ...FREE,
        ...HAPPY,
      });
    } catch (e) {
      if (!isRetry(e)) throw e;
    }
  }
  throw new ApiError(409, 'Слишком много запросов подряд, попробуй ещё раз');
}

async function buySlot(user: TelegramUser) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const st = await rpc<Body>('gn_login', { p_telegram_id: user.id, p_first_name: user.first_name ?? '', p_username: user.username ?? null });
    const extra = st.extra_slots as number;
    if (SLOTS_START + extra >= SLOTS_MAX) throw new ApiError(400, 'Витрина уже максимальная');
    try {
      return await rpc<Body>('gn_buy_slot', {
        p_telegram_id: user.id, p_expected_extra: extra, p_price: slotPriceRub(extra) * 100, p_max_extra: SLOTS_MAX - SLOTS_START,
      });
    } catch (e) {
      if (!isRetry(e)) throw e;
    }
  }
  throw new ApiError(409, 'Попробуй ещё раз');
}

async function handle(user: TelegramUser, body: Body): Promise<unknown> {
  const tg = { p_telegram_id: user.id };
  switch (body.action) {
    case 'login':
      return rpc('gn_login', { ...tg, p_first_name: user.first_name ?? '', p_username: user.username ?? null });
    case 'spin':
      return spin(user, body);
    case 'sell':
      return rpc('gn_sell_pending', tg);
    case 'keep': {
      const replace = body.replace_id;
      if (replace !== undefined && (typeof replace !== 'string' || !UUID.test(replace))) throw new ApiError(400, 'Нет такого номера');
      return rpc('gn_keep', { ...tg, p_slots_start: SLOTS_START, p_sell_back: SELL_BACK, p_replace_id: replace ?? null });
    }
    case 'sell_number': {
      const id = str(body, 'id');
      if (!UUID.test(id)) throw new ApiError(400, 'Нет такого номера');
      return rpc('gn_sell_number', { ...tg, p_sim_id: id, p_sell_back: SELL_BACK });
    }
    case 'buy_slot':
      return buySlot(user);
    case 'daily':
      return rpc('gn_daily', { ...tg, p_base: DAILY_BASE_RUB * 100, p_step: DAILY_STEP_RUB * 100, p_max_streak: DAILY_MAX_STREAK });
    case 'collect':
      return rpc('gn_collect', tg);
    case 'bailout':
      return rpc('gn_bailout', {
        ...tg,
        p_min_cost: BASE_COST_RUB * 100,
        p_amount: BAILOUT_RUB * 100,
        p_cooldown_h: BAILOUT_COOLDOWN_H,
        ...FREE,
      });
    case 'collection':
      return rpc('gn_collection', tg);
    case 'leaderboard':
      return rpc('gn_leaderboard', tg);
    default:
      throw new ApiError(400, 'Неизвестное действие');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Только POST' }, 405);
  try {
    if (!BOT_TOKEN) throw new Error('GN_TELEGRAM_BOT_TOKEN не задан в секретах функции');
    const user = await verifyInitData(req.headers.get('x-telegram-init-data') ?? '', BOT_TOKEN);
    if (!user) throw new ApiError(401, 'Открой игру через Telegram');
    const body = (await req.json().catch(() => ({}))) as Body;
    return json(await handle(user, body));
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Ошибка сервера, попробуй ещё раз' }, 500);
  }
});
