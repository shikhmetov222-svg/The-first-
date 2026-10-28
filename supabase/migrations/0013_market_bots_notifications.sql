-- Рынок, этап 3: боты на рынке игроков, уведомления (в игре и от бота).
--
-- Боты не должны печатать деньги:
--   продают не дешевле цены оптовика  → «купил у бота, сдал оптовику» всегда в минус;
--   покупают не дороже 95% цены поставщика → «купил у поставщика, продал боту» всегда в минус.

alter table public.market_lots alter column seller_id drop not null;
alter table public.market_lots add column npc_id int references public.npc_sellers(id) on delete cascade;
alter table public.market_lots add constraint market_lots_owner check (seller_id is not null or npc_id is not null);
alter table public.market_trades add column npc_id int references public.npc_sellers(id) on delete set null;

-- ---------- Уведомления ----------
create table public.notifications (
  id         bigint generated always as identity primary key,
  player_id  uuid not null references public.players(id) on delete cascade,
  kind       text not null,
  text       text not null,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  bot_status text not null default 'pending' check (bot_status in ('pending', 'sent', 'failed', 'skipped')),
  bot_at     timestamptz
);
create index notifications_player on public.notifications (player_id, created_at desc);
create index notifications_pending on public.notifications (created_at) where bot_status = 'pending';

-- Секрет, которым база подписывает запрос на рассылку к серверной функции.
create table public.app_secrets (
  name  text primary key,
  value text not null
);
insert into public.app_secrets (name, value)
values ('dispatch_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));

alter table public.notifications enable row level security;
alter table public.app_secrets   enable row level security;
revoke all on public.notifications, public.app_secrets from anon, authenticated;

-- Каждая продажа на рынке → уведомление продавцу.
create function public.notify_trade() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_buyer text;
begin
  if new.seller_id is null or new.kind not in ('lot', 'business') then return new; end if;
  if new.kind = 'business' then
    insert into public.notifications (player_id, kind, text)
    values (new.seller_id, 'business_sold',
            format('Кто-то купил твою %s: +%s',
                   case new.product when 'coffee' then 'кофейню' when 'shop' then 'магазин' else 'пекарню' end,
                   public.fmt_rub(new.total - new.fee)));
  else
    insert into public.notifications (player_id, kind, text)
    values (new.seller_id, 'lot_sold',
            format('Твой лот %s продан: +%s (%s шт.)',
                   case new.product when 'coffee' then 'кофе' when 'bread' then 'хлеба' else 'муки' end,
                   public.fmt_rub(new.total - new.fee), new.qty));
  end if;
  return new;
end;
$$;

create trigger market_trades_notify after insert on public.market_trades
for each row execute function public.notify_trade();

create function public.notifications_read(p_player uuid) returns void
language sql set search_path = ''
as $$ update public.notifications set read_at = now() where player_id = p_player and read_at is null $$;

-- Пачка для рассылки ботом: одно сообщение на игрока, не больше 5 сообщений в сутки.
-- Строки сразу помечаются, чтобы два запуска подряд не отправили одно и то же дважды.
create function public.notifications_batch() returns jsonb
language plpgsql set search_path = ''
as $$
declare
  result jsonb;
begin
  -- Кому нельзя писать (выключил уведомления, тестовый игрок) — пропускаем.
  update public.notifications n
     set bot_status = 'skipped', bot_at = now()
    from public.players p
   where p.id = n.player_id and n.bot_status = 'pending'
     and (not p.notify_enabled or p.is_test or p.telegram_id <= 0);

  -- Лимит: не больше 5 сообщений бота в сутки на игрока (одно сообщение = одна пачка).
  with sent_today as (
    select player_id, count(distinct bot_at) as msgs
      from public.notifications
     where bot_status in ('sent', 'failed') and bot_at > now() - interval '24 hours'
     group by player_id
  ), picked as (
    select n.id from public.notifications n
      left join sent_today s on s.player_id = n.player_id
     where n.bot_status = 'pending' and coalesce(s.msgs, 0) < 5
       and n.created_at > now() - interval '24 hours'
     order by n.id
     for update of n skip locked
  ), marked as (
    update public.notifications n set bot_status = 'sent', bot_at = now()
      from picked where n.id = picked.id
    returning n.id, n.player_id, n.text
  )
  select coalesce(jsonb_agg(jsonb_build_object('telegram_id', p.telegram_id, 'ids', g.ids, 'texts', g.texts)), '[]'::jsonb)
    into result
    from (select player_id, jsonb_agg(id order by id) as ids, jsonb_agg(text order by id) as texts
            from marked group by player_id) g
    join public.players p on p.id = g.player_id;

  -- Старые неотправленные (больше суток) уже неактуальны.
  update public.notifications set bot_status = 'skipped', bot_at = now()
   where bot_status = 'pending' and created_at <= now() - interval '24 hours';
  return result;
end;
$$;

create function public.notifications_failed(p_ids bigint[]) returns void
language sql set search_path = ''
as $$ update public.notifications set bot_status = 'failed' where id = any(p_ids) $$;

create function public.dispatch_key() returns text
language sql stable set search_path = ''
as $$ select value from public.app_secrets where name = 'dispatch_key' $$;

-- ---------- Боты на рынке игроков ----------

-- Бот покупает часть лота игрока (деньги приходят «извне» — это спрос города).
create function public.npc_buy(p_npc int, p_lot bigint, p_qty int) returns void
language plpgsql set search_path = ''
as $$
declare
  l       public.market_lots;
  v_total bigint;
  v_fee   bigint;
begin
  select * into l from public.market_lots where id = p_lot for update;
  if not found or l.kind <> 'goods' or l.status <> 'active' or l.seller_id is null or l.qty_left < p_qty then return; end if;
  perform 1 from public.players where id = l.seller_id for update;

  v_total := p_qty::bigint * l.price;
  v_fee := ceil(v_total * 0.05)::bigint;
  update public.players set cash = cash + v_total - v_fee where id = l.seller_id;
  update public.market_lots
     set qty_left = qty_left - p_qty,
         status = case when qty_left - p_qty = 0 then 'sold' else 'active' end,
         closed_at = case when qty_left - p_qty = 0 then now() end
   where id = l.id;
  insert into public.market_trades (lot_id, kind, seller_id, npc_id, product, qty, price, total, fee)
  values (l.id, 'lot', l.seller_id, p_npc, l.product, p_qty, l.price, v_total, v_fee);
end;
$$;

-- Боты выставляют лоты и скупают выгодные. Активность падает с ростом числа живых игроков
-- (работают только активные боты — их число уже уменьшается при росте игроков — и с вероятностью,
-- которая уменьшается до 20% при 15+ игроках, заходивших за сутки).
create function public.npc_market_act() returns void
language plpgsql set search_path = ''
as $$
declare
  n        record;
  l        record;
  v_live   int;
  v_act    numeric;
  v_prod   text;
  v_price  bigint;
  v_cap    bigint;
  v_unit   bigint;
  v_qty    int;
begin
  select count(*) into v_live from public.players where not is_test and last_seen_at > now() - interval '24 hours';
  v_act := greatest(0.2, 1 - v_live / 15.0);

  for n in select * from public.npc_sellers where active loop
    v_prod := case when n.market = 'coffee' then 'coffee' when random() < 0.7 then 'bread' else 'flour' end;

    -- Выставить лот (у бота не больше одного активного).
    if random() < 0.35 * v_act
       and not exists (select 1 from public.market_lots where npc_id = n.id and status = 'active') then
      v_price := round(public.goods_price(v_prod)
                       * case n.kind when 'dumper' then 0.8 when 'careful' then 0.95 else 1.15 end
                       * (0.97 + random() * 0.06) / 100) * 100;
      v_price := greatest(v_price, public.wholesale_price(v_prod) + 100);
      v_qty := 20 + floor(random() * 60)::int;
      insert into public.market_lots (npc_id, product, qty_total, qty_left, price)
      values (n.id, v_prod, v_qty, v_qty, v_price);
    end if;

    -- Купить самый дешёвый лот игрока, если он выгоден боту.
    if random() < 0.35 * v_act then
      select unit_cost into v_unit from public.business_types
       where type = case v_prod when 'coffee' then 'coffee' when 'bread' then 'shop' else 'bakery' end;
      v_cap := least(floor(public.goods_price(v_prod) * 0.9), floor(v_unit * 0.95));
      select ml.id, ml.qty_left into l
        from public.market_lots ml join public.players p on p.id = ml.seller_id
       where ml.kind = 'goods' and ml.status = 'active' and ml.product = v_prod and ml.price <= v_cap
         and not p.is_test and ml.expires_at > now()
       order by ml.price limit 1;
      if found then
        perform public.npc_buy(n.id, l.id, least(l.qty_left, 5 + floor(random() * 25)::int));
      end if;
    end if;
  end loop;
end;
$$;


-- Покупка товарного лота: теперь и у ботов.
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

  -- Лот бота: товар «из города», деньги уходят из игры; защита от перекачки не нужна.
  if l.npc_id is not null then
    select * into b from public.players where id = p_buyer for update;
    if b.is_test then raise exception 'Лот уже недоступен'; end if;
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

    update public.players set cash = cash - v_total where id = b.id;
    update public.businesses
       set stock = case when l.product = 'flour' then stock else stock + p_qty end,
           raw_stock = case when l.product = 'flour' then raw_stock + p_qty else raw_stock end
     where player_id = p_buyer and type = v_dest;
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

-- Истечение: лоты ботов просто закрываются.
create or replace function public.expire_lots() returns void
language plpgsql set search_path = ''
as $$
declare
  l record;
begin
  for l in select * from public.market_lots where status = 'active' and expires_at <= now() for update skip locked loop
    if l.npc_id is not null then
      -- Лот бота просто закрывается.
      update public.market_lots set status = 'expired', closed_at = now() where id = l.id;
      continue;
    end if;
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

-- Вкладка «Рынок»: лоты ботов.
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
               'seller', case when l.npc_id is not null then
                           jsonb_build_object('id', 'npc-' || n.id, 'name', n.name, 'icon', null, 'color', null,
                                              'dev', false, 'test', false, 'bot', true, 'kind', n.kind)
                         else
                           jsonb_build_object('id', p.id, 'name', coalesce(p.company_name, p.first_name),
                                              'icon', p.company_icon, 'color', p.company_color,
                                              'dev', p.is_admin and p.show_dev_badge, 'test', p.is_test, 'bot', false)
                         end)
             order by l.product, l.price, l.created_at)
        from public.market_lots l
        left join public.players p on p.id = l.seller_id
        left join public.npc_sellers n on n.id = l.npc_id
        cross join me
       where l.kind = 'goods' and l.status = 'active' and l.expires_at > now()
         and l.seller_id is distinct from me.id
         and (l.npc_id is not null or not p.is_test or me.is_admin)), '[]'::jsonb),
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
                               when t.npc_id is not null then (select n2.name from public.npc_sellers n2 where n2.id = t.npc_id)
                               else (select coalesce(o.company_name, o.first_name) from public.players o
                                      where o.id = case when t.seller_id = p_player then t.buyer_id else t.seller_id end) end) x
          from public.market_trades t
         where t.seller_id = p_player or t.buyer_id = p_player
         order by t.created_at desc limit 30) s), '[]'::jsonb)
  )
$$;

-- Состояние экрана: уведомления.
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

-- Обслуживание рынка: боты и очистка старых уведомлений.
create or replace function public.market_maintenance() returns void
language plpgsql set search_path = ''
as $$
begin
  perform public.expire_lots();
  insert into public.goods_price_history (product, price)
  select g, public.goods_price(g) from unnest(array['coffee', 'bread', 'flour']) g
  on conflict do nothing;
  delete from public.goods_price_history where at < now() - interval '3 days';
  perform public.test_players_act();
  perform public.npc_market_act();
  delete from public.notifications where created_at < now() - interval '7 days';
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- Рассылка уведомлений ботом: каждые 5 минут база вызывает серверную функцию со своим секретным ключом.
create extension if not exists pg_net;
select cron.schedule('notify-dispatch', '2-59/5 * * * *', $cron$
  select net.http_post(
    url := 'https://kadaesapsptfabygjkow.supabase.co/functions/v1/api',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-key', public.dispatch_key()),
    body := '{"action":"dispatch"}'::jsonb
  )
$cron$);
