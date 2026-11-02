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
import type { Api, Lot, Sim, State, Trade } from './types.ts';
import { drawExactTier, nextTier, questDone, questKey, questsFor, type DayStats } from '../../supabase/functions/_shared/game/logic.ts';
import { QUEST_ALL_RUB, QUEST_ALL_SPINS, COUNTRIES } from '../../supabase/functions/_shared/game/config.ts';

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
  notify: true, notifyHappy: false, trades: [] as Trade[], qClaimed: [] as string[], sold: new Set<string>(),
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
  notify: P.notify, notify_happy: P.notifyHappy, trades_in: P.trades.filter((t) => t.incoming).length, is_admin: q.has('admin'),
  week_prize: q.has('prize') ? { place: 2, prize: 2_500_000, spins: 3 } : null,
});
const stats = (): Stats => ({
  total_spins: P.totalSpins,
  tiers: P.history.reduce((m, x) => ({ ...m, [x.tier]: (m[x.tier] ?? 0) + 1 }), {} as Record<string, number>),
  ops: [...new Set(P.history.map((x) => `${x.country}:${x.operator}`))],
  t9: new Set(P.history.flatMap((x) => x.tags.filter((t) => t.startsWith('T9:')))).size,
  codes: P.history.filter((x) => x.prefix.length > 1 && new Set(x.prefix).size === 1).length,
  collection_value: collValue(), friends: 1, claimed: P.claimed,
  tags: [...new Set(P.history.flatMap((x) => x.tags))],
});
const today = () => msk(new Date()).date;
const dayStats = (): DayStats => {
  const h = P.history.filter((x) => msk(new Date(x.created_at)).date === today());
  return {
    day: today(), spins: h.length,
    tiers: h.reduce((m, x) => ({ ...m, [x.tier]: (m[x.tier] ?? 0) + 1 }), {} as Record<string, number>),
    tags: [...new Set(h.flatMap((x) => x.tags))], countries: new Set(h.map((x) => x.country)).size,
    kept: h.filter((x) => P.coll.includes(x)).length, big_stake: h.filter((x) => x.stake >= 2 && !x.is_free).length,
    claimed: P.qClaimed,
  };
};
const ok = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

function makeSim(countryId: string, stake: number, bet: number, luck: number, isFree: boolean, minRank: number, forced?: string): Sim {
  const c = countryById(countryId)!;
  const d = drawLucky(Math.random, c, luck, minRank);
  const sub = forced ?? d.sub;
  const ev = forced ? evaluate(d.prefix, sub) : d.ev;
  return {
    id: crypto.randomUUID(), country: c.id, operator: d.op.name, prefix: d.prefix, sub, label: formatLabel(c, d.prefix, sub),
    mul: ev.mul, tier: ev.tier.id, tags: ev.tags, stake, value: valueByBetKop(bet, ev.mul, ev.micro), luck, is_free: isFree,
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
    else if (P.pending) P.sold.add(P.pending.id);
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
    const v = P.pending.value; P.balance += v; P.sold.add(P.pending.id); P.pending = null;
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

const friendSims = ['1237878', '5121212', '7712093'].map((x) => makeSim('ru', 1, 100000, 1, false, 0, x));
if (q.has('trade')) {
  const mine = makeSim('ru', 1, 100000, 1, false, 0, '1238321'); P.coll.push(mine);
  P.trades.push({ id: crypto.randomUUID(), status: 'pending', created_at: new Date().toISOString(), incoming: true, from_name: 'Олег', to_name: 'Вы', give: mine, get: friendSims[1] });
}
const merged = new Set<string>();

export const mockApi = Object.assign(base, {
  history: () => ok([...P.history].reverse().slice(0, 50).map((x) => ({ ...x, cost: x.is_free ? 0 : x.stake * 100000,
    status: P.pending === x ? 'pending' as const : P.coll.includes(x) ? 'kept' as const : merged.has(x.id) ? 'merged' as const
      : P.myLots.some((l) => l.sim === x) ? 'listed' as const : 'auto_sold' as const }))),
  day: () => ok(dayStats()),
  questClaim(id: string) {
    const d = dayStats(), qs = questsFor(today(), 979901619, P.level);
    if (id === 'all') {
      if (!qs.every((x) => d.claimed.includes(questKey(today(), x.id)))) return fail('Сначала выполни все три задания');
      if (P.qClaimed.includes(questKey(today(), 'all'))) return fail('Награда уже получена');
      P.qClaimed.push(questKey(today(), 'all')); P.balance += QUEST_ALL_RUB * 100; P.bonus += QUEST_ALL_SPINS;
      return ok({ reward: QUEST_ALL_RUB * 100, spins: QUEST_ALL_SPINS, state: state() });
    }
    const x = qs.find((y) => y.id === id);
    if (!x || !questDone(x, d)) return fail('Задание ещё не выполнено');
    if (P.qClaimed.includes(questKey(today(), id))) return fail('Награда уже получена');
    P.qClaimed.push(questKey(today(), id)); P.balance += x.rewardRub * 100; P.bonus += x.rewardSpins ?? 0;
    return ok({ reward: x.rewardRub * 100, spins: x.rewardSpins ?? 0, state: state() });
  },
  feed: () => ok([
    ...P.history.filter((x) => x.tier === 'epic' || x.tier === 'legend').map((x) => ({ name: 'Вы', label: x.label, tier: x.tier, value: x.value, tag: x.tags[0] ?? null, country: x.country, created_at: x.created_at, me: true })),
    { name: 'Мадина', label: '+7 (926) 777-77-77', tier: 'legend' as const, value: 7_595_000, tag: 'Все цифры одинаковые', country: 'ru', created_at: new Date(Date.now() - 6e5).toISOString(), me: false },
    { name: 'Тимур', label: '+90 (532) 123 45 67', tier: 'epic' as const, value: 4_140_000, tag: 'Лесенка', country: 'tr', created_at: new Date(Date.now() - 36e5).toISOString(), me: false },
  ]),
  week: (prev: boolean) => ok({ start: new Date().toISOString(), top: [
    { place: 1, name: 'Мадина', value: 7_595_000, me: false }, { place: 2, name: 'Тимур', value: 4_140_000, me: false },
    { place: 3, name: prev ? 'Ольга' : 'Вы', value: prev ? 900_000 : Math.max(0, ...P.history.map((x) => x.value)), me: !prev },
  ], me: prev ? null : { place: 3, value: Math.max(0, ...P.history.map((x) => x.value)) } }),
  merge(ids: string[]) {
    const xs = P.coll.filter((x) => ids.includes(x.id));
    if (xs.length !== 3 || new Set(xs.map((x) => x.tier)).size !== 1) return fail('Нужны три номера одной редкости');
    const t = nextTier(xs[0].tier);
    if (!t) return fail('Легендарный — уже высшая редкость');
    settle();
    xs.forEach((x) => { P.coll.splice(P.coll.indexOf(x), 1); merged.add(x.id); });
    const d = drawExactTier(Math.random, COUNTRIES[0], t);
    const sim = makeSim('ru', 1, 100000, 1, false, 0, d.sub);
    P.coll.push(sim); P.history.push(sim);
    return ok({ sim, state: state() });
  },
  friendCollection: () => ok({ name: 'Олег', list: friendSims }),
  trades: () => ok([...P.trades]),
  tradeOffer(my: string, _friend: string, their: string) {
    const a = P.coll.find((x) => x.id === my), b = friendSims.find((x) => x.id === their);
    if (!a || !b) return fail('Номер не найден');
    if (Math.max(a.value, b.value) > 2 * Math.min(a.value, b.value)) return fail('Слишком разные цены: меняться можно номерами, которые отличаются не больше чем в 2 раза');
    const t: Trade = { id: crypto.randomUUID(), status: 'pending', created_at: new Date().toISOString(), incoming: false, from_name: 'Вы', to_name: 'Олег', give: a, get: b };
    P.trades.unshift(t);
    return ok({ trade: t, state: state() });
  },
  tradeAnswer(id: string, accept: boolean) {
    const i = P.trades.findIndex((x) => x.id === id);
    if (i < 0) return fail('Предложение уже закрыто');
    const t = P.trades.splice(i, 1)[0];
    if (t.incoming && accept) { settle(); P.coll.splice(P.coll.indexOf(t.give), 1); P.coll.push(t.get); }
    return ok({ status: !t.incoming ? 'cancelled' : accept ? 'accepted' : 'declined', state: state() });
  },
  notifyPrefs(n: boolean, h: boolean) { P.notify = n; P.notifyHappy = h; return ok({ state: state() }); },
  adminStats: () => ok({ players: 37, new_today: 4, active_today: 11, active_7d: 23, returned_next_day: 41, spins_today: 612, spins_7d: 3904,
    rtp_7d: 116.2, stuck_under_10: 9, spins_buckets: { '0': 3, '1-9': 6, '10-49': 12, '50-199': 11, '200+': 5 },
    tiers_7d: { common: 3380, nice: 420, rare: 72, epic: 29, legend: 3 }, market_7d: 14, trades_7d: 3,
    by_day: [{ day: today(), spins: 612, players: 11 }, { day: '2026-11-01', spins: 840, players: 14 }] }),
  friends: () => ok({ invited: 2, active: 1, earned: 500_000, list: [{ id: 'f1', name: 'Олег', spins: 42, counted: true, count: 3 }, { id: 'f2', name: 'Ира', spins: 12, counted: false, count: 0 }], inviter: null }),
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
