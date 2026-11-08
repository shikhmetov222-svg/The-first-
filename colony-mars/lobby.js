// lobby.js — командная игра, шаг 1: меню, создание комнаты, вход по коду и лобби.
// Подключается ПОСЛЕ app.js: берёт оттуда tg, getPlayerName(), escapeHtml() и startSolo().
// Раунды, голосование и чат здесь пока не нужны — они появятся на следующих шагах.
//
// Как это устроено, простыми словами:
//   • Вся настоящая работа (создать комнату, войти, начать игру) — в базе, в функциях из supabase/schema.sql.
//     Здесь мы только вызываем их кнопками и показываем результат.
//   • Лобби читает комнату и список игроков обычными запросами.
//   • Realtime работает как звонок: когда в базе что-то поменялось, он «звонит», а мы заново читаем
//     комнату целиком. Так список игроков обновляется сам, без перезагрузки.

(function () {
  'use strict';

  const MIN_PLAYERS = 3; // сколько нужно, чтобы хост мог начать
  const MAX_PLAYERS = 6; // сколько мест в комнате (проверяет база)

  const appEl = document.getElementById('app');
  const cfg = window.COLONY_CONFIG || {};

  let sbClient = null;      // клиент Supabase
  let setupProblem = '';    // если не пусто — командная игра недоступна, и тут написано почему
  let myUserId = null;      // мой анонимный id (по нему определяем, кто я в списке игроков)
  let activeRoomId = null;  // комната, в которой я уже состою (если есть)
  let errorText = '';       // красное сообщение на экране
  let busy = false;         // true, пока идёт запрос: защита от двойного нажатия

  // Состояние лобби
  let lobbyRoomId = null;   // какая комната открыта сейчас
  let lobbyData = null;     // { room, players } — последнее, что прочитали из базы
  let lobbyChannel = null;  // подписка Realtime
  let linkState = '';       // 'connecting' | 'ok' | 'error' — есть ли связь с Realtime
  let reloading = false;    // идёт ли чтение лобби прямо сейчас
  let reloadAgain = false;  // пришёл ещё один «звонок», пока читали: прочитать ещё раз

  // ---------- Мелочи: Telegram, имя, ошибки ----------

  // Пользователь Telegram (в обычном браузере его нет — тогда null).
  function telegramUser() {
    return (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
  }

  function telegramId() {
    const user = telegramUser();
    return user && user.id ? user.id : null;
  }

  // Имя игрока. В Telegram — из профиля. В браузере его можно ввести в поле «Твоё имя»,
  // иначе в двух окнах оба игрока были бы «Колонист» и их не отличить.
  function myName() {
    if (telegramUser()) return getPlayerName();
    const input = document.getElementById('name');
    const typed = input ? input.value.trim() : '';
    if (typed) {
      try { localStorage.setItem('colony-name', typed); } catch (e) { /* без сохранения тоже работает */ }
      return typed;
    }
    return savedName() || 'Колонист';
  }

  function savedName() {
    try { return localStorage.getItem('colony-name') || ''; } catch (e) { return ''; }
  }

  // Поле имени показываем только вне Telegram.
  function nameFieldHtml() {
    if (telegramUser()) return '';
    return `<input id="name" class="field" maxlength="30" placeholder="Твоё имя"
              autocomplete="off" value="${escapeHtml(savedName())}">`;
  }

  // Текст ошибки для игрока. Ошибки правил игры из базы уже написаны по-русски.
  function readable(error) {
    const text = error && error.message ? error.message : '';
    if (!text || /failed to fetch|networkerror|load failed/i.test(text)) {
      return 'Нет связи с сервером. Проверь интернет и попробуй ещё раз.';
    }
    return text;
  }

  // Показать (или убрать) красное сообщение. Оно же запоминается, чтобы пережить перерисовку.
  function setError(text) {
    errorText = text || '';
    const el = document.getElementById('err');
    if (el) el.textContent = errorText;
  }

  function errorHtml() {
    return `<p class="error" id="err" role="alert">${escapeHtml(errorText)}</p>`;
  }

  // ---------- Подключение к Supabase ----------

  function isConfigured() {
    const url = String(cfg.supabaseUrl || '');
    const key = String(cfg.supabaseKey || '');
    return url.startsWith('https://') && !url.includes('YOUR_') && key !== '' && !key.includes('YOUR_');
  }

  // Каждый игрок входит в Supabase «анонимно»: ему выдаётся постоянный id.
  // Сам вход хранится в памяти браузера, поэтому после перезапуска id тот же.
  async function ensureLogin() {
    const { data } = await sbClient.auth.getSession();
    let session = data.session;
    if (!session) {
      const result = await sbClient.auth.signInAnonymously();
      if (result.error) throw result.error;
      session = result.data.session;
    }
    myUserId = session.user.id;
  }

  // «Где моя комната?» Сначала по анонимному входу, а если телефон его забыл — по telegram_id.
  async function findMyRoom() {
    const { data, error } = await sbClient.rpc('my_room', { p_telegram_id: telegramId() });
    if (error) throw error;
    return data || null;
  }

  async function setup() {
    if (!isConfigured()) {
      setupProblem = 'Командная игра пока не настроена: вставь адрес и ключ Supabase в config.js (см. README).';
      return;
    }
    if (!window.supabase) {
      setupProblem = 'Не загрузилась библиотека Supabase. Проверь интернет и обнови страницу.';
      return;
    }
    try {
      sbClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
      await ensureLogin();
      activeRoomId = await findMyRoom();
    } catch (e) {
      setupProblem = 'Не удалось войти в командную игру: ' + readable(e);
    }
  }

  // ---------- Экран: меню ----------

  function showMenu(message) {
    stopLobby();
    errorText = message || '';
    const ready = !setupProblem;
    const resume = activeRoomId && ready
      ? '<button data-action="resume">↩ Вернуться в колонию</button>'
      : '';
    appEl.innerHTML = `
      <h1>Колония на Марсе</h1>
      <p class="hint">Командир: ${escapeHtml(myName())}</p>
      ${nameFieldHtml()}
      <div class="buttons">
        ${resume}
        <button data-action="create" ${ready ? '' : 'disabled'}>👥 Создать игру</button>
        <button data-action="join-form" class="secondary" ${ready ? '' : 'disabled'}>🔑 Войти по коду</button>
        <button data-action="solo" class="secondary">🚀 Играть одному</button>
      </div>
      ${setupProblem ? `<p class="hint">${escapeHtml(setupProblem)}</p>` : ''}
      ${errorHtml()}`;
  }

  // ---------- Экран: вход по коду ----------

  function showJoinForm() {
    errorText = '';
    appEl.innerHTML = `
      <h1>Войти по коду</h1>
      <p class="hint">Спроси у хоста 6 цифр кода колонии.</p>
      ${nameFieldHtml()}
      <input id="code" class="field code-input" inputmode="numeric" autocomplete="off"
             maxlength="6" placeholder="000000" aria-label="Код колонии">
      <div class="buttons">
        <button data-action="join-submit">Войти</button>
        <button data-action="menu" class="link">← Назад</button>
      </div>
      ${errorHtml()}`;
    const input = document.getElementById('code');
    if (input) input.focus();
  }

  // ---------- Действия: создать, войти, начать ----------

  async function createGame() {
    const { data, error } = await sbClient.rpc('create_room', {
      p_name: myName(),
      p_telegram_id: telegramId(),
    });
    if (error) throw error;
    activeRoomId = data;
    await openLobby(data);
  }

  async function joinGame() {
    const code = (document.getElementById('code').value || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Код — это 6 цифр. Проверь, что ввёл всё.');
      return;
    }
    const { data, error } = await sbClient.rpc('join_room', {
      p_code: code,
      p_name: myName(),
      p_telegram_id: telegramId(),
    });
    if (error) throw error;
    activeRoomId = data;
    await openLobby(data);
  }

  async function startGame() {
    const { error } = await sbClient.rpc('start_game', { p_room_id: lobbyRoomId });
    if (error) throw error;
    await loadLobby(); // не ждём «звонка» Realtime: хост сразу видит результат
  }

  // ---------- Лобби ----------

  async function openLobby(roomId) {
    stopLobby();
    errorText = '';
    lobbyRoomId = roomId;
    lobbyData = null;
    linkState = 'connecting';
    drawLobby();
    startRealtime(roomId);
    await loadLobby();
  }

  // Подписка: «позвони, если в моей комнате изменился состав игроков или статус».
  function startRealtime(roomId) {
    lobbyChannel = sbClient
      .channel('lobby-' + roomId)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: 'room_id=eq.' + roomId },
        loadLobby)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + roomId },
        loadLobby)
      .subscribe((status) => {
        if (roomId !== lobbyRoomId) return;
        if (status === 'SUBSCRIBED') {
          linkState = 'ok';
          loadLobby(); // могли пропустить изменения, пока подключались
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          linkState = 'error';
          drawLobby();
        }
      });
  }

  function stopLobby() {
    if (lobbyChannel && sbClient) sbClient.removeChannel(lobbyChannel);
    lobbyChannel = null;
    lobbyRoomId = null;
    lobbyData = null;
  }

  // Прочитать комнату и игроков из базы и перерисовать экран.
  async function loadLobby() {
    if (!lobbyRoomId) return;
    if (reloading) { reloadAgain = true; return; } // уже читаем — потом прочитаем ещё раз
    reloading = true;
    const roomId = lobbyRoomId;
    try {
      const [rooms, players] = await Promise.all([
        sbClient.from('rooms').select('id, code, host_id, status').eq('id', roomId).maybeSingle(),
        sbClient.from('players').select('user_id, name, joined_at').eq('room_id', roomId).order('joined_at'),
      ]);
      if (roomId !== lobbyRoomId) return; // пока читали, игрок ушёл с экрана
      if (rooms.error) throw rooms.error;
      if (players.error) throw players.error;
      if (!rooms.data) {
        activeRoomId = null;
        showMenu('Эта колония недоступна: её удалили (комнаты живут сутки) или ты зашёл в неё с другого устройства.');
        return;
      }
      lobbyData = { room: rooms.data, players: players.data };
      setError('');
      drawLobby();
    } catch (e) {
      if (roomId === lobbyRoomId) { setError(readable(e)); drawLobby(); }
    } finally {
      reloading = false;
      if (reloadAgain) { reloadAgain = false; loadLobby(); }
    }
  }

  function linkHtml() {
    if (linkState === 'ok') return '<p class="hint">● Связь есть: список обновляется сам.</p>';
    if (linkState === 'error') return '<p class="hint">○ Связи нет: список может не обновляться. Обнови страницу.</p>';
    return '<p class="hint">Подключаюсь…</p>';
  }

  function playersHtml(players, hostId) {
    const items = players.map((p) => {
      const badges =
        (p.user_id === hostId ? ' <span class="badge">хост</span>' : '') +
        (p.user_id === myUserId ? ' <span class="badge">ты</span>' : '');
      return `<li>${escapeHtml(p.name)}${badges}</li>`;
    }).join('');
    return `<ul class="players">${items}</ul>`;
  }

  // Нижняя часть лобби: кнопка «Старт» (только хосту) или пояснение.
  function lobbyActionsHtml(room, players) {
    if (room.status !== 'lobby') {
      return `
        <div class="result win">🚀 Игра началась!</div>
        <p class="hint">Раунды и голосование появятся на следующем шаге.</p>`;
    }
    if (room.host_id === myUserId) {
      const enough = players.length >= MIN_PLAYERS;
      return `
        <div class="buttons">
          <button data-action="start" ${enough ? '' : 'disabled'}>▶ Старт</button>
        </div>
        <p class="hint">${enough
          ? 'Все в сборе? Нажми «Старт».'
          : `Для старта нужно минимум ${MIN_PLAYERS} игрока, сейчас ${players.length}.`}</p>`;
    }
    return '<p class="hint">Ждём, пока хост начнёт игру.</p>';
  }

  function drawLobby() {
    if (!lobbyRoomId) return;
    if (!lobbyData) {
      appEl.innerHTML = `<h1>Колония на Марсе</h1><p class="hint">Загружаю колонию…</p>${errorHtml()}`;
      return;
    }
    const { room, players } = lobbyData;
    const code = room.code.slice(0, 3) + ' ' + room.code.slice(3);
    appEl.innerHTML = `
      <h1>Колония на Марсе</h1>
      <p class="hint">Код колонии — назови его друзьям:</p>
      <div class="code-big" aria-label="Код колонии">${code}</div>
      <h2>Игроки: ${players.length} из ${MAX_PLAYERS}</h2>
      ${playersHtml(players, room.host_id)}
      ${lobbyActionsHtml(room, players)}
      ${errorHtml()}
      ${linkHtml()}
      <p class="hint">Приложение можно закрыть: ты останешься в колонии и вернёшься в неё при следующем запуске.</p>
      <div class="buttons"><button data-action="menu" class="link">← В меню</button></div>`;
  }

  // ---------- Кнопки ----------

  // Выполнить действие, показать ошибку, если она случилась, и не дать нажать дважды.
  async function guarded(action) {
    if (busy) return;
    busy = true;
    try {
      await action();
    } catch (e) {
      setError(readable(e));
    } finally {
      busy = false;
    }
  }

  const actions = {
    menu: () => showMenu(),
    solo: () => { stopLobby(); startSolo(); },
    create: () => guarded(createGame),
    'join-form': () => showJoinForm(),
    'join-submit': () => guarded(joinGame),
    resume: () => guarded(() => openLobby(activeRoomId)),
    start: () => guarded(startGame),
  };

  // Один обработчик на весь экран (как в app.js): смотрим на data-action нажатой кнопки.
  appEl.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = actions[button.dataset.action];
    if (action) action();
  });

  // В поле кода пропускаем только цифры; Enter = «Войти».
  appEl.addEventListener('input', (e) => {
    if (e.target.id === 'code') e.target.value = e.target.value.replace(/\D/g, '');
  });
  appEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'code') guarded(joinGame);
  });

  // Телефон «уснул» и проснулся: мог пропустить изменения — читаем лобби заново.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadLobby();
  });

  // ---------- Запуск ----------

  async function init() {
    appEl.innerHTML = '<p class="hint">Загрузка…</p>';
    await setup();
    if (activeRoomId) {
      openLobby(activeRoomId); // игрок закрыл приложение и вернулся: сразу в свою колонию
    } else {
      showMenu();
    }
  }

  init();
})();
