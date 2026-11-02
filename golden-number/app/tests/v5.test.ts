import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, COUNTRIES, QUESTS } from '../../supabase/functions/_shared/game/config.ts';
import {
  achProgress, drawExactTier, evaluate, nextTier, patternKind, questDone, questProgress, questsFor, weekStart, type DayStats, type Stats,
} from '../../supabase/functions/_shared/game/logic.ts';
import { seeded } from './seeded.ts';

const emptyDay: DayStats = { day: '2026-11-02', spins: 0, tiers: {}, tags: [], countries: 0, kept: 0, big_stake: 0, claimed: [] };

describe('задания дня', () => {
  it('три разных задания, одинаковые для того же игрока и дня, разные у разных игроков', () => {
    const a = questsFor('2026-11-02', 1), b = questsFor('2026-11-02', 1);
    expect(a.map((q) => q.id)).toEqual(b.map((q) => q.id));
    expect(new Set(a.map((q) => q.id)).size).toBe(3);
    const variety = new Set(Array.from({ length: 50 }, (_, i) => questsFor('2026-11-02', i).map((q) => q.id).join()));
    expect(variety.size).toBeGreaterThan(10);
  });
  it('не два задания на прокрутки сразу и уровень учитывается', () => {
    for (let i = 0; i < 200; i++) {
      const q = questsFor('2026-11-0' + (i % 9 + 1), i, 1);
      expect(q.filter((x) => x.kind.t === 'spins').length).toBeLessThanOrEqual(1);
      expect(q.some((x) => x.id === 'stake10')).toBe(false);
    }
  });
  it('прогресс по статистике дня', () => {
    const d: DayStats = { ...emptyDay, spins: 21, tiers: { common: 15, nice: 4, rare: 2 }, tags: ['Хвост 78-78'], countries: 2, kept: 1, big_stake: 3 };
    const q = (id: string) => QUESTS.find((x) => x.id === id)!;
    expect(questDone(q('spins20'), d)).toBe(true);
    expect(questProgress(q('nice3'), d)).toEqual({ have: 6, need: 3 }); // редкие тоже считаются
    expect(questDone(q('rare1'), d)).toBe(true);
    expect(questDone(q('tail1'), d)).toBe(true);
    expect(questDone(q('kept2'), d)).toBe(false);
    expect(questDone(q('countries2'), d)).toBe(true);
  });
});

describe('узоры и альбомы', () => {
  it('тег → узор', () => {
    expect(patternKind('Хвост 78-78')).toBe('tailABAB');
    expect(patternKind('Хвост 77-88')).toBe('tailAABB');
    expect(patternKind('Зеркальный хвост 78-87')).toBe('tailABBA');
    expect(patternKind('Повтор 456')).toBe('block3');
    expect(patternKind('7 одинаковых подряд')).toBe('run6');
    expect(patternKind('T9: КОТИК')).toBe('t9');
    expect(patternKind('Код 777')).toBe(null);
    for (const s of ['1237878', '1237788', '1237887', '4564561', '1234000', '5803900', '5803456', '5803111', '1244449', '1255555', '1888888',
      '1238321', '5121212', '1211211', '1234567', '7777777', '0000001']) {
      expect(patternKind(evaluate('916', s).tags[0])).not.toBe(null);
    }
  });
  it('альбом «Все хвосты» считает разные хвосты', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'albTails')!;
    const st = { total_spins: 0, tiers: {}, ops: [], t9: 0, codes: 0, collection_value: 0, friends: 0, claimed: [],
      tags: ['Хвост 78-78', 'Хвост 12-12', 'Хвост 000', 'Лесенка'] } as Stats;
    expect(achProgress(a, st)).toEqual({ have: 2, need: 7 });
    expect(achProgress(a, { ...st, tags: undefined })).toEqual({ have: 0, need: 7 }); // старый сервер
  });
});

describe('неделя и улучшение', () => {
  it('неделя начинается в понедельник 00:00 по Москве', () => {
    expect(weekStart(new Date('2026-11-02T10:00:00Z')).toISOString()).toBe('2026-11-01T21:00:00.000Z'); // пн
    expect(weekStart(new Date('2026-11-01T20:59:00Z')).toISOString()).toBe('2026-10-25T21:00:00.000Z'); // вс 23:59 МСК
    expect(weekStart(new Date('2026-11-01T21:00:00Z')).toISOString()).toBe('2026-11-01T21:00:00.000Z');
  });
  it('следующая редкость и номер ровно этой редкости', () => {
    expect(nextTier('common')).toBe('nice');
    expect(nextTier('epic')).toBe('legend');
    expect(nextTier('legend')).toBe(null);
    const rng = seeded(11);
    for (const t of ['nice', 'rare', 'epic', 'legend'] as const) {
      for (let i = 0; i < 30; i++) expect(drawExactTier(rng, COUNTRIES[0], t).ev.tier.id).toBe(t);
    }
  });
});
