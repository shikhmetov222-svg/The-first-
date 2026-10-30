// Единая точка входа «Золотого номера».
// Клиент присылает { action, ...params } и initData в заголовке X-Telegram-Init-Data.
// Каждый запрос заново проверяет подпись Telegram. Номер генерирует и оценивает только сервер,
// деньги меняются только в SQL-функциях (одна транзакция, строка игрока заблокирована).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verifyInitData, type TelegramUser } from '../_shared/telegram.ts';
import {
  BAILOUT_COOLDOWN_H, BAILOUT_RUB, BASE_COST_RUB, STAKES, countryById,
} from '../_shared/game/config.ts';
import {
  drawNumber, evaluate, formatLabel, numberValueKop, spinCostKop, xpForSpin, type Rng,
} from '../_shared/game/logic.ts';

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
  if (typeof v !== 'string' || v.length > 64) throw new ApiError(400, `Нет параметра ${key}`);
  return v;
}

// Криптостойкая случайность: Math.random на сервере можно предсказать.
const cryptoRng: Rng = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 4294967296;
};

async function spin(user: TelegramUser, body: Body) {
  const country = countryById(str(body, 'country'));
  if (!country) throw new ApiError(400, 'Нет такой страны');
  const stake = body.stake;
  if (typeof stake !== 'number' || !(STAKES as readonly number[]).includes(stake)) {
    throw new ApiError(400, 'Нет такой ставки');
  }

  const { op, prefix, sub } = drawNumber(cryptoRng, country);
  const ev = evaluate(prefix, sub);
  return rpc<Body>('gn_spin', {
    p_telegram_id: user.id,
    p_required_level: country.lvl,
    p_cost: spinCostKop(country, stake),
    p_xp: xpForSpin(ev.mul),
    p_country: country.id,
    p_operator: op.name,
    p_prefix: prefix,
    p_sub: sub,
    p_label: formatLabel(country, prefix, sub),
    p_mul: ev.mul,
    p_tier: ev.tier.id,
    p_tags: ev.tags,
    p_stake: stake,
    p_value: numberValueKop(country, ev.mul, stake),
  });
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
    case 'keep':
      return rpc('gn_keep', tg);
    case 'sell_number': {
      const id = str(body, 'id');
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(400, 'Нет такого номера');
      return rpc('gn_sell_number', { ...tg, p_sim_id: id });
    }
    case 'collect':
      return rpc('gn_collect', tg);
    case 'bailout':
      return rpc('gn_bailout', {
        ...tg,
        p_min_cost: BASE_COST_RUB * 100,
        p_amount: BAILOUT_RUB * 100,
        p_cooldown_h: BAILOUT_COOLDOWN_H,
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
    if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN не задан в секретах функции');
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
