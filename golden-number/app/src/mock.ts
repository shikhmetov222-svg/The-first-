// Локальный «сервер» для проверки интерфейса без Supabase: npm run dev → http://localhost:5173/?mock
// Попадает только в режим разработки — в production-сборку не входит. Повторяет правила SQL-функций.
// Параметры для проверки состояний: &seq=7777777,1234567 (следующие номера) &spins=99 (сколько уже было
// прокруток) &level=7 &balance=500 &free=0 &daily=0 (бонус уже забран) &coll=6 (заполнить витрину)
import {
  AVG_BET_START_RUB, AVG_BET_WEIGHT, BAILOUT_RUB, BASE_COST_RUB, FREE_SPIN_EVERY_H, FREE_SPIN_MAX, SLOTS_MAX, SLOTS_START,
  STAKE_LEVEL, START_BALANCE_RUB, countryById, slotPriceRub,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  dailyNow, drawLucky, evaluate, formatLabel, freeNow, guaranteeRank, happyNow, kassaTotalKop, msk, sellBackKop,
  spinCostKop, spinLuck, valueByBetKop, xpForSpin, xpToNext,
} from '../../supabase/functions/_shared/game/logic.ts';
import type { Api, Sim, State } from './types.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const seq = (q.get('seq') ?? '').split(',').filter((x) => /^\d{7}$/.test(x));

const P = {
  balance: num('balance', START_BALANCE_RUB) * 100, xp: 0, level: num('level', 1), accKop: 0, accAt: Date.now(),
  totalSpins: num('spins', 0), avgBet: AVG_BET_START_RUB * 100,
  freeCharges: num('free', FREE_SPIN_MAX), freeAt: new Date(),
  happyKey: null as string | null, happyUsed: 0,
  dailyDay: q.get('daily') === '0' ? msk(new Date()).date : (null as string | null), dailyStreak: 2,
  extraSlots: 0, bailoutAt: 0,
  pending: null as Sim | null, coll: [] as Sim[],
};
const fail = (msg: string) => new Promise<never>((_, r) => setTimeout(() => r(new Error(msg)), 200));
const collValue = () => P.coll.reduce((s, x) => s + x.value, 0);
const kassa = () => kassaTotalKop(P.accKop, collValue(), (Date.now() - P.accAt) / 3.6e6);
const settle = () => { P.accKop = kassa(); P.accAt = Date.now(); };
const state = (): State => ({
  balance: P.balance, xp: P.xp, level: P.level, collection_value: collValue(), collection_count: P.coll.length,
  kassa_acc: kassa(), server_now: new Date().toISOString(), bailout_at: null,
  total_spins: P.totalSpins, free_charges: P.freeCharges, free_at: P.freeAt.toISOString(),
  happy_key: P.happyKey, happy_used: P.happyUsed, daily_day: P.dailyDay, daily_streak: P.dailyStreak,
  extra_slots: P.extraSlots, pending: P.pending,
});
const ok = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

function makeSim(countryId: string, stake: number, bet: number, luck: number, isFree: boolean, minRank: number, forced?: string): Sim {
  const c = countryById(countryId)!;
  const d = drawLucky(Math.random, c, luck, minRank);
  const sub = forced ?? d.sub;
  const ev = forced ? evaluate(d.prefix, sub) : d.ev;
  return {
    id: crypto.randomUUID(), country: c.id, operator: d.op.name, prefix: d.prefix, sub, label: formatLabel(c, d.prefix, sub),
    mul: ev.mul, tier: ev.tier.id, tags: ev.tags, stake, value: valueByBetKop(bet, ev.mul), luck, is_free: isFree,
    created_at: new Date().toISOString(),
  };
}

for (let i = 0; i < num('coll', 0); i++) {
  P.coll.push(makeSim('ru', 1, 100000, 1, false, 0, ['1234555', '5552555', '1238321', '7121212', '9900990', '1244449'][i % 6]));
}

export const mockApi: Api = {
  login: () => ok(state()),
  spin(countryId, stake, o) {
    const c = countryById(countryId)!;
    const now = new Date();
    const fr = freeNow(P.freeCharges, P.freeAt, now);
    const useFree = o.free && fr.charges > 0;
    const st = useFree ? 1 : stake;
    if (P.level < c.lvl) return fail(`${c.name} откроется на уровне ${c.lvl}`);
    if (P.level < STAKE_LEVEL[st]) return fail(`Ставка ×${st} откроется на уровне ${STAKE_LEVEL[st]}`);
    if (P.pending && ['rare', 'epic', 'legend'].includes(P.pending.tier) && !o.autosellOk) return fail('Сначала реши, что делать с прошлым номером');
    const spinNo = P.totalSpins + 1;
    const h = happyNow(P.happyKey, P.happyUsed, now);
    const luck = spinLuck(spinNo, h.left);
    const nominal = spinCostKop(c, st);
    const bet = luck.luck > 1 ? Math.min(nominal, P.avgBet) : nominal;
    const cost = useFree ? 0 : bet;
    const auto = P.pending?.value ?? 0;
    if (P.balance + auto < cost) return fail('Не хватает денег');
    const sim = makeSim(c.id, st, bet, luck.luck, useFree, guaranteeRank(spinNo), seq.shift());
    P.balance += auto - cost;
    P.totalSpins = spinNo;
    if (!useFree) P.avgBet = Math.round(P.avgBet * (1 - AVG_BET_WEIGHT) + bet * AVG_BET_WEIGHT);
    if (useFree) {
      const every = FREE_SPIN_EVERY_H * 3.6e6;
      P.freeAt = fr.charges >= FREE_SPIN_MAX ? now : new Date(P.freeAt.getTime() + Math.floor((now.getTime() - P.freeAt.getTime()) / every) * every);
      P.freeCharges = fr.charges - 1;
    }
    if (luck.happyUsed) { const key = msk(now).key; P.happyUsed = P.happyKey === key ? P.happyUsed + 1 : 1; P.happyKey = key; }
    P.xp += xpForSpin(sim.mul, st);
    let levels = 0;
    while (P.xp >= xpToNext(P.level)) { P.xp -= xpToNext(P.level); P.level++; levels++; }
    P.pending = sim;
    return ok({ sim, auto_sold: auto, levels_gained: levels, state: state() });
  },
  sell() {
    if (!P.pending) return fail('Нет номера');
    const v = P.pending.value; P.balance += v; P.pending = null;
    return ok({ sold: v, state: state() });
  },
  keep(replaceId) {
    if (!P.pending) return fail('Нет номера');
    settle();
    let paid = 0;
    if (P.coll.length >= SLOTS_START + P.extraSlots) {
      const i = P.coll.findIndex((x) => x.id === replaceId);
      if (i < 0) return fail('Витрина заполнена');
      paid = sellBackKop(P.coll.splice(i, 1)[0].value); P.balance += paid;
    }
    const v = P.pending.value; P.coll.push(P.pending); P.pending = null;
    return ok({ kept: v, replaced_sold: paid, state: state() });
  },
  sellNumber(id) {
    const i = P.coll.findIndex((x) => x.id === id);
    if (i < 0) return fail('Нет номера');
    settle(); const v = sellBackKop(P.coll.splice(i, 1)[0].value); P.balance += v;
    return ok({ sold: v, state: state() });
  },
  buySlot() {
    if (SLOTS_START + P.extraSlots >= SLOTS_MAX) return fail('Витрина уже максимальная');
    const price = slotPriceRub(P.extraSlots) * 100;
    if (P.balance < price) return fail('Не хватает денег');
    P.balance -= price; P.extraSlots++;
    return ok({ paid: price, state: state() });
  },
  daily() {
    const d = dailyNow(P.dailyDay, P.dailyStreak, new Date());
    if (!d.available) return fail('Бонус уже получен — приходи завтра');
    P.balance += d.amountKop; P.dailyDay = msk(new Date()).date; P.dailyStreak = d.streak;
    return ok({ amount: d.amountKop, streak: d.streak, state: state() });
  },
  collect() {
    const v = Math.floor(kassa());
    if (v < 100) return fail('В кассе пока пусто');
    P.balance += v; P.accKop = 0; P.accAt = Date.now();
    return ok({ collected: v, state: state() });
  },
  bailout() {
    if (P.balance + (P.pending?.value ?? 0) >= BASE_COST_RUB * 100) return fail('Денег хватает на прокрутку в России ×1');
    if (P.coll.length) return fail('Продай номер из коллекции или подожди кассу');
    if (freeNow(P.freeCharges, P.freeAt, new Date()).charges > 0) return fail('У тебя есть бесплатная прокрутка');
    if (Date.now() - P.bailoutAt < 24 * 3.6e6) return fail('Помощь доступна раз в 24 ч');
    P.balance += BAILOUT_RUB * 100; P.bailoutAt = Date.now();
    return ok({ granted: BAILOUT_RUB * 100, state: state() });
  },
  collection: () => ok([...P.coll].sort((a, b) => b.value - a.value)),
  leaderboard: () => ok({
    top: [
      { place: 1, name: 'Алексей', value: 9_870_000, count: 14, me: false },
      { place: 2, name: 'Мадина', value: 4_120_000, count: 9, me: false },
      { place: 3, name: 'Тимур', value: 2_310_000, count: 8, me: false },
      ...(P.coll.length ? [{ place: 4, name: 'Вы', value: collValue(), count: P.coll.length, me: true }] : []),
      { place: 5, name: 'Ольга', value: 160_000, count: 3, me: false },
    ],
    me: P.coll.length ? { place: 4, value: collValue(), count: P.coll.length } : null,
  }),
};

// Для проверки кассы в режиме разработки: в консоли браузера __mockHours(3)
(window as unknown as Record<string, unknown>).__mockHours = (h: number) => { P.accAt -= h * 3.6e6; };
