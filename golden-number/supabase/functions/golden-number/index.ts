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
  ACHIEVEMENTS, MARKET_FEE, MARKET_MAX_BUYS_PER_SELLER, MARKET_MAX_LOTS, MARKET_MAX_PRICE, MARKET_MIN_PRICE,
  REF_AFTER_SPINS, REF_NEW_SPINS, REF_REWARD_RUB, REF_REWARD_SPINS,
} from '../_shared/game/config.ts';
import {
  achDone, drawLucky, formatLabel, guaranteeRank, parseKeepRule, spinCostKop, spinLuck, valueByBetKop, xpForSpin, type Rng, type Stats,
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
const REF = { p_ref_after: REF_AFTER_SPINS, p_ref_reward: REF_REWARD_RUB * 100, p_ref_spins: REF_REWARD_SPINS };
const UUID = /^[0-9a-f-]{36}$/;

function uuid(body: Body, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw new ApiError(400, 'Не найдено');
  return v;
}

// Пригласивший — из ссылки t.me/<бот>?startapp=r<telegram id>. Учитывается только при первом входе.
function login(user: TelegramUser) {
  const m = /^r(\d{1,15})$/.exec(user.start_param ?? '');
  return rpc<Body>('gn_login', {
    p_telegram_id: user.id, p_first_name: user.first_name ?? '', p_username: user.username ?? null,
    p_ref_telegram_id: m ? Number(m[1]) : null, p_ref_bonus: REF_NEW_SPINS,
  });
}

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
    // Сначала обычные бесплатные (копятся по времени), потом подарочные.
    const useFree = wantFree && (ctx.free as number) > 0;
    const useBonus = wantFree && !useFree && (ctx.bonus as number) > 0;
    const st = useFree || useBonus ? 1 : stake;
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
    const cost = useFree || useBonus ? 0 : bet;
    const d = drawLucky(cryptoRng, country, luck.luck, guaranteeRank(spinNo));
    try {
      return await rpc<Body>('gn_spin', {
        p_telegram_id: user.id,
        p_spin_no: spinNo,
        p_required_level: required,
        p_use_free: useFree,
        p_use_bonus: useBonus,
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
        ...REF,
        p_slots_start: SLOTS_START,
      });
    } catch (e) {
      if (!isRetry(e)) throw e;
    }
  }
  throw new ApiError(409, 'Слишком много запросов подряд, попробуй ещё раз');
}

async function buySlot(user: TelegramUser) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const st = await login(user);
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

// Награда за достижение: выполнение проверяем по статистике сервера, повтор не даст SQL.
async function claim(user: TelegramUser, body: Body) {
  const a = ACHIEVEMENTS.find((x) => x.id === body.id);
  if (!a) throw new ApiError(400, 'Нет такого достижения');
  const stats = await rpc<Stats>('gn_stats', { p_telegram_id: user.id });
  if (!achDone(a, stats)) throw new ApiError(400, 'Достижение ещё не выполнено');
  return rpc('gn_claim', { p_telegram_id: user.id, p_key: a.id, p_reward: a.rewardRub * 100, p_spins: a.rewardSpins ?? 0 });
}

async function handle(user: TelegramUser, body: Body): Promise<unknown> {
  const tg = { p_telegram_id: user.id };
  switch (body.action) {
    case 'login':
      return login(user);
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
    case 'keep_rule': {
      const rule = parseKeepRule(body.rule);
      if (!rule) throw new ApiError(400, 'Непонятное правило');
      return rpc('gn_set_keep_rule', { ...tg, p_rule: rule });
    }
    case 'friends':
      return rpc('gn_friends', tg);
    case 'stats':
      return rpc('gn_stats', tg);
    case 'claim':
      return claim(user, body);
    case 'market':
      return rpc('gn_market', { ...tg, p_mine: body.mine === true });
    case 'lot_create': {
      const price = body.price;
      if (typeof price !== 'number' || !Number.isSafeInteger(price) || price <= 0) throw new ApiError(400, 'Укажи цену');
      return rpc('gn_lot_create', {
        ...tg, p_sim_id: uuid(body, 'id'), p_price: price,
        p_min_share: MARKET_MIN_PRICE, p_max_share: MARKET_MAX_PRICE, p_max_lots: MARKET_MAX_LOTS,
      });
    }
    case 'lot_cancel':
      return rpc('gn_lot_cancel', { ...tg, p_lot_id: uuid(body, 'id'), p_slots_start: SLOTS_START });
    case 'lot_buy':
      return rpc('gn_lot_buy', {
        ...tg, p_lot_id: uuid(body, 'id'), p_slots_start: SLOTS_START, p_fee: MARKET_FEE, p_max_buys: MARKET_MAX_BUYS_PER_SELLER,
      });
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
