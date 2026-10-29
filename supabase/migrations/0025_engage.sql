-- Чтобы хотелось возвращаться: бот зовёт по важным поводам, заказы города, лента новостей.
-- Всё обслуживает engage_tick() раз в 5 минут (pg_cron capital-engage).

insert into public.balance_config (key, value, description) values
  ('order.active',      2,    'Заказы города: сколько заказов открыто одновременно'),
  ('order.minutes',     180,  'Заказы города: сколько минут живёт заказ'),
  ('order.share',       0.5,  'Заказы города: размер заказа — доля от вместимости склада бизнеса 1-го уровня'),
  ('order.premium',     1.3,  'Заказы города: награда — цена товара (рынок или поставщик) × это число'),
  ('engage.away_min',   30,   'Бот: пишем «зайди», только если игрок не заходил столько минут'),
  ('engage.stock_hours', 8,   'Бот: «склад пуст» — не чаще раза в столько часов'),
  ('engage.overtaken_hours', 6, 'Бот: «тебя обогнали» — не чаще раза в столько часов'),
  ('engage.event_min',  35,   'Бот: предупреждаем о событии в районе за столько минут')
on conflict (key) do nothing;

-- ================= Лента новостей =================
create table public.city_news (
  id   bigserial primary key,
  at   timestamptz not null default now(),
  kind text not null,
  text text not null
);
create index city_news_at on public.city_news (at desc);
alter table public.city_news enable row level security;
revoke all on public.city_news from anon, authenticated;

create function public.company_label(p_player uuid) returns text
language sql stable set search_path = ''
as $$ select '«' || coalesce(nullif(company_name, ''), first_name, 'Игрок') || '»' from public.players where id = p_player $$;

create function public.biz_name(p_type text) returns text
language sql stable set search_path = ''
as $$ select coalesce((select name from public.business_types where type = p_type), p_type) $$;

-- Новые бизнесы и улучшения от 3-го уровня — в ленту (тестовые игроки не попадают).
create function public.news_on_business() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select is_test from public.players where id = new.player_id) then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.city_news (kind, text)
    values ('open', format('Новый бизнес: %s у %s', lower(public.biz_name(new.type)), public.company_label(new.player_id)));
  elsif new.level > old.level and new.level >= 3 then
    insert into public.city_news (kind, text)
    values ('upgrade', format('Улучшение: %s %s — ур. %s', lower(public.biz_name(new.type)),
                              public.company_label(new.player_id), new.level));
  end if;
  return new;
end;
$$;
create trigger news_business_insert after insert on public.businesses
  for each row execute function public.news_on_business();
create trigger news_business_level after update of level on public.businesses
  for each row execute function public.news_on_business();

create function public.news_view() returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'at', n.at, 'kind', n.kind, 'text', n.text) order by n.id desc), '[]'::jsonb)
    from (select * from public.city_news where at > now() - interval '48 hours' order by id desc limit 15) n
$$;

-- ================= Заказы города =================
create table public.city_orders (
  id        bigserial primary key,
  type      text not null,          -- со склада какого бизнеса
  title     text not null,
  qty       int not null,
  reward    bigint not null,
  starts_at timestamptz not null default now(),
  ends_at   timestamptz not null
);
create index city_orders_ends on public.city_orders (ends_at);
create table public.order_claims (
  order_id  bigint not null references public.city_orders(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  at        timestamptz not null default now(),
  primary key (order_id, player_id)
);
alter table public.city_orders enable row level security;
alter table public.order_claims enable row level security;
revoke all on public.city_orders, public.order_claims from anon, authenticated;

-- Цена единицы товара для награды: кофе и хлеб в магазине — по рынку, хлеб пекарни — по цене поставщика.
create function public.order_unit_value(p_type text) returns bigint
language sql stable set search_path = ''
as $$
  select case p_type
    when 'coffee' then (select market_price from public.markets where market = 'coffee')
    when 'shop' then (select market_price from public.markets where market = 'bread')
    else (select unit_cost from public.business_types where type = 'shop')
  end::bigint
$$;

-- Держим открытыми order.active заказов: новый — другого типа, чем уже открытые.
create function public.ensure_city_orders() returns void
language plpgsql set search_path = ''
as $$
declare
  v_type text;
  v_qty  int;
  v_cap  int;
begin
  perform pg_advisory_xact_lock(hashtext('city_orders'));
  while (select count(*) from public.city_orders where ends_at > now()) < public.cfg('order.active') loop
    select t into v_type
      from unnest(array['coffee', 'shop', 'bakery']) t
     where t not in (select type from public.city_orders where ends_at > now())
     order by random() limit 1;
    exit when v_type is null;
    select capacity into v_cap from public.business_types where type = v_type;
    v_qty := greatest(5, round(v_cap * public.cfg('order.share') / 5) * 5)::int;
    insert into public.city_orders (type, title, qty, reward, ends_at)
    values (v_type,
            (case v_type
               when 'coffee' then array['Кофе для офиса', 'Кофе на конференцию', 'Кофе для утренней смены']
               when 'shop' then array['Продукты для школы', 'Закупка для столовой', 'Продукты для больницы']
               else array['Хлеб для школы', 'Выпечка на праздник', 'Хлеб для столовой'] end)[1 + floor(random() * 3)::int],
            v_qty,
            round(v_qty * public.order_unit_value(v_type) * public.cfg('order.premium') / 100) * 100,
            now() + make_interval(mins => public.cfg('order.minutes')::int));
  end loop;
end;
$$;

create function public.orders_view(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'type', o.type, 'title', o.title, 'qty', o.qty, 'reward', o.reward, 'ends_at', o.ends_at,
           'done', exists (select 1 from public.order_claims c where c.order_id = o.id and c.player_id = p_player),
           'stock', (select b.stock from public.businesses b where b.player_id = p_player and b.type = o.type))
           order by o.ends_at), '[]'::jsonb)
    from public.city_orders o
   where o.ends_at > now()
$$;

-- Выполнить заказ: товар уходит со склада твоего бизнеса, награда — на счёт. Каждый заказ — один раз.
create function public.fulfill_order(p_player uuid, p_order bigint) returns text
language plpgsql set search_path = ''
as $$
declare
  o public.city_orders;
  b public.businesses;
begin
  perform 1 from public.players where id = p_player for update;
  select * into o from public.city_orders where id = p_order;
  if not found or o.ends_at <= now() then raise exception 'Заказ уже закрыт. Обнови экран.'; end if;
  if exists (select 1 from public.order_claims where order_id = o.id and player_id = p_player) then
    raise exception 'Этот заказ уже выполнен';
  end if;
  select * into b from public.businesses where player_id = p_player and type = o.type for update;
  if not found then raise exception 'Для этого заказа нужен бизнес: %', lower(public.biz_name(o.type)); end if;
  if b.listed then raise exception 'Бизнес выставлен на продажу — заказ выполнить нельзя'; end if;
  if b.stock < o.qty then
    raise exception 'На складе %, а нужно %. Пополни склад и возвращайся', b.stock, o.qty;
  end if;
  update public.businesses set stock = stock - o.qty where id = b.id;
  update public.players set cash = cash + o.reward where id = p_player;
  insert into public.order_claims (order_id, player_id) values (o.id, p_player);
  if not (select is_test from public.players where id = p_player) then
    insert into public.city_news (kind, text)
    values ('order', format('Заказ выполнен: «%s» — %s', o.title, public.company_label(p_player)));
  end if;
  return format('Заказ «%s» выполнен: +%s', o.title, public.fmt_rub(o.reward));
end;
$$;

-- ================= Бот зовёт обратно =================
create table public.player_places (
  player_id uuid primary key references public.players(id) on delete cascade,
  place     int not null,
  at        timestamptz not null default now()
);
alter table public.player_places enable row level security;
revoke all on public.player_places from anon, authenticated;

alter table public.city_events add column notified boolean not null default false;
alter table public.city_events add column announced boolean not null default false;

-- Можно ли сейчас написать игроку повод вида p_kind: давно не заходил и такого повода не было p_hours часов.
create function public.engage_ok(p_player uuid, p_kind text, p_hours numeric) returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from public.players p
                  where p.id = p_player and not p.is_test and p.notify_enabled
                    and coalesce(p.last_seen_at, 'epoch') < now() - make_interval(mins => public.cfg('engage.away_min')::int))
     and not exists (select 1 from public.notifications n
                      where n.player_id = p_player and n.kind = p_kind
                        and n.created_at > now() - make_interval(secs => (p_hours * 3600)::int))
$$;

create function public.engage_tick() returns void
language plpgsql set search_path = ''
as $$
declare
  r record;
  e public.city_events;
  v_dist text;
begin
  perform public.ensure_city_event();
  perform public.ensure_city_orders();

  -- Склад пуст: покупатели уходят к конкурентам.
  for r in
    select b.player_id, string_agg(public.biz_name(b.type), ', ' order by b.type) as names
      from public.businesses b
     where b.type in ('coffee', 'shop', 'bakery') and b.stock = 0 and b.price > 0 and not b.listed
       and b.created_at < now() - interval '1 hour'
     group by b.player_id
  loop
    if public.engage_ok(r.player_id, 'stock_empty', public.cfg('engage.stock_hours')) then
      insert into public.notifications (player_id, kind, text)
      values (r.player_id, 'stock_empty', format('Склад пуст: %s. Покупатели уходят к конкурентам — пополни склад.', r.names));
    end if;
  end loop;

  -- Рейтинг: кого обогнали, кто вошёл в тройку лучших.
  for r in
    with ranked as (
      select c.player_id, c.capital,
             row_number() over (order by c.capital desc, c.player_id) as place
        from public.capitals() c
    )
    select k.player_id, k.place, pp.place as old_place,
           (select a.player_id from ranked a where a.place = k.place - 1) as ahead,
           (select a.capital from ranked a where a.place = k.place - 1) - k.capital as gap
      from ranked k left join public.player_places pp on pp.player_id = k.player_id
  loop
    if r.old_place is not null and r.place > r.old_place and r.ahead is not null
       and public.engage_ok(r.player_id, 'overtaken', public.cfg('engage.overtaken_hours')) then
      insert into public.notifications (player_id, kind, text)
      values (r.player_id, 'overtaken',
              format('Тебя обогнали: теперь ты #%s в рейтинге. Впереди %s — до неё %s.',
                     r.place, public.company_label(r.ahead), public.fmt_rub(r.gap)));
    end if;
    if r.place <= 3 and r.old_place > 3 then
      insert into public.city_news (kind, text)
      values ('rank', format('Рейтинг: %s — теперь #%s', public.company_label(r.player_id), r.place));
    end if;
    insert into public.player_places (player_id, place, at) values (r.player_id, r.place, now())
    on conflict (player_id) do update set place = excluded.place, at = excluded.at;
  end loop;

  -- Событие скоро начнётся: предупреждаем тех, чей бизнес в районе выиграет от него.
  for e in select * from public.city_events
            where not notified and mult > 1 and starts_at > now()
              and starts_at <= now() + make_interval(mins => public.cfg('engage.event_min')::int)
  loop
    update public.city_events set notified = true where id = e.id;
    for r in
      select distinct b.player_id
        from public.businesses b join public.business_plots bp on bp.business_id = b.id
       where public.city_district(bp.bi, bp.bj) = e.district and b.type = any(e.types)
    loop
      if public.engage_ok(r.player_id, 'event_soon', 2) then
        insert into public.notifications (player_id, kind, text)
        values (r.player_id, 'event_soon',
                format('Скоро: %s. Покупателей у твоего бизнеса там станет больше — пополни склад заранее.', e.title));
      end if;
    end loop;
  end loop;

  -- Событие началось — в ленту.
  for e in select * from public.city_events where not announced and starts_at <= now() and ends_at > now() loop
    update public.city_events set announced = true where id = e.id;
    insert into public.city_news (kind, text)
    values ('event', format('В городе: %s (%s%s%% покупателей)', e.title,
                            case when e.mult < 1 then '−' else '+' end, round(abs(e.mult - 1) * 100)));
  end loop;

  delete from public.city_news where at < now() - interval '3 days';
  delete from public.city_orders where ends_at < now() - interval '2 days';
end;
$$;

select cron.schedule('capital-engage', '3-59/5 * * * *', 'select public.engage_tick()');

-- ================= Состояние: + заказы и новости =================
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.ensure_city_event();
  perform public.ensure_city_orders();
  v := public.get_state_base(p_player_id);
  return v || jsonb_build_object(
    'daily', public.daily_view(p_player_id),
    'events', public.city_events_view(),
    'rival', public.rival_view(p_player_id, (v ->> 'capital')::bigint),
    'orders', public.orders_view(p_player_id),
    'news', public.news_view()
  );
end;
$$;

-- ================= Разработчик =================
create function public.dev_new_order(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
  o public.city_orders;
begin
  update public.city_orders set ends_at = now() where id = (select id from public.city_orders where ends_at > now() order by ends_at limit 1);
  perform public.ensure_city_orders();
  select * into o from public.city_orders order by id desc limit 1;
  perform public.dev_write_log(a, 'new_order', jsonb_build_object('type', o.type, 'qty', o.qty));
  return format('Новый заказ: %s, %s шт.', o.title, o.qty);
end;
$$;

-- Разослать «зовущие» сообщения сейчас (как будто прошло 5 минут), не дожидаясь расписания.
create function public.dev_engage(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
  v_n int;
begin
  select count(*) into v_n from public.notifications;
  perform public.engage_tick();
  perform public.dev_write_log(a, 'engage', '{}'::jsonb);
  return format('Проверка поводов: новых уведомлений %s', (select count(*) from public.notifications) - v_n);
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
