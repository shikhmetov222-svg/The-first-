// Правила игры: генерация номера, оценка редкости, экономика, опыт.
// Перенесено из prototype.html один в один. Случайность передаётся снаружи (rng),
// чтобы сервер использовал криптостойкий генератор, а тесты — воспроизводимый.

import {
  BASE_COST_RUB, BASE_VALUE_RUB, BEAUTIFUL_CODE_CHANCE, KASSA_CAP_HOURS, KASSA_RATE_PER_HOUR, PATTERN_CHANCE, SUB_LEN,
  GEN_WEIGHTS, RARITY, WORDS, tierFor, type Country, type GenWeights, type Rarity, type Operator, type PrefixRule, type Tier, type T9Word,
} from './config.ts';

/** Возвращает число в [0, 1). */
export type Rng = () => number;

const rnd = (rng: Rng, n: number) => Math.floor(rng() * n);
const dg = (rng: Rng) => String(rnd(rng, 10));
const pick = <T>(rng: Rng, a: readonly T[]): T => a[rnd(rng, a.length)];
const rand7 = (rng: Rng) => Array.from({ length: SUB_LEN }, () => dg(rng));
const otherDigit = (rng: Rng, x: string) => {
  let y = dg(rng);
  while (y === x) y = dg(rng);
  return y;
};

// ---------- генерация ----------

type Gen = (rng: Rng) => string[];

// Шаблоны узорных номеров; веса — GEN_WEIGHTS в config.ts.
export const GEN: Record<keyof GenWeights, Gen> = {
  run4: (r) => { const a = rand7(r), p = rnd(r, 4), d = dg(r); for (let i = 0; i < 4; i++) a[p + i] = d; return a; },
  tail3: (r) => { const a = rand7(r), d = dg(r); a[4] = a[5] = a[6] = d; return a; },
  mirror: (r) => { const a = rand7(r); a[4] = a[2]; a[5] = a[1]; a[6] = a[0]; return a; },
  pairs: (r) => { const a = rand7(r), x = dg(r), y = otherDigit(r, x); for (let i = 1; i < 7; i++) a[i] = i % 2 ? x : y; return a; },
  twoDigits: (r) => { const x = dg(r), y = otherDigit(r, x); return Array.from({ length: 7 }, () => (r() < 0.5 ? x : y)); },
  t9: (r) => {
    const a = rand7(r), w = pick(r, WORDS.filter((w) => w.c.length <= 7)), p = rnd(r, 8 - w.c.length);
    [...w.c].forEach((d, i) => (a[p + i] = d));
    return a;
  },
  run5: (r) => { const a = rand7(r), p = rnd(r, 3), d = dg(r); for (let i = 0; i < 5; i++) a[p + i] = d; return a; },
  ladder: (r) => { const s = rnd(r, 4), up = r() < 0.5; return Array.from({ length: 7 }, (_, i) => String(up ? s + i : 9 - s - i)); },
  run6: (r) => { const a = rand7(r), p = rnd(r, 2), d = dg(r); for (let i = 0; i < 6; i++) a[p + i] = d; return a; },
  allSame: (r) => Array(7).fill(dg(r)),
  round: (r) => (r() < 0.5 ? [...'000000', String(1 + rnd(r, 9))] : [String(1 + rnd(r, 9)), ...'000000']),
};

export function genSub(rng: Rng, weights: GenWeights = GEN_WEIGHTS, patternChance = PATTERN_CHANCE): string {
  if (rng() > patternChance) return rand7(rng).join('');
  const entries = Object.entries(weights) as [keyof GenWeights, number][];
  let r = rng() * entries.reduce((s, e) => s + e[1], 0);
  for (const [k, w] of entries) {
    if ((r -= w) <= 0) return GEN[k](rng).join('');
  }
  return rand7(rng).join('');
}

export interface Draw {
  op: Operator;
  prefix: string;
  sub: string;
}

export const isBeautifulCode = (code: string) => new Set(code).size === 1;

/** Оператор → код → 7 цифр. Красивый код (777, 44…) выпадает с шансом BEAUTIFUL_CODE_CHANCE.
 *  Если код делится между операторами по первой цифре номера — оператор определяется по ней. */
export interface DrawOptions {
  weights?: GenWeights;
  patternChance?: number;
  beautifulCodeChance?: number;
}

export function drawNumber(rng: Rng, c: Country, o: DrawOptions = {}): Draw {
  const beautiful = c.ops.flatMap((op) => op.prefixes.filter((r) => isBeautifulCode(r.code)).map((rule) => ({ op, rule })));
  let op: Operator, rule: PrefixRule;
  if (beautiful.length && rng() < (o.beautifulCodeChance ?? BEAUTIFUL_CODE_CHANCE)) {
    ({ op, rule } = pick(rng, beautiful));
  } else {
    op = pick(rng, c.ops);
    const plain = op.prefixes.filter((r) => !isBeautifulCode(r.code));
    rule = pick(rng, plain.length ? plain : op.prefixes);
  }
  const sub = genSub(rng, o.weights, o.patternChance);
  if (rule.first && !rule.first.includes(sub[0])) {
    // Номер не меняем (иначе ломаются узоры) — он «принадлежит» оператору, за которым числится эта цифра.
    const owner = c.ops.find((o) => o.prefixes.some((r) => r.code === rule.code && r.first?.includes(sub[0])));
    if (owner) op = owner;
  }
  return { op, prefix: rule.code, sub };
}

// ---------- оценка ----------

export function maxRun(s: string): number {
  let m = 1, c = 1;
  for (let i = 1; i < s.length; i++) {
    c = s[i] === s[i - 1] ? c + 1 : 1;
    m = Math.max(m, c);
  }
  return m;
}

export interface Evaluation {
  mul: number;
  tags: string[];
  tier: Tier;
  word: T9Word | undefined;
}

export function evaluate(prefix: string, s: string, R: Rarity = RARITY): Evaluation {
  const hits: [string, number][] = [];
  const d = [...s].map(Number);
  const step = (k: number) => d.every((v, i) => i === 0 || v - d[i - 1] === k);
  if (/^0{6}[1-9]$/.test(s) || /^[1-9]0{6}$/.test(s)) hits.push(['Круглый номер', R.round]);
  if (new Set(s).size === 1) hits.push(['Все цифры одинаковые', R.allSame]);
  if (step(1) || step(-1)) hits.push(['Лесенка', R.ladder]);
  const r = maxRun(s);
  if (r >= 6) hits.push([r + ' одинаковых подряд', R.run6]);
  else if (r === 5) hits.push(['5 одинаковых подряд', R.run5]);
  else if (r === 4) hits.push(['4 одинаковых подряд', R.run4]);
  if (s === [...s].reverse().join('')) hits.push(['Зеркальный', R.mirror]);
  if (/^.(\d)(\d)\1\2\1\2$/.test(s) && s[1] !== s[2]) hits.push(['Повтор пар', R.pairs]);
  if (new Set(s).size === 2) hits.push(['Только две цифры', R.twoDigits]);
  const t = d.slice(3);
  if (t.every((v, i) => i === 0 || v - t[i - 1] === 1)) hits.push(['Хвост-лесенка', R.tailLadder]);
  if (s[4] === s[5] && s[5] === s[6] && r < 4) hits.push(['Красивый хвост', R.tail3]);
  hits.sort((a, b) => b[1] - a[1]);
  let mul = hits.length ? hits[0][1] : 1;
  const tags = hits.slice(0, 2).map((h) => h[0]);
  const word = WORDS.find((w) => s.includes(w.c));
  if (word) {
    mul *= word.w.length >= 6 ? R.t9Long : R.t9Short;
    tags.push('T9: ' + word.w);
  }
  if (new Set(prefix).size === 1) {
    mul *= R.beautifulCode;
    tags.push('Код ' + prefix);
  }
  return { mul, tags, tier: tierFor(mul), word };
}

// ---------- экономика (в копейках, целые числа) ----------

export const spinCostKop = (c: Country, stake: number) => Math.round(BASE_COST_RUB * c.mul * stake * 100);
export const numberValueKop = (c: Country, mul: number, stake: number) =>
  Math.round(BASE_VALUE_RUB * c.mul * mul * stake * 100);
export const incomePerHourKop = (collectionValueKop: number) => collectionValueKop * KASSA_RATE_PER_HOUR;

/** Сколько лежит в кассе. Та же формула в SQL (gn_kassa_total). */
export function kassaTotalKop(accKop: number, collectionValueKop: number, hoursSince: number): number {
  const rate = incomePerHourKop(collectionValueKop);
  return Math.max(accKop, Math.min(accKop + rate * Math.max(0, hoursSince), rate * KASSA_CAP_HOURS));
}

export const xpForSpin = (mul: number) => 10 + Math.min(90, Math.round(Math.log10(mul) * 25));
export const xpToNext = (level: number) => level * 100;

// ---------- форматирование ----------

export function formatLabel(c: Country, prefix: string, sub: string): string {
  let out = `${c.code} (${prefix}) ` + sub.slice(0, 3), i = 3;
  for (const g of c.grp) {
    if (typeof g === 'string') out += g;
    else { out += sub.slice(i, i + g); i += g; }
  }
  return out;
}
