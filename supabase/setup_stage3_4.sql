-- CAPITAL: установка этапов 3 и 4. Вставьте весь этот текст в SQL Editor и нажмите Run.
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

-- Удаляем тестового игрока, созданного при проверке на этапе 2.
delete from public.players where telegram_id = -1;

commit;
