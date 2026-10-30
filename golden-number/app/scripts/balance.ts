// Анализ баланса: «было» (текущие правила) против «стало» (предложение).
// Запуск: node scripts/balance.ts            — всё
//         node scripts/balance.ts rtp        — только отдача по странам и ставкам (300 000 на каждую пару)
//         node scripts/balance.ts player     — только модель игрока на 30 дней
import {
  COUNTRIES, GEN_WEIGHTS, PATTERN_CHANCE, BEAUTIFUL_CODE_CHANCE, RARITY, STAKES, TIERS,
  type Country, type GenWeights, type Rarity,
  BAILOUT_COOLDOWN_H, BAILOUT_RUB, BASE_VALUE_RUB, DAILY_BASE_RUB, DAILY_MAX_STREAK, DAILY_STEP_RUB, FREE_SPIN_EVERY_H,
  FREE_SPIN_MAX, HAPPY_HOURS_MSK, HAPPY_LUCK, HAPPY_SPINS, KASSA_CAP_HOURS, KASSA_RATE_PER_HOUR, LUCKY_EVERY, LUCKY_LUCK,
  SELL_BACK, SLOTS_MAX, SLOTS_START, STAKE_LEVEL, STAKE_XP, XP_BASE, XP_POW, slotPriceRub,
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
  /** Счастливые часы: удача ×luck на первые `spins` прокруток каждого часа (Infinity — без ограничения). */
  happy: { hours: number[]; luck: number; spins: number } | null;
  /** Каждая `every`-я прокрутка — удача ×luck (только она). */
  lucky: { every: number; luck: number } | null;
  /** Ставка на удачной прокрутке не выше средней ставки за последние ~100 прокруток. */
  capBet: boolean;
}

const xpBase = (mul: number) => 10 + Math.min(90, Math.round(Math.log10(mul) * 25));

// Правила первой версии (зафиксированы для сравнения).
export const BEFORE: Rules = {
  name: 'было',
  patternChance: 0.066, beautifulCodeChance: 0.02,
  weights: { ...GEN_WEIGHTS, allSame: 0.25, round: 0.08, ladder: 1.2 },
  rarity: { ...RARITY, round: 1500, allSame: 800, ladder: 150, run6: 200 },
  baseValue: 380, kassaRate: 0.03, kassaCapH: 8, slots: null, sellBack: 1,
  daily: null, freeSpin: null, pity: null,
  xp: (m) => xpBase(m), xpToNext: (l) => l * 100,
  stakeLevel: { 1: 1, 2: 1, 5: 1, 10: 1 },
  countryLevel: { ru: 1, kz: 1, by: 2, uz: 3, tr: 5, ae: 8 },
  bailoutRub: 5000,
  bailoutCooldownH: 4,
  happy: null, lucky: null, capBet: false,
};

// Текущие правила из config.ts без удачи.
export const AFTER: Rules = {
  name: 'стало',
  patternChance: PATTERN_CHANCE,
  beautifulCodeChance: BEAUTIFUL_CODE_CHANCE,
  weights: GEN_WEIGHTS,
  rarity: RARITY,
  baseValue: BASE_VALUE_RUB,
  kassaRate: KASSA_RATE_PER_HOUR, kassaCapH: KASSA_CAP_HOURS,
  slots: { start: SLOTS_START, max: SLOTS_MAX, cost: slotPriceRub },
  sellBack: SELL_BACK,
  daily: (streak) => DAILY_BASE_RUB + DAILY_STEP_RUB * Math.min(streak, DAILY_MAX_STREAK),
  freeSpin: { everyH: FREE_SPIN_EVERY_H, max: FREE_SPIN_MAX },
  pity: { niceAt: 2, rareAt: 6, rareEvery: Infinity },
  xp: (m, s) => Math.round(xpBase(m) * STAKE_XP[s]),
  xpToNext: (l) => Math.round(XP_BASE * Math.pow(l, XP_POW)),
  stakeLevel: STAKE_LEVEL,
  countryLevel: Object.fromEntries(COUNTRIES.map((c) => [c.id, c.lvl])),
  bailoutRub: BAILOUT_RUB,
  bailoutCooldownH: BAILOUT_COOLDOWN_H,
  happy: null, lucky: null, capBet: true,
};

// Удача без ограничений: счастливые часы ×2 на все прокрутки + каждая 100-я ×10, без защиты ставки.
export const NAIVE: Rules = {
  ...AFTER, name: 'удача без защиты',
  happy: { hours: HAPPY_HOURS_MSK, luck: HAPPY_LUCK, spins: Infinity }, lucky: { every: LUCKY_EVERY, luck: LUCKY_LUCK }, capBet: false,
};

// Как в игре: ×2 на первые HAPPY_SPINS прокруток часа, ставка удачной прокрутки ≤ средней.
export const LUCK: Rules = {
  ...AFTER, name: 'стало (с удачей)',
  happy: { hours: HAPPY_HOURS_MSK, luck: HAPPY_LUCK, spins: HAPPY_SPINS }, lucky: { every: LUCKY_EVERY, luck: LUCKY_LUCK }, capBet: true,
};

const tierRank = (id: string) => TIERS.length - 1 - TIERS.findIndex((t) => t.id === id); // common 0 … legend 4

function draw(rng: Rng, c: Country, R: Rules, minRank = 0, luck = 1) {
  for (let i = 0; i < 500; i++) {
    const pc = minRank ? 1 : Math.min(1, R.patternChance * luck);
    const d = drawNumber(rng, c, { weights: R.weights, patternChance: pc, beautifulCodeChance: R.beautifulCodeChance });
    const ev = evaluate(d.prefix, d.sub, R.rarity);
    if (tierRank(ev.tier.id) >= minRank) return { d, ev };
  }
  throw new Error('pity draw failed');
}

const costRub = (c: Country, s: number) => 1000 * c.mul * s;
const valueRub = (R: Rules, c: Country, mul: number, s: number) => R.baseValue * c.mul * mul * s;
/** Цена номера от фактически заплаченной ставки (₽). Без удачи совпадает с valueRub. */
const valueByBet = (R: Rules, bet: number, mul: number) => (R.baseValue / 1000) * bet * mul;

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

// ---------- 3. удача: три типа игроков ----------
type Gamer = 'обычный' | 'активный' | 'хитрый';
// обычный — заходит в 9, 15, 22 (мимо счастливых часов); активный — в 9, 13, 20 (оба счастливых часа);
// хитрый — только в счастливые часы, крутит без остановки на максимальной ставке, а перед 100-й поднимает ставку.
function luckPlayer(R: Rules, seed: number, who: Gamer, days = 30) {
  const rng = seeded(seed);
  let bal = 10_000, xp = 0, lvl = 1, kassa = 0, streak = 0, free = 0, lastFree = 0, spins = 0, avgBet = 1000, bailoutAt = -99;
  let paid = 0, won = 0, luckyWon = 0, happyWon = 0, legends = 0, extraSlots = 0;
  const coll: number[] = [];
  const hours = who === 'обычный' ? [9, 15, 22] : who === 'активный' ? [9, 13, 20] : [13, 20];
  let last = hours[0];
  const rate = () => coll.reduce((a, b) => a + b, 0) * R.kassaRate;
  const cap = () => (R.slots ? R.slots.start + extraSlots : Infinity);
  for (let day = 1; day <= days; day++) {
    for (const h of hours) {
      const t = (day - 1) * 24 + h;
      kassa = Math.max(kassa, Math.min(kassa + rate() * (t - last), rate() * R.kassaCapH));
      if (R.freeSpin) { free = Math.min(R.freeSpin.max, free + Math.floor((t - lastFree) / R.freeSpin.everyH)); lastFree = t - ((t - lastFree) % R.freeSpin.everyH); }
      last = t; bal += Math.floor(kassa); kassa = 0;
      if (R.daily && h === hours[0]) { bal += R.daily(streak); streak++; }
      const inHappy = !!R.happy && R.happy.hours.includes(h);
      let happyLeft = inHappy ? R.happy!.spins : 0;
      const maxSpins = who === 'хитрый' ? (inHappy && R.happy!.spins === Infinity ? 400 : Math.max(happyLeft, 0) + 15) : 40;
      for (let i = 0; i < maxSpins; i++) {
        const stakes = STAKES.filter((x) => R.stakeLevel[x] <= lvl);
        const open = COUNTRIES.filter((c) => R.countryLevel[c.id] <= lvl);
        const isLucky = !!R.lucky && (spins + 1) % R.lucky.every === 0;
        const boosted = happyLeft > 0 || isLucky;
        let c = open.reduce((a, b) => (b.mul > a.mul && costRub(b, 1) <= bal * 0.25 ? b : a), open[0]);
        let st = 1;
        const share = who === 'хитрый' ? (boosted ? 0.5 : 0.02) : 0.1;
        for (const x of stakes) if (costRub(c, x) <= bal * share) st = x;
        if (!boosted && who === 'хитрый') { c = open[0]; st = 1; } // между удачами крутит по минимуму
        const isFree = free > 0 && !boosted;
        if (isFree) st = 1;
        let bet = costRub(c, st);
        if (boosted && R.capBet) bet = Math.min(bet, avgBet);
        if (!isFree && bal < bet) {
          c = open[0]; st = 1; bet = Math.min(costRub(c, 1), boosted && R.capBet ? avgBet : Infinity);
          if (bal < bet) {
            if (!coll.length && t - bailoutAt >= R.bailoutCooldownH) { bal += R.bailoutRub; bailoutAt = t; i--; continue; }
            break;
          }
        }
        if (isFree) { free--; bet = costRub(c, 1); } else { bal -= bet; paid += bet; }
        avgBet = avgBet * 0.99 + bet * 0.01;
        spins++;
        const luck = isLucky ? R.lucky!.luck : happyLeft > 0 ? R.happy!.luck : 1;
        if (happyLeft > 0) happyLeft--;
        let minRank = 0;
        if (R.pity && (spins === R.pity.niceAt)) minRank = 1;
        if (R.pity && (spins === R.pity.rareAt)) minRank = 2;
        const { ev } = draw(rng, c, R, minRank, luck);
        const rank = tierRank(ev.tier.id);
        if (rank === 4) legends++;
        const v = valueByBet(R, bet, ev.mul);
        if (!isFree) { won += v; if (isLucky) luckyWon += v; else if (luck > 1) happyWon += v; }
        xp += R.xp(ev.mul, st);
        while (xp >= R.xpToNext(lvl)) { xp -= R.xpToNext(lvl); lvl++; }
        if (rank < 1) { bal += v; continue; }
        if (coll.length < cap()) { coll.push(v); continue; }
        coll.sort((a, b) => a - b);
        if (v > coll[0]) { bal += coll[0] * R.sellBack; coll[0] = v; } else bal += v;
      }
      if (R.slots && cap() < R.slots.max && coll.length >= cap()) {
        const price = R.slots.cost(extraSlots);
        if (bal >= price * 4) { bal -= price; extraSlots++; }
      }
    }
  }
  return { rtp: won / paid, won, paid, lvl, bal, coll: coll.reduce((a, b) => a + b, 0), rate: rate(), spins, legends, luckyShare: luckyWon / won, happyShare: happyWon / won };
}

const LUCK_VARIANTS: Rules[] = [{ ...BEFORE, name: 'было' }, NAIVE, LUCK];
function luckReport(n = 200) {
  console.log('\n### Удача: 30 дней, медиана по ' + n + ' игрокам (отдача = выигрыш / заплаченное, без бонусов)');
  console.log('правила             игрок       отдача  ур.  прокруток  легенд.  коллекция         касса/ч       баланс');
  for (const R of LUCK_VARIANTS) {
    for (const who of ['обычный', 'активный', 'хитрый'] as Gamer[]) {
      const runs = Array.from({ length: n }, (_, i) => luckPlayer(R, 9000 + i, who));
      const med = (f: (r: (typeof runs)[0]) => number) => { const a = runs.map(f).sort((x, y) => x - y); return a[a.length >> 1]; };
      const rub = (x: number) => Math.round(x).toLocaleString('ru-RU') + ' ₽';
      const tot = runs.reduce((a, r) => a + r.won, 0) / runs.reduce((a, r) => a + r.paid, 0);
      console.log(`${R.name.padEnd(19)} ${who.padEnd(10)} ${(tot * 100).toFixed(1).padStart(6)}%  ${String(med((r) => r.lvl)).padStart(3)}  ${String(med((r) => r.spins)).padStart(9)}  ${String(med((r) => r.legends)).padStart(7)}  ${rub(med((r) => r.coll)).padStart(16)} ${rub(med((r) => r.rate)).padStart(13)} ${rub(med((r) => r.bal)).padStart(16)}`);
    }
  }
}

function luckRtp(R: Rules, N = 400_000) {
  const rng = seeded(77); const ru = COUNTRIES[0];
  const one = (luck: number) => { let v = 0; for (let i = 0; i < N; i++) v += draw(rng, ru, R, 0, luck).ev.mul; return (v / N) * R.baseValue / 1000; };
  console.log(`${R.name}: обычная ${(one(1) * 100).toFixed(1)}% · счастливый час ×2 ${(one(2) * 100).toFixed(1)}% · 100-я ×10 ${(one(10) * 100).toFixed(0)}%`);
}

const mode = process.argv[1]?.endsWith("balance.ts") ? process.argv[2] : "none";
if (!mode || mode === 'rtp') for (const R of [BEFORE, AFTER]) rtpTable(R, Number(process.argv[3] ?? 300_000));
if (!mode || mode === 'luck') { console.log('\n### Отдача одной прокрутки по видам удачи'); for (const R of [BEFORE, LUCK]) luckRtp(R); luckReport(); }
if (!mode || mode === 'player') for (const R of [BEFORE, AFTER]) for (const p of ['keep-nice', 'keep-all', 'sell-all'] as Policy[]) playerReport(R, p);
