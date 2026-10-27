-- Рынок между игроками: товарные лоты, оптовик, комиссия, защита от перекачки денег.
--
-- «Рыночная цена товара» на этом рынке — оптовая цена партии (цена поставщика, сдвинутая вместе с рынком),
-- а не розничная цена чашки. Иначе оптовик платил бы больше, чем стоит товар у поставщика,
-- и деньги можно было бы печатать: купил у поставщика → сдал оптовику → повторил.
--
-- Каждая сделка — одна функция = одна транзакция. Порядок блокировок везде одинаковый:
-- лот → игроки (по возрастанию id) → бизнесы. Так две встречные сделки не зависнут друг на друге.

create table public.market_lots (
  id          bigint generated always as identity primary key,
  seller_id   uuid not null references public.players(id) on delete cascade,
  kind        text not null default 'goods' check (kind in ('goods')),
  product     text not null check (product in ('coffee', 'bread', 'flour')),
  source      text not null check (source in ('coffee', 'shop', 'bakery')), -- откуда снят товар
  qty_total   int not null check (qty_total > 0),
  qty_left    int not null check (qty_left >= 0),
  price       bigint not null check (price > 0),    -- за единицу, копейки
  status      text not null default 'active' check (status in ('active', 'sold', 'cancelled', 'expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours',
  closed_at   timestamptz
);
create index market_lots_active on public.market_lots (product, price) where status = 'active';
create index market_lots_seller on public.market_lots (seller_id, status);

create table public.market_trades (
  id          bigint generated always as identity primary key,
  lot_id      bigint references public.market_lots(id) on delete set null,
  kind        text not null check (kind in ('lot', 'wholesale')),
  seller_id   uuid references public.players(id) on delete set null,
  buyer_id    uuid references public.players(id) on delete set null,  -- null — оптовик
  product     text not null,
  qty         int not null,
  price       bigint not null,
  total       bigint not null,
  fee         bigint not null default 0,      -- комиссия рынка (сгорает)
  flags       text[] not null default '{}',   -- пометки для проверки: friends, frequent, big_share
  created_at  timestamptz not null default now()
);
create index market_trades_pair on public.market_trades (buyer_id, seller_id, created_at);
create index market_trades_time on public.market_trades (created_at desc);

-- История оптовых цен (для изменения за сутки и графиков).
create table public.goods_price_history (
  product text not null,
  at      timestamptz not null default now(),
  price   bigint not null,
  primary key (product, at)
);

alter table public.market_lots         enable row level security;
alter table public.market_trades       enable row level security;
alter table public.goods_price_history enable row level security;
revoke all on public.market_lots, public.market_trades, public.goods_price_history from anon, authenticated;

-- Оптовая цена товара сейчас (копейки за единицу) и цена оптовика (70%, но не выше 70% цены поставщика).
create function public.goods_price(p_product text) returns bigint
language sql stable set search_path = ''
as $$
  select round(t.unit_cost * least(1.15, greatest(0.7, m.market_price::numeric / m.ref_price)))::bigint
    from public.business_types t
    join public.markets m on m.market = case p_product when 'coffee' then 'coffee' else 'bread' end
   where t.type = case p_product when 'coffee' then 'coffee' when 'bread' then 'shop' else 'bakery' end
$$;

create function public.wholesale_price(p_product text) returns bigint
language sql stable set search_path = ''
as $$
  select floor(0.7 * least(public.goods_price(p_product),
                           (select unit_cost from public.business_types
                             where type = case p_product when 'coffee' then 'coffee' when 'bread' then 'shop' else 'bakery' end)))::bigint
$$;

-- Где лежит товар: какой бизнес и какое поле склада.
create function public.check_source(p_product text, p_source text) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if not ((p_product = 'coffee' and p_source = 'coffee')
       or (p_product = 'bread'  and p_source in ('shop', 'bakery'))
       or (p_product = 'flour'  and p_source = 'bakery')) then
    raise exception 'Этот товар нельзя взять с этого склада';
  end if;
end;
$$;

-- Списать товар со склада продавца (строка бизнеса уже должна быть заблокирована вызывающей функцией).
create function public.take_goods(p_player uuid, p_product text, p_source text, p_qty int) returns void
language plpgsql set search_path = ''
as $$
declare
  v_have int;
begin
  perform public.check_source(p_product, p_source);
  if p_qty is null or p_qty < 1 or p_qty > 100000 then raise exception 'Неверное количество'; end if;

  select case when p_product = 'flour' then raw_stock else stock end into v_have
    from public.businesses where player_id = p_player and type = p_source for update;
  if not found then raise exception 'Сначала открой этот бизнес'; end if;
  if v_have < p_qty then raise exception 'На складе только % шт.', v_have; end if;

  update public.businesses
     set stock = case when p_product = 'flour' then stock else stock - p_qty end,
         raw_stock = case when p_product = 'flour' then raw_stock - p_qty else raw_stock end
   where player_id = p_player and type = p_source;
end;
$$;

-- Куда товар попадает у покупателя: кофе → кофейня, мука → пекарня, хлеб → магазин (если нет — пекарня).
create function public.goods_dest(p_player uuid, p_product text) returns text
language sql stable set search_path = ''
as $$
  select case p_product
    when 'coffee' then case when exists (select 1 from public.businesses where player_id = p_player and type = 'coffee') then 'coffee' end
    when 'flour'  then case when exists (select 1 from public.businesses where player_id = p_player and type = 'bakery') then 'bakery' end
    else case
      when exists (select 1 from public.businesses where player_id = p_player and type = 'shop') then 'shop'
      when exists (select 1 from public.businesses where player_id = p_player and type = 'bakery') then 'bakery'
    end
  end
$$;

-- Вернуть товар продавцу (снятие или истечение лота). Склад может временно оказаться переполнен —
-- тогда новые закупки ждут, пока он разгрузится; товар при этом не теряется.
create function public.return_goods(p_player uuid, p_product text, p_source text, p_qty int) returns void
language sql set search_path = ''
as $$
  update public.businesses
     set stock = case when p_product = 'flour' then stock else stock + p_qty end,
         raw_stock = case when p_product = 'flour' then raw_stock + p_qty else raw_stock end
   where player_id = p_player and type = p_source
$$;

-- ---------- Выставить лот ----------
create function public.create_lot(p_player uuid, p_product text, p_source text, p_qty int, p_price bigint) returns text
language plpgsql set search_path = ''
as $$
declare
  p      public.players;
  v_mkt  bigint := public.goods_price(p_product);
begin
  select * into p from public.players where id = p_player for update;
  if (select count(*) from public.market_lots where seller_id = p_player and status = 'active') >= 5 then
    raise exception 'Не больше 5 активных лотов';
  end if;
  if p_price is null or p_price % 100 <> 0 then raise exception 'Цена — в целых рублях'; end if;
  if p_price < ceil(v_mkt * 0.5 / 100) * 100 or p_price > floor(v_mkt * 1.5 / 100) * 100 then
    raise exception 'Цена должна быть от % до % за штуку',
      public.fmt_rub(ceil(v_mkt * 0.5 / 100)::bigint * 100), public.fmt_rub(floor(v_mkt * 1.5 / 100)::bigint * 100);
  end if;

  perform public.take_goods(p_player, p_product, p_source, p_qty);
  insert into public.market_lots (seller_id, product, source, qty_total, qty_left, price)
  values (p_player, p_product, p_source, p_qty, p_qty, p_price);
  return format('Лот выставлен: %s шт. по %s', p_qty, public.fmt_rub(p_price));
end;
$$;

-- ---------- Снять лот ----------
create function public.cancel_lot(p_player uuid, p_lot bigint) returns text
language plpgsql set search_path = ''
as $$
declare
  l public.market_lots;
begin
  select * into l from public.market_lots where id = p_lot for update;
  if not found or l.seller_id <> p_player then raise exception 'Лот не найден'; end if;
  if l.status <> 'active' then raise exception 'Лот уже закрыт'; end if;

  perform 1 from public.players where id = p_player for update;
  perform 1 from public.businesses where player_id = p_player and type = l.source for update;
  if l.qty_left > 0 then perform public.return_goods(p_player, l.product, l.source, l.qty_left); end if;
  update public.market_lots set status = 'cancelled', closed_at = now() where id = l.id;
  return format('Лот снят, на склад вернулось %s шт.', l.qty_left);
end;
$$;

-- ---------- Купить лот (целиком или часть) ----------
create function public.buy_lot(p_buyer uuid, p_lot bigint, p_qty int) returns text
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
  if not found or l.status <> 'active' or l.expires_at <= now() then raise exception 'Лот уже недоступен'; end if;
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
     where kind = 'lot' and buyer_id = p_buyer and seller_id = s.id and created_at > now() - interval '24 hours';
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

-- ---------- Продать оптовику (сразу, по 70%) ----------
create function public.sell_wholesale(p_player uuid, p_product text, p_source text, p_qty int) returns text
language plpgsql set search_path = ''
as $$
declare
  v_price bigint := public.wholesale_price(p_product);
  v_total bigint;
begin
  perform 1 from public.players where id = p_player for update;
  perform public.take_goods(p_player, p_product, p_source, p_qty);
  v_total := p_qty::bigint * v_price;
  update public.players set cash = cash + v_total where id = p_player;
  insert into public.market_trades (kind, seller_id, product, qty, price, total)
  values ('wholesale', p_player, p_product, p_qty, v_price, v_total);
  return format('Оптовик купил %s шт. за %s', p_qty, public.fmt_rub(v_total));
end;
$$;

-- ---------- Цены, лоты и история для вкладки «Рынок» ----------
create function public.goods_prices() returns jsonb
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
    from (values ('coffee', 1), ('bread', 2), ('flour', 3)) g(product, ord)
$$;

create function public.market_view(p_player uuid) returns jsonb
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
       where l.status = 'active' and l.expires_at > now() and l.seller_id <> me.id
         and (not p.is_test or me.is_admin)), '[]'::jsonb),
    'my_lots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'product', l.product, 'source', l.source, 'qty_left', l.qty_left, 'qty_total', l.qty_total,
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

-- ---------- Обслуживание рынка (каждые 5 минут) ----------
-- Истёкшие лоты возвращают товар продавцу; записываются цены; тестовые игроки торгуют с администратором.
create function public.expire_lots() returns void
language plpgsql set search_path = ''
as $$
declare
  l record;
begin
  for l in select * from public.market_lots where status = 'active' and expires_at <= now() for update skip locked loop
    perform 1 from public.players where id = l.seller_id for update;
    if l.qty_left > 0 then perform public.return_goods(l.seller_id, l.product, l.source, l.qty_left); end if;
    update public.market_lots set status = 'expired', closed_at = now() where id = l.id;
  end loop;
end;
$$;

-- Тестовые игроки: держат по 2 лота (случайный товар и цена в коридоре) и иногда покупают лоты администраторов.
create function public.test_players_act() returns void
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
         where ml.status = 'active' and s.is_admin and public.goods_dest(t.id, ml.product) is not null
         order by ml.price::numeric / public.goods_price(ml.product) limit 1;
        if found then
          perform public.buy_lot(t.id, l.id, least(l.qty_left, 1 + floor(random() * 10)::int));
        end if;
      end if;
    exception when others then
      -- Нет места, нет денег и т. п. — тестовый игрок просто пропускает ход.
      null;
    end;
  end loop;
end;
$$;

create function public.market_maintenance() returns void
language plpgsql set search_path = ''
as $$
begin
  perform public.expire_lots();
  insert into public.goods_price_history (product, price)
  select g, public.goods_price(g) from unnest(array['coffee', 'bread', 'flour']) g
  on conflict do nothing;
  delete from public.goods_price_history where at < now() - interval '3 days';
  perform public.test_players_act();
end;
$$;


-- Смена сезона: все лоты снимаются.
create or replace function public.hourly() returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.seasons;
  p record;
begin
  insert into public.capital_snapshots (player_id, capital)
  select player_id, capital from public.capitals();
  delete from public.capital_snapshots where taken_at < now() - interval '3 days';

  select * into s from public.seasons where not finished order by id desc limit 1 for update;
  if not found or s.ends_at > now() then
    for p in select id from public.players loop
      perform public.check_achievements(p.id);
    end loop;
    return;
  end if;

  -- Итоги сезона.
  -- prize_place — место для призов: администраторы его не получают, приз уходит следующему.
  insert into public.season_results (season_id, player_id, place, capital, growth, prize_place)
  select s.id, c.player_id,
         row_number() over (order by c.capital desc, c.player_id),
         c.capital,
         round((c.capital - public.start_capital())::numeric / public.start_capital() * 100, 1),
         case when pl.is_admin then null
              else row_number() over (order by pl.is_admin, c.capital desc, c.player_id) end
    from public.capitals() c
    join public.players pl on pl.id = c.player_id;
  update public.seasons set finished = true where id = s.id;

  -- Достижения — до сброса, пока бизнесы и продажи на месте.
  for p in select id from public.players loop
    perform public.check_achievements(p.id);
  end loop;

  -- Новый сезон: все начинают заново с одинаковым капиталом.
  -- Все активные лоты снимаются (товар сгорает вместе со складами при сбросе).
  update public.market_lots set status = 'cancelled', closed_at = now() where status = 'active';
  delete from public.businesses;
  delete from public.player_effects;
  delete from public.capital_snapshots;
  update public.players set cash = public.start_capital();

  insert into public.seasons (starts_at, ends_at, theme)
  values (now(), greatest(s.ends_at + interval '7 days', now() + interval '7 days'),
          case when (s.id + 1) % 3 = 0 then 'crisis' else 'normal' end);
end;
$$;

-- Сброс аккаунта разработчика снимает и его лоты.
create or replace function public.dev_reset_me(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  update public.market_lots set status = 'cancelled', closed_at = now() where seller_id = a.id and status = 'active';
  delete from public.businesses where player_id = a.id;
  delete from public.player_effects where player_id = a.id;
  delete from public.player_decisions where player_id = a.id;
  delete from public.player_achievements where player_id = a.id;
  delete from public.player_days where player_id = a.id;
  delete from public.capital_snapshots where player_id = a.id;
  delete from public.season_results where player_id = a.id;
  update public.players
     set cash = public.start_capital(), company_name = null, company_icon = null, company_color = null,
         company_motto = '', company_created_at = null, name_changed_season = null, tutorial_step = 0,
         dev_cash_total = 0
   where id = a.id;
  perform public.dev_write_log(a, 'reset_me', jsonb_build_object('cash_before', a.cash));
  return 'Аккаунт сброшен до нового игрока';
end;
$$;

-- Панель: сделки рынка и помеченные сделки.
create or replace function public.dev_info(p_admin uuid) returns jsonb
language plpgsql set search_path = ''
as $$
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
    'log', coalesce((select jsonb_agg(jsonb_build_object(
              'action', l.action, 'details', l.details, 'amount', l.amount, 'at', l.created_at,
              'admin', coalesce(p.company_name, l.admin_tg::text)) order by l.created_at desc)
              from (select * from public.dev_log order by created_at desc limit 50) l
              left join public.players p on p.id = l.admin_id), '[]'::jsonb)
  );
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Обслуживание рынка каждые 5 минут.
select cron.schedule('market-maintenance', '*/5 * * * *', 'select public.market_maintenance()');
