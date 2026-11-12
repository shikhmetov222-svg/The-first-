// game.js — экран командной игры: ресурсы, роль и способность, событие, голосование, журнал.
// Только рисует то, что прислала база. Ничего не считает за базу и ничего не решает:
// серые кнопки и подсказки — лишь удобство, окончательно всё проверяет сервер.
// Подключается перед lobby.js, который даёт этому файлу данные и ловит нажатия кнопок.

(function () {
  'use strict';

  const TOTAL_ROUNDS = 8;

  // Роли: что умеют (те же правила, что в schema.sql, функция use_ability).
  const ROLE_INFO = {
    engineer: { icon: '🔧', name: 'Инженер',        perGame: false, desc: 'Раз в раунд: −1 запчасть, +2 энергии.' },
    doctor:   { icon: '🩺', name: 'Врач',           perGame: false, desc: 'Раз в раунд: останавливает эпидемию (штраф события отменяется), а в остальные раунды даёт +1 кислорода.' },
    botanist: { icon: '🌱', name: 'Повар-ботаник',  perGame: false, desc: 'Раз в раунд: −1 воды, +2 еды.' },
    pilot:    { icon: '🛰️', name: 'Пилот',          perGame: true,  desc: 'Раз за игру: показывает всем, какое событие будет в следующем раунде.' },
    radio:    { icon: '📡', name: 'Связист',        perGame: true,  desc: 'Раз за игру: отменяет вредный эффект события текущего раунда.' },
  };

  // События раунда. bad = вредит колонии (Связист может отменить такое).
  const EVENT_INFO = {
    dust_storm: { icon: '🌪️', name: 'Буря пыли',   effect: '−2 энергии',            bad: true },
    leak:       { icon: '💧', name: 'Утечка воды', effect: '−3 воды',               bad: true },
    epidemic:   { icon: '🤒', name: 'Эпидемия',    effect: '−1 еды и −1 кислорода', bad: true },
    meteorite:  { icon: '☄️', name: 'Метеорит',    effect: '−2 кислорода',          bad: true },
    find:       { icon: '📦', name: 'Находка',     effect: '+2 запчасти',           bad: false },
    quiet:      { icon: '🌙', name: 'Тихий день',  effect: 'ничего не случится',    bad: false },
  };

  // Основные действия. Порядок = приоритет при ничьей: вода → еда → ремонт.
  const ACTION_ORDER = ['water', 'food', 'repair'];
  const ACTION_INFO = {
    water:  { icon: '💧', name: 'Добыть воду из льда',        effect: '−2 энергии, +3 воды' },
    food:   { icon: '🥬', name: 'Вырастить еду в теплице',    effect: '−2 энергии, −1 воды, +3 еды' },
    repair: { icon: '🔧', name: 'Починить энергосистему',     effect: '−1 запчасть, +3 энергии' },
  };

  const DECIDED = {
    majority: 'решило большинство',
    tie: 'ничья — решил приоритет (вода → еда → ремонт)',
    default: 'никто не голосовал — действие по умолчанию',
    fallback: 'выбранное действие было невозможно — взято следующее',
    none: 'сделать было нечего — раунд без действия',
  };

  const RESOURCES = [
    ['oxygen', '🫁 Кислород'],
    ['water', '💧 Вода'],
    ['food', '🥫 Еда'],
    ['energy', '⚡ Энергия'],
    ['parts', '🔩 Запчасти'],
  ];
  const VITAL = ['oxygen', 'water', 'food']; // если закончатся — поражение

  // ---------- Подсказки: можно ли сейчас (проверяет и сервер) ----------

  // Можно ли основное действие при таких запасах.
  function actionProblem(room, action) {
    if (action === 'repair' && room.parts < 1) return 'нет запчастей';
    if (action === 'water' && room.energy < 2) return 'не хватает энергии (нужно 2)';
    if (action === 'food' && room.energy < 2) return 'не хватает энергии (нужно 2)';
    if (action === 'food' && room.water < 1) return 'нет воды';
    return '';
  }

  // Доступна ли мне способность; если нет — почему.
  function abilityState(me, room) {
    if (!me || !me.role) return { ok: false, reason: 'Роль ещё не выдана.' };
    if (room.status !== 'playing') return { ok: false, reason: 'Игра закончена.' };
    const role = me.role;
    if (ROLE_INFO[role].perGame) {
      if (me.ability_used_game) return { ok: false, reason: 'Уже потрачена: способность одноразовая.' };
    } else if (me.ability_used_round === room.round) {
      return { ok: false, reason: 'В этом раунде уже использована. Она вернётся в следующем.' };
    }
    const event = EVENT_INFO[room.current_event] || {};
    if (role === 'engineer' && room.parts < 1) return { ok: false, reason: 'Нет запчастей.' };
    if (role === 'botanist' && room.water < 1) return { ok: false, reason: 'Нет воды.' };
    if (role === 'pilot' && room.round >= TOTAL_ROUNDS) return { ok: false, reason: 'Это последний раунд: следующего события не будет.' };
    if (role === 'pilot' && room.next_event) return { ok: false, reason: 'Событие следующего раунда уже показано.' };
    if (role === 'radio' && !event.bad) return { ok: false, reason: 'Событие этого раунда не вредит: способность сохранена.' };
    if (role === 'radio' && room.event_cancelled) return { ok: false, reason: 'Штраф этого события уже отменён.' };
    return { ok: true, reason: '' };
  }

  // ---------- Таймер ----------

  function msLeft(room) {
    return room.vote_ends_at ? Date.parse(room.vote_ends_at) - Date.now() : 0;
  }

  function timerText(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  // ---------- Кусочки экрана ----------

  function nameOf(players, userId) {
    const p = players.find((x) => x.user_id === userId);
    return p ? p.name : 'кто-то';
  }

  function resourcesHtml(room) {
    return '<div class="resources">' + RESOURCES.map(([key, title]) => {
      const low = VITAL.includes(key) && room[key] <= 3;
      return `<div class="res ${low ? 'low' : ''}">
        <div class="hint">${title}</div>
        <div class="value">${room[key]}${low ? ' ⚠' : ''}</div>
      </div>`;
    }).join('') + '</div>';
  }

  function roleHtml(me, room) {
    const info = me && ROLE_INFO[me.role];
    if (!info) return '';
    // Игра закончилась — кнопка способности больше не нужна, остаётся только напоминание о роли.
    if (room.status !== 'playing') {
      return `<div class="card">
        <div class="card-title">${info.icon} Твоя роль: ${info.name}</div>
        <p class="hint">${info.desc}</p>
      </div>`;
    }
    const state = abilityState(me, room);
    const note = state.ok ? 'Сработает сразу, голосовать не нужно.' : state.reason;
    return `<div class="card">
      <div class="card-title">${info.icon} Твоя роль: ${info.name}</div>
      <p class="hint">${info.desc}</p>
      <div class="buttons">
        <button data-action="ability" data-ability="${me.role}" ${state.ok ? '' : 'disabled'}>✨ Использовать способность</button>
      </div>
      <p class="hint">${note}</p>
    </div>`;
  }

  function eventHtml(room) {
    const ev = EVENT_INFO[room.current_event];
    if (!ev) return '';
    const cancelled = room.event_cancelled && ev.bad;
    const next = EVENT_INFO[room.next_event];
    return `<div class="card ${ev.bad && !cancelled ? 'card-bad' : ''}">
      <div class="card-title">Событие раунда</div>
      <div class="event-name">${ev.icon} ${ev.name}: ${ev.effect}</div>
      ${cancelled ? '<p class="hint">✔ Штраф отменён способностью, на этот раунд событие не вредит.</p>' : ''}
      <p class="hint">Событие сработает в конце раунда вместе с расходом.</p>
      ${next ? `<p class="event-next">🛰️ Пилот видит: в следующем раунде — ${next.icon} ${next.name} (${next.effect}).</p>` : ''}
    </div>`;
  }

  // Голосование: одна карточка на действие. Первый проголосовавший «предложил» действие.
  function votingHtml(data) {
    const { room, votes, players } = data;
    const mine = votes.find((v) => v.user_id === data.myId);
    const cards = ACTION_ORDER.map((a) => {
      const info = ACTION_INFO[a];
      const forThis = votes.filter((v) => v.action === a).sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
      const problem = actionProblem(room, a);
      const mineThis = mine && mine.action === a;
      const who = forThis.length ? `Предложил: ${escapeHtml(nameOf(players, forThis[0].user_id))}` : 'Пока никто не предлагал';
      return `<div class="action ${mineThis ? 'mine' : ''}">
        <div class="card-title">${info.icon} ${info.name}</div>
        <p class="hint">${info.effect}</p>
        <p class="hint">Голосов: <strong>${forThis.length}</strong> · ${who}</p>
        ${problem ? `<p class="warn">⚠ Сейчас не получится: ${problem}</p>` : ''}
        <div class="buttons">
          <button data-action="vote" data-choice="${a}" class="${mineThis ? 'secondary' : ''}" ${room.status === 'playing' ? '' : 'disabled'}>
            ${mineThis ? '✓ Твой голос' : 'Голосовать'}</button>
        </div>
      </div>`;
    }).join('');
    return `<h2>Голосование</h2>
      <p class="hint">Выбери одно основное действие. Проходит то, за которое больше голосов; при ничьей — вода, затем еда, затем ремонт.
      Если никто не выбрал — «починить энергосистему». Передумать можно, пока идёт время.</p>
      ${cards}`;
  }

  function playersHtml(data) {
    const { room, players, votes } = data;
    const items = players.map((p) => {
      const info = ROLE_INFO[p.role];
      const voted = votes.some((v) => v.user_id === p.user_id);
      const badges =
        (p.user_id === room.host_id ? ' <span class="badge">хост</span>' : '') +
        (p.user_id === data.myId ? ' <span class="badge">ты</span>' : '');
      const state = room.status === 'playing' ? (voted ? '✓ проголосовал' : '… думает') : '';
      return `<li><span>${escapeHtml(p.name)}${badges}</span>
        <span class="hint">${info ? info.icon + ' ' + info.name : ''}${state ? ' · ' + state : ''}</span></li>`;
    }).join('');
    return `<h2>Команда</h2><ul class="players players-game">${items}</ul>`;
  }

  // Способности, которые уже использованы в текущем раунде.
  function usesHtml(data) {
    if (data.room.status !== 'playing' || !data.uses.length) return '';
    const items = data.uses.map((u) => `<li>${escapeHtml(nameOf(data.players, u.user_id))}: ${escapeHtml(u.note)}</li>`).join('');
    return `<h2>Способности в этом раунде</h2><ul class="log">${items}</ul>`;
  }

  function logHtml(data) {
    if (!data.log.length) return '';
    const items = data.log.map((r) => {
      const act = ACTION_INFO[r.action];
      const ev = EVENT_INFO[r.event];
      const counts = ACTION_ORDER.filter((a) => (r.vote_counts || {})[a])
        .map((a) => `${ACTION_INFO[a].name.split(' ')[0]} ${(r.vote_counts || {})[a]}`).join(', ');
      const abilities = (r.abilities || []).map((x) => escapeHtml(x.note)).join('; ');
      const stock = RESOURCES.map(([k, t]) => `${t.split(' ')[0]} ${r[k]}`).join(' · ');
      return `<li>
        <strong>Раунд ${r.round}:</strong> ${act ? act.icon + ' ' + act.name : 'без действия'}
        <span class="hint">(${DECIDED[r.decided_by] || r.decided_by}${counts ? '; голоса: ' + counts : ''})</span><br>
        Событие: ${ev ? ev.icon + ' ' + ev.name + ' (' + ev.effect + ')' : '—'}${r.event_cancelled && ev && ev.bad ? ' — <em>отменено</em>' : ''}<br>
        ${abilities ? 'Способности: ' + abilities + '<br>' : ''}
        <span class="hint">Итог: ${stock}</span>
      </li>`;
    }).join('');
    return `<h2>Журнал раундов</h2><ul class="log">${items}</ul>`;
  }

  function bannerHtml(room) {
    if (room.status === 'won') return `<div class="result win">🏆 Победа! Колония продержалась ${TOTAL_ROUNDS} раундов.</div>`;
    if (room.status === 'lost') {
      const dead = VITAL.filter((k) => room[k] <= 0).map((k) => RESOURCES.find((r) => r[0] === k)[1].toLowerCase()).join(', ');
      return `<div class="result lose">💀 Колония погибла. Закончилось: ${dead}.</div>`;
    }
    return '';
  }

  // ---------- Главная функция ----------
  // data = { room, players, votes, uses, log, myId }
  function html(data) {
    const room = data.room;
    if (typeof room.round !== 'number') {
      // База старой версии: колонии нет раундов. Подсказываем, что делать.
      return `<h1>Колония на Марсе</h1>
        <p class="warn">Игра началась, но в базе ещё старая версия схемы. Выполни обновлённый supabase/schema.sql в SQL Editor (см. README).</p>`;
    }
    const me = data.players.find((p) => p.user_id === data.myId);
    const playing = room.status === 'playing';
    const header = playing
      ? `<p class="hint">Раунд ${room.round} из ${TOTAL_ROUNDS} · осталось <strong id="timer" class="timer">${timerText(msLeft(room))}</strong></p>`
      : `<p class="hint">Игра окончена · раундов сыграно: ${data.log.length}</p>`;
    return `<h1>Колония на Марсе</h1>
      ${header}
      ${bannerHtml(room)}
      ${resourcesHtml(room)}
      ${roleHtml(me, room)}
      ${playing ? eventHtml(room) : ''}
      ${playing ? usesHtml(data) : ''}
      ${playing ? votingHtml(data) : ''}
      ${playersHtml(data)}
      ${logHtml(data)}`;
  }

  window.ColonyGame = { html, msLeft, timerText, abilityState };
})();
