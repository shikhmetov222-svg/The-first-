-- Стройка по этапам. Новый бизнес на участке и улучшение строят бригады «Эконом», «Стандарт», «Экспресс»
-- (они заменили NPC «СтройБыт»). Бригады игроков (своя и чужие) работают как раньше, их заказы — тоже стройки.
-- Деньги списываются при старте. Этап и процент не хранятся: их считают из started_at и ends_at.
-- Пока идёт улучшение, бизнес работает на старом уровне; новый бизнес не работает, пока его не достроят.
-- Одновременно — не больше build.max_active строек у игрока (вместе с заказами у бригад игроков).

insert into public.balance_config (key, value, description) values
  ('build.minutes_1',       10,   'Стройка: минут до ур. 1 (новый бизнес) у бригады «Стандарт»'),
  ('build.minutes_2',       30,   'Стройка: минут до ур. 2'),
  ('build.minutes_3',       120,  'Стройка: минут до ур. 3'),
  ('build.minutes_4',       360,  'Стройка: минут до ур. 4'),
  ('build.minutes_5',       720,  'Стройка: минут до ур. 5'),
  ('build.econom_time',     1.25, 'Бригада «Эконом»: время × это число'),
  ('build.econom_price',    0.85, 'Бригада «Эконом»: цена × это число'),
  ('build.standard_time',   1,    'Бригада «Стандарт»: время'),
  ('build.standard_price',  1,    'Бригада «Стандарт»: цена'),
  ('build.express_time',    0.7,  'Бригада «Экспресс»: время'),
  ('build.express_price',   1.4,  'Бригада «Экспресс»: цена'),
  ('build.max_active',      2,    'Стройка: сколько строек одновременно у игрока (для всех одинаково)'),
  ('build.dev_speed',       60,   'Режим разработчика: во сколько раз быстрее стройки администратора'),
  ('notify.gap_minutes',    10,   'Бот: не чаще одного сообщения игроку за столько минут (остальное объединяется)');

-- Ускорение строек для администратора (×1 или ×build.dev_speed) — включается в панели разработчика.
alter table public.players add column build_speed int not null default 1 check (build_speed >= 1);

create table public.constructions (
  id           bigint generated always as identity primary key,
  player_id    uuid not null references public.players(id) on delete cascade,
  -- null — новый бизнес на купленном участке: он появится, когда стройку закончат
  business_id  uuid references public.businesses(id) on delete cascade,
  bi           smallint not null,
  bj           smallint not null,
  bk           smallint not null,
  target_type  text not null references public.business_types(type),
  target_level int not null check (target_level between 1 and 5),
  brigade      text not null check (brigade in ('econom', 'standard', 'express')),
  price        bigint not null,
  off_best     boolean not null default false,
  season       int,
  started_at   timestamptz not null default now(),
  ends_at      timestamptz not null,
  status       text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  finished_at  timestamptz
);
-- На одном участке — одна стройка; у бизнеса — одна; новый бизнес одного типа — один.
create unique index constructions_plot on public.constructions (player_id, bi, bj, bk) where status = 'active';
create unique index constructions_business on public.constructions (business_id) where status = 'active';
create unique index constructions_new_type on public.constructions (player_id, target_type)
  where status = 'active' and business_id is null;
create index constructions_due on public.constructions (ends_at) where status = 'active';
alter table public.constructions enable row level security;
revoke all on public.constructions from anon, authenticated;

create function public.brigade_name(p_brigade text) returns text
language sql immutable set search_path = ''
as $$ select case p_brigade when 'econom' then 'Эконом' when 'express' then 'Экспресс' else 'Стандарт' end $$;

-- Сколько идёт стройка до уровня у бригады (с ускорением администратора), минут.
create function public.build_minutes(p_player uuid, p_level int, p_brigade text) returns numeric
language sql stable set search_path = ''
as $$
  select public.cfg('build.minutes_' || p_level) * public.cfg('build.' || p_brigade || '_time')
         / case when p.is_admin then p.build_speed else 1 end
    from public.players p where p.id = p_player
$$;

-- Активные стройки игрока: свои бригады-NPC и заказы у бригад игроков.
create function public.active_builds(p_player uuid) returns int
language sql stable set search_path = ''
as $$
  select ((select count(*) from public.constructions where player_id = p_player and status = 'active')
        + (select count(*) from public.repair_orders where customer_id = p_player and status in ('queued', 'working')))::int
$$;

-- Участок свободен: район открыт, не парк, нет своего бизнеса и нет стройки.
create or replace function public.city_plot_free(p_player uuid, p_stage int, p_i int, p_j int, p_k int, p_except uuid default null)
returns boolean
language sql stable set search_path = ''
as $$
  select p_i between 0 and 2 and p_j between 0 and 3 and p_k between 0 and 3
     and public.city_district(p_i, p_j) <> 'park'
     and public.city_stage_of(public.city_district(p_i, p_j)) <= p_stage
     and not exists (select 1 from public.business_plots bp join public.businesses b on b.id = bp.business_id
                      where b.player_id = p_player and bp.bi = p_i and bp.bj = p_j and bp.bk = p_k
                        and b.id is distinct from p_except)
     and not exists (select 1 from public.constructions c
                      where c.player_id = p_player and c.status = 'active' and c.business_id is null
                        and c.bi = p_i and c.bj = p_j and c.bk = p_k)
$$;

-- Свободный участок по умолчанию для нового бизнеса (как city_assign_plot): лучший район, иначе центр или спальный.
create function public.city_pick_plot(p_player uuid, p_type text, out i int, out j int, out k int)
language sql stable set search_path = ''
as $$
  select gi, gj, gk
    from generate_series(0, 2) gi, generate_series(0, 3) gj, generate_series(0, 3) gk
   where public.city_plot_free(p_player, coalesce(public.city_stage(p_player), 1), gi, gj, gk)
   order by case public.city_district(gi, gj)
              when public.best_district(p_type) then 0 when 'center' then 1 when 'sleep' then 2 else 3 end,
            md5(public.city_seed(p_player)::text || '-' || gi || '-' || gj || '-' || gk)
   limit 1
$$;

-- Начать стройку нового бизнеса на участке. Деньги — сразу; бизнес появится, когда стройку закончат.
create function public.start_build(p_player uuid, p_type text, p_brigade text, p_i int, p_j int, p_k int) returns text
language plpgsql set search_path = ''
as $$
declare
  me      public.players;
  t       public.business_types;
  v_stage int;
  v_price bigint;
  v_mins  numeric;
begin
  if p_brigade is null or p_brigade not in ('econom', 'standard', 'express') then raise exception 'Выбери бригаду'; end if;
  select * into me from public.players where id = p_player for update;
  select * into t from public.business_types where type = p_type;
  if not found then raise exception 'Такого бизнеса нет'; end if;
  if exists (select 1 from public.businesses where player_id = p_player and type = p_type) then
    raise exception 'Этот бизнес у тебя уже есть';
  end if;
  if exists (select 1 from public.constructions where player_id = p_player and status = 'active'
                and business_id is null and target_type = p_type) then
    raise exception 'Такой бизнес у тебя уже строится';
  end if;
  v_stage := coalesce(public.city_stage(p_player), 1);
  if not public.city_plot_free(p_player, v_stage, p_i, p_j, p_k) then
    raise exception 'Этот участок недоступен: выбери свободный участок в открытом районе';
  end if;
  if public.active_builds(p_player) >= public.cfg('build.max_active') then
    raise exception 'Одновременно можно вести не больше % строек — дождись, пока одна закончится',
      public.cfg('build.max_active')::int;
  end if;
  v_price := (round(t.open_cost * public.cfg('build.' || p_brigade || '_price') / 100) * 100)::bigint;
  if me.cash < v_price then
    raise exception 'Не хватает денег: нужно %, у тебя %', public.fmt_rub(v_price), public.fmt_rub(me.cash);
  end if;
  v_mins := public.build_minutes(p_player, 1, p_brigade);

  update public.players set cash = cash - v_price where id = p_player;
  insert into public.constructions (player_id, bi, bj, bk, target_type, target_level, brigade, price, off_best, season, ends_at)
  values (p_player, p_i, p_j, p_k, p_type, 1, p_brigade, v_price,
          public.city_district(p_i, p_j) <> public.best_district(p_type)
            and public.city_stage_of(public.best_district(p_type)) <= v_stage,
          public.current_season(), now() + make_interval(secs => v_mins * 60));
  return format('Стройка началась: %s, ур. 1. Бригада «%s», готово через ≈ %s', t.name, public.brigade_name(p_brigade),
                public.fmt_minutes(ceil(v_mins)::int));
end;
$$;

-- Открыть бизнес на выбранном участке: теперь это стройка (старый вариант без бригады — «Стандарт»).
drop function public.open_business_at(uuid, text, int, int, int);
create function public.open_business_at(p_player_id uuid, p_type text, p_i int, p_j int, p_k int,
                                        p_brigade text default 'standard') returns text
language sql set search_path = ''
as $$ select public.start_build(p_player_id, p_type, p_brigade, p_i, p_j, p_k) $$;

-- Открыть бизнес без участка (каталог, улица): стройка выбранной бригадой на участке по умолчанию.
-- Самый первый бизнес игрока в сезоне открывается сразу — чтобы обучение не ждало стройку.
create function public.open_business_with(p_player_id uuid, p_type text, p_brigade text) returns text
language plpgsql set search_path = ''
as $$
declare
  t      public.business_types;
  p      public.players;
  v_plot record;
begin
  select * into t from public.business_types where type = p_type;
  if not found then raise exception 'Такого бизнеса нет'; end if;
  select * into p from public.players where id = p_player_id for update;
  if exists (select 1 from public.businesses where player_id = p_player_id and type = p_type) then
    raise exception 'Этот бизнес у тебя уже есть';
  end if;

  if not exists (select 1 from public.businesses where player_id = p_player_id)
     and not exists (select 1 from public.constructions where player_id = p_player_id
                        and season is not distinct from public.current_season()) then
    if p.cash < t.open_cost then
      raise exception 'Не хватает денег: нужно %', public.fmt_rub(t.open_cost);
    end if;
    update public.players set cash = cash - t.open_cost where id = p_player_id;
    insert into public.businesses (player_id, type, price) values (p_player_id, p_type, t.ref_price);
    return format('Открыт бизнес: %s', t.name);
  end if;

  select * into v_plot from public.city_pick_plot(p_player_id, p_type);
  if v_plot.i is null then raise exception 'Нет свободного участка: дождись, пока откроется новый район'; end if;
  return public.start_build(p_player_id, p_type, coalesce(p_brigade, 'standard'), v_plot.i, v_plot.j, v_plot.k);
end;
$$;

-- Старый вызов (старые версии игры) — бригада «Стандарт».
create or replace function public.open_business(p_player_id uuid, p_type text) returns void
language plpgsql set search_path = ''
as $$
begin
  perform public.open_business_with(p_player_id, p_type, 'standard');
end;
$$;

-- Начать улучшение бригадой «Эконом/Стандарт/Экспресс». Цена «Стандарта» = стоимость улучшения + работа,
-- как раньше у «СтройБыта»; остальные — дешевле/дороже по конфигу.
create function public.start_upgrade(p_player uuid, p_type text, p_brigade text) returns text
language plpgsql set search_path = ''
as $$
declare
  me      public.players;
  b       public.businesses;
  bp      public.business_plots;
  v_to    int;
  v_cost  bigint;
  v_price bigint;
  v_mins  numeric;
  v_name  text := (select name from public.business_types where type = p_type);
begin
  if p_brigade is null or p_brigade not in ('econom', 'standard', 'express') then raise exception 'Выбери бригаду'; end if;
  select * into me from public.players where id = p_player for update;
  select * into b from public.businesses where player_id = p_player and type = p_type for update;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
  if p_type = 'repair' then raise exception 'Бригаду улучшить нельзя'; end if;
  if b.listed then raise exception 'Бизнес выставлен на продажу — сначала сними его с рынка'; end if;
  if b.level >= public.cfg('upgrade.max_level') then raise exception 'Это максимальный уровень'; end if;
  if exists (select 1 from public.repair_orders where business_id = b.id and status in ('queued', 'working'))
     or exists (select 1 from public.constructions where business_id = b.id and status = 'active') then
    raise exception 'Этот бизнес уже строится';
  end if;
  if public.active_builds(p_player) >= public.cfg('build.max_active') then
    raise exception 'Одновременно можно вести не больше % строек — дождись, пока одна закончится',
      public.cfg('build.max_active')::int;
  end if;
  v_to := b.level + 1;
  v_cost := public.upgrade_cost(p_type, v_to);
  v_price := (round(v_cost * (1 + public.cfg('repair.npc_pct')) * public.cfg('build.' || p_brigade || '_price') / 100) * 100)::bigint;
  if me.cash < v_price then
    raise exception 'Не хватает денег: нужно %, у тебя %', public.fmt_rub(v_price), public.fmt_rub(me.cash);
  end if;
  v_mins := public.build_minutes(p_player, v_to, p_brigade);
  select * into bp from public.business_plots where business_id = b.id;

  update public.players set cash = cash - v_price where id = p_player;
  insert into public.constructions (player_id, business_id, bi, bj, bk, target_type, target_level, brigade, price, season, ends_at)
  values (p_player, b.id, coalesce(bp.bi, 0), coalesce(bp.bj, 0), coalesce(bp.bk, 0), p_type, v_to, p_brigade, v_price,
          public.current_season(), now() + make_interval(secs => v_mins * 60));
  return format('Стройка началась: %s, ур. %s. Бригада «%s», готово через ≈ %s', v_name, v_to,
                public.brigade_name(p_brigade), public.fmt_minutes(ceil(v_mins)::int));
end;
$$;

-- Закончить стройки, у которых вышел срок (игрока или всех). Идемпотентно: каждая стройка
-- закрывается один раз — под блокировкой строки и только из статуса active.
create function public.finish_constructions(p_player uuid default null) returns int
language plpgsql set search_path = ''
as $$
declare
  c      record;
  v_id   uuid;
  v_name text;
  v_n    int := 0;
begin
  for c in select * from public.constructions
            where status = 'active' and ends_at <= now() and (p_player is null or player_id = p_player)
            order by ends_at
            for update skip locked loop
    -- Сезон сменился — недостроенное обнуляется вместе со всем остальным.
    if c.season is distinct from public.current_season() then
      update public.constructions set status = 'cancelled', finished_at = now() where id = c.id;
      continue;
    end if;
    v_name := (select name from public.business_types where type = c.target_type);
    if c.business_id is null then
      if exists (select 1 from public.businesses where player_id = c.player_id and type = c.target_type) then
        -- Такой бизнес уже есть (например, купил на рынке, пока шла стройка) — деньги возвращаются.
        update public.players set cash = cash + c.price where id = c.player_id;
        update public.constructions set status = 'cancelled', finished_at = now() where id = c.id;
        insert into public.notifications (player_id, kind, text)
        values (c.player_id, 'build_cancelled', format('Стройка отменена: %s у тебя уже есть, деньги вернулись', v_name));
        continue;
      end if;
      insert into public.businesses (player_id, type, price)
      values (c.player_id, c.target_type, (select ref_price from public.business_types where type = c.target_type))
      returning id into v_id;
      update public.business_plots set bi = c.bi, bj = c.bj, bk = c.bk, off_best = c.off_best where business_id = v_id;
    else
      update public.businesses set level = greatest(level, c.target_level) where id = c.business_id;
    end if;
    update public.constructions set status = 'done', finished_at = now() where id = c.id and status = 'active';
    insert into public.notifications (player_id, kind, text)
    values (c.player_id, 'build_done', format('Стройка завершена: %s, ур. %s', v_name, c.target_level));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Стройки игрока для экрана: свои (бригады-NPC) и заказы у бригад игроков (идут по тем же 5 этапам).
create function public.builds_view(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'ends_at'), '[]'::jsonb) from (
    select jsonb_build_object('id', 'c' || c.id, 'type', c.target_type, 'level', c.target_level, 'new', c.business_id is null,
                              'i', c.bi, 'j', c.bj, 'k', c.bk, 'brigade', public.brigade_name(c.brigade),
                              'started_at', c.started_at, 'ends_at', c.ends_at, 'queued', false) x
      from public.constructions c where c.player_id = p_player and c.status = 'active'
    union all
    select jsonb_build_object('id', 'r' || o.id, 'type', o.business_type, 'level', o.to_level, 'new', false,
                              'i', bp.bi, 'j', bp.bj, 'k', bp.bk,
                              'brigade', case o.kind when 'self' then 'Своя бригада' when 'npc' then 'СтройБыт'
                                         else (select coalesce(cp.company_name, cp.first_name) from public.businesses cb
                                                 join public.players cp on cp.id = cb.player_id where cb.id = o.crew_business_id) end,
                              'started_at', coalesce(o.started_at, o.created_at), 'ends_at', coalesce(o.finish_at, o.due_at),
                              'queued', o.status = 'queued')
      from public.repair_orders o left join public.business_plots bp on bp.business_id = o.business_id
     where o.customer_id = p_player and o.status in ('queued', 'working')) s
$$;

-- Стройки других игроков в городе (для карты, без кнопок).
create function public.rival_builds(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('player', c.player_id, 'business', c.business_id, 'type', c.target_type,
                                               'level', c.target_level, 'i', c.bi, 'j', c.bj, 'k', c.bk,
                                               'started_at', c.started_at, 'ends_at', c.ends_at)), '[]'::jsonb)
    from public.constructions c join public.players p on p.id = c.player_id
   where c.status = 'active' and c.player_id <> p_player and not p.is_test
$$;

-- Раз в минуту: закончить стройки и заказы бригад, у которых вышел срок.
create function public.build_minute() returns void
language plpgsql set search_path = ''
as $$
begin
  perform public.finish_constructions(null);
  perform public.process_repairs();
end;
$$;
select cron.schedule('capital-build', '* * * * *', 'select public.build_minute()');

-- ---------- Режим разработчика ----------
-- «Достроить сейчас»: все стройки администратора (и заказы у бригад) заканчиваются сразу.
create function public.dev_finish_builds(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a   public.players := public.dev_lock_admin(p_admin);
  v_n int;
  v_r int;
begin
  update public.constructions set ends_at = now() where player_id = a.id and status = 'active';
  get diagnostics v_n = row_count;
  update public.repair_orders
     set status = 'working', started_at = coalesce(started_at, now()), finish_at = now()
   where customer_id = a.id and status in ('queued', 'working');
  get diagnostics v_r = row_count;
  perform public.finish_constructions(a.id);
  perform public.process_repairs();
  perform public.dev_write_log(a, 'finish_builds', jsonb_build_object('builds', v_n, 'orders', v_r));
  return format('Достроено: %s', v_n + v_r);
end;
$$;

-- Скорость строек администратора: ×1 или ×build.dev_speed (для новых строек).
create function public.dev_build_speed(p_admin uuid, p_fast boolean) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
  v int := case when p_fast then public.cfg('build.dev_speed')::int else 1 end;
begin
  update public.players set build_speed = v where id = a.id;
  perform public.dev_write_log(a, 'build_speed', jsonb_build_object('speed', v));
  return format('Скорость строек: ×%s (для новых строек)', v);
end;
$$;

-- Сброс аккаунта администратора — недостроенное тоже уходит.
create function public.dev_reset_builds() returns trigger
language plpgsql set search_path = ''
as $$
begin
  update public.constructions set status = 'cancelled', finished_at = now()
   where player_id = new.admin_id and status = 'active';
  return new;
end;
$$;
create trigger dev_log_reset_builds after insert on public.dev_log
for each row when (new.action = 'reset_me') execute function public.dev_reset_builds();

-- Заказ улучшения: бригады-NPC — стройка по этапам; бригады игроков — как раньше, но с общим лимитом строек.
create or replace function public.order_upgrade(p_player uuid, p_type text, p_contractor text) returns text
language plpgsql set search_path = ''
as $$
declare
  me      public.players;
  o       public.players;
  b       public.businesses;
  c       public.businesses;
  v_to    int;
  v_cost  bigint;
  v_fee   bigint;
  v_kind  text;
  v_due   timestamptz;
  v_flags text[] := '{}';
  v_pair  int;
  v_cap   bigint;
  v_name  text := (select name from public.business_types where type = p_type);
begin
  if p_contractor is null then raise exception 'Выбери подрядчика'; end if;
  -- Бригады «Эконом/Стандарт/Экспресс» (старое «npc» — это «Стандарт») — стройка по этапам.
  if p_contractor in ('econom', 'standard', 'express', 'npc') then
    return public.start_upgrade(p_player, p_type,
                                case p_contractor when 'npc' then 'standard' else p_contractor end);
  end if;

  -- Бригада другого игрока: блокируем обоих игроков по возрастанию id.
  if p_contractor not in ('npc', 'self') then
    if p_contractor !~ '^[0-9a-f-]{36}$' then raise exception 'Подрядчик не найден'; end if;
    select * into c from public.businesses where id = p_contractor::uuid and type = 'repair';
    if not found then raise exception 'Подрядчик не найден'; end if;
    if c.player_id = p_player then raise exception 'Это твоя бригада — выбери «Своя бригада»'; end if;
    if p_player < c.player_id then
      select * into me from public.players where id = p_player for update;
      select * into o from public.players where id = c.player_id for update;
    else
      select * into o from public.players where id = c.player_id for update;
      select * into me from public.players where id = p_player for update;
    end if;
    if (o.is_test and not me.is_admin) or (me.is_test and not o.is_admin) then raise exception 'Подрядчик не найден'; end if;
  else
    select * into me from public.players where id = p_player for update;
  end if;

  -- Бизнес, который улучшаем.
  select * into b from public.businesses where player_id = p_player and type = p_type for update;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
  if p_type = 'repair' then raise exception 'Бригаду улучшить нельзя'; end if;
  if b.listed then raise exception 'Бизнес выставлен на продажу — сначала сними его с рынка'; end if;
  if b.level >= public.cfg('upgrade.max_level') then raise exception 'Это максимальный уровень'; end if;
  if exists (select 1 from public.repair_orders where business_id = b.id and status in ('queued', 'working'))
     or exists (select 1 from public.constructions where business_id = b.id and status = 'active') then
    raise exception 'Этот бизнес уже строится';
  end if;
  if public.active_builds(p_player) >= public.cfg('build.max_active') then
    raise exception 'Одновременно можно вести не больше % строек — дождись, пока одна закончится',
      public.cfg('build.max_active')::int;
  end if;
  v_to := b.level + 1;
  v_cost := public.upgrade_cost(p_type, v_to);

  if p_contractor = 'npc' then
    v_kind := 'npc';
    v_fee := (round(v_cost * public.cfg('repair.npc_pct') / 100) * 100)::bigint;
    v_due := now() + make_interval(mins => public.cfg('repair.npc_minutes')::int);
  else
    if p_contractor = 'self' then
      v_kind := 'self';
      select * into c from public.businesses where player_id = p_player and type = 'repair' for update;
      if not found then raise exception 'У тебя нет ремонтной бригады'; end if;
      v_fee := (round(v_cost * public.cfg('repair.self_pct') / 100) * 100)::bigint;
    else
      v_kind := 'crew';
      select * into c from public.businesses where id = c.id for update;
      v_fee := (round(v_cost * c.repair_pct / 100) * 100)::bigint;
    end if;
    if c.listed then raise exception 'Бригада выставлена на продажу и не берёт заказы'; end if;
    if (select count(*) from public.repair_orders where crew_business_id = c.id and status in ('queued', 'working'))
       >= public.cfg('repair.queue') then
      raise exception 'У бригады полная очередь — выбери другую';
    end if;
    v_due := public.crew_free_at(c.id) + make_interval(mins => public.cfg('repair.minutes')::int);
  end if;

  if me.cash < v_cost + v_fee then
    raise exception 'Не хватает денег: нужно %', public.fmt_rub(v_cost + v_fee);
  end if;

  -- Защита от перекачки денег: как на рынке (кроме заказов у администратора).
  if v_kind = 'crew' and not (me.is_admin or o.is_admin) then
    select count(*) into v_pair from public.repair_orders
     where customer_id = p_player and crew_player_id = o.id and kind = 'crew' and created_at > now() - interval '24 hours';
    if v_pair >= 3 then raise exception 'Не больше 3 заказов в сутки у одной бригады'; end if;
    if v_pair >= 2 then v_flags := array_append(v_flags, 'frequent'); end if;
    if me.referred_by = o.id or o.referred_by = me.id then v_flags := array_append(v_flags, 'friends'); end if;
    select capital into v_cap from public.capitals() where player_id = o.id;
    if v_fee > 0.3 * greatest(coalesce(v_cap, 0), 1) then v_flags := array_append(v_flags, 'big_share'); end if;
  end if;

  update public.players set cash = cash - v_cost - v_fee where id = p_player;
  insert into public.repair_orders (customer_id, business_id, business_type, to_level, kind, crew_business_id, crew_player_id,
                                    upgrade_cost, fee, flags, status, started_at, finish_at, due_at)
  values (p_player, b.id, p_type, v_to, v_kind, c.id, c.player_id, v_cost, v_fee, v_flags,
          case when v_kind = 'npc' then 'working' else 'queued' end,
          case when v_kind = 'npc' then now() end,
          case when v_kind = 'npc' then v_due end,
          v_due);
  if v_kind <> 'npc' then perform public.crew_start_next(c.id); end if;

  if v_kind = 'crew' then
    insert into public.notifications (player_id, kind, text)
    values (o.id, 'repair_order', format('Новый заказ для бригады: %s до ур. %s, оплата %s', v_name, v_to, public.fmt_rub(v_fee)));
  end if;
  return format('Ремонт заказан: %s до ур. %s, готово через ≈ %s', v_name, v_to,
                public.fmt_minutes(ceil(extract(epoch from v_due - now()) / 60)::int));
end;
$$;

-- Подрядчики для улучшения: три бригады вместо «СтройБыта».
create or replace function public.repair_offers(p_player uuid, p_type text) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  me      public.players;
  b       public.businesses;
  v_to    int;
  v_cost  bigint;
  v_max   int := public.cfg('upgrade.max_level')::int;
  v_qmax  int := public.cfg('repair.queue')::int;
  v_mins  int := public.cfg('repair.minutes')::int;
  own     public.businesses;
  offers  jsonb := '[]'::jsonb;
begin
  select * into me from public.players where id = p_player;
  select * into b from public.businesses where player_id = p_player and type = p_type;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
  if p_type = 'repair' then raise exception 'Бригаду улучшить нельзя'; end if;
  if b.level >= v_max then raise exception 'Это максимальный уровень'; end if;
  v_to := b.level + 1;
  v_cost := public.upgrade_cost(p_type, v_to);

  -- Своя бригада — по себестоимости.
  select * into own from public.businesses where player_id = p_player and type = 'repair';
  if found then
    offers := offers || jsonb_build_array(jsonb_build_object(
      'kind', 'self', 'id', own.id, 'name', 'Своя бригада',
      'pct', public.cfg('repair.self_pct'),
      'fee', (round(v_cost * public.cfg('repair.self_pct') / 100) * 100)::bigint,
      'wait_minutes', ceil(extract(epoch from public.crew_free_at(own.id) - now()) / 60)::int + v_mins,
      'rating', public.crew_rating(own.id),
      'queue', (select count(*) from public.repair_orders where crew_business_id = own.id and status in ('queued', 'working')),
      'full', own.listed or (select count(*) from public.repair_orders where crew_business_id = own.id
                                and status in ('queued', 'working')) >= v_qmax));
  end if;

  -- Бригады других игроков.
  offers := offers || coalesce((
    select jsonb_agg(x order by (x->>'fee')::bigint, (x->>'wait_minutes')::int) from (
      select jsonb_build_object(
               'kind', 'crew', 'id', c.id,
               'name', coalesce(o.company_name, o.first_name), 'icon', o.company_icon, 'color', o.company_color,
               'dev', o.is_admin and o.show_dev_badge, 'test', o.is_test,
               'pct', c.repair_pct,
               'fee', (round(v_cost * c.repair_pct / 100) * 100)::bigint,
               'wait_minutes', ceil(extract(epoch from public.crew_free_at(c.id) - now()) / 60)::int + v_mins,
               'rating', public.crew_rating(c.id),
               'done', (select count(*) from public.repair_orders r where r.crew_business_id = c.id and r.status = 'done'),
               'queue', q.n,
               'full', q.n >= v_qmax) x
        from public.businesses c
        join public.players o on o.id = c.player_id
        cross join lateral (select count(*)::int n from public.repair_orders r
                             where r.crew_business_id = c.id and r.status in ('queued', 'working')) q
       where c.type = 'repair' and not c.listed and c.player_id <> p_player
         and (not o.is_test or me.is_admin)
         and (not me.is_test or o.is_admin)) s), '[]'::jsonb);

  -- Бригады «Эконом», «Стандарт», «Экспресс» есть всегда (вместо NPC «СтройБыт»).
  offers := offers || (select jsonb_agg(jsonb_build_object(
    'kind', 'npc', 'id', br, 'name', public.brigade_name(br),
    'pct', public.cfg('repair.npc_pct'),
    'fee', (round(v_cost * (1 + public.cfg('repair.npc_pct')) * public.cfg('build.' || br || '_price') / 100) * 100)::bigint - v_cost,
    'wait_minutes', ceil(public.build_minutes(p_player, v_to, br))::int,
    'time_mult', public.cfg('build.' || br || '_time'), 'price_mult', public.cfg('build.' || br || '_price'),
    'rating', null, 'queue', 0, 'full', false) order by n)
    from unnest(array['econom', 'standard', 'express']) with ordinality u(br, n));

  return jsonb_build_object(
    'type', p_type, 'level', b.level, 'to_level', v_to, 'cost', v_cost,
    'capacity_step', public.cfg('upgrade.capacity_step'), 'sales_step', public.cfg('upgrade.sales_step'),
    'active', exists (select 1 from public.repair_orders where business_id = b.id and status in ('queued', 'working'))
              or exists (select 1 from public.constructions where business_id = b.id and status = 'active'),
    'builds', public.active_builds(p_player), 'max_builds', public.cfg('build.max_active'),
    'offers', offers);
end;
$$;

-- Бот: не чаще одного сообщения в 10 минут.
create or replace function public.notifications_batch() returns jsonb
language plpgsql set search_path = ''
as $$
declare
  result jsonb;
begin
  -- Кому нельзя писать (выключил уведомления, тестовый игрок) — пропускаем.
  update public.notifications n
     set bot_status = 'skipped', bot_at = now()
    from public.players p
   where p.id = n.player_id and n.bot_status = 'pending'
     and (not p.notify_enabled or p.is_test or p.telegram_id <= 0);

  -- Лимит: не больше 5 сообщений бота в сутки на игрока (одно сообщение = одна пачка).
  with sent_today as (
    select player_id, count(distinct bot_at) as msgs
      from public.notifications
     where bot_status in ('sent', 'failed') and bot_at > now() - interval '24 hours'
     group by player_id
  ), picked as (
    select n.id from public.notifications n
      left join sent_today s on s.player_id = n.player_id
     where n.bot_status = 'pending' and coalesce(s.msgs, 0) < 5
       and n.created_at > now() - interval '24 hours'
       -- Не чаще одного сообщения за notify.gap_minutes: остальное ждёт и уходит одной пачкой.
       and not exists (select 1 from public.notifications x
                        where x.player_id = n.player_id and x.bot_status in ('sent', 'failed')
                          and x.bot_at > now() - make_interval(mins => public.cfg('notify.gap_minutes')::int))
     order by n.id
     for update of n skip locked
  ), marked as (
    update public.notifications n set bot_status = 'sent', bot_at = now()
      from picked where n.id = picked.id
    returning n.id, n.player_id, n.text
  )
  select coalesce(jsonb_agg(jsonb_build_object('telegram_id', p.telegram_id, 'ids', g.ids, 'texts', g.texts)), '[]'::jsonb)
    into result
    from (select player_id, jsonb_agg(id order by id) as ids, jsonb_agg(text order by id) as texts
            from marked group by player_id) g
    join public.players p on p.id = g.player_id;

  -- Старые неотправленные (больше суток) уже неактуальны.
  update public.notifications set bot_status = 'skipped', bot_at = now()
   where bot_status = 'pending' and created_at <= now() - interval '24 hours';
  return result;
end;
$$;

-- Карта: стройки конкурентов.
create or replace function public.city_view(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'rivals', coalesce((
      select jsonb_agg(x.j order by x.cap desc, x.id)
        from (select b.id, c.capital as cap,
                     jsonb_build_object('id', b.id, 'player', p.id, 'type', b.type, 'level', b.level, 'i', bp.bi, 'j', bp.bj, 'k', bp.bk,
                                        'owner', coalesce(p.company_name, p.first_name), 'color', p.company_color) as j
                from public.businesses b
                join public.business_plots bp on bp.business_id = b.id
                join public.players p on p.id = b.player_id
                join public.capitals() c on c.player_id = p.id
               where p.id <> p_player and not p.is_test
               order by c.capital desc, b.id
               limit public.cfg('city.rivals')::int) x), '[]'::jsonb),
    'bots', coalesce((
      select jsonb_agg(jsonb_build_object('name', n.name, 'type', case n.market when 'coffee' then 'coffee' else 'shop' end)
                       order by n.id)
        from public.npc_sellers n where n.active), '[]'::jsonb)
      || coalesce((
      select jsonb_agg(jsonb_build_object('name', n.name, 'type', n.kind) order by n.id)
        from public.npc_niches n where n.active and n.kind in ('marketplace', 'pvz', 'agency')), '[]'::jsonb),
    'builds', public.rival_builds(p_player))
$$;

-- Состояние: стройки игрока и настройки бригад.
CREATE OR REPLACE FUNCTION public.get_state(p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  pd     public.player_decisions;
  v_cap  bigint;
  result jsonb;
begin
  -- Стройки, у которых вышел срок, заканчиваются при любом чтении состояния.
  perform public.finish_constructions(p_player_id);
  update public.players set last_seen_at = now() where id = p_player_id;
  insert into public.player_days (player_id, day) values (p_player_id, public.moscow_today())
  on conflict do nothing;
  pd := public.today_decision(p_player_id);
  select capital into v_cap from public.capitals() where player_id = p_player_id;

  select jsonb_build_object(
    'server_time', now(),
    'player', (select jsonb_build_object('id', id, 'first_name', first_name, 'cash', cash, 'created_at', created_at,
                                         'tutorial_step', tutorial_step, 'haptics', haptics_enabled)
               from public.players where id = p_player_id),
    'company', (select case when company_name is null then null else jsonb_build_object(
                  'name', company_name, 'icon', company_icon, 'color', company_color, 'motto', company_motto,
                  'can_rename', name_changed_season is distinct from public.current_season()) end
                from public.players where id = p_player_id),
    'catalog', (select jsonb_agg(to_jsonb(t.*) order by t.sort) from public.business_types t),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'type', b.type, 'price', b.price, 'stock', b.stock,
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue, 'listed', b.listed,
               'progress', b.work_progress,
               'last_sale_at', (select max(l.tick_at) from public.sales_log l
                                 where l.business_id = b.id and l.revenue > 0 and l.tick_at > now() - interval '10 minutes'),
               'level', b.level,
               'capacity', public.lvl_cap(t.capacity, b.level),
               'raw_capacity', public.lvl_cap(t.raw_capacity, b.level),
               'repair', (select jsonb_build_object(
                            'to_level', o.to_level, 'kind', o.kind, 'status', o.status,
                            'finish_at', coalesce(o.finish_at, o.due_at), 'due_at', o.due_at,
                            'contractor', case o.kind when 'npc' then 'СтройБыт' when 'self' then 'Своя бригада'
                                          else (select coalesce(cp.company_name, cp.first_name) from public.businesses cb
                                                  join public.players cp on cp.id = cb.player_id
                                                 where cb.id = o.crew_business_id) end)
                          from public.repair_orders o
                         where o.business_id = b.id and o.status in ('queued', 'working')),
               'crew', case when b.type = 'repair' then jsonb_build_object(
                         'npc_job_until', b.npc_job_until,
                         'pct', b.repair_pct,
                         'rating', public.crew_rating(b.id),
                         'done', (select count(*) from public.repair_orders o where o.crew_business_id = b.id and o.status = 'done'),
                         'earned_24h', (select coalesce(sum(o.fee - ceil(o.fee * 0.05)), 0) from public.repair_orders o
                                         where o.crew_business_id = b.id and o.status = 'done' and o.kind = 'crew'
                                           and o.finished_at > now() - interval '24 hours'),
                         'queue', coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', o.id, 'type', o.business_type, 'to_level', o.to_level, 'kind', o.kind,
                                    'status', o.status, 'fee', o.fee, 'finish_at', coalesce(o.finish_at, o.due_at),
                                    'customer', coalesce(cu.company_name, cu.first_name)) order by o.id)
                                  from public.repair_orders o join public.players cu on cu.id = o.customer_id
                                 where o.crew_business_id = b.id and o.status in ('queued', 'working')), '[]'::jsonb)) end,
               'goods', (select jsonb_object_agg(g.product, g.qty) from public.business_goods g where g.business_id = b.id),
               'ads', coalesce((select jsonb_agg(e.until order by e.until) from public.player_effects e
                                 where e.player_id = p_player_id and e.kind = 'ad' and e.market = b.type
                                   and e.until > now()), '[]'::jsonb),
               'last_revenue', coalesce((select l.revenue from public.sales_log l
                                          where l.business_id = b.id and l.tick_at > now() - interval '5 minutes'
                                          order by l.tick_at desc limit 1), 0),
               'last_sold', coalesce((select l.sold from public.sales_log l
                                       where l.business_id = b.id and l.sold > 0
                                         and l.tick_at > now() - interval '5 minutes'
                                       order by l.tick_at desc limit 1), 0)) order by t.sort)
      from public.businesses b join public.business_types t using (type)
      where b.player_id = p_player_id), '[]'::jsonb),
    'city', jsonb_build_object(
      'seed', public.city_seed(p_player_id),
      'stage', public.city_stage(p_player_id),
      'caps', jsonb_build_array(0, public.cfg('city.stage_2'), public.cfg('city.stage_3'), public.cfg('city.stage_4')),
      'other_mult', public.cfg('city.other_district_mult'),
      'plots', coalesce((select jsonb_agg(jsonb_build_object('type', b.type, 'i', bp.bi, 'j', bp.bj, 'k', bp.bk))
                           from public.businesses b join public.business_plots bp on bp.business_id = b.id
                          where b.player_id = p_player_id), '[]'::jsonb)),
    'builds', public.builds_view(p_player_id),
    'build', jsonb_build_object(
      'max_active', public.cfg('build.max_active'),
      'minutes', jsonb_build_array(public.cfg('build.minutes_1'), public.cfg('build.minutes_2'), public.cfg('build.minutes_3'),
                                   public.cfg('build.minutes_4'), public.cfg('build.minutes_5')),
      'speed', (select case when is_admin then build_speed else 1 end from public.players where id = p_player_id),
      'brigades', (select jsonb_agg(jsonb_build_object('id', br, 'name', public.brigade_name(br),
                                                       'time', public.cfg('build.' || br || '_time'),
                                                       'price', public.cfg('build.' || br || '_price')) order by n)
                     from unnest(array['econom', 'standard', 'express']) with ordinality u(br, n))),
    'street', jsonb_build_object(
      'district', jsonb_build_array(public.cfg('street.district_1'), public.cfg('street.district_2')),
      'weather', public.street_weather()),
    'npc_niches', (select jsonb_object_agg(k, names) from (
                     select kind k, jsonb_agg(name order by id) names from public.npc_niches
                      where active and kind in ('marketplace', 'pvz') group by kind) x),
    'upgrade', jsonb_build_object(
      'max_level', public.cfg('upgrade.max_level'),
      'capacity_step', public.cfg('upgrade.capacity_step'),
      'sales_step', public.cfg('upgrade.sales_step'),
      'min_pct', public.cfg('repair.min_pct'), 'max_pct', public.cfg('repair.max_pct'),
      'queue', public.cfg('repair.queue'), 'minutes', public.cfg('repair.minutes'),
      'costs', (select jsonb_object_agg(bb.type, public.upgrade_cost(bb.type, bb.level + 1))
                  from public.businesses bb where bb.player_id = p_player_id)),
    'ads', jsonb_build_object(
      'boost', public.cfg('agency.boost'),
      'minutes', public.cfg('agency.minutes'),
      'max', public.cfg('agency.max_per_business'),
      'npc_price', public.cfg('agency.npc_price'),
      'npc_name', 'Громкий голос',
      'npc', (select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'price', public.npc_price(n))
                               order by public.npc_price(n))
                from public.npc_niches n where n.kind = 'agency' and n.active),
      'minutes_per_campaign', public.cfg('agency.minutes_per_campaign')),
    'markets', (
      select jsonb_agg(jsonb_build_object(
               'market', mk.market, 'name', mk.name, 'ref_price', mk.ref_price,
               'market_price', mk.market_price, 'demand_level', mk.demand_level,
               'sellers', mk.sellers, 'last_demand', mk.last_demand,
               'players', (select count(*) from public.businesses b join public.business_types t using (type)
                            where t.market = mk.market),
               'bots', coalesce((select jsonb_agg(jsonb_build_object(
                                   'name', n.name, 'kind', n.kind, 'price', n.price, 'last_sold', n.last_sold) order by n.id)
                                 from public.npc_sellers n where n.market = mk.market and n.active), '[]'::jsonb)))
      from public.markets mk),
    'capital', v_cap,
    'start_capital', public.start_capital(),
    'league', public.league_of(v_cap),
    -- Место среди игроков той же лиги.
    'league_place', (select count(*) + 1 from public.capitals() c
                      where public.league_of(c.capital) = public.league_of(v_cap) and c.capital > v_cap),
    -- Капитал за последние сутки: [секунды unix, копейки].
    'capital_history', coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from s.taken_at)::bigint, s.capital)
                                                  order by s.taken_at)
                                   from public.capital_snapshots s
                                  where s.player_id = p_player_id and s.taken_at > now() - interval '24 hours'),
                                '[]'::jsonb),
    'season', (select jsonb_build_object('number', s.id, 'starts_at', s.starts_at, 'ends_at', s.ends_at)
                 from public.seasons s where not s.finished order by s.id desc limit 1),
    'decision', (select jsonb_build_object(
                   'title', d.title, 'body', d.body,
                   'options', (select jsonb_agg(jsonb_build_object('label', o ->> 'label', 'hint', o ->> 'hint'))
                                 from jsonb_array_elements(d.options) o),
                   'choice', pd.choice, 'result', pd.result, 'success', pd.success)
                   from public.decisions d where d.id = pd.decision_id),
    -- Реклама показывается на карточках бизнесов, здесь — только эффекты решений дня.
    'effects', coalesce((select jsonb_agg(jsonb_build_object(
                           'label', e.label, 'kind', e.kind, 'market', e.market, 'mult', e.mult, 'until', e.until)
                           order by e.until)
                         from public.player_effects e
                         where e.player_id = p_player_id and e.until > now() and e.kind <> 'ad'), '[]'::jsonb),
    'discount', public.effect_mult(p_player_id, 'discount', null),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'text', x.text, 'at', x.created_at,
                                                                   'read', x.read_at is not null) order by x.id desc)
                                 from (select * from public.notifications where player_id = p_player_id
                                        order by id desc limit 20) x), '[]'::jsonb),
    'unread', (select count(*) from public.notifications where player_id = p_player_id and read_at is null)
  ) into result;
  return result;
end;
$function$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
