-- Карта города. У каждого игрока свой город (вид зависит от seed игрока), а у каждого бизнеса — участок в нём:
-- квартал (bi, bj) и место в первом ряду (bk). Районы открываются по капиталу. В районе, где бизнесу «лучше всего»,
-- он продаёт как раньше. Если игрок сам поставил бизнес в другой район, когда лучший уже был открыт, — продаёт
-- немного меньше (city.other_district_mult). Существующие бизнесы встают в лучший район (или, пока он закрыт,
-- в запасной без штрафа), поэтому их доход не меняется.

insert into public.balance_config (key, value, description) values
  ('city.stage_2',              30000000,  'Карта: с какого капитала открываются Частный сектор и Промзона (коп.)'),
  ('city.stage_3',              100000000, 'Карта: с какого капитала открывается Деловой квартал (коп.)'),
  ('city.stage_4',              250000000, 'Карта: с какого капитала открывается Новый район (коп.)'),
  ('city.other_district_mult',  0.9,       'Карта: продажи бизнеса не в своём лучшем районе (доля от обычных)'),
  ('city.rivals',               12,        'Карта: сколько бизнесов других игроков показывать в городе');

create table public.business_plots (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  bi smallint not null check (bi between 0 and 2),
  bj smallint not null check (bj between 0 and 3),
  bk smallint not null check (bk between 0 and 3),
  -- игрок сам выбрал не лучший район, хотя лучший был открыт: продажи × city.other_district_mult
  off_best boolean not null default false
);
alter table public.business_plots enable row level security;
revoke all on public.business_plots from anon, authenticated;

-- Схема города: кварталы 3 × 4, как в docs/city-mockup.html (DMAP).
create function public.city_district(p_i int, p_j int) returns text
language sql immutable set search_path = ''
as $$
  select (array[
    array['industry', 'industry', 'business'],
    array['private',  'center',   'business'],
    array['private',  'park',     'newres'],
    array['sleep',    'sleep',    'newres']])[p_j + 1][p_i + 1]
$$;

-- С какой стадии города открыт район.
create function public.city_stage_of(p_district text) returns int
language sql immutable set search_path = ''
as $$
  select case p_district when 'center' then 1 when 'sleep' then 1 when 'park' then 1
                         when 'private' then 2 when 'industry' then 2 when 'business' then 3 else 4 end
$$;

-- Стадия города по капиталу игрока (1–4).
create function public.city_stage(p_player uuid) returns int
language sql stable set search_path = ''
as $$
  select case when c.capital >= public.cfg('city.stage_4') then 4
              when c.capital >= public.cfg('city.stage_3') then 3
              when c.capital >= public.cfg('city.stage_2') then 2 else 1 end
    from public.capitals() c where c.player_id = p_player
$$;

-- Лучший район для бизнеса: Старый город — кофейня, Спальный — магазин, Частный сектор — пекарня,
-- Деловой квартал — реклама, Промзона — ремонт и склад маркетплейса, Новый район — ПВЗ.
create function public.best_district(p_type text) returns text
language sql immutable set search_path = ''
as $$
  select case p_type when 'coffee' then 'center' when 'shop' then 'sleep' when 'bakery' then 'private'
                     when 'agency' then 'business' when 'repair' then 'industry' when 'marketplace' then 'industry'
                     when 'pvz' then 'newres' end
$$;

-- Seed города игрока: свой у каждого, одинаковый при каждом входе.
create function public.city_seed(p_player uuid) returns int
language sql immutable set search_path = ''
as $$
  select ('x' || substr(md5('capital-city-' || p_player::text), 1, 8))::bit(32)::int
$$;

-- Можно ли поставить бизнес игрока на это место: район открыт, не парк, место не занято другим его бизнесом.
create function public.city_plot_free(p_player uuid, p_stage int, p_i int, p_j int, p_k int, p_except uuid default null)
returns boolean
language sql stable set search_path = ''
as $$
  select p_i between 0 and 2 and p_j between 0 and 3 and p_k between 0 and 3
     and public.city_district(p_i, p_j) <> 'park'
     and public.city_stage_of(public.city_district(p_i, p_j)) <= p_stage
     and not exists (select 1 from public.business_plots bp join public.businesses b on b.id = bp.business_id
                      where b.player_id = p_player and bp.bi = p_i and bp.bj = p_j and bp.bk = p_k
                        and b.id is distinct from p_except)
$$;

-- Участок по умолчанию: свободное место в лучшем районе (если он открыт), иначе в Старом городе или Спальном.
-- Порядок мест — от seed игрока, чтобы бизнесы разных игроков не стояли на одних и тех же местах.
create function public.city_assign_plot(p_business uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  b       public.businesses;
  v_seed  int;
  v_stage int;
  v_slot  record;
begin
  select * into b from public.businesses where id = p_business;
  if not found then return; end if;
  v_seed := public.city_seed(b.player_id);
  v_stage := coalesce(public.city_stage(b.player_id), 1);
  select i, j, k into v_slot
    from generate_series(0, 2) i, generate_series(0, 3) j, generate_series(0, 3) k
   where public.city_plot_free(b.player_id, v_stage, i, j, k, b.id)
   order by case public.city_district(i, j)
              when public.best_district(b.type) then 0 when 'center' then 1 when 'sleep' then 2 else 3 end,
            md5(v_seed::text || '-' || i || '-' || j || '-' || k)
   limit 1;
  if not found then return; end if;
  insert into public.business_plots (business_id, bi, bj, bk) values (b.id, v_slot.i, v_slot.j, v_slot.k)
  on conflict (business_id) do update set bi = excluded.bi, bj = excluded.bj, bk = excluded.bk, off_best = false;
end;
$$;

-- Новый бизнес сразу получает участок; купленный у другого игрока — участок в городе нового владельца.
create function public.business_plot_trigger() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.player_id is distinct from old.player_id then
    perform public.city_assign_plot(new.id);
  end if;
  return new;
end;
$$;
create trigger businesses_plot after insert or update of player_id on public.businesses
for each row execute function public.business_plot_trigger();

-- Уже открытые бизнесы — на участки в своих районах.
select public.city_assign_plot(id) from public.businesses order by created_at;

-- Продажи бизнеса с учётом района: 1, а если игрок сам выбрал не лучший район — city.other_district_mult.
create function public.plot_mult(p_business uuid) returns numeric
language sql stable set search_path = ''
as $$
  select coalesce((select case when bp.off_best then public.cfg('city.other_district_mult') else 1 end
                     from public.business_plots bp where bp.business_id = p_business), 1)
$$;

-- Открыть бизнес на выбранном участке карты.
create function public.open_business_at(p_player_id uuid, p_type text, p_i int, p_j int, p_k int) returns void
language plpgsql set search_path = ''
as $$
declare
  v_id    uuid;
  v_stage int;
begin
  perform 1 from public.players where id = p_player_id for update;
  v_stage := coalesce(public.city_stage(p_player_id), 1);
  if not public.city_plot_free(p_player_id, v_stage, p_i, p_j, p_k) then
    raise exception 'Этот участок недоступен: выбери свободный участок в открытом районе';
  end if;
  perform public.open_business(p_player_id, p_type);
  select id into v_id from public.businesses where player_id = p_player_id and type = p_type;
  update public.business_plots
     set bi = p_i, bj = p_j, bk = p_k,
         off_best = public.city_district(p_i, p_j) <> public.best_district(p_type)
                    and public.city_stage_of(public.best_district(p_type)) <= v_stage
   where business_id = v_id;
end;
$$;

-- Город для карты: стадия, пороги, свои участки и бизнесы других игроков (с их участками), NPC-конкуренты.
create function public.city_view(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'rivals', coalesce((
      select jsonb_agg(x.j order by x.cap desc, x.id)
        from (select b.id, c.capital as cap,
                     jsonb_build_object('id', b.id, 'type', b.type, 'level', b.level, 'i', bp.bi, 'j', bp.bj, 'k', bp.bk,
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
        from public.npc_niches n where n.active and n.kind in ('marketplace', 'pvz', 'agency')), '[]'::jsonb))
$$;

-- Тик: доля покупателей кофейни, магазина и пекарни — с учётом района.
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
           * public.ad_mult(b.player_id, b.type) * public.lvl_sales(b.level) * public.plot_mult(b.id)
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

-- Онлайн-ниши: продажи маркетплейса — с учётом района.
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
    select b.id, b.player_id, public.lvl_sales(b.level) * public.plot_mult(b.id) as lv from public.businesses b join public.players p on p.id = b.player_id
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

-- Посылки по ПВЗ — с учётом района.
create or replace function public.distribute_parcels(p_n int, p_npc boolean) returns int
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
    select coalesce(sum(public.lvl_cap(t.capacity, b.level) * public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level) * public.plot_mult(b.id)), 0)
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
    select coalesce(sum(public.lvl_cap(t.capacity, b.level) * public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level) * public.plot_mult(b.id)), 0)
      into v_cap_sum
      from public.businesses b join public.business_types t using (type) join public.players p on p.id = b.player_id
     where b.type = 'pvz' and not b.listed and not p.is_test and b.stock < public.lvl_cap(t.capacity, b.level);
    exit when v_cap_sum = 0;
    for r in
      select b.id, b.stock, public.lvl_cap(t.capacity, b.level) as capacity,
             public.ad_mult(b.player_id, 'pvz') * public.lvl_sales(b.level) * public.plot_mult(b.id) as w
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

-- Состояние: город игрока для карты.
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
