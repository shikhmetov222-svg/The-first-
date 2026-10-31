// Локальный «сервер» для проверки интерфейса без Supabase: npm run dev → http://localhost:5173/?mock
// Попадает только в режим разработки — в production-сборку не входит. Повторяет правила SQL-функций.
// Параметры для проверки состояний: &seq=7777777,1234567 (следующие номера) &spins=99 (сколько уже было
// прокруток) &level=7 &balance=500 &free=0 &daily=0 (бонус уже забран) &coll=6 (заполнить витрину)
import {
  KEEP_RULE_DEFAULT, type KeepRule, ACHIEVEMENTS, AVG_BET_START_RUB, AVG_BET_WEIGHT, BAILOUT_RUB, BASE_COST_RUB, FREE_SPIN_EVERY_H, FREE_SPIN_MAX, MARKET_FEE,
  SLOTS_MAX, SLOTS_START, STAKE_LEVEL, START_BALANCE_RUB, countryById, slotPriceRub,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  ruleMatches, achDone, lotPriceBounds, type Stats, dailyNow, drawLucky, evaluate, formatLabel, freeNow, guaranteeRank, happyNow, kassaTotalKop, msk, sellBackKop,
  spinCostKop, spinLuck, valueByBetKop, xpForSpin, xpToNext,
} from '../../supabase/functions/_shared/game/logic.ts';
import type { Api, Lot, Sim, State } from './types.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const seq = (q.get('seq') ?? '').split(',').filter((x) => /^\d{7}$/.test(x));

const P = {
  balance: num('balance', START_BALANCE_RUB) * 100, xp: 0, level: num('level', 1), accKop: 0, accAt: Date.now(),
  totalSpins: num('spins', 0), avgBet: AVG_BET_START_RUB * 100,
  freeCharges: num('free', FREE_SPIN_MAX), freeAt: new Date(),
  happyKey: null as string | null, happyUsed: 0,
  dailyDay: q.get('daily') === '0' ? msk(new Date()).date : (null as string | null), dailyStreak: 2,
  extraSlots: 0, bailoutAt: 0, bonus: num('bonus', 0),
  pending: null as Sim | null, coll: [] as Sim[], history: [] as Sim[], claimed: [] as string[],
  lots: [] as Lot[], myLots: [] as Lot[], rule: KEEP_RULE_DEFAULT as KeepRule,
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
  extra_slots: P.extraSlots, pending: P.pending, telegram_id: 979901619, bonus_spins: P.bonus, listed_count: P.myLots.length, keep_rule: P.rule,
});
const stats = (): Stats => ({
  total_spins: P.totalSpins,
  tiers: P.history.reduce((m, x) => ({ ...m, [x.tier]: (m[x.tier] ?? 0) + 1 }), {} as Record<string, number>),
  ops: [...new Set(P.history.map((x) => `${x.country}:${x.operator}`))],
  t9: new Set(P.history.flatMap((x) => x.tags.filter((t) => t.startsWith('T9:')))).size,
  codes: P.history.filter((x) => x.prefix.length > 1 && new Set(x.prefix).size === 1).length,
  collection_value: collValue(), friends: 1, claimed: P.claimed,
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

const base: Partial<Api> = {
  login: () => ok(state()),
  spin(countryId, stake, o) {
    const c = countryById(countryId)!;
    const now = new Date();
    const fr = freeNow(P.freeCharges, P.freeAt, now);
    const useFree = o.free && fr.charges > 0;
    const useBonus = o.free && !useFree && P.bonus > 0;
    const st = useFree || useBonus ? 1 : stake;
    if (P.level < c.lvl) return fail(`${c.name} откроется на уровне ${c.lvl}`);
    if (P.level < STAKE_LEVEL[st]) return fail(`Ставка ×${st} откроется на уровне ${STAKE_LEVEL[st]}`);
    let kept = 0;
    const match = !!P.pending && ruleMatches(P.rule, P.pending);
    if (match && P.coll.length >= SLOTS_START + P.extraSlots && !o.autosellOk) return fail('Витрина заполнена: прошлый номер подходит под правило «оставлять», но ему нет места');
    const spinNo = P.totalSpins + 1;
    const h = happyNow(P.happyKey, P.happyUsed, now);
    const luck = spinLuck(spinNo, h.left);
    const nominal = spinCostKop(c, st);
    const bet = luck.luck > 1 ? Math.min(nominal, P.avgBet) : nominal;
    const cost = useFree || useBonus ? 0 : bet;
    const keepIt = match && P.coll.length < SLOTS_START + P.extraSlots;
    const auto = keepIt ? 0 : P.pending?.value ?? 0;
    if (P.balance + auto < cost) return fail('Не хватает денег');
    if (keepIt && P.pending) { settle(); P.coll.push(P.pending); kept = P.pending.value; }
    const sim = makeSim(c.id, st, bet, luck.luck, useFree || useBonus, guaranteeRank(spinNo), seq.shift());
    P.history.push(sim);
    if (useBonus) P.bonus--;
    P.balance += auto - cost;
    P.totalSpins = spinNo;
    if (!useFree && !useBonus) P.avgBet = Math.round(P.avgBet * (1 - AVG_BET_WEIGHT) + bet * AVG_BET_WEIGHT);
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
    return ok({ sim, auto_sold: auto, auto_kept: kept, levels_gained: levels, state: state() });
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

const others = ['Алексей', 'Мадина', 'Тимур'];
for (let i = 0; i < 4; i++) {
  const sim = makeSim(['ru', 'kz', 'tr', 'ae'][i], [1, 2, 5, 1][i], [100000, 240000, 1250000, 500000][i], 1, false, 0, ['7777777', '1234567', '5121212', '9990999'][i]);
  P.lots.push({ id: crypto.randomUUID(), price: Math.round(sim.value * [1.2, 0.9, 1.5, 1.1][i]), created_at: new Date().toISOString(), mine: false, seller: others[i % 3], sim });
}

export const mockApi = Object.assign(base, {
  friends: () => ok({ invited: 2, active: 1, earned: 500_000, list: [{ name: 'Олег', spins: 42, counted: true }, { name: 'Ира', spins: 12, counted: false }] }),
  stats: () => ok(stats()),
  claim(id: string) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a || !achDone(a, stats())) return fail('Достижение ещё не выполнено');
    if (P.claimed.includes(id)) return fail('Награда уже получена');
    P.claimed.push(id); P.balance += a.rewardRub * 100; P.bonus += a.rewardSpins ?? 0;
    return ok({ reward: a.rewardRub * 100, spins: a.rewardSpins ?? 0, state: state() });
  },
  market: (mine: boolean) => ok(mine ? [...P.myLots] : [...P.myLots, ...P.lots]),
  lotCreate(simId: string, price: number) {
    const i = P.coll.findIndex((x) => x.id === simId);
    if (i < 0) return fail('Номер не найден в коллекции');
    const b = lotPriceBounds(P.coll[i].value);
    if (price < b.min || price > b.max) return fail('Цена вне границ');
    settle();
    const sim = P.coll.splice(i, 1)[0];
    const lot = { id: crypto.randomUUID(), price, created_at: new Date().toISOString(), mine: true, seller: 'Вы', sim };
    P.myLots.unshift(lot);
    return ok({ lot, state: state() });
  },
  lotCancel(lotId: string) {
    const i = P.myLots.findIndex((x) => x.id === lotId);
    if (i < 0) return fail('Лот не найден');
    if (P.coll.length >= SLOTS_START + P.extraSlots) return fail('Освободи место на витрине');
    settle(); P.coll.push(P.myLots.splice(i, 1)[0].sim);
    return ok({ state: state() });
  },
  setKeepRule(rule: KeepRule) { P.rule = rule; return ok({ state: state() }); },
  lotBuy(lotId: string) {
    const i = P.lots.findIndex((x) => x.id === lotId);
    if (i < 0) return fail(P.myLots.some((x) => x.id === lotId) ? 'Это твой лот' : 'Этот номер уже купили');
    const lot = P.lots[i];
    if (P.coll.length >= SLOTS_START + P.extraSlots) return fail('Освободи место на витрине');
    if (P.balance < lot.price) return fail('Не хватает денег');
    settle(); P.balance -= lot.price; P.coll.push(lot.sim); P.lots.splice(i, 1);
    void MARKET_FEE;
    return ok({ paid: lot.price, state: state() });
  },
}) as Api;

// Для проверки кассы в режиме разработки: в консоли браузера __mockHours(3)
(window as unknown as Record<string, unknown>).__mockHours = (h: number) => { P.accAt -= h * 3.6e6; };
