-- «Колония на Марсе»: этап 2 — комнаты, лобби, раунды, голосование, события и роли.
--
-- Как загрузить: Supabase → SQL Editor → New query → вставить ВЕСЬ файл → Run.
-- Файл можно запускать повторно: ничего не сломается и данные не пропадут.
--
-- Главные правила:
--   1. Публичный ключ лежит в браузере, его видит кто угодно. Поэтому защита — в самой базе.
--   2. Из браузера можно только ЧИТАТЬ свою комнату. Писать в таблицы напрямую нельзя
--      (у таблиц нет ни одного правила на добавление, изменение и удаление).
--   3. Всё меняется только через функции: create_room, join_room, my_room, start_game,
--      cast_vote, use_ability, close_vote. Каждая функция сама проверяет, кто её вызвал и можно ли ему это.
--      Ресурсы, события и роли не может изменить никто, кроме этих функций.
--   4. Кто вызывает — база узнаёт по анонимному входу (auth.uid()), а не по тому, что прислал браузер.

-- ============================================================
-- Таблицы
-- ============================================================

-- Комнаты (одна комната = одна колония).
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[0-9]{6}$'),   -- 6 цифр для входа
  host_id    uuid not null,                                      -- кто хост (auth.uid())
  status     text not null default 'lobby'
             check (status in ('lobby', 'playing', 'won', 'lost')),
  created_at timestamptz not null default now()
);

-- Игроки в комнате.
create table if not exists public.players (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null,                                       -- id анонимного входа
  name      text not null,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- Telegram-id игроков лежит ОТДЕЛЬНО и никому не виден из браузера.
-- Зачем отдельно: Realtime рассылает строки таблицы целиком всем в комнате.
-- Если бы telegram_id лежал в players, любой участник мог бы его прочитать и
-- с его помощью занять чужое место (так работает «возврат по telegram_id»).
create table if not exists public.player_identities (
  room_id     uuid not null,
  user_id     uuid not null,
  telegram_id bigint not null,
  primary key (room_id, user_id),
  foreign key (room_id, user_id) references public.players(room_id, user_id)
    on delete cascade on update cascade
);
create index if not exists player_identities_telegram_idx on public.player_identities (telegram_id);

create index if not exists players_user_idx on public.players (user_id);

-- ============================================================
-- Права и Row Level Security (RLS)
-- ============================================================

alter table public.rooms             enable row level security;
alter table public.players           enable row level security;
alter table public.player_identities enable row level security;

-- Сначала забираем все права у «прохожих» (anon) и у вошедших игроков (authenticated)...
revoke all on public.rooms, public.players, public.player_identities from anon, authenticated;
-- ...и возвращаем только чтение двух таблиц. Для player_identities прав нет совсем.
grant select on public.rooms, public.players to authenticated;

-- «Я участник этой комнаты?» Функция нужна правилам ниже.
-- security definer — чтобы правило для players не ссылалось на само себя.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.players p
    where p.room_id = p_room_id and p.user_id = auth.uid()
  );
$$;

-- Правила чтения: видна только своя комната и её игроки.
-- (Имена правил — латиницей: у Postgres лимит 63 байта, а русские буквы занимают по 2.)
drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member on public.rooms
  for select to authenticated
  using (public.is_room_member(id));

drop policy if exists players_select_member on public.players;
create policy players_select_member on public.players
  for select to authenticated
  using (public.is_room_member(room_id));

-- Правил на INSERT / UPDATE / DELETE нет НАМЕРЕННО: прямая запись запрещена.
-- У player_identities нет никаких правил: из браузера её не прочитать никому.

-- ============================================================
-- Функции
-- ============================================================

-- Комната живёт сутки. Старше — считается удалённой (и стирается при создании новой комнаты).

-- Создать комнату. Возвращает id комнаты; код и список игроков клиент читает обычным select.
create or replace function public.create_room(p_name text, p_telegram_id bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := left(coalesce(nullif(btrim(p_name), ''), 'Колонист'), 30);
  v_code text;
  v_room uuid;
  v_try  int := 0;
begin
  if v_uid is null then
    raise exception 'Сначала нужно войти в игру. Обнови страницу.';
  end if;

  -- Заодно убираем старые комнаты (вместе с игроками).
  delete from public.rooms where created_at < now() - interval '1 day';

  -- Придумываем свободный 6-значный код. Если занят — пробуем другой.
  loop
    v_try := v_try + 1;
    v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
    begin
      insert into public.rooms (code, host_id) values (v_code, v_uid) returning id into v_room;
      exit;
    exception when unique_violation then
      if v_try >= 20 then
        raise exception 'Не получилось придумать код комнаты. Попробуй ещё раз.';
      end if;
    end;
  end loop;

  insert into public.players (room_id, user_id, name) values (v_room, v_uid, v_name);
  if p_telegram_id is not null then
    insert into public.player_identities (room_id, user_id, telegram_id) values (v_room, v_uid, p_telegram_id);
  end if;

  return v_room;
end;
$$;

-- Войти в комнату по коду. Возвращает id комнаты.
create or replace function public.join_room(p_code text, p_name text, p_telegram_id bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := left(coalesce(nullif(btrim(p_name), ''), 'Колонист'), 30);
  v_room  public.rooms%rowtype;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Сначала нужно войти в игру. Обнови страницу.';
  end if;

  -- Блокируем комнату, чтобы двое, вошедшие одновременно, не заняли последнее место вдвоём.
  select * into v_room from public.rooms
   where code = btrim(p_code) and created_at > now() - interval '1 day'
   for update;
  if not found then
    raise exception 'Колония с таким кодом не найдена. Проверь цифры.';
  end if;

  -- Уже в этой комнате (например, нажал «Войти» второй раз) — просто возвращаем.
  if exists (select 1 from public.players where room_id = v_room.id and user_id = v_uid) then
    return v_room.id;
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'Эта игра уже началась. Новых игроков не пускаем.';
  end if;

  select count(*) into v_count from public.players where room_id = v_room.id;
  if v_count >= 6 then
    raise exception 'В колонии уже 6 человек: больше мест нет.';
  end if;

  insert into public.players (room_id, user_id, name) values (v_room.id, v_uid, v_name);
  if p_telegram_id is not null then
    insert into public.player_identities (room_id, user_id, telegram_id) values (v_room.id, v_uid, p_telegram_id);
  end if;

  return v_room.id;
end;
$$;

-- «Где моя комната?» Вызывается при запуске приложения.
-- 1) Ищем по анонимному входу (он сохранён в телефоне).
-- 2) Если не нашли, а telegram_id передан — ищем по нему (телефон мог забыть вход)
--    и привязываем комнату к новому входу.
-- Возвращает id комнаты или null, если игрока нигде нет.
create or replace function public.my_room(p_telegram_id bigint default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_room    uuid;
  v_old_uid uuid;
begin
  if v_uid is null then
    return null;
  end if;

  -- 1) По анонимному входу: самая свежая живая комната.
  select r.id into v_room
    from public.players p
    join public.rooms r on r.id = p.room_id
   where p.user_id = v_uid
     and r.status in ('lobby', 'playing')
     and r.created_at > now() - interval '1 day'
   order by p.joined_at desc
   limit 1;
  if found then
    return v_room;
  end if;

  if p_telegram_id is null then
    return null;
  end if;

  -- 2) По telegram_id.
  select i.room_id, i.user_id into v_room, v_old_uid
    from public.player_identities i
    join public.players p on p.room_id = i.room_id and p.user_id = i.user_id
    join public.rooms r on r.id = i.room_id
   where i.telegram_id = p_telegram_id
     and r.status in ('lobby', 'playing')
     and r.created_at > now() - interval '1 day'
   order by p.joined_at desc
   limit 1;
  if not found then
    return null;
  end if;

  -- Переносим место на новый вход. Блокируем комнату, потом игрока.
  perform 1 from public.rooms where id = v_room for update;
  -- player_identities обновится сама (on update cascade).
  update public.players set user_id = v_uid where room_id = v_room and user_id = v_old_uid;
  update public.rooms   set host_id = v_uid where id = v_room and host_id = v_old_uid;

  return v_room;
end;
$$;

-- ============================================================
-- Раунды, голосование, события и роли
-- ============================================================

-- Новые поля комнаты. «add column if not exists» — чтобы файл можно было запускать
-- и на пустой базе, и на базе, где уже есть лобби из первого шага.
alter table public.rooms add column if not exists round           int         not null default 0;   -- номер раунда, 0 = игра не началась
alter table public.rooms add column if not exists oxygen          int         not null default 0;   -- ресурсы колонии
alter table public.rooms add column if not exists water           int         not null default 0;
alter table public.rooms add column if not exists food            int         not null default 0;
alter table public.rooms add column if not exists energy          int         not null default 0;
alter table public.rooms add column if not exists parts           int         not null default 0;
alter table public.rooms add column if not exists vote_ends_at    timestamptz;                      -- когда закрывается голосование
alter table public.rooms add column if not exists event_cancelled boolean     not null default false; -- отменили ли штраф события
alter table public.rooms add column if not exists current_event   text
  check (current_event in ('dust_storm', 'leak', 'epidemic', 'meteorite', 'find', 'quiet'));
-- next_event заполняется только когда Пилот показал событие следующего раунда.
-- Настоящее следующее событие лежит в room_secrets, которую из браузера не прочитать.
alter table public.rooms add column if not exists next_event      text
  check (next_event in ('dust_storm', 'leak', 'epidemic', 'meteorite', 'find', 'quiet'));

-- Новые поля игрока: роль и учёт способности.
alter table public.players add column if not exists role               text
  check (role in ('engineer', 'doctor', 'botanist', 'pilot', 'radio'));
alter table public.players add column if not exists ability_used_round int     not null default 0;     -- в каком раунде использована (для способностей «раз в раунд»)
alter table public.players add column if not exists ability_used_game  boolean not null default false; -- использована ли за игру (для «раз за игру»)

-- Голоса. Один голос на игрока за раунд; переголосовать можно.
-- on update cascade — чтобы возврат по telegram_id (смена user_id) ничего не ломал.
create table if not exists public.votes (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  round      int  not null,
  user_id    uuid not null,
  action     text not null check (action in ('repair', 'water', 'food')),
  created_at timestamptz not null default now(),   -- кто проголосовал за действие первым, тот его «предложил»
  primary key (room_id, round, user_id),
  foreign key (room_id, user_id) references public.players(room_id, user_id)
    on delete cascade on update cascade
);

-- Использованные способности (для журнала).
create table if not exists public.ability_uses (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  round      int  not null,
  user_id    uuid not null,
  role       text not null,
  note       text not null,                         -- что произошло, готовой фразой
  created_at timestamptz not null default now(),
  foreign key (room_id, user_id) references public.players(room_id, user_id)
    on delete cascade on update cascade
);
create index if not exists ability_uses_room_round_idx on public.ability_uses (room_id, round);

-- Журнал раундов: итог каждого закрытого раунда.
create table if not exists public.round_log (
  room_id         uuid not null references public.rooms(id) on delete cascade,
  round           int  not null,
  action          text,                                  -- какое действие прошло (пусто = раунд без действия)
  decided_by      text not null,                         -- majority / tie / default / fallback / none
  vote_counts     jsonb not null default '{}'::jsonb,    -- например {"water": 2, "repair": 1}
  event           text,
  event_cancelled boolean not null default false,
  abilities       jsonb not null default '[]'::jsonb,    -- способности, использованные в раунде
  oxygen          int not null,                          -- ресурсы после раунда
  water           int not null,
  food            int not null,
  energy          int not null,
  parts           int not null,
  created_at      timestamptz not null default now(),
  primary key (room_id, round)
);

-- Тайна: событие следующего раунда. Из браузера не читается никем.
create table if not exists public.room_secrets (
  room_id    uuid primary key references public.rooms(id) on delete cascade,
  next_event text
);

alter table public.votes        enable row level security;
alter table public.ability_uses enable row level security;
alter table public.round_log    enable row level security;
alter table public.room_secrets enable row level security;

revoke all on public.votes, public.ability_uses, public.round_log, public.room_secrets from anon, authenticated;
-- Только чтение (и только своей комнаты). Писать напрямую нельзя: правил на запись нет.
grant select on public.votes, public.ability_uses, public.round_log to authenticated;

drop policy if exists votes_select_member on public.votes;
create policy votes_select_member on public.votes
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists ability_uses_select_member on public.ability_uses;
create policy ability_uses_select_member on public.ability_uses
  for select to authenticated using (public.is_room_member(room_id));

drop policy if exists round_log_select_member on public.round_log;
create policy round_log_select_member on public.round_log
  for select to authenticated using (public.is_room_member(room_id));
-- У room_secrets правил нет совсем: прочитать её нельзя.

-- ---------- Вспомогательные функции (из браузера не вызываются) ----------

-- Случайное событие: каждое из шести с одинаковым шансом.
create or replace function public.pick_event()
returns text
language sql
volatile
set search_path = ''
as $$
  select (array['dust_storm', 'leak', 'epidemic', 'meteorite', 'find', 'quiet'])[1 + floor(random() * 6)::int];
$$;

-- Название события для журнала.
create or replace function public.event_name(p_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_event
    when 'dust_storm' then 'буря пыли (−2 энергии)'
    when 'leak'       then 'утечка воды (−3 воды)'
    when 'epidemic'   then 'эпидемия (−1 еды и −1 кислорода)'
    when 'meteorite'  then 'метеорит (−2 кислорода)'
    when 'find'       then 'находка (+2 запчасти)'
    when 'quiet'      then 'тихий день (ничего)'
    else 'неизвестное событие'
  end;
$$;

-- ---------- Начать игру ----------
-- Только хост и только от 3 игроков. Раздаёт роли, ставит стартовые запасы,
-- выбирает событие первого раунда и запускает таймер голосования на 60 секунд.
create or replace function public.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room   public.rooms%rowtype;
  v_count  int;
  v_i      int := 0;
  v_player record;
  -- Роли по порядку. Если игроков меньше пяти, берутся первые роли списка.
  v_roles  text[] := array['engineer', 'doctor', 'botanist', 'pilot', 'radio'];
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Колония не найдена.';
  end if;
  if v_room.host_id is distinct from auth.uid() then
    raise exception 'Начать игру может только хост.';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'Игра уже началась.';
  end if;

  select count(*) into v_count from public.players where room_id = p_room_id;
  if v_count < 3 then
    raise exception 'Для старта нужно минимум 3 игрока. Сейчас: %.', v_count;
  end if;

  -- Игроков перебираем в случайном порядке, поэтому роли раздаются случайно.
  -- Шестой игрок (ролей всего пять) получает случайную роль из пяти.
  for v_player in
    select user_id from public.players where room_id = p_room_id order by random()
  loop
    v_i := v_i + 1;
    update public.players
       set role = case when v_i <= 5 then v_roles[v_i] else v_roles[1 + floor(random() * 5)::int] end,
           ability_used_round = 0,
           ability_used_game = false
     where room_id = p_room_id and user_id = v_player.user_id;
  end loop;

  update public.rooms
     set status = 'playing',
         round = 1,
         oxygen = 15, water = 11, food = 11, energy = 10, parts = 4,   -- стартовые запасы
         vote_ends_at = now() + interval '60 seconds',
         current_event = public.pick_event(),
         next_event = null,
         event_cancelled = false
   where id = p_room_id;

  insert into public.room_secrets (room_id, next_event) values (p_room_id, public.pick_event())
  on conflict (room_id) do update set next_event = excluded.next_event;
end;
$$;

-- ---------- Конец раунда ----------
-- Вызывается только другими функциями (голосование закончено или время вышло).
-- Порядок: выбираем действие → применяем его → расход → событие → проверка победы и поражения.
create or replace function public.resolve_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room      public.rooms%rowtype;
  v_ox        int;
  v_wa        int;
  v_fo        int;
  v_en        int;
  v_pa        int;
  v_total     int;
  v_max       int;
  v_ties      int;
  v_counts    jsonb;
  v_c         record;
  v_ok        boolean;
  v_action    text;
  v_cnt       int;
  v_decided   text;
  v_abilities jsonb;
  v_status    text;
  v_next      text;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or v_room.status <> 'playing' then
    return;
  end if;

  v_ox := v_room.oxygen;  v_wa := v_room.water;  v_fo := v_room.food;
  v_en := v_room.energy;  v_pa := v_room.parts;

  -- 1. Голоса этого раунда.
  select coalesce(jsonb_object_agg(action, n), '{}'::jsonb), coalesce(sum(n), 0)::int, coalesce(max(n), 0)
    into v_counts, v_total, v_max
    from (select action, count(*)::int as n
            from public.votes
           where room_id = p_room_id and round = v_room.round
           group by action) s;
  select count(*) into v_ties
    from jsonb_each_text(v_counts) where value::int = v_max and v_max > 0;

  -- 2. Выбираем действие. Сначала больше голосов, при ничьей — приоритет:
  --    вода (выживание) → теплица (еда) → ремонт (энергия).
  --    Если никто не голосовал — «починить». Невозможное действие пропускаем.
  v_action := null;
  v_cnt := 0;
  for v_c in
    select a.action,
           coalesce((v_counts ->> a.action)::int, 0) as cnt,
           a.prio
      from (values ('water', 1), ('food', 2), ('repair', 3)) as a(action, prio)
     where v_total > 0 or a.action = 'repair'
     order by coalesce((v_counts ->> a.action)::int, 0) desc, a.prio
  loop
    v_ok := case v_c.action
              when 'repair' then v_pa >= 1
              when 'water'  then v_en >= 2
              else               v_en >= 2 and v_wa >= 1
            end;
    if v_ok then
      v_action := v_c.action;
      v_cnt := v_c.cnt;
      exit;
    end if;
  end loop;

  v_decided := case
    when v_action is null then 'none'          -- сделать нечего
    when v_total = 0      then 'default'       -- никто не голосовал
    when v_cnt = v_max and v_ties > 1 then 'tie'
    when v_cnt = v_max    then 'majority'
    else 'fallback'                            -- любимое действие было невозможно
  end;

  -- 3. Применяем действие.
  if v_action = 'repair' then
    v_pa := v_pa - 1;  v_en := v_en + 3;
  elsif v_action = 'water' then
    v_en := v_en - 2;  v_wa := v_wa + 3;
  elsif v_action = 'food' then
    v_en := v_en - 2;  v_wa := v_wa - 1;  v_fo := v_fo + 3;
  end if;

  -- 4. Расход раунда. Если энергии нет, кислород падает на 2 вместо 1.
  if v_en >= 1 then
    v_ox := v_ox - 1;  v_en := v_en - 1;
  else
    v_ox := v_ox - 2;
  end if;
  v_wa := v_wa - 1;
  v_fo := v_fo - 1;

  -- 5. Событие раунда (если штраф не отменили способностью).
  if not v_room.event_cancelled then
    if v_room.current_event = 'dust_storm' then
      v_en := v_en - 2;
    elsif v_room.current_event = 'leak' then
      v_wa := v_wa - 3;
    elsif v_room.current_event = 'epidemic' then
      v_fo := v_fo - 1;  v_ox := v_ox - 1;
    elsif v_room.current_event = 'meteorite' then
      v_ox := v_ox - 2;
    elsif v_room.current_event = 'find' then
      v_pa := v_pa + 2;
    end if;
  end if;

  -- Ресурсы не уходят ниже нуля.
  v_ox := greatest(v_ox, 0);  v_wa := greatest(v_wa, 0);  v_fo := greatest(v_fo, 0);
  v_en := greatest(v_en, 0);  v_pa := greatest(v_pa, 0);

  -- 6. Запись в журнал раундов.
  select coalesce(jsonb_agg(jsonb_build_object('role', role, 'note', note) order by id), '[]'::jsonb)
    into v_abilities
    from public.ability_uses
   where room_id = p_room_id and round = v_room.round;

  insert into public.round_log
    (room_id, round, action, decided_by, vote_counts, event, event_cancelled, abilities,
     oxygen, water, food, energy, parts)
  values
    (p_room_id, v_room.round, v_action, v_decided, v_counts, v_room.current_event, v_room.event_cancelled,
     v_abilities, v_ox, v_wa, v_fo, v_en, v_pa);

  -- 7. Победа, поражение или следующий раунд.
  if v_ox <= 0 or v_wa <= 0 or v_fo <= 0 then
    v_status := 'lost';
  elsif v_room.round >= 8 then
    v_status := 'won';
  else
    v_status := 'playing';
  end if;

  if v_status = 'playing' then
    -- Событие следующего раунда берём из тайника и тут же выбираем новое.
    select next_event into v_next from public.room_secrets where room_id = p_room_id;
    update public.rooms
       set round = round + 1,
           oxygen = v_ox, water = v_wa, food = v_fo, energy = v_en, parts = v_pa,
           vote_ends_at = now() + interval '60 seconds',
           current_event = coalesce(v_next, public.pick_event()),
           next_event = null,
           event_cancelled = false
     where id = p_room_id;
    insert into public.room_secrets (room_id, next_event) values (p_room_id, public.pick_event())
    on conflict (room_id) do update set next_event = excluded.next_event;
  else
    update public.rooms
       set status = v_status,
           oxygen = v_ox, water = v_wa, food = v_fo, energy = v_en, parts = v_pa,
           vote_ends_at = null,
           next_event = null
     where id = p_room_id;
  end if;
end;
$$;

-- ---------- Голосование ----------
-- Предложить действие или поддержать чужое. Один голос на игрока; можно передумать.
-- Когда проголосовали все, раунд закрывается сразу.
create or replace function public.cast_vote(p_room_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_room    public.rooms%rowtype;
  v_players int;
  v_votes   int;
begin
  if v_uid is null then
    raise exception 'Сначала нужно войти в игру. Обнови страницу.';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Колония не найдена.';
  end if;
  if not exists (select 1 from public.players where room_id = p_room_id and user_id = v_uid) then
    raise exception 'Ты не состоишь в этой колонии.';
  end if;
  if v_room.status <> 'playing' then
    raise exception 'Игра сейчас не идёт.';
  end if;
  if p_action not in ('repair', 'water', 'food') then
    raise exception 'Неизвестное действие.';
  end if;
  if now() >= v_room.vote_ends_at then
    raise exception 'Время голосования вышло. Дождись следующего раунда.';
  end if;

  insert into public.votes (room_id, round, user_id, action)
  values (p_room_id, v_room.round, v_uid, p_action)
  on conflict (room_id, round, user_id)
  do update set action = excluded.action, created_at = now()
  where public.votes.action <> excluded.action;

  select count(*) into v_players from public.players where room_id = p_room_id;
  select count(*) into v_votes from public.votes where room_id = p_room_id and round = v_room.round;
  if v_votes >= v_players then
    perform public.resolve_round(p_room_id);
  end if;
end;
$$;

-- ---------- Способности ролей ----------
-- Применяются сразу, до закрытия раунда, и не требуют голосования.
create or replace function public.use_ability(p_room_id uuid, p_ability text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_room     public.rooms%rowtype;
  v_player   public.players%rowtype;
  v_note     text;
  v_secret   text;
  v_per_game boolean;
begin
  if v_uid is null then
    raise exception 'Сначала нужно войти в игру. Обнови страницу.';
  end if;

  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    raise exception 'Колония не найдена.';
  end if;
  select * into v_player from public.players where room_id = p_room_id and user_id = v_uid for update;
  if not found then
    raise exception 'Ты не состоишь в этой колонии.';
  end if;
  if v_room.status <> 'playing' then
    raise exception 'Игра сейчас не идёт.';
  end if;
  if now() >= v_room.vote_ends_at then
    raise exception 'Время раунда вышло. Дождись следующего раунда.';
  end if;
  if v_player.role is null or v_player.role is distinct from p_ability then
    raise exception 'Эта способность не твоей роли.';
  end if;

  -- Пилот и Связист: один раз за игру. Остальные: один раз за раунд.
  v_per_game := p_ability in ('pilot', 'radio');
  if v_per_game then
    if v_player.ability_used_game then
      raise exception 'Способность уже потрачена: её можно использовать один раз за игру.';
    end if;
  elsif v_player.ability_used_round = v_room.round then
    raise exception 'В этом раунде способность уже использована. Подожди следующего раунда.';
  end if;

  if p_ability = 'engineer' then
    if v_room.parts < 1 then
      raise exception 'Нет запчастей: Инженеру нечего чинить.';
    end if;
    update public.rooms set parts = parts - 1, energy = energy + 2 where id = p_room_id;
    v_note := 'Инженер: −1 запчасть, +2 энергии';

  elsif p_ability = 'botanist' then
    if v_room.water < 1 then
      raise exception 'Нет воды: Повару-ботанику нечем поливать.';
    end if;
    update public.rooms set water = water - 1, food = food + 2 where id = p_room_id;
    v_note := 'Повар-ботаник: −1 воды, +2 еды';

  elsif p_ability = 'doctor' then
    if v_room.current_event = 'epidemic' and not v_room.event_cancelled then
      update public.rooms set event_cancelled = true where id = p_room_id;
      v_note := 'Врач: остановил эпидемию, штраф события отменён';
    else
      update public.rooms set oxygen = oxygen + 1 where id = p_room_id;
      v_note := 'Врач: +1 кислорода';
    end if;

  elsif p_ability = 'pilot' then
    if v_room.round >= 8 then
      raise exception 'Это последний раунд: следующего события не будет.';
    end if;
    if v_room.next_event is not null then
      raise exception 'Событие следующего раунда уже показано.';
    end if;
    select next_event into v_secret from public.room_secrets where room_id = p_room_id;
    update public.rooms set next_event = v_secret where id = p_room_id;
    v_note := 'Пилот: разведка показала, что дальше — ' || public.event_name(v_secret);

  elsif p_ability = 'radio' then
    if v_room.current_event not in ('dust_storm', 'leak', 'epidemic', 'meteorite') then
      raise exception 'Событие этого раунда не вредит колонии. Способность сохранена.';
    end if;
    if v_room.event_cancelled then
      raise exception 'Штраф этого события уже отменён. Способность сохранена.';
    end if;
    update public.rooms set event_cancelled = true where id = p_room_id;
    v_note := 'Связист: отменил штраф события — ' || public.event_name(v_room.current_event);

  else
    raise exception 'Неизвестная способность.';
  end if;

  if v_per_game then
    update public.players set ability_used_game = true where room_id = p_room_id and user_id = v_uid;
  else
    update public.players set ability_used_round = v_room.round where room_id = p_room_id and user_id = v_uid;
  end if;

  insert into public.ability_uses (room_id, round, user_id, role, note)
  values (p_room_id, v_room.round, v_uid, p_ability, v_note);
end;
$$;

-- ---------- Закрыть голосование, если время вышло ----------
-- Таймер на экране дошёл до нуля — клиент просит закрыть раунд.
-- Раньше времени закрыть нельзя: время проверяет сама база.
create or replace function public.close_vote(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Сначала нужно войти в игру. Обнови страницу.';
  end if;
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found or not exists (select 1 from public.players where room_id = p_room_id and user_id = auth.uid()) then
    raise exception 'Ты не состоишь в этой колонии.';
  end if;
  if v_room.status = 'playing' and now() >= v_room.vote_ends_at then
    perform public.resolve_round(p_room_id);
    return true;
  end if;
  return false;
end;
$$;

-- То же, но для всех комнат сразу: запускается по расписанию (pg_cron),
-- поэтому раунды идут, даже если у всех игроков выключены телефоны.
create or replace function public.close_expired_votes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.rooms where status = 'playing' and vote_ends_at <= now() order by id
  loop
    -- Блокируем комнату и проверяем ещё раз: её могли закрыть за это время.
    perform 1 from public.rooms
     where id = v_id and status = 'playing' and vote_ends_at <= now()
     for update skip locked;
    if found then
      perform public.resolve_round(v_id);
    end if;
  end loop;
end;
$$;

-- ============================================================
-- Права на функции
-- ============================================================
-- Из браузера (вошедшим игрокам) доступны только эти функции.
revoke execute on function public.is_room_member(uuid)                  from public, anon;
revoke execute on function public.create_room(text, bigint)             from public, anon;
revoke execute on function public.join_room(text, text, bigint)         from public, anon;
revoke execute on function public.my_room(bigint)                       from public, anon;
revoke execute on function public.start_game(uuid)                      from public, anon;
revoke execute on function public.cast_vote(uuid, text)                 from public, anon;
revoke execute on function public.use_ability(uuid, text)               from public, anon;
revoke execute on function public.close_vote(uuid)                      from public, anon;
grant  execute on function public.is_room_member(uuid)                  to authenticated;
grant  execute on function public.create_room(text, bigint)             to authenticated;
grant  execute on function public.join_room(text, text, bigint)         to authenticated;
grant  execute on function public.my_room(bigint)                       to authenticated;
grant  execute on function public.start_game(uuid)                      to authenticated;
grant  execute on function public.cast_vote(uuid, text)                 to authenticated;
grant  execute on function public.use_ability(uuid, text)               to authenticated;
grant  execute on function public.close_vote(uuid)                      to authenticated;

-- Внутренние функции не вызывает никто снаружи.
revoke execute on function public.resolve_round(uuid)        from public, anon, authenticated;
revoke execute on function public.close_expired_votes()      from public, anon, authenticated;
revoke execute on function public.pick_event()               from public, anon, authenticated;
revoke execute on function public.event_name(text)           from public, anon, authenticated;

-- ============================================================
-- Realtime: рассылать изменения этих таблиц подписчикам
-- ============================================================
do $$
declare
  v_table text;
begin
  foreach v_table in array array['rooms', 'players', 'votes', 'ability_uses', 'round_log'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

-- ============================================================
-- Таймер: закрывать просроченные голосования каждые 10 секунд (pg_cron)
-- ============================================================
-- Если pg_cron недоступен, файл всё равно загрузится. Тогда раунд закрывается,
-- когда таймер доходит до нуля на экране любого игрока (функция close_vote).
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('colony-close-votes', '10 seconds', 'select public.close_expired_votes()');
exception when others then
  raise notice 'pg_cron не включён (%): раунды будут закрываться со стороны игроков.', sqlerrm;
end $$;
