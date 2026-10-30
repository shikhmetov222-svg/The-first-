// Анализ баланса: «было» (текущие правила) против «стало» (предложение).
// Запуск: node scripts/balance.ts            — всё
//         node scripts/balance.ts rtp        — только отдача по странам и ставкам (300 000 на каждую пару)
//         node scripts/balance.ts player     — только модель игрока на 30 дней
import {
  COUNTRIES, GEN_WEIGHTS, PATTERN_CHANCE, BEAUTIFUL_CODE_CHANCE, RARITY, STAKES, TIERS,
  type Country, type GenWeights, type Rarity,
} from '../../supabase/functions/_shared/game/config.ts';
import { drawNumber, evaluate, type Rng } from '../../supabase/functions/_shared/game/logic.ts';
import { seeded } from '../tests/seeded.ts';

// ---------- правила ----------
interface Rules {
  name: string;
  patternChance: number;
  beautifulCodeChance: number;
  weights: GenWeights;
  rarity: Rarity;
  baseValue: number; // ₽ за обычный номер при ×1
  kassaRate: number; // доля цены в час
  kassaCapH: number;
  slots: { start: number; max: number; cost: (k: number) => number } | null; // cost — цена k-го доп. слота, ₽
  sellBack: number; // доля цены при продаже из коллекции
  daily: ((streak: number) => number) | null; // ₽
  freeSpin: { everyH: number; max: number } | null;
  pity: { niceAt: number; rareAt: number; rareEvery: number } | null;
  xp: (mul: number, stake: number) => number;
  xpToNext: (lvl: number) => number;
  stakeLevel: Record<number, number>;
  countryLevel: Record<string, number>;
  bailoutRub: number;
  bailoutCooldownH: number;
}

const xpBase = (mul: number) => 10 + Math.min(90, Math.round(Math.log10(mul) * 25));

export const BEFORE: Rules = {
  name: 'было',
  patternChance: PATTERN_CHANCE, beautifulCodeChance: BEAUTIFUL_CODE_CHANCE, weights: GEN_WEIGHTS, rarity: RARITY,
  baseValue: 380, kassaRate: 0.03, kassaCapH: 8, slots: null, sellBack: 1,
  daily: null, freeSpin: null, pity: null,
  xp: (m) => xpBase(m), xpToNext: (l) => l * 100,
  stakeLevel: { 1: 1, 2: 1, 5: 1, 10: 1 },
  countryLevel: Object.fromEntries(COUNTRIES.map((c) => [c.id, c.lvl])),
  bailoutRub: 5000,
  bailoutCooldownH: 4,
};

export const AFTER: Rules = {
  name: 'стало',
  patternChance: 0.064,
  beautifulCodeChance: 0.02,
  // легендарные чаще (×4), но дешевле — чтобы игрок их видел, а отдача не выросла
  weights: { ...GEN_WEIGHTS, allSame: 1, round: 0.3, ladder: 1.5 },
  rarity: { ...RARITY, round: 600, allSame: 500, ladder: 120, run6: 150 },
  baseValue: 380,
  kassaRate: 0.01, kassaCapH: 12,
  slots: { start: 6, max: 24, cost: (k) => Math.round(4000 * Math.pow(1.45, k)) },
  sellBack: 0.7,
  daily: (streak) => 1500 + 500 * Math.min(streak, 6),
  freeSpin: { everyH: 4, max: 2 },
  pity: { niceAt: 2, rareAt: 6, rareEvery: Infinity },
  xp: (m, s) => Math.round(xpBase(m) * ({ 1: 1, 2: 1.6, 5: 3, 10: 5 } as Record<number, number>)[s]),
  xpToNext: (l) => Math.round(80 * Math.pow(l, 1.5)),
  stakeLevel: { 1: 1, 2: 2, 5: 4, 10: 7 },
  countryLevel: { ru: 1, kz: 1, by: 2, uz: 3, tr: 5, ae: 9 },
  bailoutRub: 3000,
  bailoutCooldownH: 24,
};

const tierRank = (id: string) => TIERS.length - 1 - TIERS.findIndex((t) => t.id === id); // common 0 … legend 4

function draw(rng: Rng, c: Country, R: Rules, minRank = 0) {
  for (let i = 0; i < 500; i++) {
    const d = drawNumber(rng, c, { weights: R.weights, patternChance: minRank ? 1 : R.patternChance, beautifulCodeChance: R.beautifulCodeChance });
    const ev = evaluate(d.prefix, d.sub, R.rarity);
    if (tierRank(ev.tier.id) >= minRank) return { d, ev };
  }
  throw new Error('pity draw failed');
}

const costRub = (c: Country, s: number) => 1000 * c.mul * s;
const valueRub = (R: Rules, c: Country, mul: number, s: number) => R.baseValue * c.mul * mul * s;

// ---------- 1. отдача по странам и ставкам ----------
function rtpTable(R: Rules, N: number) {
  const rng = seeded(42);
  const rows: string[] = [];
  const tiers: Record<string, number> = {};
  let t9 = 0, total = 0, allC = 0, allV = 0;
  for (const c of COUNTRIES) {
    const cells: string[] = [];
    for (const s of STAKES) {
      let cost = 0, val = 0;
      for (let i = 0; i < N; i++) {
        const { d } = { d: drawNumber(rng, c, { weights: R.weights, patternChance: R.patternChance, beautifulCodeChance: R.beautifulCodeChance }) };
        const ev = evaluate(d.prefix, d.sub, R.rarity);
        cost += costRub(c, s); val += valueRub(R, c, ev.mul, s);
        tiers[ev.tier.id] = (tiers[ev.tier.id] ?? 0) + 1;
        if (ev.word) t9++;
        total++;
      }
      allC += cost; allV += val;
      cells.push(((val / cost) * 100).toFixed(1).padStart(6) + '%');
    }
    rows.push(`${c.name.padEnd(11)}${cells.join('')}`);
  }
  console.log(`\n### Отдача прокрутки — ${R.name} (${N.toLocaleString('ru-RU')} прокруток на каждую страну × ставку)`);
  console.log(`Страна        ×1      ×2      ×5     ×10`);
  rows.forEach((r) => console.log(r));
  console.log(`ИТОГО ${(allV / allC * 100).toFixed(1)}% на ${total.toLocaleString('ru-RU')} прокрутках`);
  console.log('Тиры: ' + TIERS.map((t) => `${t.name} ${((tiers[t.id] ?? 0) / total * 100).toFixed(3)}% (1 из ${Math.round(total / (tiers[t.id] || 1))})`).join(' · '));
  console.log(`T9-слово: ${(t9 / total * 100).toFixed(2)}% (1 из ${Math.round(total / t9)})`);
}

// ---------- 2. модель игрока ----------
type Policy = 'keep-nice' | 'keep-all' | 'sell-all';
interface Num { v: number; rank: number }

function player(R: Rules, seed: number, policy: Policy, days = 30) {
  const rng = seeded(seed);
  let bal = 10_000, xp = 0, lvl = 1, kassa = 0, streak = 0, freeCharges = 0, lastFree = 0, spins = 0, sinceRare = 0, bailoutAt = -99;
  const coll: Num[] = [];
  let extraSlots = 0, slotSpent = 0, legends = 0, epics = 0, rares = 0, emptySessions = 0, firstNiceSpin = 0;
  const unlock: Record<string, number> = {};
  const daily: { lvl: number; bal: number; coll: number; rate: number; spins: number }[] = [];
  const hours = [9, 14, 21];
  let last = 9;
  const rate = () => coll.reduce((s, n) => s + n.v, 0) * R.kassaRate;
  const cap = () => (R.slots ? R.slots.start + extraSlots : Infinity);
  for (let day = 1; day <= days; day++) {
    let daySpins = 0;
    for (const h of hours) {
      const t = (day - 1) * 24 + h;
      kassa = Math.max(kassa, Math.min(kassa + rate() * (t - last), rate() * R.kassaCapH));
      if (R.freeSpin) { freeCharges = Math.min(R.freeSpin.max, freeCharges + Math.floor((t - lastFree) / R.freeSpin.everyH)); lastFree = t - ((t - lastFree) % R.freeSpin.everyH); }
      last = t;
      bal += Math.floor(kassa); kassa = 0;
      if (R.daily && h === hours[0]) { bal += R.daily(streak); streak++; }
      let sessionSpins = 0;
      for (let i = 0; i < 40; i++) {
        const stakes = STAKES.filter((s) => R.stakeLevel[s] <= lvl);
        const open = COUNTRIES.filter((c) => R.countryLevel[c.id] <= lvl);
        const free = freeCharges > 0;
        let c = open.reduce((a, b) => (b.mul > a.mul && costRub(b, 1) <= bal * 0.25 ? b : a), open[0]);
        let s = 1;
        for (const x of stakes) if (costRub(c, x) <= bal * 0.1) s = x;
        if (free) s = 1;
        if (!free && bal < costRub(c, s)) {
          c = open[0]; s = 1;
          if (bal < costRub(c, 1)) {
            if (!coll.length && t - bailoutAt >= R.bailoutCooldownH) { bal += R.bailoutRub; bailoutAt = t; i--; continue; }
            break;
          }
        }
        if (free) freeCharges--; else bal -= costRub(c, s);
        spins++; daySpins++; sessionSpins++; sinceRare++;
        let minRank = 0;
        if (R.pity) {
          if (spins === R.pity.niceAt) minRank = 1;
          if (spins === R.pity.rareAt || sinceRare >= R.pity.rareEvery) minRank = 2;
        }
        const { ev } = draw(rng, c, R, minRank);
        const rank = tierRank(ev.tier.id);
        if (rank >= 2) sinceRare = 0;
        if (rank === 4) legends++; else if (rank === 3) epics++; else if (rank === 2) rares++;
        if (rank >= 1 && !firstNiceSpin) firstNiceSpin = spins;
        const v = valueRub(R, c, ev.mul, s);
        xp += R.xp(ev.mul, s);
        while (xp >= R.xpToNext(lvl)) {
          xp -= R.xpToNext(lvl); lvl++;
          for (const cc of COUNTRIES) if (R.countryLevel[cc.id] === lvl) unlock[cc.name] = day;
          for (const st of STAKES) if (R.stakeLevel[st] === lvl && st > 1) unlock['×' + st] = day;
        }
        const wantKeep = policy === 'keep-all' || (policy === 'keep-nice' && rank >= 1);
        if (!wantKeep) { bal += v; continue; }
        if (coll.length < cap()) { coll.push({ v, rank }); continue; }
        coll.sort((a, b) => a.v - b.v);
        if (v > coll[0].v) { bal += coll[0].v * R.sellBack; coll[0] = { v, rank }; } else bal += v;
      }
      if (sessionSpins < 5) emptySessions++;
      // покупка слота витрины, если денег с запасом
      if (R.slots && cap() < R.slots.max) {
        const price = R.slots.cost(extraSlots);
        if (bal >= price * 4 && coll.length >= cap()) { bal -= price; slotSpent += price; extraSlots++; }
      }
    }
    daily.push({ lvl, bal, coll: coll.reduce((s, n) => s + n.v, 0), rate: rate(), spins: daySpins });
  }
  return { daily, unlock, legends, epics, rares, spins, emptySessions, firstNiceSpin, slots: cap(), slotSpent };
}

function playerReport(R: Rules, policy: Policy, n = 300) {
  const runs = Array.from({ length: n }, (_, i) => player(R, 7000 + i, policy));
  const med = (f: (r: (typeof runs)[0]) => number) => { const a = runs.map(f).sort((x, y) => x - y); return a[a.length >> 1]; };
  const share = (f: (r: (typeof runs)[0]) => boolean) => Math.round(runs.filter(f).length / n * 100) + '%';
  const rub = (x: number) => Math.round(x).toLocaleString('ru-RU') + ' ₽';
  console.log(`\n### Игрок 30 дней — ${R.name}, стратегия ${policy} (медиана по ${n} игрокам)`);
  console.log('день  ур.  баланс         коллекция        касса/ч     прокруток за день');
  for (const d of [1, 2, 3, 5, 7, 14, 21, 30]) {
    const x = (f: (r: (typeof runs)[0]['daily'][0]) => number) => med((r) => f(r.daily[d - 1]));
    console.log(`${String(d).padStart(3)}  ${String(x((q) => q.lvl)).padStart(3)}  ${rub(x((q) => q.bal)).padStart(14)} ${rub(x((q) => q.coll)).padStart(16)} ${rub(x((q) => q.rate)).padStart(11)}   ${x((q) => q.spins)}`);
  }
  const keys = [...COUNTRIES.slice(2).map((c) => c.name), '×2', '×5', '×10'];
  console.log('Открытие (медианный день): ' + keys.map((k) => { const a = runs.map((r) => r.unlock[k] ?? 99).sort((x, y) => x - y); const m = a[a.length >> 1]; return `${k} ${m === 99 ? '>30' : m}`; }).join(' · '));
  console.log(`Прокруток за 30 дней: ${med((r) => r.spins)} · легендарных: ${med((r) => r.legends)} (видели хоть один: ${share((r) => r.legends > 0)}) · эпических: ${med((r) => r.epics)} · редких: ${med((r) => r.rares)}`);
  console.log(`Пустых заходов (<5 прокруток): ${med((r) => r.emptySessions)} из 90 · первый «Красивый» на прокрутке №${med((r) => r.firstNiceSpin)}` + (R.slots ? ` · слотов витрины: ${med((r) => r.slots)}, потрачено на слоты ${rub(med((r) => r.slotSpent))}` : ''));
}

const mode = process.argv[1]?.endsWith("balance.ts") ? process.argv[2] : "none";
if (!mode || mode === 'rtp') for (const R of [BEFORE, AFTER]) rtpTable(R, Number(process.argv[3] ?? 300_000));
if (!mode || mode === 'player') for (const R of [BEFORE, AFTER]) for (const p of ['keep-nice', 'keep-all', 'sell-all'] as Policy[]) playerReport(R, p);
