import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BASE_COST_RUB, BEAUTIFUL_CODE_CHANCE, COUNTRIES, DAILY_BASE_RUB, FREE_SPIN_MAX, KASSA_CAP_HOURS, KASSA_RATE_PER_HOUR,
  LUCKY_LUCK, PATTERN_CHANCE, SELL_BACK, STAKES, STAKE_LEVEL, T9, WORDS, countryById, slotPriceRub,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  dailyNow, drawLucky, drawNumber, evaluate, formatLabel, freeNow, genSub, guaranteeRank, happyNow, kassaTotalKop, maxRun,
  msk, numberValueKop, sellBackKop, spinCostKop, spinLuck, tierRank, valueByBetKop, xpForSpin, xpToNext,
} from '../../supabase/functions/_shared/game/logic.ts';
import { seeded } from './seeded.ts';

const ev = (s: string, prefix = '916') => evaluate(prefix, s);

describe('редкость: правила evaluate()', () => {
  it.each([
    ['0000001', 600, 'Круглый номер', 'legend'],
    ['7000000', 600, 'Круглый номер', 'legend'],
    ['7777777', 500, 'Все цифры одинаковые', 'legend'],
    ['1234567', 120, 'Лесенка', 'epic'],
    ['9876543', 120, 'Лесенка', 'epic'],
    ['1888888', 150, '6 одинаковых подряд', 'epic'],
    ['1255555', 40, '5 одинаковых подряд', 'epic'],
    ['1244449', 5, '4 одинаковых подряд', 'nice'],
    ['1238321', 12, 'Зеркальный', 'rare'],
    ['5121212', 8, 'Повтор пар', 'rare'],
    ['1211211', 6, 'Только две цифры', 'rare'],
    ['5803456', 2, 'Хвост-лесенка', 'nice'],
    ['5803111', 1.5, 'Красивый хвост', 'nice'],
    ['5803917', 1, undefined, 'common'],
  ])('%s → ×%d', (s, mul, tag, tier) => {
    const r = ev(s);
    expect(r.mul).toBe(mul);
    expect(r.tier.id).toBe(tier);
    if (tag) expect(r.tags[0]).toBe(tag);
    else expect(r.tags).toEqual([]);
  });

  it('берётся самый дорогой узор, в теги — два лучших', () => {
    const r = ev('1111111'); // все одинаковые + 7 подряд + зеркальный + …
    expect(r.mul).toBe(500);
    expect(r.tags).toEqual(['Все цифры одинаковые', '7 одинаковых подряд']);
  });

  it('«Повтор пар» не срабатывает на одинаковых цифрах', () => {
    expect(ev('5111111').tags).not.toContain('Повтор пар');
  });

  it('«Красивый хвост» не дублирует серию из 4+', () => {
    expect(ev('1205555').tags).not.toContain('Красивый хвост');
  });

  it('T9: короткое слово ×2, слово из 6+ букв ×3', () => {
    const kotik = WORDS.find((w) => w.w === 'КОТИК')!; // 5 букв
    expect(kotik.c).toBe('45644');
    const r = ev('10' + kotik.c);
    expect(r.mul).toBe(2);
    expect(r.tags).toContain('T9: КОТИК');
    const dengi = WORDS.find((w) => w.w === 'ДЕНЬГИ')!;
    expect(ev('0' + dengi.c).mul).toBe(3);
  });

  it('T9: русская раскладка', () => {
    expect(T9['А']).toBe('2'); expect(T9['Ж']).toBe('3'); expect(T9['Я']).toBe('9'); expect(T9['Ё']).toBe('3');
  });

  it('T9 умножается на узор, бонус кода — ещё ×2', () => {
    const mama = WORDS.find((w) => w.w === 'МАМА')!.c; // 5252
    const r = evaluate('777', '111' + mama);
    expect(r.mul).toBe(1 * 2 * 2);
    expect(r.tags).toEqual(['T9: МАМА', 'Код 777']);
  });

  it('бонус за код из одинаковых цифр', () => {
    expect(evaluate('44', '5803917').mul).toBe(2);
    expect(evaluate('29', '5803917').mul).toBe(1);
  });

  it('тиры: границы', () => {
    expect(ev('5803111').tier.name).toBe('Красивый'); // 1.5
    expect(evaluate('999', '5803111').tier.name).toBe('Красивый'); // 3
    expect(evaluate('999', '1244449').tier.name).toBe('Редкий'); // 10
    expect(evaluate('999', '1238321').tier.name).toBe('Редкий'); // 24
    expect(ev('1255555').tier.name).toBe('Эпический'); // 40
    expect(evaluate('777', '1888888').tier.name).toBe('Эпический'); // 300
    expect(ev('7777777').tier.name).toBe('Легендарный'); // 500
  });

  it('maxRun', () => {
    expect(maxRun('1223334')).toBe(3);
    expect(maxRun('1234567')).toBe(1);
  });
});

describe('генерация', () => {
  it('всегда 7 цифр', () => {
    const rng = seeded(1);
    for (let i = 0; i < 20000; i++) expect(genSub(rng)).toMatch(/^\d{7}$/);
  });

  it('доля «узорных» номеров 5–7%', () => {
    const rng = seeded(2);
    const N = 200_000;
    // доля прокруток, ушедших в шаблоны: шаблон выбирается, если rng() <= PATTERN_CHANCE
    let hits = 0;
    for (let i = 0; i < N; i++) if (rng() <= PATTERN_CHANCE) hits++;
    expect(hits / N).toBeCloseTo(PATTERN_CHANCE, 2);
    expect(PATTERN_CHANCE).toBeGreaterThanOrEqual(0.05);
    expect(PATTERN_CHANCE).toBeLessThanOrEqual(0.07);
  });

  it('коды и операторы — только из конфига, длина кода постоянна в стране', () => {
    const rng = seeded(3);
    for (const c of COUNTRIES) {
      const lens = new Set(c.ops.flatMap((o) => o.prefixes.map((p) => p.code.length)));
      expect(lens.size).toBe(1);
      for (let i = 0; i < 3000; i++) {
        const d = drawNumber(rng, c);
        expect(d.op.prefixes.some((p) => p.code === d.prefix)).toBe(true);
      }
    }
  });

  it('Беларусь, код 29: оператор по первой цифре номера', () => {
    const rng = seeded(4);
    const by = countryById('by')!;
    for (let i = 0; i < 5000; i++) {
      const d = drawNumber(rng, by);
      if (d.prefix !== '29') continue;
      if ('13689'.includes(d.sub[0])) expect(d.op.name).toBe('A1');
      if ('257'.includes(d.sub[0])) expect(d.op.name).toBe('МТС');
    }
  });

  it('красивый код выпадает с одинаковым шансом во всех странах', () => {
    const rng = seeded(5);
    const N = 100_000;
    for (const c of COUNTRIES) {
      let n = 0;
      for (let i = 0; i < N; i++) if (new Set(drawNumber(rng, c).prefix).size === 1) n++;
      expect(n / N).toBeCloseTo(BEAUTIFUL_CODE_CHANCE, 2);
    }
  });
});

describe('экономика', () => {
  it('стоимость = 1000 ₽ × страна × ставка', () => {
    expect(spinCostKop(countryById('ru')!, 1)).toBe(100_000);
    expect(spinCostKop(countryById('kz')!, 5)).toBe(600_000);
    expect(spinCostKop(countryById('ae')!, 10)).toBe(BASE_COST_RUB * 5 * 10 * 100);
  });

  it('цена = 380 ₽ × страна × редкость × ставка', () => {
    expect(numberValueKop(countryById('ru')!, 1, 1)).toBe(38_000);
    expect(numberValueKop(countryById('tr')!, 12, 2)).toBe(380 * 2.5 * 12 * 2 * 100);
    expect(numberValueKop(countryById('by')!, 1.5, 1)).toBe(85_500);
  });

  it('касса: 1% в час, не больше 12 часов', () => {
    expect(kassaTotalKop(0, 100_000, 1)).toBeCloseTo(1000);
    expect(kassaTotalKop(0, 100_000, 30)).toBeCloseTo(1000 * KASSA_CAP_HOURS);
    expect(KASSA_CAP_HOURS).toBe(12);
    expect(kassaTotalKop(500, 100_000, 0)).toBe(500);
    // после продажи номеров накопленное не сгорает
    expect(kassaTotalKop(10_000, 0, 5)).toBe(10_000);
  });

  it('опыт и уровни', () => {
    expect(xpForSpin(1)).toBe(10);
    expect(xpForSpin(1.5)).toBe(14);
    expect(xpForSpin(150)).toBe(64);
    expect(xpForSpin(1500)).toBe(89);
    expect(xpForSpin(1e6)).toBe(100);
    expect(xpForSpin(1, 10)).toBe(50);
    expect(xpForSpin(1, 2)).toBe(16);
    expect(xpToNext(1)).toBe(80);
    expect(xpToNext(2)).toBe(226);
    expect(xpToNext(7)).toBe(1482);
  });

  it('страны открываются по уровню', () => {
    expect(COUNTRIES.map((c) => c.lvl)).toEqual([1, 1, 2, 3, 5, 9]);
    expect(STAKE_LEVEL).toEqual({ 1: 1, 2: 2, 5: 4, 10: 7 });
  });

  it('формат номера', () => {
    expect(formatLabel(countryById('ru')!, '916', '1234567')).toBe('+7 (916) 123-45-67');
    expect(formatLabel(countryById('tr')!, '532', '1234567')).toBe('+90 (532) 123 45 67');
    expect(formatLabel(countryById('ae')!, '50', '1234567')).toBe('+971 (50) 123 4567');
  });

  it('отдача: обычная ≈83%, с каждой 100-й ×10 ≈86%, одинакова по ставкам', () => {
    const rng = seeded(6);
    let cost = 0, value = 0, luckyValue = 0, luckyCost = 0;
    for (const c of COUNTRIES) {
      for (let i = 0; i < 100_000; i++) {
        const st = STAKES[i % STAKES.length];
        const d = drawNumber(rng, c);
        cost += spinCostKop(c, st);
        value += numberValueKop(c, evaluate(d.prefix, d.sub).mul, st);
      }
      for (let i = 0; i < 5_000; i++) {
        const d = drawLucky(rng, c, LUCKY_LUCK);
        luckyCost += spinCostKop(c, 1);
        luckyValue += numberValueKop(c, d.ev.mul, 1);
      }
    }
    const base = value / cost, lucky = luckyValue / luckyCost;
    expect(base).toBeGreaterThan(0.79);
    expect(base).toBeLessThan(0.87);
    const avg = (base * 99 + lucky) / 100;
    expect(avg).toBeGreaterThan(0.83);
    expect(avg).toBeLessThan(0.9);
  });
});

describe('удача и гарантии', () => {
  it('каждая 100-я — ×10, только она; счастливый час — ×2', () => {
    expect(spinLuck(100, 0)).toEqual({ luck: 10, lucky: true, happyUsed: false });
    expect(spinLuck(101, 0).luck).toBe(1);
    expect(spinLuck(200, 5)).toEqual({ luck: 10, lucky: true, happyUsed: false }); // сотая не тратит счастливый час
    expect(spinLuck(37, 3)).toEqual({ luck: 2, lucky: false, happyUsed: true });
    expect(spinLuck(37, 0).luck).toBe(1);
  });

  it('удача ×10 действительно чаще даёт узорные номера', () => {
    const rng = seeded(8), ru = countryById('ru')!;
    let plain = 0, lucky = 0;
    for (let i = 0; i < 20000; i++) {
      if (tierRank(drawLucky(rng, ru, 1).ev.tier.id) >= 1) plain++;
      if (tierRank(drawLucky(rng, ru, 10).ev.tier.id) >= 1) lucky++;
    }
    expect(lucky / plain).toBeGreaterThan(5);
  });

  it('гарантии: 2-я — Красивый+, 6-я — Редкий+', () => {
    expect(guaranteeRank(1)).toBe(0);
    expect(guaranteeRank(2)).toBe(1);
    expect(guaranteeRank(6)).toBe(2);
    const rng = seeded(9), ru = countryById('ru')!;
    for (let i = 0; i < 300; i++) expect(tierRank(drawLucky(rng, ru, 1, 2).ev.tier.id)).toBeGreaterThanOrEqual(2);
  });

  it('счастливые часы по Москве: 13 и 20, по 10 прокруток', () => {
    const at = (iso: string) => new Date(iso);
    expect(msk(at('2026-10-30T10:15:00Z')).hour).toBe(13);
    const h = happyNow(null, 0, at('2026-10-30T10:15:00Z'));
    expect(h.active).toBe(true);
    expect(h.left).toBe(10);
    expect(happyNow('2026-10-30T13', 7, at('2026-10-30T10:40:00Z')).left).toBe(3);
    expect(happyNow('2026-10-30T13', 7, at('2026-10-30T17:10:00Z')).left).toBe(10); // 20:10 — новый час
    const off = happyNow(null, 0, at('2026-10-30T12:00:00Z')); // 15:00 МСК
    expect(off.active).toBe(false);
    expect(off.next?.toISOString()).toBe('2026-10-30T17:00:00.000Z'); // 20:00 МСК
  });

  it('бесплатные прокрутки: раз в 4 часа, не больше двух', () => {
    const t0 = new Date('2026-10-30T00:00:00Z');
    const h = (n: number) => new Date(t0.getTime() + n * 3600e3);
    expect(freeNow(0, t0, h(3)).charges).toBe(0);
    expect(freeNow(0, t0, h(3)).nextAt?.getTime()).toBe(h(4).getTime());
    expect(freeNow(0, t0, h(4)).charges).toBe(1);
    expect(freeNow(0, t0, h(30)).charges).toBe(FREE_SPIN_MAX);
    expect(freeNow(2, t0, h(1)).nextAt).toBeNull();
  });

  it('ежедневный бонус: 1 500 ₽ и +500 за день подряд, до 4 500 ₽', () => {
    const now = new Date('2026-10-30T09:00:00Z');
    expect(dailyNow(null, 0, now)).toEqual({ available: true, streak: 0, amountKop: DAILY_BASE_RUB * 100 });
    expect(dailyNow('2026-10-30', 3, now).available).toBe(false);
    expect(dailyNow('2026-10-29', 0, now).amountKop).toBe(200_000);
    expect(dailyNow('2026-10-29', 30, now).amountKop).toBe(450_000);
    expect(dailyNow('2026-10-27', 5, now).streak).toBe(0);
  });
});

describe('витрина', () => {
  it('цена мест растёт ×1,45', () => {
    expect([0, 1, 2].map(slotPriceRub)).toEqual([4000, 5800, 8410]);
  });
  it('продажа из коллекции — 70%', () => {
    expect(SELL_BACK).toBe(0.7);
    expect(sellBackKop(100_001)).toBe(70_000);
  });
  it('цена от ставки совпадает с обычной формулой', () => {
    const tr = countryById('tr')!;
    expect(valueByBetKop(spinCostKop(tr, 5), 12)).toBe(numberValueKop(tr, 12, 5));
  });
  it('константы кассы в SQL совпадают с config.ts', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/0002_balance_v2.sql', import.meta.url), 'utf8');
    const fn = sql.slice(sql.indexOf('create or replace function gn_kassa_total'), sql.indexOf('$$;', sql.indexOf('create or replace function gn_kassa_total')));
    expect(fn).toContain(`collection_value * ${KASSA_RATE_PER_HOUR} * greatest`);
    expect(fn).toContain(`collection_value * ${KASSA_RATE_PER_HOUR} * ${KASSA_CAP_HOURS}`);
  });
});
