-- CAPITAL: новые бизнесы, этапы 1 и 2 — конфиг баланса, каталог, маркетплейс, ПВЗ, рекламное агентство.
-- Откройте ПУСТУЮ вкладку SQL Editor, вставьте весь текст и нажмите Run один раз.
begin;

-- Новые бизнесы, волна 1, этап 1: конфиг баланса, каталог, маркетплейс, ПВЗ.

-- ================= Конфиг баланса =================
-- Все числа баланса — в одной таблице balance_config (меняются в Table Editor без правки кода).
--   biz.<тип>.<поле>     → сразу переносится в справочник бизнесов (цена открытия, склад, производство…);
--   market.<рынок>.<поле> → в настройки рынка (базовый спрос);
--   остальные ключи читает сервер через cfg('ключ').
-- Деньги — в копейках (100 = 1 ₽), доли — числом (0.15 = 15%), время — в минутах.

create table public.balance_config (
  key         text primary key,
  value       numeric not null,
  description text not null default ''
);
alter table public.balance_config enable row level security;
revoke all on public.balance_config from anon, authenticated;

create function public.cfg(p_key text) returns numeric
language sql stable set search_path = ''
as $$ select value from public.balance_config where key = p_key $$;

-- Справочник бизнесов: категория, описание для каталога, связь с другими бизнесами, примерная окупаемость.
alter table public.business_types
  add column category     text not null default 'classic' check (category in ('classic', 'online', 'services')),
  add column description  text not null default '',
  add column link_text    text not null default '',
  add column payback_days numeric;

update public.business_types set
  description = 'Продаёт кофе прохожим, быстрый оборот',
  link_text = 'Кофе можно продавать и через маркетплейс' where type = 'coffee';
update public.business_types set
  description = 'Продаёт хлеб жителям города',
  link_text = 'Дешевле всего снабжать своей пекарней' where type = 'shop';
update public.business_types set
  description = 'Печёт хлеб из муки',
  link_text = 'Снабжает твой магазин и маркетплейс' where type = 'bakery';

insert into public.business_types
  (type, name, product, sort, open_cost, unit_cost, ref_price, capacity, raw_capacity, base_demand, production_rate,
   category, description, link_text)
values
  ('marketplace', 'Магазин на маркетплейсе', 'товары', 4, 4000000, 0, null, 400, 0, 0, 0, 'online',
   'Продаёт твои товары на всю страну',
   'Каждая продажа — посылка для пунктов выдачи'),
  ('pvz', 'Пункт выдачи заказов', 'посылки', 5, 2000000, 0, null, 200, 0, 0, 0, 'online',
   'Выдаёт посылки и получает плату за каждую',
   'ПВЗ зарабатывает на посылках маркетплейсов');

-- Синхронизация: правка ключей biz.* и market.* сразу меняет справочники.
create function public.balance_config_sync() returns trigger
language plpgsql set search_path = ''
as $$
declare
  parts text[] := string_to_array(new.key, '.');
begin
  if parts[1] = 'biz' and array_length(parts, 1) = 3 then
    if parts[3] not in ('open_cost', 'unit_cost', 'ref_price', 'capacity', 'raw_capacity', 'production_rate', 'payback_days') then
      raise exception 'Неизвестное поле бизнеса: %', parts[3];
    end if;
    execute format('update public.business_types set %I = $1 where type = $2', parts[3]) using new.value, parts[2];
  elsif parts[1] = 'market' and array_length(parts, 1) = 3 then
    if parts[3] not in ('base_demand', 'ref_price') then raise exception 'Неизвестное поле рынка: %', parts[3]; end if;
    execute format('update public.markets set %I = $1 where market = $2', parts[3]) using new.value, parts[2];
  end if;
  return new;
end;
$$;

create trigger balance_config_sync after insert or update on public.balance_config
for each row execute function public.balance_config_sync();

-- Переносим текущие числа в конфиг (триггер перезапишет те же значения — ничего не меняется).
insert into public.balance_config (key, value, description)
select 'biz.' || t.type || '.' || c.col, c.val, c.descr
  from public.business_types t
 cross join lateral (values
   ('open_cost', t.open_cost::numeric, 'Цена открытия, коп.'),
   ('unit_cost', t.unit_cost::numeric, 'Закупка 1 ед. у поставщика, коп.'),
   ('capacity', t.capacity::numeric, 'Склад (для ПВЗ — полка), шт.'),
   ('raw_capacity', t.raw_capacity::numeric, 'Склад сырья, шт.'),
   ('production_rate', t.production_rate::numeric, 'Производство за 5 минут, шт.')
 ) c(col, val, descr);

insert into public.balance_config (key, value, description)
select 'market.' || market || '.base_demand', base_demand, 'Покупателей за 5 минут на продавца днём' from public.markets;

insert into public.balance_config (key, value, description) values
  ('marketplace.demand_mult',      2,     'Маркетплейс: спрос относительно городского'),
  ('marketplace.price_mult',       0.9,   'Маркетплейс: цена продажи относительно рыночной'),
  ('marketplace.fee',              0.15,  'Маркетплейс: комиссия площадки с продажи'),
  ('marketplace.flour_price_mult', 2,     'Маркетплейс: розничная цена муки = оптовая × это число'),
  ('pvz.parcel_income',            1500,  'ПВЗ: доход за выданную посылку, коп.'),
  ('pvz.pickup_share',             0.5,   'ПВЗ: какая доля посылок с полки забирается за 5 минут'),
  ('pvz.bg_parcels_per_pvz',       2,     'ПВЗ: фоновые посылки NPC на один ПВЗ за 5 минут (днём)'),
  ('pvz.bg_floor',                 0.3,   'ПВЗ: минимальная доля фона при многих игроках'),
  ('pvz.bg_players_to_floor',      30,    'ПВЗ: при скольких живых игроках фон падает до минимума');

-- ================= Склад маркетплейса =================
create table public.business_goods (
  business_id uuid not null references public.businesses(id) on delete cascade,
  product     text not null check (product in ('coffee', 'bread', 'flour')),
  qty         int not null default 0 check (qty >= 0),
  primary key (business_id, product)
);
alter table public.business_goods enable row level security;
revoke all on public.business_goods from anon, authenticated;

-- Положить товар в маркетплейс игрока (строка маркетплейса должна быть заблокирована).
create function public.put_marketplace(p_player uuid, p_product text, p_qty int) returns void
language plpgsql set search_path = ''
as $$
declare
  v_id   uuid;
  v_cap  int;
  v_have int;
begin
  select b.id, t.capacity into v_id, v_cap
    from public.businesses b join public.business_types t using (type)
   where b.player_id = p_player and b.type = 'marketplace' for update of b;
  if not found then raise exception 'Сначала открой магазин на маркетплейсе'; end if;
  select coalesce(sum(qty), 0) into v_have from public.business_goods where business_id = v_id;
  if p_qty > v_cap - v_have then raise exception 'На складе маркетплейса место только для % шт.', greatest(v_cap - v_have, 0); end if;
  insert into public.business_goods (business_id, product, qty) values (v_id, p_product, p_qty)
  on conflict (business_id, product) do update set qty = public.business_goods.qty + excluded.qty;
end;
$$;

-- Перевезти товар со своего бизнеса в маркетплейс.
create function public.marketplace_transfer(p_player uuid, p_product text, p_source text, p_qty int) returns text
language plpgsql set search_path = ''
as $$
begin
  perform 1 from public.players where id = p_player for update;
  perform public.take_goods(p_player, p_product, p_source, p_qty);
  perform public.put_marketplace(p_player, p_product, p_qty);
  return format('В маркетплейс перевезено %s шт.', p_qty);
end;
$$;

-- Поставщики не продают товар маркетплейсу и ПВЗ.
create or replace function public.restock(p_player_id uuid, p_type text, p_qty int) returns void
language plpgsql
set search_path = ''
as $$
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
    v_free := t.raw_capacity - b.raw_stock;
  else
    v_free := t.capacity - b.stock;
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
$$;

-- Розничная цена товара на маркетплейсе (до комиссии), коп.
create function public.marketplace_price(p_product text) returns bigint
language sql stable set search_path = ''
as $$
  select (round(case p_product
           when 'coffee' then (select market_price from public.markets where market = 'coffee')
           when 'bread'  then (select market_price from public.markets where market = 'bread')
           else public.goods_price('flour') * public.cfg('marketplace.flour_price_mult')
         end * public.cfg('marketplace.price_mult') / 100) * 100)::bigint
$$;

-- Тик онлайн-бизнесов: продажи маркетплейсов на «всю страну», затем посылки по ПВЗ.
create function public.tick_online() returns void
language plpgsql set search_path = ''
as $$
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
  v_cap_sum  int;
  v_give     int;
  v_picked   int;
begin
  -- 1. Маркетплейсы.
  for r in
    select b.id, b.player_id from public.businesses b join public.players p on p.id = b.player_id
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

  -- Делим пропорционально вместимости полок; переполненные отдают лишнее остальным (два прохода).
  for i in 1..2 loop
    exit when v_left <= 0;
    select coalesce(sum(t.capacity), 0) into v_cap_sum
      from public.businesses b join public.business_types t using (type) join public.players p on p.id = b.player_id
     where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < t.capacity;
    exit when v_cap_sum = 0;
    for r in
      select b.id, b.stock, t.capacity from public.businesses b join public.business_types t using (type)
        join public.players p on p.id = b.player_id
       where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < t.capacity
       order by random()
    loop
      v_give := least(r.capacity - r.stock, ceil(v_left::numeric * r.capacity / v_cap_sum)::int, v_left);
      if v_give > 0 then
        update public.businesses set stock = stock + v_give where id = r.id;
        v_left := v_left - v_give;
      end if;
    end loop;
  end loop;
end;
$$;


-- Тик: добавлены онлайн-бизнесы.
create or replace function public.tick() returns void
language plpgsql
set search_path = ''
as $$
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
    select b.id, b.player_id, b.stock, b.raw_stock, t.production_rate, t.capacity
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

  -- 3. Онлайн-бизнесы: маркетплейсы и ПВЗ.
  perform public.tick_online();

  delete from public.sales_log where tick_at < now() - interval '8 days';
  delete from public.player_effects where until < now() - interval '1 hour';
end;
$$;

-- Капитал: учитываем товар на складе маркетплейса.
create or replace function public.capitals()
returns table (player_id uuid, first_name text, capital bigint)
language sql stable set search_path = ''
as $$
  select p.id, p.first_name,
         p.cash
         + coalesce((select sum(g.qty::bigint * public.goods_price(g.product))
                       from public.business_goods g join public.businesses bb on bb.id = g.business_id
                      where bb.player_id = p.id), 0)
         + coalesce(sum(
           b.pending_revenue
           + b.stock::bigint * (case when b.type = 'bakery'
                                     then (select unit_cost from public.business_types where type = 'shop')
                                     else t.unit_cost end)
           + b.raw_stock::bigint * t.unit_cost
           + t.open_cost * 7 / 10), 0)::bigint
    from public.players p
    left join public.businesses b on b.player_id = p.id
    left join public.business_types t on t.type = b.type
   where not p.is_test
   group by p.id
$$;

-- Состояние: склад маркетплейса и выручка за 5 минут.
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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
               'goods', (select jsonb_object_agg(g.product, g.qty) from public.business_goods g where g.business_id = b.id),
               'last_revenue', coalesce((select l.revenue from public.sales_log l
                                          where l.business_id = b.id and l.tick_at > now() - interval '5 minutes'
                                          order by l.tick_at desc limit 1), 0),
               'last_sold', coalesce((select l.sold from public.sales_log l
                                       where l.business_id = b.id and l.sold > 0
                                         and l.tick_at > now() - interval '5 minutes'
                                       order by l.tick_at desc limit 1), 0)) order by t.sort)
      from public.businesses b join public.business_types t using (type)
      where b.player_id = p_player_id), '[]'::jsonb),
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
    'effects', coalesce((select jsonb_agg(jsonb_build_object(
                           'label', e.label, 'kind', e.kind, 'market', e.market, 'mult', e.mult, 'until', e.until)
                           order by e.until)
                         from public.player_effects e
                         where e.player_id = p_player_id and e.until > now()), '[]'::jsonb),
    'discount', public.effect_mult(p_player_id, 'discount', null),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'text', x.text, 'at', x.created_at,
                                                                   'read', x.read_at is not null) order by x.id desc)
                                 from (select * from public.notifications where player_id = p_player_id
                                        order by id desc limit 20) x), '[]'::jsonb),
    'unread', (select count(*) from public.notifications where player_id = p_player_id and read_at is null)
  ) into result;
  return result;
end;
$$;

-- Панель: «заполнить все» — только классика; «очистить все» чистит и маркетплейс.
create or replace function public.dev_stock(p_admin uuid, p_mode text, p_product text, p_qty int) returns text
language plpgsql set search_path = ''
as $$
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
       set stock = t.capacity, raw_stock = t.raw_capacity
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
     set stock     = case when v_raw then b.stock else least(t.capacity, b.stock + p_qty) end,
         raw_stock = case when v_raw then least(t.raw_capacity, b.raw_stock + p_qty) else b.raw_stock end
    from public.business_types t
   where t.type = b.type and b.player_id = a.id and b.type = v_type
  returning case when v_raw then b.raw_stock else b.stock end into v_after;

  perform public.dev_write_log(a, 'stock_add',
    jsonb_build_object('product', p_product, 'asked', p_qty, 'added', v_after - v_before));
  return format('Добавлено %s шт. (склад ограничен)', v_after - v_before);
end;
$$;

-- Покупка лота: можно сразу на склад маркетплейса.
drop function public.buy_lot(uuid, bigint, int);
create function public.buy_lot(p_buyer uuid, p_lot bigint, p_qty int, p_dest text default null) returns text
language plpgsql set search_path = ''
as $$
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
    v_dest := case when p_dest = 'marketplace' then 'marketplace' else public.goods_dest(p_buyer, l.product) end;
    if v_dest is null then
      raise exception 'Некуда положить товар: открой %',
        case l.product when 'coffee' then 'кофейню' when 'flour' then 'пекарню' else 'магазин или пекарню' end;
    end if;
    if v_dest = 'marketplace' then
      v_free := 1000000; -- проверит put_marketplace
    else
      select case when l.product = 'flour' then t.raw_capacity - bz.raw_stock else t.capacity - bz.stock end
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

  -- 3. Склад покупателя.
  v_dest := case when p_dest = 'marketplace' then 'marketplace' else public.goods_dest(p_buyer, l.product) end;
  if v_dest is null then
    raise exception 'Некуда положить товар: открой %',
      case l.product when 'coffee' then 'кофейню' when 'flour' then 'пекарню' else 'магазин или пекарню' end;
  end if;
  if v_dest = 'marketplace' then
    v_free := 1000000; -- проверит put_marketplace
  else
    select case when l.product = 'flour' then t.raw_capacity - bz.raw_stock else t.capacity - bz.stock end
      into v_free
      from public.businesses bz join public.business_types t using (type)
     where bz.player_id = p_buyer and bz.type = v_dest
       for update of bz;
  end if;
  if p_qty > v_free then raise exception 'На складе место только для % шт.', greatest(v_free, 0); end if;

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
     where kind = 'lot' and buyer_id = p_buyer and seller_id = s.id and created_at > now() - interval '24 hours';
    select capital into v_cap from public.capitals() where player_id = s.id;
    if v_got + v_total - v_fee > 0.3 * greatest(coalesce(v_cap, 0), 1) then
      v_flags := array_append(v_flags, 'big_share');
    end if;
  end if;

  -- 5. Сделка: деньги, товар, лот, запись.
  update public.players set cash = cash - v_total where id = b.id;
  update public.players set cash = cash + v_total - v_fee where id = s.id;
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
  insert into public.market_trades (lot_id, kind, seller_id, buyer_id, product, qty, price, total, fee, flags)
  values (l.id, 'lot', s.id, b.id, l.product, p_qty, l.price, v_total, v_fee, v_flags);

  return format('Куплено %s шт. за %s', p_qty, public.fmt_rub(v_total));
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Новые бизнесы, волна 1, этап 2: рекламное агентство и рекламные кампании.
--
-- Агентство само делает кампании (1 за 30 минут, склад 10). Кампанию можно запустить на свой бизнес
-- или продать на рынке игроков, как товар. Кампания даёт выбранному бизнесу +25% спроса на 3 часа;
-- на один бизнес — не больше 2 кампаний сразу. Купленная кампания запускается сразу на выбранный бизнес,
-- поэтому перепродать её нельзя. NPC-агентство всегда продаёт кампании по 6 000 ₽ (деньги уходят из игры).

insert into public.balance_config (key, value, description) values
  ('agency.minutes_per_campaign', 30,     'Агентство: минут на одну кампанию'),
  ('agency.campaign_price',       300000, 'Кампания: базовая цена на рынке, коп. (коридор лота 50–150%)'),
  ('agency.wholesale_price',      100000, 'Кампания: цена оптовика, коп.'),
  ('agency.npc_price',            600000, 'NPC-агентство: цена кампании, коп.'),
  ('agency.boost',                0.25,   'Кампания: прибавка к спросу (0.25 = +25%)'),
  ('agency.minutes',              180,    'Кампания: сколько минут действует'),
  ('agency.max_per_business',     2,      'Кампаний одновременно на один бизнес');

insert into public.business_types
  (type, name, product, sort, open_cost, unit_cost, ref_price, capacity, raw_capacity, base_demand, production_rate,
   category, description, link_text)
values
  ('agency', 'Рекламное агентство', 'кампании', 6, 6000000, 0, null, 10, 0, 0, 0, 'services',
   'Делает рекламные кампании для бизнесов',
   'Реклама даёт любому бизнесу +25% спроса на 3 часа');

insert into public.balance_config (key, value, description) values
  ('biz.agency.open_cost', 6000000, 'Цена открытия, коп.'),
  ('biz.agency.capacity',  10,      'Склад готового товара');

-- Сколько готово следующей кампании (0…1).
alter table public.businesses add column work_progress numeric not null default 0;

-- Кампании — товар рынка игроков; реклама — отдельный вид эффекта (market = тип бизнеса).
alter table public.market_lots drop constraint market_lots_product_check;
alter table public.market_lots add constraint market_lots_product_check check (product in ('coffee', 'bread', 'flour', 'campaign'));
alter table public.market_lots drop constraint market_lots_source_check;
alter table public.market_lots add constraint market_lots_source_check check (source in ('coffee', 'shop', 'bakery', 'agency'));
alter table public.player_effects drop constraint player_effects_kind_check;
alter table public.player_effects add constraint player_effects_kind_check check (kind in ('demand', 'discount', 'ad'));

-- ================= Цены кампании =================
create or replace function public.goods_price(p_product text) returns bigint
language sql stable set search_path = ''
as $$
  select case when p_product = 'campaign' then public.cfg('agency.campaign_price')::bigint else
    (select (round(t.unit_cost * least(1.15, greatest(0.7, m.market_price::numeric / m.ref_price)) / 100) * 100)::bigint
       from public.business_types t
       join public.markets m on m.market = case p_product when 'coffee' then 'coffee' else 'bread' end
      where t.type = case p_product when 'coffee' then 'coffee' when 'bread' then 'shop' else 'bakery' end)
  end
$$;

create or replace function public.wholesale_price(p_product text) returns bigint
language sql stable set search_path = ''
as $$
  select case when p_product = 'campaign' then public.cfg('agency.wholesale_price')::bigint else
    floor(0.7 * least(public.goods_price(p_product),
                      (select unit_cost from public.business_types
                        where type = case p_product when 'coffee' then 'coffee' when 'bread' then 'shop' else 'bakery' end)))::bigint
  end
$$;

create or replace function public.check_source(p_product text, p_source text) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if not ((p_product = 'coffee'   and p_source = 'coffee')
       or (p_product = 'bread'    and p_source in ('shop', 'bakery'))
       or (p_product = 'flour'    and p_source = 'bakery')
       or (p_product = 'campaign' and p_source = 'agency')) then
    raise exception 'Этот товар нельзя взять с этого склада';
  end if;
end;
$$;

-- Купленная кампания не ложится на склад — она сразу запускается (см. buy_lot).
create or replace function public.goods_dest(p_player uuid, p_product text) returns text
language sql stable set search_path = ''
as $$
  select case p_product
    when 'campaign' then null
    when 'coffee' then case when exists (select 1 from public.businesses where player_id = p_player and type = 'coffee') then 'coffee' end
    when 'flour'  then case when exists (select 1 from public.businesses where player_id = p_player and type = 'bakery') then 'bakery' end
    else case
      when exists (select 1 from public.businesses where player_id = p_player and type = 'shop') then 'shop'
      when exists (select 1 from public.businesses where player_id = p_player and type = 'bakery') then 'bakery'
    end
  end
$$;

-- Оценка бизнеса: товар считаем по его собственной цене (у маркетплейса — товар на складе, у ПВЗ — ничего).
create or replace function public.business_valuation(p_business uuid) returns bigint
language sql stable set search_path = ''
as $$
  select t.open_cost
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
$$;

-- ================= Реклама =================

-- Множитель спроса от рекламы: 1 + 0.25 за каждую активную кампанию.
create function public.ad_mult(p_player uuid, p_type text) returns numeric
language sql stable set search_path = ''
as $$
  select 1 + coalesce(sum(mult - 1), 0)
    from public.player_effects
   where player_id = p_player and kind = 'ad' and market = p_type and until > now()
$$;

-- Запустить p_n кампаний на бизнес игрока. Строку бизнеса блокируем, чтобы две покупки подряд не превысили лимит.
create function public.add_ads(p_player uuid, p_type text, p_n int, p_label text) returns void
language plpgsql set search_path = ''
as $$
declare
  v_listed boolean;
  v_active int;
  v_max    int := public.cfg('agency.max_per_business')::int;
begin
  if p_type is null or p_type not in ('coffee', 'shop', 'marketplace', 'pvz') then
    raise exception 'Рекламу можно запустить на кофейню, магазин, маркетплейс или ПВЗ';
  end if;
  select listed into v_listed from public.businesses where player_id = p_player and type = p_type for update;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
  if v_listed then raise exception 'Бизнес выставлен на продажу — реклама ему не поможет'; end if;
  select count(*) into v_active from public.player_effects
   where player_id = p_player and kind = 'ad' and market = p_type and until > now();
  if p_n is null or p_n < 1 then raise exception 'Неверное количество'; end if;
  if v_active + p_n > v_max then
    raise exception 'На один бизнес — не больше % кампаний сразу (сейчас %)', v_max, v_active;
  end if;
  insert into public.player_effects (player_id, kind, market, mult, until, label)
  select p_player, 'ad', p_type, 1 + public.cfg('agency.boost'),
         now() + make_interval(mins => public.cfg('agency.minutes')::int), p_label
    from generate_series(1, p_n);
end;
$$;

-- Запустить свою кампанию со склада агентства.
create function public.apply_campaign(p_player uuid, p_type text) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.businesses;
begin
  perform 1 from public.players where id = p_player for update;
  select * into a from public.businesses where player_id = p_player and type = 'agency' for update;
  if not found then raise exception 'Сначала открой рекламное агентство'; end if;
  if a.listed then raise exception 'Агентство выставлено на продажу — сначала сними его с рынка'; end if;
  if a.stock < 1 then raise exception 'Готовых кампаний нет — следующая скоро будет'; end if;
  perform public.add_ads(p_player, p_type, 1, 'Своя реклама');
  update public.businesses set stock = stock - 1 where id = a.id;
  return format('Реклама запущена: %s, +%s%% спроса на %s',
                (select name from public.business_types where type = p_type),
                round(public.cfg('agency.boost') * 100),
                case when public.cfg('agency.minutes') % 60 = 0 then (public.cfg('agency.minutes') / 60)::int || ' ч'
                     else public.cfg('agency.minutes')::int || ' мин' end);
end;
$$;

-- Купить кампанию у NPC-агентства (всегда доступно, деньги уходят из игры).
create function public.buy_npc_campaign(p_player uuid, p_type text) returns text
language plpgsql set search_path = ''
as $$
declare
  p      public.players;
  v_cost bigint := public.cfg('agency.npc_price')::bigint;
begin
  select * into p from public.players where id = p_player for update;
  if p.cash < v_cost then raise exception 'Не хватает денег: нужно %', public.fmt_rub(v_cost); end if;
  perform public.add_ads(p_player, p_type, 1, 'Реклама «Громкий голос»');
  update public.players set cash = cash - v_cost where id = p_player;
  return format('Реклама запущена за %s: %s, +%s%% спроса',
                public.fmt_rub(v_cost), (select name from public.business_types where type = p_type),
                round(public.cfg('agency.boost') * 100));
end;
$$;

-- ================= Покупка лота: кампании запускаются сразу =================
-- p_dest: 'marketplace' — товар на склад маркетплейса; для кампании — тип бизнеса, которому нужна реклама.
create or replace function public.buy_lot(p_buyer uuid, p_lot bigint, p_qty int, p_dest text default null) returns text
language plpgsql set search_path = ''
as $$
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
      select case when l.product = 'flour' then t.raw_capacity - bz.raw_stock else t.capacity - bz.stock end
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
      select case when l.product = 'flour' then t.raw_capacity - bz.raw_stock else t.capacity - bz.stock end
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
$$;

-- Уведомления о продажах: кампании и новые бизнесы.
create or replace function public.notify_trade() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.seller_id is null or new.kind not in ('lot', 'business') then return new; end if;
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
$$;

-- ================= Тик =================

-- Онлайн-бизнесы + агентства. Реклама поднимает продажи маркетплейса и долю посылок ПВЗ.
create or replace function public.tick_online() returns void
language plpgsql set search_path = ''
as $$
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
    select b.id, b.player_id, b.stock, b.work_progress, t.capacity
      from public.businesses b join public.business_types t using (type)
     where b.type = 'agency' and not b.listed
       for update of b
  loop
    if r.stock >= r.capacity then
      update public.businesses set work_progress = 0 where id = r.id;
      continue;
    end if;
    v_made := least(floor(r.work_progress + v_step)::int, r.capacity - r.stock);
    update public.businesses
       set stock = stock + v_made,
           work_progress = case when r.stock + v_made >= r.capacity then 0
                                else r.work_progress + v_step - floor(r.work_progress + v_step) end
     where id = r.id;
    if v_made > 0 then
      insert into public.sales_log (business_id, player_id, produced, stock_left)
      values (r.id, r.player_id, v_made, r.stock + v_made);
    end if;
  end loop;

  -- 1. Маркетплейсы.
  for r in
    select b.id, b.player_id from public.businesses b join public.players p on p.id = b.player_id
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
        * public.ad_mult(r.player_id, 'marketplace')
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
    select coalesce(sum(t.capacity * public.ad_mult(b.player_id, 'pvz')), 0) into v_cap_sum
      from public.businesses b join public.business_types t using (type) join public.players p on p.id = b.player_id
     where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < t.capacity;
    exit when v_cap_sum = 0;
    for r in
      select b.id, b.stock, t.capacity, public.ad_mult(b.player_id, 'pvz') as w
        from public.businesses b join public.business_types t using (type)
        join public.players p on p.id = b.player_id
       where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < t.capacity
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
$$;

-- Тик: реклама увеличивает долю покупателей кофейни и магазина.
create or replace function public.tick() returns void
language plpgsql
set search_path = ''
as $$
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
    select b.id, b.player_id, b.stock, b.raw_stock, t.production_rate, t.capacity
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
           * public.ad_mult(b.player_id, b.type)
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

  delete from public.sales_log where tick_at < now() - interval '8 days';
  delete from public.player_effects where until < now() - interval '1 hour';
end;
$$;

-- Капитал: кампании на складе агентства — по цене оптовика.
create or replace function public.capitals()
returns table (player_id uuid, first_name text, capital bigint)
language sql stable set search_path = ''
as $$
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
           + t.open_cost * 7 / 10), 0)::bigint
    from public.players p
    left join public.businesses b on b.player_id = p.id
    left join public.business_types t on t.type = b.type
   where not p.is_test
   group by p.id
$$;

-- ================= Состояние экрана =================
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
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
$$;

-- ================= Рынок =================

-- Цены для вкладки «Рынок»: добавлена кампания.
create or replace function public.goods_prices() returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_agg(jsonb_build_object(
           'product', g.product,
           'price', public.goods_price(g.product),
           'wholesale', public.wholesale_price(g.product),
           'day_ago', (select h.price from public.goods_price_history h
                        where h.product = g.product and h.at <= now() - interval '24 hours'
                        order by h.at desc limit 1),
           'history', coalesce((select jsonb_agg(jsonb_build_array(extract(epoch from h.at)::bigint, h.price) order by h.at)
                                  from public.goods_price_history h
                                 where h.product = g.product and h.at > now() - interval '24 hours'), '[]'::jsonb))
         order by g.ord)
    from (values ('coffee', 1), ('bread', 2), ('flour', 3), ('campaign', 4)) g(product, ord)
$$;

create or replace function public.market_maintenance() returns void
language plpgsql set search_path = ''
as $$
begin
  perform public.expire_lots();
  insert into public.goods_price_history (product, price)
  select g, public.goods_price(g) from unnest(array['coffee', 'bread', 'flour', 'campaign']) g
  on conflict do nothing;
  delete from public.goods_price_history where at < now() - interval '3 days';
  perform public.test_players_act();
  perform public.npc_market_act();
  delete from public.notifications where created_at < now() - interval '7 days';
end;
$$;

-- Тестовые игроки торгуют и кампаниями (маркетплейс и ПВЗ на рынок не выставляют).
create or replace function public.test_players_act() returns void
language plpgsql set search_path = ''
as $$
declare
  t      record;
  l      record;
  v_prod text;
  v_src  text;
  v_have int;
  v_mkt  bigint;
  v_qty  int;
begin
  for t in select id from public.players where is_test loop
    begin
      if (select count(*) from public.market_lots where seller_id = t.id and status = 'active') < 2 then
        select b.type, case b.type when 'coffee' then 'coffee' when 'shop' then 'bread' when 'agency' then 'campaign' else
                 case when random() < 0.5 then 'flour' else 'bread' end end,
               b.stock, b.raw_stock
          into v_src, v_prod, v_have, v_qty
          from public.businesses b
         where b.player_id = t.id and b.type in ('coffee', 'shop', 'bakery', 'agency')
         order by random() limit 1;
        if v_prod = 'flour' then v_have := v_qty; end if;
        if v_src is not null and v_have >= (case when v_prod = 'campaign' then 1 else 10 end) then
          v_mkt := public.goods_price(v_prod);
          perform public.create_lot(t.id, v_prod, v_src,
                                    case when v_prod = 'campaign' then least(v_have, 1 + floor(random() * 3)::int)
                                         else least(v_have, 10 + floor(random() * 40)::int) end,
                                    (round(v_mkt * (0.6 + random() * 0.8) / 100) * 100)::bigint);
        end if;
      end if;

      -- Покупка: с вероятностью 1/3 — самый выгодный лот администратора, 1–10 шт.
      if random() < 0.34 then
        select ml.id, ml.qty_left into l
          from public.market_lots ml join public.players s on s.id = ml.seller_id
         where ml.kind = 'goods' and ml.status = 'active' and s.is_admin and public.goods_dest(t.id, ml.product) is not null
         order by ml.price::numeric / public.goods_price(ml.product) limit 1;
        if found then
          perform public.buy_lot(t.id, l.id, least(l.qty_left, 1 + floor(random() * 10)::int));
        end if;
      end if;
      -- Бизнесы: иногда выставляют один свой бизнес; покупают бизнес администратора, если такого у них нет.
      if random() < 0.15 and not exists (select 1 from public.market_lots
                                           where seller_id = t.id and kind = 'business' and status = 'active') then
        select bz.type into v_src from public.businesses bz where bz.player_id = t.id and not bz.listed order by random() limit 1;
        if v_src is not null then
          v_mkt := public.business_valuation((select id from public.businesses where player_id = t.id and type = v_src));
          perform public.create_business_lot(t.id, v_src, (round(v_mkt * (0.8 + random() * 0.6) / 100) * 100)::bigint);
        end if;
      end if;
      select ml.id into l
        from public.market_lots ml join public.players s on s.id = ml.seller_id
       where ml.kind = 'business' and ml.status = 'active' and s.is_admin
         and not exists (select 1 from public.businesses where player_id = t.id and type = ml.business_type)
       limit 1;
      if found then perform public.buy_business_lot(t.id, l.id); end if;
    exception when others then
      -- Нет места, нет денег и т. п. — тестовый игрок просто пропускает ход.
      null;
    end;
  end loop;
end;
$$;

-- ================= Панель разработчика =================

-- Выдать кампании на склад своего агентства (не больше вместимости).
create function public.dev_campaigns(p_admin uuid, p_n int) returns text
language plpgsql set search_path = ''
as $$
declare
  a        public.players := public.dev_lock_admin(p_admin);
  v_before int;
  v_after  int;
begin
  if p_n is null or p_n < 1 or p_n > 100 then raise exception 'Неверное количество'; end if;
  select stock into v_before from public.businesses where player_id = a.id and type = 'agency' for update;
  if not found then raise exception 'Сначала открой рекламное агентство'; end if;
  update public.businesses b set stock = least(t.capacity, b.stock + p_n)
    from public.business_types t
   where t.type = b.type and b.player_id = a.id and b.type = 'agency'
  returning b.stock into v_after;
  perform public.dev_write_log(a, 'campaigns_add', jsonb_build_object('asked', p_n, 'added', v_after - v_before));
  return format('Выдано кампаний: %s (склад ограничен)', v_after - v_before);
end;
$$;

-- Открыть бизнес бесплатно: сообщение без рода («Рекламное агентство открыт» звучит криво).
create or replace function public.dev_open_business(p_admin uuid, p_type text) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
  t public.business_types;
begin
  select * into t from public.business_types where type = p_type;
  if not found then raise exception 'Такого бизнеса нет'; end if;
  if exists (select 1 from public.businesses where player_id = a.id and type = p_type) then
    raise exception 'Этот бизнес у тебя уже есть';
  end if;
  insert into public.businesses (player_id, type, price, dev_granted) values (a.id, p_type, t.ref_price, true);
  perform public.dev_write_log(a, 'open_business', jsonb_build_object('type', p_type), t.open_cost);
  return format('Бизнес «%s» открыт бесплатно', t.name);
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

commit;
