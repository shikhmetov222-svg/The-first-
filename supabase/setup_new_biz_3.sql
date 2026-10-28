-- CAPITAL: новые бизнесы, этап 3 — уровни бизнесов и ремонтная бригада.
-- Откройте ПУСТУЮ вкладку SQL Editor, вставьте весь текст и нажмите Run один раз.
begin;

-- Новые бизнесы, волна 1, этап 3: уровни бизнесов (1–5) и ремонтная бригада.
--
-- Уровень: +25% к складу и +10% к продажам за каждый уровень выше первого.
-- Улучшение до уровня N стоит 40% цены открытия × N и требует ремонта. Подрядчики:
--   бригада другого игрока — её цена 5–20% стоимости улучшения, 1 заказ за 2 часа, очередь до 5;
--   своя бригада — по себестоимости 5%;
--   NPC-подрядчик «СтройБыт» — всегда, 20%, 4 часа.
-- Деньги: стоимость улучшения (материалы) уходит из игры сразу; плата бригаде игрока держится
-- в заказе и приходит ей после выполнения, минус 5% комиссии — как сделка на рынке.

insert into public.balance_config (key, value, description) values
  ('upgrade.max_level',      5,    'Улучшения: максимальный уровень бизнеса'),
  ('upgrade.cost_share',     0.4,  'Улучшения: цена = цена открытия × это число × номер нового уровня'),
  ('upgrade.capacity_step',  0.25, 'Улучшения: прибавка к складу за уровень'),
  ('upgrade.sales_step',     0.1,  'Улучшения: прибавка к продажам (и скорости производства) за уровень'),
  ('repair.minutes',         120,  'Бригада игрока: минут на один заказ'),
  ('repair.queue',           5,    'Бригада игрока: заказов в очереди (вместе с текущим)'),
  ('repair.min_pct',         0.05, 'Бригада игрока: минимальная цена работы, доля стоимости улучшения'),
  ('repair.max_pct',         0.20, 'Бригада игрока: максимальная цена работы'),
  ('repair.default_pct',     0.12, 'Бригада игрока: цена работы по умолчанию'),
  ('repair.self_pct',        0.05, 'Своя бригада: себестоимость работы'),
  ('repair.npc_pct',         0.20, 'NPC-подрядчик: цена работы'),
  ('repair.npc_minutes',     240,  'NPC-подрядчик: минут на заказ'),
  ('repair.late_grace',      10,   'Сколько минут опоздания ещё считается «вовремя»');

insert into public.business_types
  (type, name, product, sort, open_cost, unit_cost, ref_price, capacity, raw_capacity, base_demand, production_rate,
   category, description, link_text)
values
  ('repair', 'Ремонтная бригада', 'ремонт', 7, 5000000, 0, null, 5, 0, 0, 0, 'services',
   'Делает ремонт для улучшения бизнесов',
   'Без ремонта не улучшить ни один бизнес');

insert into public.balance_config (key, value, description) values
  ('biz.repair.open_cost', 5000000, 'Цена открытия, коп.');

alter table public.businesses
  add column level      int not null default 1 check (level between 1 and 10),
  add column repair_pct numeric not null default 0.12;

alter table public.market_trades drop constraint market_trades_kind_check;
alter table public.market_trades add constraint market_trades_kind_check
  check (kind in ('lot', 'wholesale', 'business', 'repair'));

-- ================= Уровни =================

-- Склад с учётом уровня.
create function public.lvl_cap(p_cap int, p_level int) returns int
language sql stable set search_path = ''
as $$ select floor(p_cap * (1 + public.cfg('upgrade.capacity_step') * (coalesce(p_level, 1) - 1)))::int $$;

-- Множитель продаж (и скорости производства) с учётом уровня.
create function public.lvl_sales(p_level int) returns numeric
language sql stable set search_path = ''
as $$ select 1 + public.cfg('upgrade.sales_step') * (coalesce(p_level, 1) - 1) $$;

-- Цена улучшения до уровня p_to (в целых рублях).
create function public.upgrade_cost(p_type text, p_to int) returns bigint
language sql stable set search_path = ''
as $$
  select (round(t.open_cost * public.cfg('upgrade.cost_share') * p_to / 100) * 100)::bigint
    from public.business_types t where t.type = p_type
$$;

-- Сколько всего вложено в улучшения бизнеса уровня p_level (для капитала и оценки).
create function public.upgrades_spent(p_type text, p_level int) returns bigint
language sql stable set search_path = ''
as $$
  select coalesce(sum(public.upgrade_cost(p_type, k)), 0)::bigint from generate_series(2, coalesce(p_level, 1)) k
$$;

-- ================= Заказы ремонта =================
create table public.repair_orders (
  id               bigint generated always as identity primary key,
  customer_id      uuid not null references public.players(id) on delete cascade,
  business_id      uuid not null references public.businesses(id) on delete cascade,
  business_type    text not null,
  to_level         int not null,
  kind             text not null check (kind in ('crew', 'self', 'npc')),
  crew_business_id uuid references public.businesses(id) on delete set null,
  crew_player_id   uuid references public.players(id) on delete set null,  -- владелец бригады в момент заказа
  upgrade_cost     bigint not null,
  fee              bigint not null,    -- цена работы бригады
  flags            text[] not null default '{}',
  status           text not null default 'queued' check (status in ('queued', 'working', 'done', 'cancelled')),
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finish_at        timestamptz,       -- когда закончится текущая работа
  due_at           timestamptz not null, -- обещанный срок (по очереди в момент заказа)
  finished_at      timestamptz,
  on_time          boolean
);
create unique index repair_orders_one_active on public.repair_orders (business_id) where status in ('queued', 'working');
create index repair_orders_crew on public.repair_orders (crew_business_id, status);
create index repair_orders_customer on public.repair_orders (customer_id, created_at desc);
alter table public.repair_orders enable row level security;
revoke all on public.repair_orders from anon, authenticated;

-- Когда бригада освободится (по очереди активных заказов).
create function public.crew_free_at(p_crew uuid) returns timestamptz
language sql stable set search_path = ''
as $$
  select greatest(now(), coalesce(max(coalesce(finish_at, due_at)), now()))
    from public.repair_orders where crew_business_id = p_crew and status in ('queued', 'working')
$$;

-- Рейтинг бригады: доля заказов, выполненных вовремя (null — заказов ещё не было).
create function public.crew_rating(p_crew uuid) returns numeric
language sql stable set search_path = ''
as $$
  select round(avg(case when on_time then 1 else 0 end), 2)
    from public.repair_orders where crew_business_id = p_crew and status = 'done' and kind = 'crew'
$$;

-- Бригада берёт следующий заказ из очереди, если свободна.
create function public.crew_start_next(p_crew uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  v_id bigint;
begin
  if exists (select 1 from public.repair_orders where crew_business_id = p_crew and status = 'working') then return; end if;
  select id into v_id from public.repair_orders
   where crew_business_id = p_crew and status = 'queued' order by id limit 1 for update;
  if v_id is null then return; end if;
  update public.repair_orders
     set status = 'working', started_at = now(),
         finish_at = now() + make_interval(mins => public.cfg('repair.minutes')::int)
   where id = v_id;
end;
$$;

-- ---------- Предложения подрядчиков для улучшения бизнеса ----------
create function public.repair_offers(p_player uuid, p_type text) returns jsonb
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

  -- NPC-подрядчик есть всегда.
  offers := offers || jsonb_build_array(jsonb_build_object(
    'kind', 'npc', 'id', null, 'name', 'СтройБыт',
    'pct', public.cfg('repair.npc_pct'),
    'fee', (round(v_cost * public.cfg('repair.npc_pct') / 100) * 100)::bigint,
    'wait_minutes', public.cfg('repair.npc_minutes')::int,
    'rating', null, 'queue', 0, 'full', false));

  return jsonb_build_object(
    'type', p_type, 'level', b.level, 'to_level', v_to, 'cost', v_cost,
    'capacity_step', public.cfg('upgrade.capacity_step'), 'sales_step', public.cfg('upgrade.sales_step'),
    'active', exists (select 1 from public.repair_orders where business_id = b.id and status in ('queued', 'working')),
    'offers', offers);
end;
$$;

-- ---------- Заказать улучшение ----------
-- p_contractor: 'npc', 'self' или id бригады другого игрока.
create function public.order_upgrade(p_player uuid, p_type text, p_contractor text) returns text
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
  if exists (select 1 from public.repair_orders where business_id = b.id and status in ('queued', 'working')) then
    raise exception 'Этот бизнес уже ждёт ремонта';
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

-- «2 ч 30 мин», «45 мин».
create function public.fmt_minutes(p_min int) returns text
language sql immutable set search_path = ''
as $$
  select case when p_min >= 60 then (p_min / 60)::text || ' ч' || case when p_min % 60 > 0 then ' ' || (p_min % 60)::text || ' мин' else '' end
              else greatest(p_min, 1)::text || ' мин' end
$$;

-- Цена работы своей бригады (в процентах от стоимости улучшения).
create function public.set_repair_pct(p_player uuid, p_pct int) returns text
language plpgsql set search_path = ''
as $$
declare
  v numeric := p_pct / 100.0;
begin
  if p_pct is null or v < public.cfg('repair.min_pct') or v > public.cfg('repair.max_pct') then
    raise exception '%', format('Цена работы — от %s%% до %s%%', round(public.cfg('repair.min_pct') * 100),
                                round(public.cfg('repair.max_pct') * 100));
  end if;
  update public.businesses set repair_pct = v where player_id = p_player and type = 'repair';
  if not found then raise exception 'Сначала открой ремонтную бригаду'; end if;
  return format('Цена работы: %s%% от стоимости улучшения', p_pct);
end;
$$;

-- ---------- Выполнение заказов (каждый тик) ----------
create function public.process_repairs() returns void
language plpgsql set search_path = ''
as $$
declare
  r      record;
  v_comm bigint;
  v_name text;
  v_crew uuid;
begin
  -- Бригада исчезла (удалена) — заказ отменяется, деньги возвращаются заказчику.
  for r in select * from public.repair_orders
            where status in ('queued', 'working') and kind <> 'npc' and crew_business_id is null for update skip locked loop
    update public.players set cash = cash + r.upgrade_cost + case when r.kind = 'crew' then r.fee else 0 end
     where id = r.customer_id;
    update public.repair_orders set status = 'cancelled', finished_at = now() where id = r.id;
    insert into public.notifications (player_id, kind, text)
    values (r.customer_id, 'repair_cancelled', 'Бригада закрылась — заказ ремонта отменён, деньги вернулись');
  end loop;

  for r in select * from public.repair_orders
            where status = 'working' and finish_at <= now() order by finish_at for update skip locked loop
    v_name := (select name from public.business_types where type = r.business_type);
    update public.businesses set level = greatest(level, r.to_level) where id = r.business_id;
    update public.repair_orders
       set status = 'done', finished_at = now(),
           on_time = now() <= due_at + make_interval(mins => public.cfg('repair.late_grace')::int)
     where id = r.id;

    -- Плата бригаде другого игрока — минус 5% комиссии, как сделка на рынке.
    if r.kind = 'crew' then
      select player_id into v_crew from public.businesses where id = r.crew_business_id;
      v_comm := ceil(r.fee * 0.05)::bigint;
      update public.players set cash = cash + r.fee - v_comm where id = v_crew;
      insert into public.market_trades (kind, seller_id, buyer_id, product, qty, price, total, fee, flags)
      values ('repair', v_crew, r.customer_id, r.business_type, r.to_level, r.fee, r.fee, v_comm, r.flags);
    end if;

    insert into public.notifications (player_id, kind, text)
    values (r.customer_id, 'repair_done', format('Ремонт завершён: %s теперь ур. %s', v_name, r.to_level));

    if r.crew_business_id is not null then perform public.crew_start_next(r.crew_business_id); end if;
  end loop;

  -- Бригады, у которых в очереди что-то есть, а работа не идёт (например, после сбоя).
  for r in select distinct crew_business_id from public.repair_orders
            where status = 'queued' and crew_business_id is not null loop
    perform public.crew_start_next(r.crew_business_id);
  end loop;
end;
$$;

-- ---------- Панель разработчика ----------
create function public.dev_finish_repairs(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a   public.players := public.dev_lock_admin(p_admin);
  v_n int;
begin
  update public.repair_orders
     set status = 'working', started_at = coalesce(started_at, now()), finish_at = now()
   where customer_id = a.id and status in ('queued', 'working');
  get diagnostics v_n = row_count;
  perform public.process_repairs();
  perform public.dev_write_log(a, 'finish_repairs', jsonb_build_object('orders', v_n));
  return format('Ремонтов завершено: %s', v_n);
end;
$$;

create function public.dev_set_level(p_admin uuid, p_type text, p_level int) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  if p_level is null or p_level < 1 or p_level > public.cfg('upgrade.max_level') then raise exception 'Неверный уровень'; end if;
  if p_type = 'repair' then raise exception 'Бригаду улучшить нельзя'; end if;
  update public.businesses set level = p_level where player_id = a.id and type = p_type and not listed;
  if not found then raise exception 'Нет такого бизнеса (или он на продаже)'; end if;
  perform public.dev_write_log(a, 'set_level', jsonb_build_object('type', p_type, 'level', p_level));
  return format('Уровень: %s', p_level);
end;
$$;


-- ================= Склад и продажи с учётом уровня =================

-- Закупка: склад с учётом уровня.
CREATE OR REPLACE FUNCTION public.restock(p_player_id uuid, p_type text, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  t    public.business_types;
  b    public.businesses;
  p    public.players;
  cost bigint;
  v_free int;
begin
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Неверное количество'; end if;

  select * into p from public.players where id = p_player_id for update;
  select * into b from public.businesses where player_id = p_player_id and type = p_type for update;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
  select * into t from public.business_types where type = p_type;
  if t.unit_cost <= 0 then raise exception 'Этот бизнес не закупает товар у поставщика'; end if;

  if t.production_rate > 0 then
    v_free := public.lvl_cap(t.raw_capacity, b.level) - b.raw_stock;
  else
    v_free := public.lvl_cap(t.capacity, b.level) - b.stock;
  end if;
  if p_qty > v_free then raise exception 'На складе осталось место только для % шт.', v_free; end if;

  cost := ceil(p_qty::numeric * t.unit_cost
               * greatest(0.5, public.effect_mult(p_player_id, 'discount', null)))::bigint;
  if p.cash < cost then raise exception 'Не хватает денег: нужно %', public.fmt_rub(cost); end if;

  update public.players set cash = cash - cost where id = p_player_id;
  if t.production_rate > 0 then
    update public.businesses set raw_stock = raw_stock + p_qty where id = b.id;
  else
    update public.businesses set stock = stock + p_qty where id = b.id;
  end if;
end;
$function$;

-- Хлеб в магазин: склад магазина с учётом уровня.
CREATE OR REPLACE FUNCTION public.transfer_bread(p_player_id uuid, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  bakery public.businesses;
  shop   public.businesses;
  cap    int;
begin
  if p_qty is null or p_qty < 1 then raise exception 'Неверное количество'; end if;

  select * into bakery from public.businesses where player_id = p_player_id and type = 'bakery' for update;
  if not found then raise exception 'У тебя нет пекарни'; end if;
  select * into shop from public.businesses where player_id = p_player_id and type = 'shop' for update;
  if not found then raise exception 'У тебя нет магазина'; end if;
  cap := public.lvl_cap((select capacity from public.business_types where type = 'shop'), shop.level);

  if p_qty > bakery.stock then raise exception 'В пекарне только % шт. хлеба', bakery.stock; end if;
  if p_qty > cap - shop.stock then raise exception 'В магазине место только для % шт.', cap - shop.stock; end if;

  update public.businesses set stock = stock - p_qty where id = bakery.id;
  update public.businesses set stock = stock + p_qty where id = shop.id;
end;
$function$;

-- Покупка лота: склад с учётом уровня.
CREATE OR REPLACE FUNCTION public.buy_lot(p_buyer uuid, p_lot bigint, p_qty integer, p_dest text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  l       public.market_lots;
  b       public.players;
  s       public.players;
  v_dest  text;
  v_free  int;
  v_total bigint;
  v_fee   bigint;
  v_flags text[] := '{}';
  v_pair  int;
  v_got   bigint;
  v_cap   bigint;
begin
  if p_qty is null or p_qty < 1 then raise exception 'Неверное количество'; end if;

  -- 1. Лот.
  select * into l from public.market_lots where id = p_lot for update;
  if not found or l.kind <> 'goods' or l.status <> 'active' or l.expires_at <= now() then
    raise exception 'Лот уже недоступен';
  end if;
  if l.seller_id = p_buyer then raise exception 'Нельзя купить свой лот'; end if;
  if p_qty > l.qty_left then raise exception 'В лоте осталось только % шт.', l.qty_left; end if;

  -- Лот бота: товар «из города», деньги уходят из игры; защита от перекачки не нужна.
  if l.npc_id is not null then
    select * into b from public.players where id = p_buyer for update;
    if b.is_test then raise exception 'Лот уже недоступен'; end if;
    if l.product = 'campaign' then raise exception 'Лот уже недоступен'; end if;
    v_dest := case when p_dest = 'marketplace' then 'marketplace' else public.goods_dest(p_buyer, l.product) end;
    if v_dest is null then
      raise exception 'Некуда положить товар: открой %',
        case l.product when 'coffee' then 'кофейню' when 'flour' then 'пекарню' else 'магазин или пекарню' end;
    end if;
    if v_dest = 'marketplace' then
      v_free := 1000000; -- проверит put_marketplace
    else
      select case when l.product = 'flour' then public.lvl_cap(t.raw_capacity, bz.level) - bz.raw_stock
                  else public.lvl_cap(t.capacity, bz.level) - bz.stock end
        into v_free
        from public.businesses bz join public.business_types t using (type)
       where bz.player_id = p_buyer and bz.type = v_dest
         for update of bz;
    end if;
    if p_qty > v_free then raise exception 'На складе место только для % шт.', greatest(v_free, 0); end if;
    v_total := p_qty::bigint * l.price;
    if b.cash < v_total then raise exception 'Не хватает денег: нужно %', public.fmt_rub(v_total); end if;

    update public.players set cash = cash - v_total where id = b.id;
    if v_dest = 'marketplace' then
      perform public.put_marketplace(p_buyer, l.product, p_qty);
    else
      update public.businesses
         set stock = case when l.product = 'flour' then stock else stock + p_qty end,
             raw_stock = case when l.product = 'flour' then raw_stock + p_qty else raw_stock end
       where player_id = p_buyer and type = v_dest;
    end if;
    update public.market_lots
       set qty_left = qty_left - p_qty,
           status = case when qty_left - p_qty = 0 then 'sold' else 'active' end,
           closed_at = case when qty_left - p_qty = 0 then now() end
     where id = l.id;
    insert into public.market_trades (lot_id, kind, buyer_id, npc_id, product, qty, price, total)
    values (l.id, 'lot', b.id, l.npc_id, l.product, p_qty, l.price, v_total);
    return format('Куплено %s шт. за %s', p_qty, public.fmt_rub(v_total));
  end if;

  -- 2. Игроки — всегда по возрастанию id.
  if p_buyer < l.seller_id then
    select * into b from public.players where id = p_buyer for update;
    select * into s from public.players where id = l.seller_id for update;
  else
    select * into s from public.players where id = l.seller_id for update;
    select * into b from public.players where id = p_buyer for update;
  end if;

  -- Лоты тестовых игроков видит и покупает только администратор.
  if s.is_test and not b.is_admin then raise exception 'Лот уже недоступен'; end if;
  -- Тестовые игроки покупают только у администратора.
  if b.is_test and not s.is_admin then raise exception 'Лот уже недоступен'; end if;

  -- 3. Куда товар: кампания — сразу в рекламу бизнеса, остальное — на склад.
  if l.product = 'campaign' then
    if p_dest is null or p_dest = 'marketplace' then raise exception 'Выбери бизнес для рекламы'; end if;
    v_dest := 'ad';
  else
    v_dest := case when p_dest = 'marketplace' then 'marketplace' else public.goods_dest(p_buyer, l.product) end;
    if v_dest is null then
      raise exception 'Некуда положить товар: открой %',
        case l.product when 'coffee' then 'кофейню' when 'flour' then 'пекарню' else 'магазин или пекарню' end;
    end if;
    if v_dest = 'marketplace' then
      v_free := 1000000; -- проверит put_marketplace
    else
      select case when l.product = 'flour' then public.lvl_cap(t.raw_capacity, bz.level) - bz.raw_stock
                  else public.lvl_cap(t.capacity, bz.level) - bz.stock end
        into v_free
        from public.businesses bz join public.business_types t using (type)
       where bz.player_id = p_buyer and bz.type = v_dest
         for update of bz;
    end if;
    if p_qty > v_free then raise exception 'На складе место только для % шт.', greatest(v_free, 0); end if;
  end if;

  v_total := p_qty::bigint * l.price;
  if b.cash < v_total then raise exception 'Не хватает денег: нужно %', public.fmt_rub(v_total); end if;
  v_fee := ceil(v_total * 0.05)::bigint;

  -- 4. Защита от перекачки денег (кроме сделок администратора).
  if not (b.is_admin or s.is_admin) then
    select count(*) into v_pair from public.market_trades
     where kind in ('lot', 'business') and buyer_id = p_buyer and seller_id = s.id and created_at > now() - interval '24 hours';
    if v_pair >= 3 then raise exception 'Не больше 3 покупок в сутки у одного продавца'; end if;
    if v_pair >= 2 then v_flags := array_append(v_flags, 'frequent'); end if;

    if b.referred_by = s.id or s.referred_by = b.id then v_flags := array_append(v_flags, 'friends'); end if;

    select coalesce(sum(total - fee), 0) into v_got from public.market_trades
     where kind in ('lot', 'business') and buyer_id = p_buyer and seller_id = s.id and created_at > now() - interval '24 hours';
    select capital into v_cap from public.capitals() where player_id = s.id;
    if v_got + v_total - v_fee > 0.3 * greatest(coalesce(v_cap, 0), 1) then
      v_flags := array_append(v_flags, 'big_share');
    end if;
  end if;

  -- 5. Сделка: деньги, товар (или реклама), лот, запись.
  update public.players set cash = cash - v_total where id = b.id;
  update public.players set cash = cash + v_total - v_fee where id = s.id;
  if v_dest = 'ad' then
    perform public.add_ads(p_buyer, p_dest, p_qty, format('Реклама от «%s»', coalesce(s.company_name, s.first_name)));
  elsif v_dest = 'marketplace' then
    perform public.put_marketplace(p_buyer, l.product, p_qty);
  else
    update public.businesses
       set stock = case when l.product = 'flour' then stock else stock + p_qty end,
           raw_stock = case when l.product = 'flour' then raw_stock + p_qty else raw_stock end
     where player_id = p_buyer and type = v_dest;
  end if;
  update public.market_lots
     set qty_left = qty_left - p_qty,
         status = case when qty_left - p_qty = 0 then 'sold' else 'active' end,
         closed_at = case when qty_left - p_qty = 0 then now() end
   where id = l.id;
  insert into public.market_trades (lot_id, kind, seller_id, buyer_id, product, qty, price, total, fee, flags)
  values (l.id, 'lot', s.id, b.id, l.product, p_qty, l.price, v_total, v_fee, v_flags);

  if v_dest = 'ad' then
    return format('Реклама запущена: %s кампани%s за %s', p_qty, case when p_qty = 1 then 'я' else 'и' end,
                  public.fmt_rub(v_total));
  end if;
  return format('Куплено %s шт. за %s', p_qty, public.fmt_rub(v_total));
end;
$function$;

-- Склад маркетплейса с учётом уровня.
CREATE OR REPLACE FUNCTION public.put_marketplace(p_player uuid, p_product text, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id   uuid;
  v_cap  int;
  v_have int;
begin
  select b.id, public.lvl_cap(t.capacity, b.level) into v_id, v_cap
    from public.businesses b join public.business_types t using (type)
   where b.player_id = p_player and b.type = 'marketplace' for update of b;
  if not found then raise exception 'Сначала открой магазин на маркетплейсе'; end if;
  select coalesce(sum(qty), 0) into v_have from public.business_goods where business_id = v_id;
  if p_qty > v_cap - v_have then raise exception 'На складе маркетплейса место только для % шт.', greatest(v_cap - v_have, 0); end if;
  insert into public.business_goods (business_id, product, qty) values (v_id, p_product, p_qty)
  on conflict (business_id, product) do update set qty = public.business_goods.qty + excluded.qty;
end;
$function$;

-- Тик: уровни (+10% продаж и производства) и выполнение ремонтов.
CREATE OR REPLACE FUNCTION public.tick()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r          record;
  m          record;
  v_produced int;
  v_hour     int := extract(hour from now() at time zone 'Europe/Moscow');
  v_players  int;
  v_bots     int;
  v_total    int;
  v_mprice   numeric;
  v_demand   numeric;
  v_w        numeric;
  v_avg      numeric;
  v_left     numeric;
begin
  -- 1. Производство (пекарни).
  for r in
    select b.id, b.player_id, b.stock, b.raw_stock,
           floor(t.production_rate * public.lvl_sales(b.level))::int as production_rate,
           public.lvl_cap(t.capacity, b.level) as capacity
      from public.businesses b
      join public.business_types t using (type)
     where t.production_rate > 0 and b.raw_stock > 0 and not b.listed
       for update of b
  loop
    v_produced := greatest(0, least(r.production_rate, r.raw_stock, r.capacity - r.stock));
    if v_produced > 0 then
      update public.businesses
         set stock = stock + v_produced, raw_stock = raw_stock - v_produced
       where id = r.id;
      insert into public.sales_log (business_id, player_id, produced, stock_left)
      values (r.id, r.player_id, v_produced, r.stock + v_produced);
    end if;
  end loop;

  -- 2. Рынки.
  create temp table if not exists _sellers (
    business_id uuid,
    player_id   uuid,
    npc_id      int,
    price       bigint,
    stock       int,
    w           numeric,
    want        numeric default 0,
    sold        int default 0
  ) on commit drop;

  for m in select * from public.markets for update loop
    truncate _sellers;

    select count(*) into v_players
      from public.businesses b
      join public.business_types t using (type)
      join public.players pl on pl.id = b.player_id
     where t.market = m.market and not pl.is_test;

    -- Боты: автоматически по числу игроков или столько, сколько задал разработчик.
    update public.npc_sellers n
       set active = case
             when m.bot_override is null then v_players < n.max_players
             else n.id in (select id from public.npc_sellers where market = m.market order by id limit m.bot_override)
           end
     where n.market = m.market;
    select count(*) into v_bots from public.npc_sellers where market = m.market and active;
    v_total := greatest(1, v_players + v_bots);

    -- Больше продавцов → ниже рыночная цена.
    v_mprice := m.ref_price * least(1.15, greatest(0.7, power(v_total / 6.0, -0.3)));

    -- Боты подстраивают цену под рынок с небольшим разбросом.
    update public.npc_sellers
       set price = round(v_mprice * price_mult * (0.97 + random() * 0.06) / 100) * 100
     where market = m.market and active;

    -- Покупатели: больше продавцов — больше покупателей, но медленнее, чем растёт число продавцов.
    v_demand := m.base_demand * 6 * power(v_total / 6.0, 0.7)
                * public.hour_factor(m.market, v_hour) * (0.85 + random() * 0.3);

    insert into _sellers (business_id, player_id, price, stock, w)
    select b.id, b.player_id, b.price, b.stock,
           power(v_mprice / b.price, 3) * public.effect_mult(b.player_id, 'demand', m.market)
           * public.ad_mult(b.player_id, b.type) * public.lvl_sales(b.level)
      from public.businesses b
      join public.business_types t using (type)
      join public.players pl on pl.id = b.player_id
     where t.market = m.market and b.stock > 0 and b.price > 0 and not pl.is_test and not b.listed;

    insert into _sellers (npc_id, price, stock, w)
    select id, price, 1000000, appeal * power(v_mprice / price, 3)
      from public.npc_sellers where market = m.market and active and price > 0;

    select sum(w), sum(w * price) / nullif(sum(w), 0) into v_w, v_avg from _sellers;

    if v_w > 0 then
      -- Если все продают дороже рынка, покупателей меньше.
      v_demand := v_demand * least(2, greatest(0.3, power(v_mprice / v_avg, 1.2)));

      update _sellers set want = v_demand * w / v_w;
      update _sellers set sold = least(stock, floor(want + random())::int);

      -- Покупатели, не нашедшие товар, частично уходят к тем, у кого он есть.
      select sum(greatest(0, want - sold)) * 0.6 into v_left from _sellers;
      select sum(w) into v_w from _sellers where stock > sold;
      if v_left > 0 and v_w > 0 then
        update _sellers
           set sold = sold + least(stock - sold, floor(v_left * w / v_w + random())::int)
         where stock > sold;
      end if;

      update public.businesses b
         set stock = b.stock - s.sold,
             pending_revenue = b.pending_revenue + s.sold::bigint * s.price
        from _sellers s
       where s.business_id = b.id and s.sold > 0;

      insert into public.sales_log (business_id, player_id, sold, revenue, stock_left)
      select s.business_id, s.player_id, s.sold, s.sold::bigint * s.price, s.stock - s.sold
        from _sellers s
       where s.business_id is not null and s.sold > 0;
    end if;

    update public.npc_sellers n
       set last_sold = coalesce((select s.sold from _sellers s where s.npc_id = n.id), 0)
     where n.market = m.market;

    update public.markets
       set market_price = round(v_mprice / 100) * 100,
           demand_level = public.hour_factor(m.market, v_hour),
           sellers = v_players + v_bots,
           last_demand = coalesce((select sum(sold) from _sellers), 0),
           updated_at = now()
     where market = m.market;
  end loop;

  -- 3. Онлайн-бизнесы и агентства.
  perform public.tick_online();

  -- 4. Ремонтные заказы.
  perform public.process_repairs();

  delete from public.sales_log where tick_at < now() - interval '8 days';
  delete from public.player_effects where until < now() - interval '1 hour';
end;
$function$;

-- Онлайн-бизнесы и агентства: уровни.
CREATE OR REPLACE FUNCTION public.tick_online()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r          record;
  g          record;
  v_hour     int := extract(hour from now() at time zone 'Europe/Moscow');
  v_units    int;
  v_sold     int;
  v_revenue  bigint;
  v_parcels  int := 0;
  v_pvz      int;
  v_live     int;
  v_bg       numeric;
  v_left     int;
  v_cap_sum  numeric;
  v_give     int;
  v_picked   int;
  v_step     numeric := 5 / greatest(1, public.cfg('agency.minutes_per_campaign'));
  v_made     int;
begin
  -- 0. Агентства делают кампании (1 за 30 минут = 1/6 за тик). Полный склад — работа стоит.
  for r in
    select b.id, b.player_id, b.stock, b.work_progress, public.lvl_cap(t.capacity, b.level) as capacity,
           public.lvl_sales(b.level) as speed
      from public.businesses b join public.business_types t using (type)
     where b.type = 'agency' and not b.listed
       for update of b
  loop
    if r.stock >= r.capacity then
      update public.businesses set work_progress = 0 where id = r.id;
      continue;
    end if;
    v_made := least(floor(r.work_progress + v_step * r.speed)::int, r.capacity - r.stock);
    update public.businesses
       set stock = stock + v_made,
           work_progress = case when r.stock + v_made >= r.capacity then 0
                                else r.work_progress + v_step * r.speed - floor(r.work_progress + v_step * r.speed) end
     where id = r.id;
    if v_made > 0 then
      insert into public.sales_log (business_id, player_id, produced, stock_left)
      values (r.id, r.player_id, v_made, r.stock + v_made);
    end if;
  end loop;

  -- 1. Маркетплейсы.
  for r in
    select b.id, b.player_id, public.lvl_sales(b.level) as lv from public.businesses b join public.players p on p.id = b.player_id
     where b.type = 'marketplace' and not b.listed and not p.is_test
       for update of b
  loop
    v_sold := 0;
    v_revenue := 0;
    for g in select * from public.business_goods where business_id = r.id and qty > 0 for update loop
      v_units := floor(
        (select base_demand from public.markets where market = case g.product when 'coffee' then 'coffee' else 'bread' end)
        * public.hour_factor(case g.product when 'coffee' then 'coffee' else 'bread' end, v_hour)
        * public.cfg('marketplace.demand_mult')
        * public.effect_mult(r.player_id, 'demand', 'marketplace')
        * public.ad_mult(r.player_id, 'marketplace') * r.lv
        * (0.85 + random() * 0.3) + random())::int;
      v_units := least(v_units, g.qty);
      if v_units > 0 then
        update public.business_goods set qty = qty - v_units where business_id = r.id and product = g.product;
        v_sold := v_sold + v_units;
        v_revenue := v_revenue + floor(v_units * public.marketplace_price(g.product) * (1 - public.cfg('marketplace.fee')))::bigint;
      end if;
    end loop;
    if v_sold > 0 then
      update public.businesses set pending_revenue = pending_revenue + v_revenue where id = r.id;
      insert into public.sales_log (business_id, player_id, sold, revenue, stock_left)
      values (r.id, r.player_id, v_sold, v_revenue,
              (select coalesce(sum(qty), 0) from public.business_goods where business_id = r.id));
      v_parcels := v_parcels + v_sold;
    end if;
  end loop;

  -- 2. ПВЗ: сначала покупатели забирают посылки с полок (это и есть доход), потом приходят новые.
  select count(*) into v_pvz from public.businesses b join public.players p on p.id = b.player_id
   where b.type = 'pvz' and not b.listed and not p.is_test;
  if v_pvz = 0 then return; end if;

  for r in
    select b.id, b.player_id, b.stock from public.businesses b join public.players p on p.id = b.player_id
     where b.type = 'pvz' and not b.listed and not p.is_test
       for update of b
  loop
    v_picked := case when r.stock > 0 then greatest(1, floor(r.stock * public.cfg('pvz.pickup_share'))::int) else 0 end;
    if v_picked > 0 then
      update public.businesses
         set stock = stock - v_picked,
             pending_revenue = pending_revenue + v_picked::bigint * public.cfg('pvz.parcel_income')::bigint
       where id = r.id;
      insert into public.sales_log (business_id, player_id, sold, revenue, stock_left)
      values (r.id, r.player_id, v_picked, v_picked::bigint * public.cfg('pvz.parcel_income')::bigint, r.stock - v_picked);
    end if;
  end loop;

  -- Фоновые посылки NPC: на каждый ПВЗ, по времени суток, меньше при большом числе живых игроков.
  select count(*) into v_live from public.players where not is_test and last_seen_at > now() - interval '24 hours';
  v_bg := public.cfg('pvz.bg_parcels_per_pvz') * v_pvz * public.hour_factor('bread', v_hour)
          * greatest(public.cfg('pvz.bg_floor'), 1 - v_live / public.cfg('pvz.bg_players_to_floor'));
  v_left := v_parcels + floor(v_bg + random())::int;

  -- Делим пропорционально вместимости полок × реклама; переполненные отдают лишнее остальным (два прохода).
  for i in 1..2 loop
    exit when v_left <= 0;
    select coalesce(sum(public.lvl_cap(t.capacity, b.level) * public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level)), 0) into v_cap_sum
      from public.businesses b join public.business_types t using (type) join public.players p on p.id = b.player_id
     where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < public.lvl_cap(t.capacity, b.level);
    exit when v_cap_sum = 0;
    for r in
      select b.id, b.stock, public.lvl_cap(t.capacity, b.level) as capacity,
             public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level) as w
        from public.businesses b join public.business_types t using (type)
        join public.players p on p.id = b.player_id
       where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < public.lvl_cap(t.capacity, b.level)
       order by random()
    loop
      v_give := least(r.capacity - r.stock, ceil(v_left::numeric * r.capacity * r.w / v_cap_sum)::int, v_left);
      if v_give > 0 then
        update public.businesses set stock = stock + v_give where id = r.id;
        v_left := v_left - v_give;
      end if;
    end loop;
  end loop;
end;
$function$;

-- Панель: склады с учётом уровня.
CREATE OR REPLACE FUNCTION public.dev_stock(p_admin uuid, p_mode text, p_product text, p_qty integer)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  a     public.players := public.dev_lock_admin(p_admin);
  v_type text;
  v_raw  boolean;
  v_before int;
  v_after  int;
begin
  perform 1 from public.businesses where player_id = a.id for update;

  if p_mode = 'fill' then
    update public.businesses b
       set stock = public.lvl_cap(t.capacity, b.level), raw_stock = public.lvl_cap(t.raw_capacity, b.level)
      from public.business_types t
     where t.type = b.type and b.player_id = a.id and t.category = 'classic';
    perform public.dev_write_log(a, 'stock_fill', '{}'::jsonb);
    return 'Все склады заполнены';
  elsif p_mode = 'clear' then
    update public.businesses set stock = 0, raw_stock = 0 where player_id = a.id;
    update public.business_goods set qty = 0
     where business_id in (select id from public.businesses where player_id = a.id);
    perform public.dev_write_log(a, 'stock_clear', '{}'::jsonb);
    return 'Все склады очищены';
  elsif p_mode <> 'add' then
    raise exception 'Неизвестный режим';
  end if;

  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Неверное количество'; end if;
  case p_product
    when 'coffee' then v_type := 'coffee'; v_raw := false;
    when 'bread'  then v_type := 'shop';   v_raw := false;
    when 'baked'  then v_type := 'bakery'; v_raw := false;
    when 'flour'  then v_type := 'bakery'; v_raw := true;
    else raise exception 'Неизвестный товар';
  end case;

  select case when v_raw then b.raw_stock else b.stock end into v_before
    from public.businesses b where b.player_id = a.id and b.type = v_type;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;

  update public.businesses b
     set stock     = case when v_raw then b.stock else least(public.lvl_cap(t.capacity, b.level), b.stock + p_qty) end,
         raw_stock = case when v_raw then least(public.lvl_cap(t.raw_capacity, b.level), b.raw_stock + p_qty) else b.raw_stock end
    from public.business_types t
   where t.type = b.type and b.player_id = a.id and b.type = v_type
  returning case when v_raw then b.raw_stock else b.stock end into v_after;

  perform public.dev_write_log(a, 'stock_add',
    jsonb_build_object('product', p_product, 'asked', p_qty, 'added', v_after - v_before));
  return format('Добавлено %s шт. (склад ограничен)', v_after - v_before);
end;
$function$;

-- Панель: склад агентства с учётом уровня.
CREATE OR REPLACE FUNCTION public.dev_campaigns(p_admin uuid, p_n integer)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  a        public.players := public.dev_lock_admin(p_admin);
  v_before int;
  v_after  int;
begin
  if p_n is null or p_n < 1 or p_n > 100 then raise exception 'Неверное количество'; end if;
  select stock into v_before from public.businesses where player_id = a.id and type = 'agency' for update;
  if not found then raise exception 'Сначала открой рекламное агентство'; end if;
  update public.businesses b set stock = least(public.lvl_cap(t.capacity, b.level), b.stock + p_n)
    from public.business_types t
   where t.type = b.type and b.player_id = a.id and b.type = 'agency'
  returning b.stock into v_after;
  perform public.dev_write_log(a, 'campaigns_add', jsonb_build_object('asked', p_n, 'added', v_after - v_before));
  return format('Выдано кампаний: %s (склад ограничен)', v_after - v_before);
end;
$function$;

-- Решение дня: склад муки с учётом уровня.
CREATE OR REPLACE FUNCTION public.decide(p_player_id uuid, p_option integer)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  pd      public.player_decisions;
  opt     jsonb;
  cost    bigint;
  ok      boolean;
  e       jsonb;
  outcome text;
begin
  perform public.today_decision(p_player_id);
  select * into pd from public.player_decisions
   where player_id = p_player_id and day = public.moscow_today() for update;
  if pd.choice is not null then raise exception 'Сегодня ты уже принял решение'; end if;

  select d.options -> p_option into opt from public.decisions d where d.id = pd.decision_id;
  if opt is null then raise exception 'Такого варианта нет'; end if;

  cost := coalesce((opt ->> 'cost')::bigint, 0);
  perform 1 from public.players where id = p_player_id for update;
  if (select cash from public.players where id = p_player_id) < cost then
    raise exception 'Не хватает денег: нужно %', public.fmt_rub(cost);
  end if;
  update public.players set cash = cash - cost where id = p_player_id;

  ok := (opt -> 'chance') is null or random() < (opt ->> 'chance')::numeric;
  outcome := case when ok then opt ->> 'result' else opt ->> 'fail_result' end;

  for e in select * from jsonb_array_elements(coalesce(opt -> (case when ok then 'effects' else 'fail_effects' end), '[]'))
  loop
    case e ->> 'kind'
      when 'demand', 'discount' then
        insert into public.player_effects (player_id, kind, market, mult, until, label)
        values (p_player_id, e ->> 'kind', e ->> 'market', (e ->> 'mult')::numeric,
                now() + make_interval(hours => (e ->> 'hours')::int), e ->> 'label');
      when 'cash' then
        update public.players set cash = greatest(0, cash + (e ->> 'amount')::bigint) where id = p_player_id;
      when 'raw' then
        update public.businesses b
           set raw_stock = least(public.lvl_cap(t.raw_capacity, b.level), b.raw_stock + (e ->> 'qty')::int)
          from public.business_types t
         where t.type = b.type and b.player_id = p_player_id and b.type = 'bakery';
    end case;
  end loop;

  update public.player_decisions
     set choice = p_option, success = ok, result = outcome
   where player_id = p_player_id and day = pd.day;
  return outcome;
end;
$function$;

-- Капитал: вложения в улучшения считаются как и цена открытия (70%).
CREATE OR REPLACE FUNCTION public.capitals()
 RETURNS TABLE(player_id uuid, first_name text, capital bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p.id, p.first_name,
         p.cash
         + coalesce((select sum(g.qty::bigint * public.goods_price(g.product))
                       from public.business_goods g join public.businesses bb on bb.id = g.business_id
                      where bb.player_id = p.id), 0)
         + coalesce(sum(
           b.pending_revenue
           + b.stock::bigint * (case when b.type = 'bakery'
                                     then (select unit_cost from public.business_types where type = 'shop')
                                     when b.type = 'agency' then public.wholesale_price('campaign')
                                     else t.unit_cost end)
           + b.raw_stock::bigint * t.unit_cost
           + (t.open_cost + public.upgrades_spent(b.type, b.level)) * 7 / 10), 0)::bigint
    from public.players p
    left join public.businesses b on b.player_id = p.id
    left join public.business_types t on t.type = b.type
   where not p.is_test
   group by p.id
$function$;

-- Оценка бизнеса: цена открытия + улучшения + товар.
CREATE OR REPLACE FUNCTION public.business_valuation(p_business uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select t.open_cost + public.upgrades_spent(b.type, b.level)
       + case b.type
           when 'coffee' then b.stock::bigint * public.goods_price('coffee')
           when 'agency' then b.stock::bigint * public.goods_price('campaign')
           when 'pvz' then 0
           when 'marketplace' then coalesce((select sum(g.qty::bigint * public.goods_price(g.product))
                                               from public.business_goods g where g.business_id = b.id), 0)
           else b.stock::bigint * public.goods_price('bread')
         end
       + b.raw_stock::bigint * public.goods_price('flour')
    from public.businesses b join public.business_types t using (type)
   where b.id = p_business
$function$;

-- Продажа бизнеса: нельзя, пока идёт ремонт или у бригады есть заказы.
CREATE OR REPLACE FUNCTION public.create_business_lot(p_player uuid, p_type text, p_price bigint)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  b      public.businesses;
  v_val  bigint;
  v_lo   bigint;
  v_hi   bigint;
begin
  perform 1 from public.players where id = p_player for update;
  if (select count(*) from public.market_lots where seller_id = p_player and status = 'active') >= 5 then
    raise exception 'Не больше 5 активных лотов';
  end if;
  select * into b from public.businesses where player_id = p_player and type = p_type for update;
  if not found then raise exception 'У тебя нет такого бизнеса'; end if;
  if b.listed then raise exception 'Этот бизнес уже выставлен'; end if;
  if exists (select 1 from public.repair_orders where business_id = b.id and status in ('queued', 'working')) then
    raise exception 'Бизнес ждёт ремонта — продать его можно после';
  end if;
  if exists (select 1 from public.repair_orders where crew_business_id = b.id and status in ('queued', 'working')) then
    raise exception 'У бригады есть заказы — сначала выполни их';
  end if;
  if exists (select 1 from public.market_lots
              where seller_id = p_player and kind = 'goods' and status = 'active' and source = p_type) then
    raise exception 'Сначала сними товарные лоты с этого бизнеса';
  end if;

  v_val := public.business_valuation(b.id);
  v_lo := ceil(v_val * 0.7 / 100) * 100;
  v_hi := floor(v_val * 1.5 / 100) * 100;
  if p_price is null or p_price % 100 <> 0 then raise exception 'Цена — в целых рублях'; end if;
  if p_price < v_lo or p_price > v_hi then
    raise exception 'Цена должна быть от % до %', public.fmt_rub(v_lo), public.fmt_rub(v_hi);
  end if;

  -- Выручку из кассы бизнеса забираем продавцу сразу — покупатель получает бизнес с пустой кассой.
  update public.players set cash = cash + b.pending_revenue where id = p_player;
  update public.businesses set pending_revenue = 0, listed = true where id = b.id;

  insert into public.market_lots (seller_id, kind, qty_total, qty_left, price, business_id, business_type, valuation, expires_at)
  values (p_player, 'business', 1, 1, p_price, b.id, b.type, v_val, now() + interval '48 hours');
  return format('Бизнес выставлен за %s', public.fmt_rub(p_price));
end;
$function$;

-- Уведомления: оплата заказа бригаде.
CREATE OR REPLACE FUNCTION public.notify_trade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.seller_id is null or new.kind not in ('lot', 'business', 'repair') then return new; end if;
  if new.kind = 'repair' then
    insert into public.notifications (player_id, kind, text)
    values (new.seller_id, 'repair_paid',
            format('Бригада выполнила заказ: +%s', public.fmt_rub(new.total - new.fee)));
    return new;
  end if;
  if new.kind = 'business' then
    insert into public.notifications (player_id, kind, text)
    values (new.seller_id, 'business_sold',
            format('Кто-то купил твой бизнес «%s»: +%s',
                   coalesce((select name from public.business_types where type = new.product), new.product),
                   public.fmt_rub(new.total - new.fee)));
  else
    insert into public.notifications (player_id, kind, text)
    values (new.seller_id, 'lot_sold',
            format('Твой лот %s продан: +%s (%s шт.)',
                   case new.product when 'coffee' then 'кофе' when 'bread' then 'хлеба'
                                    when 'campaign' then 'рекламных кампаний' else 'муки' end,
                   public.fmt_rub(new.total - new.fee), new.qty));
  end if;
  return new;
end;
$function$;

-- Состояние: уровни, склад с учётом уровня, ремонт, очередь бригады.
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

commit;
