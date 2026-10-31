// Модель игрока на 30 дней по ТЕКУЩИМ правилам (для анализа баланса).
// 3 захода в день (9:00, 14:00, 21:00), за заход до 40 прокруток; Красивый и выше — в коллекцию.
import { COUNTRIES, STAKES, KASSA_CAP_HOURS, BAILOUT_RUB, BASE_COST_RUB } from '../../supabase/functions/_shared/game/config.ts';
import { drawNumber, evaluate, numberValueKop, spinCostKop, xpForSpin, xpToNext, incomePerHourKop } from '../../supabase/functions/_shared/game/logic.ts';
import { seeded } from '../tests/seeded.ts';

type Policy = 'keep-nice' | 'keep-all' | 'sell-all';
function run(seed: number, policy: Policy, days = 30) {
  const rng = seeded(seed);
  let bal = 1_000_000, xp = 0, lvl = 1, coll = 0, ncoll = 0, legends = 0, epics = 0, spins = 0, bailouts = 0, stuck = 0;
  const unlockDay: Record<string, number> = {};
  const daily: { day: number; bal: number; coll: number; rate: number; lvl: number }[] = [];
  const hours = [9, 14, 21];
  let lastSession = -1;
  for (let day = 1; day <= days; day++) {
    for (const h of hours) {
      const t = (day - 1) * 24 + h;
      if (lastSession >= 0) bal += Math.min(incomePerHourKop(coll) * (t - lastSession), incomePerHourKop(coll) * KASSA_CAP_HOURS);
      lastSession = t;
      for (let i = 0; i < 40; i++) {
        const open = COUNTRIES.filter((c) => c.lvl <= lvl);
        const c = open.reduce((a, b) => (b.mul > a.mul ? b : a));
        let stake: number = STAKES[0];
        for (const s of STAKES) if (spinCostKop(c, s) <= bal * 0.1) stake = s;
        const cost = spinCostKop(c, stake);
        if (bal < cost) {
          if (ncoll === 0 && bal < BASE_COST_RUB * 100) { bal += BAILOUT_RUB * 100; bailouts++; continue; }
          stuck++; break;
        }
        bal -= cost; spins++;
        const d = drawNumber(rng, c), ev = evaluate(d.prefix, d.sub), v = numberValueKop(c, ev.mul, stake);
        if (ev.tier.id === 'legend') legends++;
        if (ev.tier.id === 'epic') epics++;
        xp += xpForSpin(ev.mul);
        while (xp >= xpToNext(lvl)) { xp -= xpToNext(lvl); lvl++; for (const cc of COUNTRIES) if (cc.lvl === lvl) unlockDay[cc.name] = day; }
        const keep = policy === 'keep-all' || (policy === 'keep-nice' && ev.tier.id !== 'common');
        if (keep) { coll += v; ncoll++; } else bal += v;
      }
    }
    daily.push({ day, bal, coll, rate: incomePerHourKop(coll), lvl });
  }
  return { daily, unlockDay, legends, epics, spins, bailouts, stuck, ncoll };
}

const rub = (k: number) => Math.round(k / 100).toLocaleString('ru-RU');
for (const policy of ['keep-nice', 'keep-all', 'sell-all'] as Policy[]) {
  const runs = Array.from({ length: 200 }, (_, i) => run(1000 + i, policy));
  const med = (f: (r: ReturnType<typeof run>) => number) => { const a = runs.map(f).sort((x, y) => x - y); return a[a.length >> 1]; };
  console.log(`\n=== Стратегия: ${policy} (медиана по 200 игрокам) ===`);
  for (const d of [1, 2, 3, 7, 14, 30]) {
    console.log(`день ${String(d).padStart(2)}: ур. ${med((r) => r.daily[d - 1].lvl)}, баланс ${rub(med((r) => r.daily[d - 1].bal))} ₽, коллекция ${rub(med((r) => r.daily[d - 1].coll))} ₽, касса ${rub(med((r) => r.daily[d - 1].rate))} ₽/ч`);
  }
  for (const c of COUNTRIES.slice(2)) {
    const ds = runs.map((r) => r.unlockDay[c.name] ?? 99).sort((a, b) => a - b);
    console.log(`  ${c.name} (ур. ${c.lvl}): день ${ds[ds.length >> 1] === 99 ? '>30' : ds[ds.length >> 1]}`);
  }
  console.log(`  прокруток за 30 дней: ${med((r) => r.spins)}, легендарных: ${med((r) => r.legends)}, эпических: ${med((r) => r.epics)}, помощей: ${med((r) => r.bailouts)}, сессий упёрлось в ноль: ${med((r) => r.stuck)}`);
}
