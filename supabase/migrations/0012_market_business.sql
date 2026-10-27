-- Рынок, этап 2: продажа бизнеса целиком.
-- Выставленный бизнес замораживается: не торгует, не печёт, его нельзя пополнить или переоценить —
-- покупатель получает ровно то, что видел в лоте. Снятие с продажи размораживает.

alter table public.businesses add column listed boolean not null default false;

alter table public.market_lots drop constraint market_lots_kind_check;
alter table public.market_lots add constraint market_lots_kind_check check (kind in ('goods', 'business'));
alter table public.market_lots alter column product drop not null;
alter table public.market_lots alter column source drop not null;
alter table public.market_lots
  add column business_id   uuid references public.businesses(id) on delete set null,
  add column business_type text references public.business_types(type),
  add column valuation     bigint;

alter table public.market_trades drop constraint market_trades_kind_check;
alter table public.market_trades add constraint market_trades_kind_check check (kind in ('lot', 'wholesale', 'business'));

-- Замороженный бизнес нельзя менять (склад, мука, цена), пока он на продаже.
create function public.guard_listed_business() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.listed and new.listed
     and (new.stock <> old.stock or new.raw_stock <> old.raw_stock or new.price is distinct from old.price) then
    raise exception 'Бизнес выставлен на продажу — сначала сними его с рынка';
  end if;
  return new;
end;
$$;

create trigger businesses_guard_listed before update on public.businesses
for each row execute function public.guard_listed_business();

-- Оптовая цена — в целых рублях.
create or replace function public.goods_price(p_product text) returns bigint
language sql stable set search_path = ''
as $$
  select (round(t.unit_cost * least(1.15, greatest(0.7, m.market_price::numeric / m.ref_price)) / 100) * 100)::bigint
    from public.business_types t
    join public.markets m on m.market = case p_product when 'coffee' then 'coffee' else 'bread' end
   where t.type = case p_product when 'coffee' then 'coffee' when 'bread' then 'shop' else 'bakery' end
$$;

-- Оценочная стоимость бизнеса: цена открытия + улучшения (в игре их пока нет) + товар на складе по оптовой цене.
create function public.business_valuation(p_business uuid) returns bigint
language sql stable set search_path = ''
as $$
  select t.open_cost
       + b.stock::bigint * case b.type when 'coffee' then public.goods_price('coffee') else public.goods_price('bread') end
       + b.raw_stock::bigint * public.goods_price('flour')
    from public.businesses b join public.business_types t using (type)
   where b.id = p_business
$$;

-- Вернуть товар продавцу. Если бизнеса-источника у него уже нет (продан) — товар выкупает оптовик.
create or replace function public.return_goods(p_player uuid, p_product text, p_source text, p_qty int) returns void
language plpgsql set search_path = ''
as $$
begin
  update public.businesses
     set stock = case when p_product = 'flour' then stock else stock + p_qty end,
         raw_stock = case when p_product = 'flour' then raw_stock + p_qty else raw_stock end
   where player_id = p_player and type = p_source and not listed;
  if not found then
    update public.players set cash = cash + p_qty::bigint * public.wholesale_price(p_product) where id = p_player;
    insert into public.market_trades (kind, seller_id, product, qty, price, total)
    values ('wholesale', p_player, p_product, p_qty, public.wholesale_price(p_product), p_qty::bigint * public.wholesale_price(p_product));
  end if;
end;
$$;

-- ---------- Выставить бизнес ----------
create function public.create_business_lot(p_player uuid, p_type text, p_price bigint) returns text
language plpgsql set search_path = ''
as $$
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
$$;

-- ---------- Купить бизнес ----------
create function public.buy_business_lot(p_buyer uuid, p_lot bigint) returns text
language plpgsql set search_path = ''
as $$
declare
  l       public.market_lots;
  b       public.players;
  s       public.players;
  v_fee   bigint;
  v_flags text[] := '{}';
  v_pair  int;
  v_got   bigint;
  v_cap   bigint;
begin
  -- 1. Лот.
  select * into l from public.market_lots where id = p_lot for update;
  if not found or l.kind <> 'business' or l.status <> 'active' or l.expires_at <= now() or l.business_id is null then
    raise exception 'Лот уже недоступен';
  end if;
  if l.seller_id = p_buyer then raise exception 'Нельзя купить свой бизнес'; end if;

  -- 2. Игроки — по возрастанию id.
  if p_buyer < l.seller_id then
    select * into b from public.players where id = p_buyer for update;
    select * into s from public.players where id = l.seller_id for update;
  else
    select * into s from public.players where id = l.seller_id for update;
    select * into b from public.players where id = p_buyer for update;
  end if;
  if s.is_test and not b.is_admin then raise exception 'Лот уже недоступен'; end if;
  if b.is_test and not s.is_admin then raise exception 'Лот уже недоступен'; end if;

  -- 3. Бизнес.
  perform 1 from public.businesses where id = l.business_id for update;
  if exists (select 1 from public.businesses where player_id = p_buyer and type = l.business_type) then
    raise exception 'У тебя уже есть такой бизнес';
  end if;
  if b.cash < l.price then raise exception 'Не хватает денег: нужно %', public.fmt_rub(l.price); end if;
  v_fee := ceil(l.price * 0.05)::bigint;

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
    if v_got + l.price - v_fee > 0.3 * greatest(coalesce(v_cap, 0), 1) then
      v_flags := array_append(v_flags, 'big_share');
    end if;
  end if;

  -- 5. Сделка.
  update public.players set cash = cash - l.price where id = b.id;
  update public.players set cash = cash + l.price - v_fee where id = s.id;
  update public.businesses set player_id = b.id, listed = false, pending_revenue = 0 where id = l.business_id;
  update public.market_lots set qty_left = 0, status = 'sold', closed_at = now() where id = l.id;
  insert into public.market_trades (lot_id, kind, seller_id, buyer_id, product, qty, price, total, fee, flags)
  values (l.id, 'business', s.id, b.id, l.business_type, 1, l.price, l.price, v_fee, v_flags);

  return format('%s теперь твоя — за %s', (select name from public.business_types where type = l.business_type),
                public.fmt_rub(l.price));
end;
$$;

-- Снятие лота: товарный — товар обратно, бизнес — размораживается.
create or replace function public.cancel_lot(p_player uuid, p_lot bigint) returns text
language plpgsql set search_path = ''
as $$
declare
  l public.market_lots;
begin
  select * into l from public.market_lots where id = p_lot for update;
  if not found or l.seller_id <> p_player then raise exception 'Лот не найден'; end if;
  if l.status <> 'active' then raise exception 'Лот уже закрыт'; end if;

  perform 1 from public.players where id = p_player for update;
  if l.kind = 'business' then
    update public.businesses set listed = false where id = l.business_id;
    update public.market_lots set status = 'cancelled', closed_at = now() where id = l.id;
    return 'Бизнес снят с продажи и снова работает';
  end if;

  perform 1 from public.businesses where player_id = p_player and type = l.source for update;
  if l.qty_left > 0 then perform public.return_goods(p_player, l.product, l.source, l.qty_left); end if;
  update public.market_lots set status = 'cancelled', closed_at = now() where id = l.id;
  return format('Лот снят, на склад вернулось %s шт.', l.qty_left);
end;
$$;

create or replace function public.expire_lots() returns void
language plpgsql set search_path = ''
as $$
declare
  l record;
begin
  for l in select * from public.market_lots where status = 'active' and expires_at <= now() for update skip locked loop
    perform 1 from public.players where id = l.seller_id for update;
    if l.kind = 'business' then
      update public.businesses set listed = false where id = l.business_id;
    elsif l.qty_left > 0 then
      perform public.return_goods(l.seller_id, l.product, l.source, l.qty_left);
    end if;
    update public.market_lots set status = 'expired', closed_at = now() where id = l.id;
  end loop;
end;
$$;


-- Тик: бизнесы на продаже заморожены.
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

  delete from public.sales_log where tick_at < now() - interval '8 days';
  delete from public.player_effects where until < now() - interval '1 hour';
end;
$$;

-- Состояние: бизнес на продаже.
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
    'discount', public.effect_mult(p_player_id, 'discount', null)
  ) into result;
  return result;
end;
$$;

-- Вкладка «Рынок»: бизнесы на продаже и оценка своих бизнесов.
create or replace function public.market_view(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  with me as (select * from public.players where id = p_player)
  select jsonb_build_object(
    'prices', public.goods_prices(),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'product', l.product, 'qty_left', l.qty_left, 'qty_total', l.qty_total,
               'price', l.price, 'expires_at', l.expires_at,
               'seller', jsonb_build_object('id', p.id, 'name', coalesce(p.company_name, p.first_name),
                                            'icon', p.company_icon, 'color', p.company_color,
                                            'dev', p.is_admin and p.show_dev_badge, 'test', p.is_test))
             order by l.product, l.price, l.created_at)
        from public.market_lots l
        join public.players p on p.id = l.seller_id
        cross join me
       where l.kind = 'goods' and l.status = 'active' and l.expires_at > now() and l.seller_id <> me.id
         and (not p.is_test or me.is_admin)), '[]'::jsonb),
    'business_lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'type', l.business_type, 'price', l.price, 'valuation', l.valuation,
               'stock', bz.stock, 'raw_stock', bz.raw_stock, 'expires_at', l.expires_at,
               'seller', jsonb_build_object('id', p.id, 'name', coalesce(p.company_name, p.first_name),
                                            'icon', p.company_icon, 'color', p.company_color,
                                            'dev', p.is_admin and p.show_dev_badge, 'test', p.is_test))
             order by l.price)
        from public.market_lots l
        join public.players p on p.id = l.seller_id
        join public.businesses bz on bz.id = l.business_id
        cross join me
       where l.kind = 'business' and l.status = 'active' and l.expires_at > now() and l.seller_id <> me.id
         and (not p.is_test or me.is_admin)), '[]'::jsonb),
    'my_businesses', coalesce((
      select jsonb_agg(jsonb_build_object('type', bz.type, 'valuation', public.business_valuation(bz.id), 'listed', bz.listed))
        from public.businesses bz where bz.player_id = p_player), '[]'::jsonb),
    'my_lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'kind', l.kind, 'business_type', l.business_type, 'valuation', l.valuation,
               'product', l.product, 'source', l.source, 'qty_left', l.qty_left, 'qty_total', l.qty_total,
               'price', l.price, 'status', l.status, 'created_at', l.created_at, 'expires_at', l.expires_at)
             order by l.created_at desc)
        from public.market_lots l
       where l.seller_id = p_player and (l.status = 'active' or l.closed_at > now() - interval '24 hours')), '[]'::jsonb),
    'my_trades', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object(
                 'side', case when t.seller_id = p_player then 'sold' else 'bought' end,
                 'kind', t.kind, 'product', t.product, 'qty', t.qty, 'price', t.price, 'total', t.total, 'fee', t.fee,
                 'at', t.created_at,
                 'other', case when t.kind = 'wholesale' then 'Оптовик'
                               else (select coalesce(o.company_name, o.first_name) from public.players o
                                      where o.id = case when t.seller_id = p_player then t.buyer_id else t.seller_id end) end) x
          from public.market_trades t
         where t.seller_id = p_player or t.buyer_id = p_player
         order by t.created_at desc limit 30) s), '[]'::jsonb)
  )
$$;

-- Тестовые игроки торгуют и бизнесами.
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
        select b.type, case b.type when 'coffee' then 'coffee' when 'shop' then 'bread' else
                 case when random() < 0.5 then 'flour' else 'bread' end end,
               b.stock, b.raw_stock
          into v_src, v_prod, v_have, v_qty
          from public.businesses b where b.player_id = t.id order by random() limit 1;
        if v_prod = 'flour' then v_have := v_qty; end if;
        if v_src is not null and v_have >= 10 then
          v_mkt := public.goods_price(v_prod);
          perform public.create_lot(t.id, v_prod, v_src, least(v_have, 10 + floor(random() * 40)::int),
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

-- Покупка товарного лота: лимит 3 покупки в сутки считает и покупки бизнесов.
create or replace function public.buy_lot(p_buyer uuid, p_lot bigint, p_qty int) returns text
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
  v_dest := public.goods_dest(p_buyer, l.product);
  if v_dest is null then
    raise exception 'Некуда положить товар: открой %',
      case l.product when 'coffee' then 'кофейню' when 'flour' then 'пекарню' else 'магазин или пекарню' end;
  end if;
  select case when l.product = 'flour' then t.raw_capacity - bz.raw_stock else t.capacity - bz.stock end
    into v_free
    from public.businesses bz join public.business_types t using (type)
   where bz.player_id = p_buyer and bz.type = v_dest
     for update of bz;
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
  update public.businesses
     set stock = case when l.product = 'flour' then stock else stock + p_qty end,
         raw_stock = case when l.product = 'flour' then raw_stock + p_qty else raw_stock end
   where player_id = p_buyer and type = v_dest;
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
