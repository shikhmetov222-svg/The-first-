-- Ежедневные задания, события в городе, соперник рядом в рейтинге.
-- get_state теперь — обёртка: основное состояние собирает get_state_base, обёртка добавляет daily, events, rival.

-- ================= Числа баланса =================
insert into public.balance_config (key, value, description) values
  ('daily.reward',      100000, 'Задание дня: награда за одно задание, коп.'),
  ('daily.bonus',       200000, 'Задание дня: награда сверху за все три задания, коп.'),
  ('daily.share',       0.6,    'Задание дня: цель «продай/заработай» — эта доля от среднего за прошлые 2 дня'),
  ('event.minutes',     120,    'Событие в городе: длительность, минут'),
  ('event.gap_min',     30,     'Событие в городе: перерыв до следующего, от (минут)'),
  ('event.gap_max',     90,     'Событие в городе: перерыв до следующего, до (минут)'),
  ('event.boost',       1.4,    'Событие в городе: множитель покупателей у бизнесов района'),
  ('event.roadworks',   0.85,   'Ремонт дороги: множитель покупателей у бизнесов района')
on conflict (key) do nothing;

-- ================= Задания дня =================
create table public.daily_tasks (
  player_id  uuid not null references public.players(id) on delete cascade,
  day        date not null,
  code       text not null,
  target     bigint not null,
  claimed_at timestamptz,
  primary key (player_id, day, code)
);
alter table public.daily_tasks enable row level security;
revoke all on public.daily_tasks from anon, authenticated;

-- Начало сегодняшнего дня по Москве.
create function public.moscow_day_start() returns timestamptz
language sql stable set search_path = ''
as $$ select (public.moscow_today()::timestamp at time zone 'Europe/Moscow') $$;

-- Прогресс задания за сегодня — по тем же журналам, что и достижения.
create function public.daily_progress(p_player uuid, p_code text) returns bigint
language sql stable set search_path = ''
as $$
  select case p_code
    when 'sell' then (select coalesce(sum(sold), 0) from public.sales_log
                       where player_id = p_player and tick_at >= public.moscow_day_start())
    when 'revenue' then (select coalesce(sum(revenue), 0) from public.sales_log
                          where player_id = p_player and tick_at >= public.moscow_day_start())
    when 'market_buy' then (select count(*) from public.market_trades
                             where buyer_id = p_player and kind in ('lot', 'business')
                               and created_at >= public.moscow_day_start())
    when 'market_sell' then (select count(*) from public.market_trades
                              where seller_id = p_player and kind in ('lot', 'wholesale', 'business')
                                and created_at >= public.moscow_day_start())
    when 'build' then (select count(*) from public.constructions
                        where player_id = p_player and started_at >= public.moscow_day_start())
    when 'decision' then (select count(*) from public.player_decisions
                           where player_id = p_player and day = public.moscow_today() and choice is not null)
    else 0
  end::bigint
$$;

-- Три задания на сегодня: одно «продай» или «заработай», два из остальных. Выбор и цели — один раз за день.
create function public.daily_assign(p_player uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  v_day   date := public.moscow_today();
  v_seed  int;
  v_main  text;
  v_rest  text[];
  v_sold  bigint;
  v_rev   bigint;
  v_has   boolean;
begin
  if exists (select 1 from public.daily_tasks where player_id = p_player and day = v_day) then return; end if;
  v_seed := abs(hashtext(p_player::text || v_day::text));
  v_has := exists (select 1 from public.businesses where player_id = p_player);
  -- Средние продажи за два прошлых дня — от них цель, чтобы задание было по силам и новичку, и богачу.
  select coalesce(sum(sold), 0) / 2, coalesce(sum(revenue), 0) / 2 into v_sold, v_rev
    from public.sales_log
   where player_id = p_player and tick_at >= public.moscow_day_start() - interval '2 days'
     and tick_at < public.moscow_day_start();

  v_rest := array['market_buy', 'market_sell', 'build', 'decision'];
  if v_has then
    v_main := case when v_seed % 2 = 0 then 'sell' else 'revenue' end;
    insert into public.daily_tasks (player_id, day, code, target) values
      (p_player, v_day, v_main,
       case v_main
         when 'sell' then greatest(30, round(v_sold * public.cfg('daily.share') / 10) * 10)
         else greatest(300000, round(v_rev * public.cfg('daily.share') / 100000) * 100000)
       end);
  else
    -- Без бизнесов продавать нечего — первое задание: начать стройку.
    insert into public.daily_tasks (player_id, day, code, target) values (p_player, v_day, 'build', 1);
    v_rest := array['market_buy', 'decision', 'market_sell'];
  end if;
  insert into public.daily_tasks (player_id, day, code, target)
  select p_player, v_day, c, 1
    from unnest(v_rest) with ordinality as r(c, n)
   order by abs(hashtext(v_seed::text || c))
   limit 2
  on conflict do nothing;
end;
$$;

create function public.daily_view(p_player uuid) returns jsonb
language plpgsql set search_path = ''
as $$
begin
  perform public.daily_assign(p_player);
  return jsonb_build_object(
    'reward', public.cfg('daily.reward')::bigint,
    'bonus', public.cfg('daily.bonus')::bigint,
    'items', (select jsonb_agg(jsonb_build_object(
                'code', t.code, 'target', t.target,
                'progress', least(t.target, public.daily_progress(p_player, t.code)),
                'claimed', t.claimed_at is not null) order by (t.code in ('sell', 'revenue')) desc, t.code)
                from public.daily_tasks t where t.player_id = p_player and t.day = public.moscow_today())
  );
end;
$$;

-- Забрать награду за задание. За третье — ещё и награда за все три.
create function public.claim_daily(p_player uuid, p_code text) returns text
language plpgsql set search_path = ''
as $$
declare
  t       public.daily_tasks;
  v_sum   bigint := public.cfg('daily.reward')::bigint;
  v_left  int;
begin
  perform 1 from public.players where id = p_player for update;
  select * into t from public.daily_tasks
   where player_id = p_player and day = public.moscow_today() and code = p_code for update;
  if not found then raise exception 'Такого задания сегодня нет. Обнови экран.'; end if;
  if t.claimed_at is not null then raise exception 'Награда за это задание уже получена'; end if;
  if public.daily_progress(p_player, p_code) < t.target then
    raise exception 'Задание ещё не выполнено';
  end if;
  update public.daily_tasks set claimed_at = now()
   where player_id = p_player and day = t.day and code = p_code;
  select count(*) into v_left from public.daily_tasks
   where player_id = p_player and day = t.day and claimed_at is null;
  if v_left = 0 then v_sum := v_sum + public.cfg('daily.bonus')::bigint; end if;
  update public.players set cash = cash + v_sum where id = p_player;
  return case when v_left = 0
    then format('Все задания дня выполнены: +%s', public.fmt_rub(v_sum))
    else format('Задание выполнено: +%s', public.fmt_rub(v_sum)) end;
end;
$$;

-- ================= События в городе =================
create table public.city_events (
  id        bigserial primary key,
  kind      text not null,
  district  text not null,
  types     text[],            -- для каких бизнесов района; null — для всех
  mult      numeric not null,
  title     text not null,
  body      text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null
);
create index city_events_ends on public.city_events (ends_at);
alter table public.city_events enable row level security;
revoke all on public.city_events from anon, authenticated;

-- Множитель покупателей от событий: бизнес этого типа в этом районе.
create function public.event_mult(p_district text, p_type text) returns numeric
language sql stable set search_path = ''
as $$
  select coalesce(exp(sum(ln(e.mult))), 1)
    from public.city_events e
   where e.district = p_district and now() >= e.starts_at and now() < e.ends_at
     and (e.types is null or p_type = any(e.types))
$$;

-- Участок на карте: чужой район — меньше покупателей; событие в районе — больше (или меньше).
create or replace function public.plot_mult(p_business uuid) returns numeric
language sql stable set search_path = ''
as $$
  select coalesce((select case when bp.off_best then public.cfg('city.other_district_mult') else 1 end
                          * public.event_mult(public.city_district(bp.bi, bp.bj), b.type)
                     from public.business_plots bp
                     join public.businesses b on b.id = bp.business_id
                    where bp.business_id = p_business), 1)
$$;

-- Следующее событие: если впереди ничего нет — назначаем новое после перерыва (или сразу, p_now).
create function public.ensure_city_event(p_now boolean default false) returns void
language plpgsql set search_path = ''
as $$
declare
  v_start timestamptz;
  v_k     int;
  v_dist  text;
begin
  if not p_now and exists (select 1 from public.city_events where ends_at > now()) then return; end if;
  perform pg_advisory_xact_lock(hashtext('city_events'));
  if not p_now and exists (select 1 from public.city_events where ends_at > now()) then return; end if;
  v_start := case when p_now then now()
    else greatest(now(), coalesce((select max(ends_at) from public.city_events), now()))
         + make_interval(mins => (public.cfg('event.gap_min')
                                  + floor(random() * (public.cfg('event.gap_max') - public.cfg('event.gap_min'))))::int)
  end;
  v_k := floor(random() * 7)::int;
  if v_k = 6 then
    v_dist := (array['center', 'sleep', 'private', 'newres'])[1 + floor(random() * 4)::int];
    insert into public.city_events (kind, district, types, mult, title, body, starts_at, ends_at)
    values ('roadworks', v_dist, null, public.cfg('event.roadworks'),
            'Ремонт дороги: ' || (case v_dist when 'center' then 'Старый город' when 'sleep' then 'Спальный район'
                                   when 'private' then 'Частный сектор' else 'Новый район' end),
            'Проезд перекрыт — у бизнесов района покупателей чуть меньше.',
            v_start, v_start + make_interval(mins => public.cfg('event.minutes')::int));
    return;
  end if;
  insert into public.city_events (kind, district, types, mult, title, body, starts_at, ends_at)
  select x.kind, x.district, x.types, public.cfg('event.boost'), x.title, x.body,
         v_start, v_start + make_interval(mins => public.cfg('event.minutes')::int)
    from (values
      (0, 'festival', 'center', array['coffee', 'bakery'], 'Фестиваль в Старом городе',
          'Туристов больше: у кофеен и пекарен района больше покупателей.'),
      (1, 'fair', 'sleep', array['shop', 'bakery'], 'Ярмарка в Спальном районе',
          'Жители закупаются: у магазинов и пекарен района больше покупателей.'),
      (2, 'conference', 'business', array['coffee', 'agency'], 'Конференция в Деловом квартале',
          'Офисы гудят: у кофеен и рекламных агентств района больше покупателей.'),
      (3, 'sale', 'newres', array['pvz', 'marketplace'], 'Распродажа в интернете',
          'Новый район заказывает посылки: у ПВЗ и маркетплейсов района больше покупателей.'),
      (4, 'holiday', 'private', array['bakery', 'shop'], 'Праздник в Частном секторе',
          'Семьи готовятся к празднику: у пекарен и магазинов района больше покупателей.'),
      (5, 'warehouse', 'industry', array['marketplace', 'repair'], 'Стройка в Промзоне',
          'Рядом строят склады: у маркетплейсов и бригад района больше заказов.')
    ) as x(n, kind, district, types, title, body)
   where x.n = v_k;
end;
$$;

-- Текущее и следующее событие — для экрана.
create function public.city_events_view() returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'kind', e.kind, 'district', e.district, 'types', e.types, 'mult', e.mult,
           'title', e.title, 'body', e.body, 'starts_at', e.starts_at, 'ends_at', e.ends_at)
           order by e.starts_at), '[]'::jsonb)
    from (select * from public.city_events where ends_at > now() order by starts_at limit 2) e
$$;

-- ================= Соперник рядом =================
-- Ближайший игрок выше в твоей лиге (тестовые не считаются); если ты первый — сколько до следующей лиги.
create function public.rival_view(p_player uuid, p_cap bigint) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ahead', (select jsonb_build_object('name', coalesce(p.company_name, p.first_name), 'gap', c.capital - p_cap)
                from public.capitals() c join public.players p on p.id = c.player_id
               where not p.is_test and p.id <> p_player and c.capital > p_cap
                 and public.league_of(c.capital) = public.league_of(p_cap)
               order by c.capital, p.id limit 1),
    'next_league', (select jsonb_build_object('name', public.league_of(t), 'gap', t - p_cap)
                      from unnest(array[15000000, 30000000, 100000000]::bigint[]) t
                     where t > p_cap order by t limit 1)
  )
$$;

-- ================= Состояние =================
alter function public.get_state(uuid) rename to get_state_base;

create function public.get_state(p_player_id uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.ensure_city_event();
  v := public.get_state_base(p_player_id);
  return v || jsonb_build_object(
    'daily', public.daily_view(p_player_id),
    'events', public.city_events_view(),
    'rival', public.rival_view(p_player_id, (v ->> 'capital')::bigint)
  );
end;
$$;

-- ================= Разработчик =================
-- Событие прямо сейчас (текущие заканчиваются).
create function public.dev_new_event(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
  e public.city_events;
begin
  update public.city_events set ends_at = now() where ends_at > now();
  perform public.ensure_city_event(true);
  select * into e from public.city_events order by id desc limit 1;
  perform public.dev_write_log(a, 'new_event', jsonb_build_object('kind', e.kind, 'district', e.district));
  return 'Событие: ' || e.title;
end;
$$;

-- Новые задания дня у администратора.
create function public.dev_daily_reset(p_admin uuid) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  delete from public.daily_tasks where player_id = a.id and day = public.moscow_today();
  perform public.daily_assign(a.id);
  perform public.dev_write_log(a, 'daily_reset', '{}'::jsonb);
  return 'Задания дня обновлены';
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
