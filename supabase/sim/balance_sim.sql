-- Симуляция баланса CAPITAL. Запускается ТОЛЬКО на локальной копии базы (scripts: supabase/sim/run_sim.py).
-- Берёт настоящие функции тика из базы и подменяет в них «текущее время» на часы симуляции,
-- поэтому считает по тем же формулам, что и игра.
--
-- Сценарий: в городе N игроков, у каждого все бизнесы. Каждый заходит 2 раза в день (9:00 и 21:00 по Москве):
--   забирает выручку, ставит цену как на рынке, пополняет склады до полного,
--   пекарня отдаёт хлеб в свой магазин (по цене поставщика — так видно, сколько она экономит), остаток — оптовику,
--   маркетплейс докупает товар (кофе и хлеб пополам) по оптовой цене рынка,
--   агентство сдаёт готовые кампании оптовику.
-- Ремонтная бригада получает только городские заказы (игроки в симуляции не улучшаются).

create table if not exists public.sim_clock (id int primary key default 1, t timestamptz not null);
insert into public.sim_clock (t) values (now()) on conflict (id) do nothing;
create or replace function public.sim_now() returns timestamptz language sql stable set search_path = ''
as $$ select t from public.sim_clock where id = 1 $$;

do $do$
declare
  src text;
begin
  -- sim_tick_online
  select pg_get_functiondef('public.tick_online()'::regprocedure) into src;
  src := replace(src, 'public.tick_online()', 'public.sim_tick_online()');
  src := replace(src, 'from now() at time zone', 'from public.sim_now() at time zone');
  execute src;
  -- sim_city_jobs
  select pg_get_functiondef('public.city_repair_jobs()'::regprocedure) into src;
  src := replace(src, 'public.city_repair_jobs()', 'public.sim_city_jobs()');
  src := replace(src, 'now()', 'public.sim_now()');
  src := replace(src, 'public.sim_now() - interval', 'now() - interval'); -- live_players — по настоящим часам
  execute src;
  -- sim_tick
  select pg_get_functiondef('public.tick()'::regprocedure) into src;
  src := replace(src, 'public.tick()', 'public.sim_tick()');
  src := replace(src, 'from now() at time zone', 'from public.sim_now() at time zone');
  src := replace(src, 'perform public.tick_online();', 'perform public.sim_tick_online();');
  src := replace(src, 'perform public.process_repairs();', '');
  src := replace(src, 'perform public.city_repair_jobs();', 'perform public.sim_city_jobs();');
  execute src;
end;
$do$;

create table if not exists public.sim_acc (day int, player_id uuid, type text, amount bigint);

create or replace function public.sim_visit(p uuid, d int) returns void
language plpgsql set search_path = ''
as $$
declare
  b     record;
  v_q   int;
  shop  public.businesses;
  bak   public.businesses;
  v_shop_unit bigint := (select unit_cost from public.business_types where type = 'shop');
begin
  -- Выручка из касс.
  insert into public.sim_acc select d, p, type, pending_revenue from public.businesses where player_id = p and pending_revenue > 0;
  update public.businesses set pending_revenue = 0 where player_id = p;

  -- Кофейня: цена как на рынке, склад до полного.
  update public.businesses set price = (select round(market_price / 100.0) * 100 from public.markets where market = 'coffee')
   where player_id = p and type = 'coffee';
  for b in select bb.id, bb.stock, public.lvl_cap(t.capacity, bb.level) cap, t.unit_cost
             from public.businesses bb join public.business_types t using (type) where bb.player_id = p and bb.type = 'coffee' loop
    insert into public.sim_acc values (d, p, 'coffee', -(b.cap - b.stock)::bigint * b.unit_cost);
    update public.businesses set stock = b.cap where id = b.id;
  end loop;

  -- Пекарня → магазин (по цене поставщика), остаток хлеба — оптовику, мука до полного.
  select * into shop from public.businesses where player_id = p and type = 'shop';
  select * into bak from public.businesses where player_id = p and type = 'bakery';
  update public.businesses set price = (select round(market_price / 100.0) * 100 from public.markets where market = 'bread')
   where id = shop.id;
  if bak.id is not null then
    v_q := least(bak.stock, public.lvl_cap((select capacity from public.business_types where type = 'shop'), shop.level) - shop.stock);
    if shop.id is null then v_q := 0; end if;
    insert into public.sim_acc values (d, p, 'bakery', v_q::bigint * v_shop_unit), (d, p, 'shop', -v_q::bigint * v_shop_unit);
    update public.businesses set stock = stock + v_q where id = shop.id;
    insert into public.sim_acc values (d, p, 'bakery', (bak.stock - v_q)::bigint * public.wholesale_price('bread'));
    insert into public.sim_acc values (d, p, 'bakery',
      -(public.lvl_cap((select raw_capacity from public.business_types where type = 'bakery'), bak.level) - bak.raw_stock)::bigint
      * (select unit_cost from public.business_types where type = 'bakery'));
    update public.businesses
       set stock = 0, raw_stock = public.lvl_cap((select raw_capacity from public.business_types where type = 'bakery'), level)
     where id = bak.id;
  end if;
  if shop.id is not null then
    select * into shop from public.businesses where id = shop.id;
    v_q := public.lvl_cap((select capacity from public.business_types where type = 'shop'), shop.level) - shop.stock;
    insert into public.sim_acc values (d, p, 'shop', -v_q::bigint * v_shop_unit);
    update public.businesses set stock = stock + v_q where id = shop.id;
  end if;

  -- Маркетплейс: докупить товар (кофе и хлеб пополам) по оптовой цене.
  for b in select bb.id, public.lvl_cap(t.capacity, bb.level) - coalesce((select sum(qty) from public.business_goods g where g.business_id = bb.id), 0) free
             from public.businesses bb join public.business_types t using (type) where bb.player_id = p and bb.type = 'marketplace' loop
    if b.free > 0 then
      insert into public.business_goods (business_id, product, qty) values (b.id, 'coffee', b.free / 2), (b.id, 'bread', b.free - b.free / 2)
      on conflict (business_id, product) do update set qty = public.business_goods.qty + excluded.qty;
      insert into public.sim_acc values (d, p, 'marketplace',
        -((b.free / 2)::bigint * public.goods_price('coffee') + (b.free - b.free / 2)::bigint * public.goods_price('bread')));
    end if;
  end loop;

  -- Агентство: готовые кампании — оптовику.
  insert into public.sim_acc select d, p, 'agency', stock::bigint * public.wholesale_price('campaign')
    from public.businesses where player_id = p and type = 'agency' and stock > 0;
  update public.businesses set stock = 0 where player_id = p and type = 'agency';
end;
$$;

-- Прогон: p_players игроков, p_days дней. Возвращает средний доход в день на одного игрока по каждому бизнесу
-- (первый день — разгон, не считается).
create or replace function public.sim_run(p_players int, p_days int)
returns table (type text, name text, open_cost bigint, per_day bigint, payback numeric)
language plpgsql set search_path = ''
as $$
declare
  v_start timestamptz := (date_trunc('day', now() at time zone 'Europe/Moscow') + interval '1 day') at time zone 'Europe/Moscow';
  p record;
  h int;
begin
  delete from public.players;
  delete from public.sim_acc;
  update public.markets set market_price = ref_price;
  update public.npc_sellers set active = true;
  insert into public.players (telegram_id, first_name, cash, last_seen_at)
  select -500000 - g, 'Sim ' || g, 1000000000000, now() from generate_series(1, p_players) g;
  insert into public.businesses (player_id, type, price)
  select pl.id, t.type, t.ref_price from public.players pl cross join public.business_types t;

  for d in 0..p_days - 1 loop
    for k in 0..287 loop
      update public.sim_clock set t = v_start + make_interval(days => d, mins => k * 5);
      h := k / 12;
      if k % 12 = 0 and h in (9, 21) then
        for p in select id from public.players loop perform public.sim_visit(p.id, d); end loop;
      end if;
      perform public.sim_tick();
    end loop;
  end loop;

  return query
    select t.type, t.name, t.open_cost,
           (coalesce(sum(a.amount), 0) / p_players / (p_days - 1))::bigint,
           round(t.open_cost / nullif(coalesce(sum(a.amount), 0)::numeric / p_players / (p_days - 1), 0), 1)
      from public.business_types t
      left join public.sim_acc a on a.type = t.type and a.day >= 1
     group by t.type, t.name, t.open_cost, t.sort
     order by t.sort;
end;
$$;
