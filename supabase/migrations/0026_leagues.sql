-- Лиги с повышением и вылетом. Раньше лига зависела от капитала прямо сейчас; теперь у игрока своя лига на весь
-- сезон, а по итогам сезона лучшие в лиге поднимаются выше, последние опускаются. Место — среди игроков своей лиги.
-- 1 — Бриллиантовая, 2 — Золотая, 3 — Серебряная, 4 — Бронзовая (новички начинают в Бронзовой).

insert into public.balance_config (key, value, description) values
  ('league.move', 3, 'Лиги: сколько лучших поднимаются и сколько последних опускаются по итогам сезона')
on conflict (key) do nothing;

alter table public.players add column league_tier smallint not null default 4 check (league_tier between 1 and 4);

-- В этом сезоне начинаем с той лиги, в которой игрок сейчас по капиталу, — чтобы у всех ничего не поменялось.
update public.players p
   set league_tier = case public.league_of(c.capital)
                       when 'Бриллиантовая лига' then 1 when 'Золотая лига' then 2
                       when 'Серебряная лига' then 3 else 4 end
  from public.capitals() c
 where c.player_id = p.id;

create function public.league_name(p_tier int) returns text
language sql immutable set search_path = ''
as $$ select (array['Бриллиантовая лига', 'Золотая лига', 'Серебряная лига', 'Бронзовая лига'])[greatest(1, least(4, p_tier))] $$;

-- «в Золотую лигу» — для текстов.
create function public.league_to(p_tier int) returns text
language sql immutable set search_path = ''
as $$ select (array['в Бриллиантовую лигу', 'в Золотую лигу', 'в Серебряную лигу', 'в Бронзовую лигу'])[greatest(1, least(4, p_tier))] $$;

-- Сколько поднимется и опустится в лиге из p_n игроков: не больше league.move и не больше трети лиги.
create function public.league_moves(p_n int) returns int
language sql stable set search_path = ''
as $$ select least(public.cfg('league.move')::int, p_n / 3) $$;

-- Место в своей лиге, размер лиги и зоны повышения и вылета.
create function public.league_view(p_player uuid) returns jsonb
language sql stable set search_path = ''
as $$
  with me as (select league_tier as tier, is_test from public.players where id = p_player),
  ranked as (
    select c.player_id, c.capital,
           row_number() over (order by c.capital desc, c.player_id) as place
      from public.capitals() c join public.players p on p.id = c.player_id
     where p.league_tier = (select tier from me)
  ),
  info as (
    select (select tier from me) as tier,
           (select count(*) from ranked)::int as size,
           (select place from ranked where player_id = p_player)::int as place,
           (select capital from ranked where player_id = p_player) as cap
  )
  select jsonb_build_object(
    'tier', i.tier,
    'name', public.league_name(i.tier),
    'place', i.place,
    'size', i.size,
    'moves', public.league_moves(i.size),
    'up_name', case when i.tier > 1 then public.league_name(i.tier - 1) end,
    'down_name', case when i.tier < 4 then public.league_name(i.tier + 1) end,
    -- Сколько не хватает до последнего места в зоне повышения.
    'gap_up', (select r.capital - i.cap + 100 from ranked r
                where r.place = public.league_moves(i.size) and i.place > r.place),
    'ahead', (select jsonb_build_object('name', coalesce(nullif(p.company_name, ''), p.first_name), 'gap', r.capital - i.cap)
                from ranked r join public.players p on p.id = r.player_id
               where r.place = i.place - 1)
  )
  from info i
$$;

-- Профиль и карточка компании: лига — своя, а не по капиталу.
create or replace function public.public_profile(p_player_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', p.company_name, 'icon', p.company_icon,
                                  'color', p.company_color, 'motto', p.company_motto),
    'dev', p.is_admin and p.show_dev_badge,
    'league', public.league_name(p.league_tier),
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

-- Итоги сезона → переходы между лигами. Срабатывает, когда сезон помечается законченным (в hourly, после записи
-- season_results и до сброса). Тестовые игроки и те, кто не играл (капитал не менялся), вверх не поднимаются.
create function public.league_rollover() returns trigger
language plpgsql set search_path = ''
as $$
declare
  t      int;
  v_n    int;
  v_k    int;
  v_up   text;
  v_down text;
begin
  if not (new.finished and not old.finished) then return new; end if;
  -- Лиги до переходов: кто опустился из 1-й во 2-ю, во 2-й в этом же сезоне не участвует.
  create temporary table if not exists _tiers on commit drop as select id, league_tier from public.players;
  for t in 1..4 loop
    create temporary table if not exists _lg (player_id uuid, pos int, played boolean) on commit drop;
    truncate _lg;
    insert into _lg
    select r.player_id, row_number() over (order by r.capital desc, r.player_id),
           r.capital <> public.start_capital()
      from public.season_results r join public.players p on p.id = r.player_id
      join _tiers tt on tt.id = p.id
     where r.season_id = new.id and tt.league_tier = t and not p.is_test;
    select count(*) into v_n from _lg;
    v_k := public.league_moves(v_n);
    if v_k = 0 then continue; end if;
    if t > 1 then
      select string_agg(public.company_label(player_id), ', ' order by pos) into v_up
        from _lg where pos <= v_k and played;
      update public.players p set league_tier = t - 1
        from _lg l where l.player_id = p.id and l.pos <= v_k and l.played;
      insert into public.notifications (player_id, kind, text)
      select l.player_id, 'league_up', format('Повышение! В новом сезоне ты переходишь %s.', public.league_to(t - 1))
        from _lg l where l.pos <= v_k and l.played;
      if v_up is not null then
        insert into public.city_news (kind, text) values ('league', format('Повышение %s: %s', public.league_to(t - 1), v_up));
      end if;
    end if;
    if t < 4 then
      update public.players p set league_tier = t + 1
        from _lg l where l.player_id = p.id and l.pos > v_n - v_k;
      insert into public.notifications (player_id, kind, text)
      select l.player_id, 'league_down', format('Сезон закончен: ты опускаешься %s. Отыграйся в новом сезоне!',
                                                public.league_to(t + 1))
        from _lg l where l.pos > v_n - v_k;
    end if;
  end loop;
  return new;
end;
$$;
create trigger league_rollover after update of finished on public.seasons
  for each row execute function public.league_rollover();

-- Соперник рядом — в своей лиге.
create or replace function public.rival_view(p_player uuid, p_cap bigint) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object('ahead', v -> 'ahead', 'next_league', null)
    from (select public.league_view(p_player) v) x
$$;

create or replace function public.get_state(p_player_id uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v  jsonb;
  lg jsonb;
begin
  perform public.ensure_city_event();
  perform public.ensure_city_orders();
  v := public.get_state_base(p_player_id);
  lg := public.league_view(p_player_id);
  return v || jsonb_build_object(
    'league', lg ->> 'name',
    'league_place', (lg ->> 'place')::int,
    'league_info', lg,
    'daily', public.daily_view(p_player_id),
    'events', public.city_events_view(),
    'rival', jsonb_build_object('ahead', lg -> 'ahead', 'next_league', null),
    'orders', public.orders_view(p_player_id),
    'news', public.news_view()
  );
end;
$$;

-- Разработчик: поставить себе лигу (проверить зоны и названия).
create function public.dev_league(p_admin uuid, p_tier int) returns text
language plpgsql set search_path = ''
as $$
declare
  a public.players := public.dev_lock_admin(p_admin);
begin
  if p_tier not between 1 and 4 then raise exception 'Лига — от 1 до 4'; end if;
  update public.players set league_tier = p_tier where id = a.id;
  perform public.dev_write_log(a, 'league', jsonb_build_object('tier', p_tier));
  return 'Лига: ' || public.league_name(p_tier);
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
