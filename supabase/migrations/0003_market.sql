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
