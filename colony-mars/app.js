// «Колония на Марсе» — одиночная версия игры без сервера.
// Всё состояние игры хранится в объекте game, а экран
// каждый раз перерисовывается заново функцией render().

// ---------- Telegram ----------

// Если игра открыта в Telegram — tg будет объектом WebApp.
// Если в обычном браузере — tg будет null, и игра всё равно работает.
const tg = (window.Telegram && window.Telegram.WebApp) || null;

if (tg) {
  tg.ready();  // сообщаем Telegram, что приложение загрузилось
  tg.expand(); // разворачиваем окно на всю высоту
}

// Имя игрока из Telegram, иначе — «Колонист».
function getPlayerName() {
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  return (user && user.first_name) || 'Колонист';
}

// ---------- Настройки игры ----------

const TOTAL_ROUNDS = 8;

// Названия ресурсов для экрана.
const RESOURCE_NAMES = {
  oxygen: '🫁 Кислород',
  water: '💧 Вода',
  food: '🥫 Еда',
  energy: '⚡ Энергия',
  parts: '🔩 Запчасти',
};

// Сколько ресурсов у колонии в начале игры.
const START_RESOURCES = { oxygen: 10, water: 10, food: 10, energy: 10, parts: 4 };

// Сколько колония тратит сама каждый раунд.
const ROUND_COST = { oxygen: 1, water: 1, food: 1 };

// Случайные события: текст и как они меняют ресурсы.
const EVENTS = [
  { text: 'Буря пыли: −2 энергии', change: { energy: -2 } },
  { text: 'Утечка: −3 воды', change: { water: -3 } },
  { text: 'Эпидемия: −1 еды', change: { food: -1 } },
  { text: 'Находка: +2 запчасти', change: { parts: 2 } },
  { text: 'Метеорит: −2 кислорода', change: { oxygen: -2 } },
];

// Без этих ресурсов колония погибает.
const VITAL = ['oxygen', 'water', 'food'];

// Сколько последних записей журнала показывать.
const LOG_SIZE = 6;

// ---------- Состояние игры ----------

let game;

// Начать новую игру с начальными значениями.
function newGame() {
  game = {
    round: 1,                          // текущий раунд (1…8)
    resources: { ...START_RESOURCES }, // копия, чтобы не испортить START_RESOURCES
    actionUsed: false,                 // делал ли игрок действие в этом раунде
    log: [],                           // журнал: новые записи в начале
    status: 'playing',                 // 'playing', 'won' или 'lost'
  };
  addLog('Посадка прошла успешно. Колония основана!');
}

// ---------- Правила ----------

// Добавить запись в журнал (новая — сверху).
function addLog(text) {
  game.log.unshift(text);
}

// Изменить ресурсы. Ниже нуля ресурс не опускается.
function applyChange(change) {
  for (const key in change) {
    game.resources[key] = Math.max(0, game.resources[key] + change[key]);
  }
}

// Выбрать случайное событие из списка.
function randomEvent() {
  const index = Math.floor(Math.random() * EVENTS.length);
  return EVENTS[index];
}

// Закончился ли хоть один жизненно важный ресурс.
function isColonyDead() {
  return VITAL.some((key) => game.resources[key] <= 0);
}

// Действие «Починить энергосистему»: −1 запчасть, +3 энергии.
function repairEnergy() {
  if (game.actionUsed || game.resources.parts < 1) return;
  applyChange({ parts: -1, energy: 3 });
  game.actionUsed = true;
  addLog(`Раунд ${game.round}: починили энергосистему (−1 запчасть, +3 энергии)`);
  render();
}

// Конец раунда: расход, случайное событие, проверка победы и поражения.
function nextRound() {
  applyChange(negative(ROUND_COST));

  const event = randomEvent();
  applyChange(event.change);
  addLog(`Раунд ${game.round}: расход −1 кислорода, −1 воды, −1 еды. ${event.text}`);

  if (isColonyDead()) {
    game.status = 'lost';
  } else if (game.round >= TOTAL_ROUNDS) {
    game.status = 'won';
  } else {
    game.round += 1;
    game.actionUsed = false;
  }
  render();
}

// Превратить «расход» в отрицательные числа: { water: 1 } → { water: -1 }.
function negative(cost) {
  const result = {};
  for (const key in cost) result[key] = -cost[key];
  return result;
}

// ---------- Экраны ----------

// Защита от вставки HTML через имя игрока: < и > превращаются в обычный текст.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Карточки ресурсов. Жизненно важные с малым запасом подсвечиваются.
function resourcesHtml() {
  let html = '<div class="resources">';
  for (const key in RESOURCE_NAMES) {
    const value = game.resources[key];
    const low = VITAL.includes(key) && value <= 3;
    html += `
      <div class="res ${low ? 'low' : ''}">
        <div class="hint">${RESOURCE_NAMES[key]}</div>
        <div class="value">${value}${low ? ' ⚠' : ''}</div>
      </div>`;
  }
  return html + '</div>';
}

// Журнал последних событий.
function logHtml() {
  const items = game.log
    .slice(0, LOG_SIZE)
    .map((text) => `<li>${text}</li>`)
    .join('');
  return `<h2>Журнал</h2><ul class="log">${items}</ul>`;
}

// Экран игры.
function playScreen() {
  const canRepair = !game.actionUsed && game.resources.parts >= 1;
  let repairHint = 'Тратит 1 запчасть, даёт +3 энергии. Одно действие за раунд.';
  if (game.actionUsed) repairHint = 'В этом раунде действие уже сделано.';
  else if (game.resources.parts < 1) repairHint = 'Нет запчастей — починить нечем.';

  return `
    <h1>Колония на Марсе</h1>
    <p class="hint">Командир: ${escapeHtml(getPlayerName())} · Раунд ${game.round} из ${TOTAL_ROUNDS}</p>
    ${resourcesHtml()}
    <div class="buttons">
      <button data-action="repair" ${canRepair ? '' : 'disabled'}>🔧 Починить энергосистему</button>
      <p class="hint">${repairHint}</p>
      <button data-action="next" class="secondary">Следующий раунд ▶</button>
      <button data-action="menu" class="link">← В меню</button>
    </div>
    ${logHtml()}`;
}

// Экран окончания игры: победа или поражение.
function endScreen() {
  const won = game.status === 'won';
  const title = won
    ? `🏆 Победа! Колония продержалась ${TOTAL_ROUNDS} раундов.`
    : `💀 Колония погибла в раунде ${game.round}.`;
  const reason = won ? '' : `<p class="hint">Закончилось: ${deadResources()}.</p>`;

  return `
    <h1>Колония на Марсе</h1>
    <p class="hint">Командир: ${escapeHtml(getPlayerName())}</p>
    <div class="result ${won ? 'win' : 'lose'}">${title}</div>
    ${reason}
    ${resourcesHtml()}
    <div class="buttons">
      <button data-action="restart">Сыграть снова</button>
      <button data-action="menu" class="link">← В меню</button>
    </div>
    ${logHtml()}`;
}

// Какие жизненно важные ресурсы закончились (для экрана поражения).
function deadResources() {
  return VITAL
    .filter((key) => game.resources[key] <= 0)
    .map((key) => RESOURCE_NAMES[key].toLowerCase())
    .join(', ');
}

// Перерисовать экран по текущему состоянию игры.
function render() {
  const app = document.getElementById('app');
  app.innerHTML = game.status === 'playing' ? playScreen() : endScreen();
}

// ---------- Кнопки ----------

// Один обработчик на весь экран: смотрим, какая кнопка нажата (data-action).
// Так не нужно заново вешать обработчики после каждой перерисовки.
document.getElementById('app').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-action]');
  if (!button || button.disabled) return;

  const action = button.dataset.action;
  if (action === 'repair') repairEnergy();
  if (action === 'next') nextRound();
  if (action === 'restart') {
    newGame();
    render();
  }
});

// ---------- Запуск ----------

// Одиночную игру запускает меню (lobby.js) — вызывает startSolo().
function startSolo() {
  newGame();
  render();
}
