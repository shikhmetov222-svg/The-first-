// Правила игры: генерация номера, оценка редкости, экономика, опыт.
// Перенесено из prototype.html один в один. Случайность передаётся снаружи (rng),
// чтобы сервер использовал криптостойкий генератор, а тесты — воспроизводимый.

import {
  BASE_COST_RUB, BEAUTIFUL_CODE_CHANCE, KASSA_CAP_HOURS, KASSA_RATE_PER_HOUR, PATTERN_CHANCE, SUB_LEN,
  VALUE_BASE, VALUE_SLOPE, GEN_WEIGHTS, RARITY, WORDS, tierFor, type Country, type GenWeights, type Rarity, type Operator, type PrefixRule, type Tier, type T9Word,
  DAILY_BASE_RUB, DAILY_MAX_STREAK, DAILY_STEP_RUB, FREE_SPIN_EVERY_H, FREE_SPIN_MAX, HAPPY_HOURS_MSK, HAPPY_LUCK, HAPPY_SPINS,
  LUCKY_EVERY, LUCKY_LUCK, ONBOARDING_GUARANTEE, SELL_BACK, STAKE_XP, TIERS, XP_BASE, XP_POW,
  ACHIEVEMENTS, COUNTRIES, MARKET_MAX_PRICE, MARKET_MIN_PRICE, type Achievement, type KeepRule,
  QUESTS, QUESTS_PER_DAY, type PatternKind, type Quest,
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
  /** Множитель цены за особенности цифр (microFactor), на тир не влияет. */
  micro: number;
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
  // повтор трёх цифр: 456-456-x или x-456-456 (не из одинаковых)
  for (const i of [0, 1]) {
    const a = s.slice(i, i + 3);
    if (a === s.slice(i + 3, i + 6) && new Set(a).size > 1) { hits.push(['Повтор ' + a, R.block3]); break; }
  }
  // хвост — последние 4 цифры (то, что видно как «78-78»)
  const [w, x, y, z] = s.slice(3);
  const tail = `${w}${x}-${y}${z}`;
  if (s.endsWith('000') && r < 4) hits.push(['Хвост 000', R.tail000]);
  else if (s.endsWith('00') && r < 4) hits.push(['Хвост 00', R.tail00]);
  if (w === y && x === z && w !== x) hits.push(['Хвост ' + tail, R.tailABAB]);
  if (w === x && y === z && w !== y) hits.push(['Хвост ' + tail, R.tailAABB]);
  if (w === z && x === y && w !== x) hits.push(['Зеркальный хвост ' + tail, R.tailABBA]);
  const t = d.slice(3);
  if (t.every((v, i) => i === 0 || v - t[i - 1] === 1)) hits.push(['Хвост-лесенка', R.tailLadder]);
  if (s[4] === s[5] && s[5] === s[6] && r < 4 && s[6] !== '0') hits.push(['Красивый хвост', R.tail3]);
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
  return { mul, tags, tier: tierFor(mul), word, micro: microFactor(s).mul };
}

/** «Мелкие» особенности цифр: у каждого номера своя цена, даже без узора. На редкость (тир) не влияют.
 *  Сколько разных цифр, сколько одинаковых рядом и сколько семёрок. Среднее по случайным номерам ≈ 1. */
export function microFactor(s: string): { mul: number; label: string } {
  const distinct = new Set(s).size;
  const DIST: Record<number, number> = { 7: 0.88, 6: 0.93, 5: 0.99, 4: 1.05, 3: 1.11 };
  let m = DIST[distinct] ?? 1.15;
  let pairs = 0;
  for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1]) pairs++;
  m *= 1 + 0.03 * Math.min(pairs, 4);
  const sevens = [...s].filter((c) => c === '7').length;
  if (sevens >= 2) m *= 1 + 0.02 * Math.min(sevens, 5);
  const parts = [`${distinct} ${distinct >= 5 ? 'разных цифр' : 'разные цифры'}`];
  if (pairs) parts.push(`${pairs} ${pairs === 1 ? 'пара' : 'пары'} рядом`);
  if (sevens >= 2) parts.push(`семёрок: ${sevens}`);
  return { mul: Math.round(m * 100) / 100, label: parts.join(' · ') };
}

// ---------- экономика (в копейках, целые числа) ----------

export const spinCostKop = (c: Country, stake: number) => Math.round(BASE_COST_RUB * c.mul * stake * 100);
/** Доля ставки, которую стоит номер с таким множителем редкости. */
export const valueFactor = (mul: number) => VALUE_BASE + VALUE_SLOPE * (mul - 1);
export const numberValueKop = (c: Country, mul: number, stake: number, micro = 1) => valueByBetKop(spinCostKop(c, stake), mul, micro);
export const incomePerHourKop = (collectionValueKop: number) => collectionValueKop * KASSA_RATE_PER_HOUR;

/** Сколько лежит в кассе. Та же формула в SQL (gn_kassa_total). */
export function kassaTotalKop(accKop: number, collectionValueKop: number, hoursSince: number): number {
  const rate = incomePerHourKop(collectionValueKop);
  return Math.max(accKop, Math.min(accKop + rate * Math.max(0, hoursSince), rate * KASSA_CAP_HOURS));
}

/** Опыт за прокрутку: 10…100 от редкости, умножается на бонус ставки (STAKE_XP). */
export const xpForSpin = (mul: number, stake = 1) =>
  Math.round((10 + Math.min(90, Math.round(Math.log10(mul) * 25))) * (STAKE_XP[stake] ?? 1));
/** Та же формула в SQL (gn_spin получает XP_BASE и XP_POW параметрами). */
export const xpToNext = (level: number) => Math.round(XP_BASE * Math.pow(level, XP_POW));

/** Цена номера от фактической ставки в копейках. Для обычной прокрутки равна numberValueKop. */
/** Цена номера: ставка × доля по редкости × особенности цифр (microFactor). */
export const valueByBetKop = (betKop: number, mul: number, micro = 1) => Math.round(betKop * valueFactor(mul) * micro);
/** Сколько игрок получит, продав номер из коллекции. Та же формула в SQL (floor). */
export const sellBackKop = (valueKop: number) => Math.floor(valueKop * SELL_BACK);

// ---------- удача и гарантии ----------

/** 0 — обычный … 4 — легендарный. */
export const tierRank = (id: string) => TIERS.length - 1 - TIERS.findIndex((t) => t.id === id);

export interface SpinLuck {
  luck: number; // во сколько раз чаще узорные номера
  lucky: boolean; // это каждая 100-я
  happyUsed: boolean; // расходует попытку счастливого часа
}

/** Удача для прокрутки с номером spinNo (счёт с 1) при оставшихся попытках счастливого часа. */
export function spinLuck(spinNo: number, happyLeft: number): SpinLuck {
  if (spinNo % LUCKY_EVERY === 0) return { luck: LUCKY_LUCK, lucky: true, happyUsed: false };
  if (happyLeft > 0) return { luck: HAPPY_LUCK, lucky: false, happyUsed: true };
  return { luck: 1, lucky: false, happyUsed: false };
}

/** Минимальный тир для первых прокруток аккаунта (0 — без гарантии). */
export const guaranteeRank = (spinNo: number) => {
  const t = ONBOARDING_GUARANTEE[spinNo];
  return t ? tierRank(t) : 0;
};

export interface LuckyDraw extends Draw {
  ev: Evaluation;
}

/** Номер с учётом удачи (узорные чаще в `luck` раз) и гарантии (не ниже minRank). */
export function drawLucky(rng: Rng, c: Country, luck = 1, minRank = 0): LuckyDraw {
  for (let i = 0; i < 1000; i++) {
    const patternChance = minRank > 0 ? 1 : Math.min(1, PATTERN_CHANCE * luck);
    const d = drawNumber(rng, c, { patternChance });
    const ev = evaluate(d.prefix, d.sub);
    if (tierRank(ev.tier.id) >= minRank) return { ...d, ev };
  }
  throw new Error('Не удалось подобрать номер');
}

// ---------- время по Москве (UTC+3 круглый год) ----------

const pad = (n: number) => String(n).padStart(2, '0');
export function msk(now: Date) {
  const m = new Date(now.getTime() + 3 * 3600e3);
  const date = `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
  return { hour: m.getUTCHours(), date, key: `${date}T${pad(m.getUTCHours())}` };
}

/** Счастливый час сейчас: сколько попыток осталось и когда начнётся следующий. Та же логика в SQL (gn_happy_now). */
export function happyNow(happyKey: string | null, happyUsed: number, now: Date) {
  const t = msk(now);
  const active = HAPPY_HOURS_MSK.includes(t.hour);
  const left = !active ? 0 : happyKey === t.key ? Math.max(0, HAPPY_SPINS - happyUsed) : HAPPY_SPINS;
  // ближайшее начало счастливого часа (в будущем)
  let next: Date | null = null;
  for (let h = 1; h <= 24 && !next; h++) {
    const d = new Date(now.getTime() + h * 3600e3);
    if (HAPPY_HOURS_MSK.includes(msk(d).hour)) next = new Date(Math.floor(d.getTime() / 3600e3) * 3600e3);
  }
  return { active, left, next };
}

/** Бесплатные прокрутки сейчас. Та же логика в SQL (gn_free_now). */
export function freeNow(charges: number, freeAt: Date, now: Date) {
  if (charges >= FREE_SPIN_MAX) return { charges: FREE_SPIN_MAX, nextAt: null as Date | null };
  const every = FREE_SPIN_EVERY_H * 3600e3;
  const n = Math.floor(Math.max(0, now.getTime() - freeAt.getTime()) / every);
  const c = Math.min(FREE_SPIN_MAX, charges + n);
  return { charges: c, nextAt: c >= FREE_SPIN_MAX ? null : new Date(freeAt.getTime() + (n + 1) * every) };
}

/** Ежедневный бонус: доступен ли сегодня (по Москве) и сколько даст. Та же логика в SQL (gn_daily). */
export function dailyNow(dailyDay: string | null, streak: number, now: Date) {
  const today = msk(now).date;
  const yesterday = msk(new Date(now.getTime() - 86400e3)).date;
  const nextStreak = dailyDay === yesterday ? streak + 1 : 0;
  return {
    available: dailyDay !== today,
    streak: nextStreak,
    amountKop: (DAILY_BASE_RUB + DAILY_STEP_RUB * Math.min(nextStreak, DAILY_MAX_STREAK)) * 100,
  };
}

// ---------- форматирование ----------

export function formatLabel(c: Country, prefix: string, sub: string): string {
  let out = `${c.code} (${prefix}) ` + sub.slice(0, 3), i = 3;
  for (const g of c.grp) {
    if (typeof g === 'string') out += g;
    else { out += sub.slice(i, i + g); i += g; }
  }
  return out;
}

// ---------- достижения ----------

/** Статистика игрока из gn_stats (считает сервер по истории прокруток). */
export interface Stats {
  total_spins: number;
  tiers: Partial<Record<string, number>>; // сколько номеров каждого тира выпадало
  ops: string[]; // 'ru:МТС', … — какие операторы выпадали
  t9: number; // разных T9-слов
  codes: number; // номеров с красивым кодом
  collection_value: number; // копейки
  friends: number; // засчитанных друзей
  claimed: string[];
  /** Все теги, которые выпадали (для альбомов). У старого сервера нет. */
  tags?: string[];
}

/** Прогресс достижения: сколько сделано из скольких. */
export function achProgress(a: Achievement, s: Stats): { have: number; need: number } {
  const k = a.kind;
  switch (k.t) {
    case 'spins': return { have: s.total_spins, need: k.n };
    case 'tier': {
      const r = tierRank(k.tier);
      const have = Object.entries(s.tiers).reduce((n, [id, c]) => n + (tierRank(id) >= r ? c ?? 0 : 0), 0);
      return { have: Math.min(have, 1), need: 1 };
    }
    case 'ops': {
      const c = COUNTRIES.find((x) => x.id === k.country)!;
      const names = c.ops.map((o) => `${c.id}:${o.name}`);
      return { have: names.filter((n) => s.ops.includes(n)).length, need: names.length };
    }
    case 'countries': return { have: new Set(s.ops.map((o) => o.split(':')[0])).size, need: k.n };
    case 't9': return { have: s.t9, need: k.n };
    case 'code': return { have: s.codes, need: k.n };
    case 'value': return { have: Math.floor(s.collection_value / 100), need: k.rub };
    case 'friends': return { have: s.friends, need: k.n };
    case 'set': {
      const got = new Set((s.tags ?? []).map(patternKind));
      return { have: k.kinds.filter((x) => got.has(x)).length, need: k.kinds.length };
    }
  }
}

export const achDone = (a: Achievement, s: Stats) => { const p = achProgress(a, s); return p.have >= p.need; };
export const achClaimable = (s: Stats) => ACHIEVEMENTS.filter((a) => achDone(a, s) && !s.claimed.includes(a.id));

// ---------- рынок ----------

export const lotPriceBounds = (valueKop: number) => ({
  min: Math.ceil(valueKop * MARKET_MIN_PRICE),
  max: Math.floor(valueKop * MARKET_MAX_PRICE),
});

// ---------- почему такая цена ----------

/** Разбор цены для экрана: из чего сложился множитель. */
export function priceBreakdown(prefix: string, sub: string, R: Rarity = RARITY) {
  const ev = evaluate(prefix, sub, R);
  const parts: { label: string; mul: number }[] = [];
  const word = ev.word;
  let base = ev.mul;
  if (new Set(prefix).size === 1) { parts.push({ label: 'Код ' + prefix, mul: R.beautifulCode }); base /= R.beautifulCode; }
  if (word) { const m = word.w.length >= 6 ? R.t9Long : R.t9Short; parts.push({ label: 'T9: ' + word.w, mul: m }); base /= m; }
  const pattern = ev.tags.find((t) => !t.startsWith('T9:') && !t.startsWith('Код '));
  parts.unshift({ label: pattern ?? 'Без узора', mul: Math.round(base * 100) / 100 });
  return parts;
}

// ---------- что оставлять себе ----------

/** Подходит ли номер под правило. Та же логика в SQL (gn_rule_match). */
export function ruleMatches(rule: KeepRule, s: { tier: string; value: number }): boolean {
  if (rule.mode === 'tier') return tierRank(s.tier) >= tierRank(rule.tier);
  if (rule.mode === 'price') return s.value >= rule.from && (rule.to === null || s.value <= rule.to);
  return false;
}

/** Проверка правила от клиента: только известные режимы и разумные числа. */
export function parseKeepRule(x: unknown): KeepRule | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (r.mode === 'none') return { mode: 'none' };
  if (r.mode === 'tier' && ['nice', 'rare', 'epic', 'legend'].includes(r.tier as string)) return { mode: 'tier', tier: r.tier as 'rare' };
  const ok = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  if (r.mode === 'price' && ok(r.from) && (r.to === null || (ok(r.to) && (r.to as number) >= (r.from as number)))) {
    return { mode: 'price', from: r.from as number, to: r.to as number | null };
  }
  return null;
}

// ---------- узоры по тегам (альбомы, правила) ----------

/** Какой узор означает тег номера (тег — текст из evaluate()). */
export function patternKind(tag: string): PatternKind | null {
  if (tag === 'Круглый номер') return 'round';
  if (tag === 'Все цифры одинаковые') return 'allSame';
  if (tag === 'Лесенка') return 'ladder';
  if (/^[67] одинаковых подряд$/.test(tag)) return 'run6';
  if (tag === '5 одинаковых подряд') return 'run5';
  if (tag === '4 одинаковых подряд') return 'run4';
  if (tag === 'Зеркальный') return 'mirror';
  if (tag === 'Повтор пар') return 'pairs';
  if (tag === 'Только две цифры') return 'twoDigits';
  if (/^Повтор \d{3}$/.test(tag)) return 'block3';
  if (tag === 'Хвост 000') return 'tail000';
  if (tag === 'Хвост 00') return 'tail00';
  if (/^Зеркальный хвост /.test(tag)) return 'tailABBA';
  let m = /^Хвост (\d)(\d)-(\d)(\d)$/.exec(tag);
  if (m) return m[1] === m[3] && m[2] === m[4] ? 'tailABAB' : 'tailAABB';
  if (tag === 'Хвост-лесенка') return 'tailLadder';
  if (tag === 'Красивый хвост') return 'tail3';
  m = /^T9: /.exec(tag);
  return m ? 't9' : null;
}
export const isTailKind = (k: PatternKind | null) => !!k && (k.startsWith('tail'));

// ---------- задания дня ----------

export interface DayStats {
  day: string; // 'YYYY-MM-DD' по Москве
  spins: number;
  tiers: Partial<Record<string, number>>;
  tags: string[];
  countries: number;
  kept: number;
  big_stake: number;
  claimed: string[]; // ключи 'q:<день>:<id>'
}

/** Детерминированный выбор 3 заданий на день: у каждого игрока свои, одинаково на сервере и в игре. */
export function questsFor(day: string, telegramId: number, level = 99): Quest[] {
  let h = 2166136261;
  for (const ch of `${day}:${telegramId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const pool = QUESTS.filter((q) => (q.minLevel ?? 1) <= level);
  const out: Quest[] = [];
  while (out.length < QUESTS_PER_DAY && pool.length) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const q = pool.splice(h % pool.length, 1)[0];
    // не два задания на прокрутки сразу
    if (q.kind.t === 'spins' && out.some((x) => x.kind.t === 'spins')) continue;
    out.push(q);
  }
  return out;
}

export function questProgress(q: Quest, d: DayStats): { have: number; need: number } {
  const k = q.kind;
  switch (k.t) {
    case 'spins': return { have: d.spins, need: k.n };
    case 'tier': {
      const r = tierRank(k.tier);
      return { have: Object.entries(d.tiers).reduce((n, [id, c]) => n + (tierRank(id) >= r ? c ?? 0 : 0), 0), need: k.n };
    }
    case 'kept': return { have: d.kept, need: k.n };
    case 'countries': return { have: d.countries, need: k.n };
    case 'tail': return { have: d.tags.filter((t) => isTailKind(patternKind(t))).length, need: k.n };
    case 'bigStake': return { have: d.big_stake, need: k.n };
  }
}
export const questKey = (day: string, id: string) => `q:${day}:${id}`;
export const questDone = (q: Quest, d: DayStats) => { const p = questProgress(q, d); return p.have >= p.need; };

// ---------- неделя ----------

/** Начало недели (понедельник 00:00 по Москве), в которую попадает момент now. */
export function weekStart(now: Date): Date {
  const m = new Date(now.getTime() + 3 * 3600e3);
  const dow = (m.getUTCDay() + 6) % 7; // 0 — понедельник
  const day = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()) - dow * 86400e3;
  return new Date(day - 3 * 3600e3);
}

// ---------- улучшение 3 → 1 ----------

/** Следующая редкость для улучшения; у Легендарного — нет. */
export function nextTier(tier: string): Tier['id'] | null {
  const i = TIERS.findIndex((t) => t.id === tier);
  return i > 0 ? TIERS[i - 1].id : null;
}

/** Номер ровно нужной редкости (для улучшения). */
export function drawExactTier(rng: Rng, c: Country, tier: Tier['id']): LuckyDraw {
  const r = tierRank(tier);
  for (let i = 0; i < 300; i++) {
    const d = drawLucky(rng, c, 1, r);
    if (tierRank(d.ev.tier.id) === r) return d;
  }
  return drawLucky(rng, c, 1, r);
}
