// Симуляция баланса «Колонии на Марсе» (правила этапа 2).
// Это не часть игры: скрипт тысячи раз играет партию по правилам
// и считает, как часто команда побеждает.
//
// Запуск (нужен только Node.js, пакеты не нужны):
//   node balance.js
//
// Личные способности ролей здесь НЕ учтены: их числа ещё не решены.
// Значит, симуляция показывает «худший случай» — команду без способностей.

const GAMES = 100000; // сколько партий играть для каждого варианта
const ROUNDS = 8;

// Случайные события — как на этапе 1 (одно за раунд).
const EVENTS = [
  { energy: -2 }, // буря пыли
  { water: -3 },  // утечка
  { food: -1 },   // эпидемия
  { parts: 2 },   // находка
  { oxygen: -2 }, // метеорит
];

// Три основных действия. need — что должно быть, чтобы действие было возможно.
const ACTIONS = {
  repair: { change: { parts: -1, energy: 3 }, need: { parts: 1 } },
  water: { change: { energy: -2, water: 3 }, need: { energy: 2 } },
  food: { change: { energy: -2, water: -1, food: 3 }, need: { energy: 2, water: 1 } },
};

// Можно ли сделать действие с такими запасами.
function canDo(res, name) {
  const need = ACTIONS[name].need;
  return Object.keys(need).every((k) => res[k] >= need[k]);
}

// Изменить ресурсы; ниже нуля не опускаются (как в игре).
function apply(res, change) {
  for (const k in change) res[k] = Math.max(0, res[k] + change[k]);
}

// ---------- Как команда голосует (стратегии) ----------

// «Умная» команда: держит энергию и чинит то, чего меньше всего.
function smart(res) {
  if (res.energy <= 2 && canDo(res, 'repair')) return 'repair';
  const options = [];
  if (canDo(res, 'water')) options.push(['water', res.water]);
  // Еду растим, только если воды хватает, чтобы не уморить колонию жаждой.
  if (canDo(res, 'food') && res.water >= 3) options.push(['food', res.food]);
  if (options.length === 0) return canDo(res, 'repair') ? 'repair' : null;
  options.sort((a, b) => a[1] - b[1]); // меньше всего запасов — первым
  return options[0][0];
}

// Команда голосует наугад среди возможных действий.
function random(res) {
  const list = Object.keys(ACTIONS).filter((n) => canDo(res, n));
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// Никто не голосует — каждый раунд действие по умолчанию «починить».
function passive(res) {
  return canDo(res, 'repair') ? 'repair' : null;
}

// ---------- Одна партия ----------

// opts.start — стартовые кислород, вода и еда.
// opts.oxygen — если задан, стартовый кислород отдельно от воды и еды.
// opts.events — есть ли случайные события.
// opts.oxygenRule — 'replace': без энергии кислород −2 вместо −1;
//                   'extra':   без энергии кислород −1 и ещё −2 (итого −3).
function playGame(strategy, opts) {
  const res = { oxygen: opts.oxygen || opts.start, water: opts.start, food: opts.start, energy: 10, parts: 4 };

  for (let round = 1; round <= ROUNDS; round++) {
    // 1. Основное действие по итогам голосования.
    const action = strategy(res);
    if (action) apply(res, ACTIONS[action].change);

    // 2. Обычный расход. Если энергии нет — кислород тратится сильнее.
    if (res.energy >= 1) {
      apply(res, { oxygen: -1, water: -1, food: -1, energy: -1 });
    } else {
      const oxygenLoss = opts.oxygenRule === 'extra' ? -3 : -2;
      apply(res, { oxygen: oxygenLoss, water: -1, food: -1 });
    }

    // 3. Случайное событие.
    if (opts.events) apply(res, EVENTS[Math.floor(Math.random() * EVENTS.length)]);

    // 4. Проверка поражения.
    if (res.oxygen <= 0 || res.water <= 0 || res.food <= 0) {
      return { won: false, round, cause: res.oxygen <= 0 ? 'кислород' : res.water <= 0 ? 'вода' : 'еда' };
    }
  }
  return { won: true };
}

// ---------- Таблица результатов ----------

function percent(x) {
  return (x * 100).toFixed(1).padStart(5) + '%';
}

function run(opts) {
  const row = [];
  const causes = {};
  for (const [name, strategy] of [['умная', smart], ['наугад', random], ['никто', passive]]) {
    let wins = 0;
    for (let i = 0; i < GAMES; i++) {
      const r = playGame(strategy, opts);
      if (r.won) wins++;
      else if (name === 'умная') causes[r.cause] = (causes[r.cause] || 0) + 1;
    }
    row.push(`${name} ${percent(wins / GAMES)}`);
  }
  const lost = Object.entries(causes).map(([k, v]) => `${k} ${percent(v / GAMES).trim()}`).join(', ');
  console.log(
    `старт ${opts.oxygen ? 'O₂ ' + opts.oxygen + ', вода/еда ' + opts.start : String(opts.start).padStart(2)} | события ${opts.events ? 'да ' : 'нет'} | без энергии ${opts.oxygenRule === 'extra' ? '−3' : '−2'} O₂ | ` +
      row.join(' | ') + (lost ? ` | умная гибнет: ${lost}` : '')
  );
}

console.log(`Доля побед за ${ROUNDS} раундов, ${GAMES} партий на вариант. Способности ролей не учтены.\n`);
for (const events of [true, false]) {
  for (const oxygenRule of ['replace', 'extra']) {
    for (const start of [10, 12, 13, 15]) run({ start, events, oxygenRule });
    console.log('');
  }
}

// Предложение: кислорода больше, воды и еды меньше
// (кислород нельзя пополнить действием, поэтому ему нужен запас).
console.log('Кислород отдельно от воды и еды:');
for (const [oxygen, start] of [[15, 12], [15, 11], [16, 11], [15, 10]]) {
  run({ start, oxygen, events: true, oxygenRule: 'replace' });
}
