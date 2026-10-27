-- Профиль: достижения, история сезонов, лиги и титулы, приглашения друзей, настройки.

alter table public.players
  add column ref_code        text not null default substr(md5(gen_random_uuid()::text), 1, 8),
  add column referred_by     uuid references public.players(id) on delete set null,
  add column notify_enabled  boolean not null default true,
  add column haptics_enabled boolean not null default true;
create unique index players_ref_code_unique on public.players (ref_code);

-- Тема сезона. «Кризис» — каждый третий сезон.
alter table public.seasons add column theme text not null default 'normal'
  check (theme in ('normal', 'crisis'));

-- Дни, когда игрок заходил (для «7 дней подряд»).
create table public.player_days (
  player_id uuid not null references public.players(id) on delete cascade,
  day       date not null,
  primary key (player_id, day)
);

create table public.player_achievements (
  player_id uuid not null references public.players(id) on delete cascade,
  code      text not null,
  earned_at timestamptz not null default now(),
  primary key (player_id, code)
);

alter table public.player_days         enable row level security;
alter table public.player_achievements enable row level security;
revoke all on public.player_days, public.player_achievements from anon, authenticated;

-- Сколько дней подряд (включая сегодня) игрок заходил в игру.
create function public.visit_streak(p_player_id uuid) returns int
language sql stable set search_path = ''
as $$
  with recursive s(day) as (
    select public.moscow_today()
     where exists (select 1 from public.player_days where player_id = p_player_id and day = public.moscow_today())
    union all
    select s.day - 1 from s
     where exists (select 1 from public.player_days where player_id = p_player_id and day = s.day - 1)
  )
  select count(*)::int from s
$$;

-- Выдаёт все заслуженные достижения (повторно не выдаёт).
create function public.check_achievements(p_player_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_businesses int;
  v_capital    bigint;
  earned       text[] := '{}';
begin
  select count(*) into v_businesses from public.businesses where player_id = p_player_id;
  select capital into v_capital from public.capitals() where player_id = p_player_id;

  if v_businesses >= 1 then earned := array_append(earned, 'first_business'); end if;
  if v_businesses >= 3 then earned := array_append(earned, 'all_businesses'); end if;
  if v_capital >= 50000000 then earned := array_append(earned, 'capital_500k'); end if;
  -- Места и «Кризис» засчитываются только тем, кто реально играл в сезоне (капитал менялся).
  if exists (select 1 from public.season_results where player_id = p_player_id and place <= 10
                and capital <> public.start_capital()) then
    earned := array_append(earned, 'top10');
  end if;
  if exists (select 1 from public.season_results where player_id = p_player_id and place <= 3
                and capital <> public.start_capital()) then
    earned := array_append(earned, 'top3');
  end if;
  if public.visit_streak(p_player_id) >= 7 then earned := array_append(earned, 'streak7'); end if;
  if (select count(*) from public.player_decisions where player_id = p_player_id and choice is not null) >= 10 then
    earned := array_append(earned, 'decisions10');
  end if;
  if (select coalesce(sum(sold), 0) from public.sales_log where player_id = p_player_id) >= 1000 then
    earned := array_append(earned, 'sold1000');
  end if;
  if exists (select 1 from public.players where referred_by = p_player_id) then
    earned := array_append(earned, 'invite');
  end if;
  if exists (select 1 from public.season_results r join public.seasons s on s.id = r.season_id
              where r.player_id = p_player_id and s.theme = 'crisis'
                and r.capital <> public.start_capital() and r.capital >= public.start_capital() / 2) then
    earned := array_append(earned, 'crisis');
  end if;

  insert into public.player_achievements (player_id, code)
  select p_player_id, unnest(earned)
  on conflict do nothing;
end;
$$;

-- Лига — по текущему капиталу.
create function public.league_of(p_capital bigint) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_capital >= 100000000 then 'Бриллиантовая лига'
    when p_capital >=  30000000 then 'Золотая лига'
    when p_capital >=  15000000 then 'Серебряная лига'
    else 'Бронзовая лига'
  end
$$;

-- Титул — по лучшим заслугам.
create function public.title_of(p_player_id uuid) returns text
language sql stable set search_path = ''
as $$
  select case
    when exists (select 1 from public.season_results where player_id = p_player_id and place = 1
                   and capital <> public.start_capital()) then 'Чемпион сезона'
    when exists (select 1 from public.season_results where player_id = p_player_id and place <= 3
                   and capital <> public.start_capital()) then 'Призёр сезона'
    when exists (select 1 from public.player_achievements where player_id = p_player_id and code = 'capital_500k') then 'Магнат'
    when exists (select 1 from public.player_achievements where player_id = p_player_id and code = 'all_businesses') then 'Предприниматель'
    when exists (select 1 from public.player_achievements where player_id = p_player_id and code = 'first_business') then 'Бизнесмен'
    else 'Новичок'
  end
$$;

-- Открытая карточка компании — её видят и другие игроки.
create function public.public_profile(p_player_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', p.company_name, 'icon', p.company_icon,
                                  'color', p.company_color, 'motto', p.company_motto),
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

-- Полный профиль для вкладки «Профиль».
create function public.my_profile(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  me jsonb;
begin
  perform public.check_achievements(p_player_id);
  me := public.leaderboard(p_player_id, 'growth') -> 'me';

  return public.public_profile(p_player_id) || jsonb_build_object(
    'growth', (me ->> 'growth')::numeric,
    'businesses', (select count(*) from public.businesses where player_id = p_player_id),
    'streak', public.visit_streak(p_player_id),
    'season', (select jsonb_build_object('number', id, 'theme', theme, 'ends_at', ends_at)
                 from public.seasons where not finished order by id desc limit 1),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
                                  'season', r.season_id, 'place', r.place, 'capital', r.capital,
                                  'growth', r.growth, 'theme', s.theme,
                                  'total', (select count(*) from public.season_results x where x.season_id = r.season_id))
                                order by r.season_id desc)
                           from public.season_results r join public.seasons s on s.id = r.season_id
                          where r.player_id = p_player_id), '[]'::jsonb),
    'referral', jsonb_build_object(
      'code', (select ref_code from public.players where id = p_player_id),
      'invited', (select count(*) from public.players where referred_by = p_player_id)),
    'settings', (select jsonb_build_object('notify', notify_enabled, 'haptics', haptics_enabled)
                   from public.players where id = p_player_id)
  );
end;
$$;

-- Приглашение засчитывается только новичку, в первые 10 минут после регистрации, и не самому себе.
create function public.apply_referral(p_player_id uuid, p_code text) returns void
language sql
set search_path = ''
as $$
  update public.players p
     set referred_by = r.id
    from public.players r
   where p.id = p_player_id
     and p.referred_by is null
     and p.created_at > now() - interval '10 minutes'
     and r.ref_code = p_code
     and r.id <> p.id
$$;

create function public.update_settings(p_player_id uuid, p_notify boolean, p_haptics boolean) returns void
language sql
set search_path = ''
as $$
  update public.players
     set notify_enabled = coalesce(p_notify, notify_enabled),
         haptics_enabled = coalesce(p_haptics, haptics_enabled)
   where id = p_player_id
$$;

-- Ежечасно: снимки капитала, достижения всех игроков, смена сезона (каждый третий — «Кризис»).
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
  insert into public.season_results (season_id, player_id, place, capital, growth)
  select s.id, player_id,
         row_number() over (order by capital desc, player_id),
         capital,
         round((capital - public.start_capital())::numeric / public.start_capital() * 100, 1)
    from public.capitals();
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

-- Состояние экрана: отмечаем день визита, отдаём настройку вибрации.
create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  pd     public.player_decisions;
  result jsonb;
begin
  update public.players set last_seen_at = now() where id = p_player_id;
  insert into public.player_days (player_id, day) values (p_player_id, public.moscow_today())
  on conflict do nothing;
  pd := public.today_decision(p_player_id);

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
               'raw_stock', b.raw_stock, 'pending_revenue', b.pending_revenue,
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
    'capital', (select c.capital from public.capitals() c where c.player_id = p_player_id),
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

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
