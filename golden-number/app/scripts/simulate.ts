// Симуляция экономики: N прокруток в каждой стране, считаем среднюю отдачу (цена номера / стоимость прокрутки).
// Запуск: npm run sim  (или: node scripts/simulate.ts 300000)
import { COUNTRIES, STAKES, TIERS } from '../../supabase/functions/_shared/game/config.ts';
import { drawLucky, drawNumber, evaluate, numberValueKop, spinCostKop } from '../../supabase/functions/_shared/game/logic.ts';
import { HAPPY_LUCK, LUCKY_EVERY, LUCKY_LUCK } from '../../supabase/functions/_shared/game/config.ts';
import { seeded } from '../tests/seeded.ts';

const N = Number(process.argv[2] ?? 300_000);
const rng = seeded(Number(process.argv[3] ?? 20261030));
const fmt = (n: number, d = 2) => n.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });

let allCost = 0, allValue = 0;
const tiersAll: Record<string, number> = {};
console.log(`Симуляция: ${N.toLocaleString('ru-RU')} прокруток на страну, ставки ×1/×2/×5/×10 по кругу\n`);
console.log('Страна     Отдача   Медиана×  Макс×    Красивый  Редкий   Эпический  Легенд.');
for (const c of COUNTRIES) {
  let cost = 0, value = 0, maxMul = 0;
  const tiers: Record<string, number> = {};
  const muls: number[] = [];
  for (let i = 0; i < N; i++) {
    const stake = STAKES[i % STAKES.length];
    const { prefix, sub } = drawNumber(rng, c);
    const ev = evaluate(prefix, sub);
    cost += spinCostKop(c, stake);
    value += numberValueKop(c, ev.mul, stake);
    tiers[ev.tier.id] = (tiers[ev.tier.id] ?? 0) + 1;
    tiersAll[ev.tier.id] = (tiersAll[ev.tier.id] ?? 0) + 1;
    muls.push(ev.mul);
    maxMul = Math.max(maxMul, ev.mul);
  }
  muls.sort((a, b) => a - b);
  allCost += cost; allValue += value;
  const pct = (id: string) => (((tiers[id] ?? 0) / N) * 100).toFixed(3).padStart(7) + '%';
  console.log(
    `${c.name.padEnd(11)}${(fmt((value / cost) * 100, 1) + '%').padStart(7)}  ${String(muls[N >> 1]).padStart(7)}  ${String(maxMul).padStart(6)}  ` +
    `${pct('nice')} ${pct('rare')} ${pct('epic')}  ${pct('legend')}`,
  );
}
const total = N * COUNTRIES.length;
console.log(`\nИТОГО: ${total.toLocaleString('ru-RU')} прокруток, средняя отдача ${fmt((allValue / allCost) * 100, 1)}% ставки`);
console.log('Тиры: ' + TIERS.map((t) => `${t.name} ${(((tiersAll[t.id] ?? 0) / total) * 100).toFixed(3)}%`).join(' · '));

// Удача: та же цена, узорные чаще. Считаем на России (отдача от страны не зависит).
const ru = COUNTRIES[0];
const luckRtp = (luck: number, n: number) => {
  let v = 0;
  for (let i = 0; i < n; i++) v += numberValueKop(ru, drawLucky(rng, ru, luck).ev.mul, 1);
  return v / (n * spinCostKop(ru, 1));
};
const base = allValue / allCost, happy = luckRtp(HAPPY_LUCK, N), lucky = luckRtp(LUCKY_LUCK, Math.round(N / 3));
console.log(`Удача: счастливый час ×${HAPPY_LUCK} — ${fmt(happy * 100, 1)}% · каждая ${LUCKY_EVERY}-я ×${LUCKY_LUCK} — ${fmt(lucky * 100, 0)}%`);
console.log(`Средняя с учётом каждой ${LUCKY_EVERY}-й: ${fmt(((base * (LUCKY_EVERY - 1) + lucky) / LUCKY_EVERY) * 100, 1)}% (без счастливых часов)`);
