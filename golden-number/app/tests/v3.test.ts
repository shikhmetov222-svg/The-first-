import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, MARKET_FEE, REF_AFTER_SPINS, inviteLink } from '../../supabase/functions/_shared/game/config.ts';
import { achClaimable, achDone, achProgress, evaluate, lotPriceBounds, priceBreakdown, type Stats } from '../../supabase/functions/_shared/game/logic.ts';
import { verifyInitData } from '../../supabase/functions/_shared/telegram.ts';

const empty: Stats = { total_spins: 0, tiers: {}, ops: [], t9: 0, codes: 0, collection_value: 0, friends: 0, claimed: [] };
const ach = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

describe('достижения', () => {
  it('у всех уникальные id и положительные награды', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    for (const a of ACHIEVEMENTS) expect(a.rewardRub).toBeGreaterThan(0);
  });

  it('прокрутки, тиры с учётом старших', () => {
    expect(achDone(ach('spins10'), { ...empty, total_spins: 10 })).toBe(true);
    expect(achDone(ach('spins10'), { ...empty, total_spins: 9 })).toBe(false);
    // легендарный засчитывает и «первый Редкий»
    expect(achDone(ach('tierRare'), { ...empty, tiers: { legend: 1 } })).toBe(true);
    expect(achDone(ach('tierEpic'), { ...empty, tiers: { rare: 5 } })).toBe(false);
  });

  it('коллекция региона: все операторы страны', () => {
    const ops = ['ru:МТС', 'ru:Билайн', 'ru:МегаФон'];
    expect(achProgress(ach('opsRu'), { ...empty, ops })).toEqual({ have: 3, need: 4 });
    expect(achDone(ach('opsRu'), { ...empty, ops: [...ops, 'ru:T2'] })).toBe(true);
    expect(achProgress(ach('countries6'), { ...empty, ops: ['ru:МТС', 'kz:Kcell', 'ru:T2'] }).have).toBe(2);
  });

  it('стоимость коллекции в рублях, полученные награды не предлагаются', () => {
    expect(achDone(ach('value100k'), { ...empty, collection_value: 100_000 * 100 })).toBe(true);
    const s = { ...empty, total_spins: 100, claimed: ['spins10'] };
    expect(achClaimable(s).map((a) => a.id)).toEqual(['spins100']);
  });

  it('сумма всех наград умеренная (меньше 500 000 ₽)', () => {
    expect(ACHIEVEMENTS.reduce((s, a) => s + a.rewardRub, 0)).toBeLessThan(500_000);
  });
});

describe('почему такая цена', () => {
  it('произведение частей равно множителю', () => {
    for (const [p, sub] of [['777', '1111456'], ['916', '1238321'], ['44', '0045644'], ['916', '5803917']]) {
      const parts = priceBreakdown(p, sub);
      expect(parts.reduce((m, x) => m * x.mul, 1)).toBeCloseTo(evaluate(p, sub).mul, 5);
    }
  });
  it('называет узор, T9 и код', () => {
    const labels = priceBreakdown('777', '1045644').map((x) => x.label);
    expect(labels).toContain('Код 777');
    expect(labels.some((l) => l.startsWith('T9:'))).toBe(true);
  });
});

describe('рынок и друзья', () => {
  it('цена лота 50–500% оценки, комиссия 5%', () => {
    expect(lotPriceBounds(100_000)).toEqual({ min: 50_000, max: 500_000 });
    expect(MARKET_FEE).toBe(0.05);
  });

  it('ссылка-приглашение и защита 30 прокрутками', () => {
    expect(inviteLink(979901619)).toBe('https://t.me/simmmcardd_bot?startapp=r979901619');
    expect(REF_AFTER_SPINS).toBe(30);
  });

  it('start_param из подписанного initData доходит до сервера', async () => {
    const token = '1:TEST';
    const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 5, first_name: 'А' }), start_param: 'r42' };
    const dcs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    const u = await verifyInitData(new URLSearchParams({ ...fields, hash }).toString(), token);
    expect(u?.start_param).toBe('r42');
  });
});
