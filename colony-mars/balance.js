// Симуляция баланса «Колонии на Марсе» — командная игра (этап 2).
// Это не часть игры: скрипт тысячи раз проигрывает партию по тем же правилам,
// что и база (supabase/schema.sql), и считает, как часто команда побеждает.
//
// Запуск (нужен только Node.js, пакеты не нужны):
//   node balance.js                      — таблица для 3, 4 и 6 игроков, по 10 000 игр
//   node balance.js 50000                — другое число игр
//   node balance.js 10000 --start=12,9,9 — другие стартовые кислород, вода, еда
//   node balance.js 10000 --doctor=3     — Врач даёт +1 кислорода не каждый раунд, а не больше 3 раз за игру

// (параметры можно сочетать; без них — числа, которые сейчас зашиты в schema.sql)
//
// Какие бывают команды:
//   «умная»          — все голосуют за одно разумное действие и вовремя используют способности;
//   «невнимательная» — каждый голосует наугад, способности жмут как попало.
// Настоящие люди — где-то между ними. Главная цифра для баланса — «умная».
//
// Чего симуляция НЕ умеет: пилот в игре показывает событие следующего раунда, и живая команда
// может под него подстроиться. Робот этого не делает, поэтому цифры для команд с Пилотом
// (4 и 6 игроков) чуть занижены.

const args = process.argv.slice(2);
const GAMES = Number(args.find((a) => /^\d+$/.test(a))) || 10000;
const opt = (name) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : null; };
const ROUNDS = 8;

// ---------- Числа игры (держим в точности как в schema.sql) ----------

const START = { oxygen: 15, water: 11, food: 11, energy: 10, parts: 4 };
if (opt('start')) { // --start=кислород,вода,еда
  const [o, w, f] = opt('start').split(',').map(Number);
  Object.assign(START, { oxygen: o, water: w, food: f });
}
// Сколько раз за игру Врач может дать +1 кислорода (в schema.sql сейчас — без ограничения).
const DOCTOR_OXYGEN_MAX = opt('doctor') ? Number(opt('doctor')) : Infinity;

// Роли по порядку выдачи. Если игроков меньше пяти — берутся первые роли списка;
// шестой игрок получает случайную из пяти.
const ROLES = ['engineer', 'doctor', 'botanist', 'pilot', 'radio'];
const EVENTS = ['dust_storm', 'leak', 'epidemic', 'meteorite', 'find', 'quiet'];
const NEGATIVE = ['dust_storm', 'leak', 'epidemic', 'meteorite'];

// ---------- Мелочи ----------

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);

// Кто какую роль получил при N игроках.
function dealRoles(n) {
  const roles = ROLES.slice(0, Math.min(n, 5));
  while (roles.length < n) roles.push(pick(ROLES));
  return shuffle(roles);
}

// Можно ли сделать основное действие при таких запасах.
function feasible(s, action) {
  if (action === 'repair') return s.parts >= 1;
  if (action === 'water') return s.energy >= 2;
  return s.energy >= 2 && s.water >= 1; // food
}

// ---------- Итог голосования: как в resolve_round ----------
// votes — список действий, по одному на игрока (или пустой).
function chooseAction(s, votes) {
  const counts = { water: 0, food: 0, repair: 0 };
  for (const v of votes) counts[v]++;
  const total = votes.length;
  // Порядок при равенстве голосов: вода → еда → ремонт.
  const order = total === 0 ? ['repair'] : ['water', 'food', 'repair'];
  const sorted = order.map((a, prio) => ({ a, prio, c: counts[a] }))
    .sort((x, y) => y.c - x.c || x.prio - y.prio);
  for (const x of sorted) if (feasible(s, x.a)) return x.a;
  return null;
}

// ---------- Способности (применяются сразу, как use_ability) ----------

const ABILITY = {
  engineer(s) { if (s.parts < 1) return false; s.parts -= 1; s.energy += 2; return true; },
  botanist(s) { if (s.water < 1) return false; s.water -= 1; s.food += 2; return true; },
  doctor(s, p) {
    if (s.event === 'epidemic' && !s.cancelled) s.cancelled = true;
    else if ((p.oxygenGiven || 0) < DOCTOR_OXYGEN_MAX) { s.oxygen += 1; p.oxygenGiven = (p.oxygenGiven || 0) + 1; }
    else return false; // нечего давать — способность не тратится
    return true;
  },
  pilot(s) { return s.round < ROUNDS; }, // в симуляции только «тратится»
  radio(s) {
    if (!NEGATIVE.includes(s.event) || s.cancelled) return false;
    s.cancelled = true;
    return true;
  },
};
const PER_GAME = ['pilot', 'radio'];

// ---------- Как играет «умная» команда ----------

// Основное действие: сначала не дать умереть энергии, потом пополняем то, чего меньше.
function smartVote(s) {
  if (s.energy <= 3 && feasible(s, 'repair')) return 'repair';
  const options = [];
  if (feasible(s, 'water')) options.push(['water', s.water]);
  if (feasible(s, 'food') && s.water >= 4) options.push(['food', s.food]);
  if (options.length === 0) return feasible(s, 'repair') ? 'repair' : null;
  options.sort((a, b) => a[1] - b[1]);
  return options[0][0];
}

// Нужно ли сейчас использовать способность (умная команда).
function smartWantsAbility(s, role) {
  if (role === 'doctor') return true; // бесплатно, всегда полезно
  if (role === 'engineer') return s.energy <= 4 && s.parts >= 2;
  if (role === 'botanist') return s.food <= 8 && s.water >= 4;
  if (role === 'pilot') return true;
  if (role === 'radio') {
    if (!NEGATIVE.includes(s.event) || s.cancelled) return false;
    const bad = { leak: s.water <= 6, meteorite: s.oxygen <= 6, epidemic: s.food <= 5 || s.oxygen <= 5, dust_storm: s.energy <= 4 };
    return bad[s.event] || s.round >= 6; // к концу игры приберегать уже незачем
  }
  return false;
}

// ---------- Одна партия ----------
// team: 'smart' или 'careless'.
function playGame(n, team) {
  const s = { ...START, round: 1, cancelled: false, event: pick(EVENTS) };
  const players = dealRoles(n).map((role) => ({ role, usedRound: 0, usedGame: false }));
  let nextEvent = pick(EVENTS);

  for (s.round = 1; s.round <= ROUNDS; s.round++) {
    s.cancelled = false;

    // 1. Способности (до закрытия раунда).
    for (const p of players) {
      if (PER_GAME.includes(p.role) ? p.usedGame : p.usedRound === s.round) continue;
      const want = team === 'smart' ? smartWantsAbility(s, p.role) : Math.random() < (PER_GAME.includes(p.role) ? 0.15 : 0.5);
      if (!want) continue;
      if (ABILITY[p.role](s, p)) {
        if (PER_GAME.includes(p.role)) p.usedGame = true; else p.usedRound = s.round;
      }
    }

    // 2. Голосование.
    let votes;
    if (team === 'smart') {
      const a = smartVote(s);
      votes = a ? players.map(() => a) : [];
    } else {
      votes = players.map(() => pick(['water', 'food', 'repair']));
    }
    const action = chooseAction(s, votes);

    // 3. Действие.
    if (action === 'repair') { s.parts -= 1; s.energy += 3; }
    if (action === 'water') { s.energy -= 2; s.water += 3; }
    if (action === 'food') { s.energy -= 2; s.water -= 1; s.food += 3; }

    // 4. Расход. Без энергии кислород падает на 2 вместо 1.
    if (s.energy >= 1) { s.oxygen -= 1; s.energy -= 1; } else { s.oxygen -= 2; }
    s.water -= 1;
    s.food -= 1;

    // 5. Событие (если штраф не отменили).
    if (!s.cancelled) {
      if (s.event === 'dust_storm') s.energy -= 2;
      if (s.event === 'leak') s.water -= 3;
      if (s.event === 'epidemic') { s.food -= 1; s.oxygen -= 1; }
      if (s.event === 'meteorite') s.oxygen -= 2;
      if (s.event === 'find') s.parts += 2;
    }
    for (const k of ['oxygen', 'water', 'food', 'energy', 'parts']) s[k] = Math.max(0, s[k]);

    // 6. Поражение или следующий раунд.
    if (s.oxygen <= 0 || s.water <= 0 || s.food <= 0) {
      return { won: false, round: s.round, cause: s.oxygen <= 0 ? 'кислород' : s.water <= 0 ? 'вода' : 'еда' };
    }
    s.event = nextEvent;
    nextEvent = pick(EVENTS);
  }
  return { won: true };
}

// ---------- Таблица ----------

function stats(n, team) {
  let wins = 0, roundSum = 0, losses = 0;
  const causes = {};
  for (let i = 0; i < GAMES; i++) {
    const r = playGame(n, team);
    if (r.won) wins++;
    else { losses++; roundSum += r.round; causes[r.cause] = (causes[r.cause] || 0) + 1; }
  }
  const top = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / losses * 100).toFixed(0)}%`).join(', ');
  return { win: wins / GAMES, avgLoss: losses ? roundSum / losses : 0, top };
}

const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
console.log(`Стартовые запасы: кислород ${START.oxygen}, вода ${START.water}, еда ${START.food}, энергия ${START.energy}, запчасти ${START.parts}`);
console.log(`Партий на каждую строку: ${GAMES}\n`);
console.log('Игроков | Команда          | Побед  | Проигрыши в среднем в раунде | Из-за чего проигрывают');
console.log('--------|------------------|--------|------------------------------|-----------------------');
for (const n of [3, 4, 6]) {
  for (const [team, name] of [['smart', 'умная'], ['careless', 'невнимательная']]) {
    const r = stats(n, team);
    console.log(`   ${n}    | ${name.padEnd(16)} | ${pct(r.win)} | ${r.avgLoss.toFixed(1).padStart(28)} | ${r.top}`);
  }
}
