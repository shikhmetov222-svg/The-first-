-- Новые бизнесы, волна 1, этап 4: NPC в новых нишах, панель разработчика, достижения, аналитика, баланс.

insert into public.balance_config (key, value, description) values
  ('npc.mp_competition', 0.15, 'NPC-маркетплейсы: на сколько каждый снижает спрос маркетплейса игрока (0.15 = делитель 1 + 0.15)'),
  ('npc.mp_parcels',     3,    'NPC-маркетплейсы: посылок за 5 минут от одного магазина (днём)'),
  ('npc.pvz_capacity',   200,  'NPC-ПВЗ: «полка» одного пункта — с ней делятся посылки');

-- ================= NPC в новых нишах =================
-- Работают, пока живых игроков (заходили за сутки) меньше max_players — с ростом города их становится меньше.
create table public.npc_niches (
  id          serial primary key,
  kind        text not null check (kind in ('marketplace', 'pvz', 'agency')),
  name        text not null,
  max_players int not null,
  price       bigint,              -- агентство: цена кампании, коп. (null — из конфига agency.npc_price)
  active      boolean not null default true,
  last_count  int not null default 0
);
alter table public.npc_niches enable row level security;
revoke all on public.npc_niches from anon, authenticated;

insert into public.npc_niches (kind, name, max_players, price) values
  ('marketplace', 'ВсёДоставим',      8, null),
  ('marketplace', 'Склад-Онлайн',     4, null),
  ('pvz',         'Пункт у метро',    8, null),
  ('pvz',         'Почтомат 24',      4, null),
  ('agency',      'Громкий голос', 100000, null),
  ('agency',      'Реклама-Экспресс', 8, 450000),
  ('agency',      'Медиа-Волна',      4, 380000);

create function public.live_players() returns int
language sql stable set search_path = ''
as $$ select count(*)::int from public.players where not is_test and last_seen_at > now() - interval '24 hours' $$;

create function public.npc_price(n public.npc_niches) returns bigint
language sql stable set search_path = ''
as $$ select coalesce(n.price, public.cfg('agency.npc_price')::bigint) $$;

-- Раздать посылки по ПВЗ игроков пропорционально полкам (× реклама × уровень).
-- p_npc — сначала NPC-пункты забирают свою долю. Возвращает, сколько досталось игрокам.
create function public.distribute_parcels(p_n int, p_npc boolean) returns int
language plpgsql set search_path = ''
as $$
declare
  v_left    int := greatest(p_n, 0);
  v_cap_sum numeric;
  v_npc     numeric := 0;
  v_take    int;
  r         record;
  v_give    int;
begin
  if v_left = 0 then return 0; end if;
  if p_npc then
    select count(*) * public.cfg('npc.pvz_capacity') into v_npc from public.npc_niches where kind = 'pvz' and active;
    select coalesce(sum(public.lvl_cap(t.capacity, b.level) * public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level)), 0)
      into v_cap_sum
      from public.businesses b join public.business_types t using (type) join public.players p on p.id = b.player_id
     where b.type = 'pvz' and not b.listed and not p.is_test;
    if v_npc > 0 then
      v_take := floor(v_left * v_npc / (v_cap_sum + v_npc));
      v_left := v_left - v_take;
      -- Доля NPC-пунктов делится между ними поровну (для показа в игре).
      update public.npc_niches set last_count = v_take / greatest(1, (select count(*) from public.npc_niches where kind = 'pvz' and active))
       where kind = 'pvz' and active;
    end if;
  end if;

  -- Переполненные полки отдают лишнее остальным (два прохода).
  for i in 1..2 loop
    exit when v_left <= 0;
    select coalesce(sum(public.lvl_cap(t.capacity, b.level) * public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level)), 0)
      into v_cap_sum
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
         for update of b
    loop
      v_give := least(r.capacity - r.stock, ceil(v_left::numeric * r.capacity * r.w / v_cap_sum)::int, v_left);
      if v_give > 0 then
        update public.businesses set stock = stock + v_give where id = r.id;
        v_left := v_left - v_give;
      end if;
    end loop;
  end loop;
  return greatest(p_n, 0) - v_left - coalesce(v_take, 0);
end;
$$;

-- Кампания у NPC-агентства: p_npc — какое (null — самое дешёвое из работающих).
drop function public.buy_npc_campaign(uuid, text);
create function public.buy_npc_campaign(p_player uuid, p_type text, p_npc int default null) returns text
language plpgsql set search_path = ''
as $$
declare
  p      public.players;
  n      public.npc_niches;
  v_cost bigint;
begin
  select * into p from public.players where id = p_player for update;
  select * into n from public.npc_niches
   where kind = 'agency' and active and (p_npc is null or id = p_npc)
   order by public.npc_price(npc_niches) limit 1;
  if not found then raise exception 'Это агентство сейчас не работает'; end if;
  v_cost := public.npc_price(n);
  if p.cash < v_cost then raise exception 'Не хватает денег: нужно %', public.fmt_rub(v_cost); end if;
  perform public.add_ads(p_player, p_type, 1, format('Реклама «%s»', n.name));
  update public.players set cash = cash - v_cost where id = p_player;
  return format('Реклама запущена за %s: %s, +%s%% спроса',
                public.fmt_rub(v_cost), (select name from public.business_types where type = p_type),
                round(public.cfg('agency.boost') * 100));
end;
$$;

-- ================= Аналитика =================
-- Открытия и выручка по типам бизнеса за каждый день (тестовые игроки не считаются).
create table public.biz_stats_daily (
  day     date not null,
  type    text not null,
  opened  int not null default 0,
  revenue bigint not null default 0,
  primary key (day, type)
);
alter table public.biz_stats_daily enable row level security;
revoke all on public.biz_stats_daily from anon, authenticated;

create function public.stats_add(p_type text, p_opened int, p_revenue bigint) returns void
language sql set search_path = ''
as $$
  insert into public.biz_stats_daily (day, type, opened, revenue)
  values (public.moscow_today(), p_type, p_opened, p_revenue)
  on conflict (day, type) do update
    set opened = public.biz_stats_daily.opened + excluded.opened,
        revenue = public.biz_stats_daily.revenue + excluded.revenue
$$;

create function public.stats_on_business() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not (select is_test from public.players where id = new.player_id) then
    perform public.stats_add(new.type, 1, 0);
  end if;
  return new;
end;
$$;
create trigger businesses_stats after insert on public.businesses
for each row execute function public.stats_on_business();

create function public.stats_on_sale() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.revenue > 0 and not (select is_test from public.players where id = new.player_id) then
    perform public.stats_add((select type from public.businesses where id = new.business_id), 0, new.revenue);
  end if;
  return new;
end;
$$;
create trigger sales_log_stats after insert on public.sales_log
for each row execute function public.stats_on_sale();

-- Агентство зарабатывает на продаже кампаний, бригада — на заказах.
create function public.stats_on_trade() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.seller_id is null or (select is_test from public.players where id = new.seller_id) then return new; end if;
  if new.kind = 'repair' then
    perform public.stats_add('repair', 0, new.total - new.fee);
  elsif new.product = 'campaign' then
    perform public.stats_add('agency', 0, new.total - new.fee);
  end if;
  return new;
end;
$$;
create trigger market_trades_stats after insert on public.market_trades
for each row execute function public.stats_on_trade();

-- ================= Панель разработчика =================
-- Добавить N фоновых посылок: сразу раздаются по ПВЗ игроков (без доли NPC).
create function public.dev_parcels(p_admin uuid, p_n int) returns text
language plpgsql set search_path = ''
as $$
declare
  a      public.players := public.dev_lock_admin(p_admin);
  v_got  int;
begin
  if p_n is null or p_n < 1 or p_n > 10000 then raise exception 'Неверное количество'; end if;
  if not exists (select 1 from public.businesses b join public.players p on p.id = b.player_id
                  where b.type = 'pvz' and not b.listed and not p.is_test) then
    raise exception 'Ни у кого нет пункта выдачи — посылкам некуда прийти';
  end if;
  v_got := public.distribute_parcels(p_n, false);
  perform public.dev_write_log(a, 'parcels_add', jsonb_build_object('asked', p_n, 'delivered', v_got));
  return format('Посылок разложено по ПВЗ: %s (лишние не влезли на полки)', v_got);
end;
$$;

-- ================= Городские заказы для бригад =================
-- Пока у бригады нет заказов от игроков, она берёт мелкие заказы жителей города (деньги — в кассу бригады).
-- Чем больше живых игроков, тем реже такие заказы. Заказ игрока всегда важнее — городской тогда бросается.
insert into public.balance_config (key, value, description) values
  ('repair.city_fee',              150000, 'Городской заказ бригаде: оплата, коп.'),
  ('repair.city_chance',           0.3,    'Городской заказ: вероятность за 5 минут, что свободная бригада его получит'),
  ('repair.city_floor',            0.3,    'Городские заказы: минимальная доля при многих игроках'),
  ('repair.city_players_to_floor', 30,     'Городские заказы: при скольких живых игроках доля падает до минимума');

alter table public.businesses add column npc_job_until timestamptz;

create or replace function public.crew_start_next(p_crew uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  v_id bigint;
begin
  if exists (select 1 from public.repair_orders where crew_business_id = p_crew and status = 'working') then return; end if;
  select id into v_id from public.repair_orders
   where crew_business_id = p_crew and status = 'queued' order by id limit 1 for update;
  if v_id is null then return; end if;
  -- Заказ игрока важнее городского.
  update public.businesses set npc_job_until = null where id = p_crew and npc_job_until is not null;
  update public.repair_orders
     set status = 'working', started_at = now(),
         finish_at = now() + make_interval(mins => public.cfg('repair.minutes')::int)
   where id = v_id;
end;
$$;

create function public.city_repair_jobs() returns void
language plpgsql set search_path = ''
as $$
declare
  r        record;
  v_fee    bigint := public.cfg('repair.city_fee')::bigint;
  v_factor numeric := greatest(public.cfg('repair.city_floor'),
                               1 - public.live_players() / public.cfg('repair.city_players_to_floor'));
begin
  -- Готовые городские заказы → деньги в кассу бригады.
  for r in select id, player_id from public.businesses
            where type = 'repair' and npc_job_until <= now() for update loop
    update public.businesses set npc_job_until = null, pending_revenue = pending_revenue + v_fee where id = r.id;
    insert into public.sales_log (business_id, player_id, sold, revenue, stock_left) values (r.id, r.player_id, 1, v_fee, 0);
  end loop;

  -- Свободные бригады иногда получают новый городской заказ.
  for r in select b.id from public.businesses b join public.players p on p.id = b.player_id
            where b.type = 'repair' and not b.listed and not p.is_test and b.npc_job_until is null
              and not exists (select 1 from public.repair_orders o
                               where o.crew_business_id = b.id and o.status in ('queued', 'working'))
              for update of b loop
    if random() < public.cfg('repair.city_chance') * v_factor then
      update public.businesses set npc_job_until = now() + make_interval(mins => public.cfg('repair.minutes')::int)
       where id = r.id;
    end if;
  end loop;
end;
$$;

-- Онлайн-бизнесы: NPC-маркетплейсы забирают часть спроса и шлют посылки, NPC-ПВЗ забирают часть посылок.
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
  v_npc_mp   int;
begin
  -- NPC в новых нишах: работают, пока живых игроков меньше их порога.
  update public.npc_niches set active = public.live_players() < max_players;
  select count(*) into v_npc_mp from public.npc_niches where kind = 'marketplace' and active;

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
        / (1 + public.cfg('npc.mp_competition') * v_npc_mp)
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

  -- NPC-маркетплейсы тоже продают — их посылки идут в те же ПВЗ.
  if v_npc_mp > 0 then
    v_units := floor(public.cfg('npc.mp_parcels') * public.hour_factor('bread', v_hour) * (0.85 + random() * 0.3) + random())::int;
    update public.npc_niches set last_count = v_units where kind = 'marketplace' and active;
    v_parcels := v_parcels + v_units * v_npc_mp;
  end if;

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

  perform public.distribute_parcels(v_left, true);
end;
$function$;

-- Достижения: «Первая посылка», «Рекламный магнат», «Прораб»; «Полный набор» — именно кофейня, магазин и пекарня.
CREATE OR REPLACE FUNCTION public.check_achievements(p_player_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_businesses int;
  v_capital    bigint;
  earned       text[] := '{}';
begin
  select count(*) into v_businesses from public.businesses where player_id = p_player_id;
  select capital into v_capital from public.capitals() where player_id = p_player_id;

  if v_businesses >= 1 then earned := array_append(earned, 'first_business'); end if;
  if (select count(distinct type) from public.businesses
       where player_id = p_player_id and type in ('coffee', 'shop', 'bakery')) = 3 then
    earned := array_append(earned, 'all_businesses');
  end if;
  if v_capital >= 50000000 then earned := array_append(earned, 'capital_500k'); end if;
  -- Места и «Кризис» засчитываются только тем, кто реально играл в сезоне (капитал менялся).
  if exists (select 1 from public.season_results where player_id = p_player_id and place <= 10
                and capital <> public.start_capital()) then
    earned := array_append(earned, 'top10');
  end if;
  if exists (select 1 from public.season_results where player_id = p_player_id and place <= 3
                and capital <> public.start_capital()) then
    earned := array_append(earned, 'top3');
  end if;
  if public.visit_streak(p_player_id) >= 7 then earned := array_append(earned, 'streak7'); end if;
  if (select count(*) from public.player_decisions where player_id = p_player_id and choice is not null) >= 10 then
    earned := array_append(earned, 'decisions10');
  end if;
  if (select coalesce(sum(sold), 0) from public.sales_log where player_id = p_player_id) >= 1000 then
    earned := array_append(earned, 'sold1000');
  end if;
  if exists (select 1 from public.players where referred_by = p_player_id) then
    earned := array_append(earned, 'invite');
  end if;
  if exists (select 1 from public.season_results r join public.seasons s on s.id = r.season_id
              where r.player_id = p_player_id and s.theme = 'crisis'
                and r.capital <> public.start_capital() and r.capital >= public.start_capital() / 2) then
    earned := array_append(earned, 'crisis');
  end if;

  if exists (select 1 from public.sales_log l join public.businesses bb on bb.id = l.business_id
              where l.player_id = p_player_id and bb.type in ('marketplace', 'pvz') and l.sold > 0) then
    earned := array_append(earned, 'first_parcel');
  end if;
  if (select coalesce(sum(qty), 0) from public.market_trades
       where seller_id = p_player_id and product = 'campaign') >= 50 then
    earned := array_append(earned, 'ad_magnate');
  end if;
  if (select count(*) from public.repair_orders where crew_player_id = p_player_id and status = 'done') >= 20 then
    earned := array_append(earned, 'foreman');
  end if;

  insert into public.player_achievements (player_id, code)
  select p_player_id, unnest(earned)
  on conflict do nothing;
end;
$function$;

-- Панель: аналитика по бизнесам и NPC в новых нишах.
CREATE OR REPLACE FUNCTION public.dev_info(p_admin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  return jsonb_build_object(
    'me', jsonb_build_object('dev_cash_total', a.dev_cash_total, 'show_dev_badge', a.show_dev_badge),
    'season', (select jsonb_build_object('number', id, 'ends_at', ends_at, 'theme', theme)
                 from public.seasons where not finished order by id desc limit 1),
    'markets', (select jsonb_agg(jsonb_build_object(
                  'market', m.market, 'name', m.name, 'market_price', m.market_price, 'demand_level', m.demand_level,
                  'last_demand', m.last_demand, 'sellers', m.sellers, 'bot_override', m.bot_override,
                  'bots', (select jsonb_agg(jsonb_build_object('name', n.name, 'kind', n.kind, 'price', n.price,
                                                               'active', n.active, 'last_sold', n.last_sold) order by n.id)
                             from public.npc_sellers n where n.market = m.market)) order by m.market)
                  from public.markets m),
    'test_players', coalesce((select jsonb_agg(jsonb_build_object(
                      'id', p.id, 'name', p.company_name, 'icon', p.company_icon, 'color', p.company_color,
                      'cash', p.cash, 'friend', p.referred_by = a.id) order by p.telegram_id desc)
                      from public.players p where p.is_test), '[]'::jsonb),
    -- Последние 50 сделок рынка; помеченные для проверки — с флагами.
    'trades', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', t.kind, 'product', t.product, 'qty', t.qty, 'price', t.price, 'total', t.total, 'fee', t.fee,
                 'flags', t.flags, 'at', t.created_at,
                 'seller', coalesce(s.company_name, s.first_name, '—'),
                 'buyer', case when t.kind = 'wholesale' then 'Оптовик' else coalesce(bu.company_name, bu.first_name, '—') end)
                 order by t.created_at desc)
                 from (select * from public.market_trades order by created_at desc limit 50) t
                 left join public.players s on s.id = t.seller_id
                 left join public.players bu on bu.id = t.buyer_id), '[]'::jsonb),
    'flagged_24h', (select count(*) from public.market_trades
                     where cardinality(flags) > 0 and created_at > now() - interval '24 hours'),
    -- Аналитика по типам бизнеса: открытия и выручка (за всё время и за 7 дней).
    'analytics', coalesce((select jsonb_agg(jsonb_build_object(
                   'type', t.type, 'name', t.name,
                   'opened', coalesce(s.opened, 0), 'opened_7d', coalesce(s.opened_7d, 0),
                   'revenue_7d', coalesce(s.revenue_7d, 0), 'revenue_1d', coalesce(s.revenue_1d, 0),
                   'owners', (select count(*) from public.businesses bb join public.players pp on pp.id = bb.player_id
                               where bb.type = t.type and not pp.is_test)) order by t.sort)
                   from public.business_types t
                   left join (select type, sum(opened) opened,
                                     sum(opened) filter (where day > public.moscow_today() - 7) opened_7d,
                                     sum(revenue) filter (where day > public.moscow_today() - 7) revenue_7d,
                                     sum(revenue) filter (where day = public.moscow_today()) revenue_1d
                                from public.biz_stats_daily group by type) s on s.type = t.type), '[]'::jsonb),
    'npc_niches', (select jsonb_agg(jsonb_build_object('kind', kind, 'name', name, 'active', active,
                                                       'max_players', max_players, 'last_count', last_count) order by id)
                     from public.npc_niches),
    'live_players', public.live_players(),
    'log', coalesce((select jsonb_agg(jsonb_build_object(
              'action', l.action, 'details', l.details, 'amount', l.amount, 'at', l.created_at,
              'admin', coalesce(p.company_name, l.admin_tg::text)) order by l.created_at desc)
              from (select * from public.dev_log order by created_at desc limit 50) l
              left join public.players p on p.id = l.admin_id), '[]'::jsonb)
  );
end;
$function$;

-- Состояние: NPC-агентства с ценами и NPC-конкуренты маркетплейса и ПВЗ.
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

-- Тик: городские заказы для бригад.
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
  perform public.city_repair_jobs();

  delete from public.sales_log where tick_at < now() - interval '8 days';
  delete from public.player_effects where until < now() - interval '1 hour';
end;
$function$;

-- ================= Баланс по итогам симуляции (supabase/sim) =================
-- Цель: при игре 2 раза в день каждый бизнес окупается за 2–4 дня, и ни один не выгоднее остальных.
-- Склады стали меньше, а покупателей меньше — товар расходится за несколько часов, а не за час;
-- улучшения (+25% склада за уровень) стали главным путём роста.
update public.balance_config set value = v.value
  from (values
    ('biz.coffee.capacity',         25),
    ('biz.shop.capacity',           95),
    ('biz.bakery.capacity',         200),
    ('biz.bakery.raw_capacity',     300),
    ('biz.marketplace.capacity',    130),
    ('market.coffee.base_demand',   0.8),
    ('market.bread.base_demand',    1.2),
    ('pvz.parcel_income',           1000),
    ('pvz.bg_parcels_per_pvz',      1.5)
  ) v(key, value)
 where balance_config.key = v.key;

-- Окупаемость для каталога (дней при игре 2 раза в день, город из 3 игроков — по симуляции).
insert into public.balance_config (key, value, description) values
  ('biz.coffee.payback_days',      3.1, 'Окупаемость для каталога, дней (по симуляции)'),
  ('biz.shop.payback_days',        2.9, 'Окупаемость для каталога, дней (по симуляции)'),
  ('biz.bakery.payback_days',      3.2, 'Окупаемость для каталога, дней (по симуляции)'),
  ('biz.marketplace.payback_days', 3.0, 'Окупаемость для каталога, дней (по симуляции)'),
  ('biz.pvz.payback_days',         2.9, 'Окупаемость для каталога, дней (по симуляции)'),
  ('biz.agency.payback_days',      3.0, 'Окупаемость для каталога, дней (по симуляции)'),
  ('biz.repair.payback_days',      3.1, 'Окупаемость для каталога, дней (по симуляции)')
on conflict (key) do update set value = excluded.value;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
