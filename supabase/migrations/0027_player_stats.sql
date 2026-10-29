-- Статистика игроков для вкладки DEV: сколько пришло, сколько вернулось, где новички бросают.
-- Считаем только настоящих игроков: без тестовых и без администраторов. Дни — по Москве.
-- dev_info теперь обёртка: основная часть — dev_info_base, обёртка добавляет players_stats.

create function public.players_stats() returns jsonb
language sql stable set search_path = ''
as $$
  with pl as (
    select p.id, (p.created_at at time zone 'Europe/Moscow')::date as day0, p.company_created_at, p.last_seen_at
      from public.players p
     where not p.is_test and not p.is_admin and p.telegram_id > 0
  ),
  visits as (
    select d.player_id, d.day from public.player_days d join pl on pl.id = d.player_id
  ),
  today as (select public.moscow_today() as d)
  select jsonb_build_object(
    'total', (select count(*) from pl),
    'online', (select count(*) from pl where last_seen_at > now() - interval '10 minutes'),
    'dau', (select count(distinct player_id) from visits where day = (select d from today)),
    'wau', (select count(distinct player_id) from visits where day > (select d from today) - 7),
    'new_7d', (select count(*) from pl where day0 > (select d from today) - 7),
    -- Заходы по дням за 14 дней: всего игроков и из них новых.
    'days', (select jsonb_agg(jsonb_build_object(
               'day', g.d,
               'active', (select count(distinct v.player_id) from visits v where v.day = g.d),
               'new', (select count(*) from pl where pl.day0 = g.d)) order by g.d)
               from generate_series((select d from today) - 13, (select d from today), interval '1 day') as g0(t),
                    lateral (select g0.t::date as d) g),
    -- Возвраты по дню прихода: из пришедших в этот день — сколько зашли на 1-й, 3-й и 7-й день после.
    -- null — этот день ещё не наступил.
    'cohorts', (select jsonb_agg(jsonb_build_object(
                  'day', c.day0, 'size', c.size,
                  'd1', case when c.day0 + 1 <= (select d from today) then c.d1 end,
                  'd3', case when c.day0 + 3 <= (select d from today) then c.d3 end,
                  'd7', case when c.day0 + 7 <= (select d from today) then c.d7 end) order by c.day0 desc)
                  from (select pl.day0, count(*) as size,
                               count(*) filter (where exists (select 1 from visits v where v.player_id = pl.id and v.day = pl.day0 + 1)) as d1,
                               count(*) filter (where exists (select 1 from visits v where v.player_id = pl.id and v.day = pl.day0 + 3)) as d3,
                               count(*) filter (where exists (select 1 from visits v where v.player_id = pl.id and v.day = pl.day0 + 7)) as d7
                          from pl where pl.day0 > (select d from today) - 14
                         group by pl.day0) c),
    -- Путь новичка (пришедшие за 30 дней): на каком шаге отваливаются.
    'funnel', (with n as (select * from pl where day0 > (select d from today) - 30)
               select jsonb_build_array(
                 jsonb_build_object('step', 'Зашли в игру', 'n', (select count(*) from n)),
                 jsonb_build_object('step', 'Создали компанию', 'n', (select count(*) from n where company_created_at is not null)),
                 jsonb_build_object('step', 'Открыли первый бизнес', 'n',
                   (select count(*) from n where exists (select 1 from public.constructions c where c.player_id = n.id)
                                              or exists (select 1 from public.businesses b where b.player_id = n.id)
                                              or exists (select 1 from public.sales_log s where s.player_id = n.id))),
                 jsonb_build_object('step', 'Первая продажа', 'n',
                   (select count(*) from n where exists (select 1 from public.sales_log s where s.player_id = n.id and s.sold > 0))),
                 jsonb_build_object('step', 'Вернулись на другой день', 'n',
                   (select count(*) from n where exists (select 1 from visits v where v.player_id = n.id and v.day > n.day0))),
                 jsonb_build_object('step', 'Играли 3 дня и больше', 'n',
                   (select count(*) from n where (select count(*) from visits v where v.player_id = n.id) >= 3))
               ))
  )
$$;

alter function public.dev_info(uuid) rename to dev_info_base;

create function public.dev_info(p_admin uuid) returns jsonb
language plpgsql set search_path = ''
as $$
begin
  return public.dev_info_base(p_admin) || jsonb_build_object('players_stats', public.players_stats());
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
