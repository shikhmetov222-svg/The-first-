-- Режим разработчика.
-- Кто администратор, решает сервер по секрету ADMIN_TELEGRAM_IDS и подписи Telegram;
-- в базе флаг is_admin лишь отражает это (обновляется при каждом входе) и перепроверяется в каждой dev-функции.
-- Каждое действие разработчика — одна функция = одна транзакция с блокировкой строк + запись в журнал.

alter table public.players
  add column is_admin       boolean not null default false,
  add column is_test        boolean not null default false,  -- тестовый бот-аккаунт разработчика
  add column show_dev_badge boolean not null default true,
  add column dev_cash_total bigint  not null default 0;      -- сколько денег выдано из панели (для разбора экономики)

alter table public.businesses add column dev_granted boolean not null default false; -- открыт из панели бесплатно

-- Сколько ботов держать на рынке вручную (null — автоматически по числу игроков).
alter table public.markets add column bot_override int check (bot_override between 0 and 3);

-- Место для призов: администратор его не получает, приз уходит следующему.
alter table public.season_results add column prize_place int;

create table public.dev_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.players(id) on delete set null,
  admin_tg   bigint,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  amount     bigint,             -- сумма денег, если действие с деньгами (копейки)
  created_at timestamptz not null default now()
);
create index dev_log_created on public.dev_log (created_at desc);

alter table public.dev_log enable row level security;
revoke all on public.dev_log from anon, authenticated;

-- Флаг администратора выставляет сервер при входе по секрету ADMIN_TELEGRAM_IDS.
create function public.set_admin_flag(p_player_id uuid, p_is_admin boolean) returns void
language sql set search_path = ''
as $$ update public.players set is_admin = p_is_admin where id = p_player_id and is_admin is distinct from p_is_admin $$;

-- Проверка внутри каждой dev-функции: блокирует строку администратора и отказывает, если он не админ.
create function public.dev_lock_admin(p_admin uuid) returns public.players
language plpgsql set search_path = ''
as $$
declare
  p public.players;
begin
  select * into p from public.players where id = p_admin for update;
  if not found or not p.is_admin or p.is_test then
    raise exception 'Нет доступа';
  end if;
  return p;
end;
$$;

create function public.dev_write_log(p_admin public.players, p_action text, p_details jsonb, p_amount bigint default null)
returns void
language sql set search_path = ''
as $$
  insert into public.dev_log (admin_id, admin_tg, action, details, amount)
  values (p_admin.id, p_admin.telegram_id, p_action, coalesce(p_details, '{}'::jsonb), p_amount)
$$;

-- Капитал и рейтинги — без тестовых игроков разработчика.
create or replace function public.capitals()
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
   where not p.is_test
   group by p.id
$$;

-- Рейтинг: значок DEV у администратора (если не выключен).
create or replace function public.leaderboard(p_player_id uuid, p_kind text) returns jsonb
language sql stable set search_path = ''
as $$
  with c as (
    select c.player_id, c.capital,
           coalesce(p.company_name, c.first_name) as name,
           p.company_icon as icon, p.company_color as color,
           (p.is_admin and p.show_dev_badge) as dev,
           coalesce((select s.capital from public.capital_snapshots s
                      where s.player_id = c.player_id and s.taken_at <= now() - interval '24 hours'
                      order by s.taken_at desc limit 1), public.start_capital()) as base
      from public.capitals() c
      join public.players p on p.id = c.player_id
  ), ranked as (
    select player_id, name, icon, color, dev, capital,
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
              'id', player_id, 'place', place, 'name', name, 'icon', icon, 'color', color, 'dev', dev,
              'capital', capital, 'growth', growth, 'me', player_id = p_player_id) order by place)
            from ranked where place <= 50), '[]'::jsonb),
    'me', (select jsonb_build_object('id', player_id, 'place', place, 'name', name, 'icon', icon, 'color', color, 'dev', dev,
                                     'capital', capital, 'growth', growth)
             from ranked where player_id = p_player_id)
  )
$$;

create or replace function public.public_profile(p_player_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', p.company_name, 'icon', p.company_icon,
                                  'color', p.company_color, 'motto', p.company_motto),
    'dev', p.is_admin and p.show_dev_badge,
    'league', public.league_of(c.capital),
    'title', public.title_of(p.id),
    'capital', c.capital,
    'place', (public.leaderboard(p.id, 'capital') -> 'me' ->> 'place')::int,
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'earned_at', a.earned_at)
                                               order by a.earned_at)
                                from public.player_achievements a where a.player_id = p.id), '[]'::jsonb)
  )
  from public.players p
  join public.capitals() c on c.player_id = p.id
  where p.id = p_player_id
$$;

-- Тик: тестовые игроки не забирают NPC-покупателей у настоящих; ручное число ботов.
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
     where t.market = m.market and b.stock > 0 and b.price > 0 and not pl.is_test;

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

-- Итоги сезона: призовые места без администраторов.
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
  delete from public.businesses;
  delete from public.player_effects;
  delete from public.capital_snapshots;
  update public.players set cash = public.start_capital();

  insert into public.seasons (starts_at, ends_at, theme)
  values (now(), greatest(s.ends_at + interval '7 days', now() + interval '7 days'),
          case when (s.id + 1) % 3 = 0 then 'crisis' else 'normal' end);
end;
$$;
-- ================= Действия разработчика =================

-- Деньги: p_mode = 'add' (добавить, можно отрицательное) или 'set' (установить точную сумму).
create function public.dev_cash(p_admin uuid, p_mode text, p_amount bigint) returns text
language plpgsql set search_path = ''
as $$
declare
  a      public.players := public.dev_lock_admin(p_admin);
  v_new  bigint;
  v_diff bigint;
begin
  if p_amount is null or abs(p_amount) > 100000000000000 then raise exception 'Слишком большая сумма'; end if;
  if p_mode = 'add' then v_new := greatest(0, a.cash + p_amount);
  elsif p_mode = 'set' then v_new := greatest(0, p_amount);
  else raise exception 'Неизвестный режим'; end if;

  v_diff := v_new - a.cash;
  update public.players set cash = v_new, dev_cash_total = dev_cash_total + v_diff where id = a.id;
  perform public.dev_write_log(a, 'cash_' || p_mode, jsonb_build_object('before', a.cash, 'after', v_new), v_diff);
  return format('Деньги: %s', public.fmt_rub(v_new));
end;
$$;

-- Склады: 'fill' — заполнить всё, 'clear' — очистить всё, 'add' — добавить p_qty товара p_product.
-- Товары: coffee (кофейня), bread (магазин), flour (мука пекарни), baked (готовый хлеб пекарни).
create function public.dev_stock(p_admin uuid, p_mode text, p_product text, p_qty int) returns text
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
     where t.type = b.type and b.player_id = a.id;
    perform public.dev_write_log(a, 'stock_fill', '{}'::jsonb);
    return 'Все склады заполнены';
  elsif p_mode = 'clear' then
    update public.businesses set stock = 0, raw_stock = 0 where player_id = a.id;
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

-- Открыть бизнес бесплатно (помечается как выданный из панели).
create function public.dev_open_business(p_admin uuid, p_type text) returns text
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
  return format('%s открыт бесплатно', t.name);
end;
$$;

-- Тики рынка: 1 — «сейчас», до 100 — «промотать». Влияет на всех игроков.
create function public.dev_ticks(p_admin uuid, p_n int) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  if p_n is null or p_n < 1 or p_n > 100 then raise exception 'От 1 до 100 тиков'; end if;
  for i in 1..p_n loop
    perform public.tick();
  end loop;
  perform public.snapshot_capitals();
  perform public.dev_write_log(a, 'ticks', jsonb_build_object('n', p_n));
  return format('Прошло тиков: %s', p_n);
end;
$$;

-- Новое решение дня прямо сейчас (старое решение сегодняшнего дня удаляется).
create function public.dev_new_decision(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  delete from public.player_decisions where player_id = a.id and day = public.moscow_today();
  perform public.today_decision(a.id);
  perform public.dev_write_log(a, 'new_decision', '{}'::jsonb);
  return 'Новое решение дня готово';
end;
$$;

-- Тестовые игроки: 'create' (до 5) или 'delete_all'.
-- Это серверные бот-аккаунты: не видны в рейтингах и не торгуют с NPC-покупателями.
create function public.dev_test_players(p_admin uuid, p_mode text) returns text
language plpgsql set search_path = ''
as $$
declare
  a     public.players := public.dev_lock_admin(p_admin);
  v_n   int;
  v_id  uuid;
  v_tg  bigint;
  icons text[] := array['rocket','factory','anchor','flame','zap'];
  colors text[] := array['sky','emerald','violet','coral','rose'];
begin
  if p_mode = 'delete_all' then
    select count(*) into v_n from public.players where is_test;
    delete from public.players where is_test;
    perform public.dev_write_log(a, 'test_players_delete', jsonb_build_object('count', v_n));
    return format('Удалено тестовых игроков: %s', v_n);
  elsif p_mode <> 'create' then
    raise exception 'Неизвестный режим';
  end if;

  -- Блокируем всех тестовых, чтобы два нажатия подряд не создали шестого.
  perform 1 from public.players where is_test for update;
  select count(*) into v_n from public.players where is_test;
  if v_n >= 5 then raise exception 'Не больше 5 тестовых игроков'; end if;

  select coalesce(min(telegram_id), -1000) - 1 into v_tg from public.players where telegram_id <= -1000;
  insert into public.players (telegram_id, first_name, is_test, cash, company_name, company_icon, company_color,
                              company_motto, company_created_at, tutorial_step)
  values (v_tg, 'Тестовый игрок', true, public.start_capital(),
          'Тест ' || (-v_tg - 1000)::text, icons[v_n + 1], colors[v_n + 1], 'Создан разработчиком', now(), 3)
  returning id into v_id;

  insert into public.businesses (player_id, type, price, stock, raw_stock, dev_granted)
  select v_id, t.type, t.ref_price, t.capacity / 2, t.raw_capacity / 2, true from public.business_types t;

  perform public.dev_write_log(a, 'test_player_create', jsonb_build_object('player_id', v_id, 'telegram_id', v_tg),
                               public.start_capital());
  return format('Создан тестовый игрок «Тест %s»', -v_tg - 1000);
end;
$$;

-- Число ботов на рынке: p_count от 0 до 3 или null — автоматически.
create function public.dev_bots(p_admin uuid, p_market text, p_count int) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  update public.markets set bot_override = p_count where market = p_market;
  if not found then raise exception 'Нет такого рынка'; end if;
  perform public.dev_write_log(a, 'bots', jsonb_build_object('market', p_market, 'count', p_count));
  return case when p_count is null then 'Боты: автоматически' else format('Ботов на рынке: %s', p_count) end;
end;
$$;

-- Привязать тестового игрока как приглашённого мной (для проверки наград за друзей).
create function public.dev_befriend(p_admin uuid, p_test uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  update public.players set referred_by = a.id where id = p_test and is_test;
  if not found then raise exception 'Это не тестовый игрок'; end if;
  perform public.dev_write_log(a, 'befriend', jsonb_build_object('test_player', p_test));
  return 'Тестовый игрок засчитан как твой приглашённый друг';
end;
$$;

-- Значок DEV в рейтинге и на рынке.
create function public.dev_badge(p_admin uuid, p_show boolean) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  update public.players set show_dev_badge = coalesce(p_show, true) where id = a.id;
  perform public.dev_write_log(a, 'badge', jsonb_build_object('show', p_show));
  return case when p_show then 'Значок DEV показывается' else 'Значок DEV скрыт' end;
end;
$$;

-- Сбросить мой аккаунт до состояния нового игрока (компания тоже — придётся создать заново).
create function public.dev_reset_me(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
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

-- Данные для панели: сезон, рынки, тестовые игроки, журнал.
create function public.dev_info(p_admin uuid) returns jsonb
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
