-- «Колония на Марсе»: этап 2, шаг 1 — комнаты и лобби.
--
-- Как загрузить: Supabase → SQL Editor → New query → вставить ВЕСЬ файл → Run.
-- Файл можно запускать повторно: ничего не сломается и данные не пропадут.
--
-- Главные правила:
--   1. Публичный ключ лежит в браузере, его видит кто угодно. Поэтому защита — в самой базе.
--   2. Из браузера можно только ЧИТАТЬ свою комнату. Писать в таблицы напрямую нельзя
--      (у таблиц нет ни одного правила на добавление, изменение и удаление).
--   3. Всё меняется только через функции: create_room, join_room, my_room, start_game.
--      Каждая функция сама проверяет, кто её вызвал и можно ли ему это.
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

-- Начать игру. Может только хост и только если в комнате не меньше 3 игроков.
create or replace function public.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room  public.rooms%rowtype;
  v_count int;
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

  update public.rooms set status = 'playing' where id = p_room_id;
end;
$$;

-- Кто может вызывать функции: только вошедшие игроки (authenticated).
-- is_room_member вызывают правила чтения, ей права на вызов из браузера тоже нужны.
revoke execute on function public.is_room_member(uuid)                  from public, anon;
revoke execute on function public.create_room(text, bigint)             from public, anon;
revoke execute on function public.join_room(text, text, bigint)         from public, anon;
revoke execute on function public.my_room(bigint)                       from public, anon;
revoke execute on function public.start_game(uuid)                      from public, anon;
grant  execute on function public.is_room_member(uuid)                  to authenticated;
grant  execute on function public.create_room(text, bigint)             to authenticated;
grant  execute on function public.join_room(text, text, bigint)         to authenticated;
grant  execute on function public.my_room(bigint)                       to authenticated;
grant  execute on function public.start_game(uuid)                      to authenticated;

-- ============================================================
-- Realtime: рассылать изменения этих таблиц подписчикам
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;
