// Локальный «сервер» для проверки интерфейса без Supabase: npm run dev → http://localhost:5173/?mock
// Попадает только в режим разработки — в production-сборку не входит.
import {
  BAILOUT_RUB, BASE_COST_RUB, KASSA_CAP_HOURS, START_BALANCE_RUB, countryById,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  drawNumber, evaluate, formatLabel, kassaTotalKop, numberValueKop, spinCostKop, xpForSpin, xpToNext,
} from '../../supabase/functions/_shared/game/logic.ts';
import type { Api, Sim, State } from './types.ts';

const P = {
  balance: START_BALANCE_RUB * 100, xp: 0, level: 1, accKop: 0, accAt: Date.now(),
  pending: null as Sim | null, coll: [] as Sim[],
};
const fail = (msg: string) => Promise.reject(new Error(msg));
const collValue = () => P.coll.reduce((s, x) => s + x.value, 0);
const kassa = () => kassaTotalKop(P.accKop, collValue(), (Date.now() - P.accAt) / 3.6e6);
const settle = () => { P.accKop = kassa(); P.accAt = Date.now(); };
const state = (): State => ({
  balance: P.balance, xp: P.xp, level: P.level, collection_value: collValue(), collection_count: P.coll.length,
  kassa_acc: kassa(), server_now: new Date().toISOString(), bailout_at: null, pending: P.pending,
});
const ok = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 250));

export const mockApi: Api = {
  login: () => ok(state()),
  spin(countryId, stake) {
    const c = countryById(countryId)!;
    if (P.level < c.lvl) return fail('Страна закрыта');
    const auto = P.pending?.value ?? 0;
    const cost = spinCostKop(c, stake);
    if (P.balance + auto < cost) return fail('Не хватает денег');
    const { op, prefix, sub } = drawNumber(Math.random, c);
    const ev = evaluate(prefix, sub);
    P.balance += auto - cost;
    P.xp += xpForSpin(ev.mul);
    let levels = 0;
    while (P.xp >= xpToNext(P.level)) { P.xp -= xpToNext(P.level); P.level++; levels++; }
    P.pending = {
      id: crypto.randomUUID(), country: c.id, operator: op.name, prefix, sub, label: formatLabel(c, prefix, sub),
      mul: ev.mul, tier: ev.tier.id, tags: ev.tags, stake, value: numberValueKop(c, ev.mul, stake),
      created_at: new Date().toISOString(),
    };
    return ok({ sim: P.pending, auto_sold: auto, levels_gained: levels, state: state() });
  },
  sell() {
    if (!P.pending) return fail('Нет номера');
    const v = P.pending.value; P.balance += v; P.pending = null;
    return ok({ sold: v, state: state() });
  },
  keep() {
    if (!P.pending) return fail('Нет номера');
    settle(); const v = P.pending.value; P.coll.push(P.pending); P.pending = null;
    return ok({ kept: v, state: state() });
  },
  sellNumber(id) {
    const i = P.coll.findIndex((x) => x.id === id);
    if (i < 0) return fail('Нет номера');
    settle(); const v = P.coll.splice(i, 1)[0].value; P.balance += v;
    return ok({ sold: v, state: state() });
  },
  collect() {
    const v = Math.floor(kassa());
    if (v < 100) return fail('В кассе пока пусто');
    P.balance += v; P.accKop = 0; P.accAt = Date.now();
    return ok({ collected: v, state: state() });
  },
  bailout() {
    if (P.balance >= BASE_COST_RUB * 100 || P.coll.length) return fail('Денег хватает');
    P.balance += BAILOUT_RUB * 100;
    return ok({ granted: BAILOUT_RUB * 100, state: state() });
  },
  collection: () => ok([...P.coll].sort((a, b) => b.value - a.value)),
  leaderboard: () => ok({
    top: [
      { place: 1, name: 'Алексей', value: 9_870_000, count: 14, me: false },
      { place: 2, name: 'Мадина', value: 4_120_000, count: 9, me: false },
      ...(P.coll.length ? [{ place: 3, name: 'Вы', value: collValue(), count: P.coll.length, me: true }] : []),
    ],
    me: P.coll.length ? { place: 3, value: collValue(), count: P.coll.length } : null,
  }),
};

// Для проверки кассы в режиме разработки: в консоли браузера __mockHours(3)
(window as unknown as Record<string, unknown>).__mockHours = (h: number) => {
  P.accAt -= Math.min(h, KASSA_CAP_HOURS + 1) * 3.6e6;
};
