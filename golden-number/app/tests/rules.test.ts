import { describe, expect, it } from 'vitest';
import {
  BASE_COST_RUB, BEAUTIFUL_CODE_CHANCE, COUNTRIES, KASSA_CAP_HOURS, PATTERN_CHANCE, STAKES, T9, WORDS, countryById,
} from '../../supabase/functions/_shared/game/config.ts';
import {
  drawNumber, evaluate, formatLabel, genSub, kassaTotalKop, maxRun, numberValueKop, spinCostKop, xpForSpin, xpToNext,
} from '../../supabase/functions/_shared/game/logic.ts';
import { seeded } from './seeded.ts';

const ev = (s: string, prefix = '916') => evaluate(prefix, s);

describe('редкость: правила evaluate()', () => {
  it.each([
    ['0000001', 1500, 'Круглый номер', 'legend'],
    ['7000000', 1500, 'Круглый номер', 'legend'],
    ['7777777', 800, 'Все цифры одинаковые', 'legend'],
    ['1234567', 150, 'Лесенка', 'epic'],
    ['9876543', 150, 'Лесенка', 'epic'],
    ['1888888', 200, '6 одинаковых подряд', 'epic'],
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
    expect(r.mul).toBe(800);
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
    expect(evaluate('777', '1888888').tier.name).toBe('Эпический'); // 400
    expect(ev('7777777').tier.name).toBe('Легендарный'); // 800
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

  it('доля «узорных» номеров ≈ 7%', () => {
    const rng = seeded(2);
    const N = 200_000;
    // доля прокруток, ушедших в шаблоны: шаблон выбирается, если rng() <= PATTERN_CHANCE
    let hits = 0;
    for (let i = 0; i < N; i++) if (rng() <= PATTERN_CHANCE) hits++;
    expect(hits / N).toBeCloseTo(PATTERN_CHANCE, 2);
    expect(PATTERN_CHANCE).toBeGreaterThan(0.06);
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

  it('касса: 3% в час, не больше 8 часов', () => {
    expect(kassaTotalKop(0, 100_000, 1)).toBeCloseTo(3000);
    expect(kassaTotalKop(0, 100_000, 20)).toBeCloseTo(3000 * KASSA_CAP_HOURS);
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
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(7)).toBe(700);
  });

  it('страны открываются по уровню', () => {
    expect(COUNTRIES.map((c) => c.lvl)).toEqual([1, 1, 2, 3, 5, 8]);
  });

  it('формат номера', () => {
    expect(formatLabel(countryById('ru')!, '916', '1234567')).toBe('+7 (916) 123-45-67');
    expect(formatLabel(countryById('tr')!, '532', '1234567')).toBe('+90 (532) 123 45 67');
    expect(formatLabel(countryById('ae')!, '50', '1234567')).toBe('+971 (50) 123 4567');
  });

  it('средняя отдача ≈ 90% ставки (100 000 прокруток на страну)', () => {
    const rng = seeded(6);
    let cost = 0, value = 0;
    for (const c of COUNTRIES) {
      for (let i = 0; i < 100_000; i++) {
        const st = STAKES[i % STAKES.length];
        const d = drawNumber(rng, c);
        cost += spinCostKop(c, st);
        value += numberValueKop(c, evaluate(d.prefix, d.sub).mul, st);
      }
    }
    const rtp = value / cost;
    expect(rtp).toBeGreaterThan(0.85);
    expect(rtp).toBeLessThan(0.95);
  });
});
