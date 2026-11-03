-- =====================================================================
-- Бот онлайн-записи к мастерам. Отдельная схема booking.
-- Один код и одна база на всех мастеров, у каждого мастера свой бот.
-- =====================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists booking;
revoke all on schema booking from public, anon, authenticated;

-- ---------- Настройки ----------
create table booking.config (
  key   text primary key,
  value text not null
);

-- ---------- Мастера ----------
create table booking.masters (
  id                    bigint generated always as identity primary key,
  slug                  text not null unique check (slug ~ '^[a-z0-9_-]{2,32}$'),
  name                  text not null,
  title                 text not null default 'маникюр',
  greeting              text,
  address               text,
  admin_tg_id           bigint not null,
  tz                    text not null default 'Europe/Moscow',
  slot_step_min         int  not null default 30 check (slot_step_min between 5 and 120),
  booking_days          int  not null default 14 check (booking_days between 1 and 60),
  min_lead_min          int  not null default 60 check (min_lead_min >= 0),
  max_active_per_client int  not null default 3 check (max_active_per_client >= 1),
  dry_run               boolean not null default false, -- тестовый режим: сообщения не уходят в Telegram, а пишутся в test_log
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- Токены отдельно: таблица закрыта, в коде токенов нет.
create table booking.master_secrets (
  master_id      bigint primary key references booking.masters(id) on delete cascade,
  bot_token      text not null,
  webhook_secret text not null default encode(extensions.gen_random_bytes(24), 'hex')
);

-- ---------- Услуги ----------
create table booking.services (
  id           bigint generated always as identity primary key,
  master_id    bigint not null references booking.masters(id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  price        int  not null check (price >= 0),
  duration_min int  not null check (duration_min between 10 and 600),
  active       boolean not null default true,
  sort         int  not null default 0
);
create index services_master_idx on booking.services(master_id);

-- ---------- График по дням недели (1 = Пн ... 7 = Вс). Нет строки = выходной ----------
create table booking.work_hours (
  master_id  bigint   not null references booking.masters(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),
  start_time time     not null,
  end_time   time     not null,
  primary key (master_id, weekday),
  check (end_time > start_time)
);

-- ---------- Закрытые дни/часы (выходные, отпуск) ----------
create table booking.blocks (
  id         bigint generated always as identity primary key,
  master_id  bigint not null references booking.masters(id) on delete cascade,
  period     tstzrange not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index blocks_master_period_idx on booking.blocks using gist (master_id, period);

-- ---------- Клиенты (свои у каждого мастера) ----------
create table booking.clients (
  id         bigint generated always as identity primary key,
  master_id  bigint not null references booking.masters(id) on delete cascade,
  tg_id      bigint not null,
  name       text,
  phone      text,
  username   text,
  created_at timestamptz not null default now(),
  unique (master_id, tg_id)
);

-- ---------- Записи ----------
create table booking.bookings (
  id           bigint generated always as identity primary key,
  master_id    bigint not null references booking.masters(id) on delete cascade,
  client_id    bigint not null references booking.clients(id) on delete cascade,
  service_id   bigint references booking.services(id) on delete set null,
  service_name text   not null,
  price        int    not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'active'
               check (status in ('active', 'cancelled_by_client', 'cancelled_by_master')),
  reminded_24h boolean not null default false,
  reminded_2h  boolean not null default false,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  check (ends_at > starts_at),
  -- Защита от двойной записи: у одного мастера активные записи не могут пересекаться по времени.
  constraint bookings_no_overlap
    exclude using gist (master_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status = 'active')
);
create index bookings_master_start_idx on booking.bookings(master_id, starts_at);
create index bookings_client_idx on booking.bookings(client_id);

-- ---------- Шаг диалога каждого пользователя ----------
create table booking.sessions (
  master_id  bigint not null references booking.masters(id) on delete cascade,
  tg_id      bigint not null,
  state      text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (master_id, tg_id)
);

-- ---------- Служебные журналы ----------
create table booking.test_log (
  id         bigint generated always as identity primary key,
  master_id  bigint,
  method     text,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create table booking.setup_log (
  id         bigint generated always as identity primary key,
  master_id  bigint not null references booking.masters(id) on delete cascade,
  method     text not null,
  request_id bigint,
  created_at timestamptz not null default now()
);

-- RLS на всех таблицах: снаружи (anon/authenticated) не видно ничего.
alter table booking.config         enable row level security;
alter table booking.masters        enable row level security;
alter table booking.master_secrets enable row level security;
alter table booking.services       enable row level security;
alter table booking.work_hours     enable row level security;
alter table booking.blocks         enable row level security;
alter table booking.clients        enable row level security;
alter table booking.bookings       enable row level security;
alter table booking.sessions       enable row level security;
alter table booking.test_log       enable row level security;
alter table booking.setup_log      enable row level security;

-- =====================================================================
-- Функции
-- =====================================================================

-- "среда, 4 ноября"
create or replace function booking.ru_date(d date) returns text
language sql immutable as $$
  select (array['понедельник','вторник','среда','четверг','пятница','суббота','воскресенье'])[extract(isodow from d)::int]
      || ', ' || extract(day from d)::int || ' '
      || (array['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'])[extract(month from d)::int]
$$;

-- Отправка запроса в Telegram из базы (для напоминаний и настройки бота).
create or replace function booking.tg_send(p_master bigint, p_method text, p_payload jsonb)
returns bigint language plpgsql as $$
declare
  v_token text;
  v_dry   boolean;
  v_id    bigint;
begin
  select s.bot_token, m.dry_run into v_token, v_dry
  from booking.masters m join booking.master_secrets s on s.master_id = m.id
  where m.id = p_master;
  if v_token is null then
    raise exception 'Мастер % не найден', p_master;
  end if;
  if v_dry then
    insert into booking.test_log(master_id, method, payload) values (p_master, p_method, p_payload);
    return null;
  end if;
  select net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/' || p_method,
    body := p_payload,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_id;
  return v_id;
end $$;

-- Свободные слоты на дату с учётом графика, длительности услуги, записей и закрытого времени.
create or replace function booking.free_slots(p_master bigint, p_service bigint, p_date date)
returns table(starts_at timestamptz, label text)
language sql stable as $$
  select x.st, to_char(x.lt, 'HH24:MI')
  from booking.masters m
  join booking.services s   on s.master_id = m.id and s.id = p_service and s.active
  join booking.work_hours w on w.master_id = m.id and w.weekday = extract(isodow from p_date)::int
  cross join lateral generate_series(
      p_date + w.start_time,
      p_date + w.end_time - make_interval(mins => s.duration_min),
      make_interval(mins => m.slot_step_min)) as g(lt)
  cross join lateral (
      select g.lt as lt,
             g.lt at time zone m.tz as st,
             (g.lt at time zone m.tz) + make_interval(mins => s.duration_min) as en) x
  where m.id = p_master and m.active
    and x.st >= now() + make_interval(mins => m.min_lead_min)
    and not exists (
      select 1 from booking.bookings b
      where b.master_id = m.id and b.status = 'active'
        and tstzrange(b.starts_at, b.ends_at) && tstzrange(x.st, x.en))
    and not exists (
      select 1 from booking.blocks k
      where k.master_id = m.id and k.period && tstzrange(x.st, x.en))
  order by x.st
$$;

-- Даты (ближайшие booking_days дней), на которые есть хотя бы один свободный слот.
create or replace function booking.available_dates(p_master bigint, p_service bigint)
returns table(d date)
language sql stable as $$
  select g::date
  from booking.masters m
  cross join lateral generate_series(
      ((now() at time zone m.tz)::date)::timestamp,
      ((now() at time zone m.tz)::date + (m.booking_days - 1))::timestamp,
      interval '1 day') g
  where m.id = p_master
    and exists (select 1 from booking.free_slots(p_master, p_service, g::date))
  order by 1
$$;

-- Создание записи. Повторно проверяет, что слот свободен; гонку двух клиентов ловит ограничение bookings_no_overlap.
create or replace function booking.create_booking(p_master bigint, p_client bigint, p_service bigint, p_start timestamptz)
returns jsonb language plpgsql as $$
declare
  v_m   booking.masters;
  v_s   booking.services;
  v_id  bigint;
  v_cnt int;
begin
  select * into v_m from booking.masters where id = p_master and active;
  select * into v_s from booking.services where id = p_service and master_id = p_master and active;
  if v_m.id is null or v_s.id is null then
    return jsonb_build_object('ok', false, 'error', 'service');
  end if;
  if not exists (select 1 from booking.clients where id = p_client and master_id = p_master) then
    return jsonb_build_object('ok', false, 'error', 'client');
  end if;

  select count(*) into v_cnt from booking.bookings
  where client_id = p_client and status = 'active' and starts_at > now();
  if v_cnt >= v_m.max_active_per_client then
    return jsonb_build_object('ok', false, 'error', 'limit', 'count', v_cnt);
  end if;

  if not exists (
    select 1 from booking.free_slots(p_master, p_service, (p_start at time zone v_m.tz)::date) f
    where f.starts_at = p_start) then
    return jsonb_build_object('ok', false, 'error', 'slot_taken');
  end if;

  insert into booking.bookings(master_id, client_id, service_id, service_name, price, starts_at, ends_at)
  values (p_master, p_client, p_service, v_s.name, v_s.price, p_start, p_start + make_interval(mins => v_s.duration_min))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
exception when exclusion_violation then
  return jsonb_build_object('ok', false, 'error', 'slot_taken');
end $$;

-- Напоминания за 24 часа и за 2 часа. Запускается pg_cron каждые 5 минут.
create or replace function booking.send_reminders() returns int
language plpgsql as $$
declare
  r      record;
  n      int := 0;
  v_loc  timestamp;
  v_text text;
begin
  for r in
    with r24 as (
      update booking.bookings b set reminded_24h = true
      from booking.masters m, booking.clients c
      where m.id = b.master_id and c.id = b.client_id and m.active
        and b.status = 'active' and not b.reminded_24h
        and b.starts_at >  now() + interval '2 hours'
        and b.starts_at <= now() + interval '24 hours'
        and b.created_at <= b.starts_at - interval '25 hours'
      returning b.id, b.master_id, b.service_name, b.starts_at, m.tz, m.name as mname, m.address, c.tg_id, '24'::text as kind
    ), r2 as (
      update booking.bookings b set reminded_2h = true
      from booking.masters m, booking.clients c
      where m.id = b.master_id and c.id = b.client_id and m.active
        and b.status = 'active' and not b.reminded_2h
        and b.starts_at >  now()
        and b.starts_at <= now() + interval '2 hours'
        and b.created_at <= b.starts_at - interval '3 hours'
      returning b.id, b.master_id, b.service_name, b.starts_at, m.tz, m.name as mname, m.address, c.tg_id, '2'::text as kind
    )
    select * from r24 union all select * from r2
  loop
    v_loc := r.starts_at at time zone r.tz;
    if r.kind = '24' then
      v_text := E'⏰ Напоминание о записи\n\nЗавтра, ' || booking.ru_date(v_loc::date) || ', в ' || to_char(v_loc, 'HH24:MI')
             || E'\n💅 ' || r.service_name
             || E'\n👩‍🎨 Мастер: ' || r.mname
             || coalesce(E'\n📍 ' || r.address, '')
             || E'\n\nЕсли планы изменились, пожалуйста, отмените запись кнопкой ниже — время сможет занять кто-то другой 🙏';
    else
      v_text := E'⏰ Скоро визит!\n\nСегодня в ' || to_char(v_loc, 'HH24:MI') || ' ждём вас 😊'
             || E'\n💅 ' || r.service_name
             || E'\n👩‍🎨 Мастер: ' || r.mname
             || coalesce(E'\n📍 ' || r.address, '')
             || E'\n\nДо встречи!';
    end if;
    perform booking.tg_send(r.master_id, 'sendMessage', jsonb_build_object(
      'chat_id', r.tg_id,
      'text', v_text,
      'reply_markup', jsonb_build_object('inline_keyboard', jsonb_build_array(jsonb_build_array(
        jsonb_build_object('text', '❌ Отменить запись', 'callback_data', 'cx:' || r.id))))));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Подключение бота к серверу: webhook, команды, описание.
create or replace function booking.setup_webhook(p_master bigint) returns void
language plpgsql as $$
declare
  v_m      booking.masters;
  v_secret text;
  v_url    text;
  base_cmd jsonb := '[{"command":"start","description":"Главное меню"},{"command":"book","description":"Записаться"},{"command":"my","description":"Мои записи"}]'::jsonb;
  adm_cmd  jsonb := '[{"command":"today","description":"Записи на сегодня"},{"command":"week","description":"Записи на неделю"},{"command":"admin","description":"Управление: услуги, график, выходные"},{"command":"start","description":"Главное меню"},{"command":"book","description":"Записаться"},{"command":"my","description":"Мои записи"}]'::jsonb;
begin
  select * into v_m from booking.masters where id = p_master;
  select webhook_secret into v_secret from booking.master_secrets where master_id = p_master;
  select value into v_url from booking.config where key = 'function_url';
  if v_url is null then raise exception 'В booking.config не задан function_url'; end if;

  insert into booking.setup_log(master_id, method, request_id) values
    (p_master, 'setWebhook', booking.tg_send(p_master, 'setWebhook', jsonb_build_object(
        'url', v_url || '?m=' || v_m.slug,
        'secret_token', v_secret,
        'allowed_updates', jsonb_build_array('message', 'callback_query'),
        'drop_pending_updates', true,
        'max_connections', 10))),
    (p_master, 'setMyCommands', booking.tg_send(p_master, 'setMyCommands', jsonb_build_object('commands', base_cmd))),
    (p_master, 'setMyCommands(admin)', booking.tg_send(p_master, 'setMyCommands', jsonb_build_object(
        'commands', adm_cmd,
        'scope', jsonb_build_object('type', 'chat', 'chat_id', v_m.admin_tg_id)))),
    (p_master, 'setMyDescription', booking.tg_send(p_master, 'setMyDescription', jsonb_build_object(
        'description', '💅 Онлайн-запись: ' || v_m.name || ' · ' || v_m.title
          || E'\n\nВыберите услугу, дату и время — запись займёт меньше минуты. Бот заранее напомнит о визите.'))),
    (p_master, 'setMyShortDescription', booking.tg_send(p_master, 'setMyShortDescription', jsonb_build_object(
        'short_description', 'Онлайн-запись: ' || v_m.name || ' · ' || v_m.title || ' 💅')));
end $$;

-- ГЛАВНАЯ КОМАНДА: подключить нового мастера (или обновить токен/данные существующего).
create or replace function booking.add_master(
  p_slug        text,
  p_name        text,
  p_admin_tg_id bigint,
  p_bot_token   text,
  p_title       text default 'маникюр',
  p_address     text default null
) returns text
language plpgsql as $$
declare
  v_id   bigint;
  v_slug text := lower(trim(p_slug));
begin
  if p_bot_token !~ '^[0-9]+:[A-Za-z0-9_-]{30,}$' then
    raise exception 'Токен выглядит неправильно. Скопируйте его из BotFather целиком (вида 123456789:AA...).';
  end if;
  if v_slug !~ '^[a-z0-9_-]{2,32}$' then
    raise exception 'Код мастера: только латинские буквы, цифры, - и _ (например, anna или maria_nails).';
  end if;

  select id into v_id from booking.masters where slug = v_slug;
  if v_id is null then
    insert into booking.masters(slug, name, title, admin_tg_id, address)
    values (v_slug, trim(p_name), coalesce(nullif(trim(p_title), ''), 'маникюр'), p_admin_tg_id, nullif(trim(p_address), ''))
    returning id into v_id;

    insert into booking.services(master_id, name, price, duration_min, sort) values
      (v_id, 'Маникюр без покрытия',  1200,  60, 1),
      (v_id, 'Маникюр + гель-лак',    2200, 120, 2),
      (v_id, 'Наращивание ногтей',    3500, 180, 3),
      (v_id, 'Снятие покрытия',        500,  30, 4);

    insert into booking.work_hours(master_id, weekday, start_time, end_time)
    select v_id, wd, '10:00', '20:00' from generate_series(1, 6) wd;
  else
    update booking.masters
       set name = trim(p_name),
           title = coalesce(nullif(trim(p_title), ''), title),
           admin_tg_id = p_admin_tg_id,
           address = coalesce(nullif(trim(p_address), ''), address),
           active = true
     where id = v_id;
  end if;

  insert into booking.master_secrets(master_id, bot_token) values (v_id, p_bot_token)
  on conflict (master_id) do update
    set bot_token = excluded.bot_token,
        webhook_secret = encode(extensions.gen_random_bytes(24), 'hex');

  perform booking.setup_webhook(v_id);

  return 'Готово! Мастер «' || trim(p_name) || '» подключён (код: ' || v_slug || '). Откройте бота в Telegram и нажмите /start.';
end $$;

-- Проверка: что ответил Telegram при подключении (без токена).
create or replace function booking.check_master(p_slug text)
returns table(method text, http_status int, telegram_answer text)
language sql stable as $$
  select l.method, r.status_code, left(r.content, 300)
  from booking.setup_log l
  join booking.masters m on m.id = l.master_id
  left join net._http_response r on r.id = l.request_id
  where m.slug = lower(p_slug)
    and l.created_at > now() - interval '6 hours'
  order by l.id desc
  limit 5
$$;

-- Отключить мастера (бот перестанет отвечать, данные сохранятся).
create or replace function booking.disable_master(p_slug text) returns text
language plpgsql as $$
declare v_id bigint;
begin
  update booking.masters set active = false where slug = lower(p_slug) returning id into v_id;
  if v_id is null then return 'Мастер не найден'; end if;
  perform booking.tg_send(v_id, 'deleteWebhook', '{}'::jsonb);
  return 'Мастер отключён. Включить снова: повторите add_master с тем же кодом.';
end $$;

-- Чистка старых служебных данных.
create or replace function booking.cleanup() returns void
language sql as $$
  delete from booking.sessions  where updated_at < now() - interval '7 days';
  delete from booking.test_log  where created_at < now() - interval '7 days';
  delete from booking.setup_log where created_at < now() - interval '30 days';
$$;

-- =====================================================================
-- Права: всё закрыто для внешних ролей. Доступ только у серверной функции и pg_cron.
-- =====================================================================
revoke all on all tables    in schema booking from public, anon, authenticated;
revoke all on all sequences in schema booking from public, anon, authenticated;
revoke all on all functions in schema booking from public, anon, authenticated;
alter default privileges in schema booking revoke all on tables    from public, anon, authenticated;
alter default privileges in schema booking revoke all on functions from public, anon, authenticated;
alter default privileges in schema booking revoke all on sequences from public, anon, authenticated;

-- =====================================================================
-- Настройки и расписание
-- =====================================================================
insert into booking.config(key, value)
values ('function_url', 'https://kadaesapsptfabygjkow.supabase.co/functions/v1/booking-bot')
on conflict (key) do update set value = excluded.value;

select cron.schedule('booking-reminders', '1-59/5 * * * *', 'select booking.send_reminders()');
select cron.schedule('booking-cleanup', '17 3 * * *', 'select booking.cleanup()');
