-- CAPITAL: установка этапов 3, 4 и 5. Вставьте весь этот текст в SQL Editor и нажмите Run.
begin;

-- Этап 3: бизнесы, склад, выручка, тик продаж.
-- Все суммы — в копейках. Все функции вызывает только сервер (service_role).

-- Справочник типов бизнеса.
create table public.business_types (
  type            text primary key,
  name            text not null,
  product         text not null,
  sort            int not null,
  open_cost       bigint not null,
  unit_cost       bigint not null,            -- закупка 1 ед. товара (для пекарни — мука на 1 буханку)
  ref_price       bigint,                     -- ориентир розничной цены; null — в розницу не продаёт
  capacity        int not null,               -- склад готового товара
  raw_capacity    int not null default 0,     -- склад сырья
  base_demand     numeric not null default 0, -- покупателей за тик при ориентирной цене
  production_rate int not null default 0      -- производство за тик
);

insert into public.business_types
  (type, name, product, sort, open_cost, unit_cost, ref_price, capacity, raw_capacity, base_demand, production_rate)
values
  ('coffee', 'Кофейня',  'кофе', 1, 2000000, 6000, 18000, 300,   0, 4, 0),
  ('shop',   'Магазин',  'хлеб', 2, 2500000, 5000,  9000, 500,   0, 6, 0),
  ('bakery', 'Пекарня',  'хлеб', 3, 3500000, 1500,  null, 600, 600, 0, 8);

create table public.businesses (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.players(id) on delete cascade,
  type            text not null references public.business_types(type),
  price           bigint,
  stock           int not null default 0 check (stock >= 0),
  raw_stock       int not null default 0 check (raw_stock >= 0),
  pending_revenue bigint not null default 0 check (pending_revenue >= 0),
  created_at      timestamptz not null default now(),
  unique (player_id, type)
);

-- Журнал тиков: из него строится сводка «пока тебя не было».
create table public.sales_log (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  tick_at     timestamptz not null default now(),
  sold        int not null default 0,
  revenue     bigint not null default 0,
  produced    int not null default 0,
  stock_left  int not null
);
create index sales_log_player_tick on public.sales_log (player_id, tick_at);

alter table public.business_types enable row level security;
alter table public.businesses     enable row level security;
alter table public.sales_log      enable row level security;
revoke all on public.business_types, public.businesses, public.sales_log from anon, authenticated;

-- «12 345 ₽» для текстов ошибок.
create function public.fmt_rub(kopecks bigint) returns text
language sql stable set search_path = ''
as $$ select replace(to_char(kopecks / 100, 'FM999G999G999G990'), ',', ' ') || ' ₽' $$;

-- Вход теперь ещё и возвращает время прошлого визита.
create or replace function public.login_player(
  p_telegram_id bigint,
  p_first_name text,
  p_username text,
  p_language_code text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  prev   timestamptz;
  result jsonb;
begin
  select last_seen_at into prev from public.players where telegram_id = p_telegram_id;

  insert into public.players as p (telegram_id, first_name, username, language_code)
  values (p_telegram_id, coalesce(p_first_name, ''), p_username, p_language_code)
  on conflict (telegram_id) do update
    set first_name    = excluded.first_name,
        username      = excluded.username,
        language_code = excluded.language_code,
        last_seen_at  = now()
  returning to_jsonb(p.*) || jsonb_build_object('is_new', p.xmax = 0, 'prev_seen_at', prev)
  into result;
  return result;
end;
$$;

-- Полное состояние игрока для экрана. Заодно отмечает, что игрок онлайн.
create function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  update public.players set last_seen_at = now() where id = p_player_id;

  select jsonb_build_object(
    'server_time', now(),
    'player', (select jsonb_build_object('id', id, 'first_name', first_name, 'cash', cash, 'created_at', created_at)
               from public.players where id = p_player_id),
    'catalog', (select jsonb_agg(to_jsonb(t.*) order by t.sort) from public.business_types t),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'type', b.type, 'price', b.price, 'stock', b.stock,
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue) order by t.sort)
      from public.businesses b join public.business_types t using (type)
      where b.player_id = p_player_id), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Сводка «пока тебя не было».
create function public.away_summary(p_player_id uuid, p_since timestamptz) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'since', p_since,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'type', b.type, 'sold', s.sold, 'revenue', s.revenue, 'produced', s.produced,
      'stock', b.stock, 'raw_stock', b.raw_stock) order by t.sort), '[]'::jsonb)
  )
  from public.businesses b
  join public.business_types t using (type)
  join lateral (
    select coalesce(sum(l.sold), 0)::int as sold,
           coalesce(sum(l.revenue), 0)::bigint as revenue,
           coalesce(sum(l.produced), 0)::int as produced
    from public.sales_log l
    where l.business_id = b.id and l.tick_at > p_since
  ) s on true
  where b.player_id = p_player_id
$$;

create function public.open_business(p_player_id uuid, p_type text) returns void
language plpgsql
set search_path = ''
as $$
declare
  t public.business_types;
  p public.players;
begin
  select * into t from public.business_types where type = p_type;
  if not found then raise exception 'Такого бизнеса нет'; end if;

  select * into p from public.players where id = p_player_id for update;
  if exists (select 1 from public.businesses where player_id = p_player_id and type = p_type) then
    raise exception 'Этот бизнес у тебя уже есть';
  end if;
  if p.cash < t.open_cost then
    raise exception 'Не хватает денег: нужно %', public.fmt_rub(t.open_cost);
  end if;

  update public.players set cash = cash - t.open_cost where id = p_player_id;
  insert into public.businesses (player_id, type, price) values (p_player_id, p_type, t.ref_price);
end;
$$;

-- Закупка: для кофейни и магазина — товар, для пекарни — мука.
create function public.restock(p_player_id uuid, p_type text, p_qty int) returns void
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

  if t.production_rate > 0 then
    v_free := t.raw_capacity - b.raw_stock;
  else
    v_free := t.capacity - b.stock;
  end if;
  if p_qty > v_free then raise exception 'На складе осталось место только для % шт.', v_free; end if;

  cost := p_qty::bigint * t.unit_cost;
  if p.cash < cost then raise exception 'Не хватает денег: нужно %', public.fmt_rub(cost); end if;

  update public.players set cash = cash - cost where id = p_player_id;
  if t.production_rate > 0 then
    update public.businesses set raw_stock = raw_stock + p_qty where id = b.id;
  else
    update public.businesses set stock = stock + p_qty where id = b.id;
  end if;
end;
$$;

-- Перевезти хлеб из своей пекарни в свой магазин (бесплатно — мука уже оплачена).
create function public.transfer_bread(p_player_id uuid, p_qty int) returns void
language plpgsql
set search_path = ''
as $$
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
  select capacity into cap from public.business_types where type = 'shop';

  if p_qty > bakery.stock then raise exception 'В пекарне только % шт. хлеба', bakery.stock; end if;
  if p_qty > cap - shop.stock then raise exception 'В магазине место только для % шт.', cap - shop.stock; end if;

  update public.businesses set stock = stock - p_qty where id = bakery.id;
  update public.businesses set stock = stock + p_qty where id = shop.id;
end;
$$;

create function public.set_price(p_player_id uuid, p_type text, p_price bigint) returns void
language plpgsql
set search_path = ''
as $$
declare
  t public.business_types;
begin
  select * into t from public.business_types where type = p_type;
  if not found or t.ref_price is null then raise exception 'Здесь цену поставить нельзя'; end if;
  if p_price is null or p_price % 100 <> 0 then raise exception 'Цена должна быть в целых рублях'; end if;
  if p_price < t.ref_price * 3 / 10 or p_price > t.ref_price * 3 then
    raise exception 'Цена должна быть от % до %', public.fmt_rub(t.ref_price * 3 / 10), public.fmt_rub(t.ref_price * 3);
  end if;

  update public.businesses set price = p_price where player_id = p_player_id and type = p_type;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
end;
$$;

-- Забрать выручку из всех касс. Возвращает собранную сумму.
create function public.collect_revenue(p_player_id uuid) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  total bigint;
begin
  perform 1 from public.players where id = p_player_id for update;

  with taken as (
    update public.businesses b
       set pending_revenue = 0
      from public.businesses old
     where b.id = old.id and b.player_id = p_player_id and old.pending_revenue > 0
    returning old.pending_revenue
  )
  select coalesce(sum(pending_revenue), 0) into total from taken;

  update public.players set cash = cash + total where id = p_player_id;
  return total;
end;
$$;

-- Тик: производство и продажи. Пока спрос простой; на этапе 4 его заменит рынок с конкурентами.
create function public.tick() returns void
language plpgsql
set search_path = ''
as $$
declare
  r          record;
  v_stock    int;
  v_raw      int;
  v_produced int;
  v_sold     int;
  v_demand   numeric;
begin
  for r in
    select b.id, b.player_id, b.price, b.stock, b.raw_stock,
           t.ref_price, t.base_demand, t.production_rate, t.capacity
      from public.businesses b
      join public.business_types t using (type)
       for update of b
  loop
    v_stock := r.stock;
    v_raw := r.raw_stock;
    v_produced := 0;
    v_sold := 0;

    if r.production_rate > 0 then
      v_produced := greatest(0, least(r.production_rate, v_raw, r.capacity - v_stock));
      v_raw := v_raw - v_produced;
      v_stock := v_stock + v_produced;
    end if;

    if r.base_demand > 0 and r.price > 0 then
      v_demand := r.base_demand * power(r.ref_price::numeric / r.price, 1.5) * (0.75 + random() * 0.5);
      v_sold := least(floor(v_demand + random())::int, v_stock);
      v_stock := v_stock - v_sold;
    end if;

    if v_produced > 0 or v_sold > 0 then
      update public.businesses
         set stock = v_stock,
             raw_stock = v_raw,
             pending_revenue = pending_revenue + v_sold::bigint * coalesce(r.price, 0)
       where id = r.id;
      insert into public.sales_log (business_id, player_id, sold, revenue, produced, stock_left)
      values (r.id, r.player_id, v_sold, v_sold::bigint * coalesce(r.price, 0), v_produced, v_stock);
    end if;
  end loop;

  delete from public.sales_log where tick_at < now() - interval '8 days';
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Тик каждые 5 минут.
create extension if not exists pg_cron;
select cron.schedule('capital-tick', '*/5 * * * *', 'select public.tick()');

-- Этап 4: общий рынок, спрос по времени суток, NPC-конкуренты.
--
-- Как устроен рынок (на каждый товар — кофе и хлеб):
-- 1. Продавцы: магазины/кофейни игроков + боты. Ботов тем меньше, чем больше живых игроков.
-- 2. Рыночная цена падает, когда продавцов больше нормы (6).
-- 3. Покупатели (NPC) приходят каждые 5 минут; их число зависит от времени суток по Москве.
-- 4. Каждый покупатель выбирает продавца: чем ниже цена относительно рынка, тем охотнее.
--    Если у продавца кончился товар, часть его покупателей уходит к другим.

alter table public.business_types add column market text;
update public.business_types set market = 'coffee' where type = 'coffee';
update public.business_types set market = 'bread'  where type = 'shop';

create table public.markets (
  market       text primary key,
  name         text not null,
  ref_price    bigint not null,   -- базовая цена
  base_demand  numeric not null,  -- покупателей за тик на одного продавца днём
  market_price bigint not null,   -- текущая рыночная цена (пересчитывается в тике)
  demand_level numeric not null default 1,
  sellers      int not null default 0,
  last_demand  int not null default 0,
  updated_at   timestamptz not null default now()
);

insert into public.markets (market, name, ref_price, base_demand, market_price) values
  ('coffee', 'кофе', 18000, 4, 18000),
  ('bread',  'хлеб',  9000, 6,  9000);

-- Боты-конкуренты. В рейтинг не попадают: это не игроки.
create table public.npc_sellers (
  id          serial primary key,
  market      text not null references public.markets(market),
  kind        text not null check (kind in ('dumper', 'premium', 'careful')),
  name        text not null,
  price_mult  numeric not null,  -- цена относительно рынка
  appeal      numeric not null,  -- привлекательность при равной цене
  max_players int not null,      -- бот работает, пока живых продавцов меньше этого числа
  price       bigint not null default 0,
  active      boolean not null default true,
  last_sold   int not null default 0
);

insert into public.npc_sellers (market, kind, name, price_mult, appeal, max_players) values
  ('coffee', 'dumper',  'Кофе-Экспресс',   0.85, 0.9, 6),
  ('coffee', 'premium', 'Арабика Люкс',    1.30, 1.4, 4),
  ('coffee', 'careful', 'Кофейня у дома',  1.00, 1.0, 2),
  ('bread',  'dumper',  'Хлеб-Дискаунтер', 0.85, 0.9, 6),
  ('bread',  'premium', 'Французская лавка', 1.30, 1.4, 4),
  ('bread',  'careful', 'Булочная №1',     1.00, 1.0, 2);

alter table public.markets     enable row level security;
alter table public.npc_sellers enable row level security;
revoke all on public.markets, public.npc_sellers from anon, authenticated;

-- Множитель спроса по часу (Москва). Кофе — пик утром, хлеб — утром и вечером.
create function public.hour_factor(p_market text, p_hour int) returns numeric
language sql immutable set search_path = ''
as $$
  select (case p_market
    when 'coffee' then array[0.15,0.1,0.1,0.1,0.15,0.3, 0.7,1.4,1.8,1.6,1.2,1.1, 1.3,1.3,1.0,1.0,1.1,1.1, 0.9,0.8,0.6,0.5,0.35,0.2]
    else               array[0.15,0.1,0.1,0.1,0.15,0.3, 0.6,1.1,1.3,1.1,0.9,0.9, 1.1,1.0,0.8,0.8,1.0,1.4, 1.6,1.5,1.1,0.7,0.4,0.25]
  end)[p_hour + 1]::numeric
$$;

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
     where t.production_rate > 0 and b.raw_stock > 0
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
      from public.businesses b join public.business_types t using (type)
     where t.market = m.market;

    update public.npc_sellers set active = (v_players < max_players) where market = m.market;
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
    select b.id, b.player_id, b.price, b.stock, power(v_mprice / b.price, 3)
      from public.businesses b join public.business_types t using (type)
     where t.market = m.market and b.stock > 0 and b.price > 0;

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

  delete from public.sales_log where tick_at < now() - interval '8 days';
end;
$$;

-- Состояние теперь включает рынки и конкурентов.
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  update public.players set last_seen_at = now() where id = p_player_id;

  select jsonb_build_object(
    'server_time', now(),
    'player', (select jsonb_build_object('id', id, 'first_name', first_name, 'cash', cash, 'created_at', created_at)
               from public.players where id = p_player_id),
    'catalog', (select jsonb_agg(to_jsonb(t.*) order by t.sort) from public.business_types t),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'type', b.type, 'price', b.price, 'stock', b.stock,
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue,
               'last_sold', coalesce((select l.sold from public.sales_log l
                                       where l.business_id = b.id and l.tick_at > now() - interval '5 minutes'
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
      from public.markets mk)
  ) into result;
  return result;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Этап 5: решение дня, сезоны по 7 дней, рейтинг.

-- ---------- Капитал игрока ----------
-- Капитал = деньги + выручка в кассах + товар на складах (по закупочной цене)
--          + 70% стоимости открытых бизнесов.
create function public.start_capital() returns bigint
language sql immutable set search_path = '' as $$ select 10000000::bigint $$;

create function public.capitals()
returns table (player_id uuid, first_name text, capital bigint)
language sql stable set search_path = ''
as $$
  select p.id, p.first_name,
         p.cash + coalesce(sum(
           b.pending_revenue
           + b.stock::bigint * (case when b.type = 'bakery'
                                     then (select unit_cost from public.business_types where type = 'shop')
                                     else t.unit_cost end)
           + b.raw_stock::bigint * t.unit_cost
           + t.open_cost * 7 / 10), 0)::bigint
    from public.players p
    left join public.businesses b on b.player_id = p.id
    left join public.business_types t on t.type = b.type
   group by p.id
$$;

-- ---------- Сезоны ----------
create table public.seasons (
  id        serial primary key,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  finished  boolean not null default false
);

-- Первый сезон заканчивается в 21:00 по Москве через 7 дней.
insert into public.seasons (starts_at, ends_at)
values (now(), (((now() at time zone 'Europe/Moscow')::date + 7) + time '21:00') at time zone 'Europe/Moscow');

create table public.season_results (
  season_id  int not null references public.seasons(id),
  player_id  uuid not null references public.players(id) on delete cascade,
  place      int not null,
  capital    bigint not null,
  growth     numeric not null,
  seen       boolean not null default false,
  primary key (season_id, player_id)
);

-- Почасовые снимки капитала — для рейтинга «рост за сутки».
create table public.capital_snapshots (
  player_id uuid not null references public.players(id) on delete cascade,
  taken_at  timestamptz not null default now(),
  capital   bigint not null,
  primary key (player_id, taken_at)
);

-- ---------- Решение дня ----------
create table public.decisions (
  id       text primary key,
  requires text references public.business_types(type), -- показывать, только если есть этот бизнес
  title    text not null,
  body     text not null,
  options  jsonb not null
);

-- Формат варианта: label, hint, cost (коп.), chance (вероятность удачи), effects / fail_effects, result / fail_result.
-- Эффекты: demand (множитель покупателей), discount (множитель цены закупки), cash (деньги), raw (мука в пекарню).
insert into public.decisions (id, requires, title, body, options) values
('blogger', 'coffee', 'Блогер хочет снять обзор',
 'Популярный городской блогер готов рассказать о твоей кофейне. За пост просит 3 000 ₽.',
 '[{"label":"Заплатить 3 000 ₽","hint":"Кофейня привлекает в 1,5 раза больше покупателей 6 часов","cost":300000,
    "effects":[{"kind":"demand","market":"coffee","mult":1.5,"hours":6,"label":"Обзор блогера"}],
    "result":"Пост вышел — к тебе потянулись новые покупатели!"},
   {"label":"Отказаться","hint":"Ничего не изменится","result":"Блогер пошёл к конкурентам."}]'),
('supplier', null, 'Поставщик распродаёт остатки',
 'Оптовик даёт скидку 25% на все закупки в ближайшие 3 часа. За участие просит 1 000 ₽.',
 '[{"label":"Участвовать за 1 000 ₽","hint":"Закупки на 25% дешевле 3 часа","cost":100000,
    "effects":[{"kind":"discount","mult":0.75,"hours":3,"label":"Скидка поставщика −25%"}],
    "result":"Скидка действует — самое время пополнить склады."},
   {"label":"Пропустить","hint":"Ничего не изменится","result":"Ты решил не тратиться."}]'),
('inspection', null, 'Внеплановая проверка',
 'Скоро придёт проверка. Можно потратить 2 000 ₽ на подготовку или рискнуть.',
 '[{"label":"Подготовиться за 2 000 ₽","hint":"Никаких штрафов","cost":200000,
    "result":"Проверка прошла без замечаний."},
   {"label":"Рискнуть","hint":"50% — штраф 6 000 ₽","chance":0.5,
    "fail_effects":[{"kind":"cash","amount":-600000}],
    "result":"Повезло: проверка ничего не нашла!","fail_result":"Нашли нарушения — штраф 6 000 ₽."}]'),
('festival', null, 'Городской праздник',
 'На площади ярмарка. Место для лотка стоит 4 000 ₽.',
 '[{"label":"Поставить лоток за 4 000 ₽","hint":"Все твои точки получают в 1,4 раза больше покупателей на 4 часа","cost":400000,
    "effects":[{"kind":"demand","mult":1.4,"hours":4,"label":"Ярмарка"}],
    "result":"Лоток на ярмарке собирает толпу!"},
   {"label":"Отдохнуть","hint":"Ничего не изменится","result":"Ты провёл праздник с семьёй."}]'),
('flour', 'bakery', 'Мельник продаёт муку',
 'Знакомый мельник отдаёт муку на 150 буханок всего за 1 000 ₽ (обычно это 2 250 ₽).',
 '[{"label":"Купить за 1 000 ₽","hint":"+150 муки в пекарню (сколько поместится)","cost":100000,
    "effects":[{"kind":"raw","qty":150}],
    "result":"Мука уже на складе пекарни."},
   {"label":"Отказаться","hint":"Ничего не изменится","result":"Мельник уехал."}]'),
('staff', null, 'Сотрудники просят премию',
 'Команда устала и просит премию 2 000 ₽.',
 '[{"label":"Выплатить премию","hint":"Покупателей в 1,2 раза больше на сутки","cost":200000,
    "effects":[{"kind":"demand","mult":1.2,"hours":24,"label":"Довольная команда"}],
    "result":"Команда работает с улыбкой — покупатели это чувствуют."},
   {"label":"Отказать","hint":"Покупателей станет меньше на 12 часов","effects":[{"kind":"demand","mult":0.85,"hours":12,"label":"Недовольная команда"}],
    "result":"Команда обиделась и работает спустя рукава."}]'),
('rain', 'coffee', 'Холодное дождливое утро',
 'Люди хотят согреться. Акция «второй кофе в подарок» обойдётся в 1 500 ₽.',
 '[{"label":"Провести акцию","hint":"Кофейня привлекает в 1,6 раза больше покупателей 3 часа","cost":150000,
    "effects":[{"kind":"demand","market":"coffee","mult":1.6,"hours":3,"label":"Акция в дождь"}],
    "result":"Очередь за кофе тянется до угла!"},
   {"label":"Не нужно","hint":"Ничего не изменится","result":"День прошёл как обычно."}]'),
('canteen', 'shop', 'Школьная столовая',
 'Столовая хочет брать хлеб у тебя. Договор стоит 2 500 ₽, но сделка может сорваться.',
 '[{"label":"Подписать за 2 500 ₽","hint":"70% — покупателей хлеба в 1,5 раза больше на сутки","cost":250000,"chance":0.7,
    "effects":[{"kind":"demand","market":"bread","mult":1.5,"hours":24,"label":"Договор со столовой"}],
    "result":"Договор подписан — столовая берёт твой хлеб!","fail_result":"Столовая выбрала другого поставщика. Деньги не вернуть."},
   {"label":"Отказаться","hint":"Ничего не изменится","result":"Ты решил не рисковать."}]');

create table public.player_decisions (
  player_id   uuid not null references public.players(id) on delete cascade,
  day         date not null,
  decision_id text not null references public.decisions(id),
  choice      int,
  success     boolean,
  result      text,
  primary key (player_id, day)
);

create table public.player_effects (
  id        bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  kind      text not null check (kind in ('demand', 'discount')),
  market    text,          -- null — на все рынки
  mult      numeric not null,
  until     timestamptz not null,
  label     text not null
);
create index player_effects_player on public.player_effects (player_id, until);

alter table public.seasons           enable row level security;
alter table public.season_results    enable row level security;
alter table public.capital_snapshots enable row level security;
alter table public.decisions         enable row level security;
alter table public.player_decisions  enable row level security;
alter table public.player_effects    enable row level security;
revoke all on public.seasons, public.season_results, public.capital_snapshots,
              public.decisions, public.player_decisions, public.player_effects from anon, authenticated;

create function public.moscow_today() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'Europe/Moscow')::date $$;

-- Решение дня: выбирается случайно один раз в сутки (по Москве) из подходящих игроку.
create function public.today_decision(p_player_id uuid) returns public.player_decisions
language plpgsql
set search_path = ''
as $$
declare
  pd public.player_decisions;
begin
  select * into pd from public.player_decisions where player_id = p_player_id and day = public.moscow_today();
  if found then return pd; end if;

  insert into public.player_decisions (player_id, day, decision_id)
  select p_player_id, public.moscow_today(), d.id
    from public.decisions d
   where d.requires is null
      or exists (select 1 from public.businesses b where b.player_id = p_player_id and b.type = d.requires)
   order by random()
   limit 1
  on conflict do nothing;

  select * into pd from public.player_decisions where player_id = p_player_id and day = public.moscow_today();
  return pd;
end;
$$;

create function public.decide(p_player_id uuid, p_option int) returns text
language plpgsql
set search_path = ''
as $$
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
           set raw_stock = least(t.raw_capacity, b.raw_stock + (e ->> 'qty')::int)
          from public.business_types t
         where t.type = b.type and b.player_id = p_player_id and b.type = 'bakery';
    end case;
  end loop;

  update public.player_decisions
     set choice = p_option, success = ok, result = outcome
   where player_id = p_player_id and day = pd.day;
  return outcome;
end;
$$;

-- Множитель от активных эффектов игрока.
create function public.effect_mult(p_player_id uuid, p_kind text, p_market text) returns numeric
language sql stable set search_path = ''
as $$
  select coalesce(exp(sum(ln(mult))), 1)
    from public.player_effects
   where player_id = p_player_id and kind = p_kind and until > now()
     and (market is null or market = p_market)
$$;

-- Закупка теперь учитывает скидки.
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

-- Тик: эффекты решений дня влияют на привлекательность точек игрока.
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
     where t.production_rate > 0 and b.raw_stock > 0
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
      from public.businesses b join public.business_types t using (type)
     where t.market = m.market;

    update public.npc_sellers set active = (v_players < max_players) where market = m.market;
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
      from public.businesses b join public.business_types t using (type)
     where t.market = m.market and b.stock > 0 and b.price > 0;

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

  delete from public.sales_log where tick_at < now() - interval '8 days';
  delete from public.player_effects where until < now() - interval '1 hour';
end;
$$;


-- ---------- Рейтинг ----------
-- p_kind: 'capital' — по капиталу, 'growth' — по росту капитала за последние 24 часа.
-- Боты в рейтинг не попадают: это не игроки.
create function public.leaderboard(p_player_id uuid, p_kind text) returns jsonb
language sql stable set search_path = ''
as $$
  with c as (
    select c.player_id, c.first_name, c.capital,
           coalesce((select s.capital from public.capital_snapshots s
                      where s.player_id = c.player_id and s.taken_at <= now() - interval '24 hours'
                      order by s.taken_at desc limit 1), public.start_capital()) as base
      from public.capitals() c
  ), ranked as (
    select player_id, first_name, capital,
           round((capital - base)::numeric / base * 100, 1) as growth,
           row_number() over (order by
             case when p_kind = 'growth' then (capital - base)::numeric / base else capital end desc,
             capital desc, player_id) as place
      from c
  )
  select jsonb_build_object(
    'kind', p_kind,
    'total', (select count(*) from ranked),
    'top', coalesce((select jsonb_agg(jsonb_build_object(
              'place', place, 'name', first_name, 'capital', capital, 'growth', growth,
              'me', player_id = p_player_id) order by place)
            from ranked where place <= 50), '[]'::jsonb),
    'me', (select jsonb_build_object('place', place, 'capital', capital, 'growth', growth)
             from ranked where player_id = p_player_id)
  )
$$;

-- ---------- Ежечасная задача: снимки капитала и смена сезона ----------
create function public.hourly() returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.seasons;
begin
  insert into public.capital_snapshots (player_id, capital)
  select player_id, capital from public.capitals();
  delete from public.capital_snapshots where taken_at < now() - interval '3 days';

  select * into s from public.seasons where not finished order by id desc limit 1 for update;
  if not found or s.ends_at > now() then return; end if;

  -- Итоги сезона.
  insert into public.season_results (season_id, player_id, place, capital, growth)
  select s.id, player_id,
         row_number() over (order by capital desc, player_id),
         capital,
         round((capital - public.start_capital())::numeric / public.start_capital() * 100, 1)
    from public.capitals();
  update public.seasons set finished = true where id = s.id;

  -- Новый сезон: все начинают заново с одинаковым капиталом.
  delete from public.businesses;
  delete from public.player_effects;
  delete from public.capital_snapshots;
  update public.players set cash = public.start_capital();

  insert into public.seasons (starts_at, ends_at)
  values (now(), greatest(s.ends_at + interval '7 days', now() + interval '7 days'));
end;
$$;

-- Итог прошлого сезона, который игрок ещё не видел (показывается один раз).
create function public.pop_season_result(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r      public.season_results;
  result jsonb;
begin
  select * into r from public.season_results
   where player_id = p_player_id and not seen
   order by season_id desc limit 1 for update;
  if not found then return null; end if;

  update public.season_results set seen = true where player_id = p_player_id;
  select jsonb_build_object(
    'season', r.season_id, 'place', r.place, 'capital', r.capital, 'growth', r.growth,
    'total', (select count(*) from public.season_results where season_id = r.season_id))
  into result;
  return result;
end;
$$;

-- ---------- Состояние экрана ----------
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  pd     public.player_decisions;
  result jsonb;
begin
  update public.players set last_seen_at = now() where id = p_player_id;
  pd := public.today_decision(p_player_id);

  select jsonb_build_object(
    'server_time', now(),
    'player', (select jsonb_build_object('id', id, 'first_name', first_name, 'cash', cash, 'created_at', created_at)
               from public.players where id = p_player_id),
    'catalog', (select jsonb_agg(to_jsonb(t.*) order by t.sort) from public.business_types t),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'type', b.type, 'price', b.price, 'stock', b.stock,
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue,
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
    'capital', (select c.capital from public.capitals() c where c.player_id = p_player_id),
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
    'discount', public.effect_mult(p_player_id, 'discount', null)
  ) into result;
  return result;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Каждый час в :01 — снимки капитала и проверка конца сезона.
select cron.schedule('capital-hourly', '1 * * * *', 'select public.hourly()');

-- Удаляем тестового игрока, созданного при проверке на этапе 2.
delete from public.players where telegram_id = -1;

commit;
